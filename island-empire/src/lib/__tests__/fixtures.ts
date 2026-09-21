import type { MapDefinition, PlayerSlotDefinition, TileDefinition } from "@/engine/types";
import { PLAYER_COLOURS } from "@/engine/types";

/** A blank tile of `terrain`. */
export function tile(terrain: TileDefinition["terrain"] = "grass", extra: Partial<TileDefinition> = {}): TileDefinition {
  return {
    terrain,
    owner: null,
    building: null,
    unit: null,
    decoration: null,
    road: false,
    ...extra,
  };
}

export function players(count: number): PlayerSlotDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    colour: PLAYER_COLOURS[index]!,
    kind: index === 0 ? ("human" as const) : ("ai" as const),
    startGold: 10,
  }));
}

/**
 * A small playable map: `width`×`height` grass, player 0 owning a 2×2 block
 * with a city top-left, player 1 the same bottom-right.
 */
export function smallMap(overrides: Partial<MapDefinition> = {}): MapDefinition {
  const width = overrides.width ?? 8;
  const height = overrides.height ?? 8;
  const tiles: TileDefinition[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let owner: number | null = null;
      if (x < 2 && y < 2) owner = 0;
      if (x >= width - 2 && y >= height - 2) owner = 1;
      const building = (x === 0 && y === 0) || (x === width - 1 && y === height - 1) ? "city" : null;
      tiles.push(tile("grass", { owner, building }));
    }
  }
  return {
    id: null,
    name: "Test Isle",
    author: "tester",
    width,
    height,
    biome: "grass",
    tiles,
    players: players(2),
    tutorial: [],
    difficulty: null,
    ...overrides,
  };
}

/** The POST body: a map without `id`. */
export function mapInput(overrides: Partial<MapDefinition> = {}): Omit<MapDefinition, "id"> {
  const { id: _id, ...rest } = smallMap(overrides);
  void _id;
  return rest;
}
