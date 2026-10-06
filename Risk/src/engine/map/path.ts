/**
 * SVG path arithmetic — the only geometry primitive the engine owns (SPEC §4.14, §8).
 *
 * Every shipped map carries its territory outline as a `d` string (D36), so the
 * validator, the anchor solver and the generator all need to turn one back into
 * rings of points. This module is the single place that parses path data, so a
 * `d` the validator accepted is a `d` `anchorsFor` can place a token inside.
 *
 * Pure arithmetic: no randomness, no clock, no DOM (D2, D9). `parseRings`
 * flattens curves, which is lossy on purpose — a rendered curve and a
 * point-in-polygon test need different things, and only the latter lives here.
 */

/** A point, in `viewBox` units. Tuples rather than objects so a ring is cheap to compare. */
export type Point = readonly [number, number];
/** One closed subpath. A territory with islands has several. */
export type Ring = readonly Point[];

/** Curve flattening resolution. 12 chords per cubic keeps a 1024-wide coastline under ~1 px of
 *  chord error, which is far below anything the 12–30 vertex budget (§8) can represent anyway. */
const CURVE_STEPS = 12;

/* ------------------------------------------------------------------ tokenising -- */

/** The command letters this parser understands. `A`/`a` is accepted and linearised (see below). */
const COMMANDS = "MmLlHhVvCcSsQqTtAaZz";

interface Token {
  readonly cmd: string;
  readonly args: readonly number[];
}

/**
 * Split path data into `{ cmd, args }`. SVG allows commas, whitespace, implicit
 * repeats (`L 1,2 3,4`) and sign-as-separator (`1-2`), all of which show up in
 * the upstream map SVGs, so the number scanner is hand-rolled rather than a
 * `split`.
 */
export function tokenisePath(d: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let cmd = "";
  let args: number[] = [];

  const flush = (): void => {
    if (cmd !== "") out.push({ cmd, args });
    args = [];
  };

  while (i < d.length) {
    const c = d[i] as string;
    if (COMMANDS.includes(c)) {
      flush();
      cmd = c;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ",") {
      i++;
      continue;
    }
    // A number: optional sign, digits, optional fraction, optional exponent.
    const start = i;
    if (c === "+" || c === "-") i++;
    while (i < d.length && d[i] !== undefined && /[0-9]/.test(d[i] as string)) i++;
    if (d[i] === ".") {
      i++;
      while (i < d.length && d[i] !== undefined && /[0-9]/.test(d[i] as string)) i++;
    }
    if (d[i] === "e" || d[i] === "E") {
      i++;
      if (d[i] === "+" || d[i] === "-") i++;
      while (i < d.length && d[i] !== undefined && /[0-9]/.test(d[i] as string)) i++;
    }
    if (i === start) {
      // An unparseable byte. Skip it rather than loop forever; the validator's
      // vertex count will reject a `d` that was mangled badly enough to matter.
      i++;
      continue;
    }
    args.push(Number.parseFloat(d.slice(start, i)));
  }
  flush();
  return out;
}

/** How many arguments one repeat of each command consumes. */
const ARITY: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

/* ------------------------------------------------------------------ flattening -- */

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1],
  ];
}

/**
 * Flatten `d` into closed rings of points, curves subdivided.
 *
 * Elliptical arcs are reduced to their chord: no map in the catalogue uses one,
 * and silently mis-drawing an arc would be worse than a visibly straight edge
 * the validator can see.
 */
export function parseRings(d: string): Ring[] {
  const rings: Point[][] = [];
  let ring: Point[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  // Reflection point for S/T, in absolute coordinates.
  let rcx = 0;
  let rcy = 0;
  let prev = "";

  const push = (x: number, y: number): void => {
    const last = ring[ring.length - 1];
    if (last === undefined || last[0] !== x || last[1] !== y) ring.push([x, y]);
  };
  const close = (): void => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };

  for (const token of tokenisePath(d)) {
    const upper = token.cmd.toUpperCase();
    const rel = token.cmd !== upper;
    const arity = ARITY[upper] ?? 0;

    if (upper === "Z") {
      close();
      cx = sx;
      cy = sy;
      prev = upper;
      continue;
    }
    if (arity === 0) continue;

    // Implicit repeats: `C a b c d e f g h i j k l` is two cubics. A repeated
    // `M` is an implicit `L` (SVG 1.1 §8.3.2).
    let k = 0;
    let first = true;
    while (k + arity <= token.args.length) {
      const a = token.args.slice(k, k + arity) as number[];
      k += arity;
      const effective = upper === "M" && !first ? "L" : upper;

      if (effective === "M") {
        close();
        cx = rel ? cx + (a[0] as number) : (a[0] as number);
        cy = rel ? cy + (a[1] as number) : (a[1] as number);
        sx = cx;
        sy = cy;
        push(cx, cy);
      } else if (effective === "L") {
        cx = rel ? cx + (a[0] as number) : (a[0] as number);
        cy = rel ? cy + (a[1] as number) : (a[1] as number);
        push(cx, cy);
      } else if (effective === "H") {
        cx = rel ? cx + (a[0] as number) : (a[0] as number);
        push(cx, cy);
      } else if (effective === "V") {
        cy = rel ? cy + (a[0] as number) : (a[0] as number);
        push(cx, cy);
      } else if (effective === "C" || effective === "S" || effective === "Q" || effective === "T") {
        let c1x: number;
        let c1y: number;
        let c2x: number;
        let c2y: number;
        let ex: number;
        let ey: number;
        if (effective === "C") {
          c1x = rel ? cx + (a[0] as number) : (a[0] as number);
          c1y = rel ? cy + (a[1] as number) : (a[1] as number);
          c2x = rel ? cx + (a[2] as number) : (a[2] as number);
          c2y = rel ? cy + (a[3] as number) : (a[3] as number);
          ex = rel ? cx + (a[4] as number) : (a[4] as number);
          ey = rel ? cy + (a[5] as number) : (a[5] as number);
        } else if (effective === "S") {
          const smooth = prev === "C" || prev === "S";
          c1x = smooth ? 2 * cx - rcx : cx;
          c1y = smooth ? 2 * cy - rcy : cy;
          c2x = rel ? cx + (a[0] as number) : (a[0] as number);
          c2y = rel ? cy + (a[1] as number) : (a[1] as number);
          ex = rel ? cx + (a[2] as number) : (a[2] as number);
          ey = rel ? cy + (a[3] as number) : (a[3] as number);
        } else if (effective === "Q") {
          const qx = rel ? cx + (a[0] as number) : (a[0] as number);
          const qy = rel ? cy + (a[1] as number) : (a[1] as number);
          ex = rel ? cx + (a[2] as number) : (a[2] as number);
          ey = rel ? cy + (a[3] as number) : (a[3] as number);
          // Quadratic raised to a cubic, so one flattener serves both.
          c1x = cx + (2 / 3) * (qx - cx);
          c1y = cy + (2 / 3) * (qy - cy);
          c2x = ex + (2 / 3) * (qx - ex);
          c2y = ey + (2 / 3) * (qy - ey);
          rcx = qx;
          rcy = qy;
        } else {
          const smooth = prev === "Q" || prev === "T";
          const qx = smooth ? 2 * cx - rcx : cx;
          const qy = smooth ? 2 * cy - rcy : cy;
          ex = rel ? cx + (a[0] as number) : (a[0] as number);
          ey = rel ? cy + (a[1] as number) : (a[1] as number);
          c1x = cx + (2 / 3) * (qx - cx);
          c1y = cy + (2 / 3) * (qy - cy);
          c2x = ex + (2 / 3) * (qx - ex);
          c2y = ey + (2 / 3) * (qy - ey);
          rcx = qx;
          rcy = qy;
        }
        const p0: Point = [cx, cy];
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const p = cubicAt(p0, [c1x, c1y], [c2x, c2y], [ex, ey], s / CURVE_STEPS);
          push(p[0], p[1]);
        }
        if (effective === "C" || effective === "S") {
          rcx = c2x;
          rcy = c2y;
        }
        cx = ex;
        cy = ey;
      } else if (effective === "A") {
        cx = rel ? cx + (a[5] as number) : (a[5] as number);
        cy = rel ? cy + (a[6] as number) : (a[6] as number);
        push(cx, cy);
      }
      prev = effective;
      first = false;
    }
  }
  close();
  return rings;
}

/* ------------------------------------------------------------------ measures -- */

/**
 * The number of authored vertices in `d` — one per command endpoint, not
 * counting a `Z`'s implicit return to the subpath start.
 *
 * This is the number §8's "12–30 vertices" budget and T7's gate are about: it
 * counts what the file spends, so it is independent of `CURVE_STEPS`.
 */
export function countVertices(d: string): number {
  let n = 0;
  for (const token of tokenisePath(d)) {
    const upper = token.cmd.toUpperCase();
    const arity = ARITY[upper] ?? 0;
    if (arity === 0) continue;
    n += Math.floor(token.args.length / arity);
  }
  return n;
}

/**
 * Authored vertices per subpath, **degenerate subpaths included**.
 *
 * `parseRings` drops anything below a triangle on the way out, which is right
 * for drawing and useless for a validator: the whole point of a "≥ 3 per ring"
 * gate is to catch the two-vertex offcut `parseRings` would hide. So the count
 * comes off the token stream instead.
 */
export function subpathVertexCounts(d: string): number[] {
  const out: number[] = [];
  let n = 0;
  let open = false;
  for (const token of tokenisePath(d)) {
    const upper = token.cmd.toUpperCase();
    const arity = ARITY[upper] ?? 0;
    if (upper === "Z") {
      if (open) out.push(n);
      n = 0;
      open = false;
      continue;
    }
    if (arity === 0) continue;
    if (upper === "M") {
      if (open) out.push(n);
      n = 0;
      open = true;
    }
    n += Math.floor(token.args.length / arity);
  }
  if (open) out.push(n);
  return out;
}

/** Twice the signed area. Positive for a counter-clockwise ring in y-down screen space. */
export function ringArea2(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Point;
    const b = ring[i] as Point;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/** Unsigned area, so a ring's winding never changes which subpath is "the big one". */
export function ringArea(ring: Ring): number {
  return Math.abs(ringArea2(ring)) / 2;
}

/** The ring enclosing the most area — the mainland, when a territory has islands. */
export function largestRing(rings: readonly Ring[]): Ring | null {
  let best: Ring | null = null;
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

/** Crossing-number test. A point exactly on an edge may read either way. */
export function pointInRing(p: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const t = (p[1] - a[1]) / (b[1] - a[1]);
      if (p[0] < a[0] + t * (b[0] - a[0])) inside = !inside;
    }
  }
  return inside;
}

/** Inside any subpath. Islands are separate landmasses, not holes, on every shipped map. */
export function pointInRings(p: Point, rings: readonly Ring[]): boolean {
  for (const ring of rings) if (pointInRing(p, ring)) return true;
  return false;
}

/** `[minX, minY, maxX, maxY]`, or `null` for empty geometry. */
export function bboxOfRings(rings: readonly Ring[]): readonly [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/* ------------------------------------------------------------------ anchors -- */

/** The label sits this far below the token (SPEC §8: "label ~26 px below token"). */
export const LABEL_OFFSET_Y = 26;

export interface Anchors {
  readonly token: [number, number];
  readonly label: [number, number];
}

/**
 * A pole-of-inaccessibility solver: rings in, interior point out.
 *
 * Injected rather than imported so this module stays dependency-free. The one
 * implementation lives in `anchors.ts` over `polylabel` — the only runtime
 * package the engine may reach for (`ALLOWED_PACKAGES`) — and the build
 * pipeline binds the same solver without importing the engine's module graph,
 * which `node --experimental-strip-types` cannot resolve.
 */
export type PoleSolver = (rings: [number, number][][], precision: number) => readonly [number, number];

/** `polylabel`'s precision, in `viewBox` units. Half a unit is well under a token's radius. */
export const POLE_PRECISION = 0.5;

/**
 * The pole of inaccessibility of the largest subpath, rounded for the JSON.
 *
 * Solved on the **largest** ring: a token on Indonesia belongs on Java, not
 * averaged across the archipelago. Rounding can push a pole that sat a fraction
 * of a unit inside a sliver back out, so the result is re-tested and falls back
 * to the unrounded solve and then to a fan-triangle centroid — `anchorsFor` can
 * never hand back a point outside the land, which is what T7 asserts.
 */
export function poleOfWith(rings: readonly Ring[], solve: PoleSolver): [number, number] {
  const ring = largestRing(rings);
  if (ring === null || ring.length < 3) return [0, 0];
  const outer: [number, number][] = ring.map((p) => [p[0], p[1]]);
  const [x, y] = solve([outer], POLE_PRECISION);
  const pole: Point = [round1(x), round1(y)];
  if (pointInRing(pole, ring)) return [pole[0], pole[1]];
  if (pointInRing([x, y], ring)) return [x, y];
  return interiorFallback(ring);
}

/** Token plus the label offset below it. */
export function anchorsFromPole(pole: readonly [number, number]): Anchors {
  return { token: [pole[0], pole[1]], label: [pole[0], pole[1] + LABEL_OFFSET_Y] };
}

function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Any interior point at all. Used only for geometry so thin that a half-unit
 * solver cell cannot fit inside it; the centroid of the largest fan triangle is
 * inside any simple polygon.
 */
function interiorFallback(ring: Ring): [number, number] {
  let best: [number, number] = [ring[0]?.[0] ?? 0, ring[0]?.[1] ?? 0];
  let bestArea = -1;
  const a = ring[0] as Point;
  for (let i = 1; i + 1 < ring.length; i++) {
    const b = ring[i] as Point;
    const c = ring[i + 1] as Point;
    const area = ringArea([a, b, c]);
    if (area > bestArea) {
      bestArea = area;
      best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    }
  }
  return [round1(best[0]), round1(best[1])];
}

/* ------------------------------------------------------------------ simplify -- */

/**
 * Douglas–Peucker on a **closed** ring: keep the two points furthest apart as
 * the fixed anchors, simplify each half, and rejoin.
 *
 * Applying the open-polyline algorithm to a ring directly would pin an
 * arbitrary start vertex and shave the shape around it; anchoring on the
 * diameter instead is stable under rotation of the vertex list, which is what
 * keeps a rebuild of a map byte-identical.
 */
export function simplifyRing(ring: Ring, tolerance: number, floor = 3): Ring {
  if (ring.length <= Math.max(3, floor) || tolerance <= 0) return ring;

  // Two O(n) passes rather than an O(n²) exact diameter: the vertex furthest
  // from the centroid, then the vertex furthest from that one. Coastlines run to
  // thousands of points and this runs inside a bisection loop.
  let ai = farthestFrom(ring, centroidOf(ring));
  let bi = farthestFrom(ring, ring[ai] as Point);
  if (ai > bi) {
    const swap = ai;
    ai = bi;
    bi = swap;
  }
  if (bi - ai < 1) return ring;

  const firstHalf = ring.slice(ai, bi + 1);
  const secondHalf = [...ring.slice(bi), ...ring.slice(0, ai + 1)];
  const a = simplifyOpen(firstHalf, tolerance);
  const b = simplifyOpen(secondHalf, tolerance);
  // Both halves carry the shared anchors; drop the duplicates on rejoin.
  const out = [...a, ...b.slice(1, b.length - 1)];
  // A tolerance wide enough to flatten both halves leaves two points, which is
  // not a polygon. Falling back to the INPUT here would make the vertex count
  // non-monotone in `tolerance` and break the bisection in `fitRings`, so the
  // floor is the coarsest honest polygon instead: the two anchors plus the
  // vertices standing furthest off the chord between them, one per side.
  return out.length >= floor ? out : coarsestPolygon(ring, ring[ai] as Point, ring[bi] as Point, floor);
}

/**
 * The two anchors plus the vertices standing furthest off the line between
 * them — one apex for a triangle, one apex per side of the chord for a quad.
 *
 * A quad rather than a triangle is the floor the ring policy asks for: a
 * triangle is what a collapsed archipelago looks like, and the whole point of
 * the per-ring budget is that no ring ever has to collapse that far. Keeping an
 * apex on **each** side of the chord also keeps the ring's own two lobes, which
 * is what makes a four-vertex island still read as an island.
 */
function coarsestPolygon(ring: Ring, a: Point, b: Point, floor: number): Ring {
  const side = (p: Point): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  let left: Point | null = null;
  let right: Point | null = null;
  let bestLeft = 0;
  let bestRight = 0;
  for (const p of ring) {
    const d2 = segmentDistance2(p, a, b);
    if (d2 <= 0) continue;
    if (side(p) > 0) {
      if (d2 > bestLeft) {
        bestLeft = d2;
        left = p;
      }
    } else if (d2 > bestRight) {
      bestRight = d2;
      right = p;
    }
  }
  // `a → left → b → right` is a simple quadrilateral: the chord `a–b` separates
  // the two apexes, so the boundary never crosses itself.
  if (floor >= 4 && left !== null && right !== null) return [a, left, b, right];
  const apex = (bestLeft >= bestRight ? left : right) ?? null;
  return apex === null ? ring.slice(0, Math.max(3, Math.min(floor, ring.length))) : [a, apex, b];
}

/** The mean of a ring's vertices. Only ever used to seed a search, never as an anchor. */
export function centroidOf(ring: Ring): Point {
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p[0];
    sy += p[1];
  }
  return ring.length === 0 ? [0, 0] : [sx / ring.length, sy / ring.length];
}

/** The index of the vertex furthest from `from`. Ties go to the lowest index, so it is total. */
function farthestFrom(ring: Ring, from: Point): number {
  let at = 0;
  let best = -1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Point;
    const dx = p[0] - from[0];
    const dy = p[1] - from[1];
    const d2 = dx * dx + dy * dy;
    if (d2 > best) {
      best = d2;
      at = i;
    }
  }
  return at;
}

/** Douglas–Peucker on an open polyline, endpoints fixed. */
export function simplifyOpen(points: Ring, tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;

  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    if (hi - lo < 2) continue;
    const a = points[lo] as Point;
    const b = points[hi] as Point;
    let worst = -1;
    let worstAt = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d2 = segmentDistance2(points[i] as Point, a, b);
      if (d2 > worst) {
        worst = d2;
        worstAt = i;
      }
    }
    if (worst > tol2 && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([lo, worstAt], [worstAt, hi]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i] === 1) out.push(points[i] as Point);
  return out;
}

/** Squared distance from `p` to segment `a`–`b`. */
export function segmentDistance2(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

/**
 * Simplify `rings` until the total vertex count fits `budget`, by bisecting the
 * Douglas–Peucker tolerance.
 *
 * The budget is shared across subpaths because §8's 12–30 is per **territory**,
 * so an archipelago spends its allowance on islands. Rings that fall below a
 * triangle are dropped smallest-first — a 2-vertex island is not drawable, and
 * the alternative is failing the vertex gate on a map that is otherwise fine.
 */
export function fitVertexBudget(rings: readonly Ring[], budget: number, span: number): Ring[] {
  // Biggest-first, so dropping from the tail always drops the least land.
  const ordered = [...rings].sort((a, b) => ringArea(b) - ringArea(a));
  const total = (rs: readonly Ring[]): number => rs.reduce((n, r) => n + r.length, 0);

  let candidate = ordered.filter((r) => r.length >= 3);
  if (total(candidate) <= budget) return candidate;

  // Bisect for the smallest tolerance that fits; `span` (the geometry's extent)
  // sets the upper bound, since simplifying at the full span collapses to a
  // triangle and anything larger cannot help.
  let lo = 0;
  let hi = span;
  let bestFit: Ring[] | null = null;
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    const tried = candidate.map((r) => simplifyRing(r, mid)).filter((r) => r.length >= 3);
    if (tried.length > 0 && total(tried) <= budget) {
      bestFit = tried;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (bestFit !== null) return bestFit;

  // Still over budget: the geometry is more islands than the budget has
  // vertices. Keep the largest rings that fit, simplified hard.
  candidate = candidate.map((r) => simplifyRing(r, span / 2)).filter((r) => r.length >= 3);
  const out: Ring[] = [];
  let spent = 0;
  for (const ring of candidate) {
    if (spent + ring.length > budget) continue;
    out.push(ring);
    spent += ring.length;
  }
  return out.length > 0 ? out : [(candidate[0] ?? rings[0] ?? []).slice(0, 3)];
}

/* ------------------------------------------------------------------ ring policy -- */

/**
 * The per-**ring** vertex policy (SPEC §8).
 *
 * The budget that preceded this one was per *territory*, and shared: one
 * Douglas–Peucker tolerance was cranked up until the **sum** over every subpath
 * fitted. On a territory with one ring that is exactly right. On a territory
 * with twenty — a dissolved country group, Alaska with its Aleutians, Michigan
 * with its Upper Peninsula — it drives the tolerance so high that *every* ring
 * bottoms out at its coarsest fallback, and the board renders as triangle soup.
 * The fix is to budget each ring separately and to decide *which* rings are
 * worth drawing before simplifying any of them.
 */
export interface RingPolicy {
  /** Vertices the largest ring may spend. */
  readonly primaryMax: number;
  /** What the largest ring should keep if the source has at least this many. */
  readonly primaryMin: number;
  /** Vertices each secondary ring may spend. */
  readonly secondaryMax: number;
  /** The floor the simplifier may never go below — an island is a quad, not a triangle. */
  readonly secondaryMin: number;
  /** A secondary ring is worth drawing at this fraction of the largest ring's area. */
  readonly secondaryShare: number;
  /** How many secondary rings a territory may keep. */
  readonly maxSecondary: number;
  /** …and how many in total when no ring dominates, i.e. the territory is only islands. */
  readonly maxArchipelago: number;
  /** A ring holding this share of the territory's area counts as its mainland. */
  readonly mainlandShare: number;
  /** The ceiling on the sum, which is what the validator gates on. */
  readonly totalMax: number;
}

export const RING_POLICY: RingPolicy = {
  primaryMax: 60,
  primaryMin: 12,
  secondaryMax: 12,
  secondaryMin: 4,
  secondaryShare: 0.02,
  maxSecondary: 5,
  maxArchipelago: 3,
  mainlandShare: 0.5,
  totalMax: 120,
};

/**
 * Which of a territory's rings are worth drawing, largest first.
 *
 * Largest ring always; then any ring holding at least `secondaryShare` of the
 * largest — the islands that actually read at board scale — up to
 * `maxSecondary`. `minArea` additionally drops anything below an absolute floor,
 * which is how a clip's ocean slivers leave the board. A territory where no ring
 * holds `mainlandShare` of the area is an archipelago rather than a mainland
 * with islands, and keeps only its largest `maxArchipelago`.
 */
export function selectRings(
  rings: readonly Ring[],
  minArea = 0,
  policy: RingPolicy = RING_POLICY,
): Ring[] {
  const ordered = [...rings].filter((r) => r.length >= 3).sort((a, b) => ringArea(b) - ringArea(a));
  const primary = ordered[0];
  if (primary === undefined) return [];

  const primaryArea = ringArea(primary);
  const totalArea = ordered.reduce((n, r) => n + ringArea(r), 0);
  const floor = Math.max(primaryArea * policy.secondaryShare, minArea);
  const secondary = ordered.slice(1).filter((r) => ringArea(r) >= floor);

  const archipelago = totalArea > 0 && primaryArea < totalArea * policy.mainlandShare;
  const keep = archipelago ? policy.maxArchipelago - 1 : policy.maxSecondary;
  return [primary, ...secondary.slice(0, Math.max(0, keep))];
}

/**
 * Simplify one ring down to at most `max` vertices, never below `floor`.
 *
 * Bisects for the **smallest** tolerance that fits, so the ring spends as much
 * of its allowance as the shape can use: the coarsest tolerance that happens to
 * fit would throw away detail the budget had room for.
 */
export function simplifyToCount(ring: Ring, max: number, span: number, floor: number): Ring {
  if (ring.length <= max) return ring;
  let lo = 0;
  let hi = Math.max(span, 1e-6);
  let best: Ring = simplifyRing(ring, hi, floor);
  for (let step = 0; step < 28; step++) {
    const mid = (lo + hi) / 2;
    const tried = simplifyRing(ring, mid, floor);
    if (tried.length <= max) {
      best = tried;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best.length >= 3 ? best : ring.slice(0, 3);
}

/**
 * Apply the ring policy and the per-ring budget to one territory's geometry.
 *
 * The largest ring gets `primaryMax`, each secondary `secondaryMax`, and the
 * sum is trimmed to `totalMax` by dropping the smallest secondaries — so the
 * validator's per-territory ceiling holds by construction rather than by
 * flattening the coastline until it does.
 */
export function fitRings(
  rings: readonly Ring[],
  span: number,
  minArea = 0,
  policy: RingPolicy = RING_POLICY,
): Ring[] {
  const chosen = selectRings(rings, minArea, policy);
  if (chosen.length === 0) return [];

  const out: Ring[] = [];
  chosen.forEach((ring, i) => {
    const max = i === 0 ? policy.primaryMax : policy.secondaryMax;
    const fitted = simplifyToCount(ring, max, span, policy.secondaryMin);
    if (fitted.length >= 3) out.push(fitted);
  });
  if (out.length === 0) return [];

  // Trim from the tail — the smallest rings — until the sum fits.
  let spent = out.reduce((n, r) => n + r.length, 0);
  while (out.length > 1 && spent > policy.totalMax) {
    spent -= (out.pop() as Ring).length;
  }
  return out;
}

/** `M x,y L …Z` per ring, coordinates rounded to `places`. The emitted form of every shipped map. */
export function ringsToPath(rings: readonly Ring[], places = 1): string {
  const r = (n: number): string => {
    const f = Number(n.toFixed(places));
    return String(Object.is(f, -0) ? 0 : f);
  };
  const parts: string[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const head = ring[0] as Point;
    let s = `M${r(head[0])} ${r(head[1])}`;
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i] as Point;
      s += `L${r(p[0])} ${r(p[1])}`;
    }
    parts.push(`${s}Z`);
  }
  return parts.join("");
}
