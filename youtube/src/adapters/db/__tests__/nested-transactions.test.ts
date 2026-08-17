// @vitest-environment node
import { describe, expect, it } from "vitest";

import { setupTestDatabase } from "@/adapters/repositories/__tests__/harness";

/**
 * Nesting is refused, loudly.
 *
 * The port used to promise that an inner `transaction()` joins the outer one.
 * Neither adapter did: PGlite deadlocks on its single-connection queue, and
 * Neon opens an independent transaction on a fresh pooled connection that can
 * commit while the outer rolls back. The first hangs, the second corrupts, and
 * the same code does each depending on where it is deployed.
 *
 * A deadlock cannot be asserted against without a timeout, which is exactly
 * why it went unnoticed — so the assertion here is that the call *returns*, as
 * a rejection.
 */
const t = setupTestDatabase();

describe("nested transactions", () => {
  it("throws instead of deadlocking", async () => {
    await expect(
      t.db.transaction(async () => {
        await t.db.transaction(async () => "inner");
      }),
    ).rejects.toThrow(/Nested transaction/);
  });

  it("leaves the handle usable afterwards", async () => {
    await t.db.transaction(async () => {}).catch(() => {});
    await expect(
      t.db.transaction(async (tx) => (await tx.query("select 1 as n"))[0]?.n),
    ).resolves.toBe(1);
  });

  /**
   * The other half, which was missing and which the guard failed.
   *
   * `database()` is memoised process-wide, and the guard used to be a boolean
   * on the adapter — so it meant "somebody in this process is in a
   * transaction", not "this call chain is". Two unrelated requests overlapping
   * by a millisecond were diagnosed as a nesting bug and the second was
   * refused.
   *
   * That was survivable while transactions were rare and stopped being so the
   * moment `POST /api/watch` existed: the reporter posts every few seconds per
   * viewer and crossing the view threshold opens a transaction, so two people
   * finishing a video at once is ordinary traffic.
   *
   * The test that existed could not see it, because a nesting test is
   * necessarily sequential.
   */
  it("does not mistake two concurrent transactions for a nested one", async () => {
    const results = await Promise.allSettled([
      t.db.transaction(async (tx) => (await tx.query("select 1 as n"))[0]?.n),
      t.db.transaction(async (tx) => (await tx.query("select 2 as n"))[0]?.n),
      t.db.transaction(async (tx) => (await tx.query("select 3 as n"))[0]?.n),
    ]);

    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("still refuses a nested one started inside a concurrent pair", async () => {
    // The guard must not have been loosened into uselessness: scoping it to the
    // async chain has to keep catching the case it exists for, *while* another
    // transaction is open beside it.
    const [concurrent, nested] = await Promise.allSettled([
      t.db.transaction(async (tx) => (await tx.query("select 1 as n"))[0]?.n),
      t.db.transaction(async () => {
        await t.db.transaction(async () => "inner");
      }),
    ]);

    expect(concurrent?.status).toBe("fulfilled");
    expect(nested?.status).toBe("rejected");
  });
});
