/**
 * Province detection, capital placement and the capture pipeline of SPEC §3.3
 * (Antiyoy's `FieldManager.splitProvince` / `checkToUniteProvinces` /
 * `joinHexToAdjacentProvince`, genealogy §2.7, re-derived over 4 neighbours).
 *
 * Province ids are derived from the owner and the city tile (`p<owner>-<x>-<y>`)
 * rather than from a counter, so they are deterministic, stable across
 * serialisation and need no bookkeeping in `GameState`. A province keeps its
 * id for as long as its city stands; a merge survivor keeps the largest
 * fragment's city and therefore its id.
 */
import { type Draft, setPlayer, setProvince, setTile, tileAt } from "./draft";
import {
  BASE_TERRAIN,
  coordKey,
  isFieldOrGrave,
  isOwnable,
  neighbourIndices,
  parseKey,
  rowMajor,
  tileIndex,
} from "./grid";
import { pick } from "./prng";
import { RULES, type Province, type RuntimeTile, type TileCoord, type UnitLevel } from "./types";

export function provinceIdFor(owner: number, city: TileCoord): string {
  return `p${owner}-${city.x}-${city.y}`;
}

/** BFS over tiles of `owner` starting at `start`; marks `visited`. */
export function floodSameOwner(
  tiles: readonly RuntimeTile[],
  width: number,
  height: number,
  start: number,
  owner: number,
  visited: Set<number>,
): number[] {
  const out: number[] = [];
  const queue: number[] = [start];
  visited.add(start);
  while (queue.length > 0) {
    const i = queue.shift() as number;
    out.push(i);
    for (const n of neighbourIndices(width, height, i)) {
      if (visited.has(n)) continue;
      if ((tiles[n] as RuntimeTile).owner !== owner) continue;
      visited.add(n);
      queue.push(n);
    }
  }
  return out;
}

/**
 * `placeCapitalInRandomPlace` (SPEC §3.3 step 1): prefer a tile with no
 * building and no unit; else any tile of the fragment. Random via the draft's
 * seed so replays are exact.
 */
export function placeCapital(d: Draft, fragment: readonly number[]): number {
  const free = fragment.filter((i) => {
    const t = tileAt(d, i);
    return t.building === null && t.unit === null && !isFieldOrGrave(t.terrain);
  });
  const pool = free.length > 0 ? free : fragment;
  const r = pick(d.seed, pool);
  d.seed = r.seed;
  return r.value as number;
}

/** Registers a province over `fragment` (size ≥ 2), placing a city if none stands. */
export function registerProvince(d: Draft, owner: number, fragment: readonly number[], gold: number): Province {
  let cityIdx = fragment.find((i) => tileAt(d, i).building === "city");
  if (cityIdx === undefined) {
    cityIdx = placeCapital(d, fragment);
    setTile(d, cityIdx, { building: "city", unit: null, terrain: cityTerrain(d, cityIdx), graveAge: 0 });
  }
  const cityTile = tileAt(d, cityIdx);
  const city = { x: cityTile.x, y: cityTile.y };
  const id = provinceIdFor(owner, city);
  const province: Province = {
    id,
    owner,
    tileKeys: fragment.map((i) => coordKey(tileAt(d, i).x, tileAt(d, i).y)),
    city,
    gold,
  };
  d.provinces[id] = province;
  for (const i of fragment) setTile(d, i, { provinceId: id });
  return province;
}

/** A city placed on a field or grave clears it (a city cannot sit on a field). */
function cityTerrain(d: Draft, index: number): RuntimeTile["terrain"] {
  const t = tileAt(d, index);
  return isFieldOrGrave(t.terrain) ? BASE_TERRAIN[d.biome] : t.terrain;
}

/**
 * Full-map detection for `createInitialState`: every ≥2-tile same-owner
 * component becomes a province; a lone tile keeps `provinceId: null` and loses
 * any farm / wall / tower / city standing on it.
 */
export function detectAllProvinces(d: Draft): void {
  const visited = new Set<number>();
  for (let i = 0; i < d.tiles.length; i++) {
    const t = tileAt(d, i);
    if (t.owner === null || visited.has(i)) continue;
    const fragment = floodSameOwner(d.tiles, d.width, d.height, i, t.owner, visited);
    if (fragment.length >= 2) registerProvince(d, t.owner, fragment, 0);
    else demoteToLone(d, i, null);
  }
}

/** A tile that is no longer part of any province (SPEC §3.3 step 1, size-1 fragment). */
function demoteToLone(d: Draft, index: number, formerProvinceId: string | null): void {
  const t = tileAt(d, index);
  const at = { x: t.x, y: t.y };
  if (t.building === "city") {
    d.events.push({
      type: "cityDestroyed",
      provinceId: formerProvinceId ?? provinceIdFor(t.owner as number, at),
      owner: t.owner as number,
      at,
    });
    setTile(d, index, { building: null, provinceId: null });
  } else if (t.building === "farm" || t.building === "woodwall" || t.building === "stoneTower") {
    d.events.push({ type: "buildingDestroyed", at, building: t.building, owner: t.owner });
    setTile(d, index, { building: null, provinceId: null });
  } else {
    setTile(d, index, { provinceId: null });
  }
}

/**
 * The capture pipeline of SPEC §3.3, applied to tile `index` passing from its
 * current owner to `newOwner` with `unit` landing on it. Emits every event the
 * capture produces and runs the elimination / win check (§3.7, D36).
 *
 * `attackerFrom` is null for an attack-buy (the unit was bought onto the tile).
 */
export function captureTile(
  d: Draft,
  index: number,
  newOwner: number,
  unit: { level: UnitLevel; readyToMove: boolean },
  attackerFrom: TileCoord | null,
): void {
  const t = tileAt(d, index);
  const at = { x: t.x, y: t.y };
  const prevOwner = t.owner;
  const prevProvince = t.provinceId !== null ? (d.provinces[t.provinceId] as Province) : null;
  const wasCity = t.building === "city";

  d.events.push({ type: "captured", at, from: prevOwner, to: newOwner, attackerFrom });

  // Buildings on the captured tile (SPEC §3.4 "Captured buildings", D35).
  let chest = 0;
  let building: RuntimeTile["building"] = null;
  if (t.building === "city") {
    d.events.push({ type: "cityDestroyed", provinceId: (prevProvince as Province).id, owner: prevOwner as number, at });
  } else if (t.building === "farm" || t.building === "woodwall" || t.building === "stoneTower") {
    d.events.push({ type: "buildingDestroyed", at, building: t.building, owner: prevOwner });
  } else if (t.building === "chest") {
    chest = RULES.chest.bonus;
  } else if (t.building === "mine") {
    building = "mine";
  }

  // A field or grave is cleared by the unit landing on it (SPEC §3.1).
  let terrain = t.terrain;
  const cleared = isFieldOrGrave(terrain);
  if (cleared) terrain = BASE_TERRAIN[d.biome];

  setTile(d, index, { owner: newOwner, building, unit, terrain, graveAge: 0, provinceId: null });
  if (cleared) d.events.push({ type: "fieldCleared", at });

  if (prevOwner !== null) splitAfterLoss(d, index, prevOwner, prevProvince, wasCity);
  const joined = joinAfterGain(d, index, newOwner);

  if (chest > 0) {
    const banked = joined !== null ? chest : 0;
    if (joined !== null) setProvince(d, joined, { gold: (d.provinces[joined] as Province).gold + chest });
    d.events.push({ type: "chestCollected", at, amount: banked });
  }

  checkElimination(d);
}

/** SPEC §3.3 steps 1–3: re-flood the loser's land and settle the treasury. */
function splitAfterLoss(
  d: Draft,
  index: number,
  owner: number,
  prevProvince: Province | null,
  wasCity: boolean,
): void {
  if (prevProvince === null) return; // a lone tile was taken: nothing to re-flood
  delete d.provinces[prevProvince.id];
  for (const key of prevProvince.tileKeys) {
    const c = parseKey(key);
    const i = tileIndex(d.width, c.x, c.y);
    if (i !== index) setTile(d, i, { provinceId: null });
  }

  const visited = new Set<number>([index]);
  const fragments: number[][] = [];
  for (const n of neighbourIndices(d.width, d.height, index)) {
    if (visited.has(n) || tileAt(d, n).owner !== owner) continue;
    fragments.push(floodSameOwner(d.tiles, d.width, d.height, n, owner, visited));
  }

  const created: Province[] = [];
  for (const fragment of fragments) {
    if (fragment.length >= 2) created.push(registerProvince(d, owner, fragment, 0));
    else demoteToLone(d, fragment[0] as number, prevProvince.id);
  }

  // Step 3: the captured city's treasury is always lost (D7).
  if (!wasCity && created.length > 0) {
    let largest = created[0] as Province;
    for (const p of created) if (p.tileKeys.length > largest.tileKeys.length) largest = p;
    setProvince(d, largest.id, { gold: prevProvince.gold });
  }
  if (fragments.length >= 2 && created.length > 0) {
    d.events.push({
      type: "provinceSplit",
      parentId: prevProvince.id,
      fragmentIds: created.map((p) => p.id),
    });
  }
}

/** SPEC §3.3 step 4: lone / join / merge for the capturer. Returns the province id or null. */
function joinAfterGain(d: Draft, index: number, owner: number): string | null {
  const touched: string[] = [];
  const lone: number[] = [];
  for (const n of neighbourIndices(d.width, d.height, index)) {
    const t = tileAt(d, n);
    if (t.owner !== owner) continue;
    if (t.provinceId === null) lone.push(n);
    else if (!touched.includes(t.provinceId)) touched.push(t.provinceId);
  }
  const me = tileAt(d, index);
  const myKey = coordKey(me.x, me.y);
  const loneKeys = lone.map((i) => coordKey(tileAt(d, i).x, tileAt(d, i).y));

  if (touched.length === 0 && lone.length === 0) return null;

  if (touched.length === 0) {
    const province = registerProvince(d, owner, [index, ...lone], 0);
    return province.id;
  }

  if (touched.length === 1) {
    const id = touched[0] as string;
    const p = d.provinces[id] as Province;
    setProvince(d, id, { tileKeys: [...p.tileKeys, myKey, ...loneKeys] });
    setTile(d, index, { provinceId: id });
    for (const i of lone) setTile(d, i, { provinceId: id });
    return id;
  }

  // Merge (D8): largest fragment's city survives, ties → lowest (y, x); gold summed.
  const pieces = touched.map((id) => d.provinces[id] as Province);
  let survivor = pieces[0] as Province;
  for (const p of pieces) {
    if (
      p.tileKeys.length > survivor.tileKeys.length ||
      (p.tileKeys.length === survivor.tileKeys.length &&
        rowMajor(d.width, p.city) < rowMajor(d.width, survivor.city))
    ) {
      survivor = p;
    }
  }
  const absorbed = pieces.filter((p) => p !== survivor);
  const tileKeys = [...survivor.tileKeys];
  let gold = survivor.gold;
  for (const p of absorbed) {
    gold += p.gold;
    tileKeys.push(...p.tileKeys);
    setTile(d, tileIndex(d.width, p.city.x, p.city.y), { building: null });
    delete d.provinces[p.id];
  }
  tileKeys.push(myKey, ...loneKeys);
  setProvince(d, survivor.id, { tileKeys, gold });
  for (const key of tileKeys) {
    const c = parseKey(key);
    setTile(d, tileIndex(d.width, c.x, c.y), { provinceId: survivor.id });
  }
  d.events.push({ type: "provinceMerged", survivingId: survivor.id, absorbedIds: absorbed.map((p) => p.id) });
  return survivor.id;
}

/**
 * SPEC §3.7 / D36: a player with no province is eliminated; when one player
 * remains the game ends immediately. Safe to call repeatedly.
 */
export function checkElimination(d: Draft): void {
  if (d.outcome !== null) return;
  const alive = new Set<number>();
  for (const p of Object.values(d.provinces)) alive.add(p.owner);
  for (const player of d.players) {
    if (player.eliminated || alive.has(player.index)) continue;
    setPlayer(d, player.index, { eliminated: true });
    d.events.push({ type: "eliminated", player: player.index });
  }
  const remaining = d.players.filter((p) => !p.eliminated);
  if (remaining.length === 1) {
    const winner = (remaining[0] as { index: number }).index;
    d.outcome = { winner };
    d.events.push({ type: "gameOver", winner });
  }
}

/** True when the tile may be owned at all (SPEC §3.1). */
export function ownableTile(t: RuntimeTile): boolean {
  return isOwnable(t.terrain);
}
