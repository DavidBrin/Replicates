import type { Metadata } from "next";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { toPublicUser } from "@/app/api/_shared/social";
import { formatRelativeTime } from "@/domain/formatters";
import type { User, UserId } from "@/domain/entities";
import { FriendsBoard, type FriendEntry, type RequestEntry } from "@/components/friends/FriendsBoard";
import { mutualGroupCount, type MyGroupMembership } from "@/components/friends/mutual-groups";

export const metadata: Metadata = {
  title: "Friends — Bet",
  description: "Search for people, manage friend requests.",
};

function friendsSinceLabel(at: Date): string {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * `/app/friends` (SPEC §3.5). Server Component: resolves the viewer's own
 * friends/incoming/outgoing requests and group memberships straight from
 * the container (same convention as the group dashboard — Task 9 — and
 * `/signin`; faster than a client-side waterfall fetch through this app's
 * own `/api` routes), then hands them to `FriendsBoard` as plain
 * server-rendered initial state. Every list read here is scoped to the
 * viewer's OWN id (`me.id`) — the exact same "never a third party" rule
 * `GET /api/friends` itself enforces (D5/research §1.6) — this page never
 * reads anyone else's friend graph.
 */
export default async function FriendsPage() {
  const me = await requireCurrentUser();
  const { store, clock } = await getContainer();
  const now = clock.now();

  const [friendships, incomingRequests, outgoingRequests, myGroupsRaw] = await Promise.all([
    store.friends.listFriends(me.id),
    store.friends.listIncomingRequests(me.id, "pending"),
    store.friends.listOutgoingRequests(me.id, "pending"),
    store.groups.listByMember(me.id),
  ]);

  const myGroups: MyGroupMembership[] = myGroupsRaw.map((g) => ({
    id: g.id,
    memberIds: g.memberIds,
  }));

  const userCache = new Map<UserId, User | undefined>();
  async function loadUser(id: UserId): Promise<User | undefined> {
    if (!userCache.has(id)) userCache.set(id, await store.users.findById(id));
    return userCache.get(id);
  }
  const otherSideOf = (a: UserId, b: UserId): UserId => (a === me.id ? b : a);

  const initialFriends: FriendEntry[] = (
    await Promise.all(
      friendships.map(async (f) => {
        const other = await loadUser(otherSideOf(f.userAId, f.userBId));
        if (!other) return null;
        const publicUser = toPublicUser(other);
        return {
          user: publicUser,
          mutualGroups: mutualGroupCount(other.id, myGroups),
          subtitle: friendsSinceLabel(f.createdAt),
        } satisfies FriendEntry;
      }),
    )
  ).filter((f): f is FriendEntry => f !== null);

  async function toRequestEntry(
    id: string,
    otherUserId: UserId,
    createdAt: Date,
  ): Promise<RequestEntry | null> {
    const other = await loadUser(otherUserId);
    if (!other) return null;
    const publicUser = toPublicUser(other);
    return {
      id,
      user: publicUser,
      mutualGroups: mutualGroupCount(other.id, myGroups),
      subtitle: formatRelativeTime(createdAt, now),
    };
  }

  const initialIncoming = (
    await Promise.all(incomingRequests.map((r) => toRequestEntry(r.id, r.fromId, r.createdAt)))
  ).filter((r): r is RequestEntry => r !== null);
  const initialOutgoing = (
    await Promise.all(outgoingRequests.map((r) => toRequestEntry(r.id, r.toId, r.createdAt)))
  ).filter((r): r is RequestEntry => r !== null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-(--text-1)">Friends</h1>
        <p className="text-sm text-(--text-2)">
          Search by @handle, manage requests. Friend lists are always private — only mutual
          groups are ever shown.
        </p>
      </div>

      <FriendsBoard
        initialFriends={initialFriends}
        initialIncoming={initialIncoming}
        initialOutgoing={initialOutgoing}
        myGroups={myGroups}
      />
    </div>
  );
}
