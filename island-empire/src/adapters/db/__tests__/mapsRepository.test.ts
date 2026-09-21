// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgliteDatabase } from "@/adapters/db/pglite";
import { SCHEMA_SQL } from "@/adapters/db/schema";
import { DbMapsRepository, decodeCursor, encodeCursor } from "@/adapters/db/mapsRepository";
import { mapInput } from "@/lib/__tests__/fixtures";

/**
 * The repository against a real embedded Postgres — the jsonb round-trip,
 * the summary columns, and keyset paging with a saved-between-pages row.
 */

let db: PgliteDatabase;
let repo: DbMapsRepository;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  repo = new DbMapsRepository(db);
});

afterAll(async () => {
  await db.close();
});

describe("create / get", () => {
  it("assigns a nanoid and round-trips the whole definition", async () => {
    const input = mapInput({ name: "Round Trip", biome: "snow" });
    const { id } = await repo.create(input);
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const got = await repo.get(id);
    expect(got).toEqual({ ...input, id });
    expect(got?.tiles).toHaveLength(64);
  });

  it("writes the summary columns from the definition", async () => {
    const { id } = await repo.create(mapInput({ name: "Cols", width: 10, height: 6, biome: "desert" }));
    const rows = await db.query<{ players: number; width: number; height: number; biome: string }>(
      "select players, width, height, biome from maps where id = $1",
      [id],
    );
    expect(rows).toEqual([{ players: 2, width: 10, height: 6, biome: "desert" }]);
  });

  it("returns null for an unknown id", async () => {
    expect(await repo.get("nope")).toBeNull();
  });
});

describe("list", () => {
  it("pages newest-first with a cursor and never repeats or skips", async () => {
    const fresh = new PgliteDatabase(":memory:", SCHEMA_SQL);
    await fresh.migrate();
    const r = new DbMapsRepository(fresh);
    try {
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        ids.push((await r.create(mapInput({ name: `Map ${i}` }))).id);
        // Distinct, past created_at values so the keyset has something to key
        // on beyond the id tie-break, and so a map saved later is newest.
        await fresh.execute("update maps set created_at = $1::timestamptz where id = $2", [
          `2026-01-0${i + 1}T00:00:00Z`,
          ids[i]!,
        ]);
      }

      const page1 = await r.list({ limit: 3 });
      expect(page1.maps.map((m) => m.name)).toEqual(["Map 6", "Map 5", "Map 4"]);
      expect(page1.nextCursor).not.toBeNull();

      // A map saved between two pages lands at the top and must not shift
      // the second page — that is what keyset buys over offset.
      await r.create(mapInput({ name: "Late" }));

      const page2 = await r.list({ limit: 3, cursor: page1.nextCursor! });
      expect(page2.maps.map((m) => m.name)).toEqual(["Map 3", "Map 2", "Map 1"]);
      const page3 = await r.list({ limit: 3, cursor: page2.nextCursor! });
      expect(page3.maps.map((m) => m.name)).toEqual(["Map 0"]);
      expect(page3.nextCursor).toBeNull();

      const all = await r.listAll();
      expect(all).toHaveLength(8);
      expect(all[0]?.name).toBe("Map 0"); // oldest first
      expect(all.at(-1)?.name).toBe("Late");
      expect(all[0]).toMatchObject({ width: 8, height: 8, biome: "grass", players: 2 });
      expect(Date.parse(all[0]!.createdAt)).not.toBeNaN();
    } finally {
      await fresh.close();
    }
  });

  it("refuses a cursor it did not produce", async () => {
    await expect(repo.list({ limit: 5, cursor: "garbage" })).rejects.toThrow(/cursor/);
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(encodeCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: "x" }))).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "x",
    });
  });

  it("clamps limit to 1..100", async () => {
    const page = await repo.list({ limit: 0 });
    expect(page.maps.length).toBeLessThanOrEqual(1);
  });
});
