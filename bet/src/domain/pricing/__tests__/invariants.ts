/**
 * The shared property-based invariant suite (SPEC §6.5 invariants 1, 2, 3,
 * 5, 7 — see the module doc comment on each `it()` below for which). Every
 * concrete engine's test file calls `runPricingInvariants` once, so a bug
 * in any strategy (including a future one) is caught by the same tests
 * every other strategy already passes (research §6.3, DECISIONS "one
 * PricingEngine interface").
 *
 * Invariant 4 (LMSR-specific bounded loss, `b·ln(n)`) and invariant 6
 * (settle fires exactly once) are NOT part of this generic suite: #4 only
 * has meaning for LMSR (parimutuel/fixed-odds are peer-funded — the pot
 * can never exceed what was staked into it, there is no operator subsidy
 * to bound) and is tested directly in `lmsr.test.ts`; #6 is an
 * application-layer concern (Task 3/7's market status machine — the
 * engine itself has no notion of "have I already settled").
 *
 * `arbState` MUST generate FRESH markets: a zeroed ledger (`q`/`escrow`/
 * `pools` all 0) with whatever randomized config the strategy needs (`b`,
 * `openingPrices`, `rakeBps`, the outcome-id set). Freshness matters
 * because two of the invariants below (#3, #5) simulate real trades ON TOP
 * of `arbState`'s state and need to know the true total collected so far
 * — that's only knowable if nothing was already collected before the
 * property started.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { add, compare, toDecimal, zero, type Credits } from "@/domain/money";
import type { PricingEngine } from "../engine";
import type { MarketState, Order, Position } from "../types";

export type InvariantOpts = {
  /** Set false for engines that reject `side: "sell"` outright
   * (parimutuel — research §4.3, "no ability to exit early"). Skips the
   * round-trip invariant, which is meaningless without a sell leg. */
  supportsSell?: boolean;
  /** The maximum operator SUBSIDY (decimal credits — see `lmsr.ts`'s
   * module doc comment for the unit) the engine could owe beyond what was
   * actually collected in trade costs, given `state`'s config. SPEC §6.5
   * invariant 5 is "payouts never exceed collected cost basis + subsidy" —
   * for peer-funded engines (parimutuel, fixed-odds) the subsidy is always
   * 0 (there is no house backing them, only staked money), which is the
   * default. LMSR's is `b·ln(n)` (research §2.4) and is supplied by
   * `lmsr.test.ts`. */
  maxSubsidy?: (state: MarketState) => number;
};

function outcomesOf(engine: PricingEngine, state: MarketState): string[] {
  return Object.keys(engine.currentPrices(state));
}

/** Applies a best-effort sequence of buy trades (skipping any that throw —
 * e.g. an unlucky bisection edge case near a market's numeric limits) and
 * returns the resulting state, total collected, and a synthetic
 * `Position[]` ledger spread across 3 synthetic users. */
function simulateTrades(
  engine: PricingEngine,
  initialState: MarketState,
  outcomes: string[],
  tradeShares: number[],
): { state: MarketState; collected: Credits; positions: Position[] } {
  let state = initialState;
  let collected: Credits = zero();
  const positions = new Map<string, Position>();

  tradeShares.forEach((shares, i) => {
    const outcomeId = outcomes[i % outcomes.length];
    const userId = `user-${i % 3}`;
    const order: Order = { outcomeId, side: "buy", shares };
    let result;
    try {
      result = engine.execute(state, order);
    } catch {
      return;
    }
    state = result.newState;
    collected = add(collected, result.quote.cost);
    const key = `${userId}:${outcomeId}`;
    const prior = positions.get(key);
    positions.set(key, {
      userId,
      outcomeId,
      shares: (prior?.shares ?? 0) + result.quote.shares,
      costBasis: add(prior?.costBasis ?? zero(), result.quote.cost),
    });
  });

  return { state, collected, positions: Array.from(positions.values()) };
}

const arbTradeShares = fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 4 });

export function runPricingInvariants(
  name: string,
  engine: PricingEngine,
  arbState: fc.Arbitrary<MarketState>,
  opts: InvariantOpts = {},
): void {
  const supportsSell = opts.supportsSell ?? true;
  const maxSubsidy = opts.maxSubsidy ?? (() => 0);

  describe(`shared pricing invariants: ${name}`, () => {
    it("invariant 1: currentPrices sums to 1 (±1e-9), before and after trades", () => {
      fc.assert(
        fc.property(arbState, arbTradeShares, (initialState, tradeShares) => {
          const outcomes = outcomesOf(engine, initialState);
          const { state } = simulateTrades(engine, initialState, outcomes, tradeShares);
          for (const s of [initialState, state]) {
            const prices = engine.currentPrices(s);
            const sum = Object.values(prices).reduce((a, b) => a + b, 0);
            expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
          }
        }),
      );
    });

    it("invariant 7: currentPrices and quote are pure and deterministic", () => {
      fc.assert(
        fc.property(arbState, fc.integer({ min: 1, max: 40 }), (state, shares) => {
          const outcomes = outcomesOf(engine, state);
          expect(engine.currentPrices(state)).toEqual(engine.currentPrices(state));

          const order: Order = { outcomeId: outcomes[0], side: "buy", shares };
          const q1 = engine.quote(state, order);
          const q2 = engine.quote(state, order);
          expect(q1).toEqual(q2);
          // quote() must not have mutated state as a side effect.
          expect(outcomesOf(engine, state)).toEqual(outcomes);
        }),
      );
    });

    it("invariant 2: cost is monotonic, and average price is non-decreasing, in share quantity", () => {
      fc.assert(
        fc.property(
          arbState,
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 21, max: 60 }),
          (state, smaller, larger) => {
            const outcomes = outcomesOf(engine, state);
            const outcomeId = outcomes[0];
            const small = engine.quote(state, { outcomeId, side: "buy", shares: smaller });
            const big = engine.quote(state, { outcomeId, side: "buy", shares: larger });
            expect(compare(big.cost, small.cost)).toBeGreaterThanOrEqual(0);
            expect(big.avgPrice).toBeGreaterThanOrEqual(small.avgPrice - 1e-9);
          },
        ),
      );
    });

    if (supportsSell) {
      it("invariant 3: a buy-then-sell round trip never profits the trader", () => {
        fc.assert(
          fc.property(arbState, fc.integer({ min: 1, max: 30 }), (state, shares) => {
            const outcomes = outcomesOf(engine, state);
            const outcomeId = outcomes[0];
            const buy = engine.execute(state, { outcomeId, side: "buy", shares });
            let sell;
            try {
              sell = engine.execute(buy.newState, { outcomeId, side: "sell", shares });
            } catch {
              return; // not what this invariant is targeting
            }
            // `Quote.cost` is documented (types.ts) as ALWAYS positive: what
            // was paid for a buy, what was received for a sell. Checking
            // this directly — not just the round-trip inequality below —
            // matters because a pure round trip that returns to the exact
            // starting state can cancel out a uniform sign error in the
            // underlying cost function (buy and sell costs end up equal and
            // "break even", passing the round-trip check even though both
            // legs are individually nonsensical). This was found by hand
            // (see the LMSR sign-flip verification in task-2-report.md) and
            // is why both checks live here together.
            expect(compare(buy.quote.cost, zero())).toBeGreaterThanOrEqual(0);
            expect(compare(sell.quote.cost, zero())).toBeGreaterThanOrEqual(0);
            // buy.quote.cost = paid; sell.quote.cost = proceeds. Proceeds
            // must never exceed cost.
            expect(compare(sell.quote.cost, buy.quote.cost)).toBeLessThanOrEqual(0);
          }),
        );
      });
    }

    it("invariant 5: settlement never pays out more than collected cost basis + subsidy", () => {
      fc.assert(
        fc.property(arbState, arbTradeShares, (initialState, tradeShares) => {
          const outcomes = outcomesOf(engine, initialState);
          const { state, collected, positions } = simulateTrades(
            engine,
            initialState,
            outcomes,
            tradeShares,
          );
          const ceiling = toDecimal(collected) + maxSubsidy(initialState);
          for (const winningOutcomeId of outcomes) {
            const payouts = engine.settle(state, winningOutcomeId, positions);
            const totalPaid = payouts.reduce((sum, p) => add(sum, p.amount), zero());
            expect(toDecimal(totalPaid)).toBeLessThanOrEqual(ceiling + 1e-6);
          }
        }),
      );
    });
  });
}
