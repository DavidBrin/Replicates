/**
 * The seeded map generator — Tier 4 of the map plan (D37, SPEC §4.14).
 *
 * Jittered hex grid → Delaunay triangulation (Bowyer–Watson) → its Voronoi dual
 * → cells merged into territories → territories grouped into continents →
 * adjacency read off the shared cell edges → suits round-robin → anchors. Zero
 * IP risk, zero authoring, unlimited boards (`research/02-maps-and-fan-code.md`
 * §B.6 approach 4).
 *
 * **Pure and reproducible.** `(options, seed)` determines the board exactly: the
 * generator carries its own integer PCG32 rather than calling `rngFor`, because
 * a random map is minted during setup (S4's `MapSource`) before any `GameState`
 * or purpose-tagged sub-stream exists, and `GameConfig.mapSlug` has to be a
 * plain slug either way. Passing an `Rng` instead is supported for the SPEC
 * §4.14 signature.
 *
 * Every coordinate is **quantised** before it is used (see `QUANTUM`): the
 * union-of-cells boundary walk and the adjacency pass both rely on two cells
 * naming a shared vertex with the same number, and circumcentres computed from
 * different vertex orderings differ in the last bit.
 */

import type { MapFile, Rng, Suit } from "../types";
import { MAX_SEATS } from "../types";

import { anchorsFor } from "./anchors";
import { fitVertexBudget, pointInRings, ringArea, ringsToPath, type Point, type Ring } from "./path";
import { MAX_VERTICES } from "./schema";

/* ------------------------------------------------------------------ options -- */

export interface VoronoiOptions {
  /** 19..104 — the catalogue's own range, Small through Big (`smg-catalogue/all-maps.json`). */
  readonly territories: number;
  readonly continents: number; // 4..11
  readonly width: number;
  readonly height: number;
  /** Extra long edges drawn as dashed sea routes. Defaults to `round(territories / 6)`. */
  readonly seaLinks: number;
  readonly name?: string;
}

export const TERRITORY_RANGE = [19, 104] as const;
export const CONTINENT_RANGE = [4, 11] as const;
export const DEFAULT_SIZE = [1600, 900] as const;

/** Defaults filled in, every field clamped into range. */
export function normaliseOptions(options: Partial<VoronoiOptions>): VoronoiOptions {
  const clamp = (n: number, lo: number, hi: number): number =>
    !Number.isFinite(n) ? lo : Math.max(lo, Math.min(hi, Math.round(n)));
  const territories = clamp(options.territories ?? 42, TERRITORY_RANGE[0], TERRITORY_RANGE[1]);
  // A continent needs at least two territories to be worth a bonus, so the
  // ceiling tightens on a small board rather than minting singletons.
  const continents = clamp(options.continents ?? 6, CONTINENT_RANGE[0], Math.min(CONTINENT_RANGE[1], Math.floor(territories / 2)));
  return {
    territories,
    continents,
    width: clamp(options.width ?? DEFAULT_SIZE[0], 400, 4000),
    height: clamp(options.height ?? DEFAULT_SIZE[1], 300, 4000),
    seaLinks: clamp(options.seaLinks ?? Math.round(territories / 6), 0, territories),
    ...(options.name === undefined ? {} : { name: options.name }),
  };
}

/* ------------------------------------------------------------------ prng -- */

/**
 * PCG32 over a 64-bit state held as two u32s. Integer operations only
 * (`Math.imul`, `>>> 0`), so it is bit-identical on every engine — the same
 * requirement S1's `prng.ts` carries, restated here because the generator must
 * run before S1's stream exists.
 */
function pcg(seedHi: number, seedLo: number): () => number {
  let hi = seedHi >>> 0;
  let lo = seedLo >>> 0;
  const MUL_HI = 0x5851f42d;
  const MUL_LO = 0x4c957f2d;
  const INC_HI = 0x14057b7e;
  const INC_LO = 0xf767814f;

  const step = (): void => {
    // 64-bit multiply-add in 32-bit halves. The high word needs the two cross
    // products plus the carry out of the low word's own multiply.
    const loLo = Math.imul(lo, MUL_LO) >>> 0;
    const carry = (lo >>> 16) * (MUL_LO & 0xffff) + ((lo & 0xffff) * (MUL_LO >>> 16));
    const loCarry = Math.floor(((lo & 0xffff) * (MUL_LO & 0xffff) + ((carry & 0xffff) << 16)) / 0x100000000)
      + (carry >>> 16);
    const newHi = (Math.imul(hi, MUL_LO) + Math.imul(lo, MUL_HI) + loCarry) >>> 0;
    const sumLo = (loLo + INC_LO) >>> 0;
    const addCarry = sumLo < loLo ? 1 : 0;
    hi = (newHi + INC_HI + addCarry) >>> 0;
    lo = sumLo;
  };

  return (): number => {
    step();
    // XSH-RR: xorshift the state down into 32 bits, then rotate by the top 5.
    const xorshifted = (((hi >>> 13) ^ ((hi << 19) | (lo >>> 13))) >>> 0);
    const rot = hi >>> 27;
    return (((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0);
  };
}

/** FNV-1a over the seed string, split into the two state words. */
function seedWords(seed: string): [number, number] {
  let hi = 0x811c9dc5;
  let lo = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i) & 0xffff;
    hi = Math.imul(hi ^ code, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ (code + i), 0x85ebca6b) >>> 0;
  }
  // A short seed should not leave either word degenerate.
  hi = (hi ^ (lo >>> 7)) >>> 0;
  lo = (lo ^ (hi >>> 11)) >>> 0;
  return [hi === 0 ? 0x9e3779b9 : hi, lo === 0 ? 0x85ebca6b : lo];
}

function nextFloat(nextU32: () => number): number {
  return (nextU32() >>> 0) / 0x100000000;
}

/* ------------------------------------------------------------------ quantisation -- */

/** Coordinates are snapped to this grid. 1/64 of a unit: invisible, and exactly representable. */
const QUANTUM = 64;

function q(n: number): number {
  const v = Math.round(n * QUANTUM) / QUANTUM;
  return Object.is(v, -0) ? 0 : v;
}

function keyOf(p: Point): string {
  return `${p[0]},${p[1]}`;
}

/* ------------------------------------------------------------------ delaunay -- */

interface Triangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly cx: number;
  readonly cy: number;
  readonly r2: number;
}

function circumcircle(p: Point, qq: Point, r: Point): Triangle | null {
  const ax = p[0];
  const ay = p[1];
  const bx = qq[0];
  const by = qq[1];
  const cx = r[0];
  const cy = r[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const dx = ax - ux;
  const dy = ay - uy;
  return { a: 0, b: 0, c: 0, cx: ux, cy: uy, r2: dx * dx + dy * dy };
}

/**
 * Bowyer–Watson. Sites are inserted in index order into a super-triangle that
 * encloses everything, each insertion deleting the triangles whose circumcircle
 * contains the new site and re-triangulating the resulting cavity.
 *
 * Returns the triangles over the real sites only; the three super-triangle
 * corners are indices `n`, `n + 1`, `n + 2` and are dropped at the end.
 */
export function delaunay(sites: readonly Point[]): Triangle[] {
  const n = sites.length;
  if (n < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of sites) {
    minX = Math.min(minX, s[0]);
    minY = Math.min(minY, s[1]);
    maxX = Math.max(maxX, s[0]);
    maxY = Math.max(maxY, s[1]);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const points: Point[] = [
    ...sites,
    [midX - 20 * span, midY - span],
    [midX, midY + 20 * span],
    [midX + 20 * span, midY - span],
  ];

  const make = (a: number, b: number, c: number): Triangle | null => {
    const circle = circumcircle(points[a] as Point, points[b] as Point, points[c] as Point);
    return circle === null ? null : { a, b, c, cx: circle.cx, cy: circle.cy, r2: circle.r2 };
  };

  const seed = make(n, n + 1, n + 2);
  if (seed === null) return [];
  let triangles: Triangle[] = [seed];

  for (let i = 0; i < n; i++) {
    const p = points[i] as Point;
    const bad: Triangle[] = [];
    const good: Triangle[] = [];
    for (const t of triangles) {
      const dx = p[0] - t.cx;
      const dy = p[1] - t.cy;
      if (dx * dx + dy * dy <= t.r2 * (1 + 1e-12)) bad.push(t);
      else good.push(t);
    }
    // The cavity boundary is every edge of a bad triangle that no other bad
    // triangle shares.
    const count = new Map<string, number>();
    const edges: [number, number][] = [];
    for (const t of bad) {
      for (const e of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const k = e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`;
        count.set(k, (count.get(k) ?? 0) + 1);
        edges.push(e);
      }
    }
    triangles = good;
    for (const e of edges) {
      const k = e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`;
      if (count.get(k) !== 1) continue;
      const t = make(e[0], e[1], i);
      if (t !== null) triangles.push(t);
    }
  }

  return triangles.filter((t) => t.a < n && t.b < n && t.c < n);
}

/* ------------------------------------------------------------------ voronoi cells -- */

/**
 * The Voronoi cell of every site, clipped to `[0, width] x [0, height]` and
 * quantised.
 *
 * Each cell is the circumcentres of the triangles around its site, in angular
 * order. Hull sites have an open fan, so the generator plants a ring of sites
 * outside the frame (see `hexSites`) and only the inner ones are kept — which
 * is cheaper and far less error-prone than closing unbounded cells by hand.
 */
export function voronoiCells(sites: readonly Point[], width: number, height: number): Ring[] {
  const triangles = delaunay(sites);
  const fan: { at: number; point: Point }[][] = sites.map(() => []);
  for (const t of triangles) {
    const point: Point = [q(t.cx), q(t.cy)];
    for (const site of [t.a, t.b, t.c]) fan[site]?.push({ at: site, point });
  }

  return sites.map((site, i) => {
    const ring = (fan[i] ?? []).map((f) => f.point);
    if (ring.length < 3) return [];
    const ordered = [...ring].sort(
      (a, b) => Math.atan2(a[1] - site[1], a[0] - site[0]) - Math.atan2(b[1] - site[1], b[0] - site[0]),
    );
    const deduped: Point[] = [];
    for (const p of ordered) {
      const last = deduped[deduped.length - 1];
      if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) deduped.push(p);
    }
    return clipToBox(deduped, width, height).map((p) => [q(p[0]), q(p[1])] as Point);
  });
}

/** Sutherland–Hodgman against the four half-planes of the frame. */
export function clipToBox(ring: Ring, width: number, height: number): Ring {
  const planes: ((p: Point) => number)[] = [
    (p) => p[0],
    (p) => width - p[0],
    (p) => p[1],
    (p) => height - p[1],
  ];
  let current: Point[] = [...ring];
  for (const inside of planes) {
    const next: Point[] = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i] as Point;
      const b = current[(i + 1) % current.length] as Point;
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

/* ------------------------------------------------------------------ sites -- */

/**
 * A jittered hex grid covering the frame, plus one ring of sites outside it.
 *
 * A hex lattice gives cells of even size — a uniform random scatter produces
 * slivers next to blobs, which plays badly — and the jitter is what stops the
 * board looking like a honeycomb. The outside ring exists purely so every cell
 * inside the frame is bounded; `inner` says how many of the returned sites are
 * real.
 */
export function hexSites(
  cells: number,
  width: number,
  height: number,
  nextU32: () => number,
): { sites: Point[]; inner: number } {
  // Solve for a spacing that puts about `cells` hex centres inside the frame:
  // one row is `width / s` centres, rows are `s * sqrt(3) / 2` apart.
  const spacing = Math.sqrt((width * height * 2) / (cells * Math.sqrt(3)));
  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const jitter = spacing * 0.33;

  const inner: Point[] = [];
  const outer: Point[] = [];
  const rows = Math.ceil(height / rowHeight) + 3;
  const cols = Math.ceil(width / spacing) + 3;
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const x = c * spacing + (r % 2 === 0 ? 0 : spacing / 2);
      const y = r * rowHeight;
      const isInside = x > 0 && x < width && y > 0 && y < height;
      if (isInside) {
        inner.push([
          q(x + (nextFloat(nextU32) - 0.5) * jitter),
          q(y + (nextFloat(nextU32) - 0.5) * jitter),
        ]);
      } else {
        outer.push([q(x), q(y)]);
      }
    }
  }
  return { sites: [...inner, ...outer], inner: inner.length };
}

/* ------------------------------------------------------------------ merging -- */

/** Cell adjacency: two cells are neighbours when their rings share two vertices — a whole edge. */
export function cellAdjacency(cells: readonly Ring[]): Set<number>[] {
  const byVertex = new Map<string, number[]>();
  cells.forEach((ring, i) => {
    for (const p of ring) {
      const k = keyOf(p);
      const list = byVertex.get(k);
      if (list === undefined) byVertex.set(k, [i]);
      else if (!list.includes(i)) list.push(i);
    }
  });

  const shared = new Map<string, number>();
  for (const list of byVertex.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i] as number, list[j] as number);
        const b = Math.max(list[i] as number, list[j] as number);
        const k = `${a}_${b}`;
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
    }
  }

  const out: Set<number>[] = cells.map(() => new Set<number>());
  for (const [k, n] of shared) {
    if (n < 2) continue; // a single shared vertex is a corner touch, not a border
    const [a, b] = k.split("_").map(Number) as [number, number];
    out[a]?.add(b);
    out[b]?.add(a);
  }
  return out;
}

/**
 * The outline of a connected group of cells, as rings.
 *
 * Every directed cell edge is collected and any edge whose reverse is also
 * present is dropped — that is exactly the internal borders — then the survivors
 * are stitched end to end. Works because every coordinate is quantised, so two
 * cells sharing a border name its endpoints identically.
 */
export function unionOutline(group: readonly number[], cells: readonly Ring[]): Ring[] {
  const directed = new Map<string, [Point, Point]>();
  for (const index of group) {
    const ring = cells[index];
    if (ring === undefined || ring.length < 3) continue;
    // Walk every ring the same way round so that a shared border really does
    // appear once in each direction.
    const walk = ringArea2Sign(ring) < 0 ? [...ring].reverse() : ring;
    for (let i = 0; i < walk.length; i++) {
      const a = walk[i] as Point;
      const b = walk[(i + 1) % walk.length] as Point;
      if (a[0] === b[0] && a[1] === b[1]) continue;
      directed.set(`${keyOf(a)}>${keyOf(b)}`, [a, b]);
    }
  }
  const boundary = new Map<string, Point>();
  for (const [k, [a, b]] of directed) {
    const reverse = `${keyOf(b)}>${keyOf(a)}`;
    if (directed.has(reverse)) continue;
    boundary.set(`${keyOf(a)}|${k}`, b);
  }

  // Index the surviving half-edges by their start vertex and walk the loops.
  const outgoing = new Map<string, Point[]>();
  for (const [k, to] of boundary) {
    const from = k.slice(0, k.indexOf("|"));
    const list = outgoing.get(from);
    if (list === undefined) outgoing.set(from, [to]);
    else list.push(to);
  }
  const byKey = new Map<string, Point>();
  for (const [k, list] of outgoing) {
    for (const p of list) byKey.set(keyOf(p), p);
    byKey.set(k, byKey.get(k) ?? (list[0] as Point));
  }

  const rings: Ring[] = [];
  const spent = new Set<string>();
  for (const start of outgoing.keys()) {
    if (spent.has(start)) continue;
    const ring: Point[] = [];
    let at = start;
    for (let guard = 0; guard < 100000; guard++) {
      const list = outgoing.get(at);
      if (list === undefined) break;
      const next = list.find((p) => !spent.has(`${at}>${keyOf(p)}`));
      if (next === undefined) break;
      spent.add(`${at}>${keyOf(next)}`);
      spent.add(at);
      const point = parseKey(at);
      if (point !== null) ring.push(point);
      at = keyOf(next);
      if (at === start) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function parseKey(k: string): Point | null {
  const at = k.indexOf(",");
  if (at < 0) return null;
  const x = Number(k.slice(0, at));
  const y = Number(k.slice(at + 1));
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function ringArea2Sign(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Point;
    const b = ring[i] as Point;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/**
 * Grow `count` connected groups over an adjacency graph, kept the same size.
 *
 * Seeds are farthest-point sampled so the groups start spread out, then the
 * group with the fewest members always picks next — which is what stops one
 * blob eating the board. Used twice: cells into territories, then territories
 * into continents.
 */
export function growGroups(
  count: number,
  adjacency: readonly ReadonlySet<number>[],
  centres: readonly Point[],
  nextU32: () => number,
): number[] {
  const n = adjacency.length;
  const owner = new Array<number>(n).fill(-1);
  if (count <= 0 || n === 0) return owner;

  const seeds: number[] = [Math.floor(nextFloat(nextU32) * n) % n];
  while (seeds.length < Math.min(count, n)) {
    let best = -1;
    let bestDistance = -1;
    for (let i = 0; i < n; i++) {
      if (seeds.includes(i)) continue;
      let nearest = Infinity;
      for (const s of seeds) {
        const a = centres[i] as Point;
        const b = centres[s] as Point;
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        nearest = Math.min(nearest, dx * dx + dy * dy);
      }
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
    // The smallest group picks first; ties go to the lowest index, so the whole
    // pass is a total order and the result is reproducible.
    let group = -1;
    let smallest = Infinity;
    for (let g = 0; g < members.length; g++) {
      const size = (members[g] as number[]).length;
      if (size < smallest && frontierOf(g, members, adjacency, owner).length > 0) {
        smallest = size;
        group = g;
      }
    }
    if (group < 0) break;

    const frontier = frontierOf(group, members, adjacency, owner);
    const centre = groupCentre(members[group] as number[], centres);
    let pick = frontier[0] as number;
    let best = Infinity;
    for (const candidate of frontier) {
      const p = centres[candidate] as Point;
      const dx = p[0] - centre[0];
      const dy = p[1] - centre[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        pick = candidate;
      }
    }
    owner[pick] = group;
    (members[group] as number[]).push(pick);
    assigned++;
  }

  // Anything the growth could not reach (an island with no graph edge) joins
  // the nearest group outright, so no member is left unowned.
  for (let i = 0; i < n; i++) {
    if (owner[i] !== -1) continue;
    let pick = 0;
    let best = Infinity;
    for (let g = 0; g < members.length; g++) {
      const centre = groupCentre(members[g] as number[], centres);
      const p = centres[i] as Point;
      const dx = p[0] - centre[0];
      const dy = p[1] - centre[1];
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
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
  const out: number[] = [];
  for (const m of members[group] as number[]) {
    for (const other of adjacency[m] ?? []) {
      if (owner[other] === -1 && !out.includes(other)) out.push(other);
    }
  }
  return out.sort((a, b) => a - b);
}

function groupCentre(members: readonly number[], centres: readonly Point[]): Point {
  let sx = 0;
  let sy = 0;
  for (const m of members) {
    const p = centres[m] as Point;
    sx += p[0];
    sy += p[1];
  }
  return members.length === 0 ? [0, 0] : [sx / members.length, sy / members.length];
}

/* ------------------------------------------------------------------ naming -- */

const ONSETS = ["Ar", "Bel", "Cor", "Dar", "El", "Fen", "Gal", "Hal", "Ith", "Jor", "Kel", "Lor",
  "Mor", "Nar", "Ost", "Pel", "Quor", "Rav", "Sel", "Tor", "Ul", "Vor", "Wen", "Yr", "Zan"];
const CODAS = ["an", "eth", "ia", "or", "ask", "ume", "ira", "ond", "arr", "yx", "ael", "une",
  "ost", "ir", "ane", "oll", "ryn", "ath", "usk", "elm"];
const CONTINENT_WORDS = ["Reach", "Expanse", "Marches", "Dominion", "Provinces", "Confederacy",
  "Protectorate", "League", "Hegemony", "Commonwealth", "Territories"];

/** The eleven continent accents. `--c-na … --c-au` from `globals.css` plus five of the same family. */
export const CONTINENT_COLORS = ["#36B0EA", "#DA3A4F", "#5FBF2A", "#9B4AE8", "#E08A24", "#F0C33A",
  "#2AC4A8", "#E8569B", "#7D8CF0", "#C7D63A", "#D96A2A"] as const;

function mintNames(count: number, nextU32: () => number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let name = "";
    for (let tries = 0; tries < 200; tries++) {
      const onset = ONSETS[Math.floor(nextFloat(nextU32) * ONSETS.length) % ONSETS.length] as string;
      const coda = CODAS[Math.floor(nextFloat(nextU32) * CODAS.length) % CODAS.length] as string;
      name = onset + coda;
      if (!used.has(name)) break;
      name = `${onset}${coda} ${toRoman(i + 1)}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}

function toRoman(n: number): string {
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

/** `"Ithane II"` → `"ithane_ii"`, deduped against `taken`. Matches the validator's id rule. */
export function slugifyId(name: string, taken: Set<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "t";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

/* ------------------------------------------------------------------ the generator -- */

const SUIT_ORDER: readonly Exclude<Suit, "wild">[] = ["infantry", "cavalry", "artillery"];

/**
 * A fresh board from `(options, seed)`.
 *
 * `seed` may be a string or an `Rng` (SPEC §4.14 passes `rngFor(...)`); a string
 * is the offline path, because a random map is minted in setup before any
 * sub-stream exists. Either way the output is a `MapFile` that
 * `validateMap` accepts — the generator is held to the same gate as a shipped
 * board (D36).
 */
export function generateVoronoiMap(options: VoronoiOptions, seed: string | Rng): MapFile {
  const o = normaliseOptions(options);
  const nextU32: () => number = typeof seed === "string"
    ? ((): (() => number) => {
      const [hi, lo] = seedWords(seed);
      return pcg(hi, lo);
    })()
    : () => seed.nextU32() >>> 0;
  const slugSeed = typeof seed === "string" ? seed : `rng-${seed.state[0]}-${seed.state[1]}`;

  /* ---- cells ---- */
  // Three cells per territory: enough that a merged territory has a believable
  // coastline, few enough that the triangulation stays quick in a browser.
  const { sites, inner } = hexSites(o.territories * 3, o.width, o.height, nextU32);
  const allCells = voronoiCells(sites, o.width, o.height);
  const cells = allCells.slice(0, inner).map((ring) => (ring.length >= 3 ? ring : []));
  const live: number[] = [];
  cells.forEach((ring, i) => {
    if (ring.length >= 3) live.push(i);
  });

  const compact = live.map((i) => cells[i] as Ring);
  const cellAdj = cellAdjacency(compact);
  const cellCentres = compact.map((ring) => polygonCentre(ring));

  /* ---- cells into territories ---- */
  const owner = growGroups(o.territories, cellAdj, cellCentres, nextU32);
  const groupCount = Math.max(...owner) + 1;
  const groups: number[][] = Array.from({ length: groupCount }, () => []);
  owner.forEach((g, cell) => {
    if (g >= 0) (groups[g] as number[]).push(cell);
  });

  const outlines = groups.map((group) => {
    const rings = unionOutline(group, compact);
    const fitted = fitVertexBudget(rings, MAX_VERTICES, Math.max(o.width, o.height));
    return fitted.length > 0 ? fitted : [compact[group[0] ?? 0] ?? []];
  });

  /* ---- territory adjacency, read off the shared cell edges ---- */
  const territoryAdj: Set<number>[] = groups.map(() => new Set<number>());
  cellAdj.forEach((neighbours, cell) => {
    const a = owner[cell] as number;
    for (const other of neighbours) {
      const b = owner[other] as number;
      if (a >= 0 && b >= 0 && a !== b) {
        territoryAdj[a]?.add(b);
        territoryAdj[b]?.add(a);
      }
    }
  });

  /* ---- territories into continents ---- */
  const centres = outlines.map((rings) => polygonCentre(largestOf(rings)));
  const continentOf = growGroups(o.continents, territoryAdj, centres, nextU32);
  const continentCount = Math.max(...continentOf) + 1;

  /* ---- names and ids ---- */
  const territoryNames = mintNames(groups.length, nextU32);
  const continentNames = mintNames(continentCount, nextU32).map(
    (n, i) => `${n} ${CONTINENT_WORDS[i % CONTINENT_WORDS.length] as string}`,
  );
  const takenTerritory = new Set<string>();
  const takenContinent = new Set<string>();
  const territoryIds = territoryNames.map((n) => slugifyId(n, takenTerritory));
  const continentIds = continentNames.map((n) => slugifyId(n, takenContinent));

  /* ---- sea links: non-adjacent pairs, longest first ---- */
  const seaLinks: { from: string; to: string }[] = [];
  const candidates: { a: number; b: number; d2: number }[] = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (territoryAdj[a]?.has(b) ?? false) continue;
      const p = centres[a] as Point;
      const r = centres[b] as Point;
      candidates.push({ a, b, d2: (p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2 });
    }
  }
  // Shortest non-adjacent pairs make the most plausible sea routes: two coasts
  // across a strait, not two corners of the board.
  candidates.sort((x, y) => x.d2 - y.d2 || x.a - y.a || x.b - y.b);
  const endpointUse = new Map<number, number>();
  for (const c of candidates) {
    if (seaLinks.length >= o.seaLinks) break;
    if ((endpointUse.get(c.a) ?? 0) >= 2 || (endpointUse.get(c.b) ?? 0) >= 2) continue;
    endpointUse.set(c.a, (endpointUse.get(c.a) ?? 0) + 1);
    endpointUse.set(c.b, (endpointUse.get(c.b) ?? 0) + 1);
    seaLinks.push({ from: territoryIds[c.a] as string, to: territoryIds[c.b] as string });
  }
  const sea = new Map<number, Set<number>>();
  for (const c of candidates) {
    if (!seaLinks.some((l) => l.from === territoryIds[c.a] && l.to === territoryIds[c.b])) continue;
    if (!sea.has(c.a)) sea.set(c.a, new Set());
    if (!sea.has(c.b)) sea.set(c.b, new Set());
    sea.get(c.a)?.add(c.b);
    sea.get(c.b)?.add(c.a);
  }

  /* ---- continents, with the bonus heuristic ---- */
  const continentMembers: number[][] = Array.from({ length: continentCount }, () => []);
  continentOf.forEach((c, t) => {
    if (c >= 0) (continentMembers[c] as number[]).push(t);
  });

  const continents = continentMembers.map((members, i) => {
    const inside = new Set(members);
    const borders = members.filter((m) =>
      [...(territoryAdj[m] ?? []), ...(sea.get(m) ?? [])].some((n) => !inside.has(n)),
    ).length;
    return {
      id: continentIds[i] as string,
      name: continentNames[i] as string,
      bonus: bonusFor(members.length, borders),
      color: CONTINENT_COLORS[i % CONTINENT_COLORS.length] as string,
      territories: members.sort((a, b) => a - b).map((m) => territoryIds[m] as string),
    };
  });

  /* ---- assemble ---- */
  const territories = groups.map((_, i) => {
    const rings = outlines[i] as Ring[];
    const d = ringsToPath(rings);
    const anchors = anchorsFor(d);
    const label: [number, number] = [anchors.label[0], Math.min(anchors.label[1], o.height - 2)];
    return {
      id: territoryIds[i] as string,
      name: territoryNames[i] as string,
      continent: continentIds[continentOf[i] as number] as string,
      // Round-robin by territory index: satisfies T7's "counts differ by at most
      // one" by construction, which is the gate a generated deck has to clear
      // because there is no sourced suit to honour (F7, SPEC §4.14).
      suit: SUIT_ORDER[i % 3] as Exclude<Suit, "wild">,
      adjacent: [...(territoryAdj[i] ?? [])].sort((a, b) => a - b).map((n) => territoryIds[n] as string),
      d,
      tokenX: anchors.token[0],
      tokenY: anchors.token[1],
      labelX: label[0],
      labelY: label[1],
    };
  });

  const count = territories.length;
  return {
    slug: `random-${slugify36(slugSeed)}`,
    name: o.name ?? `Random Board (${count})`,
    tagline: `Seeded board: ${count} territories, ${continents.length} regions`,
    viewBox: `0 0 ${o.width} ${o.height}`,
    continents,
    territories,
    seaLinks: seaLinks.filter((l) => territories.some((t) => t.id === l.from) && territories.some((t) => t.id === l.to)),
    modifierSlots: slotsForSize(count),
  };
}

/** `bonus ≈ round(size / 3 + borders / 2)`, at least 1. Reproduces Classic's 5/2/5/3/7/2 within one. */
export function bonusFor(size: number, borders: number): number {
  return Math.max(1, Math.round(size / 3 + borders / 2));
}

/**
 * Blizzard and portal counts that track the real catalogue: Classic (42) is
 * 3 and 5, Africa (37) is 2 and 4, Asia 1800s (48) is 4 and 6
 * (`smg-catalogue/all-maps.json`). Clamped to R74/R76's 2–11 and 3–7.
 */
export function slotsForSize(territories: number): { blizzards: number; portals: number; capitals: number } {
  const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
  return {
    blizzards: clamp(Math.round(territories / 15), 2, 11),
    portals: clamp(Math.round(territories / 9), 3, 7),
    capitals: MAX_SEATS,
  };
}

function slugify36(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

function largestOf(rings: readonly Ring[]): Ring {
  let best: Ring = rings[0] ?? [];
  let bestArea = -1;
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

/** The area centroid, falling back to the vertex mean for a degenerate ring. */
function polygonCentre(ring: Ring): Point {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j] as Point;
    const r = ring[i] as Point;
    const cross = p[0] * r[1] - r[0] * p[1];
    a2 += cross;
    cx += (p[0] + r[0]) * cross;
    cy += (p[1] + r[1]) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
    }
    return ring.length === 0 ? [0, 0] : [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

/** Re-exported so a caller can confirm an anchor really is inside its own land. */
export { pointInRings };
