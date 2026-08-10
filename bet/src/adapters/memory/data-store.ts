import type { DataStore } from "@/ports/data-store";
import { applyTableDiff, cloneTables, createEmptyTables, type Tables } from "./tables";
import { MemoryUserRepo } from "./user-repo";
import { MemoryFriendRepo } from "./friend-repo";
import { MemoryGroupRepo } from "./group-repo";
import { MemoryMarketRepo } from "./market-repo";
import { MemoryPositionRepo } from "./position-repo";
import { MemoryTradeRepo } from "./trade-repo";
import { MemoryMessageRepo } from "./message-repo";
import { MemoryInviteRepo } from "./invite-repo";
import { MemoryNotificationRepo } from "./notification-repo";
import { MemoryPriceHistoryRepo } from "./price-history-repo";

/**
 * `Map`-backed `DataStore` implementation. Every repo read returns a
 * structural clone of stored state (`tables.ts`'s `cloneEntity`), so callers
 * can never corrupt the store by mutating a returned object.
 *
 * `transact` takes two deep clones of the tables at start: a pristine
 * `baseline` (never mutated) and a `staged` copy the callback actually reads
 * and writes through a second `MemoryDataStore`. Only if the callback
 * resolves does it commit — and it commits via a **per-key diff**
 * (`applyTableDiff`, in `tables.ts`) between `baseline` and `staged`, not by
 * replacing this store's table `Map`s wholesale. That distinction matters:
 * a whole-map replace would silently discard any bare (non-`transact`)
 * write made to *any* row — even one this transaction never touched — while
 * the transaction was in flight, because the transaction's stale snapshot
 * of that untouched row would stomp the live one on commit. The per-key
 * diff only ever writes rows this transaction actually added, changed, or
 * deleted, so a concurrent bare write to an untouched row (or an untouched
 * table entirely) survives. A throw inside the callback simply never
 * reaches the commit line, so both clones are discarded and this store's
 * `tables` are untouched.
 *
 * Top-level `transact` calls on the same store instance are still
 * serialized through a promise-chained mutex, so two overlapping `transact`
 * calls never interleave their own read-modify-write sequences or race each
 * other's commits — the second one's snapshot is always taken *after* the
 * first one has fully committed (or discarded). That mutex only orders
 * `transact` vs. `transact`; it does not (and need not) serialize against
 * bare repo calls, which is exactly the case the per-key diff exists to
 * handle correctly. A `transact` called from inside another `transact`'s
 * callback (i.e. on the `tx` view it was handed, which is marked
 * `isTransactional`) reuses that same transaction instead of staging a
 * second layer.
 */
export class MemoryDataStore implements DataStore {
  readonly users: MemoryUserRepo;
  readonly friends: MemoryFriendRepo;
  readonly groups: MemoryGroupRepo;
  readonly markets: MemoryMarketRepo;
  readonly positions: MemoryPositionRepo;
  readonly trades: MemoryTradeRepo;
  readonly messages: MemoryMessageRepo;
  readonly invites: MemoryInviteRepo;
  readonly notifications: MemoryNotificationRepo;
  readonly priceHistory: MemoryPriceHistoryRepo;

  private readonly tables: Tables;
  private readonly isTransactional: boolean;
  /** Only meaningful on a non-transactional (root) instance. */
  private mutex: Promise<unknown> = Promise.resolve();

  constructor(tables: Tables, isTransactional = false) {
    this.tables = tables;
    this.isTransactional = isTransactional;
    this.users = new MemoryUserRepo(tables);
    this.friends = new MemoryFriendRepo(tables);
    this.groups = new MemoryGroupRepo(tables);
    this.markets = new MemoryMarketRepo(tables);
    this.positions = new MemoryPositionRepo(tables);
    this.trades = new MemoryTradeRepo(tables);
    this.messages = new MemoryMessageRepo(tables);
    this.invites = new MemoryInviteRepo(tables);
    this.notifications = new MemoryNotificationRepo(tables);
    this.priceHistory = new MemoryPriceHistoryRepo(tables);
  }

  async transact<T>(fn: (tx: DataStore) => Promise<T>): Promise<T> {
    if (this.isTransactional) {
      // Nested call from inside another transact's callback: reuse this
      // same staging layer rather than cloning again.
      return fn(this);
    }

    const run = async (): Promise<T> => {
      // Two independent clones: `baseline` is never touched again (it's
      // purely the "what did this transaction start from" reference point
      // for the diff below); `staged` is what the callback actually reads
      // and writes through the transactional view.
      const baseline = cloneTables(this.tables);
      const staged = cloneTables(this.tables);
      const txStore = new MemoryDataStore(staged, true);
      const result = await fn(txStore);
      // Commit: apply only the rows this transaction actually added,
      // changed, or deleted onto this store's live tables. See the class
      // doc-comment above for why this must be a per-key diff and not a
      // whole-map replace.
      applyTableDiff(baseline, staged, this.tables);
      return result;
    };

    // Serialize root-level transact calls so overlapping transactions never
    // interleave: the next one's staged clone is only taken once the
    // previous one has fully committed or been discarded.
    const scheduled = this.mutex.then(run, run);
    this.mutex = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }
}

export function createMemoryDataStore(): DataStore {
  return new MemoryDataStore(createEmptyTables());
}
