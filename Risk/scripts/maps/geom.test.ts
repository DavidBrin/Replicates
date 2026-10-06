/**
 * Pipeline unit tests: the adjacency derivation and the simplifier.
 *
 * These run under `pnpm test` because `vitest.config.mts` includes
 * `scripts/**\/*.test.ts` (F35). They import their siblings **extensionlessly**,
 * which Vitest resolves — the production modules reach each other through
 * `maps/engine.ts`'s dynamic specifier instead, because Node's type stripping
 * and `tsc` disagree about import extensions (see that file's header).
 *
 * The three bugs these cover were all real, and all silent:
 *
 *  - Douglas–Peucker returning its **input** when a tolerance flattened a ring
 *    made the vertex count non-monotone in tolerance, which sent
 *    `fitVertexBudget`'s bisection the wrong way and turned every Tier 1
 *    outline into a triangle.
 *  - A recursive split leaves the pieces either side of an early cut sharing
 *    **one** vertex, not two, so "two or more shared vertices" rejected them;
 *    North America lost two thirds of its land borders.
 *  - d3's `fitExtent` reads a GeoJSON object with spherical path machinery that
 *    assumes closed rings in a given winding, so after a lon/lat clip it sized
 *    Europe at 16% of the frame and emitted empty polygons.
 */

import { describe, expect, it } from "vitest";

import {
  areaOf, assignSuits, bandNames, clipHalfPlane, conformVertices, mergeToTarget, slugify,
  slugifyKebab, splitShape, toRoman,
} from "./geom";
import { QUANTUM, extentOf, fitProjection, quantise, worldCountries } from "./sources";
import { attribute, decodeEntities, multiply, normaliseName, parseTransform } from "./svg";
import {
  countVertices, fitVertexBudget, ringArea, ringsToPath, sharedVertexAdjacency, simplifyOpen,
  simplifyRing, type Point, type Ring,
} from "./engine";

const quantiser = (n: number): number => Math.round(n * 64) / 64;

/** An axis-aligned box, counter-clockwise in y-down space. */
function box(x: number, y: number, w: number, h: number): Ring {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/* ------------------------------------------------------------------ adjacency -- */

describe("sharedVertexAdjacency", () => {
  it("links two shapes that share a whole edge", () => {
    const left = box(0, 0, 10, 10);
    // Same corner coordinates on the shared edge, so the match is exact.
    const right: Ring = [[10, 0], [20, 0], [20, 10], [10, 10]];
    const adjacency = sharedVertexAdjacency([[left], [right]]);
    expect([...(adjacency[0] ?? [])]).toEqual([1]);
    expect([...(adjacency[1] ?? [])]).toEqual([0]);
  });

  it("does not link two shapes that only touch at a corner", () => {
    const a = box(0, 0, 10, 10);
    const b: Ring = [[10, 10], [20, 10], [20, 20], [10, 20]];
    const adjacency = sharedVertexAdjacency([[a], [b]]);
    expect([...(adjacency[0] ?? [])]).toEqual([]);
  });

  it("does not link two shapes that merely come close", () => {
    const a = box(0, 0, 10, 10);
    const b = box(10.5, 0, 10, 10);
    expect([...(sharedVertexAdjacency([[a], [b]])[0] ?? [])]).toEqual([]);
  });

  it("links an archipelago through any of its rings", () => {
    const mainland = box(0, 0, 10, 10);
    const island = box(100, 100, 2, 2);
    const neighbour: Ring = [[10, 0], [20, 0], [20, 10], [10, 10]];
    const adjacency = sharedVertexAdjacency([[mainland, island], [neighbour]]);
    expect([...(adjacency[0] ?? [])]).toEqual([1]);
  });

  it("agrees with topojson's own topology over all 177 world countries", () => {
    // The check that licenses the whole approach: adjacency derived from shared
    // vertices, not hand-typed and not distance-thresholded. Verified against
    // the atlas's arc topology rather than against a hand-written expectation.
    const countries = worldCountries();
    const project = fitProjection("equalEarth", countries, 1600, 900, 10);
    const shapes = countries.map((f) => f.rings.map((ring) => ring
      .map((p) => project(p))
      .filter((p): p is readonly [number, number] => p !== null)
      .map((p) => [quantise(p[0]), quantise(p[1])] as Point)));
    const adjacency = sharedVertexAdjacency(shapes);
    const edges = adjacency.reduce((n, set) => n + set.size, 0) / 2;

    // 313 of the atlas's 314 shared-arc pairs; the miss is a self-pair in the
    // source data. Zero false positives — asserted as a range so a Natural Earth
    // bump does not fail the build over one coastline vertex.
    expect(edges).toBeGreaterThan(300);
    expect(edges).toBeLessThan(330);

    const byName = new Map(countries.map((f, i) => [f.name, i]));
    const linked = (a: string, b: string): boolean =>
      adjacency[byName.get(a) as number]?.has(byName.get(b) as number) ?? false;
    expect(linked("France", "Spain")).toBe(true);
    expect(linked("Egypt", "Sudan")).toBe(true);
    expect(linked("Chile", "Argentina")).toBe(true);
    // Across the Channel and the Strait of Gibraltar: sea links, not borders.
    expect(linked("United Kingdom", "France")).toBe(false);
    expect(linked("Spain", "Morocco")).toBe(false);
    expect(linked("Japan", "South Korea")).toBe(false);
  });
});

/* ------------------------------------------------------------------ splitting -- */

describe("clipHalfPlane and splitShape", () => {
  it("keeps the requested side and computes the same crossing from both", () => {
    const shape = [box(0, 0, 10, 10)];
    const low = clipHalfPlane(shape, 0, 4, "low");
    const high = clipHalfPlane(shape, 0, 4, "high");
    expect(areaOf(low)).toBeCloseTo(40, 6);
    expect(areaOf(high)).toBeCloseTo(60, 6);
    // The crossing points must be identical numbers, or adjacency misses them.
    const onCut = (rings: Ring[]): string[] => rings.flatMap((r) => r)
      .filter((p) => p[0] === 4).map((p) => `${p[0]},${p[1]}`).sort();
    expect(onCut(low)).toEqual(onCut(high));
  });

  it("bisects by area, not by distance", () => {
    // A right triangle: half the area sits well past the midpoint of the base.
    const triangle: Ring = [[0, 0], [100, 0], [0, 100]];
    const [a, b] = splitShape([triangle], 2, quantiser);
    expect(areaOf(a as Ring[])).toBeCloseTo(areaOf(b as Ring[]), -1);
  });

  it("cuts into exactly k roughly equal pieces", () => {
    for (const k of [2, 3, 5, 8, 12]) {
      const pieces = splitShape([box(0, 0, 600, 400)], k, quantiser);
      expect(pieces).toHaveLength(k);
      const total = 600 * 400;
      for (const piece of pieces) {
        expect(areaOf(piece)).toBeGreaterThan((total / k) * 0.5);
        expect(areaOf(piece)).toBeLessThan((total / k) * 1.6);
      }
      expect(pieces.reduce((n, p) => n + areaOf(p), 0)).toBeCloseTo(total, -1);
    }
  });

  it("cuts across the longer axis, so pieces stay compact", () => {
    const [a] = splitShape([box(0, 0, 400, 100)], 2, quantiser);
    // A vertical cut on a wide box: the first piece keeps the full height.
    const ys = (a as Ring[]).flatMap((r) => r.map((p) => p[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 6);
  });
});

describe("conformVertices", () => {
  it("inserts a neighbour's vertex into the edge that runs past it", () => {
    // The exact shape of the bug: `whole`'s left edge runs 0→10 with nothing at
    // y=4, while `top` and `bottom` meet there.
    const whole: Ring = [[10, 0], [20, 0], [20, 10], [10, 10]];
    const top = box(0, 0, 10, 4);
    const bottom = box(0, 4, 10, 6);

    const before = sharedVertexAdjacency([[whole], [top], [bottom]]);
    // Each half shares only ONE vertex with `whole`, so neither is a neighbour.
    expect([...(before[0] ?? [])]).toEqual([]);

    const conformed = conformVertices([[whole], [top], [bottom]], 1 / 64);
    const after = sharedVertexAdjacency(conformed);
    expect([...(after[0] ?? [])].sort()).toEqual([1, 2]);
  });

  it("adds only collinear vertices, so the outline is unchanged", () => {
    const whole: Ring = [[10, 0], [20, 0], [20, 10], [10, 10]];
    const [conformed] = conformVertices([[whole], [box(0, 0, 10, 4)]], 1 / 64);
    const ring = (conformed as Ring[])[0] as Ring;
    expect(ring.length).toBe(whole.length + 1);
    expect(ringArea(ring)).toBeCloseTo(ringArea(whole), 6);
  });

  it("restores the borders a recursive split loses", () => {
    // A rectangle split 12 ways is the one case that does NOT need conforming:
    // the two halves are congruent, so their sub-cuts land on identical
    // coordinates and no T-junction appears. A triangle's halves are not
    // congruent, which is the real shape of the problem.
    const triangle: Ring = [[0, 0], [600, 0], [0, 400]];
    const pieces = splitShape([triangle], 12, quantiser);
    const count = (a: readonly ReadonlySet<number>[]): number => a.reduce((n, s) => n + s.size, 0) / 2;

    const bare = sharedVertexAdjacency(pieces);
    const conformed = sharedVertexAdjacency(conformVertices(pieces, 1 / 64));
    expect(count(conformed)).toBeGreaterThan(count(bare));
    // Every piece of a partitioned shape has a neighbour, and the whole thing is
    // one connected board — which is what the T7 connectivity gate needs.
    for (const [i, set] of conformed.entries()) expect(set.size, `piece ${i}`).toBeGreaterThan(0);

    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      for (const n of conformed[queue.pop() as number] ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(pieces.length);
  });

  it("leaves a congruent split alone, because its cuts already align", () => {
    const pieces = splitShape([box(0, 0, 600, 400)], 12, quantiser);
    const count = (a: readonly ReadonlySet<number>[]): number => a.reduce((n, s) => n + s.size, 0) / 2;
    expect(count(sharedVertexAdjacency(conformVertices(pieces, 1 / 64))))
      .toBe(count(sharedVertexAdjacency(pieces)));
  });
});

/* ------------------------------------------------------------------ merging -- */

describe("mergeToTarget", () => {
  const chain = (n: number): Set<number>[] => {
    const out: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let i = 0; i + 1 < n; i++) {
      out[i]?.add(i + 1);
      out[i + 1]?.add(i);
    }
    return out;
  };

  it("reaches the target and partitions every input exactly once", () => {
    const plan = mergeToTarget([5, 1, 1, 4, 1, 3], chain(6), 3);
    expect(plan.groups).toHaveLength(3);
    expect(plan.groups.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const [i, owner] of plan.owner.entries()) {
      expect(plan.groups[owner]).toContain(i);
    }
  });

  it("merges the smallest into its smallest neighbour", () => {
    // 1 is the smallest; of its neighbours (0 at 50, 2 at 2) it joins 2.
    const plan = mergeToTarget([50, 1, 2, 50], chain(4), 3);
    const together = plan.groups.find((g) => g.includes(1));
    expect(together).toContain(2);
    expect(together).not.toContain(0);
  });

  it("leaves an island alone when borders alone can reach the target", () => {
    const adjacency = chain(4);
    const island = [...adjacency, new Set<number>()];
    const plan = mergeToTarget([9, 9, 9, 9, 1], island, 4);
    expect(plan.groups).toHaveLength(4);
    expect(plan.groups.some((g) => g.length === 1 && g[0] === 4)).toBe(true);
  });

  it("places an island by distance once no border merge is left", () => {
    // Two isolated shapes and a target of one: only the fallback can finish.
    const isolated = [new Set<number>(), new Set<number>()];
    const nearest = (_from: number, candidates: readonly number[]): number => candidates[0] as number;
    expect(mergeToTarget([9, 1], isolated, 1, nearest).groups).toHaveLength(1);
    // Without a distance measure it stops rather than guessing.
    expect(mergeToTarget([9, 1], isolated, 1).groups).toHaveLength(2);
  });

  it("is a no-op when the target is already met", () => {
    const plan = mergeToTarget([1, 2, 3], chain(3), 5);
    expect(plan.groups).toEqual([[0], [1], [2]]);
  });
});

/* ------------------------------------------------------------------ simplifier -- */

describe("simplifyRing and fitVertexBudget", () => {
  /** A circle of `n` points — the worst case for a vertex budget. */
  const circle = (n: number, r = 100): Ring => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [Math.round((500 + r * Math.cos(t)) * 64) / 64, Math.round((500 + r * Math.sin(t)) * 64) / 64] as Point;
  });

  it("removes a collinear vertex and keeps a corner", () => {
    const ring: Ring = [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]];
    const simplified = simplifyRing(ring, 0.5);
    expect(simplified.length).toBe(4);
    expect(ringArea(simplified)).toBeCloseTo(ringArea(ring), 6);
  });

  it("never grows a ring, and never drops below a triangle", () => {
    const ring = circle(200);
    for (const tolerance of [0, 0.1, 1, 5, 20, 80, 400, 5000]) {
      const simplified = simplifyRing(ring, tolerance);
      expect(simplified.length).toBeLessThanOrEqual(ring.length);
      expect(simplified.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("is monotone in tolerance — the property fitVertexBudget bisects on", () => {
    // The regression: a collapse guard that returned the INPUT made a wide
    // tolerance yield MORE vertices than a narrow one, so the bisection walked
    // away from the answer and every outline came out a triangle.
    const ring = circle(300);
    const tolerances = [0.05, 0.2, 0.8, 3, 12, 50, 200, 900, 4000];
    const counts = tolerances.map((t) => simplifyRing(ring, t).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `tolerance ${tolerances[i]}`).toBeLessThanOrEqual(counts[i - 1] as number);
    }
    expect(counts[counts.length - 1]).toBe(3);
  });

  it("is stable under rotation of the vertex list", () => {
    // Anchoring on the shape's diameter rather than on `ring[0]` is what makes a
    // rebuild byte-identical.
    const ring = circle(64);
    const rotated = [...ring.slice(17), ...ring.slice(0, 17)];
    const a = simplifyRing(ring, 4).length;
    const b = simplifyRing(rotated, 4).length;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it("keeps endpoints fixed on an open polyline", () => {
    const line: Ring = [[0, 0], [10, 1], [20, 0], [30, 1], [40, 0]];
    const simplified = simplifyOpen(line, 5);
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified[simplified.length - 1]).toEqual([40, 0]);
    expect(simplified).toHaveLength(2);
  });

  it("fits a dense ring into the budget and spends most of it", () => {
    const fitted = fitVertexBudget([circle(400)], 30, 1024);
    const total = fitted.reduce((n, r) => n + r.length, 0);
    expect(total).toBeLessThanOrEqual(30);
    expect(total).toBeGreaterThan(20);
  });

  it("shares one budget across an archipelago, largest island first", () => {
    const fitted = fitVertexBudget([circle(120, 100), circle(120, 30), circle(120, 4)], 30, 1024);
    expect(fitted.reduce((n, r) => n + r.length, 0)).toBeLessThanOrEqual(30);
    // Biggest-first, so dropping from the tail drops the least land.
    const areas = fitted.map((r) => ringArea(r));
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);
  });

  it("leaves a ring alone when it already fits", () => {
    const ring = circle(8);
    expect(fitVertexBudget([ring], 30, 1024)[0]).toHaveLength(8);
  });

  it("round-trips through ringsToPath with the vertex count intact", () => {
    const fitted = fitVertexBudget([circle(400)], 30, 1024);
    const d = ringsToPath(fitted);
    expect(countVertices(d)).toBe(fitted.reduce((n, r) => n + r.length, 0));
  });
});

/* ------------------------------------------------------------------ projection -- */

describe("fitProjection", () => {
  it("fills the frame it is given", () => {
    const countries = worldCountries().filter((f) => f.continent === "Africa");
    const project = fitProjection("equalEarth", countries, 1000, 1200, 20);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const f of countries) {
      for (const ring of f.rings) {
        for (const p of ring) {
          const out = project(p);
          if (out === null) continue;
          minX = Math.min(minX, out[0]);
          maxX = Math.max(maxX, out[0]);
          minY = Math.min(minY, out[1]);
          maxY = Math.max(maxY, out[1]);
        }
      }
    }
    expect(minX).toBeGreaterThanOrEqual(19.9);
    expect(minY).toBeGreaterThanOrEqual(19.9);
    expect(maxX).toBeLessThanOrEqual(980.1);
    expect(maxY).toBeLessThanOrEqual(1180.1);
    // One axis is filled exactly; the other is centred.
    expect(Math.max(maxX - minX, maxY - minY)).toBeGreaterThan(900);
  });

  it("refuses a projection that collapses rather than emitting empty polygons", () => {
    // The Europe regression: `conicConformal` with no rotation sends the far
    // hemisphere towards infinity, and a fit measured by d3's spherical path
    // bounds then scaled Europe to 16% of the frame, silently.
    const europe = worldCountries().filter((f) => f.continent === "Europe");
    expect(() => fitProjection("conicConformal", europe, 1600, 1000, 28)).not.toThrow();
    const project = fitProjection("conicConformal", europe, 1600, 1000, 28);
    const sample = project([10, 50]);
    expect(sample).not.toBeNull();
  });

  it("quantises onto a grid fine enough to be invisible and coarse enough to match", () => {
    expect(quantise(1 / 3)).toBe(Math.round((1 / 3) * QUANTUM) / QUANTUM);
    expect(quantise(-0.001)).toBe(0);
    expect(Object.is(quantise(-0.001), -0)).toBe(false);
  });

  it("measures extent as an unsigned ranking", () => {
    expect(extentOf([box(0, 0, 10, 10)])).toBeCloseTo(100, 6);
    expect(extentOf([[...box(0, 0, 10, 10)].reverse()])).toBeCloseTo(100, 6);
    expect(extentOf([])).toBe(0);
  });
});

/* ------------------------------------------------------------------ svg reading -- */

describe("reading the TotalRisk SVGs", () => {
  it("pulls an attribute whatever the order, which is the documented gotcha", () => {
    // `napoleonMap.svg` puts `d=` before `id=`; `worldMap.svg` does the opposite.
    const dFirst = '<path d="M0 0L1 1Z" id="Egypt"/>';
    const idFirst = '<path id="Egypt" d="M0 0L1 1Z"/>';
    for (const tag of [dFirst, idFirst]) {
      expect(attribute(tag, "id")).toBe("Egypt");
      expect(attribute(tag, "d")).toBe("M0 0L1 1Z");
    }
    expect(attribute(idFirst, "class")).toBeNull();
  });

  it("decodes the escaped ampersand that silently loses 8 of 59 territories", () => {
    expect(decodeEntities("Aragon &amp; Castile")).toBe("Aragon & Castile");
    expect(attribute('<path id="Aragon &amp; Castile" d="M0 0"/>', "id")).toBe("Aragon & Castile");
    expect(decodeEntities("&#206;le-de-France")).toBe("Île-de-France");
  });

  it("normalises a name past punctuation, case and accents", () => {
    expect(normaliseName("Aragon & Castile")).toBe(normaliseName("aragon and castile"));
    expect(normaliseName("Île-de-France")).toBe("iledefrance");
    expect(normaliseName("Galicia & León")).toBe("galiciaandleon");
  });

  it("composes the group transforms the files hang their content off", () => {
    expect(parseTransform("matrix(1, 0, 0, 1, 1.76, -4.24)")).toEqual([1, 0, 0, 1, 1.76, -4.24]);
    expect(parseTransform("translate(5 7)")).toEqual([1, 0, 0, 1, 5, 7]);
    expect(parseTransform(null)).toEqual([1, 0, 0, 1, 0, 0]);
    // translate(2,3) then translate(4,5) is translate(6,8).
    expect(multiply([1, 0, 0, 1, 2, 3], [1, 0, 0, 1, 4, 5])).toEqual([1, 0, 0, 1, 6, 8]);
  });
});

/* ------------------------------------------------------------------ naming and suits -- */

describe("naming", () => {
  it("names split pieces by the band they sit in, uniquely", () => {
    const centres: Point[] = [[0, 0], [100, 0], [0, 100], [100, 100]];
    const names = bandNames(centres, "Canada");
    expect(new Set(names).size).toBe(4);
    for (const name of names) expect(name).toContain("Canada");
    expect(bandNames([[0, 0]], "Canada")).toEqual(["Canada"]);
  });

  it("calls the middle band Central rather than Mid Mid", () => {
    const grid: Point[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) grid.push([x * 100, y * 100]);
    const names = bandNames(grid, "Europe");
    expect(names).toContain("Central Europe");
    expect(names.join(" ")).not.toContain("Mid Mid");
    expect(new Set(names).size).toBe(9);
  });

  it("slugifies past diacritics and dedupes", () => {
    const taken = new Set<string>();
    expect(slugify("Côte d'Ivoire", taken)).toBe("cote_d_ivoire");
    expect(slugify("Galicia & León", taken)).toBe("galicia_leon");
    expect(slugify("Galicia & León", taken)).toBe("galicia_leon_2");
    expect(slugifyKebab("Australia & New Zealand")).toBe("australia-new-zealand");
  });

  it("counts in Roman numerals for a band that takes two groups", () => {
    expect([1, 2, 4, 5, 9, 10].map(toRoman)).toEqual(["I", "II", "IV", "V", "IX", "X"]);
  });
});

describe("assignSuits", () => {
  it("round-robins by index, so the three counts differ by at most one", () => {
    for (const n of [3, 20, 42, 47, 59, 104]) {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      const counts: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
      for (const suit of assignSuits(ids)) counts[suit] = (counts[suit] ?? 0) + 1;
      const values = Object.values(counts);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });

  it("honours a sourced suit by swapping, so the deck stays balanced", () => {
    const ids = Array.from({ length: 42 }, (_, i) => `t${i}`);
    // t0 is infantry by round-robin; pin it to artillery.
    const suits = assignSuits(ids, { t0: "artillery" });
    expect(suits[0]).toBe("artillery");
    const counts: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
    for (const suit of suits) counts[suit] = (counts[suit] ?? 0) + 1;
    expect(counts).toEqual({ infantry: 14, cavalry: 14, artillery: 14 });
  });

  it("leaves a sourced suit that already matches alone", () => {
    const ids = ["a", "b", "c"];
    expect(assignSuits(ids, { a: "infantry" })).toEqual(["infantry", "cavalry", "artillery"]);
  });

  it("is deterministic in the order the sourced suits are given", () => {
    const ids = Array.from({ length: 42 }, (_, i) => `t${i}`);
    const a = assignSuits(ids, { t0: "artillery", t5: "infantry", t9: "cavalry" });
    const b = assignSuits(ids, { t9: "cavalry", t0: "artillery", t5: "infantry" });
    expect(a).toEqual(b);
  });
});
