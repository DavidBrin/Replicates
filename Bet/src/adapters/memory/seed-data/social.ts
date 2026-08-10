/**
 * The social graph: symmetric friendships, pending friend requests, and
 * pending market invites (docs/plan.md Task 5: "Friendships + 3 pending
 * friend requests + 2 pending market invites so those UIs have content").
 */

/** Undirected pairs — `seed.ts` orders each pair before calling
 * `insertFriendship` (the store's own `pairKey` also re-orders defensively,
 * but keeping these already-sensible reads better here). Covers `dev`'s
 * friend list plus enough cross-links among the others that "mutual group
 * count" has real variety, while deliberately leaving 4 handles
 * (`chaosgremlin`, `yeetmaster`, `noodle`, `birdie`) not-yet-friends with
 * `dev` — 2 of them show up as incoming requests below, one as an outgoing
 * request, one as a total stranger (so the `/friends` search flow has
 * someone to actually search for).
 */
export const FRIENDSHIP_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["dev", "maya"],
  ["dev", "jordan"],
  ["dev", "priya"],
  ["dev", "marcus"],
  ["dev", "sam"],
  ["dev", "liv"],
  ["dev", "kiwi"],
  ["maya", "jordan"],
  ["maya", "marcus"],
  ["maya", "sam"],
  ["priya", "kiwi"],
  ["priya", "noodle"],
  ["marcus", "sam"],
  ["marcus", "birdie"],
  ["jordan", "liv"],
  ["kiwi", "noodle"],
];

/** 3 pending requests total: 2 incoming to `dev` (populates the Requests
 * tab), 1 outgoing from `dev` (populates the Sent tab). */
export const PENDING_FRIEND_REQUESTS: ReadonlyArray<{ fromHandle: string; toHandle: string }> = [
  { fromHandle: "chaosgremlin", toHandle: "dev" },
  { fromHandle: "yeetmaster", toHandle: "dev" },
  { fromHandle: "dev", toHandle: "noodle" },
];

/** 2 pending market invites — direct invites targeting a private market
 * that hasn't been accepted yet. `marketKey` matches a `key` in
 * `private-markets.ts`; `seed.ts` resolves it to a real `MarketId` once
 * those markets exist. */
export const PENDING_MARKET_INVITES: ReadonlyArray<{
  marketKey: string;
  inviterHandle: string;
  inviteeHandle: string;
}> = [
  { marketKey: "fa-championship", inviterHandle: "marcus", inviteeHandle: "birdie" },
  { marketKey: "rm-dishes", inviterHandle: "dev", inviteeHandle: "noodle" },
];
