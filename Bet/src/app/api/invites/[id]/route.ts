import { z } from "zod";
import { brand, type GroupId, type Invite, type MarketId } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { hashInviteToken } from "@/app/api/_shared/social";

const NON_TERMINAL_STATUSES = new Set<Invite["status"]>(["created", "sent", "viewed"]);

/**
 * `GET /api/invites/[id]` — SPEC §8 names this route `[token]`. Next.js
 * requires one dynamic-segment name per path position, and David's own
 * ambiguity resolution for the POST sibling below
 * (`POST /api/invites/[id] { action }`) sits at that exact same position
 * (`/api/invites/<segment>`), so both HTTP methods have to live in one
 * `[id]/route.ts` — see the Task 6 report for the full reasoning. GET
 * reads the segment as an opaque LINK TOKEN (hashed and looked up by
 * `tokenHash`, never a direct `findById` — an invite's real id is never
 * handed to an unauthenticated caller any other way); POST reads it as
 * the invite's real id.
 *
 * No auth required for GET (public preview, per SPEC). Every failure
 * mode — wrong token, expired, revoked, already-answered, not a link
 * invite at all — comes back as the SAME 404, so a stranger holding a
 * dead link can't learn anything more than "this doesn't work" (research
 * §2.5/§7.3's enumeration-resistance principle, applied to invite
 * tokens). Returns the bare minimum: target name, inviter display name,
 * expiry — never a member list or market internals.
 */
export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const { id: token } = await params;
  const { store } = await getContainer();

  const invite = await store.invites.findByTokenHash(hashInviteToken(token));
  const now = Date.now();
  const redeemable =
    !!invite &&
    invite.kind === "link" &&
    NON_TERMINAL_STATUSES.has(invite.status) &&
    invite.expiresAt.getTime() > now;

  if (!redeemable) {
    return throwApp({ code: "not_found", message: "This invite link is no longer valid." });
  }
  const inv = invite as Invite;

  const [inviter, targetName] = await Promise.all([
    store.users.findById(inv.inviterId),
    inv.targetType === "group"
      ? store.groups.findById(inv.targetId as GroupId).then((g) => g?.name)
      : store.markets.findById(inv.targetId as MarketId).then((m) => m?.question),
  ]);
  if (!inviter || !targetName) {
    return throwApp({ code: "not_found", message: "This invite link is no longer valid." });
  }

  // `id` is included so a client who already proved possession of the raw
  // token (that's the whole point of this GET) can round-trip into
  // `POST /api/invites/[id]` to accept once signed in. Everything else
  // stays to the documented bare minimum.
  return jsonOk({
    id: inv.id,
    targetType: inv.targetType,
    targetName,
    inviterDisplayName: inviter.displayName,
    expiresAt: inv.expiresAt,
  });
});

const actionSchema = z.object({ action: z.enum(["accept", "decline", "revoke"]) });

/**
 * `POST /api/invites/[id] { action }` (David's ambiguity resolution).
 * `accept`/`decline` — the invitee; `revoke` — the inviter. Exception: an
 * unredeemed LINK invite has no fixed invitee yet, so ANY signed-in
 * caller may `accept` it — "knows the id" already IS the possession
 * check for links, since the id is only ever revealed by the token-gated
 * GET above (research §7.2: "for link invites, caller possesses a valid
 * unexpired token whose hash matches").
 */
export const POST = handler<{ id: string }>(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const { action } = await parseBody(req, actionSchema);
  const { store, clock, idGen } = await getContainer();

  const invite = await store.invites.findById(brand<"InviteId">(id));
  const isOpenLinkRedemption =
    !!invite && invite.kind === "link" && !invite.inviteeId && action === "accept";

  const isParty =
    !!invite &&
    can(
      { userId: me.id },
      "read",
      { type: "invite", id: invite.id },
      { invite: { inviterId: invite.inviterId, inviteeId: invite.inviteeId } },
    );

  if (!invite || (!isOpenLinkRedemption && !isParty)) {
    return throwApp({ code: "not_found", message: "Invite not found." });
  }

  const now = clock.now();
  const isExpired = invite.expiresAt.getTime() <= now.getTime();
  const isTerminal = !NON_TERMINAL_STATUSES.has(invite.status);
  if (isExpired || isTerminal) {
    return throwApp({ code: "conflict", message: "This invite is no longer pending." });
  }

  if (action === "revoke") {
    if (invite.inviterId !== me.id) {
      return throwApp({ code: "forbidden", message: "Only the inviter can revoke this." });
    }
    // Single write, but still through `transact`: the store's mutex only
    // serializes transact-vs-transact, so a BARE write here could land
    // mid-flight of a concurrent `accept` transact on this same invite row
    // and be silently clobbered when that transact's diff commits (Fix
    // round 1, Important 1) — every write to this row now goes through the
    // same staging/diff path as `accept`.
    const updated = await store.transact((tx) => tx.invites.update(invite.id, { status: "revoked" }));
    return jsonOk({ invite: updated });
  }

  if (!isOpenLinkRedemption && invite.inviteeId !== me.id) {
    return throwApp({
      code: "forbidden",
      message: "Only the invitee can respond to this invite.",
    });
  }

  if (action === "decline") {
    const updated = await store.transact((tx) =>
      tx.invites.update(invite.id, { status: "declined" }),
    );
    return jsonOk({ invite: updated });
  }

  // accept: status flip + (for a group target) the actual membership
  // effect, in one `transact` — the multi-write case this task's storage
  // caveat calls out by name.
  const updated = await store.transact(async (tx) => {
    const patch: Partial<Omit<Invite, "id">> = { status: "accepted" };
    if (isOpenLinkRedemption) patch.inviteeId = me.id;
    const updatedInvite = await tx.invites.update(invite.id, patch);

    if (invite.targetType === "group") {
      await tx.groups.addMember(invite.targetId as GroupId, me.id);
    }
    // Market acceptance: this invite row (now `status: "accepted"`) is the
    // durable record of participation. `src/app/api/markets/**` is Task
    // 7's territory, not this task's — its `MarketAuthzFacts.isParticipant`
    // derivation should treat an ACCEPTED invite the same as holding a
    // position when granting read access to someone who accepted but
    // hasn't traded yet. Flagged as a cross-task loose end in the Task 6
    // report rather than solved here.
    if (invite.targetType === "market") {
      await tx.notifications.insert({
        id: brand(idGen.next("ntf")),
        userId: invite.inviterId,
        type: "bet_invite_accepted",
        payload: { marketId: invite.targetId, inviteeHandle: me.handle },
        createdAt: now,
      });
    }

    return updatedInvite;
  });

  return jsonOk({ invite: updated });
});
