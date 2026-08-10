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

/**
 * A winning outcome with ZERO stakers used to destroy the entire pool: the
 * winners list was empty, so `distributeLargestRemainder` split the net pool
 * among nobody and `settle` returned `[]`. Alice's 50.00 on Yes simply
 * evaporated when the market resolved No with no No stakers — a silent
 * total loss of real, already-debited credits, and a direct violation of
 * the `Σ escrow` conservation invariant (SPEC §6.5 #5).
 */
describe("parimutuel settlement — an unbacked winning outcome refunds instead of burning the pool", () => {
  const state: MarketState = {
    kind: "parimutuel",
    status: "resolved",
    rakeBps: 0,
    pools: { Yes: credits(5_000), No: zero() },
  };

  it("refunds the sole staker in full when the winning side had no backers", () => {
    const positions: Position[] = [
      { userId: "alice", outcomeId: "Yes", shares: 50, costBasis: credits(5_000) },
    ];

    const payouts = parimutuelEngine.settle(state, "No", positions);
    expect(payouts).toEqual([{ userId: "alice", amount: credits(5_000) }]);
  });

  it("refunds several stakers pro-rata, to the cent, and never burns the rake", () => {
    const raked: MarketState = {
      kind: "parimutuel",
      status: "resolved",
      rakeBps: 500,
      pools: { Yes: credits(3_333), No: credits(6_667) },
    };
    const positions: Position[] = [
      { userId: "alice", outcomeId: "Yes", shares: 33, costBasis: credits(3_333) },
      { userId: "bob", outcomeId: "No", shares: 66, costBasis: credits(6_667) },
    ];

    // "Maybe" won and nobody staked it — there is no winning side for the
    // rake to be taken from, so every cent of the pool goes back.
    const payouts = parimutuelEngine.settle(raked, "Maybe", positions);
    const total = payouts.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(10_000);
    const byUser = Object.fromEntries(payouts.map((p) => [p.userId, p.amount]));
    expect(byUser.alice).toBe(credits(3_333));
    expect(byUser.bob).toBe(credits(6_667));
  });

  it("still pays only the winners when the winning outcome DOES have backers", () => {
    const positions: Position[] = [
      { userId: "alice", outcomeId: "Yes", shares: 30, costBasis: credits(3_000) },
      { userId: "bob", outcomeId: "No", shares: 20, costBasis: credits(2_000) },
    ];
    const payouts = parimutuelEngine.settle(state, "Yes", positions);
    expect(payouts).toEqual([{ userId: "alice", amount: credits(5_000) }]);
  });
});
