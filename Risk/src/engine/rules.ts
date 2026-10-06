/**
 * The arithmetic of a turn and the end of a game (R12–R15, R70–R72, R77–R84;
 * D18, D57, D59, D60).
 *
 * Reinforcements are `max(3, floor(territories / 3))` plus whole-continent
 * bonuses, evaluated once at the owner's turn start (R12, R13, D18). The
 * capital draft bonus is a real flag that ships off (R15, D57).
 *
 * `evaluateOutcome` is R83's order, written once: domination, then capitals,
 * then last seat standing, then Max Rounds expiry. The first that fires wins
 * and nothing after it is consulted — which matters because owning the whole
 * board is simultaneously three different wins and only one of them is the
 * right label.
 */
import { continentsHeldBy } from "./continents";
import { playableTerritories } from "./graph";
import {
  SEAT_NEUTRAL,
  SEAT_UNKNOWN,
  TROOPS_UNKNOWN,
  type ContinentId,
  type GameState,
  type MapDef,
  type Outcome,
  type Seat,
  type SeatState,
} from "./types";

/** +2 per held capital, when `rules.capitalDraftBonus` is on (R15, D57). */
export const CAPITAL_DRAFT_BONUS = 2;

/**
 * `true` when this seat still takes turns.
 *
 * A **resigned** seat does (D76): it keeps its territories and cards and a bot
 * plays it from then on, so the turn loop must still visit it. Only elimination
 * removes a seat from the rotation (R81).
 */
export function takesTurns(seat: SeatState): boolean {
  return seat.standing !== "eliminated";
}

/**
 * `true` when this seat counts as a rival for a win check.
 *
 * R84 is explicit that last-seat-standing counts the "non-eliminated,
 * **non-resigned**" seats, so a resigned seat is not an obstacle to that win
 * even though its bot keeps playing (D76). The two predicates are deliberately
 * different; collapsing them is how a 2-player resignation either never ends
 * or ends the wrong way.
 */
export function isContender(seat: SeatState): boolean {
  return seat.standing === "active" || seat.standing === "away";
}

/** The seats a win check counts, ascending by seat index (R84, R91). */
export function livingSeats(state: GameState): readonly Seat[] {
  return state.seats.filter(isContender).map((s) => s.seat).sort((a, b) => a - b);
}

/** The seats still in the rotation, ascending (R81). */
export function turnTakingSeats(state: GameState): readonly Seat[] {
  return state.seats.filter(takesTurns).map((s) => s.seat).sort((a, b) => a - b);
}

/** The seat whose turn it is, or `-1` when there is none. */
export function currentSeat(state: GameState): Seat {
  return state.turnOrder[state.currentIndex] ?? -1;
}

/** `true` when any territory is masked by fog — i.e. this is a view, not authority (R73). */
export function hasHiddenTerritories(state: GameState): boolean {
  return state.territories.some((t) => t.owner === SEAT_UNKNOWN || t.troops === TROOPS_UNKNOWN);
}

/** Territories `seat` owns. Counts only what is visible, so a view undercounts (R74). */
export function territoryCountFor(state: GameState, seat: Seat): number {
  let n = 0;
  for (const t of state.territories) if (t.owner === seat) n++;
  return n;
}

/** Troops `seat` has on the board. Counts only what is visible. */
export function troopCountFor(state: GameState, seat: Seat): number {
  let n = 0;
  for (const t of state.territories) if (t.owner === seat && t.troops > 0) n += t.troops;
  return n;
}

/**
 * Territories by seat, `null` where fog hides the total (R73, F52).
 *
 * On authoritative state every entry is a number. On a fogged view **every**
 * entry is `null`, because a hidden tile could belong to any seat and a
 * confident number there would be a leak. A viewer's own capsule reads
 * `territoryCountFor(state, mySeat)` instead, which is exact — the viewer's
 * own territories are never masked.
 */
export function territoryCounts(state: GameState): readonly (number | null)[] {
  if (hasHiddenTerritories(state)) return state.seats.map(() => null);
  return state.seats.map((s) => territoryCountFor(state, s.seat));
}

/** Troops by seat, `null` where fog hides the total (R73, F52). See `territoryCounts`. */
export function troopCounts(state: GameState): readonly (number | null)[] {
  if (hasHiddenTerritories(state)) return state.seats.map(() => null);
  return state.seats.map((s) => troopCountFor(state, s.seat));
}

/**
 * R12–R15 — what `seat` is paid at the start of its turn.
 *
 * `base = max(3, floor(owned / 3))`: 11 -> 3, 14 -> 4, 16 -> 5, 17 -> 5.
 * `bonus` sums every continent held entirely (R13), blizzards not breaking it
 * (R14). `capitals` is R15's off-by-default +2 per held capital.
 */
export function reinforcementsFor(
  state: GameState,
  map: MapDef,
  seat: Seat,
): { base: number; continents: readonly ContinentId[]; bonus: number; capitals: number; total: number } {
  const owned = territoryCountFor(state, seat);
  const base = Math.max(3, Math.floor(owned / 3));
  const continents = continentsHeldBy(state, map, seat);
  let bonus = 0;
  for (const id of continents) bonus += (map.continents[id] as { bonus: number }).bonus;
  let capitals = 0;
  if (state.rules.capitalDraftBonus && state.rules.capitals) {
    for (const other of state.seats) {
      if (other.capital === null) continue;
      if (state.territories[other.capital]?.owner === seat) capitals += CAPITAL_DRAFT_BONUS;
    }
  }
  return { base, continents, bonus, capitals, total: base + bonus + capitals };
}

/** `true` once the game has an outcome; no action is accepted after that (R83). */
export function isGameOver(state: GameState): boolean {
  return state.outcome !== null;
}

/** The territory count a Percentage Domination win needs (R71, D60). */
export function dominationTarget(state: GameState): number {
  const playable = playableTerritories(state).length;
  return Math.ceil(state.rules.dominationThreshold * playable);
}

/** `true` when `seat` holds every seat's capital (R72). */
function holdsEveryCapital(state: GameState, seat: Seat): boolean {
  const capitals = state.seats.map((s) => s.capital).filter((c): c is number => c !== null);
  if (capitals.length === 0) return false;
  return capitals.every((c) => state.territories[c]?.owner === seat);
}

/**
 * R78 — the Max Rounds ladder: most territories, then most troops, then the
 * lowest seat index. A total comparator, as R91 requires.
 */
export function maxRoundsWinner(state: GameState): Seat {
  const scored = livingSeats(state).map((seat) => ({
    seat,
    territories: territoryCountFor(state, seat),
    troops: troopCountFor(state, seat),
  }));
  if (scored.length === 0) return -1;
  scored.sort((a, b) => b.territories - a.territories || b.troops - a.troops || a.seat - b.seat);
  return (scored[0] as { seat: Seat }).seat;
}

/**
 * R83 — the win evaluation order, run after every action.
 *
 * `roundCompleted` is the round an `END_TURN` just finished, and is the only
 * thing that can trigger R77; every other check is state-only. The neutral
 * holding is never a candidate and never counted (R7).
 */
export function evaluateOutcome(
  state: GameState,
  map: MapDef,
  roundCompleted: number | null = null,
): Outcome | null {
  void map;
  const playable = playableTerritories(state);
  const living = livingSeats(state);

  // 1 — World / Percentage domination (R70, R71).
  if (state.rules.winCondition === "world") {
    for (const seat of living) {
      if (playable.length > 0 && playable.every((t) => state.territories[t]?.owner === seat)) {
        return { winner: seat, reason: "world", tiebreak: false, round: state.round };
      }
    }
  } else if (state.rules.winCondition === "percentage") {
    const target = dominationTarget(state);
    for (const seat of living) {
      if (target > 0 && territoryCountFor(state, seat) >= target) {
        return { winner: seat, reason: "percentage", tiebreak: false, round: state.round };
      }
    }
  }

  // 2 — Capitals (R72).
  if (state.rules.winCondition === "capitals" && state.rules.capitals) {
    for (const seat of living) {
      if (holdsEveryCapital(state, seat)) {
        return { winner: seat, reason: "capitals", tiebreak: false, round: state.round };
      }
    }
  }

  // 3 — Last seat standing (R84). The neutral is never counted.
  if (living.length === 1) {
    return { winner: living[0] as Seat, reason: "lastStanding", tiebreak: false, round: state.round };
  }

  // 4 — Max Rounds expiry (R77, R78). Every such outcome is decided by the
  // ladder rather than by conquest, so it always carries `tiebreak: true`.
  if (state.rules.maxRounds !== null && roundCompleted !== null && roundCompleted >= state.rules.maxRounds) {
    const winner = maxRoundsWinner(state);
    if (winner >= 0) return { winner, reason: "maxRounds", tiebreak: true, round: roundCompleted };
  }

  return null;
}

/** `true` when `seat` is the sentinel neutral holding rather than a real seat (R7). */
export function isNeutralOwner(owner: Seat): boolean {
  return owner === SEAT_NEUTRAL;
}
