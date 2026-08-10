/**
 * Parimutuel pooling engine (SPEC §6.2, research §4). No live market
 * maker: stakes pool per outcome, and — unlike LMSR/fixed-odds — there is
 * no exit before resolution (research §4.3: "no ability to exit early").
 * `currentPrices` is the pool-share implied probability, useful for
 * display but not a locked execution price the way LMSR's is.
 */

import { add, credits, toDecimal, zero, type Credits } from "@/domain/money";
import { BasePricingEngine, PricingError, ZERO, distributeLargestRemainder, toCreditsAtBoundary } from "./engine";
import type { MarketState, Order, OutcomeId, Payout, Position, Quote } from "./types";

type ParimutuelState = Extract<MarketState, { kind: "parimutuel" }>;

function assertParimutuel(state: MarketState): asserts state is ParimutuelState {
  if (state.kind !== "parimutuel") {
    throw new PricingError("internal", "ParimutuelEngine given non-parimutuel state");
  }
}

function sumCredits(values: Credits[]): Credits {
  return values.reduce((sum, v) => add(sum, v), zero());
}

function poolShares(pools: Record<OutcomeId, Credits>): Record<OutcomeId, number> {
  const outcomes = Object.keys(pools);
  const total = sumCredits(outcomes.map((o) => pools[o]));
  if (total <= 0) {
    const uniform = outcomes.length > 0 ? 1 / outcomes.length : 0;
    return Object.fromEntries(outcomes.map((o) => [o, uniform]));
  }
  return Object.fromEntries(outcomes.map((o) => [o, pools[o] / total]));
}

export class ParimutuelEngine extends BasePricingEngine {
  protected pricesUnchecked(state: MarketState): Record<OutcomeId, number> {
    assertParimutuel(state);
    return poolShares(state.pools);
  }

  protected quoteUnchecked(state: MarketState, order: Order): Quote {
    assertParimutuel(state);
    if (order.side === "sell") {
      throw new PricingError(
        "validation",
        "Parimutuel markets do not support selling — a stake cannot be withdrawn once placed",
      );
    }
    if (state.pools[order.outcomeId] === undefined) {
      throw new PricingError("validation", `Unknown outcome "${order.outcomeId}"`);
    }

    const pricesBefore = poolShares(state.pools);

    // Cost is the stake, 1:1 with shares (SPEC §6.2): a "share" here is a
    // unit of stake, not a probability-weighted contract like LMSR's.
    const shares = order.shares !== undefined ? order.shares : toDecimal(order.budget!);
    const cost = toCreditsAtBoundary(shares, "up");

    const newPools = { ...state.pools, [order.outcomeId]: add(state.pools[order.outcomeId], cost) };
    const pricesAfter = poolShares(newPools);

    const before = pricesBefore[order.outcomeId];
    const priceImpact = before > 0 ? (pricesAfter[order.outcomeId] - before) / before : 0;
    const avgPrice = shares > 0 ? toDecimal(cost) / shares : 1;

    return { shares, cost, avgPrice, priceImpact, fee: ZERO };
  }

  protected executeUnchecked(
    state: MarketState,
    order: Order,
  ): { newState: MarketState; quote: Quote } {
    assertParimutuel(state);
    const quote = this.quoteUnchecked(state, order);
    const newPools: Record<OutcomeId, Credits> = {
      ...state.pools,
      [order.outcomeId]: add(state.pools[order.outcomeId], quote.cost),
    };
    return { newState: { ...state, pools: newPools }, quote };
  }

  /**
   * `payout = stake / winningPool × (totalPool × (1 − rake))`, distributed
   * with the largest-remainder method so no cent is lost or invented among
   * the winners (the `Σ escrow` conservation invariant, SPEC §6.5 #5).
   *
   * ## The rake is BURNED, not collected (final-review minor #6)
   *
   * `Σ payouts = netPool = floor(totalPool × (1 − rakeBps/10000))`. The
   * difference `totalPool − netPool` — the rake, plus the residual cent
   * that `floor` shaves — is credited to **nobody**. There is no house
   * account, no group treasury and no `Payout` row for it: those credits
   * are simply destroyed, and the app's total credit supply shrinks by that
   * amount every time a raked parimutuel market resolves.
   *
   * This is inert today and deliberately left that way. Every seeded and
   * wizard-created parimutuel market has `rakeBps = 0`, so `netPool ===
   * totalPool` and nothing is burned; there is no UI, API field or seed
   * value that sets a non-zero rake. Bet is play-money (D1/G10) with no
   * revenue model, so inventing a house account to receive a fee nobody
   * charges would be building a feature on speculation.
   *
   * **If a non-zero `rakeBps` is ever introduced, this is a bug, not a
   * design.** The fix is to decide who receives the rake (a house user, a
   * group balance, or a redistribution to all stakers) and emit a `Payout`
   * for it here, so `Σ payouts === totalPool` holds unconditionally. Noted
   * in the README's "Known gaps" as well, so it can't be lost.
   */
  settle(state: MarketState, winningOutcomeId: OutcomeId, positions: Position[]): Payout[] {
    assertParimutuel(state);

    const totalPoolCents = sumCredits(Object.values(state.pools));
    const rake = state.rakeBps / 10000;
    const netPoolCents = Math.floor(totalPoolCents * (1 - rake));

    const winners = positions.filter((p) => p.outcomeId === winningOutcomeId && p.costBasis > 0);

    // NOBODY BACKED THE WINNER. Splitting the pool "among the winners"
    // then distributes it among nobody, and the entire escrow — every
    // loser's stake, real credits that were really debited — simply
    // vanishes, breaking the `Σ escrow` conservation invariant (SPEC §6.5
    // #5) in the one direction that costs players money. A pool with no
    // claimant was never won; it is refunded pro-rata to whoever paid in,
    // rake included (there is no winning side to take a cut from), still
    // via largest-remainder so not a cent is lost or invented.
    const claimants =
      winners.length > 0 ? winners : positions.filter((p) => p.costBasis > 0);
    const distributable = winners.length > 0 ? netPoolCents : totalPoolCents;

    const winnerCents = distributeLargestRemainder(
      distributable,
      claimants.map((p) => p.costBasis),
    );

    const byUser = new Map<string, Credits>();
    claimants.forEach((p, i) => {
      if (winnerCents[i] <= 0) return;
      const prior = byUser.get(p.userId) ?? zero();
      byUser.set(p.userId, add(prior, credits(winnerCents[i])));
    });

    return Array.from(byUser.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([userId, amount]) => ({ userId, amount }));
  }
}

export const parimutuelEngine = new ParimutuelEngine();
