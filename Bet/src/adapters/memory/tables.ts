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

/** Structural (deep) equality, used only to decide whether a given table
 * row actually changed between a transaction's `baseline` snapshot and its
 * final `staged` state. Handles the value shapes our entities are built
 * from: primitives, `Date`, arrays, and plain objects (including the
 * `Record<OutcomeId, ...>` maps embedded in `PricingConfig`/`PricePoint`). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !(a instanceof Date) &&
    !(b instanceof Date)
  ) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

function applyMapDiff(
  baseline: Map<string, unknown>,
  staged: Map<string, unknown>,
  live: Map<string, unknown>,
): void {
  // Deletions: a key present at transaction start but gone from the staged
  // (post-callback) state.
  for (const key of baseline.keys()) {
    if (!staged.has(key)) {
      live.delete(key);
    }
  }
  // Additions/updates: a key that's new, or whose value actually changed.
  // A key the transaction never touched keeps whatever the *live* map
  // currently holds for it — including a concurrent bare write made while
  // this transaction was in flight — because we never touch it here at all.
  for (const [key, value] of staged) {
    const existedBefore = baseline.has(key);
    if (!existedBefore || !deepEqual(baseline.get(key), value)) {
      live.set(key, value);
    }
  }
}

/**
 * Commits a transaction's writes onto the live tables using a per-key
 * (per-row) diff between `baseline` (the pristine snapshot taken at the
 * transaction's start) and `staged` (the same snapshot after the
 * transaction's callback ran against it) — never by replacing an entire
 * table's `Map` reference wholesale.
 *
 * This is what makes a bare, non-`transact` write to a row (or a whole
 * table) the transaction never touched survive the transaction's commit:
 * only rows this transaction actually added, changed, or deleted are
 * applied to `live`; every other row on `live` — including one a concurrent
 * caller wrote while this transaction was in flight — is left completely
 * alone.
 */
export function applyTableDiff(baseline: Tables, staged: Tables, live: Tables): void {
  const tableNames = Object.keys(staged) as (keyof Tables)[];
  for (const name of tableNames) {
    applyMapDiff(
      baseline[name] as Map<string, unknown>,
      staged[name] as Map<string, unknown>,
      live[name] as Map<string, unknown>,
    );
  }
}
