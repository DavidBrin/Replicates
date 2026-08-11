/**
 * The in-memory `Store`.
 *
 * `Map`-backed, and the default adapter: with an empty environment the whole
 * app runs against this. It is honest about what it is — per process, lost on
 * restart, and per *function instance* once deployed, which is why it is never
 * the production store (DECISIONS D13).
 *
 * Three things here are load-bearing rather than stylistic:
 *
 * - **Every read returns a `structuredClone`.** A caller that mutates a
 *   returned `Page` must not be able to change what the next reader sees.
 * - **No mutating method contains an `await`.** An `async` function with no
 *   suspension point runs to completion before any other task gets the event
 *   loop, so two overlapping `reserveBlocks` calls resolve to exactly one
 *   winner with no lock. Adding an `await` between the availability check and
 *   the write would silently break that.
 * - **`transact` commits a per-key diff**, not a whole-table replace. See
 *   `applyTableDiff`.
 *
 * The table shapes deliberately mirror the Postgres schema one-for-one — a
 * per-block ownership map and one hold row per order — so that the shared
 * contract suite is testing the same model twice rather than two models that
 * happen to agree on the cases someone thought to write down.
 */

import type {
  Claim,
  Hold,
  LedgerEntry,
  Order,
  OrderStatus,
  Page,
  ProcessedEvent,
  User,
} from "@/domain/entities";
import {
  eachBlock,
  rectWithin,
  rectsOverlap,
  type BlockRect,
} from "@/domain/geometry";
import type { Cents } from "@/domain/money";
import type { Store } from "@/ports";

/* ---------------------------------------------------------------- tables -- */

interface Tables {
  users: Map<string, User>;
  pages: Map<string, Page>;
  claims: Map<string, Claim>;
  /**
   * `blockKey(pageId, bx, by)` -> claimId. One row per owned block, mirroring
   * the Postgres `blocks` table whose `PRIMARY KEY (page_id, bx, by)` is what
   * makes a double claim structurally impossible.
   */
  blocks: Map<string, string>;
  /** One hold per order, keyed by `orderId` — the same key Postgres uses. */
  holds: Map<string, Hold>;
  orders: Map<string, Order>;
  ledger: Map<string, LedgerEntry>;
  events: Map<string, ProcessedEvent>;
}

function createEmptyTables(): Tables {
  return {
    users: new Map(),
    pages: new Map(),
    claims: new Map(),
    blocks: new Map(),
    holds: new Map(),
    orders: new Map(),
    ledger: new Map(),
    events: new Map(),
  };
}

/**
 * `#` cannot appear in an id or a slug (ids are `prefix_nanoid`, slugs are
 * `[a-z0-9-]`), so the key is unambiguous without escaping.
 */
function blockKey(pageId: string, bx: number, by: number): string {
  return `${pageId}#${bx}:${by}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/* ------------------------------------------------------------ commit diff -- */

/**
 * Structural equality over the value shapes our entities are built from:
 * primitives, arrays, and plain objects. Used only to decide whether a row
 * actually changed during a transaction — every stored date is an ISO string,
 * so there is no `Date` case to handle.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
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
  baseline: ReadonlyMap<string, unknown>,
  staged: ReadonlyMap<string, unknown>,
  live: Map<string, unknown>,
): void {
  for (const key of baseline.keys()) {
    if (!staged.has(key)) live.delete(key);
  }
  for (const [key, value] of staged) {
    if (!baseline.has(key) || !deepEqual(baseline.get(key), value)) live.set(key, value);
  }
}

/**
 * Commit a transaction by applying only the rows it actually added, changed or
 * deleted between `baseline` (the snapshot taken at its start) and `staged`
 * (that snapshot after the callback ran).
 *
 * A whole-table replace would be shorter and wrong: the transaction's stale
 * copy of a row it never touched would stomp a bare write made to that row
 * while the transaction was in flight. The diff never writes rows the
 * transaction did not touch, so that concurrent write survives.
 */
function applyTableDiff(baseline: Tables, staged: Tables, live: Tables): void {
  for (const name of Object.keys(staged) as (keyof Tables)[]) {
    applyMapDiff(
      baseline[name] as ReadonlyMap<string, unknown>,
      staged[name] as ReadonlyMap<string, unknown>,
      live[name] as Map<string, unknown>,
    );
  }
}

/* --------------------------------------------------------------- helpers -- */

const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "paid",
  "expired",
  "cancelled",
]);

/** A hold is live strictly before its expiry; at `expiresAt` it reads as absent. */
function isHoldLive(hold: Hold, nowMs: number): boolean {
  return Date.parse(hold.expiresAt) > nowMs;
}


/** Every list this store returns is oldest-first, `id` breaking ties. */
function byCreation<T extends { readonly createdAt: string; readonly id: string }>(
  a: T,
  b: T,
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Thrown where Postgres would reject a duplicate primary key or unique index.
 * The memory adapter enforces the same constraints so that a service which
 * double-inserts fails identically under both drivers instead of only in
 * production.
 */
function duplicate(what: string, key: string): Error {
  return new Error(`duplicate ${what}: ${key}`);
}

/* ----------------------------------------------------------------- store -- */

export class MemoryStore implements Store {
  private readonly tables: Tables;
  private readonly isTransactional: boolean;
  /** Only meaningful on a root (non-transactional) instance. */
  private mutex: Promise<unknown> = Promise.resolve();

  constructor(tables: Tables = createEmptyTables(), isTransactional = false) {
    this.tables = tables;
    this.isTransactional = isTransactional;
  }

  /* ------------------------------------------------------------- users -- */

  async getUser(id: string): Promise<User | undefined> {
    const user = this.tables.users.get(id);
    return user && clone(user);
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    const wanted = handle.toLowerCase();
    for (const user of this.tables.users.values()) {
      if (user.handle.toLowerCase() === wanted) return clone(user);
    }
    return undefined;
  }

  async createUser(user: User): Promise<User> {
    if (this.tables.users.has(user.id)) throw duplicate("user", user.id);
    if (await this.getUserByHandle(user.handle)) throw duplicate("handle", user.handle);
    this.tables.users.set(user.id, clone(user));
    return clone(user);
  }

  /* ------------------------------------------------------------- pages -- */

  async getPage(id: string): Promise<Page | undefined> {
    const page = this.tables.pages.get(id);
    return page && clone(page);
  }

  async getPageBySlug(slug: string): Promise<Page | undefined> {
    for (const page of this.tables.pages.values()) {
      if (page.slug === slug) return clone(page);
    }
    return undefined;
  }

  async listPages(opts?: { listedOnly?: boolean }): Promise<Page[]> {
    // Listed means flagship and premium. A private page is unlisted, not
    // access-controlled: reachable by link, absent from the directory (SPEC §4).
    const all = [...this.tables.pages.values()];
    const kept = opts?.listedOnly ? all.filter((p) => p.kind !== "private") : all;
    return kept.sort(byCreation).map(clone);
  }

  async listPagesByOwner(ownerId: string): Promise<Page[]> {
    return [...this.tables.pages.values()]
      .filter((p) => p.ownerId === ownerId)
      .sort(byCreation)
      .map(clone);
  }

  async createPage(page: Page): Promise<Page> {
    if (this.tables.pages.has(page.id)) throw duplicate("page", page.id);
    if (await this.getPageBySlug(page.slug)) throw duplicate("slug", page.slug);
    this.tables.pages.set(page.id, clone(page));
    return clone(page);
  }

  async consumeAllowance(pageId: string, n: number): Promise<boolean> {
    const page = this.tables.pages.get(pageId);
    if (!page) return false;
    if (!Number.isInteger(n) || n < 0) return false;
    if (page.allowanceUsed + n > page.allowanceTotal) return false;
    this.tables.pages.set(pageId, { ...page, allowanceUsed: page.allowanceUsed + n });
    return true;
  }

  /* ------------------------------------------------------------ claims -- */

  async getClaim(id: string): Promise<Claim | undefined> {
    const claim = this.tables.claims.get(id);
    return claim && clone(claim);
  }

  async listClaims(pageId: string): Promise<Claim[]> {
    return [...this.tables.claims.values()]
      .filter((c) => c.pageId === pageId)
      .sort(byCreation)
      .map(clone);
  }

  async listClaimsByOwner(ownerId: string): Promise<Claim[]> {
    return [...this.tables.claims.values()]
      .filter((c) => c.ownerId === ownerId)
      .sort(byCreation)
      .map(clone);
  }

  async countOwnedBlocks(pageId: string): Promise<number> {
    // Counts block rows rather than summing claim rects, so it reports what
    // ownership actually says — the same thing `count(*) from blocks` reports.
    const prefix = `${pageId}#`;
    let n = 0;
    for (const key of this.tables.blocks.keys()) {
      if (key.startsWith(prefix)) n += 1;
    }
    return n;
  }

  /* ------------------------------------------------- holds and claiming -- */

  async reserveBlocks(
    pageId: string,
    rect: BlockRect,
    orderId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    const nowMs = now.getTime();
    if (!this.isFree(pageId, rect, nowMs, orderId)) return false;

    // One hold per order: a retry with a different rect replaces the previous
    // reservation rather than accumulating a second one.
    this.tables.holds.set(orderId, {
      orderId,
      pageId,
      rect: { ...rect },
      expiresAt: expiresAt.toISOString(),
    });
    this.sweepExpired(pageId, nowMs);
    return true;
  }

  async releaseHold(orderId: string): Promise<void> {
    this.tables.holds.delete(orderId);
  }

  async getHold(orderId: string): Promise<Hold | undefined> {
    // Returned as stored, expired or not. Expiry is a read-time judgement the
    // caller makes against its own clock (DECISIONS D9); there is no `now`
    // here to make it with.
    const hold = this.tables.holds.get(orderId);
    return hold && clone(hold);
  }

  async listHolds(pageId: string): Promise<Hold[]> {
    // Unfiltered, so one snapshot's notion of "now" governs every hold in it.
    // Rows a reserve or claim on this page has already swept are gone — that
    // is the same thing as expired to every reader, which is why the sweep is
    // allowed to be opportunistic (DECISIONS D9).
    return [...this.tables.holds.values()]
      .filter((h) => h.pageId === pageId)
      .sort((a, b) =>
        a.expiresAt === b.expiresAt
          ? a.orderId.localeCompare(b.orderId)
          : a.expiresAt < b.expiresAt
            ? -1
            : 1,
      )
      .map(clone);
  }

  async claimBlocks(claim: Claim, now: Date): Promise<boolean> {
    const nowMs = now.getTime();
    const hold = this.tables.holds.get(claim.orderId);
    if (!hold) return false;
    if (hold.pageId !== claim.pageId) return false;
    if (!isHoldLive(hold, nowMs)) return false;
    // A claim may only take blocks its own order reserved. Without this an
    // order could hold one block and settle over a thousand.
    if (!rectWithin(claim.rect, hold.rect)) return false;
    for (const { bx, by } of eachBlock(claim.rect)) {
      if (this.tables.blocks.has(blockKey(claim.pageId, bx, by))) return false;
    }
    if (this.tables.claims.has(claim.id)) throw duplicate("claim", claim.id);

    this.tables.claims.set(claim.id, clone(claim));
    for (const { bx, by } of eachBlock(claim.rect)) {
      this.tables.blocks.set(blockKey(claim.pageId, bx, by), claim.id);
    }
    this.tables.holds.delete(claim.orderId);
    this.sweepExpired(claim.pageId, nowMs);
    return true;
  }

  async isRectAvailable(
    pageId: string,
    rect: BlockRect,
    now: Date,
    ignoreOrderId?: string,
  ): Promise<boolean> {
    return this.isFree(pageId, rect, now.getTime(), ignoreOrderId);
  }

  /** Owned blocks and live foreign holds both block; expired holds do not. */
  private isFree(
    pageId: string,
    rect: BlockRect,
    nowMs: number,
    ignoreOrderId?: string,
  ): boolean {
    for (const { bx, by } of eachBlock(rect)) {
      if (this.tables.blocks.has(blockKey(pageId, bx, by))) return false;
    }
    for (const hold of this.tables.holds.values()) {
      if (hold.pageId !== pageId) continue;
      if (hold.orderId === ignoreOrderId) continue;
      if (!isHoldLive(hold, nowMs)) continue;
      if (rectsOverlap(hold.rect, rect)) return false;
    }
    return true;
  }

  /**
   * Drop this page's dead hold rows. Nothing sweeps on a timer (DECISIONS D9)
   * — correctness comes from the read-time expiry check above, and this only
   * stops the table growing forever.
   */
  private sweepExpired(pageId: string, nowMs: number): void {
    for (const [orderId, hold] of this.tables.holds) {
      if (hold.pageId === pageId && !isHoldLive(hold, nowMs)) {
        this.tables.holds.delete(orderId);
      }
    }
  }

  /* ------------------------------------------------------------ orders -- */

  async getOrder(id: string): Promise<Order | undefined> {
    const order = this.tables.orders.get(id);
    return order && clone(order);
  }

  async listOrdersByBuyer(buyerId: string): Promise<Order[]> {
    return [...this.tables.orders.values()]
      .filter((o) => o.buyerId === buyerId)
      .sort(byCreation)
      .map(clone);
  }

  async createOrder(order: Order): Promise<Order> {
    if (this.tables.orders.has(order.id)) throw duplicate("order", order.id);
    this.tables.orders.set(order.id, clone(order));
    return clone(order);
  }

  async updateOrderStatus(
    id: string,
    status: OrderStatus,
    patch?: { providerRef?: string; settledAt?: string; pageId?: string },
  ): Promise<Order | undefined> {
    const order = this.tables.orders.get(id);
    if (!order) return undefined;
    // Terminal states never transition (SPEC §6). `paid` -> `paid` is refused
    // here too: the caller reads the order first and decides whether a repeat
    // settlement is an idempotent success or a different payment for the same
    // order, which is an error (DECISIONS D17).
    if (TERMINAL.has(order.status)) return undefined;
    const next: Order = {
      ...order,
      status,
      providerRef: patch?.providerRef ?? order.providerRef,
      settledAt: patch?.settledAt ?? order.settledAt,
      pageId: patch?.pageId ?? order.pageId,
    };
    this.tables.orders.set(id, next);
    return clone(next);
  }

  async setOrderProviderRef(id: string, providerRef: string): Promise<Order | undefined> {
    const order = this.tables.orders.get(id);
    if (!order) return undefined;
    const next: Order = { ...order, providerRef };
    this.tables.orders.set(id, next);
    return clone(next);
  }

  /* ------------------------------------------------------------ ledger -- */

  async appendLedger(entries: readonly LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      if (this.tables.ledger.has(entry.id)) throw duplicate("ledger entry", entry.id);
      this.tables.ledger.set(entry.id, clone(entry));
    }
  }

  async listLedgerFor(recipientId: string): Promise<LedgerEntry[]> {
    return [...this.tables.ledger.values()]
      .filter((e) => e.recipientId === recipientId)
      .sort(byCreation)
      .map(clone);
  }

  async balanceFor(recipientId: string): Promise<Cents> {
    let total = 0;
    for (const entry of this.tables.ledger.values()) {
      if (entry.recipientId === recipientId) total += entry.amountCents;
    }
    return total;
  }

  /* ------------------------------------------------------------ events -- */

  async markEventProcessed(event: ProcessedEvent): Promise<boolean> {
    if (this.tables.events.has(event.id)) return false;
    this.tables.events.set(event.id, clone(event));
    return true;
  }

  /* ---------------------------------------------------------- transact -- */

  async transact<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.isTransactional) {
      // Nested: join the transaction already in progress rather than staging a
      // second layer, so the inner writes commit or roll back with the outer.
      return fn(this);
    }

    const run = async (): Promise<T> => {
      const baseline = clone(this.tables);
      const staged = clone(this.tables);
      const result = await fn(new MemoryStore(staged, true));
      // Reached only if the callback resolved; a throw skips it and both
      // clones are discarded with the live tables untouched.
      applyTableDiff(baseline, staged, this.tables);
      return result;
    };

    // Serialize root transactions: the next one's snapshot is taken only once
    // the previous has committed or been discarded, so two read-modify-write
    // sequences cannot interleave and lose an update.
    const scheduled = this.mutex.then(run, run);
    this.mutex = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }
}

/* -------------------------------------------------------------- registry -- */

/**
 * One process-wide registry, keyed off a `Symbol.for` on `globalThis`.
 *
 * A module-level `let` is not enough in Next 16 for two separate reasons
 * (`research/persistence-and-vercel.md` §4): Fast Refresh re-evaluates a
 * changed module and re-runs its top-level code, wiping the map mid-session;
 * and a Server Component's module graph and a Route Handler's are bundled as
 * separate layers, so the same module is instantiated twice and a page would
 * read a different store from the one its own API route wrote to. `globalThis`
 * survives both because Node resets the module cache, not the global object.
 *
 * It does not survive a second process or a second function instance, which is
 * exactly why this adapter is dev-only.
 */
const REGISTRY: unique symbol = Symbol.for("dollar-pixels.store.v1");

interface StoreRegistry {
  memory?: MemoryStore;
  /** Held here for the same reason: one connection pool, not one per reload. */
  postgres?: Store;
}

type GlobalWithRegistry = typeof globalThis & { [REGISTRY]?: StoreRegistry };

export function storeRegistry(): StoreRegistry {
  const g = globalThis as GlobalWithRegistry;
  return (g[REGISTRY] ??= {});
}

export function getMemoryStore(): MemoryStore {
  const registry = storeRegistry();
  return (registry.memory ??= new MemoryStore());
}

/** A fresh, unshared store. Tests that want isolation build one of these. */
export function createMemoryStore(): MemoryStore {
  return new MemoryStore();
}

/**
 * Drop the shared instances so the next `getStore()` builds clean ones.
 *
 * Only the memory adapter is actually discarded cleanly; a Postgres pool would
 * need awaiting, and no test runs against one.
 */
export function resetStoreForTests(): void {
  const g = globalThis as GlobalWithRegistry;
  delete g[REGISTRY];
}
