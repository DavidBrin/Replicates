/**
 * The ports. Interfaces only — no runtime logic beyond type guards.
 *
 * Every one of these exists because the obvious direct implementation is wrong
 * somewhere that matters: the store because Vercel's filesystem loses data
 * silently, the payment provider because the fake-money path has to be the
 * same path Stripe drives, the clock and id generator because tests that
 * assert on time and identity should not be flaky.
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
import type { BlockRect } from "@/domain/geometry";
import type { Cents } from "@/domain/money";

/* ----------------------------------------------------------------- clock -- */

export interface Clock {
  now(): Date;
}

/* -------------------------------------------------------------------- id -- */

export interface IdGen {
  next(prefix: string): string;
}

/* ------------------------------------------------------------------ auth -- */

export interface SessionClaims {
  readonly userId: string;
  readonly handle: string;
}

export interface AuthProvider {
  createSession(claims: SessionClaims): Promise<string>;
  verify(token: string): Promise<SessionClaims | null>;
}

/* ----------------------------------------------------------------- store -- */

/**
 * Persistence.
 *
 * Rules every implementation must honour, and which the shared contract suite
 * checks:
 *
 * - Every method returns a Promise, even where an implementation is synchronous.
 * - A missing row reads as `undefined`. Reads never throw for absence.
 * - Reads return defensive copies. A caller mutating a result must not corrupt
 *   the store.
 * - `claimBlocks` is atomic: it either takes every block in the rect or none,
 *   and it is the ONLY way a block becomes owned.
 */
export interface Store {
  /* users */
  getUser(id: string): Promise<User | undefined>;
  getUserByHandle(handle: string): Promise<User | undefined>;
  createUser(user: User): Promise<User>;

  /* pages */
  getPage(id: string): Promise<Page | undefined>;
  getPageBySlug(slug: string): Promise<Page | undefined>;
  listPages(opts?: { listedOnly?: boolean }): Promise<Page[]>;
  listPagesByOwner(ownerId: string): Promise<Page[]>;
  createPage(page: Page): Promise<Page>;
  /** Bumps `allowanceUsed` by `n`, failing if it would exceed the total. */
  consumeAllowance(pageId: string, n: number): Promise<boolean>;

  /* claims */
  getClaim(id: string): Promise<Claim | undefined>;
  listClaims(pageId: string): Promise<Claim[]>;
  listClaimsByOwner(ownerId: string): Promise<Claim[]>;
  countOwnedBlocks(pageId: string): Promise<number>;

  /* holds and claiming */

  /**
   * Reserve every block in `rect` for `orderId` until `expiresAt`.
   *
   * Returns false and reserves nothing if any block is already owned, or held
   * by a different order whose hold has not expired. Expired holds are
   * treated as absent (DECISIONS D9).
   */
  reserveBlocks(
    pageId: string,
    rect: BlockRect,
    orderId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean>;

  /** Drop a hold. Safe to call when there is none. */
  releaseHold(orderId: string): Promise<void>;

  getHold(orderId: string): Promise<Hold | undefined>;

  /**
   * Every hold recorded against a page, expired ones included.
   *
   * The caller filters on expiry, because expiry is a read-time property and
   * two callers disagreeing about "now" would be worse than one filtering
   * twice (DECISIONS D9).
   */
  listHolds(pageId: string): Promise<Hold[]>;

  /**
   * Convert a held rect into a claim, atomically.
   *
   * Fails if the hold is gone or expired, or if any block in the rect became
   * owned in the meantime. This is the only way a block becomes owned.
   */
  claimBlocks(claim: Claim, now: Date): Promise<boolean>;

  /** True if every block in `rect` is free, treating expired holds as absent. */
  isRectAvailable(
    pageId: string,
    rect: BlockRect,
    now: Date,
    ignoreOrderId?: string,
  ): Promise<boolean>;

  /* orders */
  getOrder(id: string): Promise<Order | undefined>;
  listOrdersByBuyer(buyerId: string): Promise<Order[]>;
  createOrder(order: Order): Promise<Order>;
  /**
   * Move an order to a terminal state.
   *
   * Returns the updated order, or `undefined` if the transition was refused
   * because the order was already terminal. The caller decides whether that is
   * an idempotent success or an error.
   */
  updateOrderStatus(
    id: string,
    status: OrderStatus,
    patch?: { providerRef?: string; settledAt?: string; pageId?: string },
  ): Promise<Order | undefined>;
  setOrderProviderRef(id: string, providerRef: string): Promise<Order | undefined>;

  /* ledger */
  appendLedger(entries: readonly LedgerEntry[]): Promise<void>;
  listLedgerFor(recipientId: string): Promise<LedgerEntry[]>;
  balanceFor(recipientId: string): Promise<Cents>;

  /* provider event de-duplication */
  markEventProcessed(event: ProcessedEvent): Promise<boolean>;

  /**
   * Run `fn` atomically.
   *
   * The in-memory adapter stages a copy and commits a diff; Postgres opens a
   * transaction. Nested calls join the outer transaction rather than starting
   * a new one.
   */
  transact<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
}

/* --------------------------------------------------------------- payments -- */

export interface CheckoutLine {
  readonly label: string;
  readonly amountCents: Cents;
  readonly quantity: number;
}

export interface CheckoutInput {
  readonly orderId: string;
  readonly amountCents: Cents;
  readonly lines: readonly CheckoutLine[];
  readonly description: string;
  /** Absolute URL the provider returns the buyer to. */
  readonly returnUrl: string;
  readonly cancelUrl: string;
  readonly expiresAt: Date;
}

export interface CheckoutHandle {
  /** Where to send the buyer's browser. */
  readonly redirectUrl: string;
  /** The provider's identifier for this attempt. Stored on the order. */
  readonly ref: string;
}

/**
 * A way to take money.
 *
 * Deliberately narrow. Confirmation is NOT on this interface: both providers
 * converge on the same `fulfilment.settle(orderId, ref)`, driven by a webhook
 * under Stripe and by a button under the mock. A provider that could settle
 * orders itself would let the fake path diverge from the real one, which is
 * the exact failure this port exists to prevent (DECISIONS D10).
 */
export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  /** True when money is real. Drives the UI's play-money banner. */
  readonly isLive: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutHandle>;
  /** Best-effort early cancellation. Must not throw if the ref is unknown. */
  expire(ref: string): Promise<void>;
}
