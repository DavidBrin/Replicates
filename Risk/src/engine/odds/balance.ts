/**
 * Balanced Blitz — the four-stage reshape (R49–R56, D23, D24).
 *
 * Written from the behavioural specification in SPEC §3.6 and `research/05-bots-and-ai.md` §5, and
 * from nothing else: SMG's `risk-dice` is licensed for internal evaluation only and is never read,
 * copied or vendored here (R60). The four constants and the staged algorithm are facts about the
 * game's behaviour; the C# text is theirs.
 *
 * Stage order is load-bearing (R54). A power-only implementation is visibly wrong: at `A = 49`
 * against `D = 50` stage 2 alone gives 75.7% where the full pipeline gives 82.15%.
 *
 * ## The stage-3 concatenation, as pinned by the bit-exact oracle (R52, F46)
 *
 * ```
 * combined = [ attackLoss[0], …, attackLoss[A−1],        // attacker conquers, having lost i
 *              defendLoss[D−1], …, defendLoss[0] ]       // defender holds, having lost j
 * ```
 *
 * — length `A + D`; index 0 is **most favourable to the attacker** and the last index most
 * favourable to the defender. The **defender half is reversed** (`defendLoss[D−1]`, the defender
 * barely surviving, is the defender outcome closest to an attacker win) and the **two aggregate
 * cells are excluded** (`attackLoss[A]` and `defendLoss[D]` are totals, not outcomes; shaving them
 * would double-count mass).
 *
 * This is the ordering SPEC §3.6 describes in prose, and it is the one that reproduces T4's digits:
 * `0.0100282888709122` for 30 v 15 at a capital, `49` as the fewest attackers for ≥80% against 50,
 * and `20 v 15` exactly 1. No alternative ordering was needed. Recorded here because R52 made S2's
 * acceptance the oracle rather than the paragraph.
 *
 * Two details that the digits do pin, and which are easy to get subtly wrong:
 *
 * 1. **Stage 3 does not renormalise the combined array in place.** The post-shave win chance is
 *    taken as `lowSum / (lowSum + highSum)` from the *unnormalised* sums, and stage 4's per-side
 *    renormalisation supplies the only normalisation there is. Dividing every cell by the total
 *    first and then re-summing the attacker half costs an ulp, which is the difference between
 *    `20 v 15` reading `0.9999999999999999` and reading **exactly 1** — and R55 says exactly 1.
 * 2. **Stage 4 renormalises each side separately to the win chance stage 3 set** (R53), so it
 *    cannot move the overall win chance, nor make an existing outcome impossible or certain.
 */

import { freeze } from "./dp";
import { BALANCE_CONFIG, type BalanceConfig, type BattleDist, type OutcomeDist, type StoppedOutcome } from "./types";

function sumRange(arr: Float64Array, from: number, to: number): number {
  let acc = 0;
  for (let i = from; i < to; i++) acc += arr[i] as number;
  return acc;
}

/** Scale `[from, to)` so it sums to `target`. A zero-sum range is left alone (nothing to scale). */
function scaleRange(arr: Float64Array, from: number, to: number, target: number): void {
  const total = sumRange(arr, from, to);
  if (total === 0) return;
  const factor = target / total;
  for (let i = from; i < to; i++) arr[i] = (arr[i] as number) * factor;
}

/** Shave `amount` of mass walking inward from `start` toward `end`, partially trimming the straddler. */
function shave(arr: Float64Array, start: number, end: number, step: number, amount: number): void {
  let remaining = amount;
  for (let i = start; i !== end; i += step) {
    if (remaining <= 0) return;
    const here = arr[i] as number;
    const take = here < remaining ? here : remaining;
    arr[i] = here - take;
    remaining -= take;
  }
}

function withStopped(dist: BattleDist, scale: number): readonly StoppedOutcome[] {
  if (scale === 1) return dist.stopped;
  return dist.stopped.map((s) => ({ ...s, p: s.p * scale }));
}

/**
 * Reshape a raw `OutcomeDist` into its Balanced Blitz form. Pure; `raw` is never mutated.
 *
 * With the Attack Limiter active the reshape runs on the distribution **conditioned on the battle
 * resolving** and the result is rescaled by `1 − unresolved`, so the limiter's own mass passes
 * through untouched and `winChance` stays the lower bound R48 says it is. Without a limiter
 * `unresolved` is 0 and this is exactly the validated four-stage pipeline.
 */
export function balance(raw: OutcomeDist, cfg: BalanceConfig = BALANCE_CONFIG): BattleDist {
  const a = raw.a;
  const d = raw.d;
  const stopped: readonly StoppedOutcome[] = (raw as BattleDist).stopped ?? [];
  const resolved = 1 - raw.unresolved;

  // Degenerate battles have nothing to reshape: there is no outcome array to shave.
  if (a === 0 || d === 0 || resolved <= 0) {
    return freeze(a, d, Float64Array.from(raw.attackLoss), Float64Array.from(raw.defendLoss),
      raw.unresolved, stopped, raw.winChance);
  }

  // Work on the resolved conditional distribution, so every stage sees a total of 1.
  const attackLoss = Float64Array.from(raw.attackLoss);
  const defendLoss = Float64Array.from(raw.defendLoss);
  if (resolved !== 1) {
    for (let i = 0; i <= a; i++) attackLoss[i] = (attackLoss[i] as number) / resolved;
    for (let j = 0; j <= d; j++) defendLoss[j] = (defendLoss[j] as number) / resolved;
  }
  let w = raw.winChance / resolved;

  // ---- Stage 1: ApplyWinChanceCutoff (0.05) ----------------------------------------------- R50
  // The losing side collapses onto its single "lost everything" entry; the winner renormalises.
  if (w <= cfg.winChanceCutoff) {
    attackLoss.fill(0);
    attackLoss[a] = 1; // the attacker's "lost everything" entry IS its loss aggregate
    scaleRange(defendLoss, 0, d, 1);
    defendLoss[d] = 0;
    w = 0;
  } else if (1 - w <= cfg.winChanceCutoff) {
    defendLoss.fill(0);
    defendLoss[d] = 1; // the defender's "lost everything" entry IS the attacker-wins aggregate
    scaleRange(attackLoss, 0, a, 1);
    attackLoss[a] = 0;
    w = 1;
  }

  // ---- Stage 2: ApplyWinChancePower (1.3) ------------------------------------------------- R51
  // w' = w^p / (w^p + (1−w)^p): the odds ratio raised to p. Fixed point at 0.5, monotone — which
  // is why the break-even does not move between dice modes (R56).
  if (w > 0 && w < 1) {
    const p = cfg.winChancePower;
    const up = w ** p;
    const down = (1 - w) ** p;
    const w2 = up / (up + down);
    scaleRange(attackLoss, 0, a, w2);
    attackLoss[a] = 1 - w2;
    scaleRange(defendLoss, 0, d, 1 - w2);
    defendLoss[d] = w2;
    w = w2;
  }

  // ---- Stage 3: ApplyOutcomeCutoff (0.10) ------------------------------------------------- R52
  const n = a + d;
  const combined = new Float64Array(n);
  for (let i = 0; i < a; i++) combined[i] = attackLoss[i] as number;
  for (let j = 0; j < d; j++) combined[a + j] = defendLoss[d - 1 - j] as number;

  shave(combined, 0, n, 1, cfg.outcomeCutoff);          // low tail: crushing wins
  shave(combined, n - 1, -1, -1, cfg.outcomeCutoff);    // high tail: catastrophic losses

  const lowSum = sumRange(combined, 0, a);
  const highSum = sumRange(combined, a, n);
  const total = lowSum + highSum;
  // Taken from the unnormalised sums on purpose — see the header note (1).
  const w3 = total === 0 ? w : lowSum / total;

  // ---- Stage 4: ApplyOutcomePower (1.8) --------------------------------------------------- R53
  const q = cfg.outcomePower;
  for (let i = 0; i < n; i++) {
    const v = combined[i] as number;
    if (v > 0) combined[i] = v ** q;
  }
  scaleRange(combined, 0, a, w3);
  scaleRange(combined, a, n, 1 - w3);

  // ---- back into the published shape -----------------------------------------------------------
  const outAttack = new Float64Array(a + 1);
  const outDefend = new Float64Array(d + 1);
  for (let i = 0; i < a; i++) outAttack[i] = (combined[i] as number) * resolved;
  for (let j = 0; j < d; j++) outDefend[d - 1 - j] = (combined[a + j] as number) * resolved;
  outAttack[a] = (1 - w3) * resolved;
  outDefend[d] = w3 * resolved;
  return freeze(a, d, outAttack, outDefend, raw.unresolved, withStopped(raw as BattleDist, 1), w3 * resolved);
}

/**
 * Stage 1 and 2 only. Exists so T4 can prove R54's claim that a power-only implementation is
 * visibly wrong — 75.7% at `A = 49` where the full pipeline gives 82.15%.
 */
export function balanceStage2Only(raw: OutcomeDist, cfg: BalanceConfig = BALANCE_CONFIG): number {
  const resolved = 1 - raw.unresolved;
  if (raw.a === 0 || raw.d === 0 || resolved <= 0) return raw.winChance;
  let w = raw.winChance / resolved;
  if (w <= cfg.winChanceCutoff) return 0;
  if (1 - w <= cfg.winChanceCutoff) return resolved;
  const p = cfg.winChancePower;
  const up = w ** p;
  const down = (1 - w) ** p;
  w = up / (up + down);
  return w * resolved;
}
