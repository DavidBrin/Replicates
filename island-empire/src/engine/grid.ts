/**
 * Square-grid helpers (SPEC §1, D1): row-major indices, 4-neighbour
 * adjacency, and the terrain predicates of SPEC §3.1. Nothing here knows about
 * ownership or provinces; it is pure geometry plus the terrain table.
 */
import type { Biome, Building, Terrain, TileCoord } from "./types";

/** The biome's plain, ownable base terrain (SPEC §3.1 row 1). */
export const BASE_TERRAIN: Record<Biome, Terrain> = {
  grass: "grass",
  desert: "sand",
  snow: "snow",
};

/** The biome's forest skin (SPEC §3.1 "Forest (pine/palm/ice-pine by biome)"). */
export const FOREST_TERRAIN: Record<Biome, Terrain> = {
  grass: "forestPine",
  desert: "forestPalm",
  snow: "forestIcePine",
};

/** Grass / sand / snow — the only terrain a farm may be built on. */
export function isBaseTerrain(terrain: Terrain): boolean {
  return terrain === "grass" || terrain === "sand" || terrain === "snow";
}

/** Grass field or grave: ownable, 0 income, cleared by a unit stepping on it. */
export function isFieldOrGrave(terrain: Terrain): boolean {
  return terrain === "grassField" || terrain === "grave";
}

export function isForest(terrain: Terrain): boolean {
  return terrain === "forestPine" || terrain === "forestPalm" || terrain === "forestIcePine";
}

/**
 * Ownable ⇔ a player may own it and a unit may stand on it (SPEC §3.1):
 * base terrain, bridge, grass field, grave. Water, forest and mountain are
 * neither ownable nor passable.
 */
export function isOwnable(terrain: Terrain): boolean {
  return isBaseTerrain(terrain) || terrain === "bridge" || isFieldOrGrave(terrain);
}

/**
 * Buildings a unit cannot stand on or walk through: city, farm, woodwall,
 * stone tower. Mines and chests are enterable (SPEC §3.4, D35): a mine
 * survives capture, so the capturing unit necessarily ends its move on it and
 * units may stand on their own mines; a chest is collected by the unit that
 * enters it (own chest: `collectable` in the move zone; foreign chest: capture).
 */
export function blocksUnit(building: Building | null): boolean {
  return building !== null && building !== "mine" && building !== "chest";
}

export function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

export function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function keyOf(c: TileCoord): string {
  return coordKey(c.x, c.y);
}

export function parseKey(key: string): TileCoord {
  const comma = key.indexOf(",");
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) };
}

/**
 * The up-to-four orthogonal neighbours of a tile index, in the fixed order
 * north, west, east, south. The order is part of the engine's determinism:
 * flood fills, capital placement and tie-breaks all visit in this order.
 */
export function neighbourIndices(width: number, height: number, index: number): number[] {
  const x = index % width;
  const y = (index - x) / width;
  const out: number[] = [];
  if (y > 0) out.push(index - width);
  if (x > 0) out.push(index - 1);
  if (x < width - 1) out.push(index + 1);
  if (y < height - 1) out.push(index + width);
  return out;
}

/** Sort key for "lowest (y, x)" tie-breaks (D8): row-major index. */
export function rowMajor(width: number, c: TileCoord): number {
  return c.y * width + c.x;
}
