/**
 * The battle DP (R38–R45, D22, D26).
 *
 * `W[A][D]` — `A` **excludes** the army that must stay behind (R38) — plus the same recursion run
 * forward for the full `OutcomeDist` (R40) with the Attack Limiter's `stopUntil` truncation (R48).
 *
 * Solution order: `A` descending, `D` descending. Every transition moves from `(A, D)` to
 * `(A − k, D − (c − k))` with `k ≤ c` and `c ≥ 1`, so both indices are non-increasing and at least
 * one strictly decreases — which makes that loop order a valid topological order (R39) and the whole
 * thing **O(A·D)**, exact to floating point, no matrix inversion and no iteration to convergence.
 *
 * Caching (F49, D24): the standard augment's 129×129 `Float32Array` is built eagerly by `createOdds`
 * and shared; **every other augment is built on first use and memoised** on `augmentKey`. Nothing
 * here is ever serialised — a cache-warm difference must never become a replay divergence.
 */

import { assertSupported, roundDistribution, roundShape } from "./rounds";
import { augmentKey, TABLE_MAX, type BattleDist, type DiceAugment, type StoppedOutcome } from "./types";

/* ------------------------------------------------------------------ W[A][D] -- */

/**
 * The exact `W[A][D]` recursion in **double** precision, for `A, D ≤ max`.
 * Row-major, stride `max + 1`, so `W[A][D]` is `out[A * (max + 1) + D]`.
 */
export function buildTableExact(aug: DiceAugment, max: number): Float64Array {
  assertSupported(aug);
  const stride = max + 1;
  const w = new Float64Array(stride * stride);
  // W[A][0] = 1 for all A ≥ 0: the defender is already annihilated.
  for (let a = 0; a <= max; a++) w[a * stride] = 1;
  // W[0][D] = 0 for all D ≥ 1: the attacker is exhausted. (Float64Array is zero-filled.)
  for (let a = 1; a <= max; a++) {
    for (let d = 1; d <= max; d++) {
      const { attackDice, defendDice, pairs } = roundShape(a, d, aug);
      const r = roundDistribution(attackDice, defendDice, aug.favourDefenderOnDraw);
      let acc = 0;
      for (let k = 0; k <= pairs; k++) {
        const p = r[k] as number;
        if (p === 0) continue;
        const na = a - k;
        const nd = d - (pairs - k);
        // nd === 0 → conquered (W = 1); na === 0 → exhausted (W = 0); otherwise a solved cell.
        acc += nd === 0 ? p : na === 0 ? 0 : p * (w[na * stride + nd] as number);
      }
      w[a * stride + d] = acc;
    }
  }
  return w;
}

/** The shipped table: `Float32Array`, 129×129, 65 KiB (R43). Stride `TABLE_MAX + 1`. */
export function buildTable(aug: DiceAugment, max: number = TABLE_MAX): Float32Array {
  return Float32Array.from(buildTableExact(aug, max));
}

const TABLES = new Map<string, Float32Array>();

/** `(TABLE_MAX+1)^2`, row-major. Eager for the standard augment; lazy + memoised for every other. */
export function battleTable(aug: DiceAugment): Float32Array {
  const key = augmentKey(aug);
  const hit = TABLES.get(key);
  if (hit !== undefined) return hit;
  const built = buildTable(aug);
  TABLES.set(key, built);
  return built;
}

/** Drop every memoised table and distribution. Tests only — never called in play. */
export function resetCaches(): void {
  TABLES.clear();
  EXACT.clear();
  DISTS.clear();
}

const EXACT = new Map<string, number>();

/**
 * `W[A][D]` in full double precision at any size, memoised per `(augment, A, D)`.
 *
 * This is what T3's self-computed oracles (`W[5][2] = 0.8897887238900141`,
 * `W[300][300] = 0.9517567082839995`) are asserted against: the shipped table is a `Float32Array`
 * and cannot hold 16 significant digits. It is also the **above-table path for a non-standard
 * augment** (F48) — there is no fitted logistic for those, so the DP is extended on demand.
 */
export function winChanceExact(a: number, d: number, aug: DiceAugment): number {
  if (a <= 0) return d === 0 ? 1 : 0;
  if (d <= 0) return 1;
  const key = `${augmentKey(aug)}|${a}|${d}`;
  const hit = EXACT.get(key);
  if (hit !== undefined) return hit;
  const max = Math.max(a, d);
  const table = buildTableExact(aug, max);
  const stride = max + 1;
  const value = table[a * stride + d] as number;
  EXACT.set(key, value);
  return value;
}

/* ------------------------------------------------------------------ the forward distribution -- */

const DISTS = new Map<string, BattleDist>();

function distKey(a: number, d: number, aug: DiceAugment, stopUntil: number | undefined): string {
  return `${augmentKey(aug)}|${a}|${d}|${stopUntil ?? ""}`;
}

/**
 * R40/R48. The same recursion run forward:
 *
 * - `attackLoss[i < A]` = P(the attacker conquers having lost `i`)
 * - `attackLoss[A]`     = P(the attacker loses the battle)
 * - `defendLoss[j < D]` = P(the defender holds having lost `j`)
 * - `defendLoss[D]`     = P(the attacker wins)
 *
 * `stopUntil` is the Attack Limiter's floor **on the source territory's troop count**, so the
 * attacker's own remaining strength floors at `stopUntil − 1` (the garrison is excluded from `A`).
 * Mass that reaches the floor with the defender still alive lands in `unresolved`, and its
 * per-pair breakdown in `stopped` — so the published arrays stay lower bounds (R48) and
 * `sampleOutcome` can still name the actual losses.
 */
export function outcomeDist(a: number, d: number, aug: DiceAugment, stopUntil?: number): BattleDist {
  if (a < 0 || d < 0 || !Number.isInteger(a) || !Number.isInteger(d)) {
    throw new RangeError(`outcomeDist(${a}, ${d})`);
  }
  const key = distKey(a, d, aug, stopUntil);
  const hit = DISTS.get(key);
  if (hit !== undefined) return hit;
  const built = computeOutcomeDist(a, d, aug, stopUntil);
  DISTS.set(key, built);
  return built;
}

function computeOutcomeDist(a: number, d: number, aug: DiceAugment, stopUntil?: number): BattleDist {
  assertSupported(aug);
  const attackLoss = new Float64Array(a + 1);
  const defendLoss = new Float64Array(d + 1);
  const stoppedAt = new Map<string, StoppedOutcome>();
  let unresolved = 0;

  if (d === 0) {
    attackLoss[0] = 1;
    defendLoss[0] = 1;
    return freeze(a, d, attackLoss, defendLoss, 0, [], 1);
  }
  if (a === 0) {
    attackLoss[0] = 1; // a === 0 → attackLoss has length 1, and index 0 IS the aggregate.
    defendLoss[0] = 1;
    return freeze(a, d, attackLoss, defendLoss, 0, [], 0);
  }

  // The limiter floors the attacker's strength; `minA = 0` is fight-to-the-death.
  const minA = stopUntil === undefined ? 0 : Math.max(0, stopUntil - 1);

  const stride = d + 1;
  const mass = new Float64Array((a + 1) * stride);
  mass[a * stride + d] = 1;

  for (let i = a; i >= 1; i--) {
    for (let j = d; j >= 1; j--) {
      const m = mass[i * stride + j] as number;
      if (m === 0) continue;
      if (i <= minA) {
        unresolved += m;
        const al = a - i;
        const dl = d - j;
        const k = `${al}:${dl}`;
        const prior = stoppedAt.get(k);
        stoppedAt.set(k, { attackerLosses: al, defenderLosses: dl, p: (prior?.p ?? 0) + m });
        continue;
      }
      const { attackDice, defendDice, pairs } = roundShape(i, j, aug);
      const r = roundDistribution(attackDice, defendDice, aug.favourDefenderOnDraw);
      for (let k = 0; k <= pairs; k++) {
        const p = r[k] as number;
        if (p === 0) continue;
        const ni = i - k;
        const nj = j - (pairs - k);
        const w = m * p;
        if (nj === 0) attackLoss[a - ni] = (attackLoss[a - ni] as number) + w;
        else if (ni === 0) defendLoss[d - nj] = (defendLoss[d - nj] as number) + w;
        else mass[ni * stride + nj] = (mass[ni * stride + nj] as number) + w;
      }
    }
  }

  let win = 0;
  for (let i = 0; i < a; i++) win += attackLoss[i] as number;
  let lose = 0;
  for (let j = 0; j < d; j++) lose += defendLoss[j] as number;
  attackLoss[a] = lose;
  defendLoss[d] = win;

  const stopped = [...stoppedAt.values()].sort(
    (x, y) => x.attackerLosses - y.attackerLosses || x.defenderLosses - y.defenderLosses,
  );
  return freeze(a, d, attackLoss, defendLoss, unresolved, stopped, win);
}

export function freeze(
  a: number,
  d: number,
  attackLoss: Float64Array,
  defendLoss: Float64Array,
  unresolved: number,
  stopped: readonly StoppedOutcome[],
  winChance: number,
): BattleDist {
  return { a, d, attackLoss, defendLoss, unresolved, winChance, stopped };
}

/** R35/§4.13's `sunkCost`: `E[attacker armies lost]` over the whole battle, never a constant. */
export function expectedAttackerLossOf(dist: BattleDist): number {
  let acc = 0;
  for (let i = 0; i < dist.a; i++) acc += i * (dist.attackLoss[i] as number);
  // Losing the battle costs every committed army.
  acc += dist.a * (dist.attackLoss[dist.a] as number);
  for (const s of dist.stopped) acc += s.attackerLosses * s.p;
  return acc;
}
