/**
 * The fitted logistic tail (R43, F47, F48, D22).
 *
 * Beyond the 129×129 table, `W[A][D] ≈ σ((A − α·D) / (β·√(A + D)))` with `α = 0.860`, `β = 0.630`.
 * Over `A, D ∈ [129, 400]` the max abs error is 0.03205 (at `(333, 400)`) and the RMS error 0.0088.
 *
 * **The fit is for the STANDARD augment only** (F48). There is no fit for `+1` defender die, `+2`,
 * ties-to-attacker or any `attackDicePenalty`: a query above the table at a non-standard augment
 * extends the DP on demand instead (`dp.ts`'s `winChanceExact`).
 *
 * And never clamp indices independently (R43): `W[min(A,128)][min(D,128)]` reads 129 v 381 — a true
 * win chance of ≈0% — as 85.65%, because clamping destroys the troop *ratio*, which is the entire
 * signal.
 */

import { LOGISTIC_ALPHA, LOGISTIC_BETA } from "./types";

function sigmoid(x: number): number {
  // Branch on the sign so neither `exp` argument can overflow.
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/** The standard-augment extrapolation. `a` excludes the garrison (R38). */
export function logisticWinChance(a: number, d: number): number {
  if (a <= 0) return d === 0 ? 1 : 0;
  if (d <= 0) return 1;
  return sigmoid((a - LOGISTIC_ALPHA * d) / (LOGISTIC_BETA * Math.sqrt(a + d)));
}
