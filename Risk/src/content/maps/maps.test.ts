/**
 * **T7 — the map validator** (SPEC §11), plus **T1b**.
 *
 * `validateMap` run against every shipped map and the four fixtures, the
 * Classic graph's own adjudicated facts, the 100 KB ceiling, the vertex budget,
 * anchors inside their own polygons, suit balance, and the generator's
 * reproducibility. This suite lives here rather than under `src/engine/` because
 * the layering guard (T1) forbids the engine from importing `@/content` — and
 * the thing under test is the content.
 *
 * `pnpm run build:maps` shells out to this file after writing, so the build and
 * the test share one validator (D36).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIXTURE_SLUGS, loadMapFile, MAP_SLUGS } from "./index";
import {
  countVertices, generateVoronoiMap, loadMap, MAX_VERTICES, MIN_VERTICES, normaliseOptions,
  parseRings, pointInRings, validateMap,
} from "@/engine/map";
import { MAX_SEATS, type MapFile } from "@/engine/types";

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

/** §10's ceiling, on the minified JSON (F53). */
const SIZE_LIMIT = 100 * 1024;
const MAPS_DIR = join(process.cwd(), "src", "content", "maps");

/** Loaded once: sixteen boards is 286 KB and every block below reads them. */
const FILES: Map<string, MapFile> = new Map(
  await Promise.all(MAP_SLUGS.map(async (slug) => [slug, await loadMapFile(slug)] as const)),
);

function fileFor(slug: string): MapFile {
  const file = FILES.get(slug);
  if (file === undefined) throw new Error(`no map loaded for ${slug}`);
  return file;
}

/** Undirected edges after `loadMap`'s union of land borders and sea links (F45). */
function edgeCount(slug: string): number {
  const map = loadMap(fileFor(slug));
  return map.adjacency.reduce((n, row) => n + row.length, 0) / 2;
}

function hasEdge(slug: string, a: string, b: string): boolean {
  const map = loadMap(fileFor(slug));
  const at = (id: string): number => map.territories.findIndex((t) => t.id === id);
  const x = at(a);
  const y = at(b);
  expect(x, `${slug} has no territory ${a}`).toBeGreaterThanOrEqual(0);
  expect(y, `${slug} has no territory ${b}`).toBeGreaterThanOrEqual(0);
  return (map.adjacency[x] ?? []).includes(y);
}

/* ------------------------------------------------------------------ the catalogue -- */

describe("the catalogue", () => {
  it("enumerates sixteen boards, the four fixtures last", () => {
    expect(MAP_SLUGS).toHaveLength(16);
    expect(new Set(MAP_SLUGS).size).toBe(16);
    expect(MAP_SLUGS.slice(-4)).toEqual(FIXTURE_SLUGS);
  });

  it("rejects an unknown slug rather than resolving to nothing", async () => {
    await expect(loadMapFile("no-such-board")).rejects.toThrow(/unknown map slug/);
  });

  it("loads a file whose slug matches the one it was asked for", () => {
    for (const slug of MAP_SLUGS) expect(fileFor(slug).slug).toBe(slug);
  });
});

/* ------------------------------------------------------------------ T7 -- */

describe("T7 — validateMap over every shipped map", () => {
  for (const slug of MAP_SLUGS) {
    it(`${slug} validates clean`, () => {
      expect(validateMap(fileFor(slug))).toEqual([]);
    });
  }

  it("loads every map without throwing", () => {
    for (const slug of MAP_SLUGS) expect(() => loadMap(fileFor(slug))).not.toThrow();
  });

  it("keeps every map's minified JSON under 100 KB", () => {
    const oversize = MAP_SLUGS
      .map((slug) => ({ slug, bytes: readFileSync(join(MAPS_DIR, `${slug}.json`), "utf8").length }))
      .filter((m) => JSON.stringify(fileFor(m.slug)).length > SIZE_LIMIT);
    expect(oversize).toEqual([]);
  });

  it("spends 3 to 30 vertices on every territory (§8)", () => {
    const outside: string[] = [];
    for (const slug of MAP_SLUGS) {
      for (const t of fileFor(slug).territories) {
        const n = countVertices(t.d);
        if (n < MIN_VERTICES || n > MAX_VERTICES) outside.push(`${slug}/${t.id}=${n}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it("puts every token anchor inside its own polygon", () => {
    // An independent point-in-polygon test, not the one `validateMap` runs:
    // a centroid lands in the sea for anything crescent-shaped, which is the
    // whole reason the anchors are poles of inaccessibility (§8).
    const outside: string[] = [];
    for (const slug of MAP_SLUGS) {
      for (const t of fileFor(slug).territories) {
        if (!pointInRings([t.tokenX, t.tokenY], parseRings(t.d))) outside.push(`${slug}/${t.id}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it("puts every label about 26px below its token, inside the frame", () => {
    for (const slug of MAP_SLUGS) {
      const file = fileFor(slug);
      const parts = file.viewBox.split(/[\s,]+/).map(Number);
      const bottom = (parts[1] as number) + (parts[3] as number);
      for (const t of file.territories) {
        expect(t.labelX, `${slug}/${t.id}`).toBe(t.tokenX);
        expect(t.labelY, `${slug}/${t.id}`).toBeGreaterThan(t.tokenY);
        expect(t.labelY, `${slug}/${t.id}`).toBeLessThanOrEqual(bottom);
      }
    }
  });

  it("balances the three suits to within one card on every map (F7)", () => {
    for (const slug of MAP_SLUGS) {
      const counts: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
      for (const t of fileFor(slug).territories) counts[t.suit] = (counts[t.suit] ?? 0) + 1;
      const values = Object.values(counts);
      expect(Math.max(...values) - Math.min(...values), `${slug} suits ${JSON.stringify(counts)}`)
        .toBeLessThanOrEqual(1);
    }
  });

  it("seats MAX_SEATS capitals on every shipped map", () => {
    for (const slug of MAP_SLUGS) expect(fileFor(slug).modifierSlots.capitals, slug).toBe(MAX_SEATS);
  });

  it("carries the suit through loadMap unchanged", () => {
    for (const slug of MAP_SLUGS) {
      const file = fileFor(slug);
      const map = loadMap(file);
      expect(map.territories.map((t) => t.suit)).toEqual(file.territories.map((t) => t.suit));
    }
  });

  it("keeps seaLinked a subset of adjacent on every map (F45)", () => {
    for (const slug of MAP_SLUGS) {
      const map = loadMap(fileFor(slug));
      for (const t of map.territories) {
        for (const other of t.seaLinked) {
          expect(t.adjacent, `${slug}/${t.id}`).toContain(other);
        }
      }
    }
  });

  it("lists only territories with an external edge in a continent's border", () => {
    for (const slug of MAP_SLUGS) {
      const map = loadMap(fileFor(slug));
      for (const continent of map.continents) {
        const inside = new Set(continent.territories);
        const expected = continent.territories.filter((t) =>
          (map.adjacency[t] ?? []).some((n) => !inside.has(n)));
        expect(continent.border, `${slug}/${continent.id}`).toEqual(expected);
      }
    }
  });
});

/* ------------------------------------------------------------------ Classic's own facts -- */

describe("T7 — the Classic graph's adjudicated facts", () => {
  it("is 42 territories, 6 continents and 83 edges including the 9 sea links", () => {
    const file = fileFor("classic-world");
    expect(file.territories).toHaveLength(42);
    expect(file.continents).toHaveLength(6);
    expect(file.seaLinks).toHaveLength(9);
    // 74 land borders authored, 9 sea links unioned in by loadMap (F45).
    const land = new Set<string>();
    for (const t of file.territories) for (const a of t.adjacent) land.add([t.id, a].sort().join("|"));
    expect(land.size).toBe(74);
    expect(edgeCount("classic-world")).toBe(83);
  });

  it("pays NA 5, SA 2, EU 5, AF 3, AS 7, AU 2", () => {
    const bonuses = Object.fromEntries(fileFor("classic-world").continents.map((c) => [c.id, c.bonus]));
    expect(bonuses).toEqual({
      north_america: 5, south_america: 2, europe: 5, africa: 3, asia: 7, australia: 2,
    });
  });

  it("settles the five adjudicated edges", () => {
    // TotalRisk's graph has a spurious NW Territory–Quebec and omits
    // New Guinea–Western Australia; risk-neighborhood adds China–Middle East and
    // omits two more. Seven independent sources agree on these five verdicts.
    expect(hasEdge("classic-world", "northwest_territory", "quebec")).toBe(false);
    expect(hasEdge("classic-world", "china", "middle_east")).toBe(false);
    expect(hasEdge("classic-world", "eastern_australia", "new_guinea")).toBe(true);
    expect(hasEdge("classic-world", "new_guinea", "western_australia")).toBe(true);
    expect(hasEdge("classic-world", "afghanistan", "india")).toBe(true);
    expect(hasEdge("classic-world", "east_africa", "middle_east")).toBe(true);
  });

  it("has the degree distribution 2→4, 3→13, 4→13, 5→5, 6→7", () => {
    const map = loadMap(fileFor("classic-world"));
    const histogram: Record<number, number> = {};
    for (const row of map.adjacency) histogram[row.length] = (histogram[row.length] ?? 0) + 1;
    expect(histogram).toEqual({ 2: 4, 3: 13, 4: 13, 5: 5, 6: 7 });
  });

  it("deals 14 infantry, 14 cavalry and 14 artillery, honouring the sourced suits", () => {
    const file = fileFor("classic-world");
    const counts: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
    for (const t of file.territories) counts[t.suit] = (counts[t.suit] ?? 0) + 1;
    expect(counts).toEqual({ infantry: 14, cavalry: 14, artillery: 14 });
    // The three the RGD card panel actually shows (research/04a §evidence).
    const suitOf = (id: string): string | undefined => file.territories.find((t) => t.id === id)?.suit;
    expect(suitOf("japan")).toBe("infantry");
    expect(suitOf("indonesia")).toBe("cavalry");
    expect(suitOf("ukraine")).toBe("artillery");
  });

  it("declares Classic's catalogue slot counts: 3 blizzards, 5 portals", () => {
    expect(fileFor("classic-world").modifierSlots).toEqual({ blizzards: 3, portals: 5, capitals: 6 });
  });

  it("keeps the viewBox SPEC §4.5 quotes", () => {
    expect(fileFor("classic-world").viewBox).toBe("0 8 1024 643");
  });
});

/* ------------------------------------------------------------------ the rest of the catalogue -- */

describe("T7 — the counts every other board promises", () => {
  const expected: readonly [string, number, number, number][] = [
    // slug, territories, continents, edges after the sea-link union
    ["world-extended", 47, 6, 94],
    ["napoleonic-europe", 59, 11, 127],
    ["world-simple", 24, 6, 30],
    ["europe", 44, 7, 88],
    ["usa-states", 42, 9, 91],
    ["asia", 48, 9, 102],
    ["africa", 37, 7, 86],
    ["north-america", 38, 7, 72],
    ["south-america", 20, 5, 43],
    ["australia-new-zealand", 38, 8, 79],
    ["middle-east", 30, 6, 57],
    ["tiny3", 3, 1, 3],
    ["tiny4", 4, 1, 6],
    ["mini", 6, 2, 7],
    ["quad", 20, 4, 26],
  ];

  for (const [slug, territories, continents, edges] of expected) {
    it(`${slug} is ${territories}/${continents}/${edges}`, () => {
      const file = fileFor(slug);
      expect(file.territories).toHaveLength(territories);
      expect(file.continents).toHaveLength(continents);
      expect(edgeCount(slug)).toBe(edges);
    });
  }

  it("matches the SMG catalogue's slot counts where it has an entry", () => {
    // Facts about a published game, reused as a balance reference (D1, D38).
    const slots = (slug: string): unknown => fileFor(slug).modifierSlots;
    expect(slots("europe")).toEqual({ blizzards: 3, portals: 5, capitals: 6 });
    expect(slots("usa-states")).toEqual({ blizzards: 3, portals: 5, capitals: 6 });
    expect(slots("asia")).toEqual({ blizzards: 4, portals: 6, capitals: 6 });
    expect(slots("africa")).toEqual({ blizzards: 2, portals: 4, capitals: 6 });
    expect(slots("australia-new-zealand")).toEqual({ blizzards: 2, portals: 4, capitals: 6 });
  });

  it("gives every continent a positive bonus and every board a connected graph", () => {
    for (const slug of MAP_SLUGS) {
      const map = loadMap(fileFor(slug));
      for (const c of map.continents) expect(c.bonus, `${slug}/${c.id}`).toBeGreaterThan(0);
      // `loadMap` would have thrown on a disconnected board; assert the reachable
      // set directly so the gate is visible here rather than implied.
      const seen = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        for (const n of map.adjacency[queue.pop() as number] ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect(seen.size, slug).toBe(map.territories.length);
    }
  });
});

/* ------------------------------------------------------------------ T1b -- */

describe("T1b — the build-time packages never reach src/", () => {
  const BUILD_TIME = ["topojson-client", "mapshaper", "d3-geo"];

  it("finds none of them imported anywhere under src/", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory()
        ? walk(full)
        : /\.(ts|tsx|mts|js|jsx|mjs)$/.test(entry) ? [full] : [];
    });

    const violations: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const name of BUILD_TIME) {
        // An `import` / `from` / `require(` prefix is required, so this test's own
        // list of package names is not itself a hit.
        const specifier = new RegExp(
          `(?:\\bfrom\\s*|\\bimport\\s*|\\brequire\\s*\\(\\s*)["']${name}(?:/[^"']*)?["']`,
        );
        if (specifier.test(source)) {
          violations.push(`${file.slice(process.cwd().length + 1)} imports ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports only polylabel from node_modules inside src/engine/map", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const dir = join(process.cwd(), "src", "engine", "map");
    const walk = (at: string): string[] => readdirSync(at).flatMap((entry) => {
      const full = join(at, entry);
      return statSync(full).isDirectory() ? walk(full) : entry.endsWith(".ts") ? [full] : [];
    });
    const bare = new Set<string>();
    for (const file of walk(dir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["']([^."'][^"']*)["']/g)) {
        bare.add((match[1] as string).split("/")[0] as string);
      }
    }
    bare.delete("vitest");
    expect([...bare].sort()).toEqual(["polylabel"]);
  });
});

/* ------------------------------------------------------------------ the generator -- */

describe("T7 — generateVoronoiMap", () => {
  it("validates clean and is reproducible for 20 seeds", () => {
    for (let i = 0; i < 20; i++) {
      const options = normaliseOptions({
        territories: 19 + i * 4,
        continents: 4 + (i % 8),
      });
      const seed = `t7-seed-${i}`;
      const file = generateVoronoiMap(options, seed);
      expect(validateMap(file), `seed ${seed}`).toEqual([]);
      expect(file.territories).toHaveLength(options.territories);
      expect(file.continents).toHaveLength(options.continents);
      // Reproducible from `(options, seed)` alone — byte-identical, not merely
      // equivalent, because a generated map's slug is minted from its seed and a
      // replay has to reload the same board.
      expect(JSON.stringify(generateVoronoiMap(options, seed))).toEqual(JSON.stringify(file));
      expect(JSON.stringify(file).length).toBeLessThan(SIZE_LIMIT);
    }
  });

  it("gives a different board for a different seed", () => {
    const options = normaliseOptions({ territories: 42, continents: 6 });
    const a = generateVoronoiMap(options, "seed-a");
    const b = generateVoronoiMap(options, "seed-b");
    expect(a.slug).not.toBe(b.slug);
    expect(JSON.stringify(a.territories)).not.toEqual(JSON.stringify(b.territories));
  });

  it("clamps the options into SPEC §4.14's ranges", () => {
    expect(normaliseOptions({ territories: 2, continents: 99 })).toMatchObject({
      territories: 19, continents: 9, width: 1600, height: 900,
    });
    expect(normaliseOptions({ territories: 500, continents: 1 })).toMatchObject({
      territories: 104, continents: 4,
    });
    // seaLinks defaults to round(territories / 6).
    expect(normaliseOptions({ territories: 42 }).seaLinks).toBe(7);
  });

  it("puts every generated anchor inside its own polygon", () => {
    const file = generateVoronoiMap(normaliseOptions({ territories: 60, continents: 7 }), "anchors");
    for (const t of file.territories) {
      expect(pointInRings([t.tokenX, t.tokenY], parseRings(t.d)), t.id).toBe(true);
    }
  });

  it("accepts an Rng as well as a seed string (SPEC §4.14)", () => {
    // S1's `rngFor` returns an `Rng`; the generator takes either, because a
    // random map is minted during setup before any sub-stream exists.
    let state = 0x9e3779b9;
    const rng = {
      nextU32: () => {
        state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 1) >>> 0;
        return state;
      },
      nextFloat: () => 0,
      state: [1, 2] as readonly [number, number],
    };
    const file = generateVoronoiMap(normaliseOptions({ territories: 24, continents: 4 }), rng);
    expect(validateMap(file)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ the validator itself -- */

describe("T7 — validateMap catches what it claims to", () => {
  const base = (): MapFile => JSON.parse(JSON.stringify(fileFor("tiny4"))) as MapFile;

  const broken: readonly [string, (f: MapFile) => unknown, RegExp][] = [
    ["an asymmetric edge", (f) => {
      poke(f.territories[0], "adjacent", ["b", "c", "d"]);
      poke(f.territories[1], "adjacent", ["c", "d"]);
    }, /asymmetric/],
    ["a dangling adjacency reference", (f) => {
      poke(f.territories[0], "adjacent", ["b", "c", "d", "nowhere"]);
    }, /unknown territory nowhere/],
    ["missing geometry", (f) => {
      poke(f.territories[0], "d", "");
    }, /no geometry/],
    ["a continent list that disagrees with the territories", (f) => {
      poke(f.continents[0], "territories", ["a", "b", "c"]);
    }, /is in no continent's list/],
    ["a lopsided deck", (f) => {
      for (const t of f.territories) poke(t, "suit", "infantry");
    }, /suit counts differ/],
    ["an anchor outside its polygon", (f) => {
      poke(f.territories[0], "tokenX", -500);
    }, /outside/],
    ["a blizzard count out of range", (f) => {
      poke(f.modifierSlots, "blizzards", 1);
    }, /blizzards 1 is outside/],
    ["a portal count out of range", (f) => {
      poke(f.modifierSlots, "portals", 9);
    }, /portals 9 is outside/],
    ["a slug that is not kebab-case", (f) => {
      poke(f, "slug", "Tiny_4");
    }, /not kebab-case/],
    ["a sea link to nowhere", (f) => {
      poke(f, "seaLinks", [{ from: "a", to: "atlantis" }]);
    }, /endpoint atlantis/],
    ["a sea link that is already a land border", (f) => {
      poke(f, "seaLinks", [{ from: "a", to: "b" }]);
    }, /duplicates a land border/],
    ["a disconnected board", (f) => {
      for (const t of f.territories) {
        poke(t, "adjacent", t.id === "a" || t.id === "b"
          ? [t.id === "a" ? "b" : "a"]
          : [t.id === "c" ? "d" : "c"]);
      }
    }, /not connected/],
    ["a zero continent bonus", (f) => {
      poke(f.continents[0], "bonus", 0);
    }, /not a positive integer/],
  ];

  for (const [what, breakIt, pattern] of broken) {
    it(`rejects ${what}`, () => {
      const file = base();
      expect(validateMap(file)).toEqual([]);
      breakIt(file);
      const errors = validateMap(file);
      expect(errors.join("\n")).toMatch(pattern);
      expect(() => loadMap(file)).toThrow(/invalid map/);
    });
  }

  it("reports every fault in one pass rather than only the first", () => {
    const file = base();
    poke(file.territories[0], "d", "");
    poke(file.territories[1], "d", "");
    poke(file.modifierSlots, "portals", 99);
    expect(validateMap(file).length).toBeGreaterThanOrEqual(3);
  });
});
