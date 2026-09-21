/**
 * `generateRandomMap` (SPEC §3.9 / D16; genealogy §3 re-derived over 4
 * neighbours): seeded island blobs → road-link blobs → crop to a 1-tile water
 * border → require one landmass ≥ 25 % of the area (else retry with the next
 * derived seed) → mountain / forest / field / pond clusters that keep the land
 * connected → small random-owner blobs → balance passes (split provinces > 5,
 * equalise province counts per seat within 1, guarantee every seat a ≥3-tile
 * province) → lone tiles go neutral → a city and an L1 knight in every
 * province, 10 gold each → mines and chests on neutral land (medium / large).
 * The result always passes `validateMap`.
 */
import { BASE_TERRAIN, FOREST_TERRAIN, isBaseTerrain, isOwnable, neighbourIndices } from "../grid";
import { chance, deriveSeed, nextInt, nextIntRange, pick, shuffle } from "../prng";
import {
  MAP_SIZE_DIMENSIONS,
  PLAYER_COLOURS,
  RULES,
  type Biome,
  type Decoration,
  type GeneratorOptions,
  type MapDefinition,
  type MapSize,
  type PlayerSlotDefinition,
  type Terrain,
  type TileDefinition,
} from "../types";
import { validateMap } from "../validate";

const MAX_ATTEMPTS = 100;
/** Pre-obstacle landmass floor; obstacles remove ~20 %, leaving ≥ 25 % ownable (D16). */
const MIN_LAND_RATIO = 0.34;
const MAX_PROVINCE_SIZE = 5;
const BLOBS: Record<MapSize, number> = { small: 2, medium: 3, large: 4 };
const BLOB_POTENTIAL: Record<MapSize, number> = { small: 7, medium: 9, large: 11 };
const NEUTRAL_SHARE = 0.2;
const MOUNTAIN_SHARE = 0.06;
const FOREST_SHARE = 0.1;
const FIELD_SHARE = 0.05;
const POND_SHARE = 0.03;
const DECORATION_SHARE = 0.06;
const DECORATIONS: readonly Decoration[] = ["rock", "flowerWhite", "flowerPurple", "bush", "tree"];

/** Mutable working board; only the generator sees it. */
interface Board {
  width: number;
  height: number;
  biome: Biome;
  terrain: Terrain[];
  owner: Array<number | null>;
  seed: number;
}

export function generateRandomMap(options: GeneratorOptions, seed: number): MapDefinition {
  const seats = options.seats.length;
  if (seats < 2 || seats > 8) throw new Error("generateRandomMap: 2..8 seats required");
  const dims = MAP_SIZE_DIMENSIONS[options.size];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = tryGenerate(options, dims.width, dims.height, deriveSeed(seed, attempt), attempt === MAX_ATTEMPTS - 1);
    if (map !== null && validateMap(map).valid) return map;
  }
  throw new Error("generateRandomMap: no valid map after retries");
}

function tryGenerate(options: GeneratorOptions, width: number, height: number, seed: number, last: boolean): MapDefinition | null {
  const b: Board = {
    width,
    height,
    biome: options.biome,
    terrain: new Array<Terrain>(width * height).fill("water"),
    owner: new Array<number | null>(width * height).fill(null),
    seed,
  };
  const size = options.size;
  const seats = options.seats.length;

  if (!createLand(b, size, last)) return null;
  scatterObstacles(b);
  // SPEC §11 / D16: at least a quarter of the board must still be ownable
  // AFTER obstacles. The pre-obstacle 34 % floor makes this rare but not
  // impossible (seed 999995, small, grass: 35/144), so a shortfall is one more
  // reason to retry with the next derived seed.
  {
    const ownable = b.terrain.filter((terrain) => isOwnable(terrain)).length;
    if (ownable < 0.25 * width * height) return null;
  }
  addBridges(b);
  assignOwners(b, seats);
  balance(b, seats);
  loneTilesGoNeutral(b);
  const { buildings, units } = placeCitiesAndUnits(b);
  if (size !== "small") placeMinesAndChests(b, buildings);
  const decorations = scatterDecorations(b, buildings, units);

  const tiles: TileDefinition[] = [];
  for (let i = 0; i < width * height; i++) {
    tiles.push({
      terrain: b.terrain[i] as Terrain,
      owner: b.owner[i] as number | null,
      building: buildings.get(i) ?? null,
      unit: units.has(i) ? { level: 1 } : null,
      decoration: decorations.get(i) ?? null,
      road: false,
    });
  }
  const players: PlayerSlotDefinition[] = options.seats.map((seat, i) => ({
    index: i,
    colour: PLAYER_COLOURS[i] as PlayerSlotDefinition["colour"],
    kind: seat.kind,
    startGold: RULES.defaultProvinceGold,
    ...(seat.kind === "ai" ? { aiDifficulty: seat.aiDifficulty ?? "normal" } : {}),
  }));
  return {
    id: null,
    name: `Random ${size} #${seed >>> 0}`,
    author: "generator",
    width,
    height,
    biome: options.biome,
    tiles,
    players,
    tutorial: [],
    difficulty: null,
    startGoldPerProvince: true,
  };
}

/* ------------------------------------------------------------ helpers -- */

function rand(b: Board, maxExclusive: number): number {
  const r = nextInt(b.seed, maxExclusive);
  b.seed = r.seed;
  return r.value;
}

function randRange(b: Board, min: number, maxExclusive: number): number {
  const r = nextIntRange(b.seed, min, maxExclusive);
  b.seed = r.seed;
  return r.value;
}

function roll(b: Board, p: number): boolean {
  const r = chance(b.seed, p);
  b.seed = r.seed;
  return r.value;
}

function pickOne<T>(b: Board, items: readonly T[]): T | undefined {
  const r = pick(b.seed, items);
  b.seed = r.seed;
  return r.value;
}

function shuffled<T>(b: Board, items: readonly T[]): T[] {
  const r = shuffle(b.seed, items);
  b.seed = r.seed;
  return r.value;
}

function nb(b: Board, i: number): number[] {
  return neighbourIndices(b.width, b.height, i);
}

function inner(b: Board, i: number): boolean {
  const x = i % b.width;
  const y = (i - x) / b.width;
  return x >= 1 && y >= 1 && x <= b.width - 2 && y <= b.height - 2;
}

function landIndices(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.terrain.length; i++) if (isOwnable(b.terrain[i] as Terrain)) out.push(i);
  return out;
}

/** Connected components of tiles accepted by `keep`, largest first. */
function components(b: Board, keep: (i: number) => boolean): number[][] {
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (let start = 0; start < b.terrain.length; start++) {
    if (seen.has(start) || !keep(start)) continue;
    const comp: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const i = queue.shift() as number;
      comp.push(i);
      for (const n of nb(b, i)) {
        if (seen.has(n) || !keep(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    comps.push(comp);
  }
  return comps.sort((p, q) => q.length - p.length);
}

function landConnected(b: Board): boolean {
  return components(b, (i) => isOwnable(b.terrain[i] as Terrain)).length === 1;
}

/* ------------------------------------------------------------- land -- */

/** Antiyoy `spawnIsland`: probabilistic BFS with a decaying potential. */
function spawnIsland(b: Board, start: number, potential: number): void {
  const base = BASE_TERRAIN[b.biome];
  const visited = new Set<number>([start]);
  const queue: Array<{ i: number; p: number }> = [{ i: start, p: potential }];
  while (queue.length > 0) {
    const { i, p } = queue.shift() as { i: number; p: number };
    if (!inner(b, i)) continue;
    if (rand(b, potential) > p) continue;
    b.terrain[i] = base;
    if (p <= 0) continue;
    for (const n of nb(b, i)) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push({ i: n, p: p - 1 });
    }
  }
}

function createLand(b: Board, size: MapSize, last: boolean): boolean {
  const centres: number[] = [];
  for (let k = 0; k < BLOBS[size]; k++) {
    const x = randRange(b, 2, b.width - 2);
    const y = randRange(b, 2, b.height - 2);
    const c = y * b.width + x;
    centres.push(c);
    spawnIsland(b, c, BLOB_POTENTIAL[size]);
  }
  // Road links: chains of tiny blobs along the line to the nearest earlier centre.
  for (let k = 1; k < centres.length; k++) {
    const from = centres[k] as number;
    let target = centres[0] as number;
    let bestDist = Infinity;
    for (let j = 0; j < k; j++) {
      const dist = manhattan(b, from, centres[j] as number);
      if (dist < bestDist) {
        bestDist = dist;
        target = centres[j] as number;
      }
    }
    let x = from % b.width;
    let y = (from - x) / b.width;
    const tx = target % b.width;
    const ty = (target - tx) / b.width;
    let step = 0;
    while (x !== tx || y !== ty) {
      if (x !== tx && (y === ty || step % 2 === 0)) x += x < tx ? 1 : -1;
      else y += y < ty ? 1 : -1;
      const i = y * b.width + x;
      if (inner(b, i)) b.terrain[i] = BASE_TERRAIN[b.biome];
      if (step % 2 === 0) spawnIsland(b, i, 2);
      step++;
    }
  }
  // Keep the largest landmass only; fill single-tile holes.
  const comps = components(b, (i) => isOwnable(b.terrain[i] as Terrain));
  const main = comps[0];
  if (main === undefined) return false;
  if (main.length < MIN_LAND_RATIO * b.width * b.height && !last) return false;
  const keep = new Set(main);
  for (let i = 0; i < b.terrain.length; i++) if (isOwnable(b.terrain[i] as Terrain) && !keep.has(i)) b.terrain[i] = "water";
  for (let i = 0; i < b.terrain.length; i++) {
    if (b.terrain[i] !== "water" || !inner(b, i)) continue;
    const ns = nb(b, i);
    if (ns.length === 4 && ns.every((n) => isOwnable(b.terrain[n] as Terrain))) b.terrain[i] = BASE_TERRAIN[b.biome];
  }
  return main.length >= 12;
}

function manhattan(b: Board, i: number, j: number): number {
  const xi = i % b.width;
  const xj = j % b.width;
  return Math.abs(xi - xj) + Math.abs((i - xi) / b.width - (j - xj) / b.width);
}

/* -------------------------------------------------------- obstacles -- */

/** Places a small cluster of `terrain`, reverting it if the land would disconnect. */
function placeCluster(b: Board, terrain: Terrain, maxSize: number): boolean {
  const land = landIndices(b).filter((i) => isBaseTerrain(b.terrain[i] as Terrain));
  const start = pickOne(b, land);
  if (start === undefined) return false;
  const size = randRange(b, 1, maxSize + 1);
  const cluster = [start];
  let cursor = start;
  for (let k = 1; k < size; k++) {
    const options = nb(b, cursor).filter((n) => isBaseTerrain(b.terrain[n] as Terrain) && !cluster.includes(n));
    const nextTile = pickOne(b, options);
    if (nextTile === undefined) break;
    cluster.push(nextTile);
    cursor = nextTile;
  }
  const before = cluster.map((i) => b.terrain[i] as Terrain);
  for (const i of cluster) b.terrain[i] = terrain;
  if (landConnected(b)) return true;
  cluster.forEach((i, k) => {
    b.terrain[i] = before[k] as Terrain;
  });
  return false;
}

function scatterObstacles(b: Board): void {
  const land = landIndices(b).length;
  const budget = (share: number) => Math.round(land * share);
  const tryPlace = (terrain: Terrain, want: number, maxSize: number) => {
    let placed = 0;
    for (let attempt = 0; placed < want && attempt < want * 6; attempt++) {
      const before = landIndices(b).length;
      if (placeCluster(b, terrain, maxSize)) placed += before - landIndices(b).length || 1;
    }
  };
  tryPlace("mountain", budget(MOUNTAIN_SHARE), 3);
  tryPlace(FOREST_TERRAIN[b.biome], budget(FOREST_SHARE), 3);
  tryPlace("water", budget(POND_SHARE), 2);
  // Fields keep the tile ownable, so no connectivity check is needed.
  const fields = shuffled(b, landIndices(b).filter((i) => isBaseTerrain(b.terrain[i] as Terrain))).slice(0, budget(FIELD_SHARE));
  for (const i of fields) b.terrain[i] = "grassField";
}

/** A few 1-tile water channels between land become bridges (cosmetic shortcuts). */
function addBridges(b: Board): void {
  let placed = 0;
  for (let i = 0; i < b.terrain.length && placed < 3; i++) {
    if (b.terrain[i] !== "water" || !inner(b, i)) continue;
    const x = i % b.width;
    const up = b.terrain[i - b.width] as Terrain;
    const down = b.terrain[i + b.width] as Terrain;
    const left = b.terrain[i - 1] as Terrain;
    const right = b.terrain[i + 1] as Terrain;
    const vertical = isBaseTerrain(up) && isBaseTerrain(down) && left === "water" && right === "water";
    const horizontal = isBaseTerrain(left) && isBaseTerrain(right) && up === "water" && down === "water";
    if ((vertical || horizontal) && x > 0 && roll(b, 0.35)) {
      b.terrain[i] = "bridge";
      placed++;
    }
  }
}

/* ----------------------------------------------------------- owners -- */

/** Small random-owner blobs over all ownable land (Antiyoy `spawnManySmallProvinces`). */
function assignOwners(b: Board, seats: number): void {
  const order = shuffled(b, landIndices(b));
  for (const start of order) {
    if (b.owner[start] !== null || b.terrain[start] === "bridge") continue;
    const seat = roll(b, NEUTRAL_SHARE) ? null : rand(b, seats);
    const size = randRange(b, 2, MAX_PROVINCE_SIZE + 1);
    const blob = [start];
    b.owner[start] = seat;
    let cursor = 0;
    while (blob.length < size && cursor < blob.length) {
      for (const n of nb(b, blob[cursor] as number)) {
        if (blob.length >= size) break;
        if (b.owner[n] !== null || !isOwnable(b.terrain[n] as Terrain) || b.terrain[n] === "bridge") continue;
        if (blob.includes(n)) continue;
        b.owner[n] = seat;
        blob.push(n);
      }
      cursor++;
    }
  }
  // Bridges stay neutral (owner null) unless a balance pass claims them.
}

function ownedComponents(b: Board, seat: number): number[][] {
  return components(b, (i) => b.owner[i] === seat);
}

/** Split every province larger than MAX_PROVINCE_SIZE by flipping its least-connected tile. */
function cutLargeProvinces(b: Board, seats: number): void {
  for (let round = 0; round < 300; round++) {
    let changed = false;
    for (let seat = 0; seat < seats; seat++) {
      for (const comp of ownedComponents(b, seat)) {
        if (comp.length <= MAX_PROVINCE_SIZE) continue;
        let weakest = comp[0] as number;
        let fewest = Infinity;
        for (const i of comp) {
          const same = nb(b, i).filter((n) => b.owner[n] === seat).length;
          if (same < fewest) {
            fewest = same;
            weakest = i;
          }
        }
        const choice = rand(b, seats + 1);
        b.owner[weakest] = choice === seats ? null : choice === seat ? (seat + 1) % seats : choice;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function provinceCounts(b: Board, seats: number): number[] {
  const counts: number[] = [];
  for (let seat = 0; seat < seats; seat++) counts.push(ownedComponents(b, seat).filter((c) => c.length >= 2).length);
  return counts;
}

/** Move whole provinces from the richest seat to the poorest until the spread is ≤ 1. */
function equaliseProvinceCounts(b: Board, seats: number): void {
  for (let round = 0; round < 60; round++) {
    const counts = provinceCounts(b, seats);
    let max = 0;
    let min = 0;
    counts.forEach((c, seat) => {
      if (c > (counts[max] as number)) max = seat;
      if (c < (counts[min] as number)) min = seat;
    });
    if ((counts[max] as number) - (counts[min] as number) <= 1) return;
    const comps = ownedComponents(b, max).filter((c) => c.length >= 2);
    const detached = comps.filter((c) => !c.some((i) => nb(b, i).some((n) => b.owner[n] === min)));
    const give = pickOne(b, detached.length > 0 ? detached : comps);
    if (give === undefined) return;
    for (const i of give) b.owner[i] = min;
    cutLargeProvinces(b, seats);
  }
}

/** Every seat needs a province of ≥ 3 tiles (its starting city). */
function guaranteeStartingProvinces(b: Board, seats: number): void {
  for (let round = 0; round < 30; round++) {
    let fixed = true;
    for (let seat = 0; seat < seats; seat++) {
      const comps = ownedComponents(b, seat);
      if (comps.some((c) => c.length >= 3)) continue;
      fixed = false;
      let grown = comps[0] ?? null;
      if (grown === null) {
        const candidates = landIndices(b).filter((i) => b.terrain[i] !== "bridge" && nb(b, i).filter((n) => isOwnable(b.terrain[n] as Terrain)).length >= 2);
        const start = pickOne(b, candidates);
        if (start === undefined) return;
        b.owner[start] = seat;
        grown = [start];
      }
      while (grown.length < 3) {
        const frontier: number[] = [];
        for (const i of grown) for (const n of nb(b, i)) if (isOwnable(b.terrain[n] as Terrain) && b.owner[n] !== seat && !frontier.includes(n)) frontier.push(n);
        const neutral = frontier.filter((n) => b.owner[n] === null);
        const take = pickOne(b, neutral.length > 0 ? neutral : frontier);
        if (take === undefined) break;
        b.owner[take] = seat;
        grown.push(take);
      }
    }
    if (fixed) return;
  }
}

/**
 * The three balance passes interact (growing a seat's starting province can
 * split a neighbour's; a gift can merge and then be re-cut), so they run until
 * a round changes nothing or the fairness criteria hold.
 */
function balance(b: Board, seats: number): void {
  for (let round = 0; round < 8; round++) {
    cutLargeProvinces(b, seats);
    equaliseProvinceCounts(b, seats);
    guaranteeStartingProvinces(b, seats);
    loneTilesGoNeutral(b);
    const counts = provinceCounts(b, seats);
    const fair = Math.max(...counts) - Math.min(...counts) <= 1;
    const seated = counts.every((_, seat) => ownedComponents(b, seat).some((c) => c.length >= 3));
    if (fair && seated) return;
  }
}

function loneTilesGoNeutral(b: Board): void {
  for (let i = 0; i < b.terrain.length; i++) {
    const o = b.owner[i];
    if (o === null) continue;
    if (!nb(b, i).some((n) => b.owner[n] === o)) b.owner[i] = null;
  }
}

/* --------------------------------------------------------- objects -- */

function placeCitiesAndUnits(b: Board): { buildings: Map<number, TileDefinition["building"]>; units: Set<number> } {
  const buildings = new Map<number, TileDefinition["building"]>();
  const units = new Set<number>();
  const seats = new Set<number>();
  for (const o of b.owner) if (o !== null) seats.add(o);
  for (const seat of [...seats].sort((p, q) => p - q)) {
    for (const comp of ownedComponents(b, seat)) {
      if (comp.length < 2) continue;
      const basic = comp.filter((i) => isBaseTerrain(b.terrain[i] as Terrain));
      const pool = basic.length > 0 ? basic : comp;
      let bestScore = -1;
      let candidates: number[] = [];
      for (const i of pool) {
        const score = nb(b, i).filter((n) => b.owner[n] === seat).length;
        if (score > bestScore) {
          bestScore = score;
          candidates = [i];
        } else if (score === bestScore) candidates.push(i);
      }
      const city = pickOne(b, candidates) as number;
      if (b.terrain[city] === "grassField") b.terrain[city] = BASE_TERRAIN[b.biome];
      buildings.set(city, "city");
      const free = comp.filter((i) => i !== city);
      const unitAt = pickOne(b, free);
      if (unitAt !== undefined) units.add(unitAt);
    }
  }
  return { buildings, units };
}

function placeMinesAndChests(b: Board, buildings: Map<number, TileDefinition["building"]>): void {
  const neutral = shuffled(
    b,
    landIndices(b).filter((i) => b.owner[i] === null && isBaseTerrain(b.terrain[i] as Terrain) && !buildings.has(i)),
  );
  const mines = randRange(b, 1, 3);
  const chests = randRange(b, 1, 3);
  let cursor = 0;
  for (let k = 0; k < mines && cursor < neutral.length; k++) buildings.set(neutral[cursor++] as number, "mine");
  for (let k = 0; k < chests && cursor < neutral.length; k++) buildings.set(neutral[cursor++] as number, "chest");
}

function scatterDecorations(b: Board, buildings: Map<number, TileDefinition["building"]>, units: Set<number>): Map<number, Decoration> {
  const out = new Map<number, Decoration>();
  const free = landIndices(b).filter((i) => isBaseTerrain(b.terrain[i] as Terrain) && !buildings.has(i) && !units.has(i));
  const chosen = shuffled(b, free).slice(0, Math.round(free.length * DECORATION_SHARE));
  for (const i of chosen) out.set(i, pickOne(b, DECORATIONS) as Decoration);
  return out;
}
