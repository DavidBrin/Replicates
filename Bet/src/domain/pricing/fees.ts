/**
 * Kalshi's published per-trade fee formula (research §7.1,
 * research/kalshi.md), adopted as the "uncertainty-weighted" fee shape for
 * AMM (LMSR) markets: it charges the most when a trade is most uncertain
 * (`P × (1 − P)` peaks at `P = 0.5`) and shrinks to ~0 near a lock.
 *
 * `takerFee` / `makerFee` are pure formula functions — they do NOT know
 * about a market's `feeBps` toggle. That toggle lives on the `Market`
 * entity (Task 3), not on any of the three `MarketState` shapes in
 * `types.ts` (only `parimutuel.rakeBps` exists there, and that's a
 * settlement-time rake, not a per-trade fee — see `types.ts`'s doc
 * comment). "A market's `feeBps` of 0 disables fees; default for friend
 * markets is 0" (SPEC §6.3) is therefore the CALLER's responsibility: skip
 * calling `takerFee`/`makerFee` (or discard the result, reporting
 * `zero()`) when the market's fee is disabled. This module never applies
 * fees to a `Quote.cost` itself, either — see `types.ts`'s `Quote` doc
 * comment: "the caller adds the fee on top for buys and deducts it from
 * proceeds for sells."
 */

import { credits, type Credits } from "@/domain/money";

const TAKER_RATE_BPS = 700; // 7%
const MAKER_RATE_BPS = 175; // 1.75% — exactly 1/4 the taker rate

/**
 * The raw, unrounded Kalshi fee in decimal credits (the "dollars" unit —
 * see `lmsr.ts`'s module doc comment): `rate × C × P × (1 − P)`. Exposed
 * (rather than folded into `takerFee`/`makerFee`) so tests can reproduce
 * research/pricing-mechanisms.md §7.1's fee table at its documented
 * precision — Kalshi rounds to the nearest "centicent" ($0.0001), finer
 * than Bet's whole-cent `Credits` can represent, so the table's exact
 * numbers (e.g. `0.0175`) only round-trip through this pre-rounding
 * function, not through the `Credits`-returning ones below.
 */
export function rawFee(contracts: number, price: number, rateBps: number): number {
  const rate = rateBps / 10000;
  return rate * contracts * price * (1 - price);
}

/** Rounds a decimal-credits amount UP to the nearest whole cent — Bet's
 * `Credits` type has no sub-cent unit, so this is the app-level analogue
 * of Kalshi's "round up to the nearest centicent, in the house's favor"
 * rule (research §7.1, §2.10). A small epsilon absorbs float noise that
 * would otherwise nudge an exact cent value up to the next one. */
function ceilCents(amountInCredits: number): Credits {
  // Same trap `engine.ts`'s `toCreditsAtBoundary` carried: a bare `|| 0`
  // normalizes `-0` but ALSO swallows `NaN` into a silent zero fee. Reject
  // non-finite input outright and normalize `-0` with `Object.is`.
  if (!Number.isFinite(amountInCredits)) {
    throw new RangeError(`ceilCents: expected a finite amount of credits, got ${amountInCredits}`);
  }
  const EPS = 1e-7;
  const rounded = Math.ceil(amountInCredits * 100 - EPS);
  return credits(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * The Kalshi fee SHAPE charged at a caller-supplied rate:
 * `ceilCents(rateBps/10000 × C × P × (1 − P))`.
 *
 * This exists because a `Market`'s `feeBps` is a genuine rate, not a
 * boolean. `trading.ts` used to read it as an on/off toggle and then charge
 * the hard-coded 700bps taker rate regardless, so a market seeded
 * `feeBps: 200` displayed "Fee 2.00%" in the rules panel while actually
 * being charged at 7% — 3.5x what the number on screen implied. Threading
 * the market's own rate through here makes the displayed number the number
 * that is charged.
 *
 * `rateBps` must be finite and non-negative; a rate of 0 yields a zero fee.
 */
export function feeAtRate(contracts: number, price: number, rateBps: number): Credits {
  if (!Number.isFinite(rateBps) || rateBps < 0) {
    throw new RangeError(`feeAtRate: expected a finite, non-negative rateBps, got ${rateBps}`);
  }
  return ceilCents(rawFee(contracts, price, rateBps));
}

/** Kalshi's taker fee: `ceilCents(0.07 × C × P × (1 − P))`. `contracts` is
 * the number of contracts/shares traded (`C`); `price` is the probability
 * the contract traded at, in `[0, 1]` (`P`). */
export function takerFee(contracts: number, price: number): Credits {
  return feeAtRate(contracts, price, TAKER_RATE_BPS);
}

/** Kalshi's maker fee — exactly 1/4 the taker rate, rewarding resting
 * liquidity. Same rounding rule as `takerFee`. */
export function makerFee(contracts: number, price: number): Credits {
  return feeAtRate(contracts, price, MAKER_RATE_BPS);
}
