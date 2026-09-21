/**
 * Builds a `MapDefinition` from layered ASCII strings — the fixture format the
 * engine tests use and the content slice may reuse for hand-authored levels.
 *
 * Three layers, each an array of equal-width rows (one character per tile):
 *
 * ```
 * terrain:  .  base terrain of the biome (grass / sand / snow)
 *           ~  water        ^  mountain      T  forest (biome skin)
 *           f  grass field  g  grave          =  bridge
 * owners:   0-7 owner seat, . neutral            (optional; default all neutral)
 * objects:  C city  F farm  M mine  $ chest  W woodwall  S stoneTower
 *           1-4 knight of that level  . nothing (optional; default nothing)
 * ```
 *
 * Example — two seats, blue on the left, red on the right:
 *
 * ```ts
 * asciiMap({
 *   terrain: ["~~~~~~", "~....~", "~....~", "~~~~~~"],
 *   owners:  ["......", ".00.1.", ".0011.", "......"],
 *   objects: ["......", ".C..C.", ".1....", "......"],
 * });
 * ```
 *
 * Every seat referenced by a digit gets a `PlayerSlotDefinition` (kind
 * "human" for seat 0, "ai" otherwise, unless `players` overrides it).
 */
import { BASE_TERRAIN, FOREST_TERRAIN } from "../grid";
import {
  PLAYER_COLOURS,
  type Biome,
  type Building,
  type Difficulty,
  type MapDefinition,
  type PlayerSlotDefinition,
  type Terrain,
  type TileDefinition,
  type TutorialStep,
  type UnitLevel,
} from "../types";

export interface AsciiMapSpec {
  terrain: string[];
  owners?: string[];
  objects?: string[];
  biome?: Biome;
  name?: string;
  /** Applies to every seat unless a per-seat entry overrides it. */
  startGold?: number;
  /** Per-seat overrides keyed by seat index. */
  players?: Partial<Record<number, Partial<Pick<PlayerSlotDefinition, "kind" | "startGold"> & { aiDifficulty: Difficulty }>>>;
  /** Force the number of seats (≥ the highest digit + 1). */
  seats?: number;
  /** "x,y" → grave age for `g` tiles that should start aged. */
  graveAges?: Record<string, 0 | 1>;
  tutorial?: TutorialStep[];
  difficulty?: MapDefinition["difficulty"];
  startGoldPerProvince?: boolean;
}

const OBJECT_BUILDINGS: Record<string, Building> = {
  C: "city",
  F: "farm",
  M: "mine",
  $: "chest",
  W: "woodwall",
  S: "stoneTower",
};

export function asciiMap(spec: AsciiMapSpec): MapDefinition {
  const biome = spec.biome ?? "grass";
  const height = spec.terrain.length;
  const width = spec.terrain[0]?.length ?? 0;
  const owners = spec.owners ?? spec.terrain.map(() => ".".repeat(width));
  const objects = spec.objects ?? spec.terrain.map(() => ".".repeat(width));
  for (const layer of [spec.terrain, owners, objects]) {
    if (layer.length !== height || layer.some((row) => row.length !== width)) {
      throw new Error("asciiMap: every layer must have the same dimensions");
    }
  }

  const tiles: TileDefinition[] = [];
  let maxSeat = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tc = (spec.terrain[y] as string)[x] as string;
      const oc = (owners[y] as string)[x] as string;
      const bc = (objects[y] as string)[x] as string;
      const terrain = terrainOf(tc, biome);
      let owner: number | null = null;
      if (oc >= "0" && oc <= "7") {
        owner = Number(oc);
        if (owner > maxSeat) maxSeat = owner;
      } else if (oc !== ".") {
        throw new Error(`asciiMap: bad owner character '${oc}' at (${x},${y})`);
      }
      let building: Building | null = null;
      let unit: { level: UnitLevel } | null = null;
      if (bc in OBJECT_BUILDINGS) building = OBJECT_BUILDINGS[bc] as Building;
      else if (bc >= "1" && bc <= "4") unit = { level: Number(bc) as UnitLevel };
      else if (bc !== ".") throw new Error(`asciiMap: bad object character '${bc}' at (${x},${y})`);
      const tile: TileDefinition = { terrain, owner, building, unit, decoration: null, road: false };
      if (terrain === "grave") tile.graveAge = spec.graveAges?.[`${x},${y}`] ?? 0;
      tiles.push(tile);
    }
  }

  const seatCount = Math.max(spec.seats ?? 0, maxSeat + 1, 2);
  const players: PlayerSlotDefinition[] = [];
  for (let i = 0; i < seatCount; i++) {
    const override = spec.players?.[i];
    players.push({
      index: i,
      colour: PLAYER_COLOURS[i] as PlayerSlotDefinition["colour"],
      kind: override?.kind ?? (i === 0 ? "human" : "ai"),
      startGold: override?.startGold ?? spec.startGold ?? 10,
      ...(override?.aiDifficulty !== undefined ? { aiDifficulty: override.aiDifficulty } : {}),
    });
  }

  return {
    id: null,
    name: spec.name ?? "ascii fixture",
    author: "asciiMap",
    width,
    height,
    biome,
    tiles,
    players,
    tutorial: spec.tutorial ?? [],
    difficulty: spec.difficulty ?? null,
    ...(spec.startGoldPerProvince !== undefined ? { startGoldPerProvince: spec.startGoldPerProvince } : {}),
  };
}

function terrainOf(c: string, biome: Biome): Terrain {
  switch (c) {
    case ".":
      return BASE_TERRAIN[biome];
    case "~":
      return "water";
    case "^":
      return "mountain";
    case "T":
      return FOREST_TERRAIN[biome];
    case "f":
      return "grassField";
    case "g":
      return "grave";
    case "=":
      return "bridge";
    default:
      throw new Error(`asciiMap: bad terrain character '${c}'`);
  }
}

/**
 * The inverse, for debugging and snapshot assertions: renders a map or a
 * runtime tile list back into the three layers.
 */
export function renderAscii(board: {
  width: number;
  height: number;
  tiles: ReadonlyArray<{ terrain: Terrain; owner: number | null; building: Building | null; unit: { level: UnitLevel } | null }>;
}): { terrain: string[]; owners: string[]; objects: string[] } {
  const terrain: string[] = [];
  const owners: string[] = [];
  const objects: string[] = [];
  for (let y = 0; y < board.height; y++) {
    let tr = "";
    let or = "";
    let br = "";
    for (let x = 0; x < board.width; x++) {
      const t = board.tiles[y * board.width + x];
      if (t === undefined) throw new Error("renderAscii: tiles shorter than width*height");
      tr += terrainChar(t.terrain);
      or += t.owner === null ? "." : String(t.owner);
      br += t.unit !== null ? String(t.unit.level) : t.building !== null ? buildingChar(t.building) : ".";
    }
    terrain.push(tr);
    owners.push(or);
    objects.push(br);
  }
  return { terrain, owners, objects };
}

function terrainChar(t: Terrain): string {
  switch (t) {
    case "water":
      return "~";
    case "mountain":
      return "^";
    case "forestPine":
    case "forestPalm":
    case "forestIcePine":
      return "T";
    case "grassField":
      return "f";
    case "grave":
      return "g";
    case "bridge":
      return "=";
    default:
      return ".";
  }
}

function buildingChar(b: Building): string {
  for (const [c, name] of Object.entries(OBJECT_BUILDINGS)) if (name === b) return c;
  return "?";
}
