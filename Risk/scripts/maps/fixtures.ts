/**
 * The four toy boards — Tiny3, Tiny4, Mini and Quad (D39).
 *
 * Their graphs come from `DouglasOrr/Preeminence` (MIT), which ships **no**
 * coordinates, no geometry and no bonus values. These exist because they are
 * small enough to reason about exhaustively in a unit test, not because they
 * are fun to play, and **they never appear in the in-game map picker** (D39) —
 * so their geometry is a schematic grid rather than an attempt at a landscape.
 * `MAP_SLUGS` lists them last and the picker filters them out.
 *
 * Preeminence leaves `bonus` null, so the continents are priced by the same
 * `bonus ≈ round(size/3 + borders/2)` heuristic the generated boards use.
 *
 * `modifierSlots` still has to declare a count in R74/R76's 2–11 and 3–7, which
 * on a three-territory board is more blizzards than the board can seat. That is
 * what `slotsFor(map, seats)` is for: it clamps a declared count to what the map
 * can actually hold, so the file stays in range and the resolver still gets a
 * number it can satisfy.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { MapFile } from "../../src/engine/types";
import type { Point, Ring } from "../../src/engine/map/path";

const GEOM_MODULE = "./geom.ts";
const geom = (await import(GEOM_MODULE)) as typeof import("./geom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "research", "map-data");

const PALETTE = ["#36B0EA", "#DA3A4F", "#5FBF2A", "#9B4AE8", "#E08A24", "#F0C33A",
  "#2AC4A8", "#E8569B", "#7D8CF0", "#C7D63A", "#D96A2A"];

/** One grid cell, in `viewBox` units. */
const CELL = 220;
const INSET = 18;

interface PreeminenceGraph {
  readonly slug: string;
  readonly name: string;
  readonly continents: readonly { readonly id: string; readonly name: string; readonly territories: readonly string[] }[];
  readonly territories: readonly {
    readonly id: string; readonly name: string; readonly continent: string; readonly adjacent: readonly string[];
  }[];
}

/**
 * A twelve-vertex rounded rectangle filling one grid cell.
 *
 * Twelve is §8's lower bound, so a fixture exercises the same vertex-count gate
 * a real board does rather than slipping under it as a quadrilateral.
 */
function cellShape(col: number, row: number): Ring[] {
  const x = col * CELL + INSET;
  const y = row * CELL + INSET;
  const w = CELL - 2 * INSET;
  const h = CELL - 2 * INSET;
  const r = Math.round(w / 5);
  const ring: Point[] = [
    [x + r, y], [x + w - r, y],
    [x + w - r / 2, y + r / 3], [x + w, y + r],
    [x + w, y + h - r], [x + w - r / 2, y + h - r / 3],
    [x + w - r, y + h], [x + r, y + h],
    [x + r / 2, y + h - r / 3], [x, y + h - r],
    [x, y + r], [x + r / 2, y + r / 3],
  ];
  return [ring];
}

/**
 * One fixture board: the Preeminence graph, laid out on the smallest grid that
 * holds it, in continent order so a continent is a contiguous block.
 */
export function buildFixture(slug: string, tagline: string): MapFile {
  const graph = JSON.parse(readFileSync(join(DATA, "preeminence", `${slug}.json`), "utf8")) as PreeminenceGraph;

  // Continent order, then the continent's own order: a continent reads as a row
  // or a block rather than being scattered over the grid.
  const ordered: PreeminenceGraph["territories"][number][] = [];
  for (const continent of graph.continents) {
    for (const id of continent.territories) {
      const territory = graph.territories.find((t) => t.id === id);
      if (territory !== undefined) ordered.push(territory);
    }
  }
  for (const t of graph.territories) if (!ordered.includes(t)) ordered.push(t);

  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const rows = Math.max(1, Math.ceil(ordered.length / cols));

  return geom.assemble({
    slug,
    name: graph.name,
    tagline,
    viewBox: `0 0 ${cols * CELL} ${rows * CELL}`,
    width: cols * CELL,
    height: rows * CELL,
    // A schematic cell is twelve vertices and stays twelve; the budget is the
    // real board's, applied uniformly so nothing here is a special case.
    vertexBudget: 30,
    capitals: 6,
    continents: graph.continents.map((c, i) => ({
      id: c.id,
      name: c.name,
      color: PALETTE[i % PALETTE.length] as string,
    })),
    territories: ordered.map((t, i) => ({
      id: t.id,
      name: t.name,
      continent: t.continent,
      shape: cellShape(i % cols, Math.floor(i / cols)),
      adjacent: [...t.adjacent].sort(),
    })),
    // Toy boards have no coastline and no shipping lanes; every edge is a land
    // border, so there is nothing to draw as a dashed route.
    seaLinks: [],
    slots: { blizzards: 2, portals: 3 },
  });
}

export const FIXTURES: readonly { readonly slug: string; readonly tagline: string }[] = [
  { slug: "tiny3", tagline: "Engine fixture: three mutually adjacent territories" },
  { slug: "tiny4", tagline: "Engine fixture: four mutually adjacent territories" },
  { slug: "mini", tagline: "Engine fixture: two three-territory continents on one bridge" },
  { slug: "quad", tagline: "Engine fixture: four continents around a central crossroads" },
];

export function buildFixtures(): MapFile[] {
  return FIXTURES.map((f) => buildFixture(f.slug, f.tagline));
}
