import type { DataStore } from "@/ports/data-store";
import { cloneTables, createEmptyTables, type Tables } from "./tables";
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
 * `transact` stages a full deep clone of the tables (`cloneTables`), runs
 * the callback against a second `MemoryDataStore` bound to that staged
 * clone, and — only if the callback resolves — commits by copying every
 * staged table reference onto this store's own `tables` container (which
 * every repo already holds a live reference to, so the swap is visible
 * everywhere immediately). A throw inside the callback simply never reaches
 * the commit line, so the staged clone is discarded and this store's
 * `tables` are untouched.
 *
 * Top-level `transact` calls on the same store instance are serialized
 * through a promise-chained mutex, so two overlapping `transact` calls never
 * interleave their read-modify-write sequences or race on commit — the
 * second one's staged clone is always taken *after* the first one has fully
 * committed (or discarded). A `transact` called from inside another
 * `transact`'s callback (i.e. on the `tx` view it was handed, which is
 * marked `isTransactional`) reuses that same transaction instead of staging
 * a second layer.
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
      const staged = cloneTables(this.tables);
      const txStore = new MemoryDataStore(staged, true);
      const result = await fn(txStore);
      // Commit: replace every table on this store's own container with the
      // staged (mutated) version. Every repo holds a live reference to
      // `this.tables`, so this is visible to them immediately.
      Object.assign(this.tables, staged);
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
