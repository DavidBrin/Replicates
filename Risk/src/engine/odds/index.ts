/**
 * `@/engine/odds` — the dice maths (SPEC §4.12).
 *
 * `createOdds(mode)` is the one door. It builds **exactly one** table eagerly: the True Random
 * `Float32Array` for the standard 3v2 ties-to-defender augment, 129×129, 65 KiB, ~2 ms (F49, D22) —
 * the augment the overwhelming majority of queries use. Every other augment, and every Balanced
 * Blitz distribution, is built on first use and memoised (F48, F49, D24). A full 100×100 BB table
 * measures 199.8 ms, which is over the init budget, and a real game queries far fewer than 10,000
 * distinct pairs.
 *
 * One table per dice mode, handed to the bot (R57, D25): a bot given the True Random table in a
 * Balanced Blitz game underestimates its own odds by up to 14 points, which is a correctness bug.
 *
 * Every memo in here is **pure and never serialised** — a cache-warm difference must never become a
 * replay divergence (D24).
 */

import type { DiceMode, OddsTables } from "@/engine";

import { balance } from "./balance";
import { battleTable, expectedAttackerLossOf, outcomeDist, winChanceExact } from "./dp";
import { logisticWinChance } from "./logistic";
import {
  augmentKey, CERTAIN_EPS, isStandard, STANDARD_AUGMENT, TABLE_MAX,
  type BattleDist, type DiceAugment,
} from "./types";

export { roundDistribution, roundCounts, roundShape, roundExpectedLosses, allRoundDistributions } from "./rounds";
export { battleTable, buildTable, buildTableExact, outcomeDist, winChanceExact, expectedAttackerLossOf, resetCaches } from "./dp";
export { logisticWinChance } from "./logistic";
export { balance, balanceStage2Only } from "./balance";
export { sampleOutcome, cumulativeGrid } from "./sample";
export * from "./types";

/**
 * True Random `W[A][D]`, never clamping indices (R43).
 *
 * Inside the table it is the shipped `Float32Array` lookup. Outside it, the **standard** augment
 * uses the fitted logistic; **every other augment has no fit**, so the DP is extended to the
 * requested `(a, d)` on demand and memoised (F48). An above-table query at a non-standard augment —
 * a 129+ stack attacking a capital — is rare enough that an O(A·D) build on the spot is the right
 * trade against shipping four more curves nobody validated.
 */
function trueRandomWinChance(a: number, d: number, aug: DiceAugment): number {
  if (a <= 0) return d === 0 ? 1 : 0;
  if (d <= 0) return 1;
  if (a <= TABLE_MAX && d <= TABLE_MAX) {
    const table = battleTable(aug);
    return table[a * (TABLE_MAX + 1) + d] as number;
  }
  return isStandard(aug) ? logisticWinChance(a, d) : winChanceExact(a, d, aug);
}

export function createOdds(mode: DiceMode): OddsTables {
  // The one eager build (F49). Also warms the 24 round distributions it reads.
  battleTable(STANDARD_AUGMENT);

  const balanced = new Map<string, BattleDist>();

  function bbDist(a: number, d: number, aug: DiceAugment, stopUntil: number | undefined): BattleDist {
    const key = `${augmentKey(aug)}|${a}|${d}|${stopUntil ?? ""}`;
    const hit = balanced.get(key);
    if (hit !== undefined) return hit;
    const built = balance(outcomeDist(a, d, aug, stopUntil));
    balanced.set(key, built);
    return built;
  }

  const dist = (a: number, d: number, aug: DiceAugment, stopUntil?: number): BattleDist =>
    mode === "balancedBlitz" ? bbDist(a, d, aug, stopUntil) : outcomeDist(a, d, aug, stopUntil);

  const winChance = (a: number, d: number, aug: DiceAugment = STANDARD_AUGMENT): number => {
    if (a <= 0) return d === 0 ? 1 : 0;
    if (d <= 0) return 1;
    // Balanced Blitz has no closed form at any size: the reshape is a function of the whole
    // outcome distribution, so above the table it is still the exact pipeline, memoised.
    return mode === "balancedBlitz" ? bbDist(a, d, aug, undefined).winChance : trueRandomWinChance(a, d, aug);
  };

  return {
    mode,
    winChance,
    outcome: (a, d, aug = STANDARD_AUGMENT, stopUntil) => dist(a, d, aug, stopUntil),
    expectedAttackerLoss: (a, d, aug = STANDARD_AUGMENT) => expectedAttackerLossOf(dist(a, d, aug)),
    /** R57: `certainWin` is the single biggest strategic lever Balanced Blitz creates. */
    certainWin: (a, d, aug = STANDARD_AUGMENT) => winChance(a, d, aug) >= 1 - CERTAIN_EPS,
  };
}
