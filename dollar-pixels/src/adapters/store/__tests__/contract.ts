/**
 * The shared `Store` contract.
 *
 * Call `runStoreContract(name, makeStore)` once per adapter. Everything here is
 * expressed through the port — no adapter type is imported and no adapter
 * internals are read — so a second implementation inherits the whole suite by
 * adding one line to a test file.
 *
 * Not itself a `*.test.ts` file, so vitest's `include` glob leaves it alone;
 * `memory.test.ts` is what invokes it.
 *
 * Every fixture creates the rows it references (a claim's owner, an order's
 * buyer, a hold's order) rather than inventing ids. The in-memory adapter would
 * not care; Postgres has foreign keys, and a suite that only passes against the
 * adapter with no constraints is not a contract.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Claim,
  LedgerEntry,
  Order,
  Page,
  ProcessedEvent,
  User,
} from "@/domain/entities";
import { rectsOverlap, type BlockRect } from "@/domain/geometry";
import type { Store } from "@/ports";

/* -------------------------------------------------------------- fixtures -- */

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

/** Slugs are `[a-z0-9-]` only, so the generated ones look like real ones. */
function slug(): string {
  seq += 1;
  return `page-${seq}`;
}

const AT = "2026-01-01T00:00:00.000Z";

/** A checkout at noon, holding its blocks for the SPEC's 30 minutes. */
const NOW = new Date("2026-01-01T12:00:00.000Z");
const EXPIRES = new Date("2026-01-01T12:30:00.000Z");
const BEFORE_EXPIRY = new Date("2026-01-01T12:29:00.000Z");
const AFTER_EXPIRY = new Date("2026-01-01T12:31:00.000Z");
const MUCH_LATER = new Date("2026-01-01T13:30:00.000Z");

function rect(bx: number, by: number, bw: number, bh: number): BlockRect {
  return { bx, by, bw, bh };
}

async function seedUser(store: Store, over: Partial<User> = {}): Promise<User> {
  return store.createUser({
    id: uid("user"),
    handle: uid("handle"),
    displayName: "Test User",
    createdAt: AT,
    ...over,
  });
}

async function seedPage(store: Store, over: Partial<Page> = {}): Promise<Page> {
  const ownerId =
    "ownerId" in over ? (over.ownerId ?? null) : (await seedUser(store)).id;
  return store.createPage({
    id: uid("page"),
    slug: slug(),
    title: "Test Page",
    kind: "premium",
    size: "small",
    allowanceTotal: 0,
    allowanceUsed: 0,
    createdAt: AT,
    ...over,
    ownerId,
  });
}

async function seedOrder(store: Store, over: Partial<Order> = {}): Promise<Order> {
  const buyerId = over.buyerId ?? (await seedUser(store)).id;
  const pageId = over.pageId ?? null;
  return store.createOrder({
    id: uid("order"),
    kind: "blocks",
    amountCents: 100,
    status: "pending",
    provider: "mock",
    providerRef: null,
    payload: {
      kind: "blocks",
      pageId: pageId ?? "unknown",
      rect: rect(0, 0, 1, 1),
      caption: "hello",
      colour: "#112233",
      tile: null,
    },
    createdAt: AT,
    settledAt: null,
    ...over,
    pageId,
    buyerId,
  });
}

function makeClaim(
  page: Page,
  ownerId: string,
  order: Order,
  r: BlockRect,
  over: Partial<Claim> = {},
): Claim {
  return {
    id: uid("claim"),
    pageId: page.id,
    ownerId,
    rect: r,
    caption: "mine",
    colour: "#d9ab22",
    tile: null,
    orderId: order.id,
    createdAt: AT,
    ...over,
  };
}

/** A buyer with a live hold over `r` — the state a checkout leaves behind. */
async function reserveFor(
  store: Store,
  page: Page,
  r: BlockRect,
  opts: { now?: Date; expiresAt?: Date } = {},
): Promise<{ user: User; order: Order; reserved: boolean }> {
  const user = await seedUser(store);
  const order = await seedOrder(store, { buyerId: user.id, pageId: page.id });
  const reserved = await store.reserveBlocks(
    page.id,
    r,
    order.id,
    opts.expiresAt ?? EXPIRES,
    opts.now ?? NOW,
  );
  return { user, order, reserved };
}

function makeLedgerEntry(
  order: Order,
  recipientId: string | null,
  amountCents: number,
  over: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id: uid("ledger"),
    orderId: order.id,
    pageId: order.pageId,
    recipientId,
    amountCents,
    kind: "block_sale",
    createdAt: AT,
    ...over,
  };
}

function makeEvent(over: Partial<ProcessedEvent> = {}): ProcessedEvent {
  return {
    id: uid("evt"),
    provider: "stripe",
    receivedAt: AT,
    ...over,
  };
}

/* ------------------------------------------------------------- the suite -- */

export function runStoreContract(
  name: string,
  makeStore: () => Store | Promise<Store>,
): void {
  describe(`Store contract: ${name}`, () => {
    /* ------------------------------------------------------- absence -- */

    it("absent reads answer with undefined or an empty result, never a throw", async () => {
      const store = await makeStore();
      await expect(store.getUser("nope")).resolves.toBeUndefined();
      await expect(store.getUserByHandle("nobody")).resolves.toBeUndefined();
      await expect(store.getPage("nope")).resolves.toBeUndefined();
      await expect(store.getPageBySlug("nope")).resolves.toBeUndefined();
      await expect(store.getClaim("nope")).resolves.toBeUndefined();
      await expect(store.getOrder("nope")).resolves.toBeUndefined();
      await expect(store.getHold("nope")).resolves.toBeUndefined();
      await expect(store.listPages()).resolves.toEqual([]);
      await expect(store.listPagesByOwner("nope")).resolves.toEqual([]);
      await expect(store.listClaims("nope")).resolves.toEqual([]);
      await expect(store.listClaimsByOwner("nope")).resolves.toEqual([]);
      await expect(store.listHolds("nope")).resolves.toEqual([]);
      await expect(store.listOrdersByBuyer("nope")).resolves.toEqual([]);
      await expect(store.listLedgerFor("nope")).resolves.toEqual([]);
      await expect(store.countOwnedBlocks("nope")).resolves.toBe(0);
      await expect(store.balanceFor("nope")).resolves.toBe(0);
      await expect(store.consumeAllowance("nope", 1)).resolves.toBe(false);
      await expect(store.releaseHold("nope")).resolves.toBeUndefined();
    });

    /* --------------------------------------------------------- users -- */

    it("creates a user and reads it back by id and by handle", async () => {
      const store = await makeStore();
      const user = await seedUser(store, { handle: "davidb", displayName: "David B" });

      await expect(store.getUser(user.id)).resolves.toEqual(user);
      await expect(store.getUserByHandle("davidb")).resolves.toEqual(user);
      // Handles are the identity people type. Two that differ only in case are
      // the same handle, in both directions.
      await expect(store.getUserByHandle("DavidB")).resolves.toEqual(user);
    });

    it("refuses a duplicate user id", async () => {
      const store = await makeStore();
      const user = await seedUser(store);
      await expect(seedUser(store, { id: user.id })).rejects.toThrow();
    });

    it("mutating a returned entity does not corrupt the store", async () => {
      const store = await makeStore();
      const user = await seedUser(store, { displayName: "Original" });

      const fetched = await store.getUser(user.id);
      expect(fetched).toBeDefined();
      if (!fetched) throw new Error("unreachable");
      (fetched as { displayName: string }).displayName = "MUTATED";

      await expect(store.getUser(user.id)).resolves.toMatchObject({
        displayName: "Original",
      });
    });

    /* --------------------------------------------------------- pages -- */

    it("creates a page and reads it back by id and by slug", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { slug: "the-wall", title: "The Wall" });

      await expect(store.getPage(page.id)).resolves.toEqual(page);
      await expect(store.getPageBySlug("the-wall")).resolves.toEqual(page);
    });

    it("refuses a duplicate slug", async () => {
      const store = await makeStore();
      await seedPage(store, { slug: "taken" });
      await expect(seedPage(store, { slug: "taken" })).rejects.toThrow();
    });

    it("listPages({ listedOnly }) hides private pages and nothing else", async () => {
      const store = await makeStore();
      const owner = await seedUser(store);
      const flagship = await seedPage(store, { kind: "flagship", ownerId: null });
      const premium = await seedPage(store, { kind: "premium", ownerId: owner.id });
      const priv = await seedPage(store, {
        kind: "private",
        ownerId: owner.id,
        allowanceTotal: 69,
      });

      const all = await store.listPages();
      expect(all.map((p) => p.id).sort()).toEqual(
        [flagship.id, premium.id, priv.id].sort(),
      );

      // A private page is unlisted, not access-controlled: absent from the
      // directory, still reachable by slug (SPEC §4).
      const listed = await store.listPages({ listedOnly: true });
      expect(listed.map((p) => p.id).sort()).toEqual([flagship.id, premium.id].sort());
      await expect(store.getPageBySlug(priv.slug)).resolves.toBeDefined();
    });

    it("lists a user's own pages", async () => {
      const store = await makeStore();
      const owner = await seedUser(store);
      const mine = await seedPage(store, { ownerId: owner.id });
      await seedPage(store);

      const listed = await store.listPagesByOwner(owner.id);
      expect(listed.map((p) => p.id)).toEqual([mine.id]);
    });

    /* ----------------------------------------------------- allowance -- */

    it("consumes the allowance up to the boundary and refuses the block after it", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { kind: "private", allowanceTotal: 69 });

      await expect(store.consumeAllowance(page.id, 60)).resolves.toBe(true);
      await expect(store.consumeAllowance(page.id, 9)).resolves.toBe(true);
      await expect(store.getPage(page.id)).resolves.toMatchObject({
        allowanceUsed: 69,
      });

      await expect(store.consumeAllowance(page.id, 1)).resolves.toBe(false);
      await expect(store.getPage(page.id)).resolves.toMatchObject({
        allowanceUsed: 69,
      });
    });

    it("a request larger than the whole remaining allowance consumes nothing", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { kind: "private", allowanceTotal: 69 });

      await expect(store.consumeAllowance(page.id, 70)).resolves.toBe(false);
      await expect(store.getPage(page.id)).resolves.toMatchObject({ allowanceUsed: 0 });
      await expect(store.consumeAllowance(page.id, 69)).resolves.toBe(true);
    });

    it("a page with no allowance grants none", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { kind: "premium", allowanceTotal: 0 });
      await expect(store.consumeAllowance(page.id, 1)).resolves.toBe(false);
      await expect(store.consumeAllowance(page.id, 0)).resolves.toBe(true);
    });

    /* -------------------------------------------- reserve/claim path -- */

    it("reserve, hold, claim: the whole happy path", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(4, 4, 3, 2);

      await expect(store.isRectAvailable(page.id, r, NOW)).resolves.toBe(true);

      const { user, order, reserved } = await reserveFor(store, page, r);
      expect(reserved).toBe(true);

      await expect(store.getHold(order.id)).resolves.toEqual({
        orderId: order.id,
        pageId: page.id,
        rect: r,
        expiresAt: EXPIRES.toISOString(),
      });
      // Held by someone: unavailable to everyone except that order.
      await expect(store.isRectAvailable(page.id, r, NOW)).resolves.toBe(false);
      await expect(store.isRectAvailable(page.id, r, NOW, order.id)).resolves.toBe(true);
      await expect(store.countOwnedBlocks(page.id)).resolves.toBe(0);

      const claim = makeClaim(page, user.id, order, r);
      await expect(store.claimBlocks(claim, BEFORE_EXPIRY)).resolves.toBe(true);

      await expect(store.getClaim(claim.id)).resolves.toEqual(claim);
      await expect(store.listClaims(page.id)).resolves.toEqual([claim]);
      await expect(store.listClaimsByOwner(user.id)).resolves.toEqual([claim]);
      await expect(store.countOwnedBlocks(page.id)).resolves.toBe(6);
      // The hold is consumed by the claim, and the blocks are now owned, so
      // even the order that held them cannot have them again.
      await expect(store.getHold(order.id)).resolves.toBeUndefined();
      await expect(store.isRectAvailable(page.id, r, NOW, order.id)).resolves.toBe(false);
    });

    it("refuses to reserve any block that is already owned", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const owned = rect(0, 0, 2, 2);
      const { user, order } = await reserveFor(store, page, owned);
      await store.claimBlocks(makeClaim(page, user.id, order, owned), NOW);

      // Overlaps by exactly one block, at (1,1).
      const overlapping = rect(1, 1, 3, 3);
      const second = await reserveFor(store, page, overlapping);
      expect(second.reserved).toBe(false);
      // All-or-nothing: the blocks it could have had are untouched, so the
      // clear part of the rectangle is still free for anyone else.
      await expect(store.getHold(second.order.id)).resolves.toBeUndefined();
      await expect(store.isRectAvailable(page.id, rect(2, 2, 2, 2), NOW)).resolves.toBe(
        true,
      );
    });

    it("refuses to reserve blocks under another order's live hold", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const first = await reserveFor(store, page, rect(0, 0, 4, 4));
      expect(first.reserved).toBe(true);

      const second = await reserveFor(store, page, rect(3, 3, 4, 4));
      expect(second.reserved).toBe(false);
      await expect(store.getHold(second.order.id)).resolves.toBeUndefined();
    });

    it("allows a reservation where the blocking hold has expired", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(0, 0, 4, 4);
      const first = await reserveFor(store, page, r);
      expect(first.reserved).toBe(true);

      // Nothing swept the hold. It stops blocking because the reader's clock
      // moved past it, which is the whole of DECISIONS D9.
      const second = await seedOrder(store, { pageId: page.id });
      await expect(
        store.reserveBlocks(page.id, r, second.id, MUCH_LATER, AFTER_EXPIRY),
      ).resolves.toBe(true);
      await expect(store.getHold(second.id)).resolves.toMatchObject({ rect: r });
    });

    it("re-reserving for the same order is idempotent", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(2, 2, 2, 2);
      const order = await seedOrder(store, { pageId: page.id });

      // A client that retries a checkout must not be told its own blocks are
      // taken.
      await expect(store.reserveBlocks(page.id, r, order.id, EXPIRES, NOW)).resolves.toBe(
        true,
      );
      await expect(store.reserveBlocks(page.id, r, order.id, EXPIRES, NOW)).resolves.toBe(
        true,
      );
      await expect(store.getHold(order.id)).resolves.toMatchObject({ rect: r });
    });

    it("re-reserving a different rect for the same order replaces the hold", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const order = await seedOrder(store, { pageId: page.id });
      await store.reserveBlocks(page.id, rect(0, 0, 2, 2), order.id, EXPIRES, NOW);
      await store.reserveBlocks(page.id, rect(8, 8, 2, 2), order.id, EXPIRES, NOW);

      await expect(store.getHold(order.id)).resolves.toMatchObject({
        rect: rect(8, 8, 2, 2),
      });
      // The abandoned rectangle is free again rather than held until it expires.
      await expect(
        store.isRectAvailable(page.id, rect(0, 0, 2, 2), NOW),
      ).resolves.toBe(true);
    });

    it("releasing a hold frees the blocks immediately", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(1, 1, 2, 2);
      const { order } = await reserveFor(store, page, r);

      await store.releaseHold(order.id);
      await expect(store.getHold(order.id)).resolves.toBeUndefined();
      await expect(store.isRectAvailable(page.id, r, NOW)).resolves.toBe(true);

      const next = await reserveFor(store, page, r);
      expect(next.reserved).toBe(true);
    });

    it("refuses a claim once the hold has expired", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(0, 0, 2, 2);
      const { user, order } = await reserveFor(store, page, r);

      const claim = makeClaim(page, user.id, order, r);
      await expect(store.claimBlocks(claim, AFTER_EXPIRY)).resolves.toBe(false);
      await expect(store.getClaim(claim.id)).resolves.toBeUndefined();
      await expect(store.countOwnedBlocks(page.id)).resolves.toBe(0);
    });

    it("refuses a claim with no hold at all", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const user = await seedUser(store);
      const order = await seedOrder(store, { buyerId: user.id, pageId: page.id });

      const claim = makeClaim(page, user.id, order, rect(0, 0, 1, 1));
      await expect(store.claimBlocks(claim, NOW)).resolves.toBe(false);
      await expect(store.countOwnedBlocks(page.id)).resolves.toBe(0);
    });

    it("refuses a claim for blocks outside the rect the order reserved", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const { user, order } = await reserveFor(store, page, rect(0, 0, 2, 2));

      // Held four blocks, tried to settle nine.
      const claim = makeClaim(page, user.id, order, rect(0, 0, 3, 3));
      await expect(store.claimBlocks(claim, NOW)).resolves.toBe(false);
      await expect(store.countOwnedBlocks(page.id)).resolves.toBe(0);
    });

    it("refuses a claim whose blocks another order took first", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(5, 5, 2, 2);
      const slow = await reserveFor(store, page, r);
      expect(slow.reserved).toBe(true);

      // The slow buyer's hold lapses, someone else takes the blocks, and the
      // slow buyer's payment finally lands. Whether the refusal comes from the
      // lapsed hold or from the ownership check, `claimBlocks` is the only way
      // a block becomes owned and it must not sell this one twice.
      const quick = await reserveFor(store, page, r, {
        now: AFTER_EXPIRY,
        expiresAt: MUCH_LATER,
      });
      expect(quick.reserved).toBe(true);
      await expect(
        store.claimBlocks(makeClaim(page, quick.user.id, quick.order, r), AFTER_EXPIRY),
      ).resolves.toBe(true);

      await expect(
        store.claimBlocks(makeClaim(page, slow.user.id, slow.order, r), AFTER_EXPIRY),
      ).resolves.toBe(false);
      await expect(store.countOwnedBlocks(page.id)).resolves.toBe(4);
      await expect(store.listClaims(page.id)).resolves.toHaveLength(1);
    });

    it("isRectAvailable treats an expired hold as absent", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const r = rect(0, 0, 3, 3);
      await reserveFor(store, page, r);

      await expect(store.isRectAvailable(page.id, r, BEFORE_EXPIRY)).resolves.toBe(false);
      await expect(store.isRectAvailable(page.id, r, AFTER_EXPIRY)).resolves.toBe(true);
      // The boundary belongs to the expired side: a hold is live strictly
      // before its expiry.
      await expect(store.isRectAvailable(page.id, r, EXPIRES)).resolves.toBe(true);
    });

    it("isRectAvailable only reports overlapping holds", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      await reserveFor(store, page, rect(0, 0, 2, 2));

      await expect(store.isRectAvailable(page.id, rect(2, 0, 2, 2), NOW)).resolves.toBe(
        true,
      );
      await expect(store.isRectAvailable(page.id, rect(1, 1, 2, 2), NOW)).resolves.toBe(
        false,
      );
    });

    it("listHolds returns every hold on the page, expired ones included", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const other = await seedPage(store);

      const live = await reserveFor(store, page, rect(0, 0, 2, 2), {
        expiresAt: MUCH_LATER,
      });
      const stale = await reserveFor(store, page, rect(6, 6, 2, 2), {
        expiresAt: EXPIRES,
      });
      const elsewhere = await reserveFor(store, other, rect(0, 0, 2, 2));

      // Unfiltered by design: the grid snapshot applies one notion of "now" to
      // every hold in it, rather than each read applying its own.
      const holds = await store.listHolds(page.id);
      expect(holds.map((h) => h.orderId).sort()).toEqual(
        [live.order.id, stale.order.id].sort(),
      );
      expect(holds.map((h) => h.orderId)).not.toContain(elsewhere.order.id);

      // Same store, same rows, opposite answer — because `isRectAvailable` is
      // the one that has a clock.
      await expect(
        store.isRectAvailable(page.id, rect(6, 6, 2, 2), AFTER_EXPIRY),
      ).resolves.toBe(true);
    });

    /* -------------------------------------------------------- orders -- */

    it("creates an order and lists it for its buyer", async () => {
      const store = await makeStore();
      const buyer = await seedUser(store);
      const page = await seedPage(store);
      const order = await seedOrder(store, { buyerId: buyer.id, pageId: page.id });
      await seedOrder(store, { pageId: page.id });

      await expect(store.getOrder(order.id)).resolves.toEqual(order);
      const listed = await store.listOrdersByBuyer(buyer.id);
      expect(listed.map((o) => o.id)).toEqual([order.id]);
    });

    it("settles a pending order and then refuses every further transition", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const order = await seedOrder(store, { pageId: page.id });

      const paid = await store.updateOrderStatus(order.id, "paid", {
        providerRef: "cs_test_123",
        settledAt: "2026-01-01T12:05:00.000Z",
      });
      expect(paid).toMatchObject({
        status: "paid",
        providerRef: "cs_test_123",
        settledAt: "2026-01-01T12:05:00.000Z",
      });

      // Terminal states never transition. `undefined` is not an error here —
      // it is the store declining to decide whether this is a duplicate
      // webhook or a second payment, which the caller settles (DECISIONS D17).
      await expect(store.updateOrderStatus(order.id, "paid")).resolves.toBeUndefined();
      await expect(
        store.updateOrderStatus(order.id, "cancelled"),
      ).resolves.toBeUndefined();
      await expect(store.getOrder(order.id)).resolves.toMatchObject({ status: "paid" });
    });

    it("expires and cancels a pending order, and refuses an unknown one", async () => {
      const store = await makeStore();
      const expired = await store.updateOrderStatus(
        (await seedOrder(store)).id,
        "expired",
      );
      expect(expired).toMatchObject({ status: "expired" });

      const cancelled = await store.updateOrderStatus(
        (await seedOrder(store)).id,
        "cancelled",
      );
      expect(cancelled).toMatchObject({ status: "cancelled" });

      await expect(store.updateOrderStatus("nope", "paid")).resolves.toBeUndefined();
    });

    it("records a provider reference against an order", async () => {
      const store = await makeStore();
      const order = await seedOrder(store);

      const updated = await store.setOrderProviderRef(order.id, "cs_test_abc");
      expect(updated).toMatchObject({ providerRef: "cs_test_abc", status: "pending" });
      await expect(store.getOrder(order.id)).resolves.toMatchObject({
        providerRef: "cs_test_abc",
      });
      await expect(store.setOrderProviderRef("nope", "x")).resolves.toBeUndefined();
    });

    /* -------------------------------------------------------- ledger -- */

    it("appends ledger entries and totals a recipient's balance", async () => {
      const store = await makeStore();
      const creator = await seedUser(store);
      const other = await seedUser(store);
      const page = await seedPage(store, { ownerId: creator.id });
      const order = await seedOrder(store, { pageId: page.id });

      await store.appendLedger([]);
      await store.appendLedger([
        makeLedgerEntry(order, creator.id, 100),
        makeLedgerEntry(order, creator.id, 900),
        makeLedgerEntry(order, other.id, 50),
        // Platform revenue has no recipient, so it belongs to nobody's balance.
        makeLedgerEntry(order, null, 250, { kind: "platform_fee" }),
      ]);

      await expect(store.balanceFor(creator.id)).resolves.toBe(1000);
      await expect(store.listLedgerFor(creator.id)).resolves.toHaveLength(2);
      await expect(store.balanceFor(other.id)).resolves.toBe(50);

      // A correction is a new negative entry, never an edit.
      await store.appendLedger([
        makeLedgerEntry(order, creator.id, -400, { kind: "block_sale" }),
      ]);
      await expect(store.balanceFor(creator.id)).resolves.toBe(600);
      await expect(store.listLedgerFor(creator.id)).resolves.toHaveLength(3);
    });

    /* -------------------------------------------------------- events -- */

    it("marks a provider event processed exactly once", async () => {
      const store = await makeStore();
      const event = makeEvent();

      // The whole of webhook idempotency: the second delivery of an event is
      // told it is the second.
      await expect(store.markEventProcessed(event)).resolves.toBe(true);
      await expect(store.markEventProcessed(event)).resolves.toBe(false);
      await expect(
        store.markEventProcessed({ ...event, receivedAt: "2026-01-02T00:00:00.000Z" }),
      ).resolves.toBe(false);
      await expect(store.markEventProcessed(makeEvent())).resolves.toBe(true);
    });

    /* ------------------------------------------------------ transact -- */

    it("transact commits every write together", async () => {
      const store = await makeStore();
      const creator = await seedUser(store);
      const page = await seedPage(store, {
        kind: "private",
        ownerId: creator.id,
        allowanceTotal: 69,
      });
      const order = await seedOrder(store, { pageId: page.id, amountCents: 0 });

      // Settlement's shape: spend the allowance, move the order, post the
      // ledger. A free claim is an order for zero through the same path
      // (DECISIONS D18).
      await store.transact(async (tx) => {
        await tx.consumeAllowance(page.id, 9);
        await tx.updateOrderStatus(order.id, "paid", { settledAt: AT });
        await tx.appendLedger([makeLedgerEntry(order, creator.id, 0)]);
      });

      await expect(store.getPage(page.id)).resolves.toMatchObject({ allowanceUsed: 9 });
      await expect(store.getOrder(order.id)).resolves.toMatchObject({ status: "paid" });
      await expect(store.listLedgerFor(creator.id)).resolves.toHaveLength(1);
    });

    it("transact rolls everything back on a throw", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { kind: "private", allowanceTotal: 69 });
      const order = await seedOrder(store, { pageId: page.id });
      const r = rect(0, 0, 2, 2);

      await expect(
        store.transact(async (tx) => {
          await tx.consumeAllowance(page.id, 9);
          await tx.reserveBlocks(page.id, r, order.id, EXPIRES, NOW);
          await tx.updateOrderStatus(order.id, "paid");
          throw new Error("payment declined");
        }),
      ).rejects.toThrow("payment declined");

      await expect(store.getPage(page.id)).resolves.toMatchObject({ allowanceUsed: 0 });
      await expect(store.getOrder(order.id)).resolves.toMatchObject({
        status: "pending",
      });
      await expect(store.getHold(order.id)).resolves.toBeUndefined();
      await expect(store.isRectAvailable(page.id, r, NOW)).resolves.toBe(true);
    });

    it("a nested transact joins the outer one and sees its uncommitted writes", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { kind: "private", allowanceTotal: 69 });

      await store.transact(async (tx) => {
        await tx.consumeAllowance(page.id, 10);
        await tx.transact(async (inner) => {
          await expect(inner.getPage(page.id)).resolves.toMatchObject({
            allowanceUsed: 10,
          });
          await inner.consumeAllowance(page.id, 5);
        });
        await expect(tx.getPage(page.id)).resolves.toMatchObject({ allowanceUsed: 15 });
      });

      await expect(store.getPage(page.id)).resolves.toMatchObject({ allowanceUsed: 15 });
    });

    it("a throw inside a nested transact rolls back the outer one too", async () => {
      const store = await makeStore();
      const page = await seedPage(store, { kind: "private", allowanceTotal: 69 });

      await expect(
        store.transact(async (tx) => {
          await tx.consumeAllowance(page.id, 10);
          await tx.transact(async (inner) => {
            await inner.consumeAllowance(page.id, 5);
            throw new Error("inner boom");
          });
        }),
      ).rejects.toThrow("inner boom");

      await expect(store.getPage(page.id)).resolves.toMatchObject({ allowanceUsed: 0 });
    });

    /* --------------------------------------------------- concurrency -- */

    it("two concurrent reservations over the same blocks: exactly one wins", async () => {
      const store = await makeStore();
      const page = await seedPage(store);
      const a = await seedOrder(store, { pageId: page.id });
      const b = await seedOrder(store, { pageId: page.id });

      const [first, second] = await Promise.all([
        store.reserveBlocks(page.id, rect(0, 0, 4, 4), a.id, EXPIRES, NOW),
        store.reserveBlocks(page.id, rect(2, 2, 4, 4), b.id, EXPIRES, NOW),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
      const holds = await store.listHolds(page.id);
      expect(holds).toHaveLength(1);
    });

    it("overlapping reservations never both succeed (property)", async () => {
      const arbRect = fc.record({
        bx: fc.integer({ min: 0, max: 9 }),
        by: fc.integer({ min: 0, max: 9 }),
        bw: fc.integer({ min: 1, max: 5 }),
        bh: fc.integer({ min: 1, max: 5 }),
      });

      await fc.assert(
        fc.asyncProperty(arbRect, arbRect, async (first, second) => {
          const store = await makeStore();
          const page = await seedPage(store);
          const a = await seedOrder(store, { pageId: page.id });
          const b = await seedOrder(store, { pageId: page.id });

          const [gotA, gotB] = await Promise.all([
            store.reserveBlocks(page.id, first, a.id, EXPIRES, NOW),
            store.reserveBlocks(page.id, second, b.id, EXPIRES, NOW),
          ]);

          // Disjoint rectangles are independent; overlapping ones are a race
          // with exactly one winner, never two and never none.
          expect(gotA || gotB).toBe(true);
          expect(gotA && gotB).toBe(!rectsOverlap(first, second));
        }),
        { numRuns: 60 },
      );
    });
  });
}
