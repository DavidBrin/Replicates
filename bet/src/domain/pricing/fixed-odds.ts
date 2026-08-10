/**
 * Fixed-odds / "set your own odds" pricing engine (SPEC §6.2, research
 * §5). The creator fixes opening probabilities at market creation; unlike
 * LMSR, a trade never moves the price — every buyer/seller of a given
 * outcome always transacts at that outcome's fixed `openingPrices` entry.
 *
 * ## Peer-to-peer matching rule
 *
 * There is no order book and no bilateral "A proposes, B accepts" pairing
 * at trade time (research §5.1 describes the two-person primitive; this
 * engine generalizes it to an arbitrary number of stakers per outcome, the
 * way a group bet actually works). Instead:
 *
 * - Every buy simply escrows `shares × openingPrices[outcome]` into that
 *   outcome's pooled `escrow` bucket. Nobody is matched against anybody
 *   else at trade time — the pairing happens lazily, at settlement.
 * - At settlement, the total money collected across ALL outcomes
 *   (`Σ escrow`) is what's available to pay the winning side. Each winning
 *   share is owed exactly 1 credit (par value, same convention as LMSR).
 *   If the total collected covers that in full (the common case, since
 *   `openingPrices` are supposed to approximate true odds and buys on both
 *   sides roughly balance), winners are paid par and whatever is left over
 *   — money staked on the LOSING side beyond what was needed to cover the
 *   winners — is returned to the losing stakers, split proportionally to
 *   their stake (this is the "unmatched remainder": it was never actually
 *   at risk against a real counterparty, because nobody on the winning
 *   side needed it). If the total collected falls short (an edge case —
 *   it means the losing side was thin relative to the winning side's
 *   claims), winners are instead paid pro-rata of what's actually in the
 *   pot (a haircut on the par value) and there is no remainder.
 * - Both branches use the largest-remainder method so settlement never
 *   loses or invents a cent (SPEC §6.5 invariant 5).
 *
 * This keeps the "creator sets fixed odds, stakes are peer money" spirit
 * of a friend bet while working for any number of participants, without
 * requiring an explicit bilateral matching engine.
 */

import { add, credits, sub, toDecimal, zero, type Credits } from "@/domain/money";
import { BasePricingEngine, PricingError, ZERO, distributeLargestRemainder, toCreditsAtBoundary } from "./engine";
import type { MarketState, Order, OutcomeId, Payout, Position, Quote } from "./types";

type FixedOddsState = Extract<MarketState, { kind: "fixedOdds" }>;

function assertFixedOdds(state: MarketState): asserts state is FixedOddsState {
  if (state.kind !== "fixedOdds") {
    throw new PricingError("internal", "FixedOddsEngine given non-fixedOdds state");
  }
}

function priceOf(state: FixedOddsState, outcomeId: OutcomeId): number {
  const price = state.openingPrices[outcomeId];
  if (price === undefined) {
    throw new PricingError("validation", `Unknown outcome "${outcomeId}"`);
  }
  if (!(price > 0) || price >= 1) {
    throw new PricingError(
      "internal",
      `Fixed-odds outcome "${outcomeId}" has an invalid opening price ${price}`,
    );
  }
  return price;
}

function priceOrder(state: FixedOddsState, order: Order): { quote: Quote } {
  const price = priceOf(state, order.outcomeId);

  const shares =
    order.shares !== undefined ? order.shares : toDecimal(order.budget!) / price;

  const amountDecimal = shares * price;
  const cost = toCreditsAtBoundary(amountDecimal, order.side === "buy" ? "up" : "down");

  if (order.side === "sell") {
    const currentEscrow = state.escrow[order.outcomeId] ?? zero();
    if (cost > currentEscrow) {
      throw new PricingError(
        "conflict",
        `Cannot unwind ${shares} shares on "${order.outcomeId}": only ${currentEscrow} credits remain escrowed`,
      );
    }
  }

  return { quote: { shares, cost, avgPrice: price, priceImpact: 0, fee: ZERO } };
}

export class FixedOddsEngine extends BasePricingEngine {
  protected pricesUnchecked(state: MarketState): Record<OutcomeId, number> {
    assertFixedOdds(state);
    return { ...state.openingPrices };
  }

  protected quoteUnchecked(state: MarketState, order: Order): Quote {
    assertFixedOdds(state);
    return priceOrder(state, order).quote;
  }

  protected executeUnchecked(
    state: MarketState,
    order: Order,
  ): { newState: MarketState; quote: Quote } {
    assertFixedOdds(state);
    const { quote } = priceOrder(state, order);
    const currentEscrow = state.escrow[order.outcomeId] ?? zero();
    const newEscrow: Record<OutcomeId, Credits> = {
      ...state.escrow,
      [order.outcomeId]:
        order.side === "buy" ? add(currentEscrow, quote.cost) : sub(currentEscrow, quote.cost),
    };
    return { newState: { ...state, escrow: newEscrow }, quote };
  }

  settle(state: MarketState, winningOutcomeId: OutcomeId, positions: Position[]): Payout[] {
    assertFixedOdds(state);

    const totalCollectedCents = Object.values(state.escrow).reduce((sum, e) => add(sum, e), zero());

    const winners = positions.filter((p) => p.outcomeId === winningOutcomeId && p.shares > 0);
    const losers = positions.filter((p) => p.outcomeId !== winningOutcomeId && p.costBasis > 0);

    const totalOwedCents = Math.floor(winners.reduce((sum, p) => sum + p.shares, 0) * 100);

    const byUser = new Map<string, Credits>();
    const credit = (userId: string, amountCents: number) => {
      if (amountCents <= 0) return;
      const prior = byUser.get(userId) ?? zero();
      byUser.set(userId, add(prior, credits(amountCents)));
    };

    if (totalCollectedCents >= totalOwedCents) {
      // Common case: the pot covers every winner at full par value.
      const winnerCents = distributeLargestRemainder(
        totalOwedCents,
        winners.map((p) => p.shares),
      );
      winners.forEach((p, i) => credit(p.userId, winnerCents[i]));

      const remainderCents = totalCollectedCents - totalOwedCents;
      if (remainderCents > 0 && losers.length > 0) {
        const loserCents = distributeLargestRemainder(
          remainderCents,
          losers.map((p) => p.costBasis),
        );
        losers.forEach((p, i) => credit(p.userId, loserCents[i]));
      }
    } else {
      // Shortfall (thin losing side): winners split the pot pro-rata of
      // their claim; no remainder exists to return to losers.
      const winnerCents = distributeLargestRemainder(
        totalCollectedCents,
        winners.map((p) => p.shares),
      );
      winners.forEach((p, i) => credit(p.userId, winnerCents[i]));
    }

    return Array.from(byUser.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([userId, amount]) => ({ userId, amount }));
  }
}

export const fixedOddsEngine = new FixedOddsEngine();
