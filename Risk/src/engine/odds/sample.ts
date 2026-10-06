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
 */

import { CDF_QUANTUM, type BattleDist, type OutcomeDist, type SampledOutcome } from "./types";

function quantise(x: number): number {
  return Math.round(x * CDF_QUANTUM);
}

/** One entry of the pinned walk. */
interface Step {
  readonly p: number;
  readonly out: SampledOutcome;
}

function steps(dist: OutcomeDist): Step[] {
  const a = dist.a;
  const d = dist.d;
  const out: Step[] = [];
  for (let i = 0; i < a; i++) {
    out.push({
      p: dist.attackLoss[i] as number,
      out: { attackerLosses: i, defenderLosses: d, conquered: true, unresolved: false },
    });
  }
  for (let j = d - 1; j >= 0; j--) {
    out.push({
      p: dist.defendLoss[j] as number,
      out: { attackerLosses: a, defenderLosses: j, conquered: false, unresolved: false },
    });
  }
  for (const s of (dist as BattleDist).stopped ?? []) {
    out.push({
      p: s.p,
      out: {
        attackerLosses: s.attackerLosses,
        defenderLosses: s.defenderLosses,
        conquered: false,
        unresolved: true,
      },
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

  const walk = steps(dist);
  const qu = quantise(u);
  let cumulative = 0;
  let last: SampledOutcome | null = null;
  for (const step of walk) {
    if (step.p <= 0) continue;
    cumulative += step.p;
    last = step.out;
    if (qu < quantise(cumulative)) return step.out;
  }
  // Only reachable when rounding left the final cumulative at or below `qu`.
  return last ?? { attackerLosses: dist.a, defenderLosses: 0, conquered: false, unresolved: false };
}

/** The quantised cumulative grid, in walk order. Exported so T5 can assert the walk itself. */
export function cumulativeGrid(dist: OutcomeDist): readonly number[] {
  const out: number[] = [];
  let cumulative = 0;
  for (const step of steps(dist)) {
    cumulative += step.p;
    out.push(quantise(cumulative));
  }
  return out;
}
