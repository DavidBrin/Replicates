import type { Biome, MapDefinition } from "@/engine/types";

/**
 * The campaign's level index (SPEC §4, §5). This file is intentionally tiny:
 * it holds the ids, the metadata the menus need, and a per-id dynamic import
 * map — never a barrel of the levels themselves, so the tiles of level 12
 * never ship with the page that plays level 1.
 *
 * For synchronous access in tests and tooling see `./sync.ts`.
 */

export const LEVEL_IDS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
] as const;

export type LevelId = (typeof LEVEL_IDS)[number];

export interface LevelMeta {
  name: string;
  biome: Biome;
  /** Seats on the map, human included. */
  players: number;
  size: { width: number; height: number };
  /** True for the five scripted levels. */
  tutorial: boolean;
  /** One line shown on the intro screen. */
  hint: string;
}

export const LEVEL_META: Record<LevelId, LevelMeta> = {
  "01": {
    name: "First Steps",
    biome: "grass",
    players: 2,
    size: { width: 8, height: 10 },
    tutorial: true,
    hint: "Claim land to feed your knight, then merge two knights to destroy the enemy city.",
  },
  "02": {
    name: "Two Villages",
    biome: "grass",
    players: 2,
    size: { width: 10, height: 8 },
    tutorial: true,
    hint: "Every tile pays a coin a day. Save up, buy a knight, and take the road east.",
  },
  "03": {
    name: "The Wall",
    biome: "grass",
    players: 2,
    size: { width: 10, height: 12 },
    tutorial: true,
    hint: "A woodwall blocks the road. Build a farm, merge to level 2, and go around.",
  },
  "04": {
    name: "Green Fields",
    biome: "grass",
    players: 2,
    size: { width: 11, height: 12 },
    tutorial: true,
    hint: "Grass fields earn nothing until a knight mows them. Red holds two cities.",
  },
  "05": {
    name: "Across the Bridge",
    biome: "grass",
    players: 3,
    size: { width: 12, height: 14 },
    tutorial: true,
    hint: "Two provinces, two enemies. Take the bridge to join your treasuries.",
  },
  "06": {
    name: "Riverlands",
    biome: "grass",
    players: 3,
    size: { width: 14, height: 14 },
    tutorial: false,
    hint: "Four bridges, four quarters. Whoever holds the crossings holds the island.",
  },
  "07": {
    name: "Mountain Pass",
    biome: "grass",
    players: 2,
    size: { width: 14, height: 16 },
    tutorial: false,
    hint: "Red walled both passes. Grow rich in the south before you force one.",
  },
  "08": {
    name: "Sand Kingdoms",
    biome: "desert",
    players: 3,
    size: { width: 16, height: 16 },
    tutorial: false,
    hint: "Three kingdoms and one mine in the dunes. The mine pays whoever holds it.",
  },
  "09": {
    name: "Frozen Fjord",
    biome: "snow",
    players: 3,
    size: { width: 16, height: 18 },
    tutorial: false,
    hint: "An icy fjord splits the island; two bridges are the only way across.",
  },
  "10": {
    name: "Four Corners",
    biome: "grass",
    players: 4,
    size: { width: 18, height: 18 },
    tutorial: false,
    hint: "Four kingdoms, one lake, one mine. Expand fast but guard your flanks.",
  },
  "11": {
    name: "Gold Rush",
    biome: "grass",
    players: 3,
    size: { width: 20, height: 20 },
    tutorial: false,
    hint: "Mines and chests lie in the mountain pockets. Race for them, then hold them.",
  },
  "12": {
    name: "Empire's End",
    biome: "grass",
    players: 8,
    size: { width: 26, height: 26 },
    tutorial: false,
    hint: "Seven rivals around one great river. Outlast them all.",
  },
};

export function isLevelId(id: string): id is LevelId {
  return (LEVEL_IDS as readonly string[]).includes(id);
}

/**
 * One dynamic import per level so each is its own chunk. A `Record` of
 * thunks rather than a template-literal `import()` because bundlers resolve
 * the former statically and cannot be tricked into a glob of the directory.
 */
const LOADERS: Record<LevelId, () => Promise<{ default: MapDefinition }>> = {
  "01": () => import("./level01"),
  "02": () => import("./level02"),
  "03": () => import("./level03"),
  "04": () => import("./level04"),
  "05": () => import("./level05"),
  "06": () => import("./level06"),
  "07": () => import("./level07"),
  "08": () => import("./level08"),
  "09": () => import("./level09"),
  "10": () => import("./level10"),
  "11": () => import("./level11"),
  "12": () => import("./level12"),
};

/** The level's `MapDefinition`, loaded on demand. Rejects for an unknown id. */
export async function loadLevel(id: string): Promise<MapDefinition> {
  if (!isLevelId(id)) throw new Error(`content: unknown level "${id}"`);
  const mod = await LOADERS[id]();
  return mod.default;
}

/** The id after `id`, or `null` for the last level. */
export function nextLevelId(id: string): LevelId | null {
  const i = (LEVEL_IDS as readonly string[]).indexOf(id);
  if (i < 0 || i + 1 >= LEVEL_IDS.length) return null;
  return LEVEL_IDS[i + 1]!;
}
