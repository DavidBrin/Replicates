import { z } from "zod";
import { brand } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getContainer, requireUser } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { INVITE_EXPIRY_MS } from "@/app/api/_shared/social";

const inviteMemberSchema = z.object({
  handle: z.string().trim().min(1, "handle is required"),
});

/**
 * `POST /api/groups/[slug]/members { handle }` (SPEC §8). David's
 * ambiguity resolution: the target must already be a FRIEND of the
 * caller; this creates an INVITE, never a direct add. Inviting someone
 * already in the group is `conflict`.
 *
 * Gated on the `group` resource's "read" action rather than "write":
 * `authz.ts`'s `canGroup` reserves "write" for owner-only settings
 * changes, but inviting a friend is closer to an ordinary membership
 * action any current member should be able to take (research doesn't
 * restrict group invites to the owner) — "read" already means "member or
 * owner," which is exactly the right gate here.
 */
export const POST = handler<{ slug: string }>(async (req, { params }) => {
  const me = await requireUser(req);
  const { slug } = await params;
  const { handle } = await parseBody(req, inviteMemberSchema);
  const { store, clock, idGen } = await getContainer();

  const group = await store.groups.findBySlug(slug);
  authorizeOr404(
    !!group &&
      can(
        { userId: me.id },
        "read",
        { type: "group", id: group.id },
        { group: { ownerId: group.ownerId, isMember: group.memberIds.includes(me.id) } },
      ),
  );
  const found = group!;

  const target = await store.users.findByHandle(handle);
  if (!target) {
    return throwApp({ code: "not_found", message: "No user with that handle." });
  }
  if (found.memberIds.includes(target.id)) {
    return throwApp({
      code: "conflict",
      message: `${target.displayName} is already in this group.`,
    });
  }
  const isFriend = await store.friends.areFriends(me.id, target.id);
  if (!isFriend) {
    return throwApp({
      code: "validation",
      message: "You can only invite friends into a group.",
      fields: { handle: "Add them as a friend first." },
    });
  }

  const existingInvites = await store.invites.listByInvitee(target.id);
  const alreadyInvited = existingInvites.some(
    (i) =>
      i.targetType === "group" &&
      i.targetId === found.id &&
      (i.status === "created" || i.status === "sent" || i.status === "viewed"),
  );
  if (alreadyInvited) {
    return throwApp({
      code: "conflict",
      message: `${target.displayName} already has a pending invite to this group.`,
    });
  }

  const now = clock.now();
  const invite = await store.invites.insert({
    id: brand(idGen.next("inv")),
    kind: "direct",
    targetType: "group",
    targetId: found.id,
    inviterId: me.id,
    inviteeId: target.id,
    status: "sent",
    expiresAt: new Date(now.getTime() + INVITE_EXPIRY_MS),
    createdAt: now,
  });

  return jsonOk({ invite }, { status: 201 });
});
