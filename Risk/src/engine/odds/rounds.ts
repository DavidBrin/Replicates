/**
 * The 24 single-roll distributions (R34, R36, D21, D27).
 *
 * `attackDice ∈ 1..3` × `defendDice ∈ 1..4` × `favourDefenderOnDraw ∈ {true,false}` = 24 rows, every
 * one computed by **exhaustive enumeration** of all `6^(a+d)` dice outcomes as an exact integer
 * count, divided by the denominator only at the end — so `3v2` really is `2890/2611/2275` over
 * `7776` to the last bit, which is what makes T3's fraction assertions meaningful. The largest
 * enumeration is `3v4` at `6^7 = 279,936` outcomes; all 24 together are well under a millisecond and
 * are memoised on first use.
 */

import { augmentKey, type DiceAugment, type RoundShape } from "./types";

export const MAX_ATTACK_DICE = 3;
export const MAX_DEFEND_DICE = 4;

/** Exact integer counts of "the attacker loses k of the `min(a,d)` compared pairs". */
export function roundCounts(attackDice: number, defendDice: number, favourDefender: boolean): number[] {
  const pairs = Math.min(attackDice, defendDice);
  const counts = new Array<number>(pairs + 1).fill(0);
  const att = new Array<number>(attackDice).fill(0);
  const def = new Array<number>(defendDice).fill(0);
  const desc = (x: number, y: number): number => y - x;

  const walk = (index: number): void => {
    if (index === attackDice + defendDice) {
      // R31: sort both sets descending, compare rank by rank over the top `pairs`.
      const a = att.slice().sort(desc);
      const d = def.slice().sort(desc);
      let lost = 0;
      for (let p = 0; p < pairs; p++) {
        const ap = a[p] as number;
        const dp = d[p] as number;
        if (favourDefender ? ap <= dp : ap < dp) lost++;
      }
      counts[lost] = (counts[lost] as number) + 1;
      return;
    }
    for (let face = 1; face <= 6; face++) {
      if (index < attackDice) att[index] = face;
      else def[index - attackDice] = face;
      walk(index + 1);
    }
  };
  walk(0);
  return counts;
}

const ROUNDS = new Map<string, Float64Array>();

/**
 * `P(attacker loses k of the compared pairs)`, length `min(attackDice, defendDice) + 1`.
 * Memoised: there are only ever 24 distinct rows.
 */
export function roundDistribution(attackDice: number, defendDice: number, favourDefender: boolean): Float64Array {
  if (attackDice < 1 || attackDice > MAX_ATTACK_DICE) throw new RangeError(`attackDice ${attackDice}`);
  if (defendDice < 1 || defendDice > MAX_DEFEND_DICE) throw new RangeError(`defendDice ${defendDice}`);
  const key = `${attackDice}:${defendDice}:${favourDefender ? 1 : 0}`;
  const hit = ROUNDS.get(key);
  if (hit !== undefined) return hit;
  const counts = roundCounts(attackDice, defendDice, favourDefender);
  const denominator = 6 ** (attackDice + defendDice);
  const out = new Float64Array(counts.length);
  for (let k = 0; k < counts.length; k++) out[k] = (counts[k] as number) / denominator;
  ROUNDS.set(key, out);
  return out;
}

/** Every row, keyed `attackDice:defendDice:tieRule` — the 24 of R36, for tests and tooling. */
export function allRoundDistributions(): ReadonlyMap<string, Float64Array> {
  const out = new Map<string, Float64Array>();
  for (let a = 1; a <= MAX_ATTACK_DICE; a++) {
    for (let d = 1; d <= MAX_DEFEND_DICE; d++) {
      for (const fav of [true, false]) {
        out.set(`${a}:${d}:${fav ? 1 : 0}`, roundDistribution(a, d, fav));
      }
    }
  }
  return out;
}

/** R30/R38: the dice this battle state actually rolls. `A` excludes the garrison. */
export function roundShape(a: number, d: number, aug: DiceAugment): RoundShape {
  const attackDice = Math.min(a, MAX_ATTACK_DICE - aug.attackDicePenalty);
  const defendDice = Math.min(d, 2 + aug.defendDiceBonus);
  return { attackDice, defendDice, pairs: Math.min(attackDice, defendDice) };
}

/** The augment is in range iff every reachable `(attackDice, defendDice)` is one of the 24 rows. */
export function assertSupported(aug: DiceAugment): void {
  const maxAttack = MAX_ATTACK_DICE - aug.attackDicePenalty;
  const maxDefend = 2 + aug.defendDiceBonus;
  if (maxAttack < 1 || maxAttack > MAX_ATTACK_DICE || maxDefend < 1 || maxDefend > MAX_DEFEND_DICE) {
    throw new RangeError(`unsupported augment ${augmentKey(aug)}`);
  }
}

/** R35: expected casualties for one round, `[attacker, defender]`. */
export function roundExpectedLosses(attackDice: number, defendDice: number, favourDefender: boolean): [number, number] {
  const r = roundDistribution(attackDice, defendDice, favourDefender);
  const pairs = Math.min(attackDice, defendDice);
  let attacker = 0;
  for (let k = 0; k <= pairs; k++) attacker += k * (r[k] as number);
  return [attacker, pairs - attacker];
}
