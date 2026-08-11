// @vitest-environment node
//
// The store touches no DOM, and running it under jsdom would only mean testing
// jsdom's `structuredClone` instead of Node's.

import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryStore,
  getMemoryStore,
  getStore,
  resetStoreForTests,
  storeDriver,
} from "@/adapters/store";
import type { Page, User } from "@/domain/entities";
import { runStoreContract } from "./contract";

runStoreContract("MemoryStore", () => createMemoryStore());

const AT = "2026-01-01T00:00:00.000Z";

function user(id: string): User {
  return { id, handle: id, displayName: "Test User", createdAt: AT };
}

function page(id: string, over: Partial<Page> = {}): Page {
  return {
    id,
    slug: id,
    title: "Test Page",
    kind: "premium",
    size: "small",
    ownerId: null,
    allowanceTotal: 0,
    allowanceUsed: 0,
    createdAt: AT,
    ...over,
  };
}

describe("the globalThis singleton", () => {
  afterEach(() => {
    resetStoreForTests();
  });

  it("hands the same instance to every caller", async () => {
    const first = getMemoryStore();
    await first.createUser(user("user_shared"));

    // The point of the `Symbol.for` key: a Server Component and a Route
    // Handler are bundled as separate module graphs in Next 16, so a plain
    // module-level singleton is constructed twice and the page reads a
    // different store from the one its own API route wrote to
    // (research/persistence-and-vercel.md §4).
    await expect(getMemoryStore().getUser("user_shared")).resolves.toBeDefined();
    expect(getMemoryStore()).toBe(first);
  });

  it("resetStoreForTests replaces it with an empty one", async () => {
    await getMemoryStore().createUser(user("user_transient"));
    resetStoreForTests();

    await expect(getMemoryStore().getUser("user_transient")).resolves.toBeUndefined();
  });

  it("createMemoryStore builds an unshared store", async () => {
    const a = createMemoryStore();
    const b = createMemoryStore();
    await a.createUser(user("user_only_in_a"));

    await expect(b.getUser("user_only_in_a")).resolves.toBeUndefined();
    expect(a).not.toBe(getMemoryStore());
  });

  it("getStore defaults to memory", () => {
    expect(storeDriver()).toBe("memory");
    expect(getStore()).toBe(getMemoryStore());
  });
});

describe("MemoryStore defensive copies", () => {
  it("clones nested values, not just the top-level object", async () => {
    const store = createMemoryStore();
    const owner = await store.createUser(user("user_deep"));
    const created = await store.createPage(
      page("page_deep", { ownerId: owner.id, allowanceTotal: 69 }),
    );
    const order = await store.createOrder({
      id: "order_deep",
      kind: "blocks",
      pageId: created.id,
      buyerId: owner.id,
      amountCents: 400,
      status: "pending",
      provider: "mock",
      providerRef: null,
      payload: {
        kind: "blocks",
        pageId: created.id,
        rect: { bx: 0, by: 0, bw: 2, bh: 2 },
        caption: "hi",
        colour: "#112233",
        tile: null,
      },
      createdAt: AT,
      settledAt: null,
    });

    const fetched = await store.getOrder(order.id);
    if (!fetched || fetched.payload.kind !== "blocks") throw new Error("unreachable");
    // A caller reaching two levels down must not be able to resize someone's
    // purchase.
    (fetched.payload.rect as { bw: number }).bw = 999;

    const refetched = await store.getOrder(order.id);
    if (!refetched || refetched.payload.kind !== "blocks") throw new Error("unreachable");
    expect(refetched.payload.rect.bw).toBe(2);
  });

  it("does not keep a reference to the object it was handed", async () => {
    const store = createMemoryStore();
    const input = user("user_preinsert");
    await store.createUser(input);
    (input as { displayName: string }).displayName = "MUTATED AFTER INSERT";

    await expect(store.getUser(input.id)).resolves.toMatchObject({
      displayName: "Test User",
    });
  });
});

describe("MemoryStore transact", () => {
  it("commits a per-key diff, so a bare write made mid-transaction survives", async () => {
    const store = createMemoryStore();
    const owner = await store.createUser(user("user_diff"));
    await store.createPage(page("page_touched", { ownerId: owner.id, allowanceTotal: 10 }));
    await store.createPage(
      page("page_untouched", { ownerId: owner.id, allowanceTotal: 10 }),
    );

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: () => void;
    const snapshotTaken = new Promise<void>((resolve) => {
      ready = resolve;
    });

    const inFlight = store.transact(async (tx) => {
      await tx.getPage("page_touched");
      ready();
      await gate;
      await tx.consumeAllowance("page_touched", 3);
    });

    await snapshotTaken;
    // A write to a row the transaction never reads, made after its snapshot
    // was taken. A whole-table commit would silently roll this back.
    await store.consumeAllowance("page_untouched", 7);

    release();
    await inFlight;

    await expect(store.getPage("page_touched")).resolves.toMatchObject({
      allowanceUsed: 3,
    });
    await expect(store.getPage("page_untouched")).resolves.toMatchObject({
      allowanceUsed: 7,
    });
  });

  it("serializes root transactions, so a read-modify-write cannot lose an update", async () => {
    const store = createMemoryStore();
    const buyer = await store.createUser(user("user_serial"));
    const order = await store.createOrder({
      id: "order_serial",
      kind: "page",
      pageId: null,
      buyerId: buyer.id,
      amountCents: 1000,
      status: "pending",
      provider: "mock",
      providerRef: "",
      payload: {
        kind: "page",
        slug: "a-new-page",
        title: "A New Page",
        pageKind: "private",
        size: "small",
      },
      createdAt: AT,
      settledAt: null,
    });

    // Read, yield, write what was read: the classic lost update. The mutex is
    // what makes four of these land four times. This is asserted here rather
    // than in the shared contract because it is stronger than the port
    // promises — Postgres runs at READ COMMITTED and would need an explicit
    // row lock to match it.
    const append = () =>
      store.transact(async (tx) => {
        const current = await tx.getOrder(order.id);
        await Promise.resolve();
        await Promise.resolve();
        await tx.setOrderProviderRef(order.id, `${current?.providerRef ?? ""}x`);
      });

    await Promise.all([append(), append(), append(), append()]);

    await expect(store.getOrder(order.id)).resolves.toMatchObject({
      providerRef: "xxxx",
    });
  });
});
