/**
 * Build-time geometry: splitting a shape, merging shapes, naming the results,
 * dealing the card suits, and assembling a `MapFile`.
 *
 * The two operations that let one geodata source hit a target territory count:
 *
 *  - **split** — cut a big polygon into `k` pieces with area-bisecting
 *    axis-aligned half-planes. The pieces keep the parent's original vertices
 *    everywhere except the cut, and both sides of a cut compute the same
 *    crossing from the same edge, so the shared-vertex adjacency pass links them
 *    without any special case.
 *  - **merge** — repeatedly fold the smallest territory into its smallest
 *    neighbour. Adjacency is a union of the parts' adjacency, and the rings are
 *    simply kept side by side: a territory's `d` may be several subpaths, so
 *    nothing here needs a polygon union.
 *
 * Nothing in this file is Hasbro- or SMG-derived (D38): it operates on
 * public-domain outlines and on names it either reads from Natural Earth or
 * mints itself.
 */

import type { MapFile, Suit } from "../../src/engine/types";
import type { Point, Ring } from "../../src/engine/map/path";

const ENGINE_MODULE = "./engine.ts";
type EngineModule = typeof import("./engine");
const engine = (await import(ENGINE_MODULE)) as EngineModule;

const {
  anchorsForRings, bonusFor, fitVertexBudget, ringArea, ringsToPath, segmentDistance2, sharedVertexAdjacency,
} = engine;

/** One territory's geometry: an outer ring per landmass, in `viewBox` units. */
export type Shape = readonly Ring[];

/* ------------------------------------------------------------------ splitting -- */

/** Which side of an axis-aligned cut to keep. */
type Side = "low" | "high";

/**
 * Sutherland–Hodgman against one axis-aligned half-plane, ring by ring.
 *
 * A concave ring that crosses the cut more than twice comes back with
 * zero-width bridges along the cut line. That is geometrically degenerate and
 * visually invisible at board scale, and it is what keeps the crossing points
 * **exactly** equal on both sides of the cut — which is the property the
 * adjacency pass depends on.
 */
export function clipHalfPlane(shape: Shape, axis: 0 | 1, cut: number, side: Side): Ring[] {
  const inside = (p: Point): number => (side === "low" ? cut - p[axis] : p[axis] - cut);
  const out: Ring[] = [];
  for (const ring of shape) {
    const next: Point[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Point;
      const b = ring[(i + 1) % ring.length] as Point;
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        // `t` is computed from (a, b) in the ring's own order on both sides of
        // the cut, so both halves land on the same crossing point.
        const t = da / (da - db);
        next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    const deduped = dedupe(next);
    if (deduped.length >= 3 && ringArea(deduped) > 0) out.push(deduped);
  }
  return out;
}

function dedupe(ring: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (out.length > 1 && first !== undefined && end !== undefined && first[0] === end[0] && first[1] === end[1]) out.pop();
  return out;
}

/* ------------------------------------------------------------------ conforming -- */

/**
 * Insert, into every edge, any vertex of any other shape that lies on it.
 *
 * Without this, adjacency is silently wrong wherever a split recursed. The first
 * cut gives both halves the same two crossing points, so they share an edge and
 * the adjacency pass sees it. But cutting one half *again* puts a third vertex Q
 * on that shared line, and the other half's edge still runs straight past Q — so
 * the two pieces either side of the first cut now share only **one** vertex, and
 * "two or more shared vertices" rejects them. On the North America board that
 * lost two thirds of the land borders.
 *
 * Inserting Q into the opposite edge restores the shared-edge property exactly,
 * which keeps adjacency on plain coordinate equality rather than on a distance
 * threshold that would start fusing coastlines across narrow straits.
 *
 * The inserted vertices are collinear, so Douglas–Peucker removes them again
 * before anything is drawn.
 */
export function conformVertices(shapes: readonly Shape[], epsilon: number): Shape[] {
  const cell = Math.max(epsilon * 8, 1e-9);
  const key = (x: number, y: number): string => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = new Map<string, Point[]>();
  for (const shape of shapes) {
    for (const ring of shape) {
      for (const p of ring) {
        const k = key(p[0], p[1]);
        const list = grid.get(k);
        if (list === undefined) grid.set(k, [p]);
        else if (!list.some((v) => v[0] === p[0] && v[1] === p[1])) list.push(p);
      }
    }
  }

  const eps2 = epsilon * epsilon;
  return shapes.map((shape) => shape.map((ring) => {
    const out: Point[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Point;
      const b = ring[(i + 1) % ring.length] as Point;
      out.push(a);

      const minX = Math.min(a[0], b[0]) - epsilon;
      const maxX = Math.max(a[0], b[0]) + epsilon;
      const minY = Math.min(a[1], b[1]) - epsilon;
      const maxY = Math.max(a[1], b[1]) + epsilon;
      const span = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (span <= eps2) continue;

      const on: { point: Point; t: number }[] = [];
      for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
        for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell); cy++) {
          for (const v of grid.get(`${cx},${cy}`) ?? []) {
            if ((v[0] === a[0] && v[1] === a[1]) || (v[0] === b[0] && v[1] === b[1])) continue;
            if (v[0] < minX || v[0] > maxX || v[1] < minY || v[1] > maxY) continue;
            if (segmentDistance2(v, a, b) > eps2) continue;
            const t = ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / span;
            if (t <= 0 || t >= 1) continue;
            on.push({ point: v, t });
          }
        }
      }
      on.sort((p, q) => p.t - q.t);
      for (const { point } of on) {
        const last = out[out.length - 1];
        if (last === undefined || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
      }
    }
    return dedupe(out);
  }));
}

export function areaOf(shape: Shape): number {
  let total = 0;
  for (const ring of shape) total += ringArea(ring);
  return total;
}

export function bboxOf(shape: Shape): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of shape) {
    for (const p of ring) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Cut `shape` into `pieces` roughly equal-area parts.
 *
 * Each step cuts across the **longer** axis of the current bounding box, which
 * keeps pieces compact rather than striping a continent, and bisects by area
 * rather than by distance so a tapering landmass does not yield one piece that
 * is all coastline. The split is `floor(k/2)` : `k - floor(k/2)`, recursively.
 */
export function splitShape(shape: Shape, pieces: number, quantise: (n: number) => number): Shape[] {
  if (pieces <= 1 || shape.length === 0) return [shape];
  const [minX, minY, maxX, maxY] = bboxOf(shape);
  const axis: 0 | 1 = maxX - minX >= maxY - minY ? 0 : 1;
  const lo = axis === 0 ? minX : minY;
  const hi = axis === 0 ? maxX : maxY;

  const left = Math.floor(pieces / 2);
  const wantFraction = left / pieces;
  const total = areaOf(shape);

  // Bisect for the cut that puts `wantFraction` of the area on the low side.
  let a = lo;
  let b = hi;
  let cut = (lo + hi) / 2;
  for (let step = 0; step < 40; step++) {
    cut = quantise((a + b) / 2);
    const got = total === 0 ? wantFraction : areaOf(clipHalfPlane(shape, axis, cut, "low")) / total;
    if (got < wantFraction) a = cut;
    else b = cut;
  }

  const low = clipHalfPlane(shape, axis, cut, "low");
  const high = clipHalfPlane(shape, axis, cut, "high");
  if (low.length === 0 || high.length === 0) {
    // Degenerate: nothing on one side. Give up on this branch rather than
    // recursing forever, and let the caller see fewer pieces than it asked for.
    return [shape];
  }
  return [...splitShape(low, left, quantise), ...splitShape(high, pieces - left, quantise)];
}

/* ------------------------------------------------------------------ merging -- */

export interface MergePlan {
  /** For each input index, the group it ended in. */
  readonly owner: readonly number[];
  /** Input indices per group, ascending. */
  readonly groups: readonly (readonly number[])[];
}

/**
 * Fold the smallest territories into neighbours until only `target` remain.
 *
 * Smallest-into-smallest-neighbour, repeatedly: it is the rule that produces
 * the fewest surprises, because it grows the runts rather than bolting them
 * onto whichever giant happens to be next door. A shape with no neighbour at all
 * — an island — is never a merge source, so a one-territory island survives as
 * its own territory and gets a sea link instead.
 */
export function mergeToTarget(
  sizes: readonly number[],
  adjacency: readonly ReadonlySet<number>[],
  target: number,
  /**
   * Where to put an island when the target cannot be reached by borders alone.
   *
   * Without it, "smallest into smallest neighbour" cannot touch a shape with no
   * neighbour, so a world board ends up one mega-territory plus every island as
   * its own. Given the nearest mainland group, an island joins it as a second
   * subpath — which is exactly how a simplified board treats the Caribbean.
   */
  nearest?: (from: number, candidates: readonly number[]) => number,
): MergePlan {
  const n = sizes.length;
  const groups: number[][] = sizes.map((_, i) => [i]);
  const area = [...sizes];
  const live = new Set<number>(groups.map((_, i) => i));
  const links: Set<number>[] = adjacency.map((set) => new Set(set));

  while (live.size > target) {
    // The smallest live group that still has a live neighbour.
    let from = -1;
    let smallest = Infinity;
    for (const g of [...live].sort((a, b) => a - b)) {
      if ((area[g] ?? 0) >= smallest) continue;
      if ([...(links[g] ?? [])].some((other) => live.has(other) && other !== g)) {
        smallest = area[g] ?? 0;
        from = g;
      }
    }

    let into = -1;
    if (from >= 0) {
      let bestArea = Infinity;
      for (const other of [...(links[from] ?? [])].sort((a, b) => a - b)) {
        if (!live.has(other) || other === from) continue;
        if ((area[other] ?? 0) < bestArea) {
          bestArea = area[other] ?? 0;
          into = other;
        }
      }
    }

    if (into < 0) {
      // Nothing left to merge across a border. Fall back to the nearest group,
      // smallest island first, or stop if the caller gave no distance measure.
      if (nearest === undefined) break;
      const islands = [...live]
        .filter((g) => ![...(links[g] ?? [])].some((other) => live.has(other) && other !== g))
        .sort((a, b) => (area[a] ?? 0) - (area[b] ?? 0) || a - b);
      from = islands[0] ?? -1;
      if (from < 0) break;
      const candidates = [...live].filter((g) => g !== from).sort((a, b) => a - b);
      into = candidates.length === 0 ? -1 : nearest(from, candidates);
      if (into < 0 || into === from || !live.has(into)) break;
    }

    (groups[into] as number[]).push(...(groups[from] as number[]));
    area[into] = (area[into] ?? 0) + (area[from] ?? 0);
    for (const other of links[from] ?? []) {
      if (other === into || other === from) continue;
      links[into]?.add(other);
      links[other]?.delete(from);
      links[other]?.add(into);
    }
    links[into]?.delete(from);
    links[into]?.delete(into);
    live.delete(from);
  }

  const ordered = [...live].sort((a, b) => a - b);
  const owner = new Array<number>(n).fill(-1);
  const out: number[][] = [];
  ordered.forEach((g, index) => {
    const members = (groups[g] as number[]).sort((a, b) => a - b);
    for (const m of members) owner[m] = index;
    out.push(members);
  });
  return { owner, groups: out };
}

/* ------------------------------------------------------------------ naming -- */

const VERTICAL: Record<number, readonly string[]> = {
  1: [""],
  2: ["North", "South"],
  3: ["North", "Mid", "South"],
  4: ["Far North", "North", "South", "Far South"],
};
const HORIZONTAL: Record<number, readonly string[]> = {
  1: [""],
  2: ["West", "East"],
  3: ["West", "Mid", "East"],
  4: ["Far West", "West", "East", "Far East"],
};

/**
 * Compass-band names for a set of shapes sharing one base word — the pieces of
 * a split country, or the continents of a generated board.
 *
 * Centroids are ranked into a `rows x cols` grid (`cols = ceil(sqrt(k))`) and
 * each band supplies the prefix, so "South East Europe" means the group really
 * is in the south-east. A band that somehow takes two groups disambiguates with
 * a Roman numeral, so the names are always distinct.
 *
 * The names are ours. No real sub-national or SMG naming scheme is reproduced
 * (D38) — where one of these coincides with a real region name, that is because
 * compass directions are compass directions.
 */
export function bandNames(centres: readonly Point[], base: string): string[] {
  const k = centres.length;
  if (k <= 1) return [base];
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(k))));
  const rows = Math.min(4, Math.max(1, Math.ceil(k / cols)));
  const byX = [...centres.keys()].sort((a, b) => (centres[a] as Point)[0] - (centres[b] as Point)[0]);
  const byY = [...centres.keys()].sort((a, b) => (centres[a] as Point)[1] - (centres[b] as Point)[1]);
  const colOf = new Map<number, number>();
  const rowOf = new Map<number, number>();
  byX.forEach((i, rank) => colOf.set(i, Math.min(cols - 1, Math.floor((rank * cols) / k))));
  byY.forEach((i, rank) => rowOf.set(i, Math.min(rows - 1, Math.floor((rank * rows) / k))));

  const vertical = VERTICAL[rows] ?? VERTICAL[3] as readonly string[];
  const horizontal = HORIZONTAL[cols] ?? HORIZONTAL[3] as readonly string[];

  const used = new Map<string, number>();
  return centres.map((_, i) => {
    const v = vertical[Math.min(vertical.length - 1, rowOf.get(i) ?? 0)] as string;
    const h = horizontal[Math.min(horizontal.length - 1, colOf.get(i) ?? 0)] as string;
    // "Mid Mid" is just the middle.
    const prefix = v === "Mid" && h === "Mid" ? "Central" : [v, h].filter((s) => s !== "").join(" ");
    const name = prefix === "" ? base : `${prefix} ${base}`;
    const seen = (used.get(name) ?? 0) + 1;
    used.set(name, seen);
    return seen === 1 ? name : `${name} ${toRoman(seen)}`;
  });
}

export function toRoman(n: number): string {
  const table: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let left = n;
  let out = "";
  for (const [value, glyph] of table) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

/** `"Côte d'Ivoire"` → `"cote_d_ivoire"`, deduped against `taken`. Matches the validator's id rule. */
export function slugify(name: string, taken: Set<string>): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "t";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

/** A kebab-case map slug. `MapFile.slug` is validated against this shape. */
export function slugifyKebab(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ suits -- */

const SUIT_ORDER: readonly Exclude<Suit, "wild">[] = ["infantry", "cavalry", "artillery"];

/**
 * One suit per territory (R19, F7).
 *
 * Round-robin by territory index, which satisfies T7's "the three counts differ
 * by at most one" **by construction**. `sourced` then pins the territories whose
 * real suit the research records, by swapping with the lowest-index unsourced
 * territory that currently holds the wanted suit — so a sourced fact is honoured
 * without unbalancing the deck (SPEC §4.14).
 */
export function assignSuits(
  ids: readonly string[],
  sourced: Readonly<Record<string, Exclude<Suit, "wild">>> = {},
): Exclude<Suit, "wild">[] {
  const suits = ids.map((_, i) => SUIT_ORDER[i % 3] as Exclude<Suit, "wild">);
  const pinned = new Set<number>();
  for (const id of Object.keys(sourced).sort()) {
    const want = sourced[id];
    const at = ids.indexOf(id);
    if (want === undefined || at < 0 || suits[at] === want) {
      if (at >= 0) pinned.add(at);
      continue;
    }
    const swapWith = suits.findIndex((s, i) => s === want && !pinned.has(i) && i !== at);
    if (swapWith < 0) continue;
    const held = suits[at] as Exclude<Suit, "wild">;
    suits[at] = want;
    suits[swapWith] = held;
    pinned.add(at);
  }
  return suits;
}

/* ------------------------------------------------------------------ assembly -- */

export interface TerritoryDraft {
  readonly id: string;
  readonly name: string;
  readonly continent: string;
  readonly shape: Shape;
  /** Territory ids this one borders by land. Symmetry is completed on assembly. */
  readonly adjacent: readonly string[];
}

export interface ContinentDraft {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Omitted for generated maps, where `bonusFor` prices the continent instead. */
  readonly bonus?: number;
}

export interface AssembleInput {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  readonly vertexBudget: number;
  readonly continents: readonly ContinentDraft[];
  readonly territories: readonly TerritoryDraft[];
  readonly seaLinks: readonly (readonly [string, string])[];
  readonly suits?: Readonly<Record<string, Exclude<Suit, "wild">>>;
  readonly capitals: number;
  readonly slots?: { readonly blizzards: number; readonly portals: number };
}

/**
 * Turn drafts into a `MapFile`: simplify each shape into the vertex budget,
 * solve anchors, complete adjacency symmetry, price the continents and deal the
 * suits.
 *
 * Adjacency symmetry is **completed** rather than asserted here, because a
 * derived edge is discovered from one side first and a hand-authored fix is
 * written once. The validator still asserts symmetry over the result (T7), so
 * nothing is being papered over — the file that lands on disk is symmetric by
 * construction and checked anyway.
 */
export function assemble(input: AssembleInput): MapFile {
  const span = Math.max(input.width, input.height);
  const fitted = input.territories.map((t) => fitVertexBudget(t.shape, input.vertexBudget, span));

  const ids = input.territories.map((t) => t.id);
  const suits = assignSuits(ids, input.suits ?? {});

  const neighbours = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  input.territories.forEach((t) => {
    for (const other of t.adjacent) {
      if (other === t.id || !neighbours.has(other)) continue;
      neighbours.get(t.id)?.add(other);
      neighbours.get(other)?.add(t.id);
    }
  });
  // Sea links are drawn as dashed routes, so they must not also be land borders.
  const sea = input.seaLinks
    .map(([a, b]) => [a, b] as const)
    .filter(([a, b]) => neighbours.has(a) && neighbours.has(b) && !(neighbours.get(a)?.has(b) ?? false));

  const territories = input.territories.map((t, i) => {
    const shape = fitted[i] as Ring[];
    const d = ringsToPath(shape);
    const anchors = anchorsForRings(shape);
    return {
      id: t.id,
      name: t.name,
      continent: t.continent,
      suit: suits[i] as Exclude<Suit, "wild">,
      adjacent: [...(neighbours.get(t.id) ?? [])].sort(),
      d,
      tokenX: anchors.token[0],
      tokenY: anchors.token[1],
      labelX: anchors.label[0],
      // Keep the label inside the frame; the validator requires both anchors in
      // the viewBox, and a southern coast can sit fewer than 26 units from it.
      labelY: Math.min(anchors.label[1], input.height - 2),
    };
  });

  const seaSets = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  for (const [a, b] of sea) {
    seaSets.get(a)?.add(b);
    seaSets.get(b)?.add(a);
  }

  const continents = input.continents.map((c) => {
    const members = input.territories.filter((t) => t.continent === c.id).map((t) => t.id);
    const inside = new Set(members);
    const borders = members.filter((m) =>
      [...(neighbours.get(m) ?? []), ...(seaSets.get(m) ?? [])].some((other) => !inside.has(other)),
    ).length;
    return {
      id: c.id,
      name: c.name,
      bonus: c.bonus ?? bonusFor(members.length, borders),
      color: c.color,
      territories: members,
    };
  }).filter((c) => c.territories.length > 0);

  const slots = input.slots ?? engine.slotsForSize(territories.length, input.capitals);
  return {
    slug: input.slug,
    name: input.name,
    tagline: input.tagline,
    viewBox: input.viewBox,
    continents,
    territories,
    seaLinks: sea.map(([from, to]) => ({ from, to })),
    modifierSlots: { blizzards: slots.blizzards, portals: slots.portals, capitals: input.capitals },
  };
}

/** Re-exported so callers need only one import for the build-time geometry. */
export { sharedVertexAdjacency, bonusFor, ringArea, ringsToPath, anchorsForRings, fitVertexBudget, segmentDistance2 };
