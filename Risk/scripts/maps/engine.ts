/**
 * The one bridge from the build pipeline into the engine's geometry.
 *
 * ## Why this is not a plain `import`
 *
 * `pnpm run build:maps` runs `node --experimental-strip-types`, and the two
 * toolchains disagree about relative specifiers:
 *
 * - **Node** resolves ES modules by exact path, so it needs
 *   `"../../src/engine/map/path.ts"` and fails on the extensionless form with
 *   `ERR_MODULE_NOT_FOUND`.
 * - **tsc** rejects a `.ts` extension in an import path unless
 *   `allowImportingTsExtensions` is set, and `tsconfig.json` is S0's file.
 *
 * So a static import that satisfies one breaks the other. Rather than keep a
 * second copy of the path parser, the Douglas–Peucker simplifier and the pole
 * solver in `scripts/` — ~300 lines that would drift from the validator the
 * moment either changed — this module imports the engine's `path.ts`
 * dynamically through a specifier held in a `const`. tsc does not resolve a
 * non-literal specifier, so it raises no error; Node resolves it at run time;
 * and the `import type` above it keeps the result fully typed.
 *
 * `path.ts` and `graph.ts` are the two files this can reach: `path.ts` has no
 * imports at all and `graph.ts` has only a **type** import, which type stripping
 * erases — so Node never resolves an extensionless specifier in either. Between
 * them they carry the path parser, the Douglas–Peucker simplifier, the pole
 * solver, the shared-vertex adjacency pass, the group grower and the bonus
 * heuristic: everything this pipeline and the run-time generator both need.
 *
 * `validateMap` stays on the other side of the fence (it imports `./path`,
 * which Node cannot resolve). The authoritative gate is T7 in `pnpm test`,
 * which `build-maps.ts` shells out to after writing — so a bad map still fails
 * the build, through one validator rather than two.
 */

import polylabel from "polylabel";

import type * as GraphModule from "../../src/engine/map/graph";
import type * as PathModule from "../../src/engine/map/path";

const PATH_MODULE = "../../src/engine/map/path.ts";
const GRAPH_MODULE = "../../src/engine/map/graph.ts";

const loaded = (await import(PATH_MODULE)) as typeof PathModule;
const graph = (await import(GRAPH_MODULE)) as typeof GraphModule;

export const { sharedVertexAdjacency, componentsOf, growGroups, bonusFor, slotsForSize } = graph;

export const {
  parseRings, tokenisePath, countVertices, ringArea, ringArea2, largestRing, pointInRing,
  pointInRings, bboxOfRings, ringsToPath, simplifyRing, simplifyOpen, segmentDistance2,
  fitVertexBudget, centroidOf, poleOfWith, anchorsFromPole, LABEL_OFFSET_Y, POLE_PRECISION,
} = loaded;

export type Point = PathModule.Point;
export type Ring = PathModule.Ring;
export type Anchors = PathModule.Anchors;

/** The same `polylabel` binding `src/engine/map/anchors.ts` uses, on this side of the fence. */
export const solvePole: PathModule.PoleSolver = (rings, precision) => polylabel(rings, precision);

/** Token and label anchors for a `d`, identical to the engine's `anchorsFor`. */
export function anchorsFor(d: string): Anchors {
  return anchorsFromPole(poleOfWith(parseRings(d), solvePole));
}

/** Token and label anchors for rings already in hand, skipping a parse round-trip. */
export function anchorsForRings(rings: readonly Ring[]): Anchors {
  return anchorsFromPole(poleOfWith(rings, solvePole));
}
