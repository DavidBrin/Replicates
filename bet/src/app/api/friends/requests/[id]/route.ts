import { z } from "zod";
import { brand, type UserId } from "@/domain/entities";
import { can } from "@/domain/authz";
import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk, parseBody, throwApp } from "@/lib/http";

const actionSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
});

/**
 * Routes every "is this caller allowed to act as X here" check for a
 * friend request through `domain/authz.ts`'s `friendGraph` resource (G5)
 * rather than comparing ids by hand. Per `FriendGraphAuthzFacts`'s own doc
 * comment: "the route handler ... builds `ownerId` to mean 'the user-id
 * whose authority this specific action requires'" — this route supplies
 * `request.fromId` when checking sender-authority (existence/cancel) and
 * `request.toId` when checking recipient-authority (accept/decline).
 */
function ownsFriendGraph(actorId: UserId, ownerId: UserId): boolean {
  return can(
    { userId: actorId },
    "read",
    { type: "friendGraph", ownerId },
    { friendGraph: { ownerId } },
  );
}

/**
 * `POST /api/friends/requests/[id] { action }` (SPEC §8). Only the
 * recipient may accept/decline; only the sender may cancel — anything
 * else is `forbidden`. A caller who is neither party never learns the
 * request exists at all: both "no such id" and "exists but you're a
 * stranger to it" come back as the identical `not_found` (404) — the
 * same "never a third party" rule research §1.6/§7.2 applies to friend
 * LISTS applies here to individual friend REQUESTS too.
 */
export const POST = handler<{ id: string }>(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const { action } = await parseBody(req, actionSchema);
  const { store, clock, idGen } = await getContainer();

  const request = await store.friends.findRequestById(brand(id));
  const isParty =
    !!request && (ownsFriendGraph(me.id, request.fromId) || ownsFriendGraph(me.id, request.toId));
  if (!request || !isParty) {
    return throwApp({ code: "not_found", message: "Friend request not found." });
  }

  if (request.status !== "pending") {
    return throwApp({
      code: "conflict",
      message: "This request has already been resolved.",
    });
  }

  if (action === "cancel") {
    if (!ownsFriendGraph(me.id, request.fromId)) {
      return throwApp({
        code: "forbidden",
        message: "Only the sender can cancel a friend request.",
      });
    }
    // Single write, but still through `transact`: the store's mutex only
    // serializes transact-vs-transact, so a BARE write here could land
    // mid-flight of a concurrent `accept` transact and be silently
    // clobbered when that transact's diff commits (Fix round 1, Important
    // 1) — every write to this row now goes through the same
    // staging/diff path as `accept`.
    const updated = await store.transact((tx) =>
      tx.friends.updateRequestStatus(request.id, "cancelled"),
    );
    return jsonOk({ request: updated });
  }

  // accept / decline: recipient only.
  if (!ownsFriendGraph(me.id, request.toId)) {
    return throwApp({
      code: "forbidden",
      message: "Only the recipient can respond to a friend request.",
    });
  }

  if (action === "decline") {
    const updated = await store.transact((tx) =>
      tx.friends.updateRequestStatus(request.id, "declined"),
    );
    return jsonOk({ request: updated });
  }

  // accept: one friendship row + one status update inside a single
  // `transact` — the canonical "must not race a bare write" example named
  // in this task's storage caveat.
  const { updated, friendship } = await store.transact(async (tx) => {
    const friendship = await tx.friends.insertFriendship({
      userAId: request.fromId,
      userBId: request.toId,
      createdAt: clock.now(),
    });
    const updated = await tx.friends.updateRequestStatus(request.id, "accepted");
    await tx.notifications.insert({
      id: brand(idGen.next("ntf")),
      userId: request.fromId,
      type: "friend_request_accepted",
      payload: { toHandle: me.handle },
      createdAt: clock.now(),
    });
    return { updated, friendship };
  });

  return jsonOk({ request: updated, friendship });
});
