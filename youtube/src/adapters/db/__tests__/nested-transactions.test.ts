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
});
