/**
 * Dice augments and the per-attack dice plan (R30, R33, R36, R72; D27, D75).
 *
 * Augments are **integers summed from whatever is active**, never a list of
 * named combat modes (R36, D27). That is the whole reason the model is written
 * this way: enumerating "standard / capital / wall / zombie" is exactly how an
 * implementation never produces `capital + wall = 4 defender dice`, and the
 * magnitude is not cosmetic — a 10v10 capital assault is 56.76% standard,
 * 19.02% at a capital, 5.31% at a capital behind a wall.
 *
 * In scope today only Capitals contributes (`defendDiceBonus: +1`, R72).
 * `attackDicePenalty` and `favourDefenderOnDraw: false` are the Zombies
 * plumbing D75 keeps wired but ships off, so adding that mode later touches no
 * combat code.
 */
import { isBlizzard } from "./graph";
import { SEAT_NEUTRAL } from "./types";
import type { DiceAugment, GameState, MapDef, TerritoryId } from "./types";

/** The augment every in-scope game starts from: textbook dice, ties to the defender (R31). */
export const NEUTRAL_AUGMENT: DiceAugment = {
  defendDiceBonus: 0,
  attackDicePenalty: 0,
  favourDefenderOnDraw: true,
};

/** `true` when `t` is some seat's capital (R72). Elimination leaves a capital standing (R81). */
export function isCapital(state: GameState, t: TerritoryId): boolean {
  return state.seats.some((s) => s.capital === t);
}

/**
 * The summed augment for one specific attack (R36). A capital under defence
 * adds one defender die and nothing else; every other in-scope modifier adds
 * zero, which is why this returns a sum rather than a mode.
 */
export function diceAugmentFor(
  state: GameState,
  map: MapDef,
  from: TerritoryId,
  to: TerritoryId,
): DiceAugment {
  void map;
  void from;
  const capitalBonus = state.rules.capitals && isCapital(state, to) ? 1 : 0;
  return {
    defendDiceBonus: NEUTRAL_AUGMENT.defendDiceBonus + capitalBonus,
    attackDicePenalty: NEUTRAL_AUGMENT.attackDicePenalty,
    favourDefenderOnDraw: NEUTRAL_AUGMENT.favourDefenderOnDraw,
  };
}

/**
 * The dice this attack may use (R30, R33).
 *
 * The attacker holds at least one more army than dice rolled, so
 * `maxAttackDice = min(3 - attackDicePenalty, sourceTroops - 1)`: two troops
 * roll one die, one troop cannot attack at all. The defender rolls
 * `min(defenderTroops, 2 + defendDiceBonus)`, so a one-troop defender rolls
 * one die and the capital augment is `min(D, 3)` — identical to standard play
 * at `D <= 2`, biting only at `D >= 3` (R33).
 */
export function dicePlan(
  state: GameState,
  map: MapDef,
  from: TerritoryId,
  to: TerritoryId,
): { maxAttackDice: 1 | 2 | 3; defendDice: 1 | 2 | 3 | 4 } {
  const aug = diceAugmentFor(state, map, from, to);
  const source = state.territories[from];
  const target = state.territories[to];
  const sourceTroops = source?.troops ?? 0;
  const targetTroops = target?.troops ?? 0;
  const maxAttack = Math.max(1, Math.min(3 - aug.attackDicePenalty, sourceTroops - 1));
  const defend = Math.max(1, Math.min(targetTroops, 2 + aug.defendDiceBonus));
  return {
    maxAttackDice: Math.min(3, maxAttack) as 1 | 2 | 3,
    defendDice: Math.min(4, defend) as 1 | 2 | 3 | 4,
  };
}

/**
 * R31/R32 — resolve one manual roll into losses. Both sets are sorted
 * descending, the top `min(a, d)` pairs are compared, **ties go to the
 * defender** unless the augment inverts that, and each lost comparison costs
 * the loser one army. The attacker can never lose more than the number of
 * pairs compared, which in standard play is at most two (R32).
 */
export function resolveManualRoll(
  attackerDice: readonly number[],
  defenderDice: readonly number[],
  favourDefenderOnDraw: boolean,
): { attackerLosses: number; defenderLosses: number } {
  const a = [...attackerDice].sort((x, y) => y - x);
  const d = [...defenderDice].sort((x, y) => y - x);
  const pairs = Math.min(a.length, d.length);
  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let i = 0; i < pairs; i++) {
    const av = a[i] as number;
    const dv = d[i] as number;
    const attackerWins = favourDefenderOnDraw ? av > dv : av >= dv;
    if (attackerWins) defenderLosses++;
    else attackerLosses++;
  }
  return { attackerLosses, defenderLosses };
}

/**
 * `true` when `to` holds a defender `seat` may attack (R29, R74): another
 * seat's, or the neutral holding's, and never a blizzard or an unclaimed tile.
 */
export function isAttackable(state: GameState, seat: number, to: TerritoryId): boolean {
  if (isBlizzard(state, to)) return false;
  const cell = state.territories[to];
  if (cell === undefined) return false;
  if (cell.owner === seat) return false;
  return cell.owner >= 0 || cell.owner === SEAT_NEUTRAL;
}
