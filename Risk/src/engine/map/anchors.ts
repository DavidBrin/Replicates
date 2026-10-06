/**
 * Token and label anchors — the pole of inaccessibility (SPEC §8, §4.14).
 *
 * A centroid lands in the sea for anything crescent-shaped (Norway, Chile,
 * Indonesia), so the troop token goes at the polygon's pole of inaccessibility
 * instead: the interior point furthest from any edge. `polylabel` is the one
 * runtime package the engine may import, and only from this directory
 * (`ALLOWED_PACKAGES` in `entryPoints.ts`, SPEC §4.3) — because the Voronoi
 * generator mints anchors in the browser, so the solver has to ship.
 */

import polylabel from "polylabel";

import { largestRing, parseRings, pointInRing, ringArea, type Point, type Ring } from "./path";

/** The label sits this far below the token (SPEC §8: "label ~26 px below token"). */
export const LABEL_OFFSET_Y = 26;

export interface Anchors {
  readonly token: [number, number];
  readonly label: [number, number];
}

/** `polylabel`'s precision, in `viewBox` units. Half a pixel is well under a token's radius. */
const PRECISION = 0.5;

/**
 * Where this territory's troop token and name go.
 *
 * Solved on the **largest** subpath: a token on Indonesia belongs on Java, not
 * averaged across the archipelago. The result is guaranteed inside that
 * subpath — `polylabel` returns a cell centre strictly within the polygon — and
 * T7 asserts exactly that with an independent point-in-polygon test.
 */
export function anchorsFor(d: string): Anchors {
  const rings = parseRings(d);
  const token = poleOf(rings);
  return { token, label: [token[0], token[1] + LABEL_OFFSET_Y] };
}

/** The pole of inaccessibility of the largest ring, or `[0, 0]` for empty geometry. */
export function poleOf(rings: readonly Ring[]): [number, number] {
  const ring = largestRing(rings);
  if (ring === null || ring.length < 3) return [0, 0];

  // polylabel wants a mutable `[x, y][]` outer ring; holes are not modelled —
  // every shipped territory is one or more solid landmasses (SPEC §8).
  const outer: [number, number][] = ring.map((p) => [p[0], p[1]]);
  const [x, y] = polylabel([outer], PRECISION);
  const pole: Point = [round1(x), round1(y)];

  // Rounding for the JSON can push a pole that sits a fraction of a unit inside
  // a sliver back out. Fall back to the unrounded solve, then to a vertex
  // average, so `anchorsFor` can never hand back a point outside the land.
  if (pointInRing(pole, ring)) return [pole[0], pole[1]];
  if (pointInRing([x, y], ring)) return [x, y];
  return interiorFallback(ring);
}

function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Any interior point at all. Used only for geometry so thin that a half-unit
 * `polylabel` cell cannot fit inside it; a fan-triangle centroid of the
 * largest-area triangle is inside any simple polygon.
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
