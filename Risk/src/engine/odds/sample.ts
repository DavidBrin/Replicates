/**
 * Quantised inverse-CDF sampling (R58, R59, D6, D7).
 *
 * One PRNG draw resolves a whole battle, however long it would have "lasted" — which is both SMG's
 * `OddsBasedBattle` method and the only method Balanced Blitz supports at all, because BB reshapes a
 * whole-battle distribution rather than individual dice.
 *
 * `Math.pow` appears twice in the BB pipeline and is **not** bit-identical across JS engines, so
 * every cumulative value is rounded to a fixed grid — `Math.round(x · 2^32)` — before it is compared
 * against the equally-quantised `u`. A last-bit difference in V8 vs JavaScriptCore then cannot move
 * the chosen outcome across a CDF boundary.
 *
 * ## The pinned walk
 *
 * Order (the same most-favourable-to-attacker → most-favourable-to-defender order stage 3 uses, with
 * the limiter's stopped outcomes last):
 *
 * ```
 * attackLoss[0], …, attackLoss[A−1],  defendLoss[D−1], …, defendLoss[0],  stopped[0], …, stopped[m−1]
 * ```
 *
 * Direction: **forward, from index 0**. Tie rule: the first index whose quantised cumulative
 * **strictly exceeds** the quantised `u` wins, i.e. `qu < qcum`. So `u = 0` always picks the first
 * entry carrying mass, and `u = 1 − ε` always picks the last. If floating-point drift leaves the
 * walk short of `u`, the last entry carrying mass is returned rather than falling off the end.
 *
 * ## One walk, not two
 *
 * The probability vector and the walk over it are **S1's** `sampledOutcomes` and `walkCdf` (R52,
 * R59), imported from `@/engine` — the permitted direction (`odds → engine`, §4.2). `rollAttack`
 * resolves a live battle through the very same two functions, so the two cannot drift apart; what
 * lives here is only the mapping from an index of that walk to a `SampledOutcome`, which is what
 * callers who want the losses rather than the index ask for. They did drift once: this file always
 * credited a resolved defender-hold with `a` attacker losses (which is what the DP's
 * `defendLoss[j < D]` means) while `rollAttack` credited a limiter's committed count (codex round 2,
 * findings 8 and 16b).
 */

import { CDF_QUANTUM, type BattleDist, type OutcomeDist, type SampledOutcome } from "./types";
import { sampledOutcomes, walkCdf } from "@/engine";

function quantise(x: number): number {
  return Math.round(x * CDF_QUANTUM);
}

/** The outcome each index of {@link sampledOutcomes}'s vector stands for, in the same order. */
function outcomes(dist: OutcomeDist): SampledOutcome[] {
  const a = dist.a;
  const d = dist.d;
  const out: SampledOutcome[] = [];
  for (let i = 0; i < a; i++) {
    out.push({ attackerLosses: i, defenderLosses: d, conquered: true, unresolved: false });
  }
  for (let j = d - 1; j >= 0; j--) {
    // The DP writes `defendLoss[j < d]` only on the transition that empties the
    // attacker's force, so a resolved hold always costs the attacker all of `a`.
    out.push({ attackerLosses: a, defenderLosses: j, conquered: false, unresolved: false });
  }
  for (const s of (dist as BattleDist).stopped ?? []) {
    out.push({
      attackerLosses: s.attackerLosses,
      defenderLosses: s.defenderLosses,
      conquered: false,
      unresolved: true,
    });
  }
  return out;
}

/**
 * Resolve a battle from one uniform `u ∈ [0, 1)`.
 *
 * A `d === 0` distribution (nothing to attack) conquers for free; an `a === 0` one loses outright.
 */
export function sampleOutcome(dist: OutcomeDist, u: number): SampledOutcome {
  if (!(u >= 0) || u >= 1) {
    // `nextFloat()` is [0,1) by contract; be total rather than throwing inside a resolver.
    u = u >= 1 ? 1 - Number.EPSILON / 2 : 0;
  }
  if (dist.d === 0) return { attackerLosses: 0, defenderLosses: 0, conquered: true, unresolved: false };
  if (dist.a === 0) return { attackerLosses: 0, defenderLosses: 0, conquered: false, unresolved: false };

  // S1's walk, verbatim: `walkCdf` returns the last index carrying mass rather
  // than falling off the end, and `-1` only for a vector with no mass at all.
  const at = walkCdf(sampledOutcomes(dist), u);
  if (at < 0) {
    return { attackerLosses: dist.a, defenderLosses: 0, conquered: false, unresolved: false };
  }
  return outcomes(dist)[at] as SampledOutcome;
}

/** The quantised cumulative grid, in walk order. Exported so T5 can assert the walk itself. */
export function cumulativeGrid(dist: OutcomeDist): readonly number[] {
  const out: number[] = [];
  let cumulative = 0;
  for (const p of sampledOutcomes(dist)) {
    cumulative += p;
    out.push(quantise(cumulative));
  }
  return out;
}
