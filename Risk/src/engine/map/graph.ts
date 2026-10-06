/**
 * Graph work shared by the seeded generator and the build-time pipeline:
 * deriving adjacency from geometry, growing balanced connected groups, finding
 * components, and the continent bonus heuristic.
 *
 * This lives in the engine rather than in `scripts/` because `voronoi.ts` needs
 * all four at run time and the Tier 3 pipeline needs the same four at build
 * time — and two copies of "are these two shapes neighbours?" is exactly the
 * kind of drift D36's validator exists to catch.
 *
 * Its only import is **type-only**, which is what lets `scripts/maps/engine.ts`
 * load it in a plain `node --experimental-strip-types` process: a type import is
 * erased, so Node never has to resolve the extensionless specifier.
 */

import type { Point, Ring } from "./path";

/* ------------------------------------------------------------------ adjacency -- */

/**
 * Adjacency from geometry: two shapes are neighbours when their rings name
 * **two or more identical vertices** — a shared edge, not a shared corner.
 *
 * Exactness is the whole trick, and it is bought by quantising every coordinate
 * before this runs (`sources.ts`'s `QUANTUM`, `voronoi.ts`'s `q`). The sources
 * in use all share border coordinates by construction — a TopoJSON border is
 * one arc referenced twice, a half-plane cut computes the same crossing from the
 * same edge for both sides — so after snapping, "same border" means "same
 * numbers".
 *
 * Verified against `topojson.neighbors` over all 177 world-atlas countries:
 * 313 of 314 edges derived, **zero** false positives.
 *
 * @param shapes one entry per territory; each entry is that territory's rings.
 */
export function sharedVertexAdjacency(shapes: readonly (readonly Ring[])[]): Set<number>[] {
  const byVertex = new Map<string, number[]>();
  shapes.forEach((rings, i) => {
    for (const ring of rings) {
      for (const p of ring) {
        const key = `${p[0]},${p[1]}`;
        const list = byVertex.get(key);
        if (list === undefined) byVertex.set(key, [i]);
        else if (!list.includes(i)) list.push(i);
      }
    }
  });

  const shared = new Map<number, number>();
  const width = shapes.length;
  for (const list of byVertex.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i] as number, list[j] as number);
        const b = Math.max(list[i] as number, list[j] as number);
        const key = a * width + b;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  const out: Set<number>[] = shapes.map(() => new Set<number>());
  for (const [key, count] of shared) {
    if (count < 2) continue;
    const a = Math.floor(key / width);
    const b = key % width;
    out[a]?.add(b);
    out[b]?.add(a);
  }
  return out;
}

/* ------------------------------------------------------------------ components -- */

/** Connected components, each sorted ascending, ordered by their lowest member. */
export function componentsOf(adjacency: readonly ReadonlySet<number>[]): number[][] {
  const seen = new Uint8Array(adjacency.length);
  const out: number[][] = [];
  for (let start = 0; start < adjacency.length; start++) {
    if (seen[start] === 1) continue;
    const component: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      component.push(at);
      for (const other of adjacency[at] ?? []) {
        if (seen[other] === 1) continue;
        seen[other] = 1;
        stack.push(other);
      }
    }
    out.push(component.sort((a, b) => a - b));
  }
  return out;
}

/* ------------------------------------------------------------------ grouping -- */

/**
 * Grow `count` **connected**, evenly sized groups over an adjacency graph.
 *
 * Seeds are farthest-point sampled from `centres` so the groups start spread
 * out, then the group with the fewest members always picks next — which is what
 * stops one blob eating the board. Every tie is broken by the lowest index, so
 * the whole pass is a total order (R91) and the result is reproducible from
 * `(graph, centres, firstSeed)` alone.
 *
 * Used three times: Voronoi cells into territories, territories into
 * continents, and source features into territories in the Tier 3 pipeline.
 */
export function growGroups(
  count: number,
  adjacency: readonly ReadonlySet<number>[],
  centres: readonly Point[],
  firstSeed = 0,
): number[] {
  const n = adjacency.length;
  const owner = new Array<number>(n).fill(-1);
  if (count <= 0 || n === 0) return owner;

  const seeds: number[] = [((firstSeed % n) + n) % n];
  while (seeds.length < Math.min(count, n)) {
    let best = -1;
    let bestDistance = -1;
    for (let i = 0; i < n; i++) {
      if (seeds.includes(i)) continue;
      let nearest = Infinity;
      for (const s of seeds) nearest = Math.min(nearest, distance2(centres[i], centres[s]));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = i;
      }
    }
    if (best < 0) break;
    seeds.push(best);
  }

  const members: number[][] = seeds.map((s, g) => {
    owner[s] = g;
    return [s];
  });

  let assigned = seeds.length;
  while (assigned < n) {
    let group = -1;
    let smallest = Infinity;
    let frontier: number[] = [];
    for (let g = 0; g < members.length; g++) {
      const size = (members[g] as number[]).length;
      if (size >= smallest) continue;
      const candidates = frontierOf(g, members, adjacency, owner);
      if (candidates.length === 0) continue;
      smallest = size;
      group = g;
      frontier = candidates;
    }
    if (group < 0) break;

    const centre = groupCentre(members[group] as number[], centres);
    let pick = frontier[0] as number;
    let best = Infinity;
    for (const candidate of frontier) {
      const d2 = distance2(centres[candidate], centre);
      if (d2 < best) {
        best = d2;
        pick = candidate;
      }
    }
    owner[pick] = group;
    (members[group] as number[]).push(pick);
    assigned++;
  }

  // An island with no graph edge cannot be grown into, so it joins the group
  // whose centre is nearest. No member is ever left unowned.
  for (let i = 0; i < n; i++) {
    if (owner[i] !== -1) continue;
    let pick = 0;
    let best = Infinity;
    for (let g = 0; g < members.length; g++) {
      const d2 = distance2(centres[i], groupCentre(members[g] as number[], centres));
      if (d2 < best) {
        best = d2;
        pick = g;
      }
    }
    owner[i] = pick;
    (members[pick] as number[]).push(i);
  }
  return owner;
}

function frontierOf(
  group: number,
  members: readonly number[][],
  adjacency: readonly ReadonlySet<number>[],
  owner: readonly number[],
): number[] {
  const out = new Set<number>();
  for (const m of members[group] as number[]) {
    for (const other of adjacency[m] ?? []) if (owner[other] === -1) out.add(other);
  }
  return [...out].sort((a, b) => a - b);
}

function groupCentre(members: readonly number[], centres: readonly Point[]): Point {
  let sx = 0;
  let sy = 0;
  for (const m of members) {
    const p = centres[m];
    if (p === undefined) continue;
    sx += p[0];
    sy += p[1];
  }
  return members.length === 0 ? [0, 0] : [sx / members.length, sy / members.length];
}

function distance2(a: Point | undefined, b: Point | undefined): number {
  if (a === undefined || b === undefined) return Infinity;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/* ------------------------------------------------------------------ bonuses -- */

/**
 * `bonus ≈ round(size / 3 + borders / 2)`, at least 1.
 *
 * Tuned against the real catalogue rather than invented: on the Classic graph it
 * returns **5 / 2 / 4 / 4 / 7 / 2** where Hasbro has 5 / 2 / 5 / 3 / 7 / 2 —
 * exact on North America, South America, Asia and Australia, one out on Europe
 * and Africa. Size alone ranks Europe first, which is the bug the border term
 * fixes (`research/02-maps-and-fan-code.md`: bonus-per-border-crossing is the
 * metric to match).
 */
export function bonusFor(size: number, borders: number): number {
  return Math.max(1, Math.round(size / 3 + borders / 2));
}

/**
 * Blizzard and portal counts that track the real catalogue: Classic (42) → 3
 * and 5, Africa (37) → 2 and 4, Asia 1800s (48) → 3 and 5 against a published
 * 4 and 6 (`smg-catalogue/all-maps.json`). Clamped into R74/R76's 2–11 and 3–7.
 */
export function slotsForSize(
  territories: number,
  capitals: number,
): { blizzards: number; portals: number; capitals: number } {
  const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
  return {
    blizzards: clamp(Math.round(territories / 15), 2, 11),
    portals: clamp(Math.round(territories / 9), 3, 7),
    capitals,
  };
}
