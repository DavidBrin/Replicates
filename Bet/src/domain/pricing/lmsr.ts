/**
 * LMSR (Logarithmic Market Scoring Rule) — the default pricing engine
 * (SPEC §6.2, research/pricing-mechanisms.md §2). Implemented with the
 * log-sum-exp shift for numerical stability (§2.9).
 *
 * All money math here happens in **decimal credits** (the same unit as
 * `Credits.toDecimal`/`fromDecimal`, i.e. "dollars", not cents) — `b`, `q`,
 * and every intermediate cost are plain floats. Conversion to the integer-
 * cent `Credits` type happens exactly once, at the money boundary, via
 * `toCreditsAtBoundary` (rounding in the house's/pot's favor).
 */

import { add, toDecimal, zero, type Credits } from "@/domain/money";
import { BasePricingEngine, PricingError, ZERO, toCreditsAtBoundary } from "./engine";
import type { MarketState, Order, OutcomeId, Payout, Position, Quote } from "./types";

/**
 * LMSR cost function, numerically stable via log-sum-exp (research §2.9):
 * `C(q) = b · (m + ln(Σ exp(qᵢ/b − m)))` where `m = max(qᵢ/b)`.
 */
export function lmsrCost(q: number[], b: number): number {
  if (b <= 0) throw new RangeError(`lmsrCost: b must be > 0, got ${b}`);
  if (q.length === 0) throw new RangeError("lmsrCost: q must have at least one outcome");
  const scaled = q.map((qi) => qi / b);
  const m = Math.max(...scaled);
  const sumExp = scaled.reduce((acc, x) => acc + Math.exp(x - m), 0);
  return b * (m + Math.log(sumExp));
}

/**
 * LMSR marginal (instantaneous) prices — softmax of `q/b`. Sums to 1 up to
 * float error (the caller, `BasePricingEngine.currentPrices`, normalizes
 * away any residual drift).
 */
export function lmsrPrices(q: number[], b: number): number[] {
  if (b <= 0) throw new RangeError(`lmsrPrices: b must be > 0, got ${b}`);
  const scaled = q.map((qi) => qi / b);
  const m = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - m));
  const sumExp = exps.reduce((a, c) => a + c, 0);
  return exps.map((e) => e / sumExp);
}

/** Cost (in decimal credits) to move `outcomeIdx` by `deltaShares`
 * (positive = buy, negative = sell). Positive for a buy, negative for a
 * sell (the trader receives money). */
export function lmsrTradeCost(q: number[], outcomeIdx: number, deltaShares: number, b: number): number {
  const qNext = q.slice();
  qNext[outcomeIdx] += deltaShares;
  return lmsrCost(qNext, b) - lmsrCost(q, b);
}

/**
 * SPEC §6.2's default: `b = max(50, 12 × expectedParticipants)`, so a
 * 6-person group gets meaningful price movement without wild single-trade
 * swings. Exported for Task 7/11 (market creation) to reuse rather than
 * re-deriving the constant.
 */
export function defaultB(expectedParticipants: number): number {
  return Math.max(50, 12 * expectedParticipants);
}

/** The operator's worst-case loss over any trade sequence starting from
 * `q = 0`, for `n` outcomes (research §2.4): `b · ln(n)`. */
export function lmsrMaxLoss(b: number, outcomeCount: number): number {
  return b * Math.log(outcomeCount);
}

/**
 * Exact closed-form solution (2-outcome only, research §2.9) for the
 * `deltaShares` such that `lmsrTradeCost(q, idx, deltaShares, b) ===
 * targetCost`. Derived from `C(q)`'s definition, expressed via the current
 * price of `idx` (`p`) rather than raw `exp(q/b)` terms so it stays stable
 * for large `|q|/b`:
 *
 *   e^(Δ/b) = (e^(targetCost/b) − (1 − p)) / p
 *   Δ = b · ln( (e^(targetCost/b) − (1 − p)) / p )
 *
 * `targetCost` may be positive (buy) or negative (sell); the result's sign
 * matches (positive Δ = shares bought, negative Δ = shares sold).
 */
function lmsrDeltaForTargetCost(q: number[], idx: number, targetCost: number, b: number): number {
  const prices = lmsrPrices(q, b);
  const p = prices[idx];
  const x = targetCost / b;
  const arg = (Math.exp(x) - (1 - p)) / p;
  return b * Math.log(arg);
}

/**
 * Finds the largest `magnitude >= 0` such that `f(magnitude) <= budget`,
 * where `f` is 0 at 0 and strictly increasing (true of LMSR trade
 * magnitude by strict convexity of `C`). Brackets by doubling from 1
 * (David's ambiguity resolution), then bisects to a 1e-9 relative
 * tolerance, capped at 200 iterations. The loop invariant `f(lo) <= budget
 * <= f(hi)` is maintained throughout, so the returned `lo` NEVER overspends
 * the budget (it may undershoot by a negligible amount, which then rounds
 * further in the trader's favor... no, the house's favor, at the money
 * boundary anyway).
 */
function bisectForBudget(f: (magnitude: number) => number, budget: number): number {
  if (budget <= 0) return 0;
  let hi = 1;
  let guard = 0;
  while (f(hi) < budget && guard < 1000) {
    hi *= 2;
    guard++;
  }
  let lo = 0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) <= budget) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo <= 1e-9 * Math.max(1, hi)) break;
  }
  return lo;
}

/**
 * Given a money `budget` (decimal credits, always positive) and a `side`,
 * returns the share magnitude to trade: for a buy, the largest quantity
 * whose cost does not exceed `budget`; for a sell, the largest quantity
 * whose proceeds do not exceed `budget`. Exact closed form for 2-outcome
 * markets; bisection (bracket-then-bisect, see `bisectForBudget`) for
 * n-outcome markets, per David's ambiguity resolution.
 */
export function lmsrSharesForBudget(
  q: number[],
  idx: number,
  budget: number,
  b: number,
  side: "buy" | "sell",
): number {
  if (budget <= 0) return 0;
  if (q.length === 2) {
    const target = side === "sell" ? -budget : budget;
    const delta = lmsrDeltaForTargetCost(q, idx, target, b);
    return Math.abs(delta);
  }
  return bisectForBudget((magnitude) => {
    const delta = side === "sell" ? -magnitude : magnitude;
    const cost = lmsrTradeCost(q, idx, delta, b);
    return side === "sell" ? -cost : cost;
  }, budget);
}

function toArrays(state: Extract<MarketState, { kind: "lmsr" }>): { outcomes: OutcomeId[]; q: number[] } {
  const outcomes = Object.keys(state.q);
  return { outcomes, q: outcomes.map((o) => state.q[o]) };
}

function priceOrder(
  state: Extract<MarketState, { kind: "lmsr" }>,
  order: Order,
): { magnitude: number; deltaShares: number; quote: Quote; qAfter: number[]; outcomes: OutcomeId[]; idx: number } {
  const { outcomes, q } = toArrays(state);
  const idx = outcomes.indexOf(order.outcomeId);
  if (idx === -1) {
    throw new PricingError("validation", `Unknown outcome "${order.outcomeId}"`);
  }

  const pricesBefore = lmsrPrices(q, state.b);

  const magnitude =
    order.shares !== undefined
      ? order.shares
      : lmsrSharesForBudget(q, idx, toDecimal(order.budget!), state.b, order.side);

  const deltaShares = order.side === "sell" ? -magnitude : magnitude;
  const costDecimal = lmsrTradeCost(q, idx, deltaShares, state.b);

  const qAfter = q.slice();
  qAfter[idx] += deltaShares;
  const pricesAfter = lmsrPrices(qAfter, state.b);

  // Deliberately NOT `Math.abs(costDecimal)` here: for a buy, `costDecimal`
  // (= C(q') - C(q), q' > q) is *expected* to already be positive because
  // C is strictly increasing; for a sell it's expected to already be
  // negative (money flows out). Taking the absolute value would silently
  // paper over a sign error in `lmsrCost` — exactly the bug class the
  // round-trip-never-profits property test (invariants.ts) exists to
  // catch — by always reporting a positive `cost` regardless of whether
  // the underlying math got the sign right. A buy with a genuinely
  // negative `costDecimal` should surface as a negative `Quote.cost`
  // (caught by tests / callers), not be quietly rectified.
  const moneyOut = order.side === "buy" ? costDecimal : -costDecimal;

  const magnitudeForAvg = magnitude > 0 ? magnitude : 1; // avoid /0 on a zero-share edge case
  const avgPrice = moneyOut / magnitudeForAvg;
  const priceImpact =
    pricesBefore[idx] > 0 ? (pricesAfter[idx] - pricesBefore[idx]) / pricesBefore[idx] : 0;

  const cost = toCreditsAtBoundary(moneyOut, order.side === "buy" ? "up" : "down");

  return {
    magnitude,
    deltaShares,
    qAfter,
    outcomes,
    idx,
    quote: { shares: magnitude, cost, avgPrice, priceImpact, fee: ZERO },
  };
}

export class LmsrEngine extends BasePricingEngine {
  protected pricesUnchecked(state: MarketState): Record<OutcomeId, number> {
    if (state.kind !== "lmsr") throw new PricingError("internal", "LmsrEngine given non-lmsr state");
    const { outcomes, q } = toArrays(state);
    const prices = lmsrPrices(q, state.b);
    return Object.fromEntries(outcomes.map((o, i) => [o, prices[i]]));
  }

  protected quoteUnchecked(state: MarketState, order: Order): Quote {
    if (state.kind !== "lmsr") throw new PricingError("internal", "LmsrEngine given non-lmsr state");
    return priceOrder(state, order).quote;
  }

  protected executeUnchecked(
    state: MarketState,
    order: Order,
  ): { newState: MarketState; quote: Quote } {
    if (state.kind !== "lmsr") throw new PricingError("internal", "LmsrEngine given non-lmsr state");
    const { quote, qAfter, outcomes } = priceOrder(state, order);
    const newQ: Record<OutcomeId, number> = {};
    outcomes.forEach((o, i) => {
      newQ[o] = qAfter[i];
    });
    return { newState: { ...state, q: newQ }, quote };
  }

  /** Each share of the winning outcome pays 1 credit (par value); every
   * other share pays 0. Payouts are aggregated per user and rounded DOWN
   * at the money boundary (never favors the trader — G2); losing/zero
   * entries are omitted. */
  settle(state: MarketState, winningOutcomeId: OutcomeId, positions: Position[]): Payout[] {
    if (state.kind !== "lmsr") throw new PricingError("internal", "LmsrEngine given non-lmsr state");
    const byUser = new Map<string, Credits>();
    for (const position of positions) {
      if (position.outcomeId !== winningOutcomeId) continue;
      const amount = toCreditsAtBoundary(position.shares, "down");
      if (amount <= 0) continue;
      const prior = byUser.get(position.userId) ?? zero();
      byUser.set(position.userId, add(prior, amount));
    }
    return Array.from(byUser.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([userId, amount]) => ({ userId, amount }));
  }
}

export const lmsrEngine = new LmsrEngine();
