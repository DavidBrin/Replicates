// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { NeonDatabase } from "@/adapters/db/neon";

/**
 * Pins the one thing about Neon's HTTP client that a local run never checks:
 * since `@neondatabase/serverless` 1.0 a placeholder query goes through
 * `sql.query(text, params)`, not `sql(text, params)`. The adapter had the
 * latter, which threw on every read the day the deployment first had a
 * database. The pool path is pinned alongside so the two halves of the split
 * stay the same shape.
 */
describe("NeonDatabase", () => {
  function fakes() {
    const sql = { query: vi.fn(async () => [{ id: "v1" }]) };
    const client = {
      query: vi.fn(async () => ({ rows: [{ id: "v2" }], rowCount: 3 })),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => undefined) };
    return { sql, client, pool, db: new NeonDatabase(sql, pool) };
  }

  it("reads over HTTP through the client's query() method with $n params", async () => {
    const { sql, db } = fakes();
    const rows = await db.query("select * from videos where id = $1", ["v1"]);
    expect(rows).toEqual([{ id: "v1" }]);
    expect(sql.query).toHaveBeenCalledWith("select * from videos where id = $1", ["v1"]);
  });

  it("writes through a pooled connection and returns the row count", async () => {
    const { client, pool, db } = fakes();
    const changed = await db.execute("update videos set view_count = $2 where id = $1", ["v1", 5]);
    expect(changed).toBe(3);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      "update videos set view_count = $2 where id = $1",
      ["v1", 5],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
