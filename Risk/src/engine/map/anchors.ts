/**
 * Token and label anchors — the pole of inaccessibility (SPEC §8, §4.14).
 *
 * A centroid lands in the sea for anything crescent-shaped (Norway, Chile,
 * Indonesia), so the troop token goes at the polygon's pole of inaccessibility
 * instead: the interior point furthest from any edge.
 *
 * `polylabel` is the one runtime package the engine may import, and only from
 * this directory (`ALLOWED_PACKAGES` in `entryPoints.ts`, SPEC §4.3) — because
 * the Voronoi generator mints anchors in the browser, so the solver has to
 * ship. This file is nothing but that binding: the geometry lives in `path.ts`,
 * which takes the solver as a parameter so the build pipeline can bind the same
 * one without pulling the engine's module graph into a plain Node process
 * (`node --experimental-strip-types` cannot resolve an extensionless import).
 */

import polylabel from "polylabel";

import {
  anchorsFromPole, parseRings, poleOfWith, type Anchors, type PoleSolver, type Ring,
} from "./path";

export { LABEL_OFFSET_Y, type Anchors } from "./path";

/** `polylabel` behind the engine's solver shape. */
export const solvePole: PoleSolver = (rings, precision) => polylabel(rings, precision);

/** Where this territory's troop token and name go. Guaranteed inside its own polygon. */
export function anchorsFor(d: string): Anchors {
  return anchorsFromPole(poleOf(parseRings(d)));
}

/** The pole of inaccessibility of the largest ring, or `[0, 0]` for empty geometry. */
export function poleOf(rings: readonly Ring[]): [number, number] {
  return poleOfWith(rings, solvePole);
}
