/**
 * What a seat may do right now, and where (R16, R24, R29, R66, R67, R69, R74).
 *
 * `legalActions` exists so the UI and the bots never have to re-derive the
 * rules: it is `validate` run over one representative of every action kind, in
 * a fixed order. The one branch that is not a filter is R24 — in draft with
 * five or more cards and nothing traded yet, it returns **only**
 * `TRADE_CARDS`, because that is the only thing the seat is allowed to do.
 *
 * The three `legal*` zone selectors are **graph queries**, gated on ownership
 * and troop count alone, not on the phase or on `fortifyUsed`. They are what
 * the renderer lights up and what a bot enumerates over, so they stay usable
 * for a hypothetical; `validate` remains the only authority on legality.
 */
import { hasSet, mustTradeNow } from "./cards";
import { knownTerritory, neighbours, reachableOwn } from "./graph";
import { isAttackable } from "./modifiers";
import { currentSeat, isContender, isGameOver, takesTurns } from "./rules";
import { neutralArmiesOwed, seatRow } from "./validate";
import { SEAT_NONE, type ActionKind, type GameState, type MapDef, type Seat, type TerritoryId } from "./types";

/** The fixed order `legalActions` reports in (R91). */
export const ACTION_ORDER: readonly ActionKind[] = [
  "CLAIM",
  "TRADE_CARDS",
  "DRAFT",
  "AUTO_DEPLOY",
  "ATTACK",
  "MOVE_IN",
  "FORTIFY",
  "END_PHASE",
  "END_TURN",
  "CARD_DRAWN",
  "ALLIANCE_PROPOSE",
  "ALLIANCE_ACCEPT",
  "ALLIANCE_BREAK",
];

/** Owned, non-blizzard territories — where draft troops may land (R16, R74). */
export function legalDraftTargets(state: GameState, seat: Seat): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i];
    if (cell !== undefined && !cell.blizzard && cell.owner === seat) out.push(i);
  }
  return out;
}

/**
 * Every territory `from` could attack: a direct neighbour this round (land,
 * sea link or active portal) held by someone else or by the neutral, never a
 * blizzard (R29, R69, R74). `[]` unless `from` is a real seat's territory
 * holding at least two troops (R33).
 */
export function legalAttackTargets(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[] {
  if (!knownTerritory(map, from)) return [];
  const cell = state.territories[from];
  if (cell === undefined || cell.blizzard || cell.owner < 0 || cell.troops < 2) return [];
  return neighbours(state, map, from).filter((t) => isAttackable(state, cell.owner, t));
}

/**
 * Every territory `from` could fortify into: reachable through the owner's own
 * non-blizzard territories, multi-hop allowed (R66, R68, R69, D32). `[]`
 * unless `from` holds at least two troops, since one army always stays behind.
 */
export function legalFortifyMoves(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[] {
  if (!knownTerritory(map, from)) return [];
  const cell = state.territories[from];
  if (cell === undefined || cell.blizzard || cell.owner < 0 || cell.troops < 2) return [];
  return reachableOwn(state, map, from, cell.owner);
}

/** `true` when `seat` has any attack available at all (R29). */
export function canAttackSomewhere(state: GameState, map: MapDef, seat: Seat): boolean {
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i];
    if (cell === undefined || cell.owner !== seat || cell.troops < 2) continue;
    if (legalAttackTargets(state, map, i).length > 0) return true;
  }
  return false;
}

/** `true` when `seat` has any fortify available at all (R66). */
export function canFortifySomewhere(state: GameState, map: MapDef, seat: Seat): boolean {
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i];
    if (cell === undefined || cell.owner !== seat || cell.troops < 2) continue;
    if (legalFortifyMoves(state, map, i).length > 0) return true;
  }
  return false;
}

/** The action kinds `seat` may submit right now, in `ACTION_ORDER` (SPEC §4.10). */
export function legalActions(state: GameState, map: MapDef, seat: Seat): readonly ActionKind[] {
  if (isGameOver(state)) return [];
  const row = seatRow(state, seat);
  if (row === null || !takesTurns(row)) return [];

  const allianceKinds: ActionKind[] = [];
  if (state.rules.alliances) {
    const others = state.seats.filter((s) => s.seat !== seat && isContender(s));
    if (others.some((s) => !row.allies.includes(s.seat))) {
      allianceKinds.push("ALLIANCE_PROPOSE", "ALLIANCE_ACCEPT");
    }
    if (row.allies.length > 0) allianceKinds.push("ALLIANCE_BREAK");
  }

  if (currentSeat(state) !== seat) return ACTION_ORDER.filter((k) => allianceKinds.includes(k));

  const kinds: ActionKind[] = [];

  if (state.phase === "claim") {
    const anyUnclaimed = state.territories.some((t) => !t.blizzard && t.owner === SEAT_NONE);
    const canPlaceOwn =
      row.armiesToClaim > 0 &&
      (anyUnclaimed ? true : legalDraftTargets(state, seat).length > 0);
    if (canPlaceOwn || neutralArmiesOwed(state) > 0) kinds.push("CLAIM");
    return [...kinds, ...ACTION_ORDER.filter((k) => allianceKinds.includes(k))];
  }

  if (state.phase === "draft") {
    // R24 — the forced trade is the only thing on offer.
    if (mustTradeNow(state, seat)) return ["TRADE_CARDS"];
    if (hasSet(row.cards)) kinds.push("TRADE_CARDS");
    if (state.troopsToPlace > 0 && legalDraftTargets(state, seat).length > 0) {
      kinds.push("DRAFT", "AUTO_DEPLOY");
    }
    if (state.troopsToPlace === 0) kinds.push("END_PHASE");
  }

  if (state.phase === "attack") {
    if (state.pendingMoveIn !== null) {
      kinds.push("MOVE_IN");
    } else {
      if (canAttackSomewhere(state, map, seat)) kinds.push("ATTACK");
      kinds.push("END_PHASE");
      if (state.conqueredThisTurn) kinds.push("CARD_DRAWN");
      kinds.push("END_TURN");
    }
  }

  if (state.phase === "fortify") {
    if (!state.fortifyUsed && canFortifySomewhere(state, map, seat)) kinds.push("FORTIFY");
    if (state.conqueredThisTurn) kinds.push("CARD_DRAWN");
    kinds.push("END_TURN");
  }

  const all = new Set<ActionKind>([...kinds, ...allianceKinds]);
  return ACTION_ORDER.filter((k) => all.has(k));
}
