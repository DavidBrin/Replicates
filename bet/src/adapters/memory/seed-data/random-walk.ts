/**
 * Pure random-walk math for Explore markets' 90-day synthetic price
 * history (docs/plan.md Task 5: "90 days of random-walk price history
 * (drift + noise, clamped to [0.02, 0.98])"). This is deliberately a
 * DIFFERENT generation method from the private markets' trade scripts:
 * Explore is a read-only public showcase with no real position-holders
 * (SPEC §3.6 — "No trading on Explore"), so there is no `Position` ledger
 * for a pricing engine's `execute()` to update, and nothing to keep
 * consistent across trades the way a friend market's balances/positions
 * must be. The random walk IS the authoritative source of an Explore
 * market's historical prices — nothing downstream overwrites it — so this
 * still honors "never write prices directly" in spirit: there is exactly
 * one place a price gets decided, and everything else (the final day's
 * `PricingConfig`, described in `explore-markets.ts`) is derived from it.
 *
 * Implemented over logits (softmax(logits) = probabilities) rather than
 * probabilities directly: a logit-space walk stays numerically well
 * behaved and the softmax guarantees the outputs sum to exactly 1 at every
 * step, for both the 2-outcome (binary/head-to-head) and n-outcome (multi)
 * cases, with the same code path.
 */

import { randNormal, type Prng } from "./prng";

function softmax(logits: readonly number[]): number[] {
  const m = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - m));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Clamps every probability into `[lo, hi]`, then renormalizes so the set
 * still sums to exactly 1. For 2-outcome markets this exactly matches
 * "clamped to [0.02, 0.98]"; for n>2 the post-renormalize values can drift
 * a hair outside `[lo, hi]` in extreme cases, which is fine here — the
 * hard requirement (asserted in tests) is that prices sum to 1, and the
 * clamp's job is only to keep the walk from ever collapsing to a
 * near-certain 0% or 100%. */
function clampAndRenormalize(probs: readonly number[], lo: number, hi: number): number[] {
  const clamped = probs.map((p) => Math.min(hi, Math.max(lo, p)));
  const sum = clamped.reduce((a, b) => a + b, 0);
  return clamped.map((p) => p / sum);
}

export interface RandomWalkStep {
  /** 0 = 89 days ago (the oldest point), `days - 1` = today (the newest). */
  index: number;
  probabilities: number[];
}

/**
 * Generates a `days`-long logit-space random walk with per-outcome drift
 * and shared volatility, starting from `startProbabilities`. Returns one
 * entry per day, oldest first. `rng` is consumed in a fixed, deterministic
 * order (2 draws per outcome per day, via `randNormal`), so two calls with
 * generators seeded identically produce identical output.
 */
export function generateRandomWalk(
  rng: Prng,
  startProbabilities: readonly number[],
  driftPerOutcome: readonly number[],
  volatility: number,
  days: number,
): RandomWalkStep[] {
  if (startProbabilities.length !== driftPerOutcome.length) {
    throw new RangeError("generateRandomWalk: startProbabilities and driftPerOutcome must be same length");
  }
  let logits = startProbabilities.map((p) => Math.log(p));
  const steps: RandomWalkStep[] = [];
  for (let day = 0; day < days; day++) {
    if (day > 0) {
      logits = logits.map((l, i) => l + driftPerOutcome[i]! + randNormal(rng) * volatility);
    }
    const probabilities = clampAndRenormalize(softmax(logits), 0.02, 0.98);
    steps.push({ index: day, probabilities });
  }
  return steps;
}

/** Reverse-engineers an LMSR `q` ledger (all outcomes starting from a
 * shared `b`) that reproduces `targetProbabilities` exactly via
 * `softmax(q/b)`: since `softmax` is shift-invariant, `q_i = b * ln(p_i)`
 * works for any `b > 0` — `lmsrPrices` recovers exactly `targetProbabilities`
 * back out. Used to give each Explore market a `PricingConfig` whose
 * `currentPrices()` matches the random walk's final day. */
export function reverseLmsrQ(targetProbabilities: readonly number[], b: number): number[] {
  return targetProbabilities.map((p) => b * Math.log(p));
}
