/**
 * `makeView` — the flat read-model (SPEC §4.13, D31).
 *
 * Built from an authoritative `GameState`, or from `viewFor`'s output for an honest bot. The fog
 * policy lives here and nowhere else:
 *
 * - `persona.fogHonest` (Beginner–Hard) means the bot is handed the same masked state a human sees,
 *   and whatever is hidden is **believed** at an inflated strength: `fogPessimism × the mean stack
 *   on the territories it can see`, floored at 1. Warzone's production AI documents the honest
 *   alternative as "we have no way of knowing what's there, so just assume the minimum"; inflating
 *   instead of assuming the minimum is what makes the pessimism a genuine difficulty dial rather
 *   than a handicap.
 * - `persona.fogHonest === false` (Expert only, D31) means the caller is expected to hand over
 *   authoritative state. If it hands over a masked one anyway, the belief path still applies with
 *   no inflation — a view is never allowed to carry a `SEAT_UNKNOWN` through into a score.
 *
 * `known[t]` is 1 exactly when the true value came through, so a caller can tell a belief from a
 * fact without re-deriving the mask.
 */

import {
  SEAT_NEUTRAL, SEAT_NONE, SEAT_UNKNOWN, TROOPS_UNKNOWN,
  type BotPersona, type GameState, type MapDef, type Seat, type Standing,
} from "@/engine";

import type { GameView } from "./types";

/** A territory held by a real seat, the neutral holding, or nobody — but not hidden. */
function isVisibleOwner(owner: number): boolean {
  return owner !== SEAT_UNKNOWN;
}

export function makeView(
  state: GameState,
  map: MapDef,
  seat: Seat,
  persona: BotPersona,
  grudge?: Float32Array,
): GameView {
  const n = map.territories.length;
  const seats = state.seats.length;

  const owner = new Int16Array(n);
  const troops = new Int16Array(n);
  const known = new Uint8Array(n);
  const blizzard = new Uint8Array(n);

  // Pass 1: copy what is known, and measure the visible board so the belief has something to
  // calibrate against.
  let visibleTroops = 0;
  let visibleCount = 0;
  for (let t = 0; t < n; t++) {
    const cell = state.territories[t];
    if (cell === undefined) continue;
    blizzard[t] = cell.blizzard ? 1 : 0;
    const ownerKnown = isVisibleOwner(cell.owner);
    const troopsKnown = cell.troops !== TROOPS_UNKNOWN;
    owner[t] = ownerKnown ? cell.owner : SEAT_UNKNOWN;
    if (ownerKnown && troopsKnown) {
      known[t] = 1;
      troops[t] = cell.troops;
      if (cell.owner !== SEAT_NONE) {
        visibleTroops += cell.troops;
        visibleCount++;
      }
    }
  }

  // Pass 2: fill the unknowns with a belief (R73's fog, D31's honesty policy).
  const mean = visibleCount > 0 ? visibleTroops / visibleCount : 1;
  const inflation = persona.fogHonest ? persona.fogPessimism : 1;
  const belief = Math.max(1, Math.round(mean * inflation));
  for (let t = 0; t < n; t++) {
    if (known[t] === 1) continue;
    if (owner[t] === SEAT_NONE) {
      troops[t] = 0;
      continue;
    }
    troops[t] = belief;
  }

  // Per-seat aggregates, counted off the view so a fogged bot's arithmetic matches its beliefs.
  const territoryCount = new Int16Array(seats);
  const troopCount = new Int32Array(seats);
  for (let t = 0; t < n; t++) {
    const o = owner[t] as number;
    if (o < 0) continue; // SEAT_NONE / SEAT_NEUTRAL / SEAT_UNKNOWN are not seats
    territoryCount[o] = (territoryCount[o] as number) + 1;
    troopCount[o] = (troopCount[o] as number) + (troops[t] as number);
  }

  const cardCount = new Int16Array(seats);
  const capital = new Int16Array(seats).fill(-1);
  const allies = new Uint8Array(seats);
  const standing: Standing[] = [];
  for (let s = 0; s < seats; s++) {
    const seatState = state.seats[s];
    if (seatState === undefined) {
      standing.push("eliminated");
      continue;
    }
    cardCount[s] = seatState.cardCount;
    capital[s] = seatState.capital ?? -1;
    standing.push(seatState.standing);
  }
  const mySeat = state.seats[seat];
  for (const ally of mySeat?.allies ?? []) if (ally >= 0 && ally < seats) allies[ally] = 1;

  return {
    map,
    rules: state.rules,
    me: seat,
    persona,
    turn: state.turn,
    round: state.round,
    phase: state.phase,
    owner,
    troops,
    known,
    blizzard,
    portals: state.portals,
    capital,
    territoryCount,
    troopCount,
    cardCount,
    myCards: mySeat?.cards ?? [],
    allies,
    standing,
    troopsToPlace: state.troopsToPlace,
    setsTradedTotal: state.setsTradedTotal,
    conqueredThisTurn: state.conqueredThisTurn,
    grudge: grudge ?? new Float32Array(seats),
  };
}

/** Is `owner` a seat that can be attacked by `me` — i.e. not me, not an ally, not unowned? */
export function isEnemy(view: GameView, owner: number): boolean {
  if (owner === view.me) return false;
  if (owner === SEAT_NEUTRAL) return true; // the 2-player variant's holding is attackable (R29)
  if (owner === SEAT_NONE || owner === SEAT_UNKNOWN) return false;
  if ((view.allies[owner] as number) === 1) return false;
  return true;
}

/**
 * Every neighbour of `t` the bot may act across: the map's static adjacency (land ∪ sea links, F45)
 * plus any portal edge that **conducts this round** (R68, R75, R76, F9).
 */
export function neighbours(view: GameView, t: number): readonly number[] {
  const base = view.map.adjacency[t] ?? [];
  if (view.portals.length === 0) return base;
  const extra: number[] = [];
  for (const portal of view.portals) {
    if (portal.activeFrom > view.round) continue;
    if (portal.a === t) extra.push(portal.b);
    else if (portal.b === t) extra.push(portal.a);
  }
  if (extra.length === 0) return base;
  // Sorted ascending and de-duplicated: never iterate an order that can vary (§7.2 rule 2).
  return [...new Set([...base, ...extra])].sort((x, y) => x - y);
}
