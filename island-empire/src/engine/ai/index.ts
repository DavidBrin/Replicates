/**
 * The AI (SPEC §5 "An AI turn", D17; genealogy §4 re-derived over 4
 * neighbours): a two-phase greedy heuristic.
 *
 *  1. **Move units** — for every ready unit: attack the most attractive
 *     reachable tile (allure = own 4-neighbours; enemy cities first; L3/L4
 *     prefer walls / towers they can beat), else clear a field or grave, else
 *     (Normal) retreat off an exposed border tile / (Hard) push toward the
 *     border without leaving a border tile undefended.
 *  2. **Spend** per province — woodwalls (self-only, so only on threatened
 *     border tiles) where the predicted defence gain clears a threshold, a
 *     stone tower against an adjacent L2+, merges that enable a capture, knights in ascending
 *     level only when they can capture something now and the province stays
 *     solvent `level + 1` turns ahead, then a farm when nothing is left to
 *     attack.
 *
 * Difficulty: Easy — no walls, skips 50 % of its units, random targets, merges
 * only 1+1. Normal — the full heuristic. Hard — plus the border push and the
 * safety check. Every candidate action is validated by running it through
 * `apply`; anything the rules reject is dropped. Deterministic per seed.
 */
import { isBaseTerrain, isOwnable, neighbourIndices, parseKey, rowMajor, tileIndex } from "../grid";
import { computeMoveZone } from "../moveZone";
import { chance, next, normaliseSeed, pick } from "../prng";
import { apply } from "../reducer";
import {
  defenceNumber,
  farmPrice,
  provinceIncome,
  provinceUpkeep,
  provincesOf,
  strengthOn,
} from "../rules";
import {
  RULES,
  type Action,
  type BuyItem,
  type Difficulty,
  type GameState,
  type GameStateCore,
  type Province,
  type RuntimeTile,
  type TileCoord,
  type UnitLevel,
} from "../types";

interface Ctx {
  s: GameState;
  actions: Action[];
  seed: number;
  me: number;
  difficulty: Difficulty;
}

const MAX_WALLS_PER_PROVINCE = 2;
const MAX_MERGES_PER_PROVINCE = 2;
const MAX_BUYS_PER_LEVEL = 4;
const WALL_GAIN_THRESHOLD = 3;
const TOWER_GAIN_THRESHOLD = 4;

export function aiTakeTurn(
  state: GameState,
  playerIndex: number,
  seed: number,
): { actions: Action[]; nextSeed: number } {
  const player = state.players[playerIndex];
  const s0 = normaliseSeed(seed);
  if (state.outcome !== null || state.activePlayerIndex !== playerIndex || player === undefined) {
    return { actions: [{ type: "END_TURN" }], nextSeed: next(s0).seed };
  }
  const ctx: Ctx = {
    s: state,
    actions: [],
    seed: s0,
    me: playerIndex,
    difficulty: player.aiDifficulty ?? "normal",
  };
  moveUnits(ctx);
  if (ctx.s.outcome === null) spendMoney(ctx);
  ctx.actions.push({ type: "END_TURN" });
  return { actions: ctx.actions, nextSeed: next(ctx.seed).seed };
}

/* ------------------------------------------------------------ helpers -- */

function tileOf(s: GameStateCore, c: TileCoord): RuntimeTile {
  return s.tiles[tileIndex(s.width, c.x, c.y)] as RuntimeTile;
}

function commit(ctx: Ctx, action: Action): boolean {
  const r = apply(ctx.s, action);
  if (r.error !== undefined) return false;
  ctx.s = r.state;
  ctx.actions.push(action);
  return true;
}

function roll(ctx: Ctx, p: number): boolean {
  const r = chance(ctx.seed, p);
  ctx.seed = r.seed;
  return r.value;
}

function ownNeighbours(s: GameStateCore, c: TileCoord, owner: number): number {
  let n = 0;
  for (const i of neighbourIndices(s.width, s.height, tileIndex(s.width, c.x, c.y))) {
    if ((s.tiles[i] as RuntimeTile).owner === owner) n++;
  }
  return n;
}

/** Foreign ownable neighbours: how exposed a tile is. */
function foreignNeighbours(s: GameStateCore, c: TileCoord, owner: number): number {
  let n = 0;
  for (const i of neighbourIndices(s.width, s.height, tileIndex(s.width, c.x, c.y))) {
    const t = s.tiles[i] as RuntimeTile;
    if (isOwnable(t.terrain) && t.owner !== owner) n++;
  }
  return n;
}

/** Highest enemy unit level standing next to the tile. */
function adjacentEnemyStrength(s: GameStateCore, c: TileCoord, owner: number): number {
  let best = 0;
  for (const i of neighbourIndices(s.width, s.height, tileIndex(s.width, c.x, c.y))) {
    const t = s.tiles[i] as RuntimeTile;
    if (t.owner !== owner && t.owner !== null && t.unit !== null && t.unit.level > best) best = t.unit.level;
  }
  return best;
}

function isEnemyCity(t: RuntimeTile): boolean {
  return t.building === "city" && t.owner !== null;
}

/**
 * `findMostAttractiveHex` (genealogy §4.3.2): enemy cities first, walls and
 * towers for heavy units, then the tile with the most own neighbours
 * (consolidating captures over exposed salients), with small bonuses for
 * chests, mines and enemy farms. Ties break on the lowest (y, x).
 */
function mostAttractive(ctx: Ctx, candidates: readonly TileCoord[], level: number): TileCoord {
  const s = ctx.s;
  let best: TileCoord = candidates[0] as TileCoord;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const t = tileOf(s, c);
    let score = ownNeighbours(s, c, ctx.me) * 10;
    if (isEnemyCity(t)) score += 1000;
    if (level >= 3 && (t.building === "woodwall" || t.building === "stoneTower")) score += 500;
    if (t.building === "chest") score += 30;
    if (t.building === "mine") score += 25;
    if (t.building === "farm") score += 15;
    if (t.unit !== null && t.owner !== null) score += 20 + t.unit.level * 5;
    if (score > bestScore || (score === bestScore && rowMajor(s.width, c) < rowMajor(s.width, best))) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function randomOf<T>(ctx: Ctx, items: readonly T[]): T {
  const r = pick(ctx.seed, items);
  ctx.seed = r.seed;
  return r.value as T;
}

/* ----------------------------------------------------- phase 1: move -- */

function readyUnits(s: GameStateCore, me: number): TileCoord[] {
  const out: TileCoord[] = [];
  for (const t of s.tiles) if (t.owner === me && t.unit !== null && t.unit.readyToMove) out.push({ x: t.x, y: t.y });
  return out;
}

function moveUnits(ctx: Ctx): void {
  for (const pos of readyUnits(ctx.s, ctx.me)) {
    if (ctx.s.outcome !== null) return;
    const t = tileOf(ctx.s, pos);
    if (t.owner !== ctx.me || t.unit === null || !t.unit.readyToMove) continue;
    if (ctx.difficulty === "easy" && roll(ctx, 0.5)) continue;
    decideAboutUnit(ctx, pos, t.unit.level);
  }
}

/**
 * Hard's safety check (genealogy §4.3.1 adapted): count the own border
 * neighbours whose only projected defence is this unit; leaving is unsafe
 * when two or more would be stripped to defence 0.
 */
function leavesBorderUndefended(s: GameStateCore, pos: TileCoord, me: number): boolean {
  const idx = tileIndex(s.width, pos.x, pos.y);
  let stripped = 0;
  for (const n of neighbourIndices(s.width, s.height, idx)) {
    const t = s.tiles[n] as RuntimeTile;
    if (t.owner !== me || foreignNeighbours(s, { x: t.x, y: t.y }, me) === 0) continue;
    const others = neighbourIndices(s.width, s.height, n).some((m) => {
      const o = s.tiles[m] as RuntimeTile;
      return m !== idx && o.owner === me && (o.unit !== null || o.building === "city");
    });
    if (!others && strengthOn(t) === 0) stripped++;
  }
  return stripped >= 2;
}

function decideAboutUnit(ctx: Ctx, pos: TileCoord, level: number): void {
  const s = ctx.s;
  const zone = computeMoveZone(s, pos);
  if (zone.capturable.length > 0) {
    const target = ctx.difficulty === "easy" ? randomOf(ctx, zone.capturable) : mostAttractive(ctx, zone.capturable, level);
    const cityTarget = isEnemyCity(tileOf(s, target));
    if (ctx.difficulty === "hard" && !cityTarget && leavesBorderUndefended(s, pos, ctx.me)) return;
    commit(ctx, { type: "MOVE", unitAt: pos, to: target });
    return;
  }
  if (zone.clearable.length > 0) {
    commit(ctx, { type: "MOVE", unitAt: pos, to: zone.clearable[0] as TileCoord });
    return;
  }
  const onBorder = foreignNeighbours(s, pos, ctx.me) > 0;
  if (ctx.difficulty === "hard") {
    if (onBorder) return; // never leave a border tile undefended
    let best: TileCoord | null = null;
    let bestExposure = 0;
    for (const c of zone.reachable) {
      const e = foreignNeighbours(s, c, ctx.me);
      if (e > bestExposure) {
        best = c;
        bestExposure = e;
      }
    }
    if (best !== null) commit(ctx, { type: "MOVE", unitAt: pos, to: best });
    return;
  }
  if (ctx.difficulty === "normal" && onBorder) {
    const inner = zone.reachable.find((c) => foreignNeighbours(s, c, ctx.me) === 0);
    if (inner !== undefined) commit(ctx, { type: "MOVE", unitAt: pos, to: inner });
  }
}

/* ---------------------------------------------------- phase 2: spend -- */

function spendMoney(ctx: Ctx): void {
  for (const province of provincesOf(ctx.s, ctx.me)) {
    if (ctx.s.outcome !== null) return;
    let id: string | null = province.id;
    if (ctx.difficulty !== "easy") id = buildWalls(ctx, id);
    if (id !== null) id = mergeUnits(ctx, id);
    if (id !== null) id = buyKnights(ctx, id);
    if (id !== null) buyFarm(ctx, id);
  }
}

function provinceById(s: GameStateCore, id: string): Province | null {
  return s.provinces[id] ?? null;
}

/** Tiles of a province as coordinates. */
function coordsOf(p: Province): TileCoord[] {
  return p.tileKeys.map(parseKey);
}

/** Foreign ownable tiles touching the province. */
function adjacentTargets(s: GameStateCore, p: Province): TileCoord[] {
  const seen = new Set<number>();
  const out: TileCoord[] = [];
  for (const c of coordsOf(p)) {
    for (const n of neighbourIndices(s.width, s.height, tileIndex(s.width, c.x, c.y))) {
      const t = s.tiles[n] as RuntimeTile;
      if (seen.has(n) || !isOwnable(t.terrain) || t.owner === p.owner) continue;
      seen.add(n);
      out.push({ x: t.x, y: t.y });
    }
  }
  return out;
}

/**
 * Applies a purchase (or merge move) only if the province holding `at`
 * afterwards can pay its way for `turns` turns: `gold + turns·(income −
 * upkeep) ≥ 0` (Antiyoy `canAiAffordUnit`). This is what keeps a Normal AI
 * from ever ending its turn on the road to bankruptcy.
 */
function commitIfSolvent(ctx: Ctx, action: Action, at: TileCoord, turns: number): string | null {
  const r = apply(ctx.s, action);
  if (r.error !== undefined) return null;
  const t = tileOf(r.state, at);
  if (t.provinceId === null) return null;
  const p = r.state.provinces[t.provinceId] as Province;
  const net = provinceIncome(r.state, p) - provinceUpkeep(r.state, p);
  if (p.gold + turns * net < 0) return null;
  if (p.gold + net < 0) return null;
  ctx.s = r.state;
  ctx.actions.push(action);
  return p.id;
}

function buildWalls(ctx: Ctx, id: string): string | null {
  for (let built = 0; built < MAX_WALLS_PER_PROVINCE; built++) {
    const p = provinceById(ctx.s, id);
    if (p === null) return null;
    if (p.gold < RULES.woodwall.cost) return id;
    const s = ctx.s;
    let best: TileCoord | null = null;
    let bestGain = 0;
    let towerTarget: TileCoord | null = null;
    let towerGain = 0;
    for (const c of coordsOf(p)) {
      const t = tileOf(s, c);
      if (t.unit !== null || t.building !== null || !(isBaseTerrain(t.terrain) || t.terrain === "bridge")) continue;
      const exposure = foreignNeighbours(s, c, ctx.me);
      if (exposure === 0) continue;
      const defence = defenceNumber(s, c);
      const threat = adjacentEnemyStrength(s, c, ctx.me);
      // A self-only wall is only worth its price where an adjacent enemy unit could take the tile today.
      if (threat <= defence) continue;
      const neighbourWall = neighbourIndices(s.width, s.height, tileIndex(s.width, c.x, c.y)).some((n) => {
        const o = s.tiles[n] as RuntimeTile;
        return o.owner === ctx.me && (o.building === "woodwall" || o.building === "stoneTower");
      });
      const wallGain = Math.max(0, RULES.woodwall.strength - defence) + exposure + (threat > 0 ? 2 : 0) - (neighbourWall ? 1 : 0);
      if (wallGain > bestGain || (wallGain === bestGain && best !== null && rowMajor(s.width, c) < rowMajor(s.width, best))) {
        best = c;
        bestGain = wallGain;
      }
      if (threat >= 2 && defence < RULES.stoneTower.strength) {
        const g = RULES.stoneTower.strength - defence + exposure;
        if (g > towerGain) {
          towerTarget = c;
          towerGain = g;
        }
      }
    }
    if (towerTarget !== null && towerGain >= TOWER_GAIN_THRESHOLD && p.gold >= RULES.stoneTower.cost) {
      const next = commitIfSolvent(ctx, { type: "BUY", item: "stoneTower", at: towerTarget }, towerTarget, 2);
      if (next !== null) {
        id = next;
        continue;
      }
    }
    if (best === null || bestGain < WALL_GAIN_THRESHOLD) return id;
    const next = commitIfSolvent(ctx, { type: "BUY", item: "woodwall", at: best }, best, 1);
    if (next === null) return id;
    id = next;
  }
  return id;
}

/** Merges two ready units when the merged unit can capture something neither could (SPEC §3.4). */
function mergeUnits(ctx: Ctx, id: string): string | null {
  for (let merges = 0; merges < MAX_MERGES_PER_PROVINCE; merges++) {
    const p = provinceById(ctx.s, id);
    if (p === null) return null;
    const s = ctx.s;
    const units = coordsOf(p).filter((c) => {
      const t = tileOf(s, c);
      return t.unit !== null && t.unit.readyToMove;
    });
    let done = false;
    for (const a of units) {
      const la = (tileOf(s, a).unit as { level: number }).level;
      const zone = computeMoveZone(s, a);
      for (const b of zone.mergeable) {
        const ub = tileOf(s, b).unit as { level: number; readyToMove: boolean };
        if (!ub.readyToMove) continue;
        if (ctx.difficulty === "easy" && (la !== 1 || ub.level !== 1)) continue;
        const merged = la + ub.level;
        const floor = Math.max(la, ub.level);
        const trial = apply(s, { type: "MOVE", unitAt: a, to: b });
        if (trial.error !== undefined) continue;
        const targets = computeMoveZone(trial.state, b).capturable.filter((c) => defenceNumber(trial.state, c) >= floor);
        if (targets.length === 0) continue;
        const pid = commitIfSolvent(ctx, { type: "MOVE", unitAt: a, to: b }, b, merged + 1);
        if (pid === null) continue;
        id = pid;
        const target = mostAttractive(ctx, targets, merged);
        commit(ctx, { type: "MOVE", unitAt: b, to: target });
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) return id;
  }
  return id;
}

function knightItem(level: UnitLevel): BuyItem {
  return `knight${level}` as BuyItem;
}

/**
 * `tryToBuildUnits` (genealogy §4.4): ascending levels, each bought straight
 * onto a target it can capture now (attack-buy), while the province stays
 * solvent `level + 1` turns ahead. A province with no unit kick-starts one.
 */
function buyKnights(ctx: Ctx, id: string): string | null {
  for (const level of [1, 2, 3, 4] as UnitLevel[]) {
    for (let bought = 0; bought < MAX_BUYS_PER_LEVEL; bought++) {
      const p = provinceById(ctx.s, id);
      if (p === null) return null;
      if (p.gold < RULES.knight.cost[level]) break;
      const s = ctx.s;
      const targets = adjacentTargets(s, p).filter((c) => {
        const def = defenceNumber(s, c);
        return def === level - 1 || (isEnemyCity(tileOf(s, c)) && def < level);
      });
      if (targets.length === 0) break;
      const target = ctx.difficulty === "easy" ? randomOf(ctx, targets) : mostAttractive(ctx, targets, level);
      const pid = commitIfSolvent(ctx, { type: "BUY", item: knightItem(level), at: target }, target, level + 1);
      if (pid === null) break;
      id = pid;
      // Easy recruits one knight per province per turn (D39): the tutorial
      // levels are meant to be learnable, and an Easy AI that fields a knight
      // for every spare 10 gold out-expands a first-time player.
      if (ctx.difficulty === "easy") return id;
    }
    const p = provinceById(ctx.s, id);
    if (p === null) return null;
    if (p.gold < RULES.knight.cost[Math.min(4, level + 1) as UnitLevel]) break;
  }
  // Kick-start: a province without any unit gets a defender it can afford.
  const p = provinceById(ctx.s, id);
  if (p === null) return null;
  const hasUnit = coordsOf(p).some((c) => tileOf(ctx.s, c).unit !== null);
  if (!hasUnit && p.gold >= RULES.knight.cost[1]) {
    const spot = bestInteriorTile(ctx.s, p, ctx.me);
    if (spot !== null) {
      const pid = commitIfSolvent(ctx, { type: "BUY", item: "knight1", at: spot }, spot, 2);
      if (pid !== null) id = pid;
    }
  }
  return id;
}

/** Empty base-terrain tile with the most own neighbours (fewest exposed sides). */
function bestInteriorTile(s: GameStateCore, p: Province, me: number): TileCoord | null {
  let best: TileCoord | null = null;
  let bestScore = -Infinity;
  for (const c of coordsOf(p)) {
    const t = tileOf(s, c);
    if (t.unit !== null || t.building !== null || !isBaseTerrain(t.terrain)) continue;
    const score = ownNeighbours(s, c, me) * 2 - foreignNeighbours(s, c, me);
    if (score > bestScore || (score === bestScore && best !== null && rowMajor(s.width, c) < rowMajor(s.width, best))) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** A farm when the treasury allows it and no cheap expansion is on offer (SPEC §3.2 farm price). */
function buyFarm(ctx: Ctx, id: string): void {
  const p = provinceById(ctx.s, id);
  if (p === null) return;
  const s = ctx.s;
  const price = farmPrice(s, p);
  if (p.gold < price) return;
  const cheapTargets = adjacentTargets(s, p).some((c) => defenceNumber(s, c) <= 1);
  if (cheapTargets && p.gold < price + RULES.knight.cost[2]) return;
  const spot = bestInteriorTile(s, p, ctx.me);
  if (spot === null) return;
  commitIfSolvent(ctx, { type: "BUY", item: "farm", at: spot }, spot, 2);
}
