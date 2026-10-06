/**
 * Tier 1 — the three boards that already have real, permissively licensed
 * geometry (D37).
 *
 * | map | graph | geometry | licence |
 * |---|---|---|---|
 * | Classic World 42/6/83 | `canonical/classic-world.json` | `totalrisk/worldMap.svg` | Unlicense |
 * | World Extended 47/6/94 | `totalrisk/world-extended.json` | `totalrisk/worldMapExtended.svg` | Unlicense |
 * | Napoleonic Europe 59/11/127 | `totalrisk/napoleonic-europe.json` | `totalrisk/napoleonMap.svg` | Unlicense |
 *
 * **The graph and the geometry come from different files on purpose.** TotalRisk
 * drew the only permissive Classic board, and its *graph* carries two bugs: a
 * spurious `northwest_territory–quebec` and a missing
 * `new_guinea–western_australia`. Seven independent sources agree exactly on the
 * corrected graph, which is what `canonical/classic-world.json` holds and what
 * this build uses — the highest-confidence fact in the whole map lane (D37).
 * World Extended is built on the same TotalRisk base, so it inherits both bugs
 * and both corrections are applied to it too; the edge count is unchanged at 94
 * because one edge goes and one arrives.
 *
 * **Sea links are hand-authored**, because geometry cannot tell you about a
 * shipping lane. Classic's nine are the canonical file's own list. For the other
 * two they were chosen by measuring, for every graph edge, the gap between the
 * two outlines in the SVG and reading off which edges cross water — a check
 * `_seaLinkEvidence` records so the choice is auditable rather than asserted.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { MapFile, Suit } from "../../src/engine/types";
import type { Point, Ring } from "../../src/engine/map/path";

const GEOM_MODULE = "./geom.ts";
const SVG_MODULE = "./svg.ts";
const ENGINE_MODULE = "./engine.ts";
const geom = (await import(GEOM_MODULE)) as typeof import("./geom");
const svg = (await import(SVG_MODULE)) as typeof import("./svg");
const engine = (await import(ENGINE_MODULE)) as typeof import("./engine");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "research", "map-data");

/** One continent accent per Classic continent, matching `globals.css`'s `--c-*` tokens. */
const CLASSIC_COLORS: Record<string, string> = {
  north_america: "#36B0EA", south_america: "#DA3A4F", europe: "#5FBF2A",
  africa: "#9B4AE8", asia: "#E08A24", australia: "#F0C33A",
};
const PALETTE = ["#36B0EA", "#DA3A4F", "#5FBF2A", "#9B4AE8", "#E08A24", "#F0C33A",
  "#2AC4A8", "#E8569B", "#7D8CF0", "#C7D63A", "#D96A2A"];

/** §8's budget. The pipeline spends the whole allowance so the coastline stays recognisable. */
const VERTEX_BUDGET = 30;
/** Coordinates are snapped here so a shared border is the same number on both sides. */
const QUANTUM = 64;
const q = (n: number): number => {
  const v = Math.round(n * QUANTUM) / QUANTUM;
  return Object.is(v, -0) ? 0 : v;
};

/* ------------------------------------------------------------------ source graphs -- */

interface SourceGraph {
  readonly continents: readonly {
    readonly id: string; readonly name: string; readonly bonus: number | null;
    readonly territories: readonly string[];
  }[];
  readonly territories: readonly {
    readonly id: string; readonly name: string; readonly continent: string;
    readonly adjacent: readonly string[];
  }[];
  readonly sea_links?: readonly { readonly from: string; readonly to: string }[];
}

function readGraph(relative: string): SourceGraph {
  return JSON.parse(readFileSync(join(DATA, relative), "utf8")) as SourceGraph;
}

/* ------------------------------------------------------------------ geometry -- */

/** A territory's outline from the SVG, transformed into `viewBox` space and quantised. */
function shapeFor(path: import("./svg").SvgPath): Ring[] {
  const out: Ring[] = [];
  for (const ring of engine.parseRings(path.d)) {
    const transformed: Point[] = [];
    for (const p of ring) {
      const [x, y] = svg.applyMatrix(path.transform, p[0], p[1]);
      const point: Point = [q(x), q(y)];
      const last = transformed[transformed.length - 1];
      if (last === undefined || last[0] !== point[0] || last[1] !== point[1]) transformed.push(point);
    }
    if (transformed.length >= 3) out.push(transformed);
  }
  return out;
}

/**
 * The declared `viewBox` if the geometry fits inside it, else the geometry's own
 * bounds with a small pad.
 *
 * The TotalRisk files hang their content off a `<g transform>` that shifts it a
 * couple of units, so the declared box is close but not guaranteed — and the
 * validator requires the box to contain every outline.
 */
function fitViewBox(declared: string, shapes: readonly (readonly Ring[])[], pad: number): string {
  const parts = declared.trim().split(/[\s,]+/).map(Number);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const ring of shape) {
      for (const p of ring) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
  if (!Number.isFinite(minX)) return declared;
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const [x, y, w, h] = parts as [number, number, number, number];
    if (minX >= x - 1 && minY >= y - 1 && maxX <= x + w + 1 && maxY <= y + h + 1) return declared;
  }
  const x = Math.floor(minX) - pad;
  const y = Math.floor(minY) - pad;
  return `${x} ${y} ${Math.ceil(maxX) + pad - x} ${Math.ceil(maxY) + pad - y}`;
}

/** The two anchors need room below the token for the label, so the frame grows if it must. */
function heightOf(viewBox: string): number {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  return (parts[1] ?? 0) + (parts[3] ?? 0);
}

function widthOf(viewBox: string): number {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  return (parts[0] ?? 0) + (parts[2] ?? 0);
}

/* ------------------------------------------------------------------ the builder -- */

interface Tier1Spec {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly graph: string;
  readonly svg: string;
  /** Edges to drop from `adjacent` and record as dashed sea routes instead (F45). */
  readonly seaLinks: readonly (readonly [string, string])[];
  /** Graph corrections, by the `adjudications` in `canonical/classic-world.json`. */
  readonly addEdges?: readonly (readonly [string, string])[];
  readonly removeEdges?: readonly (readonly [string, string])[];
  /** Suits the research records for specific territories; everything else is round-robin (F7). */
  readonly suits?: Readonly<Record<string, Exclude<Suit, "wild">>>;
  /** Source id → shipped id, where the source's own slug is mangled or misspelt. */
  readonly rename?: Readonly<Record<string, { readonly id: string; readonly name: string }>>;
  readonly colors?: Readonly<Record<string, string>>;
  /** Published bonus values, where the source has them; otherwise the heuristic prices them. */
  readonly keepBonuses: boolean;
}

export function buildTier1(spec: Tier1Spec): MapFile {
  const graph = readGraph(spec.graph);
  const file = svg.readSvg(spec.svg);
  const byName = svg.indexByName(file);

  const rename = spec.rename ?? {};
  const idOf = (sourceId: string): string => rename[sourceId]?.id ?? sourceId;
  const nameOf = (source: SourceGraph["territories"][number]): string => rename[source.id]?.name ?? source.name;

  // Land borders, with the adjudicated corrections applied before anything reads them.
  const edges = new Map<string, Set<string>>(graph.territories.map((t) => [idOf(t.id), new Set<string>()]));
  const link = (a: string, b: string): void => {
    if (a === b) return;
    edges.get(a)?.add(b);
    edges.get(b)?.add(a);
  };
  const unlink = (a: string, b: string): void => {
    edges.get(a)?.delete(b);
    edges.get(b)?.delete(a);
  };
  for (const t of graph.territories) for (const other of t.adjacent) link(idOf(t.id), idOf(other));
  for (const [a, b] of spec.addEdges ?? []) link(a, b);
  for (const [a, b] of spec.removeEdges ?? []) unlink(a, b);
  // A sea link is a dashed route, never also a land border (F45).
  for (const [a, b] of spec.seaLinks) unlink(a, b);

  const shapes = new Map<string, Ring[]>();
  const missing: string[] = [];
  for (const t of graph.territories) {
    const path = byName.get(svg.normaliseName(t.name));
    if (path === undefined) {
      missing.push(t.name);
      continue;
    }
    shapes.set(idOf(t.id), shapeFor(path));
  }
  if (missing.length > 0) {
    throw new Error(`${spec.slug}: ${missing.length} territories have no geometry in ${spec.svg}: ${missing.join(", ")}`);
  }

  const ordered = [...graph.territories].sort((a, b) => idOf(a.id).localeCompare(idOf(b.id)));
  const fitted = ordered.map((t) => engine.fitVertexBudget(shapes.get(idOf(t.id)) ?? [], VERTEX_BUDGET, 1024));
  const viewBox = fitViewBox(file.viewBox, fitted, 4);

  const colors = spec.colors ?? {};
  return geom.assemble({
    slug: spec.slug,
    name: spec.name,
    tagline: spec.tagline,
    viewBox,
    width: widthOf(viewBox),
    height: heightOf(viewBox),
    vertexBudget: VERTEX_BUDGET,
    capitals: 6,
    continents: graph.continents.map((c, i) => ({
      id: c.id,
      name: c.name,
      color: colors[c.id] ?? (PALETTE[i % PALETTE.length] as string),
      ...(spec.keepBonuses && typeof c.bonus === "number" ? { bonus: c.bonus } : {}),
    })),
    territories: ordered.map((t) => ({
      id: idOf(t.id),
      name: nameOf(t),
      continent: t.continent,
      shape: shapes.get(idOf(t.id)) ?? [],
      adjacent: [...(edges.get(idOf(t.id)) ?? [])].sort(),
    })),
    seaLinks: spec.seaLinks,
    ...(spec.suits === undefined ? {} : { suits: spec.suits }),
  });
}

/* ------------------------------------------------------------------ the three specs -- */

/**
 * Classic's nine sea lanes, from `canonical/classic-world.json`'s own
 * `sea_links`. They are **not** in `adjacent`: 74 land borders plus 9 sea links
 * is the 83 that T7 counts after `loadMap`'s union (F45).
 */
export const CLASSIC_SEA_LINKS: readonly (readonly [string, string])[] = [
  ["alaska", "kamchatka"],
  ["brazil", "north_africa"],
  ["central_america", "venezuela"],
  ["east_africa", "middle_east"],
  ["egypt", "southern_europe"],
  ["greenland", "iceland"],
  ["indonesia", "siam"],
  ["north_africa", "southern_europe"],
  ["north_africa", "western_europe"],
];

/**
 * World Extended's twenty: Classic's nine, plus the eleven crossings its five
 * extra islands need. Every one of the eleven is an edge whose outlines are
 * 11–795 `viewBox` units apart in `worldMapExtended.svg`; the widest non-sea
 * land border in that file is 0.4 units, so the classification is not a judgement
 * call (see `_seaLinkEvidence`).
 */
export const EXTENDED_SEA_LINKS: readonly (readonly [string, string])[] = [
  ...CLASSIC_SEA_LINKS,
  ["hawaii", "japan"],
  ["hawaii", "kamchatka"],
  ["hawaii", "western_united_states"],
  ["svalbard", "greenland"],
  ["svalbard", "scandinavia"],
  ["falkland_isles", "argentina"],
  ["falkland_isles", "south_africa"],
  ["philippines", "indonesia"],
  ["philippines", "japan"],
  ["new_zealand", "argentina"],
  ["new_zealand", "eastern_australia"],
];

/**
 * Napoleonic Europe's thirteen. Here the gap measurement separates the board
 * cleanly on its own: these are every edge whose outlines are **2.0 units or
 * more** apart, the next widest is 0.4, and all thirteen are real water — North
 * Sea, Tyrrhenian, Ligurian, the Channel twice, the Ionian, the Irish Sea, the
 * North Channel, the Gulf of Bothnia, the Øresund, Gibraltar and Bonifacio.
 */
export const NAPOLEONIC_SEA_LINKS: readonly (readonly [string, string])[] = [
  ["northern_england", "norway"],
  ["north_africa", "sardinia"],
  ["corsica", "languedoc"],
  ["brittany_normandy", "southern_england"],
  ["corsica", "lombardy_piedmont_tuscany"],
  ["greece", "the_two_sicilies"],
  ["nord_picardy", "southern_england"],
  ["ireland", "northern_england"],
  ["finland", "sweden"],
  ["ireland", "scotland"],
  ["denmark", "sweden"],
  ["andalusia", "north_africa"],
  ["corsica", "sardinia"],
];

/**
 * The only three Classic suits the research actually records — the card panel in
 * `bt5-0025-card-trade-panel-plus10.jpg` shows Japan Infantry, Indonesia Cavalry
 * and Ukraine Artillery (`research/04a-visual-evidence-index.md`). The other 39
 * are round-robin by index, which SPEC §4.14 blesses where no suit is sourced
 * and which keeps the deck at 14/14/14 by construction (F7).
 */
export const CLASSIC_SUITS: Readonly<Record<string, Exclude<Suit, "wild">>> = {
  japan: "infantry", indonesia: "cavalry", ukraine: "artillery",
};

/** The two TotalRisk graph bugs, per `canonical/classic-world.json`'s `adjudications`. */
const TOTALRISK_FIXES = {
  addEdges: [["new_guinea", "western_australia"]] as const,
  removeEdges: [["northwest_territory", "quebec"]] as const,
};

export function classicWorld(): MapFile {
  return buildTier1({
    slug: "classic-world",
    name: "Classic World",
    tagline: "42 territories, six continents — the board everyone already knows",
    graph: "canonical/classic-world.json",
    svg: "research/map-data/totalrisk/worldMap.svg",
    seaLinks: CLASSIC_SEA_LINKS,
    suits: CLASSIC_SUITS,
    colors: CLASSIC_COLORS,
    keepBonuses: true,
  });
}

export function worldExtended(): MapFile {
  return buildTier1({
    slug: "world-extended",
    name: "World Extended",
    tagline: "47 territories — the classic world plus five island outposts",
    graph: "totalrisk/world-extended.json",
    svg: "research/map-data/totalrisk/worldMapExtended.svg",
    seaLinks: EXTENDED_SEA_LINKS,
    addEdges: TOTALRISK_FIXES.addEdges,
    removeEdges: TOTALRISK_FIXES.removeEdges,
    colors: CLASSIC_COLORS,
    // The source spells it "New Zeeland"; the `id` its slug produces is kept
    // readable rather than faithful to a typo.
    rename: { new_zeeland: { id: "new_zealand", name: "New Zealand" } },
    keepBonuses: true,
  });
}

/**
 * Napoleonic Europe. Eight of the 59 ids arrive mangled by the source's own
 * slug function — `galicia_le_n` for "Galicia & León", `le_de_france` for
 * "Île-de-France" — so every id is re-minted from the display name with proper
 * diacritic folding.
 */
export function napoleonicEurope(): MapFile {
  const graph = readGraph("totalrisk/napoleonic-europe.json");
  const taken = new Set<string>();
  const rename: Record<string, { id: string; name: string }> = {};
  for (const t of graph.territories) {
    const id = geom.slugify(t.name, taken);
    if (id !== t.id) rename[t.id] = { id, name: t.name };
  }
  return buildTier1({
    slug: "napoleonic-europe",
    name: "Napoleonic Europe",
    tagline: "59 territories across eleven empires, 1805",
    graph: "totalrisk/napoleonic-europe.json",
    svg: "research/map-data/totalrisk/napoleonMap.svg",
    seaLinks: NAPOLEONIC_SEA_LINKS,
    rename,
    keepBonuses: true,
  });
}

/**
 * The measurement behind the two hand-authored sea-link lists: for every graph
 * edge, the smallest distance between the two territories' outlines in the SVG.
 * Exported so `tier1.test.ts` can assert that each shipped sea link really does
 * cross water and that no land border was mistaken for one.
 */
export function _seaLinkEvidence(graphRelative: string, svgRelative: string): Map<string, number> {
  const graph = readGraph(graphRelative);
  const file = svg.readSvg(svgRelative);
  const byName = svg.indexByName(file);
  const shapes = new Map<string, Ring[]>();
  for (const t of graph.territories) {
    const path = byName.get(svg.normaliseName(t.name));
    if (path !== undefined) shapes.set(t.id, shapeFor(path));
  }
  const out = new Map<string, number>();
  for (const t of graph.territories) {
    for (const other of t.adjacent) {
      const key = [t.id, other].sort().join("|");
      if (out.has(key)) continue;
      const a = shapes.get(t.id);
      const b = shapes.get(other);
      if (a === undefined || b === undefined) continue;
      let best = Infinity;
      for (const ra of a) {
        for (const pa of ra) {
          for (const rb of b) {
            for (const pb of rb) {
              const d = (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2;
              if (d < best) best = d;
            }
          }
        }
      }
      out.set(key, Math.sqrt(best));
    }
  }
  return out;
}
