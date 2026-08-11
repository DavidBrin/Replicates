import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "@/adapters/store";
import { MockPaymentProvider } from "@/adapters/payment/mock";
import { FixedClock, SeqIdGen } from "@/adapters/system";
import type { Page, User } from "@/domain/entities";
import { HOLD_MINUTES } from "@/domain/order";
import { PRIVATE_PAGE_ALLOWANCE } from "@/domain/pricing";
import { buyBlocks, claimFree } from "@/domain/services/checkout";
import { release, settle } from "@/domain/services/fulfilment";
import { gridSnapshot } from "@/domain/services/pages";
import { AppError } from "@/domain/services/errors";
import type { Store } from "@/ports";

/**
 * The buy path end to end, against the real in-memory store.
 *
 * These are the tests that would catch a hold that never releases, a webhook
 * retry that writes two claims, or a creator credited for a page they do not
 * own — none of which any single unit test can see.
 */

const MINUTE = 60_000;

interface Harness {
  store: Store;
  clock: FixedClock;
  idGen: SeqIdGen;
  payments: MockPaymentProvider;
  platformFeeBps: number;
  origin: string;
}

let h: Harness;

async function makeUser(store: Store, id: string, name: string): Promise<User> {
  return store.createUser({
    id,
    handle: id,
    displayName: name,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

async function makePage(store: Store, patch: Partial<Page> = {}): Promise<Page> {
  return store.createPage({
    id: "pag_test",
    slug: "test-page",
    title: "Test Page",
    kind: "premium",
    size: "small",
    ownerId: null,
    allowanceTotal: 0,
    allowanceUsed: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  });
}

function claimBody(rect = { bx: 0, by: 0, bw: 2, bh: 2 }) {
  return { rect, caption: "Harbour Lights", colour: "#c0182b", tile: null };
}

beforeEach(() => {
  h = {
    store: createMemoryStore(),
    clock: new FixedClock("2026-06-01T12:00:00.000Z"),
    idGen: new SeqIdGen(),
    payments: new MockPaymentProvider(),
    platformFeeBps: 0,
    origin: "https://example.test",
  };
});

describe("buying blocks", () => {
  it("prices the selection server-side and settles into a claim", async () => {
    await makeUser(h.store, "usr_buyer", "Ana");
    const page = await makePage(h.store);

    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_buyer",
      ...claimBody(),
    });

    // 2 x 2 blocks = 4 blocks = $4, computed from the rectangle, never sent.
    expect(order.amountCents).toBe(400);
    expect(order.status).toBe("pending");

    const result = await settle(h, order.id, "mock_ref");
    expect(result.changed).toBe(true);
    expect(result.claim?.rect).toEqual({ bx: 0, by: 0, bw: 2, bh: 2 });

    const snapshot = await gridSnapshot(h, page.slug);
    expect(snapshot.soldBlocks).toBe(4);
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.claims[0].caption).toBe("Harbour Lights");
  });

  it("holds the blocks against a second buyer while the first pays", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    await makeUser(h.store, "usr_b", "Ben");
    const page = await makePage(h.store);

    await buyBlocks(h, { slug: page.slug, buyerId: "usr_a", ...claimBody() });

    await expect(
      buyBlocks(h, {
        slug: page.slug,
        buyerId: "usr_b",
        ...claimBody({ bx: 1, by: 1, bw: 2, bh: 2 }),
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("lets a second buyer in once the hold has expired, with nothing sweeping it", async () => {
    // The whole point of read-time expiry (DECISIONS D9): no cron, no cleanup
    // job, and the blocks still come back.
    await makeUser(h.store, "usr_a", "Ana");
    await makeUser(h.store, "usr_b", "Ben");
    const page = await makePage(h.store);

    await buyBlocks(h, { slug: page.slug, buyerId: "usr_a", ...claimBody() });
    h.clock.advance((HOLD_MINUTES + 1) * MINUTE);

    const second = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_b",
      ...claimBody(),
    });
    expect(second.order.buyerId).toBe("usr_b");
  });

  it("refuses a settlement whose blocks were taken while the payment was in flight", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    await makeUser(h.store, "usr_b", "Ben");
    const page = await makePage(h.store);

    const first = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_a",
      ...claimBody(),
    });

    h.clock.advance((HOLD_MINUTES + 1) * MINUTE);
    const second = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_b",
      ...claimBody(),
    });
    await settle(h, second.order.id, "mock_b");

    // Ana's payment arrives after Ben's claim landed. The money is real, the
    // blocks are not available, and the only honest answer is to refuse and
    // say so rather than overwrite Ben.
    await expect(settle(h, first.order.id, "mock_a")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("releases the hold when the payment provider fails", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);

    const broken = {
      ...h,
      payments: {
        id: "broken",
        label: "Broken",
        isLive: false,
        createCheckout: () => Promise.reject(new Error("provider down")),
        expire: () => Promise.resolve(),
      },
    };

    await expect(
      buyBlocks(broken, { slug: page.slug, buyerId: "usr_a", ...claimBody() }),
    ).rejects.toMatchObject({ code: "payment_failed" });

    // Otherwise an outage freezes the selected blocks for the whole hold
    // window with no order anyone can pay.
    const after = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_a",
      ...claimBody(),
    });
    expect(after.order.status).toBe("pending");
  });

  it("rejects a selection outside the grid and an oversized one", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store, { size: "small" });

    await expect(
      buyBlocks(h, {
        slug: page.slug,
        buyerId: "usr_a",
        ...claimBody({ bx: 119, by: 0, bw: 5, bh: 1 }),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects a caption or colour the domain refuses", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);

    await expect(
      buyBlocks(h, {
        slug: page.slug,
        buyerId: "usr_a",
        rect: { bx: 0, by: 0, bw: 1, bh: 1 },
        caption: "   ",
        colour: "#c0182b",
        tile: null,
      }),
    ).rejects.toMatchObject({ code: "invalid" });

    await expect(
      buyBlocks(h, {
        slug: page.slug,
        buyerId: "usr_a",
        rect: { bx: 0, by: 0, bw: 1, bh: 1 },
        caption: "fine",
        colour: "octarine",
        tile: null,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("settlement idempotency", () => {
  it("does nothing the second time the same payment settles", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);
    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_a",
      ...claimBody(),
    });

    const first = await settle(h, order.id, "evt_1");
    const second = await settle(h, order.id, "evt_1");

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);

    // The retry must not have written a second claim or a second ledger line.
    const snapshot = await gridSnapshot(h, page.slug);
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.soldBlocks).toBe(4);
  });

  it("refuses a different payment for an order already paid", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);
    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_a",
      ...claimBody(),
    });

    await settle(h, order.id, "evt_1");
    await expect(settle(h, order.id, "evt_2")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses to release an order that is already paid", async () => {
    // An `expired` event arriving after `completed` for the same session.
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);
    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_a",
      ...claimBody(),
    });
    await settle(h, order.id, "evt_1");

    await expect(release(h, order.id, "expired")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("releases a pending order and gives the blocks straight back", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    await makeUser(h.store, "usr_b", "Ben");
    const page = await makePage(h.store);

    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_a",
      ...claimBody(),
    });
    await release(h, order.id, "cancelled");

    const second = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_b",
      ...claimBody(),
    });
    expect(second.order.buyerId).toBe("usr_b");
  });
});

describe("who gets paid", () => {
  it("credits a premium page's creator for every block sold", async () => {
    await makeUser(h.store, "usr_creator", "Creator");
    await makeUser(h.store, "usr_buyer", "Buyer");
    const page = await makePage(h.store, { kind: "premium", ownerId: "usr_creator" });

    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_buyer",
      ...claimBody({ bx: 0, by: 0, bw: 5, bh: 5 }),
    });
    await settle(h, order.id, "evt_1");

    // 25 blocks at $1, all of it to the creator at the default zero fee.
    expect(await h.store.balanceFor("usr_creator")).toBe(2_500);
  });

  it("takes the configured fee off the creator's share", async () => {
    await makeUser(h.store, "usr_creator", "Creator");
    await makeUser(h.store, "usr_buyer", "Buyer");
    const page = await makePage(h.store, { kind: "premium", ownerId: "usr_creator" });

    const withFee = { ...h, platformFeeBps: 1_000 };
    const { order } = await buyBlocks(withFee, {
      slug: page.slug,
      buyerId: "usr_buyer",
      ...claimBody({ bx: 0, by: 0, bw: 10, bh: 10 }),
    });
    await settle(withFee, order.id, "evt_1");

    expect(await h.store.balanceFor("usr_creator")).toBe(9_000);
  });

  it("credits nobody when the page is unlisted", async () => {
    await makeUser(h.store, "usr_creator", "Creator");
    await makeUser(h.store, "usr_buyer", "Buyer");
    const page = await makePage(h.store, {
      kind: "private",
      ownerId: "usr_creator",
      allowanceTotal: PRIVATE_PAGE_ALLOWANCE,
    });

    const { order } = await buyBlocks(h, {
      slug: page.slug,
      buyerId: "usr_buyer",
      ...claimBody(),
    });
    await settle(h, order.id, "evt_1");

    // An unlisted page buys a canvas, not a revenue stream (DECISIONS D4/D5).
    expect(await h.store.balanceFor("usr_creator")).toBe(0);
  });
});

describe("the free allowance", () => {
  it("lets an unlisted page's creator claim without paying", async () => {
    await makeUser(h.store, "usr_creator", "Creator");
    const page = await makePage(h.store, {
      kind: "private",
      ownerId: "usr_creator",
      allowanceTotal: PRIVATE_PAGE_ALLOWANCE,
    });

    const order = await claimFree(h, {
      slug: page.slug,
      buyerId: "usr_creator",
      ...claimBody({ bx: 0, by: 0, bw: 3, bh: 3 }),
    });
    expect(order.amountCents).toBe(0);

    const result = await settle(h, order.id, `allowance_${order.id}`);
    expect(result.claim).not.toBeNull();

    const after = await h.store.getPage(page.id);
    expect(after?.allowanceUsed).toBe(9);
  });

  it("stops at sixty-nine blocks", async () => {
    await makeUser(h.store, "usr_creator", "Creator");
    const page = await makePage(h.store, {
      kind: "private",
      ownerId: "usr_creator",
      allowanceTotal: PRIVATE_PAGE_ALLOWANCE,
    });

    // 8 x 8 = 64 free, leaving 5.
    const first = await claimFree(h, {
      slug: page.slug,
      buyerId: "usr_creator",
      ...claimBody({ bx: 0, by: 0, bw: 8, bh: 8 }),
    });
    await settle(h, first.id, `allowance_${first.id}`);

    await expect(
      claimFree(h, {
        slug: page.slug,
        buyerId: "usr_creator",
        ...claimBody({ bx: 20, by: 20, bw: 3, bh: 3 }),
      }),
    ).rejects.toMatchObject({ code: "invalid" });

    const fits = await claimFree(h, {
      slug: page.slug,
      buyerId: "usr_creator",
      ...claimBody({ bx: 20, by: 20, bw: 5, bh: 1 }),
    });
    await settle(h, fits.id, `allowance_${fits.id}`);
    expect((await h.store.getPage(page.id))?.allowanceUsed).toBe(69);
  });

  it("refuses somebody else's allowance", async () => {
    await makeUser(h.store, "usr_creator", "Creator");
    await makeUser(h.store, "usr_other", "Other");
    const page = await makePage(h.store, {
      kind: "private",
      ownerId: "usr_creator",
      allowanceTotal: PRIVATE_PAGE_ALLOWANCE,
    });

    await expect(
      claimFree(h, { slug: page.slug, buyerId: "usr_other", ...claimBody() }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("the snapshot", () => {
  it("shows a live hold but not an expired one", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);
    await buyBlocks(h, { slug: page.slug, buyerId: "usr_a", ...claimBody() });

    expect((await gridSnapshot(h, page.slug)).holds).toHaveLength(1);

    h.clock.advance((HOLD_MINUTES + 1) * MINUTE);
    expect((await gridSnapshot(h, page.slug)).holds).toHaveLength(0);
  });

  it("carries no identity on a hold", async () => {
    await makeUser(h.store, "usr_a", "Ana");
    const page = await makePage(h.store);
    await buyBlocks(h, { slug: page.slug, buyerId: "usr_a", ...claimBody() });

    const [hold] = (await gridSnapshot(h, page.slug)).holds;
    expect(Object.keys(hold).sort()).toEqual(["expiresAt", "rect"]);
  });

  it("404s for a page that does not exist", async () => {
    await expect(gridSnapshot(h, "nope")).rejects.toBeInstanceOf(AppError);
  });
});
