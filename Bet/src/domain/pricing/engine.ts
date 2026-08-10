/**
 * The `PricingEngine` interface (SPEC §6.1) plus `BasePricingEngine`, an
 * abstract template-method base every concrete strategy (`lmsr.ts`,
 * `fixed-odds.ts`, `parimutuel.ts`) extends.
 *
 * The point of the template-method split (`quote`/`execute`/`currentPrices`
 * are concrete and final in spirit; subclasses implement the `*Unchecked`
 * hooks) is that the shared guards — non-open market, malformed
 * shares/budget, non-positive quantities, `maxCost` slippage, price
 * normalization — run for EVERY strategy without each subclass having to
 * remember to call them. A subclass cannot skip a guard by mistake; it can
 * only implement the math.
 */

import { formatCreditsPrecise } from "@/domain/formatters";
import { compare, credits, isNegative, zero, type Credits } from "@/domain/money";
import type { ErrorCode } from "@/domain/result";
import type { MarketState, Order, OutcomeId, Payout, Position, Quote } from "./types";

/** Thrown by `BasePricingEngine`'s guards (and by concrete engines for
 * operations they don't support, e.g. selling on parimutuel). Carries an
 * `ErrorCode` from `@/domain/result` so callers (Task 7's route/service
 * layer) can map it onto the standard `{ error: { code, message } }`
 * envelope (G4) without re-deriving the mapping. */
export class PricingError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

export interface PricingEngine {
  /** Current displayable prices for every outcome. Always sums to 1
   * (±1e-9). Pure and deterministic (invariant 7). */
  currentPrices(state: MarketState): Record<OutcomeId, number>;

  /** Pure, side-effect-free: what WOULD this order cost, at current state?
   * Never mutates `state`. Throws `PricingError` if the order is invalid
   * (see `BasePricingEngine`'s guards) or would violate `maxCost`. */
  quote(state: MarketState, order: Order): Quote;

  /** Applies the order, returning the new state and the realized quote.
   * Callers must always re-derive from committed state before executing —
   * never trust a client-supplied quote as authoritative (G3/D4). */
  execute(state: MarketState, order: Order): { newState: MarketState; quote: Quote };

  /** Settlement: given the final state, the winning outcome, and every
   * position-holder's ledger entry, computes every payout. Pure — no side
   * effects, no I/O. The caller applies the payouts transactionally and is
   * responsible for ensuring this only ever runs once per market
   * (invariant 6 — enforced by Task 3/7's market status machine, not by
   * the engine, since the engine has no notion of "have I already been
   * called"). */
  settle(state: MarketState, winningOutcomeId: OutcomeId, positions: Position[]): Payout[];
}

export abstract class BasePricingEngine implements PricingEngine {
  quote(state: MarketState, order: Order): Quote {
    this.guardOrder(state, order);
    const quote = this.quoteUnchecked(state, order);
    this.guardMaxCost(order, quote);
    return quote;
  }

  execute(state: MarketState, order: Order): { newState: MarketState; quote: Quote } {
    this.guardOrder(state, order);
    const result = this.executeUnchecked(state, order);
    this.guardMaxCost(order, result.quote);
    return result;
  }

  currentPrices(state: MarketState): Record<OutcomeId, number> {
    const raw = this.pricesUnchecked(state);
    const total = Object.values(raw).reduce((sum, p) => sum + p, 0);
    if (total <= 0) return raw;
    const normalized: Record<OutcomeId, number> = {};
    for (const [outcomeId, p] of Object.entries(raw)) {
      normalized[outcomeId] = p / total;
    }
    return normalized;
  }

  abstract settle(state: MarketState, winningOutcomeId: OutcomeId, positions: Position[]): Payout[];

  /** Un-normalized prices for every outcome; `currentPrices` normalizes so
   * the sum is exactly 1 regardless of float drift accumulated by the
   * subclass's math. */
  protected abstract pricesUnchecked(state: MarketState): Record<OutcomeId, number>;
  protected abstract quoteUnchecked(state: MarketState, order: Order): Quote;
  protected abstract executeUnchecked(
    state: MarketState,
    order: Order,
  ): { newState: MarketState; quote: Quote };

  private guardOrder(state: MarketState, order: Order): void {
    if (state.status !== "open") {
      throw new PricingError(
        "market_closed",
        `Cannot trade on a market with status "${state.status}"`,
      );
    }

    const hasShares = order.shares !== undefined;
    const hasBudget = order.budget !== undefined;
    if (hasShares === hasBudget) {
      throw new PricingError(
        "validation",
        "Order must specify exactly one of `shares` or `budget`, not both or neither",
      );
    }

    if (hasShares && !(order.shares! > 0)) {
      throw new PricingError("validation", "`shares` must be a positive, finite number");
    }
    if (hasBudget && (isNegative(order.budget!) || order.budget! === 0)) {
      throw new PricingError("validation", "`budget` must be a positive number of credits");
    }
  }

  private guardMaxCost(order: Order, quote: Quote): void {
    if (order.maxCost === undefined) return;
    // Both messages reach a user verbatim (via `runEngine` -> the error
    // envelope -> a toast), so every money value goes through
    // `formatCreditsPrecise` — a raw `Credits` is integer CENTS and would
    // read 100x too large (G6).
    if (order.side === "buy" && compare(quote.cost, order.maxCost) > 0) {
      throw new PricingError(
        "validation",
        `Slippage exceeded: cost ${formatCreditsPrecise(quote.cost)} would exceed your maximum of ${formatCreditsPrecise(order.maxCost)} credits`,
      );
    }
    if (order.side === "sell" && compare(quote.cost, order.maxCost) < 0) {
      throw new PricingError(
        "validation",
        `Slippage exceeded: proceeds ${formatCreditsPrecise(quote.cost)} would fall short of your minimum of ${formatCreditsPrecise(order.maxCost)} credits`,
      );
    }
  }
}

/**
 * Converts a plain decimal-credits amount (the unit LMSR/parimutuel math
 * works in — see `types.ts`'s `MarketState` doc-comment) into `Credits`
 * (integer cents), rounding at the money boundary so it never favors the
 * trader: `"up"` for a buy's cost, `"down"` for a sell's proceeds. A tiny
 * epsilon nudges values that land essentially exactly on a cent boundary
 * (e.g. `1.7499999999999998` from float arithmetic that should be `1.75`)
 * so float noise never manufactures an extra cent of rounding.
 */
export function toCreditsAtBoundary(amountInCredits: number, direction: "up" | "down"): Credits {
  // A non-finite amount is ALWAYS an upstream bug (an out-of-domain
  // `Math.log`, a divide by zero, a `NaN` propagated through a cost
  // function) and must surface as an error. This used to end in
  // `credits(rounded || 0)`: the `|| 0` was written to normalize `-0`, but
  // `NaN || 0` is `0` too, so a `NaN` cost was silently laundered into a
  // perfectly valid-looking ZERO-COST quote. Money is never conjured from a
  // `NaN` — check first, and normalize `-0` with `Object.is`, which cannot
  // swallow anything else.
  if (!Number.isFinite(amountInCredits)) {
    throw new PricingError(
      "internal",
      `toCreditsAtBoundary: expected a finite amount of credits, got ${amountInCredits}`,
    );
  }
  const cents = amountInCredits * 100;
  const EPS = 1e-7;
  const rounded = direction === "up" ? Math.ceil(cents - EPS) : Math.floor(cents + EPS);
  return credits(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Splits `totalCents` (a non-negative integer number of cents) across
 * `weights` (non-negative, not necessarily integers or normalized)
 * proportionally, using the largest-remainder method, so the parts sum
 * EXACTLY to `totalCents` — no cent lost or conjured. Each weight's floor
 * share is assigned first; the leftover cents are handed out one at a
 * time, in descending order of fractional remainder (ties broken by
 * original index, for determinism), to the weights with the largest
 * fractional part.
 *
 * Used by `parimutuel.ts` (distributing the net pool to winners) and
 * `fixed-odds.ts` (distributing the unmatched escrow remainder to losing
 * stakers).
 */
export function distributeLargestRemainder(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || totalCents <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (w / weightSum) * totalCents);
  const floors = raw.map(Math.floor);
  const distributed = floors.reduce((a, b) => a + b, 0);
  const remainder = Math.round(totalCents - distributed);

  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const result = floors.slice();
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length].index] += 1;
  }
  return result;
}

/** `zero()`-Credits convenience re-export used across the engine files so
 * they don't each need a separate `@/domain/money` import just for this. */
export const ZERO: Credits = zero();
