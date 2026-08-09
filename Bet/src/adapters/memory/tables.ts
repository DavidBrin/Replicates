/**
 * The in-memory adapter's raw storage: one `Map` per aggregate, held in a
 * single mutable container so `transact` can stage/commit/discard the whole
 * store atomically by swapping this container's properties.
 */

import type {
  Friendship,
  FriendRequest,
  Group,
  Invite,
  Market,
  Message,
  Notification,
  Position,
  PricePoint,
  Trade,
  User,
} from "@/domain/entities";

export type Tables = {
  users: Map<string, User>;
  /** Keyed `${userAId}:${userBId}` (already the ordered pair). */
  friendships: Map<string, Friendship>;
  friendRequests: Map<string, FriendRequest>;
  groups: Map<string, Group>;
  markets: Map<string, Market>;
  positions: Map<string, Position>;
  trades: Map<string, Trade>;
  messages: Map<string, Message>;
  invites: Map<string, Invite>;
  notifications: Map<string, Notification>;
  /** Keyed by `marketId`; each value is that market's price points in
   * insertion (chronological) order. */
  pricePoints: Map<string, PricePoint[]>;
};

export function createEmptyTables(): Tables {
  return {
    users: new Map(),
    friendships: new Map(),
    friendRequests: new Map(),
    groups: new Map(),
    markets: new Map(),
    positions: new Map(),
    trades: new Map(),
    messages: new Map(),
    invites: new Map(),
    notifications: new Map(),
    pricePoints: new Map(),
  };
}

/** Deep-clones an entire `Tables` container (used to stage a `transact`
 * copy). `structuredClone` natively deep-clones `Map`s, `Date`s, arrays, and
 * plain objects, which covers every value shape used by our entities. */
export function cloneTables(tables: Tables): Tables {
  return structuredClone(tables);
}

/** Defensive structural clone of a single entity, used on every repo read
 * (and write-in) so a caller mutating a value it holds can never corrupt
 * the store, and vice versa. */
export function cloneEntity<T>(value: T): T {
  return structuredClone(value);
}
