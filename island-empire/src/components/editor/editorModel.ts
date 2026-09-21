import type {
  Biome,
  Building,
  Decoration,
  MapDefinition,
  PlayerSlotDefinition,
  Terrain,
  TileDefinition,
  UnitLevel,
} from "@/engine/types";
import { PLAYER_COLOURS } from "@/engine/types";
import { MAP_MAX_SIZE, MAP_MIN_SIZE, MAX_PLAYERS, MIN_PLAYERS } from "@/lib/mapSchema";

import { BIOME_BASE } from "./palette";

/**
 * The editor's pure model: every change to a draft is a function from a
 * `MapDefinition` to a new one. The zustand store (`editorStore.ts`) only
 * adds history and the current tool on top; the reducers here are what the
 * tests exercise.
 */

/* ---------------------------------------------------------------- tools -- */

export type Tool =
  | { kind: "terrain"; terrain: Terrain }
  | { kind: "road" }
  | { kind: "decoration"; decoration: Decoration | null }
  | { kind: "owner"; owner: number | null }
  | { kind: "building"; building: Building }
  | { kind: "unit"; level: UnitLevel }
  | { kind: "eraser" };

export const OWNABLE_TERRAINS: ReadonlySet<Terrain> = new Set<Terrain>([
  "grass",
  "sand",
  "snow",
  "grassField",
  "grave",
  "bridge",
]);

/** Ground that can carry a cosmetic decoration. */
const DECORATABLE: ReadonlySet<Terrain> = new Set<Terrain>(["grass", "sand", "snow"]);

/** Buildings that only make sense with an owner. */
const OWNED_BUILDINGS: ReadonlySet<Building> = new Set<Building>([
  "city",
  "farm",
  "woodwall",
  "stoneTower",
]);

export function isOwnable(terrain: Terrain): boolean {
  return OWNABLE_TERRAINS.has(terrain);
}

/* ---------------------------------------------------------------- build -- */

export function blankTile(terrain: Terrain): TileDefinition {
  const tile: TileDefinition = {
    terrain,
    owner: null,
    building: null,
    unit: null,
    decoration: null,
    road: false,
  };
  if (terrain === "grave") tile.graveAge = 0;
  return tile;
}

export function makePlayers(count: number, startGold = 10): PlayerSlotDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    colour: PLAYER_COLOURS[index]!,
    kind: index === 0 ? "human" : "ai",
    startGold,
  }));
}

export function blankMap(width: number, height: number, biome: Biome, players: number): MapDefinition {
  const base = BIOME_BASE[biome];
  return {
    id: null,
    name: "Untitled Island",
    author: "anonymous",
    width,
    height,
    biome,
    tiles: Array.from({ length: width * height }, () => blankTile(base)),
    players: makePlayers(players),
    tutorial: [],
    difficulty: null,
  };
}

/**
 * The draft a fresh editor opens on: 12×12 grass, two players, each with a
 * 3×3 starting province and a city — so "Save" and "Play" work before the
 * first brush stroke, and a first-time visitor sees what a province is.
 */
export function defaultDraft(): MapDefinition {
  const map = blankMap(12, 12, "grass", 2);
  const claim = (x0: number, y0: number, owner: number) => {
    for (let y = y0; y < y0 + 3; y += 1) {
      for (let x = x0; x < x0 + 3; x += 1) {
        map.tiles[y * map.width + x]!.owner = owner;
      }
    }
    map.tiles[(y0 + 1) * map.width + (x0 + 1)]!.building = "city";
  };
  claim(1, 1, 0);
  claim(8, 8, 1);
  return map;
}

export function indexOf(map: Pick<MapDefinition, "width">, x: number, y: number): number {
  return y * map.width + x;
}

/* ---------------------------------------------------------------- paint -- */

/**
 * Apply `tool` to the tile at `index`. `activeOwner` is the owner brush's
 * current seat, used when a city/unit is dropped on neutral land so the
 * object never appears ownerless. Returns the same map when nothing changed.
 */
export function paintTile(map: MapDefinition, index: number, tool: Tool, activeOwner: number): MapDefinition {
  const current = map.tiles[index];
  if (!current) return map;
  const next = paintOne(current, tool, activeOwner, map.players.length);
  if (next === current) return map;
  const tiles = map.tiles.slice();
  tiles[index] = next;
  return { ...map, tiles };
}

function paintOne(tile: TileDefinition, tool: Tool, activeOwner: number, playerCount: number): TileDefinition {
  const ownerFor = (t: TileDefinition): number =>
    t.owner ?? Math.min(Math.max(0, activeOwner), playerCount - 1);

  switch (tool.kind) {
    case "terrain": {
      if (tile.terrain === tool.terrain) return tile;
      const next: TileDefinition = { ...tile, terrain: tool.terrain };
      delete next.graveAge;
      if (tool.terrain === "grave") next.graveAge = 0;
      if (!isOwnable(tool.terrain)) {
        next.owner = null;
        next.building = null;
        next.unit = null;
      }
      if (!DECORATABLE.has(tool.terrain)) next.decoration = null;
      if (tool.terrain === "water") next.road = false;
      return next;
    }
    case "road": {
      if (tile.terrain === "water") return tile;
      return { ...tile, road: !tile.road };
    }
    case "decoration": {
      if (!DECORATABLE.has(tile.terrain)) return tile;
      if (tile.decoration === tool.decoration) return tile;
      return { ...tile, decoration: tool.decoration };
    }
    case "owner": {
      if (!isOwnable(tile.terrain)) return tile;
      if (tool.owner !== null && tool.owner >= playerCount) return tile;
      if (tile.owner === tool.owner) return tile;
      const next: TileDefinition = { ...tile, owner: tool.owner };
      if (tool.owner === null) {
        next.unit = null;
        if (next.building && OWNED_BUILDINGS.has(next.building)) next.building = null;
      }
      return next;
    }
    case "building": {
      if (!isOwnable(tile.terrain)) return tile;
      if (tile.building === tool.building && tile.unit === null) return tile;
      const next: TileDefinition = { ...tile, building: tool.building, unit: null };
      if (OWNED_BUILDINGS.has(tool.building)) next.owner = ownerFor(tile);
      return next;
    }
    case "unit": {
      if (!isOwnable(tile.terrain)) return tile;
      if (tile.unit?.level === tool.level && tile.building === null) return tile;
      return { ...tile, unit: { level: tool.level }, building: null, owner: ownerFor(tile) };
    }
    case "eraser": {
      if (!tile.building && !tile.unit && !tile.decoration && !tile.road) return tile;
      return { ...tile, building: null, unit: null, decoration: null, road: false };
    }
  }
}

/* --------------------------------------------------------------- resize -- */

export function clampSize(n: number): number {
  return Math.max(MAP_MIN_SIZE, Math.min(MAP_MAX_SIZE, Math.floor(n)));
}

/** Change the dimensions, keeping every tile that still fits (anchored top-left). */
export function resizeMap(map: MapDefinition, width: number, height: number): MapDefinition {
  const w = clampSize(width);
  const h = clampSize(height);
  if (w === map.width && h === map.height) return map;
  const base = BIOME_BASE[map.biome];
  const tiles: TileDefinition[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const existing = x < map.width && y < map.height ? map.tiles[y * map.width + x] : undefined;
      tiles.push(existing ?? blankTile(base));
    }
  }
  const tutorial = map.tutorial.filter(
    (step) => !step.highlightTile || (step.highlightTile.x < w && step.highlightTile.y < h),
  );
  return { ...map, width: w, height: h, tiles, tutorial };
}

/* -------------------------------------------------------------- players -- */

/** 2..8 seats; tiles owned by a removed seat become neutral. */
export function setPlayerCount(map: MapDefinition, count: number): MapDefinition {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(count)));
  if (n === map.players.length) return map;
  const players =
    n < map.players.length
      ? map.players.slice(0, n)
      : [...map.players, ...makePlayers(n).slice(map.players.length)];
  const tiles = map.tiles.map((tile) => {
    if (tile.owner === null || tile.owner < n) return tile;
    const next: TileDefinition = { ...tile, owner: null, unit: null };
    if (next.building && OWNED_BUILDINGS.has(next.building)) next.building = null;
    return next;
  });
  return { ...map, players, tiles };
}

export function setStartGold(map: MapDefinition, index: number, startGold: number): MapDefinition {
  const gold = Math.max(0, Math.min(100_000, Math.floor(startGold) || 0));
  const players = map.players.map((p) => (p.index === index ? { ...p, startGold: gold } : p));
  return { ...map, players };
}

export function setPlayerKind(
  map: MapDefinition,
  index: number,
  kind: PlayerSlotDefinition["kind"],
): MapDefinition {
  return { ...map, players: map.players.map((p) => (p.index === index ? { ...p, kind } : p)) };
}

/* ---------------------------------------------------------------- whole -- */

/** Switch biome; ground tiles of the old base become the new base. */
export function setBiome(map: MapDefinition, biome: Biome): MapDefinition {
  if (biome === map.biome) return map;
  const from = BIOME_BASE[map.biome];
  const to = BIOME_BASE[biome];
  const tiles = map.tiles.map((t) => (t.terrain === from ? { ...t, terrain: to } : t));
  return { ...map, biome, tiles };
}

/** Every tile becomes `terrain`, keeping nothing. */
export function fillMap(map: MapDefinition, terrain: Terrain): MapDefinition {
  return { ...map, tiles: map.tiles.map(() => blankTile(terrain)) };
}

/** Back to bare ground for the biome. */
export function clearMap(map: MapDefinition): MapDefinition {
  return fillMap(map, BIOME_BASE[map.biome]);
}
