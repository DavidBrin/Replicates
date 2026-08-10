import { z } from "zod";
import { brand } from "@/domain/entities";
import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { toPublicUser } from "@/app/api/_shared/social";

const sendRequestSchema = z.object({
  toHandle: z.string().trim().min(1, "toHandle is required"),
});

/**
 * `POST /api/friends/requests { toHandle }` (SPEC §8). David's ambiguity
 * resolutions:
 *   - self-request -> `validation`
 *   - a duplicate PENDING request in EITHER direction -> `conflict`
 *   - if the target already sent the caller a pending request, don't
 *     auto-accept it (research's default) — return `conflict` telling the
 *     caller to accept the existing one instead.
 * `requireUser` + the party checks below ARE this route's authorization —
 * there is no pre-existing `friendGraph`/request resource to `can()`
 * against yet (nothing exists until this handler creates it), matching
 * the same "creation route, no can()" shape as `POST /api/session` and
 * `POST /api/groups`.
 */
export const POST = handler(async (req) => {
  const me = await requireUser(req);
  const { toHandle } = await parseBody(req, sendRequestSchema);
  const { store, clock, idGen } = await getContainer();

  const target = await store.users.findByHandle(toHandle);
  if (!target) {
    return throwApp({ code: "not_found", message: "No user with that handle." });
  }
  if (target.id === me.id) {
    return throwApp({
      code: "validation",
      message: "You can't send yourself a friend request.",
      fields: { toHandle: "That's you." },
    });
  }

  const [alreadyFriends, sentByMe, sentToMe] = await Promise.all([
    store.friends.areFriends(me.id, target.id),
    store.friends.findPendingRequest(me.id, target.id),
    store.friends.findPendingRequest(target.id, me.id),
  ]);

  if (alreadyFriends) {
    return throwApp({ code: "conflict", message: "You're already friends." });
  }
  if (sentByMe) {
    return throwApp({
      code: "conflict",
      message: "You already sent this user a friend request.",
    });
  }
  if (sentToMe) {
    return throwApp({
      code: "conflict",
      message: `${target.displayName} already sent you a friend request — accept it instead of sending a new one.`,
    });
  }

  const request = await store.transact(async (tx) => {
    const created = await tx.friends.createRequest({
      id: brand(idGen.next("freq")),
      fromId: me.id,
      toId: target.id,
      status: "pending",
      createdAt: clock.now(),
    });
    await tx.notifications.insert({
      id: brand(idGen.next("ntf")),
      userId: target.id,
      type: "friend_request_received",
      payload: { fromHandle: me.handle },
      createdAt: clock.now(),
    });
    return created;
  });

  return jsonOk(
    { request: { ...request, from: toPublicUser(me), to: toPublicUser(target) } },
    { status: 201 },
  );
});
