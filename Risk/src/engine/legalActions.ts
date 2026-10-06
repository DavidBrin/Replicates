/**
 * What a seat may do right now, and where (R16, R24, R29, R66, R67, R69, R74).
 *
 * `legalActions` exists so the UI and the bots never have to re-derive the
 * rules: it is `validate` run over one representative of every action kind, in
 * a fixed order. The one branch that is not a filter is R24 — in draft with
 * five or more cards and nothing traded yet, `TRADE_CARDS` is the only **play**
 * on offer, and the alliance kinds ride along because `validateAlliance` never
 * reads the hand (§4.7).
 *
 * **This function and `validate` must agree, in both directions**, and T5
 * asserts exactly that over a few hundred reachable states (SPEC §4.10): every
 * kind returned here has a payload `validate` accepts, and every payload
 * `validate` accepts has its kind returned. Every disagreement found so far was
 * found by reading rather than by a test, because each test asserted one side
 * alone — so the conditions below are written to mirror `validate`'s, comment
 * and all, rather than to approximate them.
 *
 * The three `legal*` zone selectors are **graph queries**, gated on ownership
 * and troop count alone, not on the phase or on `fortifyUsed`. They are what
 * the renderer lights up and what a bot enumerates over, so they stay usable
 * for a hypothetical; `validate` remains the only authority on legality.
 */
import { hasSet, mustTradeNow } from "./cards";
import { knownTerritory, neighbours, reachableOwn } from "./graph";
import { isAttackable } from "./modifiers";
import { currentSeat, isContender, isGameOver, pendingAlliancesOf, takesTurns } from "./rules";
import { neutralArmiesOwed, seatRow } from "./validate";
import {
  SEAT_NEUTRAL, SEAT_NONE,
  type ActionKind, type GameState, type MapDef, type Seat, type TerritoryId,
} from "./types";

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

/**
 * R6/R9 — which `CLAIM` the claim phase is waiting for from `seat`.
 *
 * `"neutral"` means the next claim must carry `forNeutral: true`: in the 2-seat variant each pair of
 * the seat's own armies owes the neutral holding one, and `validate` refuses the seat's *own* claim
 * until that army is placed. A caller that only ever sends `CLAIM { seat, territory }` therefore
 * stalls the whole setup after the first completed pair, which is exactly what this selector exists
 * to stop — the alternation is a rule, not a courtesy, so the UI and the bot runner must both be
 * able to ask whose army is owed rather than guessing.
 *
 * `"none"` means `seat` has nothing left to place. A 3-to-6-seat game never answers `"neutral"`.
 */
export function claimOwed(state: GameState, seat: Seat): "own" | "neutral" | "none" {
  if (state.phase !== "claim") return "none";
  if (currentSeat(state) !== seat) return "none";
  if (neutralArmiesOwed(state) > 0) return "neutral";
  return (seatRow(state, seat)?.armiesToClaim ?? 0) > 0 ? "own" : "none";
}

/**
 * Where R6's neutral army may land: a territory the neutral already holds, or any still unclaimed
 * (R6, R7, R74). This is the zone the board lights while `claimOwed` says `"neutral"`.
 */
export function legalNeutralClaimTargets(state: GameState): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i];
    if (cell === undefined || cell.blizzard) continue;
    if (cell.owner === SEAT_NEUTRAL || cell.owner === SEAT_NONE) out.push(i);
  }
  return out;
}

/**
 * Where `seat`'s own claim army may land: an unclaimed territory while any remain, else one of its
 * own (R9).
 */
export function legalOwnClaimTargets(state: GameState, seat: Seat): readonly TerritoryId[] {
  const unclaimed: TerritoryId[] = [];
  const own: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i];
    if (cell === undefined || cell.blizzard) continue;
    if (cell.owner === SEAT_NONE) unclaimed.push(i);
    else if (cell.owner === seat) own.push(i);
  }
  return unclaimed.length > 0 ? unclaimed : own;
}

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
  /*
   * R80 — diplomacy is for seats still in the game.
   *
   * `isContender(row)` is the condition `validateAlliance` applies to the actor, and it is NOT the
   * `takesTurns(row)` above: a **resigned** seat keeps taking turns (D76) but has stopped being a
   * contender (R84), so without this it was advertised `ALLIANCE_PROPOSE` and `ALLIANCE_ACCEPT`
   * that `validate` then refused with `notAlliable` (codex round 4, finding 5).
   *
   * The hand-size test is R28's guard, mirrored: an alliance action carries a `seat`, so a hand of
   * seven or more refuses it in `validate` like any other play, and the forced trade-down really is
   * the only thing such a seat may send. It is read here rather than in the `draft` branch below
   * because the off-turn return a few lines down answers from `allianceKinds` alone.
   */
  if (state.rules.alliances && isContender(row) && row.cards.length <= 6) {
    const offers = pendingAlliancesOf(state);
    /*
     * The ally list is filtered through `isContender` too, because elimination and resignation are
     * what *end* a pact: a survivor's `allies` can still name a seat that is out, and advertising
     * `ALLIANCE_BREAK` for a pact `validateAlliance` no longer recognises is the same disagreement
     * from the other end (codex round 4, finding 4). The reducer drops the entry at the source;
     * reading the standing here is what keeps a state folded by an older build honest.
     */
    const others = state.seats.filter((s) => s.seat !== seat && isContender(s));
    const unallied = others.filter((s) => !row.allies.includes(s.seat));
    const allied = others.filter((s) => row.allies.includes(s.seat));
    /*
     * R80 — one offer at a time per pair (§4.7), so a seat whose only unallied neighbour already
     * has an offer in the air with it has nobody left to propose to, and `validate` would refuse
     * every `ALLIANCE_PROPOSE` it could send.
     */
    const proposable = unallied.filter(
      (s) => !offers.some(
        ([from, to]) => (from === seat && to === s.seat) || (from === s.seat && to === seat),
      ),
    );
    /*
     * `ALLIANCE_ACCEPT` answers a **recorded** offer, in that direction: `validateAlliance` refuses
     * it outright when no `[other, seat]` pair is on the table, so the pact-only test this used to
     * run advertised an action that could not be sent (codex round 4, finding 2). My own
     * `[seat, other]` offer is not something I can accept.
     */
    const acceptable = unallied.filter(
      (s) => offers.some(([from, to]) => from === s.seat && to === seat),
    );
    if (proposable.length > 0) allianceKinds.push("ALLIANCE_PROPOSE");
    if (acceptable.length > 0) allianceKinds.push("ALLIANCE_ACCEPT");
    if (allied.length > 0) allianceKinds.push("ALLIANCE_BREAK");
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
    /*
     * R24 — the forced trade is the only **play** on offer.
     *
     * Diplomacy rides along, because `validateAlliance` does not read the hand: it gates on
     * `rules.alliances`, on two contenders and on the pair, and nothing else. A bare
     * `["TRADE_CARDS"]` therefore dropped alliance kinds `validate` was accepting all along
     * (codex round 4, finding 7). A hand of **seven or more** is the one case where it really is
     * `TRADE_CARDS` alone, and `allianceKinds` is already empty for it (R28's guard, mirrored
     * above), so no special case is needed here.
     */
    if (mustTradeNow(state, seat)) {
      return ACTION_ORDER.filter((k) => k === "TRADE_CARDS" || allianceKinds.includes(k));
    }
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
      kinds.push("END_PHASE", "END_TURN");
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
