/**
 * `@/engine/map` unit tests — the loader's own behaviour (SPEC §4.5, §4.14).
 *
 * The catalogue-wide gates (T7) live in `src/content/maps/maps.test.ts`, because
 * the layering guard forbids the engine from importing `@/content`. What is
 * tested here is the schema itself, on hand-built files: the sea-link union
 * (F45), index resolution, continent borders, the anchor solver and the slot
 * helpers.
 */

import { describe, expect, it } from "vitest";

import { anchorsFor, LABEL_OFFSET_Y, poleOf } from "./anchors";
import { bonusFor, componentsOf, growGroups, sharedVertexAdjacency, slotsForSize } from "./graph";
import {
  bboxOfRings, countVertices, largestRing, parseRings, pointInRing, pointInRings, ringArea,
  ringsToPath, tokenisePath, type Point,
} from "./path";
import { checkMap, loadMap, parseViewBox, validateMap } from "./schema";
import { blizzardCandidates, boundedU32, portalCandidates, shuffledIndices, slotsFor } from "./slots";

import type { MapFile } from "../types";

/**
 * Break one field of an otherwise-valid map, on purpose.
 *
 * `MapFile` is `readonly` throughout, which is right for every caller and
 * inconvenient for exactly these tests: a validator is only worth anything if
 * something proves it rejects a malformed file.
 */
function poke(target: unknown, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

/** A square at `(x, y)`, 100 units a side, as a `d`. */
function square(x: number, y: number): string {
  return ringsToPath([[[x, y], [x + 100, y], [x + 100, y + 100], [x, y + 100]]]);
}

/**
 * A four-territory board: `a b` on the top row, `c d` below, a ring of land
 * borders a–b–d–c–a, and one sea link across the diagonal.
 */
function board(overrides: Partial<MapFile> = {}): MapFile {
  const at: Record<string, [number, number]> = { a: [0, 0], b: [100, 0], c: [0, 100], d: [100, 100] };
  const land: Record<string, string[]> = { a: ["b", "c"], b: ["a", "d"], c: ["a", "d"], d: ["b", "c"] };
  const suits: readonly ["infantry", "cavalry", "artillery", "infantry"] =
    ["infantry", "cavalry", "artillery", "infantry"];
  return {
    slug: "test-board",
    name: "Test Board",
    viewBox: "0 0 200 200",
    continents: [
      { id: "top", name: "Top", bonus: 2, color: "#36B0EA", territories: ["a", "b"] },
      { id: "bottom", name: "Bottom", bonus: 3, color: "#DA3A4F", territories: ["c", "d"] },
    ],
    territories: (["a", "b", "c", "d"] as const).map((id, i) => ({
      id,
      name: id.toUpperCase(),
      continent: i < 2 ? "top" : "bottom",
      suit: suits[i] ?? "infantry",
      adjacent: land[id] as string[],
      d: square((at[id] as [number, number])[0], (at[id] as [number, number])[1]),
      tokenX: (at[id] as [number, number])[0] + 50,
      tokenY: (at[id] as [number, number])[1] + 50,
      labelX: (at[id] as [number, number])[0] + 50,
      labelY: (at[id] as [number, number])[1] + 76,
    })),
    seaLinks: [{ from: "a", to: "d" }],
    modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ loadMap -- */

describe("loadMap", () => {
  it("resolves string ids to indices in file order", () => {
    const map = loadMap(board());
    expect(map.territories.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(map.territories.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    expect(map.continents.map((c) => c.index)).toEqual([0, 1]);
    expect(map.territories.map((t) => t.continent)).toEqual([0, 0, 1, 1]);
  });

  it("unions the sea links into adjacent and adjacency, sorted ascending (F45)", () => {
    const map = loadMap(board());
    // `a` is authored next to b and c; the sea link adds d.
    expect(map.territories[0]?.adjacent).toEqual([1, 2, 3]);
    expect(map.adjacency[0]).toEqual([1, 2, 3]);
    expect(map.territories[3]?.adjacent).toEqual([0, 1, 2]);
    // Territory.adjacent and MapDef.adjacency must agree exactly (F45).
    for (const t of map.territories) expect(map.adjacency[t.index]).toEqual(t.adjacent);
  });

  it("keeps seaLinked as the drawable subset of adjacent", () => {
    const map = loadMap(board());
    expect(map.territories[0]?.seaLinked).toEqual([3]);
    expect(map.territories[1]?.seaLinked).toEqual([]);
    expect(map.territories[3]?.seaLinked).toEqual([0]);
  });

  it("counts a sea link once, not twice", () => {
    const map = loadMap(board());
    const edges = map.adjacency.reduce((n, row) => n + row.length, 0) / 2;
    expect(edges).toBe(5); // four land borders plus one sea link
  });

  it("carries the authored suit straight across", () => {
    const map = loadMap(board());
    expect(map.territories.map((t) => t.suit)).toEqual(["infantry", "cavalry", "artillery", "infantry"]);
  });

  it("computes a continent's border as the territories with an external edge", () => {
    const map = loadMap(board());
    // Every territory here has an edge out of its continent.
    expect(map.continents[0]?.border).toEqual([0, 1]);
    expect(map.continents[0]?.territories).toEqual([0, 1]);
  });

  it("leaves a fully interior territory out of its continent's border", () => {
    // `a` keeps only the border to `b`, so it has no edge out of "top".
    const file = board({
      territories: board().territories.map((t) =>
        t.id === "a" ? { ...t, adjacent: ["b"] } : t.id === "c" ? { ...t, adjacent: ["d"] } : t),
      seaLinks: [{ from: "a", to: "d" }, { from: "b", to: "c" }],
    });
    const map = loadMap(file);
    expect(map.continents[0]?.border).toEqual([0, 1]);
    const noSea = loadMap({ ...file, seaLinks: [{ from: "b", to: "c" }] });
    // Without the a–d sea link, `a` touches nothing outside "top".
    expect(noSea.continents[0]?.border).toEqual([1]);
  });

  it("parses the viewBox into four numbers", () => {
    expect(loadMap(board()).viewBox).toEqual([0, 0, 200, 200]);
    expect(parseViewBox("0 8 1024 643")).toEqual([0, 8, 1024, 643]);
    expect(parseViewBox("0,8,1024,643")).toEqual([0, 8, 1024, 643]);
    expect(parseViewBox("0 8 1024")).toBeNull();
    expect(parseViewBox("0 8 0 643")).toBeNull();
    expect(parseViewBox("a b c d")).toBeNull();
  });

  it("throws, listing every fault, rather than returning a broken MapDef", () => {
    const file = board();
    poke(file.territories[0], "adjacent", ["nowhere"]);
    expect(() => loadMap(file)).toThrow(/invalid map test-board/);
    expect(() => loadMap(file)).toThrow(/nowhere/);
  });

  it("preserves modifierSlots verbatim", () => {
    expect(loadMap(board()).modifierSlots).toEqual({ blizzards: 2, portals: 3, capitals: 6 });
  });
});

/* ------------------------------------------------------------------ validateMap -- */

describe("validateMap", () => {
  it("passes a well-formed board", () => {
    expect(validateMap(board())).toEqual([]);
    expect(checkMap(board())).toEqual({ valid: true, errors: [] });
  });

  it("also reports through SPEC §4.14's { valid, errors } shape", () => {
    const file = board({ slug: "Not Kebab" });
    const result = checkMap(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(validateMap(file));
  });

  it("catches a duplicate territory id", () => {
    const file = board();
    poke(file.territories[1], "id", "a");
    expect(validateMap(file).join("\n")).toMatch(/duplicate territory id a/);
  });

  it("catches a territory adjacent to itself", () => {
    const file = board();
    poke(file.territories[0], "adjacent", ["a", "b", "c"]);
    expect(validateMap(file).join("\n")).toMatch(/adjacent to itself/);
  });

  it("catches a territory claimed by two continents", () => {
    const file = board();
    poke(file.continents[1], "territories", ["a", "c", "d"]);
    expect(validateMap(file).join("\n")).toMatch(/listed by two continents/);
  });

  it("catches geometry that leaves the viewBox", () => {
    const file = board({ viewBox: "0 0 150 150" });
    expect(validateMap(file).join("\n")).toMatch(/leaves the viewBox/);
  });

  it("catches a label anchor outside the viewBox", () => {
    const file = board();
    poke(file.territories[0], "labelY", 5000);
    expect(validateMap(file).join("\n")).toMatch(/label anchor is outside the viewBox/);
  });

  it("catches an id that is not lower_snake_case", () => {
    const file = board();
    poke(file.territories[0], "id", "Territory-A");
    expect(validateMap(file).join("\n")).toMatch(/not lower_snake_case/);
  });

  it("catches a territory with fewer than three vertices", () => {
    const file = board();
    poke(file.territories[0], "d", "M0 0L10 10Z");
    expect(validateMap(file).join("\n")).toMatch(/has 2 vertices/);
  });

  it("catches a territory over the vertex budget", () => {
    const ring: Point[] = Array.from({ length: 40 }, (_, i) => [50 + 40 * Math.cos(i), 50 + 40 * Math.sin(i)]);
    const file = board();
    poke(file.territories[0], "d", ringsToPath([ring]));
    expect(validateMap(file).join("\n")).toMatch(/more than 30/);
  });

  it("catches a duplicate sea link", () => {
    const file = board({ seaLinks: [{ from: "a", to: "d" }, { from: "d", to: "a" }] });
    expect(validateMap(file).join("\n")).toMatch(/duplicate sea link/);
  });

  it("accepts a capitals count up to MAX_SEATS and refuses more", () => {
    expect(validateMap(board({ modifierSlots: { blizzards: 2, portals: 3, capitals: 6 } }))).toEqual([]);
    expect(validateMap(board({ modifierSlots: { blizzards: 2, portals: 3, capitals: 7 } })).join("\n"))
      .toMatch(/capitals 7 is outside/);
  });
});

/* ------------------------------------------------------------------ path -- */

describe("path arithmetic", () => {
  it("tokenises implicit repeats and sign-as-separator", () => {
    expect(tokenisePath("M0 0L1 1 2 2Z")).toEqual([
      { cmd: "M", args: [0, 0] }, { cmd: "L", args: [1, 1, 2, 2] }, { cmd: "Z", args: [] },
    ]);
    expect(tokenisePath("M1-2")).toEqual([{ cmd: "M", args: [1, -2] }]);
    expect(tokenisePath("M1e2 3.5")).toEqual([{ cmd: "M", args: [100, 3.5] }]);
  });

  it("counts one vertex per command endpoint, not per curve sample", () => {
    expect(countVertices("M0 0L10 0L10 10Z")).toBe(3);
    // One cubic is one endpoint, however finely it is flattened.
    expect(countVertices("M0 0C1 1 2 2 3 3Z")).toBe(2);
    // An implicit repeat is two.
    expect(countVertices("M0 0C1 1 2 2 3 3 4 4 5 5 6 6Z")).toBe(3);
  });

  it("flattens a cubic into a ring that encloses the right area", () => {
    const rings = parseRings("M0 0C0 0 100 0 100 0C100 0 100 100 100 100L0 100Z");
    expect(rings).toHaveLength(1);
    expect(ringArea(rings[0] as Point[])).toBeCloseTo(10000, 0);
  });

  it("reads relative commands and multiple subpaths", () => {
    const rings = parseRings("M0 0l10 0l0 10zM100 100l10 0l0 10z");
    expect(rings).toHaveLength(2);
    expect(rings[0]?.[1]).toEqual([10, 0]);
    expect(rings[1]?.[0]).toEqual([100, 100]);
  });

  it("drops a subpath that cannot enclose area", () => {
    expect(parseRings("M0 0L10 10Z")).toHaveLength(0);
  });

  it("finds the largest ring and tests membership per subpath", () => {
    const rings = parseRings(`${square(0, 0)}${ringsToPath([[[500, 500], [510, 500], [510, 510]]])}`);
    expect(largestRing(rings)).toEqual(rings[0]);
    expect(pointInRing([50, 50], rings[0] as Point[])).toBe(true);
    expect(pointInRing([505, 505], rings[0] as Point[])).toBe(false);
    expect(pointInRings([503, 502], rings)).toBe(true);
    expect(pointInRings([300, 300], rings)).toBe(false);
  });

  it("measures a bounding box over every subpath", () => {
    expect(bboxOfRings(parseRings(`${square(0, 0)}${square(200, 300)}`))).toEqual([0, 0, 300, 400]);
    expect(bboxOfRings([])).toBeNull();
  });

  it("round-trips rings through a path string", () => {
    const rings = [[[0, 0], [10, 0], [10, 10]] as Point[]];
    expect(ringsToPath(rings)).toBe("M0 0L10 0L10 10Z");
    expect(parseRings(ringsToPath(rings))).toEqual(rings);
    // Negative zero never reaches the file.
    expect(ringsToPath([[[-0.01, 0], [10, 0], [10, 10]] as Point[]])).toBe("M0 0L10 0L10 10Z");
  });
});

/* ------------------------------------------------------------------ anchors -- */

describe("anchorsFor", () => {
  it("puts the token at the centre of a square and the label below it", () => {
    const anchors = anchorsFor(square(0, 0));
    expect(anchors.token).toEqual([50, 50]);
    expect(anchors.label).toEqual([50, 50 + LABEL_OFFSET_Y]);
  });

  it("puts the token inside a crescent, where a centroid would miss", () => {
    // A C-shape: the vertex mean lands in the gap.
    const crescent: Point[] = [
      [0, 0], [100, 0], [100, 30], [40, 30], [40, 70], [100, 70], [100, 100], [0, 100],
    ];
    const d = ringsToPath([crescent]);
    const anchors = anchorsFor(d);
    expect(pointInRings(anchors.token, parseRings(d))).toBe(true);
    let sx = 0;
    for (const p of crescent) sx += p[0];
    // The mean x sits in the notch; the pole does not.
    expect(sx / crescent.length).toBeGreaterThan(40);
    expect(anchors.token[0]).toBeLessThan(40);
  });

  it("solves on the largest subpath, not the average of them", () => {
    const d = `${square(0, 0)}${ringsToPath([[[900, 900], [910, 900], [910, 910], [900, 910]] as Point[]])}`;
    const anchors = anchorsFor(d);
    expect(anchors.token[0]).toBeLessThan(200);
    expect(pointInRings(anchors.token, parseRings(d))).toBe(true);
  });

  it("returns the origin for empty geometry rather than throwing", () => {
    expect(poleOf([])).toEqual([0, 0]);
    expect(anchorsFor("").token).toEqual([0, 0]);
  });

  it("is deterministic", () => {
    expect(anchorsFor(square(13, 29))).toEqual(anchorsFor(square(13, 29)));
  });
});

/* ------------------------------------------------------------------ graph -- */

describe("graph helpers", () => {
  it("prices Classic's continents within one of Hasbro's own numbers", () => {
    // size, borders → bonus. North America 9/3, South America 4/2, Europe 7/4,
    // Africa 6/3, Asia 12/5, Australia 4/1.
    expect(bonusFor(9, 3)).toBe(5); // actual 5
    expect(bonusFor(4, 2)).toBe(2); // actual 2
    expect(bonusFor(7, 4)).toBe(4); // actual 5
    expect(bonusFor(6, 3)).toBe(4); // actual 3
    expect(bonusFor(12, 5)).toBe(7); // actual 7
    expect(bonusFor(4, 1)).toBe(2); // actual 2
    expect(bonusFor(1, 0)).toBe(1); // never zero
  });

  it("tracks the catalogue's blizzard and portal counts", () => {
    expect(slotsForSize(42, 6)).toEqual({ blizzards: 3, portals: 5, capitals: 6 });
    expect(slotsForSize(37, 6)).toEqual({ blizzards: 2, portals: 4, capitals: 6 });
    // Clamped into R74/R76's ranges at both ends.
    expect(slotsForSize(3, 6).blizzards).toBe(2);
    expect(slotsForSize(3, 6).portals).toBe(3);
    expect(slotsForSize(400, 6)).toEqual({ blizzards: 11, portals: 7, capitals: 6 });
  });

  it("finds components, ordered by their lowest member", () => {
    const adjacency = [new Set([1]), new Set([0]), new Set([3]), new Set([2]), new Set<number>()];
    expect(componentsOf(adjacency)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("grows connected groups of even size", () => {
    // A 3x3 grid split three ways.
    const centres: Point[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) centres.push([x, y]);
    const adjacency = centres.map((_, i) => {
      const set = new Set<number>();
      const x = i % 3;
      const y = Math.floor(i / 3);
      if (x > 0) set.add(i - 1);
      if (x < 2) set.add(i + 1);
      if (y > 0) set.add(i - 3);
      if (y < 2) set.add(i + 3);
      return set;
    });
    const owner = growGroups(3, adjacency, centres);
    const sizes = [0, 1, 2].map((g) => owner.filter((o) => o === g).length);
    expect(sizes).toEqual([3, 3, 3]);
    // Each group is connected.
    for (const g of [0, 1, 2]) {
      const members = owner.map((o, i) => (o === g ? i : -1)).filter((i) => i >= 0);
      const seen = new Set([members[0] as number]);
      const queue = [members[0] as number];
      while (queue.length > 0) {
        for (const n of adjacency[queue.pop() as number] ?? []) {
          if (owner[n] === g && !seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect(seen.size).toBe(members.length);
    }
  });

  it("is reproducible from the graph, the centres and the first seed", () => {
    const centres: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0]];
    const adjacency = [new Set([1]), new Set([0, 2]), new Set([1, 3]), new Set([2])];
    expect(growGroups(2, adjacency, centres, 0)).toEqual(growGroups(2, adjacency, centres, 0));
  });

  it("derives adjacency from two or more shared vertices", () => {
    const a: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const shares = sharedVertexAdjacency([[a], [[[10, 0], [20, 0], [20, 10], [10, 10]] as Point[]]]);
    expect([...(shares[0] ?? [])]).toEqual([1]);
    const corner = sharedVertexAdjacency([[a], [[[10, 10], [20, 10], [20, 20]] as Point[]]]);
    expect([...(corner[0] ?? [])]).toEqual([]);
  });
});

/* ------------------------------------------------------------------ slots -- */

describe("slot placement", () => {
  /** A deterministic counter — the helpers must be pure in whatever they are given. */
  const counter = (start = 1): (() => number) => {
    let n = start;
    return () => {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n;
    };
  };

  it("draws an unbiased bounded integer", () => {
    const next = counter();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(boundedU32(next, 4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(boundedU32(next, 1)).toBe(0);
    expect(boundedU32(next, 0)).toBe(0);
  });

  it("shuffles a permutation, deterministically", () => {
    const a = shuffledIndices(10, counter());
    const b = shuffledIndices(10, counter());
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("never freezes a continent solid, and never cuts the board in two", () => {
    // A chain a–b–c–d: freezing b or c would disconnect it.
    const chain = board({
      territories: board().territories.map((t) => ({
        ...t,
        adjacent: { a: ["b"], b: ["a", "c"], c: ["b", "d"], d: ["c"] }[t.id] as string[],
      })),
      seaLinks: [],
      continents: [
        { id: "top", name: "Top", bonus: 2, color: "#36B0EA", territories: ["a", "b"] },
        { id: "bottom", name: "Bottom", bonus: 3, color: "#DA3A4F", territories: ["c", "d"] },
      ],
    });
    const map = loadMap(chain);
    const blizzards = blizzardCandidates(map, 2, counter());
    // Only the two ends can freeze without splitting the chain.
    expect(blizzards.every((b) => b === 0 || b === 3)).toBe(true);
    expect(blizzards).toEqual([...blizzards].sort((a, b) => a - b));
  });

  it("is deterministic in the generator it is given", () => {
    const map = loadMap(board());
    expect(blizzardCandidates(map, 2, counter())).toEqual(blizzardCandidates(map, 2, counter()));
    expect(portalCandidates(map, 1, counter())).toEqual(portalCandidates(map, 1, counter()));
  });

  it("never pairs a portal with an adjacent territory or reuses an endpoint", () => {
    // The ring a-b-d-c-a plus the a-d sea link leaves b-c as the one
    // non-adjacent pair, and no endpoint can serve twice — so one portal, not two.
    const map = loadMap(board());
    expect(portalCandidates(map, 2, counter())).toEqual([{ a: 1, b: 2 }]);

    // Drop the sea link and a-d opens up as well: two disjoint pairs.
    const open = loadMap(board({ seaLinks: [] }));
    expect(portalCandidates(open, 2, counter())).toEqual([{ a: 0, b: 3 }, { a: 1, b: 2 }]);
    // Asking for one yields one.
    expect(portalCandidates(open, 1, counter())).toHaveLength(1);
  });

  it("excludes a blizzard tile from every portal", () => {
    const open = loadMap(board({ seaLinks: [] }));
    // Freezing `a` kills the a-d pair; b-c survives.
    expect(portalCandidates(open, 2, counter(), [0])).toEqual([{ a: 1, b: 2 }]);
    // Freezing `a` and `b` leaves c-d, which is a land border, so nothing.
    expect(portalCandidates(open, 2, counter(), [0, 1])).toEqual([]);
  });

  it("clamps a declared slot count to what the map can hold", () => {
    const map = loadMap(board());
    expect(slotsFor(map, 6)).toEqual({ blizzards: 2, portals: 2, capitals: 4 });
    expect(slotsFor(map, 2).capitals).toBe(2);
  });
});
