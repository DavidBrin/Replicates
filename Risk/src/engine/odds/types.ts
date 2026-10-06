/**
 * `@/engine/odds` — S2's own types and constants (SPEC §4.12).
 *
 * `DiceAugment`, `OutcomeDist` and the structural `OddsTables` are **declared once**, in S1's
 * `src/engine/types.ts`, because S1's own public API mentions all three (F2). This file re-exports
 * them unchanged and owns everything else.
 */

export type { DiceAugment, OutcomeDist, OddsTables, StoppedOutcome } from "@/engine";

import type { DiceAugment, OutcomeDist, StoppedOutcome } from "@/engine";

/** Standard play: attacker ≤3 dice, defender ≤2, ties to the defender (R21, R31). */
export const STANDARD_AUGMENT: DiceAugment = {
  defendDiceBonus: 0,
  attackDicePenalty: 0,
  favourDefenderOnDraw: true,
};

/** The Zombie augment kept alive for §13's "cheap to add later": ties to the ATTACKER. */
export const ZOMBIE_DEFENDER_AUGMENT: DiceAugment = {
  defendDiceBonus: 0,
  attackDicePenalty: 0,
  favourDefenderOnDraw: false,
};

/** Sum two augments (R36 — augments STACK). Integers add; the tie rule ORs toward the defender. */
export function addAugments(a: DiceAugment, b: DiceAugment): DiceAugment {
  return {
    defendDiceBonus: a.defendDiceBonus + b.defendDiceBonus,
    attackDicePenalty: a.attackDicePenalty + b.attackDicePenalty,
    favourDefenderOnDraw: a.favourDefenderOnDraw || b.favourDefenderOnDraw,
  };
}

/** The canonical memo/table key for an augment: `${defendDiceBonus}:${attackDicePenalty}:${0|1}`. */
export function augmentKey(aug: DiceAugment): string {
  return `${aug.defendDiceBonus}:${aug.attackDicePenalty}:${aug.favourDefenderOnDraw ? 1 : 0}`;
}

export function isStandard(aug: DiceAugment): boolean {
  return augmentKey(aug) === augmentKey(STANDARD_AUGMENT);
}

/** `W[A][D]` is tabulated for `A, D ≤ TABLE_MAX`; 129×129 as a `Float32Array` (R43, D22). */
export const TABLE_MAX = 128;
/** [SPEC]: the brief gives the predicate (`W ≥ 1 − ε`), not the epsilon. */
export const CERTAIN_EPS = 1e-9;
export const LOGISTIC_ALPHA = 0.86;
export const LOGISTIC_BETA = 0.63;
/** SMG's published `BalanceConfig` defaults (R49, D23). */
export const BALANCE_CONFIG = {
  winChanceCutoff: 0.05,
  winChancePower: 1.3,
  outcomeCutoff: 0.1,
  outcomePower: 1.8,
} as const;
export type BalanceConfig = typeof BALANCE_CONFIG;
/** R59/D7: every cumulative probability is rounded to this grid before it is compared against `u`. */
export const CDF_QUANTUM = 2 ** 32;

/** The dice actually rolled for one round of a battle at `(A, D)` under `aug` (R30, R38). */
export interface RoundShape {
  /** Attacker dice, `min(A, 3 − attackDicePenalty)`. */
  readonly attackDice: number;
  /** Defender dice, `min(D, 2 + defendDiceBonus)`. */
  readonly defendDice: number;
  /** Compared pairs, `min(attackDice, defendDice)`. */
  readonly pairs: number;
}

/**
 * S2's internal distribution: the published contract with the limiter's per-pair breakdown
 * **required** rather than optional.
 *
 * `StoppedOutcome` and `OutcomeDist.stopped` are declared in S1's `src/engine/types.ts` and
 * re-exported above, because S1's resolver has to read the breakdown to name the actual troop
 * losses of a stopped battle (F46). Sorted by `attackerLosses` then `defenderLosses`, so the
 * sampling walk is pinned (R59).
 */
export interface BattleDist extends OutcomeDist {
  readonly stopped: readonly StoppedOutcome[];
}

/** What one PRNG draw turns a distribution into (R58, D6). */
export interface SampledOutcome {
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly conquered: boolean;
  readonly unresolved: boolean;
}
