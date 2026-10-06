/**
 * `@/engine/map` — the schema, the loader, the anchor solver, the slot helpers
 * and the seeded generator (SPEC §4.14).
 *
 * A barrel over this directory only. It deliberately does **not** re-export
 * anything from `src/content/maps/` — importing a map's geometry has to stay a
 * per-slug dynamic import so the initial bundle never carries thirteen boards
 * (D40, F6). `src/content/maps/index.ts` is that loader, and it is not a barrel.
 */

export {
  loadMap, validateMap, checkMap, parseViewBox,
  MIN_VERTICES, MAX_VERTICES, MIN_RING_VERTICES, BLIZZARD_RANGE, PORTAL_RANGE,
} from "./schema";
export { anchorsFor, poleOf, solvePole, LABEL_OFFSET_Y, type Anchors } from "./anchors";
export {
  blizzardCandidates, portalCandidates, slotsFor, shuffledIndices, boundedU32, type PortalPair,
} from "./slots";
export {
  generateVoronoiMap, normaliseOptions, slugifyId,
  delaunay, voronoiCells, clipToBox, hexSites, unionOutline,
  CONTINENT_COLORS, TERRITORY_RANGE, CONTINENT_RANGE, DEFAULT_SIZE, type VoronoiOptions,
} from "./voronoi";
export { sharedVertexAdjacency, componentsOf, growGroups, bonusFor, slotsForSize } from "./graph";
export {
  parseRings, tokenisePath, countVertices, subpathVertexCounts, ringArea, ringArea2,
  largestRing, pointInRing,
  pointInRings, bboxOfRings, ringsToPath, simplifyRing, simplifyOpen, segmentDistance2,
  fitVertexBudget, fitRings, selectRings, simplifyToCount, RING_POLICY,
  centroidOf, poleOfWith, anchorsFromPole, POLE_PRECISION,
  type RingPolicy,
  type Point, type Ring, type PoleSolver,
} from "./path";
