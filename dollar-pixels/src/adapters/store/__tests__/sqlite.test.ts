// @vitest-environment node
//
// The store touches no DOM, and `node:sqlite` is a Node builtin that jsdom's
// environment has no business standing between us and.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SQLITE_PATH,
  getStore,
  MemoryStore,
  resetStoreForTests,
  SqliteStore,
  sqlitePath,
  storeDriver,
} from "@/adapters/store";
import type { Claim, Order, Page, User } from "@/domain/entities";
import { runStoreContract } from "./contract";

/**
 * A real file per store, not `:memory:`.
 *
 * Surviving a process is the entire reason this adapter exists, and an
 * in-memory SQLite database would pass every test below while proving none of
 * it. The directory is removed once, at the end, because WAL leaves a `-wal`
 * and a `-shm` beside each database.
 */
const DIR = mkdtempSync(join(tmpdir(), "dollar-pixels-sqlite-"));
const opened: SqliteStore[] = [];
let files = 0;

function dbPath(): string {
  files += 1;
  return join(DIR, `store-${files}.db`);
}

function openStore(path: string): SqliteStore {
  const store = new SqliteStore(path);
  opened.push(store);
  return store;
}

afterAll(async () => {
  await Promise.all(opened.map((store) => store.close()));
  rmSync(DIR, { recursive: true, force: true });
});

runStoreContract("SqliteStore", () => openStore(dbPath()));

/* ------------------------------------------------------------- fixtures -- */

const AT = "2026-01-01T00:00:00.000Z";
const NOW = new Date("2026-01-01T12:00:00.000Z");
const EXPIRES = new Date("2026-01-01T12:30:00.000Z");

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

function order(id: string, buyerId: string, pageId: string | null): Order {
  return {
    id,
    kind: "blocks",
    pageId,
    buyerId,
    amountCents: 400,
    status: "pending",
    provider: "mock",
    providerRef: null,
    payload: {
      kind: "blocks",
      pageId: pageId ?? "unknown",
      rect: { bx: 0, by: 0, bw: 2, bh: 2 },
      caption: "hi",
      colour: "#112233",
      tile: null,
    },
    createdAt: AT,
    settledAt: null,
  };
}

function claim(id: string, p: Page, ownerId: string, orderId: string): Claim {
  return {
    id,
    pageId: p.id,
    ownerId,
    rect: { bx: 0, by: 0, bw: 2, bh: 2 },
    caption: "mine",
    colour: "#d9ab22",
    tile: null,
    orderId,
    createdAt: AT,
  };
}

/* ---------------------------------------------------------- persistence -- */

describe("SqliteStore persistence", () => {
  it("hands a second process the rows the first one wrote", async () => {
    const path = dbPath();

    const first = openStore(path);
    const buyer = await first.createUser(user("user_persist"));
    const created = await first.createPage(page("page_persist", { ownerId: buyer.id }));
    const paid = await first.createOrder(order("order_persist", buyer.id, created.id));
    await first.reserveBlocks(
      created.id,
      { bx: 0, by: 0, bw: 2, bh: 2 },
      paid.id,
      EXPIRES,
      NOW,
    );
    const written = claim("claim_persist", created, buyer.id, paid.id);
    await expect(first.claimBlocks(written, NOW)).resolves.toBe(true);
    // WAL keeps the newest pages in a sidecar file; a close that did not
    // checkpoint would leave the reopened database looking empty.
    expect(existsSync(`${path}-wal`)).toBe(true);
    await first.close();

    // A different `SqliteStore`, a different `DatabaseSync`, the same file —
    // which is what a restarted dev server is.
    const second = openStore(path);
    await expect(second.getUser(buyer.id)).resolves.toEqual(buyer);
    await expect(second.getPage(created.id)).resolves.toEqual(created);
    await expect(second.getOrder(paid.id)).resolves.toEqual(paid);
    await expect(second.getClaim(written.id)).resolves.toEqual(written);
    await expect(second.countOwnedBlocks(created.id)).resolves.toBe(4);
    // The claim consumed the hold before the file was closed, so the blocks
    // come back owned rather than merely reserved.
    await expect(second.getHold(paid.id)).resolves.toBeUndefined();
    await expect(
      second.isRectAvailable(created.id, { bx: 1, by: 1, bw: 1, bh: 1 }, NOW),
    ).resolves.toBe(false);
  });

  it("applies the schema to a file that already has it", async () => {
    const path = dbPath();
    await openStore(path).createUser(user("user_reapply"));
    // Second open, same file: every statement in schema.sqlite.sql is
    // `if not exists`, which is what lets the demo run with no migration step.
    await expect(openStore(path).getUser("user_reapply")).resolves.toBeDefined();
  });
});

/* -------------------------------------------------------- defensive copy -- */

describe("SqliteStore defensive copies", () => {
  it("parses the order payload per read, so a caller cannot resize a purchase", async () => {
    const store = openStore(dbPath());
    const buyer = await store.createUser(user("user_deep"));
    const created = await store.createPage(page("page_deep", { ownerId: buyer.id }));
    const placed = await store.createOrder(order("order_deep", buyer.id, created.id));

    const fetched = await store.getOrder(placed.id);
    if (!fetched || fetched.payload.kind !== "blocks") throw new Error("unreachable");
    (fetched.payload.rect as { bw: number }).bw = 999;

    const refetched = await store.getOrder(placed.id);
    if (!refetched || refetched.payload.kind !== "blocks") throw new Error("unreachable");
    expect(refetched.payload.rect.bw).toBe(2);
  });

  it("does not keep a reference to the object it was handed", async () => {
    const store = openStore(dbPath());
    const input = user("user_preinsert");
    await store.createUser(input);
    (input as { displayName: string }).displayName = "MUTATED AFTER INSERT";

    await expect(store.getUser(input.id)).resolves.toMatchObject({
      displayName: "Test User",
    });
  });
});

/* ------------------------------------------------------------- savepoint -- */

describe("SqliteStore transactions", () => {
  it("a refused claim unwinds itself without unwinding its caller", async () => {
    const store = openStore(dbPath());
    const buyer = await store.createUser(user("user_sp"));
    const created = await store.createPage(
      page("page_sp", { ownerId: buyer.id, kind: "private", allowanceTotal: 69 }),
    );
    const placed = await store.createOrder(order("order_sp", buyer.id, created.id));

    await store.transact(async (tx) => {
      await tx.consumeAllowance(created.id, 4);
      // No hold, so this fails — after writing a claim row and rolling it back.
      // The savepoint is what keeps that rollback off the allowance the caller
      // already spent; a bare ROLLBACK here would discard both.
      await expect(
        tx.claimBlocks(claim("claim_sp", created, buyer.id, placed.id), NOW),
      ).resolves.toBe(false);
      await expect(tx.getPage(created.id)).resolves.toMatchObject({ allowanceUsed: 4 });
    });

    await expect(store.getPage(created.id)).resolves.toMatchObject({ allowanceUsed: 4 });
    await expect(store.getClaim("claim_sp")).resolves.toBeUndefined();
  });
});

/* ---------------------------------------------------- driver selection -- */

describe("driver selection", () => {
  const previous = process.env.STORE_DRIVER;

  afterEach(() => {
    process.env.STORE_DRIVER = previous;
    delete process.env.SQLITE_PATH;
    resetStoreForTests();
  });

  it("defaults to sqlite when STORE_DRIVER is unset", () => {
    delete process.env.STORE_DRIVER;
    expect(storeDriver()).toBe("sqlite");
    // Constructed, not opened: nothing has touched the filesystem, which is why
    // this test can assert the default without creating `.data/` in the repo.
    expect(getStore()).toBeInstanceOf(SqliteStore);
  });

  it("hands every caller the same sqlite instance", () => {
    process.env.STORE_DRIVER = "sqlite";
    expect(getStore()).toBe(getStore());
  });

  it("still selects memory and postgres when asked", () => {
    process.env.STORE_DRIVER = "memory";
    expect(storeDriver()).toBe("memory");
    expect(getStore()).toBeInstanceOf(MemoryStore);

    process.env.STORE_DRIVER = "postgres";
    resetStoreForTests();
    expect(storeDriver()).toBe("postgres");
    const url = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    // Loud, because a deployment that fell back to a local file would serve
    // traffic and forget every sale it took.
    expect(() => getStore()).toThrow("DATABASE_URL");
    if (url !== undefined) process.env.DATABASE_URL = url;
  });

  it("takes the database path from SQLITE_PATH, and has a default", () => {
    delete process.env.SQLITE_PATH;
    expect(sqlitePath()).toBe(DEFAULT_SQLITE_PATH);
    process.env.SQLITE_PATH = join(DIR, "configured.db");
    expect(sqlitePath()).toBe(join(DIR, "configured.db"));
  });
});
