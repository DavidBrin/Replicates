/**
 * `validateMap` (SPEC §4, §6): every structural and rule-level check a
 * `MapDefinition` must pass before it can start a game or be saved. Collects
 * every error and never throws.
 */
import { isFieldOrGrave, isOwnable, neighbourIndices, tileIndex } from "./grid";
import {
  PLAYER_COLOURS,
  type Building,
  type Decoration,
  type MapDefinition,
  type Terrain,
  type TileDefinition,
  type TutorialTriggerId,
} from "./types";

export const MIN_DIMENSION = 6;
export const MAX_DIMENSION = 40;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

const TERRAINS: readonly Terrain[] = [
  "grass",
  "sand",
  "snow",
  "water",
  "bridge",
  "grassField",
  "grave",
  "forestPine",
  "forestPalm",
  "forestIcePine",
  "mountain",
];
const BUILDINGS: readonly Building[] = ["city", "farm", "mine", "chest", "woodwall", "stoneTower"];
const DECORATIONS: readonly Decoration[] = ["rock", "flowerWhite", "flowerPurple", "bush", "tree"];

/** Exhaustive at compile time: adding an id to the union without listing it here is a type error. */
const TRIGGER_TABLE: Record<TutorialTriggerId, true> = {
  levelIntro: true,
  "turnStart:1": true,
  "turnStart:2": true,
  "turnStart:3": true,
  "turnStart:5": true,
  "unitSelected:first": true,
  "unitMoved:first": true,
  "captured:first": true,
  "attackBlocked:defence": true,
  "attackBlocked:wall": true,
  notEnoughGold: true,
  "bought:first": true,
  "bought:woodwall": true,
  "bought:farm": true,
  "merged:first": true,
  "fieldCleared:first": true,
  enemyCityCaptured: true,
  victory: true,
  defeat: true,
};
export const TUTORIAL_TRIGGER_IDS = Object.keys(TRIGGER_TABLE) as TutorialTriggerId[];

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

export function validateMap(map: MapDefinition): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  if (typeof map !== "object" || map === null) return { valid: false, errors: ["map is not an object"] };

  const { width, height } = map;
  const dimsOk =
    isInt(width) && isInt(height) && width >= MIN_DIMENSION && width <= MAX_DIMENSION && height >= MIN_DIMENSION && height <= MAX_DIMENSION;
  if (!dimsOk) err(`width and height must be integers in ${MIN_DIMENSION}..${MAX_DIMENSION}`);
  if (map.biome !== "grass" && map.biome !== "desert" && map.biome !== "snow") err("biome must be grass, desert or snow");
  if (typeof map.name !== "string") err("name must be a string");
  if (typeof map.author !== "string") err("author must be a string");
  if (map.id !== null && typeof map.id !== "string") err("id must be a string or null");

  /* ------------------------------------------------------------ players -- */
  const players = Array.isArray(map.players) ? map.players : [];
  if (!Array.isArray(map.players)) err("players must be an array");
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    err(`players must have ${MIN_PLAYERS}..${MAX_PLAYERS} entries (got ${players.length})`);
  }
  const seenIndex = new Set<number>();
  const seenColour = new Set<string>();
  players.forEach((p, i) => {
    if (!isInt(p.index) || p.index < 0 || p.index > MAX_PLAYERS - 1) err(`players[${i}].index must be 0..7`);
    else if (p.index !== i) err(`players[${i}].index must equal its position (${i})`);
    if (seenIndex.has(p.index)) err(`players[${i}].index ${p.index} is duplicated`);
    seenIndex.add(p.index);
    if (!PLAYER_COLOURS.includes(p.colour)) err(`players[${i}].colour is not a player colour`);
    if (seenColour.has(p.colour)) err(`players[${i}].colour ${p.colour} is duplicated`);
    seenColour.add(p.colour);
    if (p.kind !== "human" && p.kind !== "ai" && p.kind !== "empty") err(`players[${i}].kind is invalid`);
    if (!isInt(p.startGold) || p.startGold < 0) err(`players[${i}].startGold must be a non-negative integer`);
  });
  const validPlayer = (owner: number) => isInt(owner) && owner >= 0 && owner < players.length;

  /* -------------------------------------------------------------- tiles -- */
  const tiles = Array.isArray(map.tiles) ? map.tiles : [];
  if (!Array.isArray(map.tiles)) err("tiles must be an array");
  if (dimsOk && tiles.length !== width * height) err(`tiles length must be width*height (${width * height}), got ${tiles.length}`);
  if (!dimsOk || tiles.length !== width * height) return { valid: false, errors };

  const at = (x: number, y: number) => `tile (${x},${y})`;
  let anyTileError = false;
  tiles.forEach((t: TileDefinition, i) => {
    const x = i % width;
    const y = (i - x) / width;
    if (typeof t !== "object" || t === null) {
      err(`${at(x, y)} is not an object`);
      anyTileError = true;
      return;
    }
    if (!TERRAINS.includes(t.terrain)) {
      err(`${at(x, y)} has unknown terrain ${String(t.terrain)}`);
      anyTileError = true;
      return;
    }
    const ownable = isOwnable(t.terrain);
    if (t.owner !== null && !validPlayer(t.owner)) err(`${at(x, y)} owner ${String(t.owner)} is not a player index`);
    if (t.owner !== null && !ownable) err(`${at(x, y)} is ${t.terrain} and cannot be owned`);
    if (t.building !== null && !BUILDINGS.includes(t.building)) err(`${at(x, y)} has unknown building ${String(t.building)}`);
    if (t.building !== null && !ownable) err(`${at(x, y)} has a building on ${t.terrain}`);
    if (t.building !== null && isFieldOrGrave(t.terrain)) err(`${at(x, y)} has a building on a ${t.terrain}`);
    if (t.building === "city" && t.owner === null) err(`${at(x, y)} has a city on unowned land`);
    if (t.unit !== null) {
      if (typeof t.unit !== "object" || ![1, 2, 3, 4].includes(t.unit.level)) err(`${at(x, y)} unit level must be 1..4`);
      if (!ownable) err(`${at(x, y)} has a unit on ${t.terrain}`);
      if (t.owner === null) err(`${at(x, y)} has a unit on unowned land`);
      if (t.building !== null && t.building !== "mine") err(`${at(x, y)} has both a unit and a ${t.building}`);
    }
    if (t.decoration !== null && !DECORATIONS.includes(t.decoration)) err(`${at(x, y)} has unknown decoration`);
    if (typeof t.road !== "boolean") err(`${at(x, y)} road must be boolean`);
    if (t.graveAge !== undefined) {
      if (t.terrain !== "grave") err(`${at(x, y)} has graveAge but is not a grave`);
      else if (t.graveAge !== 0 && t.graveAge !== 1) err(`${at(x, y)} graveAge must be 0 or 1`);
    }
  });
  if (anyTileError) return { valid: false, errors };

  /* ------------------------------------------------- land connectivity -- */
  const ownableIdx: number[] = [];
  tiles.forEach((t, i) => {
    if (isOwnable(t.terrain)) ownableIdx.push(i);
  });
  if (ownableIdx.length === 0) err("map has no ownable land");
  else {
    const seen = new Set<number>([ownableIdx[0] as number]);
    const queue = [ownableIdx[0] as number];
    while (queue.length > 0) {
      const i = queue.shift() as number;
      for (const n of neighbourIndices(width, height, i)) {
        if (seen.has(n) || !isOwnable((tiles[n] as TileDefinition).terrain)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    if (seen.size !== ownableIdx.length) err(`ownable land is not 4-connected (${ownableIdx.length - seen.size} tiles unreachable)`);
  }

  /* ---------------------------------------------------------- provinces -- */
  const visited = new Set<number>();
  const cityProvinceOf = new Map<number, number>(); // player → count of ≥2 provinces with a city
  for (const start of ownableIdx) {
    const owner = (tiles[start] as TileDefinition).owner;
    if (owner === null || visited.has(start)) continue;
    const comp: number[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const i = queue.shift() as number;
      comp.push(i);
      for (const n of neighbourIndices(width, height, i)) {
        if (visited.has(n) || (tiles[n] as TileDefinition).owner !== owner) continue;
        visited.add(n);
        queue.push(n);
      }
    }
    const cities = comp.filter((i) => (tiles[i] as TileDefinition).building === "city");
    const first = comp[0] as number;
    const label = `province of player ${owner} at (${first % width},${Math.floor(first / width)})`;
    if (comp.length === 1) {
      const b = (tiles[first] as TileDefinition).building;
      if (b === "city" || b === "farm" || b === "woodwall" || b === "stoneTower") err(`lone ${label} carries a ${b}`);
      continue;
    }
    if (cities.length > 1) err(`${label} has ${cities.length} cities`);
    if (cities.length === 1) cityProvinceOf.set(owner, (cityProvinceOf.get(owner) ?? 0) + 1);
  }
  players.forEach((p) => {
    if (!validPlayer(p.index)) return;
    if ((cityProvinceOf.get(p.index) ?? 0) === 0) err(`player ${p.index} has no city on a province of at least 2 tiles`);
  });

  /* ----------------------------------------------------------- tutorial -- */
  const tutorial = Array.isArray(map.tutorial) ? map.tutorial : [];
  if (!Array.isArray(map.tutorial)) err("tutorial must be an array");
  tutorial.forEach((step, i) => {
    if (!TUTORIAL_TRIGGER_IDS.includes(step.triggerId)) err(`tutorial[${i}].triggerId ${String(step.triggerId)} is not a known trigger`);
    if (typeof step.text !== "string" || step.text.length === 0) err(`tutorial[${i}].text must be a non-empty string`);
    if (step.highlightTile !== undefined) {
      const h = step.highlightTile;
      if (!isInt(h.x) || !isInt(h.y) || h.x < 0 || h.y < 0 || h.x >= width || h.y >= height) err(`tutorial[${i}].highlightTile is out of bounds`);
    }
  });

  /* --------------------------------------------------------- difficulty -- */
  if (map.difficulty !== null) {
    if (typeof map.difficulty !== "object") err("difficulty must be an object or null");
    else {
      for (const key of ["easy", "normal", "hard"] as const) {
        const tuning = map.difficulty[key];
        if (typeof tuning !== "object" || tuning === null || typeof tuning.aiStartGoldMultiplier !== "number" || tuning.aiStartGoldMultiplier < 0) {
          err(`difficulty.${key}.aiStartGoldMultiplier must be a non-negative number`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export { tileIndex };
