/**
 * Defence, attack legality, economy and build legality (SPEC §3.2, §3.4, §3.5).
 * Pure reads over a `GameStateCore`; the reducer is the only writer.
 */
import {
  blocksUnit,
  inBounds,
  isBaseTerrain,
  isFieldOrGrave,
  isOwnable,
  neighbourIndices,
  parseKey,
  tileIndex,
} from "./grid";
import {
  RULES,
  type BuyItem,
  type GameStateCore,
  type Province,
  type RuntimeTile,
  type TileCoord,
  type UnitLevel,
} from "./types";

/** Combat strength of whatever stands on a tile: unit level, else building strength, else 0. */
export function strengthOn(t: RuntimeTile): number {
  if (t.unit !== null) return t.unit.level;
  switch (t.building) {
    case "city":
      return RULES.city.strength;
    case "woodwall":
      return RULES.woodwall.strength;
    case "stoneTower":
      return RULES.stoneTower.strength;
    default:
      return 0;
  }
}

/** Units and cities project onto neighbours; walls and towers guard only themselves (D4, D5). */
export function projects(t: RuntimeTile): boolean {
  return t.unit !== null || t.building === "city";
}

/**
 * SPEC §3.2: defence = max over {self, same-province 4-neighbours} of the
 * projected strengths. Adjacent same-owner tiles always share a province, so
 * "same province" reduces to "same non-null owner".
 */
export function defenceNumber(state: GameStateCore, at: TileCoord): number {
  if (!inBounds(state.width, state.height, at.x, at.y)) return 0;
  const index = tileIndex(state.width, at.x, at.y);
  const self = state.tiles[index] as RuntimeTile;
  let best = strengthOn(self);
  if (self.owner === null) return best;
  for (const n of neighbourIndices(state.width, state.height, index)) {
    const t = state.tiles[n] as RuntimeTile;
    if (t.owner !== self.owner || !projects(t)) continue;
    const s = strengthOn(t);
    if (s > best) best = s;
  }
  return best;
}

/** SPEC §3.2: attack succeeds iff strength > defence (strict). */
export function canAttack(state: GameStateCore, level: number, at: TileCoord): boolean {
  return level > defenceNumber(state, at);
}

/** Income of one tile (SPEC §3.2): field/grave 0, farm 5, mine 8, else 1. */
export function tileIncome(t: RuntimeTile): number {
  if (isFieldOrGrave(t.terrain)) return 0;
  if (t.building === "farm") return RULES.farm.income;
  if (t.building === "mine") return RULES.mine.income;
  return RULES.tileIncome;
}

/** Upkeep of one tile (SPEC §3.2): the unit's upkeep plus the stone tower's 1. */
export function tileUpkeep(t: RuntimeTile): number {
  let u = 0;
  if (t.unit !== null) u += RULES.knight.upkeep[t.unit.level];
  if (t.building === "stoneTower") u += RULES.stoneTower.upkeep;
  if (t.building === "woodwall") u += RULES.woodwall.upkeep;
  return u;
}

export function provinceTiles(state: GameStateCore, province: Province): RuntimeTile[] {
  return province.tileKeys.map((key) => {
    const c = parseKey(key);
    return state.tiles[tileIndex(state.width, c.x, c.y)] as RuntimeTile;
  });
}

export function provinceIncome(state: GameStateCore, province: Province): number {
  let sum = 0;
  for (const t of provinceTiles(state, province)) sum += tileIncome(t);
  return sum;
}

export function provinceUpkeep(state: GameStateCore, province: Province): number {
  let sum = 0;
  for (const t of provinceTiles(state, province)) sum += tileUpkeep(t);
  return sum;
}

export function farmsIn(state: GameStateCore, province: Province): number {
  let n = 0;
  for (const t of provinceTiles(state, province)) if (t.building === "farm") n++;
  return n;
}

/** SPEC §3.2: 12 + 2 × farms already in the province. */
export function farmPrice(state: GameStateCore, province: Province): number {
  return RULES.farm.baseCost + RULES.farm.costStep * farmsIn(state, province);
}

export function knightLevelOf(item: BuyItem): UnitLevel | null {
  switch (item) {
    case "knight1":
      return 1;
    case "knight2":
      return 2;
    case "knight3":
      return 3;
    case "knight4":
      return 4;
    default:
      return null;
  }
}

/** Price of a shop card for a given province (farms escalate, SPEC §3.2). */
export function buyCost(state: GameStateCore, province: Province, item: BuyItem): number {
  const level = knightLevelOf(item);
  if (level !== null) return RULES.knight.cost[level];
  if (item === "woodwall") return RULES.woodwall.cost;
  if (item === "stoneTower") return RULES.stoneTower.cost;
  return farmPrice(state, province);
}

/** SPEC §3.4: two units merge iff their levels sum to at most 4. */
export function canMerge(a: number, b: number): boolean {
  return a + b <= RULES.maxUnitLevel;
}

export function provinceAt(state: GameStateCore, at: TileCoord): Province | null {
  if (!inBounds(state.width, state.height, at.x, at.y)) return null;
  const t = state.tiles[tileIndex(state.width, at.x, at.y)] as RuntimeTile;
  if (t.provinceId === null) return null;
  return state.provinces[t.provinceId] ?? null;
}

/** Provinces of `owner`, ordered by city (y, x) so iteration is deterministic. */
export function provincesOf(state: GameStateCore, owner: number): Province[] {
  return Object.values(state.provinces)
    .filter((p) => p.owner === owner)
    .sort((a, b) => a.city.y * state.width + a.city.x - (b.city.y * state.width + b.city.x));
}

/**
 * True when a farm / wall / tower / knight may be placed on this own tile.
 * Buildings need an empty tile of buildable terrain; a knight of any level
 * (D41) needs an empty own tile too — a field or grave counts as empty and is
 * cleared by the placement. Mines and chests are never purchase targets: a
 * chest is collected by stepping onto it (D40), a mine by standing on it.
 */
export function isBuildableOwnTile(t: RuntimeTile, item: BuyItem): boolean {
  if (t.unit !== null || t.provinceId === null || t.building !== null) return false;
  if (item === "farm") return isBaseTerrain(t.terrain);
  if (item === "woodwall" || item === "stoneTower") return isBaseTerrain(t.terrain) || t.terrain === "bridge";
  return isOwnable(t.terrain);
}

/**
 * The provinces of `owner` that touch `index` (a 4-neighbour is one of their tiles).
 * Used by attack-buy to find the treasury paying for the unit (D11).
 */
export function adjacentProvinces(state: GameStateCore, index: number, owner: number): Province[] {
  const ids: string[] = [];
  for (const n of neighbourIndices(state.width, state.height, index)) {
    const t = state.tiles[n] as RuntimeTile;
    if (t.owner === owner && t.provinceId !== null && !ids.includes(t.provinceId)) ids.push(t.provinceId);
  }
  return ids.map((id) => state.provinces[id] as Province);
}

/** Among adjacent provinces, the richest one that can pay `cost`, or null. */
export function payingProvince(state: GameStateCore, index: number, owner: number, cost: number): Province | null {
  let best: Province | null = null;
  for (const p of adjacentProvinces(state, index, owner)) {
    if (p.gold < cost) continue;
    if (best === null || p.gold > best.gold) best = p;
  }
  return best;
}

/**
 * Every tile the active player may legally place `item` on right now
 * (SPEC §3.4 / §3.5): peaceful builds on own empty tiles of a solvent province,
 * attack-buys on capturable tiles adjacent to a province that can pay, and
 * merge-buys onto own units whose level leaves room.
 */
export function legalBuildZone(state: GameStateCore, item: BuyItem): TileCoord[] {
  if (state.outcome !== null) return [];
  const me = state.activePlayerIndex;
  const level = knightLevelOf(item);
  const out: TileCoord[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i] as RuntimeTile;
    if (!isOwnable(t.terrain)) continue;
    if (t.owner === me) {
      if (t.provinceId === null) continue;
      const province = state.provinces[t.provinceId] as Province;
      const cost = buyCost(state, province, item);
      if (province.gold < cost) continue;
      if (level !== null && t.unit !== null) {
        if (canMerge(t.unit.level, level)) out.push({ x: t.x, y: t.y });
        continue;
      }
      if (isBuildableOwnTile(t, item)) out.push({ x: t.x, y: t.y });
      continue;
    }
    if (level === null) continue;
    if (!canAttack(state, level, { x: t.x, y: t.y })) continue;
    if (payingProvince(state, i, me, RULES.knight.cost[level]) !== null) out.push({ x: t.x, y: t.y });
  }
  return out;
}

export { blocksUnit };
