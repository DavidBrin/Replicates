import { LEVEL_IDS, type LevelId } from "./levels";

/**
 * The campaign overworld (SPEC §7, D28): one island in three sections joined
 * by two plank bridges, a winding dirt path with a node per level, and
 * decorative props. Every coordinate is in a 0..1 map space — x across,
 * y down — and the screen (`components/menu/Overworld.tsx`) scales it to a
 * portrait viewBox. Layout is modelled on `crop-overworld.jpg` /
 * `l24-sheet-0.jpg`: grassy islands with a sandy beach fringe on blue water,
 * pines in clusters, a couple of rocks, flowers, and a hut near the start.
 */

export interface Point {
  x: number;
  y: number;
}

export interface OverworldNode extends Point {
  levelId: LevelId;
  /** Index into `OVERWORLD_PATH` of this node's point. */
  pathIndex: number;
  /** Which island section the node sits on, 0 = south (start). */
  section: 0 | 1 | 2;
}

export type PropKind = "pine" | "tree" | "rock" | "flower" | "bush" | "hut" | "boat";

export interface OverworldProp extends Point {
  kind: PropKind;
  /** 0.5..1.5, scales the sprite. */
  scale?: number;
}

/**
 * The dirt path as a polyline. Nodes are members of this list (see
 * `pathIndex`); the points in between bend the path so the avatar walks a
 * winding route rather than a straight line.
 */
export const OVERWORLD_PATH: readonly Point[] = [
  { x: 0.22, y: 0.9 }, // 01
  { x: 0.31, y: 0.91 },
  { x: 0.4, y: 0.87 }, // 02
  { x: 0.5, y: 0.85 },
  { x: 0.6, y: 0.82 }, // 03
  { x: 0.66, y: 0.77 },
  { x: 0.6, y: 0.71 }, // 04
  { x: 0.54, y: 0.68 },
  { x: 0.5, y: 0.63 }, // bridge south end
  { x: 0.5, y: 0.575 }, // bridge north end
  { x: 0.46, y: 0.55 }, // 05
  { x: 0.38, y: 0.53 },
  { x: 0.3, y: 0.5 }, // 06
  { x: 0.27, y: 0.45 },
  { x: 0.34, y: 0.41 }, // 07
  { x: 0.44, y: 0.4 },
  { x: 0.55, y: 0.39 }, // 08
  { x: 0.63, y: 0.36 },
  { x: 0.66, y: 0.31 }, // bridge south end
  { x: 0.66, y: 0.255 }, // bridge north end
  { x: 0.62, y: 0.23 }, // 09
  { x: 0.52, y: 0.21 },
  { x: 0.43, y: 0.19 }, // 10
  { x: 0.34, y: 0.16 },
  { x: 0.3, y: 0.11 }, // 11
  { x: 0.38, y: 0.07 },
  { x: 0.5, y: 0.06 },
  { x: 0.58, y: 0.08 }, // 12
];

const NODE_PATH_INDICES: readonly number[] = [0, 2, 4, 6, 10, 12, 14, 16, 20, 22, 24, 27];
const NODE_SECTIONS: readonly (0 | 1 | 2)[] = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];

export const OVERWORLD_NODES: readonly OverworldNode[] = LEVEL_IDS.map((levelId, i) => {
  const pathIndex = NODE_PATH_INDICES[i]!;
  const p = OVERWORLD_PATH[pathIndex]!;
  return { levelId, x: p.x, y: p.y, pathIndex, section: NODE_SECTIONS[i]! };
});

export function nodeFor(levelId: string): OverworldNode | undefined {
  return OVERWORLD_NODES.find((n) => n.levelId === levelId);
}

/** Island outlines (closed polygons), south → north. */
export const OVERWORLD_ISLANDS: readonly (readonly Point[])[] = [
  // South island — the start, a broad blob.
  [
    { x: 0.1, y: 0.86 },
    { x: 0.14, y: 0.78 },
    { x: 0.24, y: 0.73 },
    { x: 0.34, y: 0.7 },
    { x: 0.44, y: 0.66 },
    { x: 0.56, y: 0.655 },
    { x: 0.66, y: 0.68 },
    { x: 0.76, y: 0.73 },
    { x: 0.8, y: 0.8 },
    { x: 0.76, y: 0.9 },
    { x: 0.66, y: 0.96 },
    { x: 0.5, y: 0.98 },
    { x: 0.3, y: 0.97 },
    { x: 0.16, y: 0.94 },
  ],
  // Middle island — a long diagonal spit.
  [
    { x: 0.16, y: 0.5 },
    { x: 0.2, y: 0.42 },
    { x: 0.3, y: 0.35 },
    { x: 0.44, y: 0.33 },
    { x: 0.58, y: 0.32 },
    { x: 0.72, y: 0.33 },
    { x: 0.78, y: 0.4 },
    { x: 0.72, y: 0.47 },
    { x: 0.62, y: 0.52 },
    { x: 0.56, y: 0.55 },
    { x: 0.5, y: 0.6 },
    { x: 0.4, y: 0.6 },
    { x: 0.28, y: 0.58 },
    { x: 0.18, y: 0.56 },
  ],
  // North island — the summit.
  [
    { x: 0.2, y: 0.14 },
    { x: 0.26, y: 0.06 },
    { x: 0.38, y: 0.02 },
    { x: 0.54, y: 0.015 },
    { x: 0.68, y: 0.04 },
    { x: 0.76, y: 0.1 },
    { x: 0.78, y: 0.18 },
    { x: 0.72, y: 0.245 },
    { x: 0.6, y: 0.265 },
    { x: 0.48, y: 0.27 },
    { x: 0.36, y: 0.25 },
    { x: 0.24, y: 0.22 },
  ],
];

/** Plank bridges between sections: from the south end to the north end. */
export const OVERWORLD_BRIDGES: readonly { from: Point; to: Point }[] = [
  { from: { x: 0.5, y: 0.655 }, to: { x: 0.5, y: 0.6 } },
  { from: { x: 0.66, y: 0.33 }, to: { x: 0.66, y: 0.265 } },
];

export const OVERWORLD_PROPS: readonly OverworldProp[] = [
  // South island
  { kind: "hut", x: 0.14, y: 0.84 },
  { kind: "pine", x: 0.2, y: 0.78, scale: 1.2 },
  { kind: "pine", x: 0.26, y: 0.76 },
  { kind: "pine", x: 0.23, y: 0.82 },
  { kind: "tree", x: 0.72, y: 0.88 },
  { kind: "rock", x: 0.7, y: 0.78 },
  { kind: "rock", x: 0.3, y: 0.95, scale: 0.8 },
  { kind: "flower", x: 0.44, y: 0.93 },
  { kind: "flower", x: 0.56, y: 0.9 },
  { kind: "bush", x: 0.36, y: 0.79 },
  { kind: "pine", x: 0.7, y: 0.71, scale: 0.9 },
  { kind: "boat", x: 0.86, y: 0.86 },
  // Middle island
  { kind: "pine", x: 0.22, y: 0.4 },
  { kind: "pine", x: 0.26, y: 0.37, scale: 1.2 },
  { kind: "pine", x: 0.2, y: 0.46 },
  { kind: "rock", x: 0.7, y: 0.42 },
  { kind: "flower", x: 0.4, y: 0.47 },
  { kind: "bush", x: 0.6, y: 0.45 },
  { kind: "tree", x: 0.46, y: 0.36 },
  { kind: "pine", x: 0.66, y: 0.37, scale: 0.9 },
  { kind: "boat", x: 0.1, y: 0.62 },
  // North island
  { kind: "pine", x: 0.24, y: 0.1 },
  { kind: "pine", x: 0.28, y: 0.06, scale: 1.1 },
  { kind: "pine", x: 0.22, y: 0.16, scale: 0.9 },
  { kind: "pine", x: 0.7, y: 0.12 },
  { kind: "pine", x: 0.74, y: 0.17, scale: 1.2 },
  { kind: "rock", x: 0.46, y: 0.12 },
  { kind: "rock", x: 0.66, y: 0.05, scale: 0.8 },
  { kind: "flower", x: 0.54, y: 0.16 },
  { kind: "bush", x: 0.36, y: 0.22 },
  { kind: "hut", x: 0.66, y: 0.2 },
];

/** Aspect ratio of the map space when drawn: portrait, 2:3. */
export const OVERWORLD_ASPECT = { width: 1000, height: 1500 } as const;
