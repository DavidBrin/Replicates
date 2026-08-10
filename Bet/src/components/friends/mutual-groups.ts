/**
 * Mutual-GROUP count (never a mutual-friends list — D5/research §1.6's
 * "friend lists are never enumerable by other users" is absolute; the
 * Friends page's ambiguity resolution explicitly carves out mutual
 * *groups* as the one allowed cross-user signal, since group membership is
 * something both parties can already see for themselves via
 * `GET /api/groups/[slug]`). `myGroups` is always the VIEWER's own group
 * membership — this never takes anyone else's, so there is no way to call
 * it with data that would leak a third party's graph.
 *
 * Pure, and shared between the server-rendered initial data (Friends page)
 * and the client-side live search results (`FriendsBoard`), which both
 * already have `myGroups` in hand from the same server render — no extra
 * request needed either way.
 */
export interface MyGroupMembership {
  id: string;
  memberIds: string[];
}

export function mutualGroupCount(userId: string, myGroups: readonly MyGroupMembership[]): number {
  let count = 0;
  for (const group of myGroups) {
    if (group.memberIds.includes(userId)) count += 1;
  }
  return count;
}

export function formatMutualGroups(count: number): string | null {
  if (count <= 0) return null;
  return `${count} mutual group${count === 1 ? "" : "s"}`;
}
