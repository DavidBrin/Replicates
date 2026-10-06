/**
 * Tier 3 — nine regional boards generated from public-domain geodata (D37).
 *
 * This is the only legitimate route to ten-plus maps: no permissively licensed
 * geometry exists for *any* non-Classic regional Risk board, and every
 * catalogue that has one — Lux Delux, Warzone, TripleA, Domination, MapGenie —
 * was checked individually and is unlicensed, proprietary or copyleft
 * (`research/02-maps-and-fan-code.md` §Recommendation). So the geography is
 * real and the boards are ours.
 *
 * The pipeline, per `research/02-maps-and-fan-code.md`'s Tier 3 plan:
 *
 *  1. **select** source features for the region;
 *  2. **project** to a flat `viewBox` (equal-area, so Greenland is not a
 *     continent) and quantise every coordinate;
 *  3. **split** the countries that are too big to be one territory, with
 *     area-bisecting half-planes — the pieces keep the parent's coastline
 *     vertices, so the adjacency pass needs no special case;
 *  4. **merge** the smallest territories into neighbours until the count hits
 *     the target, which is tuned to the real catalogue's own numbers
 *     (`smg-catalogue/all-maps.json`) so the boards *feel* like the originals
 *     without copying one;
 *  5. **derive adjacency topologically** from shared borders — never hand-typed;
 *  6. **group** territories into connected continents and price them with
 *     `bonus ≈ round(size/3 + borders/2)`;
 *  7. add the **hand-authored sea links**, which are the one thing geometry
 *     cannot tell you (and without which every island is unreachable);
 *  8. simplify to §8's vertex budget, solve anchors, emit.
 *
 * Every sea-link list below was authored by running this pipeline with an empty
 * list, reading off `suggestSeaLinks`'s report of what the board left
 * unreachable and what the nearest coast to each stranded piece was, and then
 * choosing the crossings a player would expect. `pnpm run build:maps --suggest`
 * reprints that report.
 */

import type { MapFile } from "../../src/engine/types";
import type { Point, Ring } from "../../src/engine/map/path";
import type { ProjectionKind, SourceFeature } from "./sources";

const GEOM_MODULE = "./geom.ts";
const SOURCES_MODULE = "./sources.ts";
const ENGINE_MODULE = "./engine.ts";
const geom = (await import(GEOM_MODULE)) as typeof import("./geom");
const sources = (await import(SOURCES_MODULE)) as typeof import("./sources");
const engine = (await import(ENGINE_MODULE)) as typeof import("./engine");

const PALETTE = ["#36B0EA", "#DA3A4F", "#5FBF2A", "#9B4AE8", "#E08A24", "#F0C33A",
  "#2AC4A8", "#E8569B", "#7D8CF0", "#C7D63A", "#D96A2A"];

const VERTEX_BUDGET = 30;
const MARGIN = 28;

/* ------------------------------------------------------------------ the spec -- */

export interface RegionSpec {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  /** Which loader supplies the features. */
  readonly source: "world" | "usStates" | "australia";
  /** Extra features pulled in from the world set on top of `source`. */
  readonly alsoWorld?: readonly string[];
  /** Named features to keep. When absent, `continents` selects by Natural Earth's own field. */
  readonly keep?: readonly string[];
  readonly continentsOf?: readonly string[];
  readonly drop?: readonly string[];
  /**
   * A lon/lat window every feature is clipped to **before** projection.
   *
   * This is what makes a regional board a region: Natural Earth's "France"
   * includes French Guiana and Réunion, and "Russia" reaches Kamchatka, so
   * selecting by continent alone frames a Europe map around the Pacific. Clipping
   * first also means the projection is fitted to what is actually drawn.
   */
  readonly window?: { readonly lon: readonly [number, number]; readonly lat: readonly [number, number] };
  /** Feature name → how many territories to cut it into. */
  readonly split?: Readonly<Record<string, number>>;
  /** Feature name → the word the pieces are named after. Defaults to the feature's own name. */
  readonly splitBase?: Readonly<Record<string, string>>;
  readonly territories: number;
  /**
   * Merge **within** each Natural Earth continent to these per-continent
   * targets, instead of globally to `territories`.
   *
   * A global merge on a world board produces one mega-territory and twenty-three
   * islands: the rule is "smallest into smallest neighbour", and an island has no
   * neighbour to merge into, so every island survives while the whole connected
   * landmass collapses into one. Merging per continent keeps the board a board.
   */
  readonly territoriesPerContinent?: Readonly<Record<string, number>>;
  readonly continents: number;
  /** The word the continents are named after: "Europe" → "South East Europe". */
  readonly continentWord: string;
  /**
   * How a merged territory is named.
   *
   * `"members"` (the default) names it after its two largest parts, which is
   * right when the merge is light — "Guinea & Sierra Leone". `"continentBand"`
   * names it by compass band within its own continent — "North West Africa" —
   * which is right when a board merges seven countries into one territory and
   * naming it after two of them would be a lie.
   */
  readonly nameBy?: "members" | "continentBand";
  /**
   * How continents are formed. `"grow"` (the default) grows `continents`
   * connected groups and names them by compass band; `"source"` uses Natural
   * Earth's own continents, which is what a simplified world board wants.
   */
  readonly continentMode?: "grow" | "source";
  readonly projection: ProjectionKind;
  readonly rotate?: readonly [number, number];
  readonly width: number;
  readonly height: number;
  /** Hand-authored, by final territory id. See the module header. */
  readonly seaLinks: readonly (readonly [string, string])[];
  /** Blizzard/portal counts, taken from the catalogue entry this board echoes. */
  readonly slots?: { readonly blizzards: number; readonly portals: number };
}

/* ------------------------------------------------------------------ the builder -- */

interface Piece {
  readonly name: string;
  /** Natural Earth's continent for the feature this piece came from. */
  readonly continent: string;
  readonly shape: Ring[];
  readonly area: number;
  readonly centre: Point;
}

function centreOf(shape: readonly Ring[]): Point {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of shape) {
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
      n++;
    }
  }
  return n === 0 ? [0, 0] : [sx / n, sy / n];
}

/** The features this spec selects, in a stable order. */
export function selectFeatures(spec: RegionSpec): SourceFeature[] {
  const base = spec.source === "usStates"
    ? sources.usStates()
    : spec.source === "australia"
      ? sources.admin1("Australia")
      : sources.worldCountries();

  const keep = spec.keep === undefined ? null : new Set(spec.keep);
  const continents = spec.continentsOf === undefined ? null : new Set(spec.continentsOf);
  const drop = new Set(spec.drop ?? []);

  let chosen = base.filter((f) => {
    if (drop.has(f.name)) return false;
    if (keep !== null) return keep.has(f.name);
    if (continents !== null) return continents.has(f.continent);
    return true;
  });
  if (spec.alsoWorld !== undefined) {
    const extra = new Set(spec.alsoWorld);
    chosen = [...chosen, ...sources.worldCountries().filter((f) => extra.has(f.name) && !drop.has(f.name))];
  }
  // Antarctica and the open-ocean polygon are never a board.
  chosen = chosen.filter((f) => f.rings.length > 0 && f.continent !== "Antarctica" && f.name !== "Antarctica");

  if (spec.window !== undefined) {
    const { lon, lat } = spec.window;
    chosen = chosen
      .map((f) => {
        let rings = f.rings.map((r) => r.map((p) => [p[0], p[1]] as Point)) as Ring[];
        for (const [axis, cut, side] of [
          [0, lon[0], "high"], [0, lon[1], "low"], [1, lat[0], "high"], [1, lat[1], "low"],
        ] as [0 | 1, number, "low" | "high"][]) {
          rings = geom.clipHalfPlane(rings, axis, cut, side);
        }
        // A sliver left by the clip is a rendering artefact, not a territory.
        const kept = rings.filter((r) => r.length >= 3);
        return { ...f, rings: kept.map((r) => r.map((p) => [p[0], p[1]] as const)), extent: sources.extentOf(kept.map((r) => r.map((p) => [p[0], p[1]] as const))) };
      })
      .filter((f) => f.extent > 0.02);
  }
  return chosen.sort((a, b) => a.name.localeCompare(b.name));
}

/** Project, then split whatever the spec says to split. One flat list of pieces. */
function piecesOf(spec: RegionSpec, features: readonly SourceFeature[]): Piece[] {
  const project = sources.fitProjection(
    spec.projection, features, spec.width, spec.height, MARGIN,
    spec.rotate === undefined ? undefined : [spec.rotate[0], spec.rotate[1]],
  );
  const out: Piece[] = [];
  for (const feature of features) {
    const shape = sources.projectRings(feature.rings, project);
    if (shape.length === 0) continue;
    const want = spec.split?.[feature.name] ?? 1;
    if (want <= 1) {
      out.push({
        name: feature.name, continent: feature.continent, shape,
        area: geom.areaOf(shape), centre: centreOf(shape),
      });
      continue;
    }
    const cut = geom.splitShape(shape, want, sources.quantise);
    const base = spec.splitBase?.[feature.name] ?? feature.name;
    const names = geom.bandNames(cut.map((s) => centreOf(s)), base);
    cut.forEach((piece, i) => {
      out.push({
        name: names[i] ?? `${base} ${i + 1}`,
        continent: feature.continent,
        shape: piece as Ring[],
        area: geom.areaOf(piece),
        centre: centreOf(piece),
      });
    });
  }
  return out;
}

export interface RegionBuild {
  readonly file: MapFile;
  /** Sea links the board still needs, reported when it comes out disconnected. */
  readonly suggestions: readonly (readonly [string, string])[];
}

/**
 * Build one regional board.
 *
 * Returns the `MapFile` **and** any sea links the board still needs: a run with
 * an incomplete list is how the committed lists were authored, and it is how a
 * future change to a target count surfaces the new crossing rather than failing
 * the connectivity gate with no clue.
 */
export function buildRegion(spec: RegionSpec): RegionBuild {
  const features = selectFeatures(spec);
  const raw = piecesOf(spec, features);
  if (raw.length === 0) throw new Error(`${spec.slug}: no source features selected`);

  // Conform first: a recursive split leaves the pieces either side of an early
  // cut sharing only one vertex, which the adjacency pass would reject.
  const conformed = geom.conformVertices(raw.map((p) => p.shape), 1 / sources.QUANTUM);
  const pieces: Piece[] = raw.map((p, i) => ({ ...p, shape: (conformed[i] ?? p.shape) as Ring[] }));

  const pieceAdjacency = engine.sharedVertexAdjacency(pieces.map((p) => p.shape));
  // A group is identified by the index of the piece it grew from, so that piece's
  // centre stands in for the group's position when placing an island.
  const nearestTo = (from: number, candidates: readonly number[]): number => {
    let pick = -1;
    let best = Infinity;
    for (const c of candidates) {
      const a = pieces[from]?.centre;
      const b = pieces[c]?.centre;
      if (a === undefined || b === undefined) continue;
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      if (d < best) {
        best = d;
        pick = c;
      }
    }
    return pick;
  };
  const plan = spec.territoriesPerContinent === undefined
    ? geom.mergeToTarget(pieces.map((p) => p.area), pieceAdjacency, spec.territories, nearestTo)
    : mergePerContinent(pieces, pieceAdjacency, spec.territoriesPerContinent, nearestTo);

  /* ---- merged groups become territories ---- */
  const drafts = plan.groups.map((members) => {
    const byArea = [...members].sort((a, b) => (pieces[b]?.area ?? 0) - (pieces[a]?.area ?? 0));
    const largest = pieces[byArea[0] ?? 0];
    // A merged territory is named after its two largest parts — the convention
    // TotalRisk's own Napoleonic board uses ("Aragon & Castile"), because a board
    // reads better with "Guinea & Sierra Leone" than with an invented word.
    const second = byArea.length > 1 ? pieces[byArea[1] as number]?.name : undefined;
    const memberName = second === undefined ? (largest?.name ?? "Territory") : `${largest?.name ?? ""} & ${second}`;
    const shape = members.flatMap((m) => pieces[m]?.shape ?? []);
    return { memberName, continent: largest?.continent ?? "", shape, members, centre: centreOf(shape) };
  });

  const names = spec.nameBy === "continentBand" ? continentBandNames(drafts) : drafts.map((d) => d.memberName);
  const taken = new Set<string>();
  const territories = drafts.map((draft, i) => ({
    ...draft,
    name: names[i] as string,
    id: geom.slugify(names[i] as string, taken),
  }));

  /* ---- adjacency, lifted from pieces to territories ---- */
  const adjacency: Set<number>[] = territories.map(() => new Set<number>());
  pieceAdjacency.forEach((neighbours, piece) => {
    const a = plan.owner[piece] ?? -1;
    for (const other of neighbours) {
      const b = plan.owner[other] ?? -1;
      if (a >= 0 && b >= 0 && a !== b) {
        adjacency[a]?.add(b);
        adjacency[b]?.add(a);
      }
    }
  });

  /* ---- continents ---- */
  const centres = territories.map((t) => t.centre);
  let owner: number[];
  let continentNames: string[];
  if (spec.continentMode === "source") {
    // Natural Earth's own continents. A simplified world board wants the six
    // real ones, not six compass bands.
    const order: string[] = [];
    owner = territories.map((t) => {
      const key = t.continent === "" ? "Other" : t.continent;
      if (!order.includes(key)) order.push(key);
      return order.indexOf(key);
    });
    continentNames = order;
  } else {
    owner = engine.growGroups(spec.continents, adjacency, centres);
    const groupCount = Math.max(0, ...owner.map((g) => g + 1));
    const members: number[][] = Array.from({ length: groupCount }, () => []);
    owner.forEach((g, t) => {
      if (g >= 0) (members[g] as number[]).push(t);
    });
    continentNames = geom.bandNames(
      members.map((list) => centreOf(list.flatMap((t) => territories[t]?.shape ?? []))),
      spec.continentWord,
    );
  }
  const continentTaken = new Set<string>();
  const continentIds = continentNames.map((n) => geom.slugify(n, continentTaken));

  /* ---- sea links, and what is still missing ---- */
  const byId = new Map(territories.map((t, i) => [t.id, i]));
  const withSea: Set<number>[] = adjacency.map((set) => new Set(set));
  for (const [a, b] of spec.seaLinks) {
    const x = byId.get(a);
    const y = byId.get(b);
    if (x === undefined || y === undefined) continue;
    withSea[x]?.add(y);
    withSea[y]?.add(x);
  }
  const suggestions = suggestSeaLinks(territories, withSea);

  const file = geom.assemble({
    slug: spec.slug,
    name: spec.name,
    tagline: spec.tagline,
    viewBox: `0 0 ${spec.width} ${spec.height}`,
    width: spec.width,
    height: spec.height,
    vertexBudget: VERTEX_BUDGET,
    capitals: 6,
    continents: continentIds.map((id, i) => ({
      id,
      name: continentNames[i] as string,
      color: PALETTE[i % PALETTE.length] as string,
    })),
    territories: territories.map((t, i) => ({
      id: t.id,
      name: t.name,
      continent: continentIds[owner[i] ?? 0] as string,
      shape: t.shape,
      adjacent: [...(adjacency[i] ?? [])].map((n) => territories[n]?.id ?? "").filter((id) => id !== ""),
    })),
    seaLinks: spec.seaLinks,
    ...(spec.slots === undefined ? {} : { slots: spec.slots }),
  });

  return { file, suggestions };
}

/**
 * Run the merge once per Natural Earth continent, each to its own target.
 *
 * Pieces are partitioned by continent, the adjacency graph is restricted to
 * each partition (so a merge never crosses Gibraltar), and the resulting groups
 * are concatenated in continent-name order so the output is deterministic.
 */
function mergePerContinent(
  pieces: readonly Piece[],
  adjacency: readonly ReadonlySet<number>[],
  targets: Readonly<Record<string, number>>,
  nearest: (from: number, candidates: readonly number[]) => number,
): import("./geom").MergePlan {
  const byContinent = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const key = p.continent === "" ? "Other" : p.continent;
    const list = byContinent.get(key);
    if (list === undefined) byContinent.set(key, [i]);
    else list.push(i);
  });

  const owner = new Array<number>(pieces.length).fill(-1);
  const groups: number[][] = [];
  for (const [continent, members] of [...byContinent].sort((a, b) => a[0].localeCompare(b[0]))) {
    const local = new Map(members.map((m, i) => [m, i]));
    const localAdjacency = members.map((m) => {
      const set = new Set<number>();
      for (const other of adjacency[m] ?? []) {
        const at = local.get(other);
        if (at !== undefined) set.add(at);
      }
      return set;
    });
    const plan = geom.mergeToTarget(
      members.map((m) => pieces[m]?.area ?? 0),
      localAdjacency,
      targets[continent] ?? members.length,
      (from, candidates) => {
        const absolute = nearest(members[from] as number, candidates.map((c) => members[c] as number));
        return local.get(absolute) ?? -1;
      },
    );
    for (const group of plan.groups) {
      const absolute = group.map((g) => members[g] as number).sort((a, b) => a - b);
      for (const m of absolute) owner[m] = groups.length;
      groups.push(absolute);
    }
  }
  return { owner, groups };
}

/**
 * Compass-band names **within each continent**: "North West Africa", "South
 * East Asia".
 *
 * Used where the merge is heavy enough that naming a territory after two of its
 * seven countries would misdescribe it.
 */
function continentBandNames(
  drafts: readonly { readonly continent: string; readonly centre: Point }[],
): string[] {
  const out = new Array<string>(drafts.length).fill("");
  const byContinent = new Map<string, number[]>();
  drafts.forEach((d, i) => {
    const key = d.continent === "" ? "Territory" : d.continent;
    const list = byContinent.get(key);
    if (list === undefined) byContinent.set(key, [i]);
    else list.push(i);
  });
  for (const [continent, list] of [...byContinent].sort((a, b) => a[0].localeCompare(b[0]))) {
    const names = geom.bandNames(list.map((i) => drafts[i]?.centre ?? [0, 0]), continent);
    list.forEach((i, at) => {
      out[i] = names[at] ?? continent;
    });
  }
  return out;
}

/**
 * One crossing per stranded component, to its nearest coast in the largest one.
 *
 * Geometry cannot tell you where a shipping lane goes, but it can tell you which
 * islands have no route at all and which mainland coast is closest — which is
 * exactly the shortlist a human needs to author the real list from.
 */
export function suggestSeaLinks(
  territories: readonly { readonly id: string; readonly shape: readonly Ring[] }[],
  adjacency: readonly ReadonlySet<number>[],
): (readonly [string, string])[] {
  const components = engine.componentsOf(adjacency);
  if (components.length <= 1) return [];
  const sizes = components.map((c) => c.length);
  const mainIndex = sizes.indexOf(Math.max(...sizes));
  const main = components[mainIndex] ?? [];

  const out: (readonly [string, string])[] = [];
  components.forEach((component, index) => {
    if (index === mainIndex) return;
    let best: readonly [string, string] | null = null;
    let bestDistance = Infinity;
    for (const a of component) {
      for (const b of main) {
        const d = nearestApproach(territories[a]?.shape ?? [], territories[b]?.shape ?? []);
        if (d < bestDistance) {
          bestDistance = d;
          best = [territories[a]?.id ?? "", territories[b]?.id ?? ""];
        }
      }
    }
    if (best !== null) out.push(best);
  });
  return out;
}

/** The closest two vertices of two shapes get. Vertex-to-vertex is enough to rank coasts. */
function nearestApproach(a: readonly Ring[], b: readonly Ring[]): number {
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
  return Math.sqrt(best);
}
