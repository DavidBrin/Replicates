/** `MapFile` → `MapDef`, including the sea-link union of F45. */
import { describe, expect, it } from "vitest";

import { MapLoadError, clearMapCache, toMapDef, toMapDefCached } from "./mapLoader";
import { TINY4, TINY4_FILE, T4 } from "./__fixtures__/tiny4";
import { buildDemoMap } from "./__fixtures__/demoMap";

describe("toMapDef", () => {
  it("indexes every territory in file order", () => {
    expect(TINY4.territories.map((t) => t.id)).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(TINY4.territories.map((t) => t.index)).toEqual([0, 1, 2, 3]);
  });

  it("parses the viewBox into four numbers", () => {
    expect(TINY4.viewBox).toEqual([0, 0, 400, 300]);
  });

  it("honours a non-zero viewBox origin", () => {
    const map = toMapDef({ ...TINY4_FILE, slug: "offset", viewBox: "0 8 1024 643" });
    expect(map.viewBox).toEqual([0, 8, 1024, 643]);
  });

  it("rejects a malformed viewBox", () => {
    expect(() => toMapDef({ ...TINY4_FILE, slug: "bad", viewBox: "0 0 400" })).toThrow(MapLoadError);
  });

  it("rejects a zero-area viewBox", () => {
    expect(() => toMapDef({ ...TINY4_FILE, slug: "flat", viewBox: "0 0 0 300" })).toThrow(MapLoadError);
  });

  it("unions sea links into adjacency (F45)", () => {
    expect(TINY4.territories[T4.alpha]?.adjacent).toEqual([1, 2, 3]);
    expect(TINY4.territories[T4.alpha]?.seaLinked).toEqual([3]);
    expect(TINY4.adjacency[T4.delta]).toContain(T4.alpha);
  });

  it("keeps the union idempotent when a sea link is also a land border", () => {
    const alpha = TINY4.territories[T4.alpha];
    expect(alpha?.adjacent.filter((n) => n === T4.delta)).toHaveLength(1);
  });

  it("sorts every adjacency row ascending (R91)", () => {
    for (const t of TINY4.territories) {
      expect([...t.adjacent].sort((a, b) => a - b)).toEqual([...t.adjacent]);
    }
  });

  it("makes adjacency symmetric even from a one-sided file", () => {
    const file = {
      ...TINY4_FILE,
      slug: "oneway",
      territories: TINY4_FILE.territories.map((t, i) =>
        (i === 0 ? { ...t, adjacent: ["bravo"] } : { ...t, adjacent: [] as string[] })),
      seaLinks: [],
    };
    const map = toMapDef(file);
    expect(map.adjacency[0]).toContain(1);
    expect(map.adjacency[1]).toContain(0);
  });

  it("resolves continent membership to indices", () => {
    expect(TINY4.continents[0]?.territories).toEqual([0, 1, 2, 3]);
    expect(TINY4.continents[0]?.bonus).toBe(2);
  });

  it("computes the continent border as the territories with an outside edge", () => {
    const demo = toMapDef(buildDemoMap({ slug: "border-test", cols: 3, rows: 3 }));
    const first = demo.continents[0];
    expect(first).toBeDefined();
    // A single column of a 3×3 grid: every tile in it borders the next column.
    expect(first?.border.length).toBeGreaterThan(0);
    // tiny4 is one continent covering the whole board, so nothing leaves it.
    expect(TINY4.continents[0]?.border).toEqual([]);
  });

  it("rejects a dangling territory reference", () => {
    const file = {
      ...TINY4_FILE,
      slug: "dangling",
      territories: TINY4_FILE.territories.map((t, i) =>
        (i === 0 ? { ...t, adjacent: ["nowhere"] } : t)),
    };
    expect(() => toMapDef(file)).toThrow(/unknown territory "nowhere"/);
  });

  it("rejects a dangling continent reference", () => {
    const file = {
      ...TINY4_FILE,
      slug: "no-continent",
      territories: TINY4_FILE.territories.map((t, i) =>
        (i === 0 ? { ...t, continent: "atlantis" } : t)),
    };
    expect(() => toMapDef(file)).toThrow(/unknown continent "atlantis"/);
  });

  it("rejects a duplicate id", () => {
    const first = TINY4_FILE.territories[0];
    expect(first).toBeDefined();
    const file = { ...TINY4_FILE, slug: "dupe", territories: [...TINY4_FILE.territories, first!] };
    expect(() => toMapDef(file)).toThrow(/duplicate territory id/);
  });

  it("rejects a self-adjacency", () => {
    const file = {
      ...TINY4_FILE,
      slug: "self",
      territories: TINY4_FILE.territories.map((t, i) =>
        (i === 0 ? { ...t, adjacent: ["alpha"] } : t)),
    };
    expect(() => toMapDef(file)).toThrow(/adjacent to itself/);
  });

  it("carries the token and label anchors through as tuples", () => {
    expect(TINY4.territories[0]?.token).toEqual([105, 76]);
    expect(TINY4.territories[0]?.label).toEqual([105, 102]);
  });

  it("memoises by slug", () => {
    clearMapCache();
    const a = toMapDefCached(TINY4_FILE);
    const b = toMapDefCached(TINY4_FILE);
    expect(a).toBe(b);
    clearMapCache();
    expect(toMapDefCached(TINY4_FILE)).not.toBe(a);
  });
});

describe("the demo board", () => {
  it("has unique ids however wide it is", () => {
    const wide = buildDemoMap({ slug: "wide", cols: 8, rows: 2 });
    expect(new Set(wide.territories.map((t) => t.id)).size).toBe(16);
    expect(new Set(wide.continents.map((c) => c.id)).size).toBe(8);
  });

  it("gives every territory a suit, with the three counts within one (F7)", () => {
    const map = buildDemoMap({ cols: 4, rows: 3 });
    const counts = { infantry: 0, cavalry: 0, artillery: 0 };
    for (const t of map.territories) counts[t.suit] += 1;
    const values = Object.values(counts);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it("is fully connected", () => {
    const map = toMapDef(buildDemoMap({ cols: 4, rows: 3 }));
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const at = queue.shift() as number;
      for (const n of map.adjacency[at] ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(map.territories.length);
  });
});
