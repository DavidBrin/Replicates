import type { FriendRequest, User, UserId } from "@/domain/entities";
import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk } from "@/lib/http";
import { toPublicUser, type PublicUser } from "@/app/api/_shared/social";

interface FriendRequestSummary {
  id: string;
  status: FriendRequest["status"];
  createdAt: Date;
  user: PublicUser;
}

/**
 * `GET /api/friends` — SPEC §8 lists exactly one GET for the whole friends
 * surface, so this doubles as the data source for every tab Task 12's
 * Friends page needs (Friends / Requests / Sent) — there is no separate
 * `GET /api/friends/requests` in the API surface. `requireUser` is the
 * only gate this needs (G5): every list below is derived from the
 * caller's OWN id, so there's no third-party resource to `can()` against —
 * this route can never expose anyone else's friend list or requests (D5 /
 * research §1.6's "never a third party" rule).
 */
export const GET = handler(async (req) => {
  const me = await requireUser(req);
  const { store } = await getContainer();

  const [friendships, incoming, outgoing] = await Promise.all([
    store.friends.listFriends(me.id),
    store.friends.listIncomingRequests(me.id, "pending"),
    store.friends.listOutgoingRequests(me.id, "pending"),
  ]);

  const otherSideOf = (a: UserId, b: UserId): UserId => (a === me.id ? b : a);
  const userCache = new Map<UserId, User | undefined>();
  const loadUser = async (id: UserId): Promise<User | undefined> => {
    if (!userCache.has(id)) userCache.set(id, await store.users.findById(id));
    return userCache.get(id);
  };

  const friends = (
    await Promise.all(
      friendships.map(async (f) => {
        const other = await loadUser(otherSideOf(f.userAId, f.userBId));
        if (!other) return null;
        return { ...toPublicUser(other), friendsSince: f.createdAt };
      }),
    )
  ).filter((f): f is NonNullable<typeof f> => f !== null);

  const toSummary = async (
    request: FriendRequest,
    otherUserId: UserId,
  ): Promise<FriendRequestSummary | null> => {
    const other = await loadUser(otherUserId);
    if (!other) return null;
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      user: toPublicUser(other),
    };
  };

  const incomingRequests = (
    await Promise.all(incoming.map((r) => toSummary(r, r.fromId)))
  ).filter((r): r is FriendRequestSummary => r !== null);
  const outgoingRequests = (
    await Promise.all(outgoing.map((r) => toSummary(r, r.toId)))
  ).filter((r): r is FriendRequestSummary => r !== null);

  return jsonOk({ friends, incomingRequests, outgoingRequests });
});
