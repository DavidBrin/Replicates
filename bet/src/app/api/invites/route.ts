import { z } from "zod";
import { brand, type UserId } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getContainer, requireUser } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { INVITE_EXPIRY_MS, mintInviteToken } from "@/app/api/_shared/social";

const createInviteSchema = z
  .object({
    targetType: z.enum(["group", "market"]),
    targetId: z.string().trim().min(1),
    inviteeId: z.string().trim().min(1).optional(),
    kind: z.enum(["direct", "link"]).optional(),
  })
  .superRefine((body, ctx) => {
    const isLink = body.kind === "link" || (body.kind === undefined && body.inviteeId === undefined);
    if (!isLink && body.inviteeId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["inviteeId"],
        message: "inviteeId is required for a direct invite.",
      });
    }
    if (isLink && body.inviteeId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "A link invite can't also name an invitee.",
      });
    }
  });

/**
 * `POST /api/invites { targetType, targetId, inviteeId? | kind: "link" }`
 * (SPEC §8). Two shapes:
 *   - `{ inviteeId }` (kind defaults to `"direct"`): invites a SPECIFIC,
 *     already-friended user (research §3.1(b): money/group-adjacent, so
 *     this app requires friendship for both target types, not just
 *     markets).
 *   - `{ kind: "link" }`: mints a shareable token — 32 random bytes via
 *     `crypto.getRandomValues`, base64url-encoded; only the SHA-256 hash
 *     is ever persisted (`Invite.tokenHash`); the raw token is returned
 *     exactly once, in THIS response, and never again.
 * Both kinds get a 7-day expiry (David's ambiguity resolution for links,
 * applied uniformly — see `INVITE_EXPIRY_MS`'s doc comment).
 *
 * Note: `POST /api/groups/[slug]/members` is the primary, fully-guarded
 * path for inviting a friend into a group (it also checks "already a
 * member"). This route additionally supports GROUP targets for
 * completeness (e.g. minting a group's link invite) but does not repeat
 * that specific "already a member" check — a harmless gap since
 * `groups.addMember` is idempotent and accepting a redundant invite is a
 * no-op; see the Task 6 report.
 */
export const POST = handler(async (req) => {
  const me = await requireUser(req);
  const body = await parseBody(req, createInviteSchema);
  const { store, clock, idGen } = await getContainer();
  const isLink = body.kind === "link" || (body.kind === undefined && body.inviteeId === undefined);

  // --- authorize against the target -------------------------------------
  if (body.targetType === "group") {
    const group = await store.groups.findById(brand<"GroupId">(body.targetId));
    authorizeOr404(
      !!group &&
        can(
          { userId: me.id },
          "read",
          { type: "group", id: group.id },
          { group: { ownerId: group.ownerId, isMember: group.memberIds.includes(me.id) } },
        ),
    );
  } else {
    const market = await store.markets.findById(brand<"MarketId">(body.targetId));
    if (!market) {
      return throwApp({ code: "not_found", message: "Not found." });
    }
    const [myPositions, myInvites] = await Promise.all([
      store.positions.listByUser(me.id),
      store.invites.listByInvitee(me.id),
    ]);
    const isParticipant =
      market.creatorId === me.id || myPositions.some((p) => p.marketId === market.id);
    const hasPendingInvite = myInvites.some(
      (i) => i.targetType === "market" && i.targetId === market.id && i.status === "sent",
    );
    authorizeOr404(
      can(
        { userId: me.id },
        "read",
        { type: "market", id: market.id },
        {
          market: {
            creatorId: market.creatorId,
            status: market.status,
            isParticipant,
            hasPendingInvite,
          },
        },
      ),
    );
  }

  const now = clock.now();
  const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_MS);

  if (isLink) {
    const { token, tokenHash } = mintInviteToken();
    const invite = await store.invites.insert({
      id: brand(idGen.next("inv")),
      kind: "link",
      targetType: body.targetType,
      targetId: body.targetType === "group" ? brand<"GroupId">(body.targetId) : brand<"MarketId">(body.targetId),
      inviterId: me.id,
      tokenHash,
      status: "sent",
      expiresAt,
      createdAt: now,
    });
    // The raw token is handed back exactly once — never stored, never
    // retrievable again after this response.
    return jsonOk({ invite, token }, { status: 201 });
  }

  // --- direct invite ------------------------------------------------------
  const inviteeId = brand<"UserId">(body.inviteeId as string);
  const invitee = await store.users.findById(inviteeId);
  if (!invitee) {
    return throwApp({ code: "not_found", message: "No such user." });
  }
  if (invitee.id === me.id) {
    return throwApp({ code: "validation", message: "You can't invite yourself." });
  }
  const isFriend = await store.friends.areFriends(me.id, invitee.id);
  if (!isFriend) {
    return throwApp({
      code: "validation",
      message: "You can only invite friends.",
      fields: { inviteeId: "Add them as a friend first." },
    });
  }

  const existing = await store.invites.listByInvitee(invitee.id);
  const alreadyInvited = existing.some(
    (i) =>
      i.targetType === body.targetType &&
      i.targetId === body.targetId &&
      (i.status === "created" || i.status === "sent" || i.status === "viewed"),
  );
  if (alreadyInvited) {
    return throwApp({ code: "conflict", message: "Already invited." });
  }

  const invite = await store.transact(async (tx) => {
    const created = await tx.invites.insert({
      id: brand(idGen.next("inv")),
      kind: "direct",
      targetType: body.targetType,
      targetId:
        body.targetType === "group" ? brand<"GroupId">(body.targetId) : brand<"MarketId">(body.targetId),
      inviterId: me.id,
      inviteeId: invitee.id as UserId,
      status: "sent",
      expiresAt,
      createdAt: now,
    });
    if (body.targetType === "market") {
      await tx.notifications.insert({
        id: brand(idGen.next("ntf")),
        userId: invitee.id,
        type: "bet_invite_received",
        payload: { marketId: body.targetId, inviterHandle: me.handle },
        createdAt: now,
      });
    }
    return created;
  });

  return jsonOk({ invite }, { status: 201 });
});
