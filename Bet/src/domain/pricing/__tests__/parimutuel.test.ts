import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { credits, zero } from "@/domain/money";
import { parimutuelEngine } from "../parimutuel";
import type { MarketState, Position } from "../types";
import { runPricingInvariants } from "./invariants";

const OUTCOME_SETS: string[][] = [
  ["Yes", "No"],
  ["A", "B", "C"],
];

const arbParimutuelFreshState: fc.Arbitrary<MarketState> = fc
  .record({
    outcomes: fc.constantFrom(...OUTCOME_SETS),
    rakeBps: fc.integer({ min: 0, max: 2000 }), // 0%-20%
  })
  .map(
    ({ outcomes, rakeBps }): MarketState => ({
      kind: "parimutuel",
      status: "open",
      rakeBps,
      pools: Object.fromEntries(outcomes.map((o) => [o, zero()])),
    }),
  );

// Parimutuel structurally cannot sell (research §4.3 — no early exit), so
// the round-trip invariant is skipped: it would just assert "throwing is
// fine," which is already covered explicitly below.
runPricingInvariants("parimutuel", parimutuelEngine, arbParimutuelFreshState, { supportsSell: false });

describe("parimutuel — worked example (research/pricing-mechanisms.md §4.2)", () => {
  it("A=$500, B=$300, C=$200, rake=5%: net pool and implied probabilities", () => {
    const state: MarketState = {
      kind: "parimutuel",
      status: "resolving",
      rakeBps: 500,
      pools: { A: credits(50_000), B: credits(30_000), C: credits(20_000) },
    };

    const prices = parimutuelEngine.currentPrices(state);
    expect(prices.A).toBeCloseTo(0.5, 9);
    expect(prices.B).toBeCloseTo(0.3, 9);
    expect(prices.C).toBeCloseTo(0.2, 9);

    // A bettor staked $50 on A (one of several A backers making up the
    // $500 A pool) should receive $50 * 1.90 = $95 if A wins.
    const positions: Position[] = [
      { userId: "you", outcomeId: "A", shares: 0, costBasis: credits(5_000) },
      { userId: "rest-of-a", outcomeId: "A", shares: 0, costBasis: credits(45_000) },
      { userId: "b-bettor", outcomeId: "B", shares: 0, costBasis: credits(30_000) },
      { userId: "c-bettor", outcomeId: "C", shares: 0, costBasis: credits(20_000) },
    ];

    const payouts = parimutuelEngine.settle(state, "A", positions);
    const byUser = Object.fromEntries(payouts.map((p) => [p.userId, p.amount]));

    // net_pool = 1000 * 0.95 = $950; multiplier = 950/500 = 1.90x
    expect(byUser.you).toBe(credits(9_500)); // $50 * 1.90 = $95
    expect(byUser["rest-of-a"]).toBe(credits(85_500)); // $450 * 1.90 = $855
    expect(byUser["b-bettor"]).toBeUndefined(); // losing side gets $0
    expect(byUser["c-bettor"]).toBeUndefined();

    const total = payouts.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(95_000); // exactly net_pool ($950), no cent lost
  });
});

describe("parimutuel pricing", () => {
  it("cost = stake, shares = stake, 1:1", () => {
    const state: MarketState = {
      kind: "parimutuel",
      status: "open",
      rakeBps: 500,
      pools: { Yes: zero(), No: zero() },
    };
    const { quote } = parimutuelEngine.execute(state, {
      outcomeId: "Yes",
      side: "buy",
      budget: credits(2_500),
    });
    expect(quote.shares).toBeCloseTo(25, 9); // 2500 cents = 25 credits
    expect(quote.cost).toBe(credits(2_500));
  });

  it("implied probability starts uniform when pools are empty", () => {
    const state: MarketState = {
      kind: "parimutuel",
      status: "open",
      rakeBps: 0,
      pools: { A: zero(), B: zero(), C: zero() },
    };
    const prices = parimutuelEngine.currentPrices(state);
    expect(prices.A).toBeCloseTo(1 / 3, 9);
    expect(prices.B).toBeCloseTo(1 / 3, 9);
    expect(prices.C).toBeCloseTo(1 / 3, 9);
  });

  it("selling is rejected — no early exit", () => {
    const state: MarketState = {
      kind: "parimutuel",
      status: "open",
      rakeBps: 0,
      pools: { Yes: credits(1_000), No: credits(1_000) },
    };
    expect(() => parimutuelEngine.quote(state, { outcomeId: "Yes", side: "sell", shares: 5 })).toThrow();
  });

  it("rejects a closed market (BasePricingEngine guard)", () => {
    const state: MarketState = {
      kind: "parimutuel",
      status: "closed",
      rakeBps: 0,
      pools: { Yes: zero(), No: zero() },
    };
    expect(() =>
      parimutuelEngine.quote(state, { outcomeId: "Yes", side: "buy", shares: 5 }),
    ).toThrow();
  });
});

describe("parimutuel settlement — largest-remainder exactness", () => {
  it("never loses or invents a cent across a fuzzed set of stakes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 2000 }),
        (stakesCents, rakeBps) => {
          const positions: Position[] = stakesCents.map((cents, i) => ({
            userId: `user-${i}`,
            outcomeId: "A",
            shares: 0,
            costBasis: credits(cents),
          }));
          const totalPool = stakesCents.reduce((a, b) => a + b, 0);
          const state: MarketState = {
            kind: "parimutuel",
            status: "resolving",
            rakeBps,
            pools: { A: credits(totalPool), B: zero() },
          };
          const payouts = parimutuelEngine.settle(state, "A", positions);
          const totalPaid = payouts.reduce((sum, p) => sum + p.amount, 0);
          const expectedNet = Math.floor(totalPool * (1 - rakeBps / 10000));
          expect(totalPaid).toBe(expectedNet);
        },
      ),
    );
  });
});
