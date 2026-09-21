/**
 * `apply(state, action)` — the one door into the rules (SPEC §3.4–§3.8, §4).
 * Every branch validates first and returns `{ state: input, events: [], error }`
 * on a rule violation; nothing in here throws for an illegal action. Successful
 * MOVE / BUY actions are recorded in `history`; UNDO replays that history from
 * the `turnStart` snapshot (D37); END_TURN runs the next seat's turn-start
 * pipeline (§3.8) inside the same call.
 */
import { closeDraft, coreOf, openDraft, setProvince, setTile, tileAt, type Draft } from "./draft";
import { BASE_TERRAIN, inBounds, isFieldOrGrave, isOwnable, neighbourIndices, tileIndex } from "./grid";
import { computeMoveZone } from "./moveZone";
import { captureTile, checkElimination } from "./provinces";
import {
  buyCost,
  canAttack,
  canMerge,
  isBuildableOwnTile,
  knightLevelOf,
  payingProvince,
  provinceIncome,
  provinceUpkeep,
  provincesOf,
} from "./rules";
import {
  RULES,
  type Action,
  type ApplyResult,
  type GameState,
  type Province,
  type RuntimeTile,
  type TileCoord,
  type UnitLevel,
} from "./types";

function reject(state: GameState, error: string): ApplyResult {
  return { state, events: [], error };
}

function sameCoord(a: TileCoord, b: TileCoord): boolean {
  return a.x === b.x && a.y === b.y;
}

function containsCoord(list: readonly TileCoord[], c: TileCoord): boolean {
  return list.some((x) => sameCoord(x, c));
}

export function apply(state: GameState, action: Action): ApplyResult {
  if (state.outcome !== null) return reject(state, "game over");
  switch (action.type) {
    case "MOVE":
      return applyMove(state, action);
    case "BUY":
      return applyBuy(state, action);
    case "UNDO":
      return applyUndo(state);
    case "END_TURN":
      return applyEndTurn(state);
    default:
      return reject(state, "unknown action");
  }
}

/* ----------------------------------------------------------------- MOVE -- */

function applyMove(state: GameState, action: Extract<Action, { type: "MOVE" }>): ApplyResult {
  const { unitAt, to } = action;
  if (!inBounds(state.width, state.height, unitAt.x, unitAt.y)) return reject(state, "unitAt out of bounds");
  if (!inBounds(state.width, state.height, to.x, to.y)) return reject(state, "destination out of bounds");
  if (sameCoord(unitAt, to)) return reject(state, "destination is the unit's own tile");
  const fromIdx = tileIndex(state.width, unitAt.x, unitAt.y);
  const toIdx = tileIndex(state.width, to.x, to.y);
  const origin = state.tiles[fromIdx] as RuntimeTile;
  if (origin.unit === null) return reject(state, "no unit at unitAt");
  if (origin.owner !== state.activePlayerIndex) return reject(state, "unit belongs to another player");
  if (!origin.unit.readyToMove) return reject(state, "unit has already acted this turn");

  const zone = computeMoveZone(state, unitAt);
  const d = openDraft(state);
  const unit = origin.unit;
  const me = state.activePlayerIndex;

  if (containsCoord(zone.mergeable, to)) {
    // SPEC §3.4 merge: levels add; stays ready iff both sources were ready.
    const target = tileAt(d, toIdx);
    const newLevel = (unit.level + (target.unit as { level: number }).level) as UnitLevel;
    const ready = unit.readyToMove && (target.unit as { readyToMove: boolean }).readyToMove;
    setTile(d, fromIdx, { unit: null });
    setTile(d, toIdx, { unit: { level: newLevel, readyToMove: ready } });
    d.events.push({ type: "moved", from: unitAt, to, player: me });
    d.events.push({ type: "merged", at: to, newLevel });
  } else if (containsCoord(zone.clearable, to)) {
    // SPEC §3.1: clearing a field / grave ends the unit's turn.
    setTile(d, fromIdx, { unit: null });
    setTile(d, toIdx, { unit: { level: unit.level, readyToMove: false }, terrain: BASE_TERRAIN[d.biome], graveAge: 0 });
    d.events.push({ type: "moved", from: unitAt, to, player: me });
    d.events.push({ type: "fieldCleared", at: to });
  } else if (containsCoord(zone.reachable, to)) {
    // D2: a reposition inside own territory keeps the unit ready.
    setTile(d, fromIdx, { unit: null });
    setTile(d, toIdx, { unit: { level: unit.level, readyToMove: true } });
    d.events.push({ type: "moved", from: unitAt, to, player: me });
  } else if (containsCoord(zone.collectable, to)) {
    // SPEC §3.4 / D35: stepping onto an own chest collects it; the step itself is a free reposition.
    setTile(d, fromIdx, { unit: null });
    setTile(d, toIdx, { unit: { level: unit.level, readyToMove: true } });
    d.events.push({ type: "moved", from: unitAt, to, player: me });
    collectChest(d, toIdx);
  } else if (containsCoord(zone.capturable, to)) {
    setTile(d, fromIdx, { unit: null });
    d.events.push({ type: "moved", from: unitAt, to, player: me });
    captureTile(d, toIdx, me, { level: unit.level, readyToMove: false }, unitAt);
  } else {
    return reject(state, explainUnreachable(state, unit.level, to));
  }

  return { state: closeDraft(d, [...state.history, action], state.turnStart), events: d.events };
}

/** Removes the chest on an own tile and banks +10 in its province (discarded on a lone tile). */
function collectChest(d: Draft, index: number): void {
  const t = tileAt(d, index);
  setTile(d, index, { building: null });
  const banked = t.provinceId !== null ? RULES.chest.bonus : 0;
  if (t.provinceId !== null) {
    const p = d.provinces[t.provinceId] as Province;
    setProvince(d, p.id, { gold: p.gold + banked });
  }
  d.events.push({ type: "chestCollected", at: { x: t.x, y: t.y }, amount: banked });
}

/** A specific reason for the UI / tutorial triggers ("attackBlocked:*"). */
function explainUnreachable(state: GameState, level: number, to: TileCoord): string {
  const t = state.tiles[tileIndex(state.width, to.x, to.y)] as RuntimeTile;
  if (!isOwnable(t.terrain)) return "destination is not passable terrain";
  if (t.owner !== state.activePlayerIndex && !canAttack(state, level, to)) {
    return t.building === "woodwall" || t.building === "stoneTower"
      ? "attack blocked by wall"
      : "attack blocked by defence";
  }
  if (t.owner === state.activePlayerIndex && t.unit !== null && !canMerge(level, t.unit.level)) {
    return "merge would exceed level 4";
  }
  return "destination is not reachable";
}

/* ------------------------------------------------------------------ BUY -- */

function applyBuy(state: GameState, action: Extract<Action, { type: "BUY" }>): ApplyResult {
  const { item, at } = action;
  if (!inBounds(state.width, state.height, at.x, at.y)) return reject(state, "target out of bounds");
  const idx = tileIndex(state.width, at.x, at.y);
  const t = state.tiles[idx] as RuntimeTile;
  if (!isOwnable(t.terrain)) return reject(state, "cannot build on this terrain");
  const me = state.activePlayerIndex;
  const level = knightLevelOf(item);

  if (t.owner === me) {
    if (t.provinceId === null) return reject(state, "a lone tile has no treasury");
    const province = state.provinces[t.provinceId] as Province;
    const cost = buyCost(state, province, item);
    if (province.gold < cost) return reject(state, "not enough gold");
    const d = openDraft(state);

    if (level !== null && t.unit !== null) {
      // SPEC §3.5 merge-buy: the bought unit counts as ready.
      if (!canMerge(t.unit.level, level)) return reject(state, "merge would exceed level 4");
      const newLevel = (t.unit.level + level) as UnitLevel;
      setProvince(d, province.id, { gold: province.gold - cost });
      setTile(d, idx, { unit: { level: newLevel, readyToMove: t.unit.readyToMove } });
      d.events.push({ type: "bought", item, at, cost, provinceId: province.id });
      d.events.push({ type: "merged", at, newLevel });
      return { state: closeDraft(d, [...state.history, action], state.turnStart), events: d.events };
    }

    if (level !== null && level > 1) return reject(state, "only a level-1 knight can be placed on an empty tile");
    if (!isBuildableOwnTile(t, item)) return reject(state, "tile is not free to build on");
    setProvince(d, province.id, { gold: province.gold - cost });
    d.events.push({ type: "bought", item, at, cost, provinceId: province.id });
    if (level !== null) {
      const clears = isFieldOrGrave(t.terrain);
      setTile(d, idx, {
        unit: { level: 1, readyToMove: !clears },
        terrain: clears ? BASE_TERRAIN[d.biome] : t.terrain,
        graveAge: 0,
      });
      if (clears) d.events.push({ type: "fieldCleared", at });
      if (t.building === "chest") collectChest(d, idx);
    } else {
      setTile(d, idx, { building: item as "woodwall" | "stoneTower" | "farm" });
    }
    return { state: closeDraft(d, [...state.history, action], state.turnStart), events: d.events };
  }

  // Attack-buy (SPEC §3.4, Antiyoy `buildUnitByAttack`): paid by an adjacent province (D11).
  if (level === null) return reject(state, "buildings can only be placed on own tiles");
  const cost = RULES.knight.cost[level];
  const payer = payingProvince(state, idx, me, cost);
  if (payer === null) {
    return reject(
      state,
      state.provinces && Object.values(state.provinces).some((p) => p.owner === me && p.gold >= cost)
        ? "target is not adjacent to a province that can pay"
        : "not enough gold",
    );
  }
  if (!canAttack(state, level, at)) {
    return reject(
      state,
      t.building === "woodwall" || t.building === "stoneTower" ? "attack blocked by wall" : "attack blocked by defence",
    );
  }
  const d = openDraft(state);
  setProvince(d, payer.id, { gold: payer.gold - cost });
  d.events.push({ type: "bought", item, at, cost, provinceId: payer.id });
  captureTile(d, idx, me, { level, readyToMove: false }, null);
  return { state: closeDraft(d, [...state.history, action], state.turnStart), events: d.events };
}

/* ----------------------------------------------------------------- UNDO -- */

function applyUndo(state: GameState): ApplyResult {
  if (state.history.length === 0) return reject(state, "nothing to undo");
  if (state.turnStart === null) return reject(state, "no turn-start snapshot");
  const replay = state.history.slice(0, -1);
  let s: GameState = { ...state.turnStart, history: [], turnStart: state.turnStart };
  for (const a of replay) {
    const r = apply(s, a);
    if (r.error !== undefined) return reject(state, `history replay failed: ${r.error}`);
    s = r.state;
  }
  return { state: s, events: [{ type: "undone" }] };
}

/* ------------------------------------------------------------- END_TURN -- */

function applyEndTurn(state: GameState): ApplyResult {
  const d = openDraft(state);
  const me = state.activePlayerIndex;
  // §3.8 step 3: every unit stops being ready.
  for (let i = 0; i < d.tiles.length; i++) {
    const t = tileAt(d, i);
    if (t.unit !== null && t.unit.readyToMove) setTile(d, i, { unit: { level: t.unit.level, readyToMove: false } });
  }
  d.events.push({ type: "turnEnded", player: me });
  // §3.8 steps 4–5: fallback elimination + win check.
  checkElimination(d);
  if (d.outcome !== null) {
    return { state: closeDraft(d, [], state.turnStart), events: d.events };
  }
  const nextSeat = nextActiveSeat(d, me);
  if (nextSeat <= me) d.turnNumber += 1;
  d.activePlayerIndex = nextSeat;
  startTurn(d, nextSeat);
  const core = coreOf(d);
  return { state: { ...core, history: [], turnStart: core }, events: d.events };
}

function nextActiveSeat(d: Draft, from: number): number {
  const n = d.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (!(d.players[idx] as { eliminated: boolean }).eliminated) return idx;
  }
  return from;
}

/**
 * SPEC §3.8 step 1 for seat `player`: ready its units, then (not on day 1, D36)
 * income → upkeep → bankruptcy → starvation → grave aging.
 */
export function startTurn(d: Draft, player: number): void {
  d.events.push({ type: "turnStarted", player, turnNumber: d.turnNumber });
  for (let i = 0; i < d.tiles.length; i++) {
    const t = tileAt(d, i);
    if (t.owner === player && t.unit !== null && !t.unit.readyToMove) {
      setTile(d, i, { unit: { level: t.unit.level, readyToMove: true } });
    }
  }
  if (d.turnNumber === 0) return;

  const core = coreOf(d);
  const newGraves = new Set<number>();
  for (const province of provincesOf(core, player)) {
    const income = provinceIncome(core, province);
    const upkeep = provinceUpkeep(core, province);
    d.events.push({ type: "income", provinceId: province.id, amount: income, city: province.city });
    d.events.push({ type: "upkeepPaid", provinceId: province.id, amount: upkeep, city: province.city });
    const total = province.gold + income - upkeep;
    if (total < 0) {
      // §3.2 bankruptcy: every unit dies and leaves a grave; buildings survive; gold floors at 0.
      d.events.push({ type: "bankrupt", provinceId: province.id, city: province.city });
      for (const key of province.tileKeys) {
        const c = keyToCoord(key);
        const i = tileIndex(d.width, c.x, c.y);
        const t = tileAt(d, i);
        if (t.unit === null) continue;
        if (t.terrain === "bridge" || t.building !== null) {
          setTile(d, i, { unit: null }); // no grave can sit on a bridge or a mine
        } else {
          setTile(d, i, { unit: null, terrain: "grave", graveAge: 0 });
          newGraves.add(i);
        }
      }
      setProvince(d, province.id, { gold: 0 });
    } else {
      setProvince(d, province.id, { gold: total });
    }
  }

  // §3.2 starvation: a unit with no same-owner 4-neighbour dies, no grave.
  for (let i = 0; i < d.tiles.length; i++) {
    const t = tileAt(d, i);
    if (t.owner !== player || t.unit === null) continue;
    const friendly = neighbourIndices(d.width, d.height, i).some((n) => tileAt(d, n).owner === player);
    if (!friendly) {
      setTile(d, i, { unit: null });
      d.events.push({ type: "starved", at: { x: t.x, y: t.y } });
    }
  }

  // §3.1 / D6 grave aging: graves that pre-date this turn-start age; age 2 → grass field.
  for (let i = 0; i < d.tiles.length; i++) {
    const t = tileAt(d, i);
    if (t.owner !== player || t.terrain !== "grave" || newGraves.has(i)) continue;
    const age = t.graveAge + 1;
    const nowField = age >= RULES.graveTurnsToField;
    setTile(d, i, nowField ? { terrain: "grassField", graveAge: 0 } : { graveAge: age });
    d.events.push({ type: "graveAged", at: { x: t.x, y: t.y }, nowField });
  }
}

function keyToCoord(key: string): TileCoord {
  const comma = key.indexOf(",");
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) };
}

