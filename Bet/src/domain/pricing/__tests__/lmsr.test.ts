import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { add, credits, toDecimal, zero, type Credits } from "@/domain/money";
import {
  defaultB,
  lmsrCost,
  lmsrEngine,
  lmsrMaxLoss,
  lmsrPrices,
  lmsrSharesForBudget,
  lmsrTradeCost,
} from "../lmsr";
import type { MarketState, Position } from "../types";
import { runPricingInvariants } from "./invariants";

const OUTCOME_SETS: string[][] = [
  ["Yes", "No"],
  ["A", "B", "C"],
  ["A", "B", "C", "D"],
];

const arbLmsrFreshState: fc.Arbitrary<MarketState> = fc
  .record({
    outcomes: fc.constantFrom(...OUTCOME_SETS),
    b: fc.integer({ min: 20, max: 300 }),
  })
  .map(
    ({ outcomes, b }): MarketState => ({
      kind: "lmsr",
      status: "open",
      b,
      q: Object.fromEntries(outcomes.map((o) => [o, 0])),
    }),
  );

runPricingInvariants("lmsr", lmsrEngine, arbLmsrFreshState, {
  // LMSR is the one engine with real operator subsidy risk (research §2.4):
  // settlement can legitimately pay out more than was collected, up to
  // b*ln(n). See invariants.ts's `maxSubsidy` doc comment.
  maxSubsidy: (state) => {
    if (state.kind !== "lmsr") return 0;
    return lmsrMaxLoss(state.b, Object.keys(state.q).length);
  },
});

describe("lmsrCost / lmsrPrices — worked examples (research/pricing-mechanisms.md §2.6, §2.7)", () => {
  it("§2.6 — 2 outcomes, b=100: opening cost and prices", () => {
    expect(lmsrCost([0, 0], 100)).toBeCloseTo(69.315, 3);
    expect(lmsrPrices([0, 0], 100)).toEqual([0.5, 0.5]);
  });

  it("§2.6 — buying 50 Yes shares", () => {
    const cost = lmsrTradeCost([0, 0], 0, 50, 100);
    // The doc's own hand-computed intermediate (97.407) carries ~1e-3 of
    // rounding noise from truncating e^0.5 to 5dp before taking ln() —
    // true double-precision value is 97.40769841801067. 1dp still checks
    // it against the documented number; the tighter checks below (cost,
    // avgPrice, resulting prices) hold at the doc's full stated precision.
    expect(lmsrCost([50, 0], 100)).toBeCloseTo(97.407, 1);
    expect(cost).toBeCloseTo(28.09, 2);
    expect(cost / 50).toBeCloseTo(0.5619, 4);

    const pricesAfter = lmsrPrices([50, 0], 100);
    expect(pricesAfter[0]).toBeCloseTo(0.6225, 4);
    expect(pricesAfter[1]).toBeCloseTo(0.3775, 4);
    expect(pricesAfter[0] + pricesAfter[1]).toBeCloseTo(1, 9);
  });

  it("§2.6 — house exposure stays under the b·ln(2) ceiling", () => {
    const maxLoss = lmsrMaxLoss(100, 2);
    expect(maxLoss).toBeCloseTo(69.31, 2);
    const cost = lmsrTradeCost([0, 0], 0, 50, 100);
    const lossIfYesWins = 50 * 1.0 - cost; // house owes 50, collected `cost`
    expect(lossIfYesWins).toBeCloseTo(21.91, 2);
    expect(lossIfYesWins).toBeLessThanOrEqual(maxLoss);
  });

  it("§2.7 — 3 outcomes, b=50: opening cost and prices", () => {
    expect(lmsrCost([0, 0, 0], 50)).toBeCloseTo(54.93, 2);
    expect(lmsrPrices([0, 0, 0], 50)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("§2.7 — buying 30 A shares", () => {
    const cost = lmsrTradeCost([0, 0, 0], 0, 30, 50);
    // Same hand-rounding caveat as the §2.6 case above.
    expect(lmsrCost([30, 0, 0], 50)).toBeCloseTo(67.033, 1);
    expect(cost).toBeCloseTo(12.1, 1);
    expect(cost / 30).toBeCloseTo(0.403, 2);

    const pricesAfter = lmsrPrices([30, 0, 0], 50);
    expect(pricesAfter[0]).toBeCloseTo(0.4768, 3);
    expect(pricesAfter[1]).toBeCloseTo(0.2616, 3);
    expect(pricesAfter[2]).toBeCloseTo(0.2616, 3);
    expect(pricesAfter[0] + pricesAfter[1] + pricesAfter[2]).toBeCloseTo(1, 9);
  });

  it("§2.7 — max loss ceiling b·ln(3)", () => {
    expect(lmsrMaxLoss(50, 3)).toBeCloseTo(54.93, 2);
  });
});

describe("lmsrSharesForBudget — inverts lmsrTradeCost", () => {
  it("2-outcome closed form recovers the §2.6 example (budget -> shares)", () => {
    const shares = lmsrSharesForBudget([0, 0], 0, 28.09, 100, "buy");
    expect(shares).toBeCloseTo(50, 1);
  });

  it("2-outcome closed form round-trips cost -> shares -> cost", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 300 }),
        fc.integer({ min: 1, max: 60 }),
        (b, targetShares) => {
          const cost = lmsrTradeCost([0, 0], 0, targetShares, b);
          const shares = lmsrSharesForBudget([0, 0], 0, cost, b, "buy");
          expect(shares).toBeCloseTo(targetShares, 6);
        },
      ),
    );
  });

  it("n-outcome bisection never overspends the budget", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 300 }),
        fc.double({ min: 1, max: 100, noNaN: true }),
        (b, budget) => {
          const q = [0, 0, 0];
          const shares = lmsrSharesForBudget(q, 0, budget, b, "buy");
          const actualCost = lmsrTradeCost(q, 0, shares, b);
          expect(actualCost).toBeLessThanOrEqual(budget + 1e-6);
        },
      ),
    );
  });

  it("sells: proceeds bisection also never exceeds the requested budget", () => {
    fc.assert(
      fc.property(fc.integer({ min: 20, max: 300 }), fc.double({ min: 1, max: 50, noNaN: true }), (b, budget) => {
        const q = [40, 10, 5]; // some pre-existing shares to sell against
        const shares = lmsrSharesForBudget(q, 0, budget, b, "sell");
        const proceeds = -lmsrTradeCost(q, 0, -shares, b);
        expect(proceeds).toBeLessThanOrEqual(budget + 1e-6);
      }),
    );
  });
});

describe("budget-based orders never overspend at the money boundary (through engine.quote/execute)", () => {
  // Unlike the raw-decimal checks above, these go through the ENGINE and
  // compare against `order.budget` as integer `Credits` — the value the
  // caller is actually charged after the ceil-rounding money boundary
  // (`toCreditsAtBoundary`). The 2-outcome path is an independent
  // algebraic closed-form solve (lmsr.ts's `lmsrDeltaForTargetCost`), not
  // covered by the n-outcome bisection's `f(lo) <= budget` loop invariant,
  // so it needs its own direct check — a float mismatch inside the EPS
  // guard could in principle round a cent over budget.

  function assertNeverOverspends(state: MarketState, budgetCents: number) {
    const outcomeId = Object.keys((state as Extract<MarketState, { kind: "lmsr" }>).q)[0];
    const budget = credits(budgetCents);
    const quote = lmsrEngine.quote(state, { outcomeId, side: "buy", budget });
    expect(quote.cost).toBeLessThanOrEqual(budget);

    // execute() must agree with quote() (invariant 7) and also never overspend.
    const { quote: executed } = lmsrEngine.execute(state, { outcomeId, side: "buy", budget });
    expect(executed.cost).toBeLessThanOrEqual(budget);
  }

  it("2-outcome closed form: quote.cost never exceeds order.budget as integer Credits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 100_000 }),
        (b, q0, q1, budgetCents) => {
          const state: MarketState = { kind: "lmsr", status: "open", b, q: { Yes: q0, No: q1 } };
          assertNeverOverspends(state, budgetCents);
        },
      ),
      { numRuns: 5000 },
    );
  });

  it("2-outcome closed form: tiny budgets (1-5 cents) never overspend — proportionally the riskiest case", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 5 }),
        (b, q0, q1, budgetCents) => {
          const state: MarketState = { kind: "lmsr", status: "open", b, q: { Yes: q0, No: q1 } };
          assertNeverOverspends(state, budgetCents);
        },
      ),
      { numRuns: 5000 },
    );
  });

  it("n-outcome bisection: quote.cost never exceeds order.budget as integer Credits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 500 }),
        fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 3, maxLength: 5 }),
        fc.integer({ min: 1, max: 100_000 }),
        (b, qValues, budgetCents) => {
          const outcomes = qValues.map((_, i) => `O${i}`);
          const state: MarketState = {
            kind: "lmsr",
            status: "open",
            b,
            q: Object.fromEntries(outcomes.map((o, i) => [o, qValues[i]])),
          };
          assertNeverOverspends(state, budgetCents);
        },
      ),
      { numRuns: 5000 },
    );
  });

  it("n-outcome bisection: tiny budgets (1-5 cents) never overspend — proportionally the riskiest case", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 500 }),
        fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 3, maxLength: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (b, qValues, budgetCents) => {
          const outcomes = qValues.map((_, i) => `O${i}`);
          const state: MarketState = {
            kind: "lmsr",
            status: "open",
            b,
            q: Object.fromEntries(outcomes.map((o, i) => [o, qValues[i]])),
          };
          assertNeverOverspends(state, budgetCents);
        },
      ),
      { numRuns: 5000 },
    );
  });
});

describe("defaultB", () => {
  it("SPEC §6.2: max(50, 12 * expectedParticipants)", () => {
    expect(defaultB(1)).toBe(50);
    expect(defaultB(6)).toBe(72);
    expect(defaultB(20)).toBe(240);
  });
});

describe("LMSR bounded loss (SPEC §6.5 invariant 4 — LMSR-specific)", () => {
  it("house loss never exceeds b*ln(n) for any winning outcome, over random trade sequences", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OUTCOME_SETS),
        fc.integer({ min: 20, max: 200 }),
        fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 8 }),
        (outcomes, b, tradeShares) => {
          let state: MarketState = {
            kind: "lmsr",
            status: "open",
            b,
            q: Object.fromEntries(outcomes.map((o) => [o, 0])),
          };
          let collected: Credits = zero();
          const positions = new Map<string, Position>();

          tradeShares.forEach((shares, i) => {
            const outcomeId = outcomes[i % outcomes.length];
            const userId = `user-${i % 4}`;
            const { newState, quote } = lmsrEngine.execute(state, {
              outcomeId,
              side: "buy",
              shares,
            });
            state = newState;
            collected = add(collected, quote.cost);
            const key = `${userId}:${outcomeId}`;
            const prior = positions.get(key);
            positions.set(key, {
              userId,
              outcomeId,
              shares: (prior?.shares ?? 0) + quote.shares,
              costBasis: add(prior?.costBasis ?? zero(), quote.cost),
            });
          });

          const maxLoss = lmsrMaxLoss(b, outcomes.length);
          for (const winningOutcomeId of outcomes) {
            const payouts = lmsrEngine.settle(state, winningOutcomeId, Array.from(positions.values()));
            const totalPaid = payouts.reduce((sum, p) => add(sum, p.amount), zero());
            const houseLoss = toDecimal(totalPaid) - toDecimal(collected);
            expect(houseLoss).toBeLessThanOrEqual(maxLoss + 1e-6);
          }
        },
      ),
    );
  });
});

describe("determinism (invariant 7, LMSR-specific spot check)", () => {
  it("lmsrCost and lmsrPrices are pure functions of their inputs", () => {
    const q = [12, 5, 0];
    expect(lmsrCost(q, 40)).toBe(lmsrCost(q, 40));
    expect(lmsrPrices(q, 40)).toEqual(lmsrPrices(q, 40));
  });
});

describe("guards (BasePricingEngine, exercised through LmsrEngine)", () => {
  const openState: MarketState = { kind: "lmsr", status: "open", b: 100, q: { Yes: 0, No: 0 } };

  it("rejects a closed market", () => {
    const closed: MarketState = { ...openState, status: "closed" };
    expect(() => lmsrEngine.quote(closed, { outcomeId: "Yes", side: "buy", shares: 10 })).toThrow();
  });

  it("rejects both shares and budget set", () => {
    expect(() =>
      lmsrEngine.quote(openState, {
        outcomeId: "Yes",
        side: "buy",
        shares: 10,
        budget: 1000 as Credits,
      }),
    ).toThrow();
  });

  it("rejects neither shares nor budget set", () => {
    expect(() => lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy" })).toThrow();
  });

  it("rejects non-positive shares", () => {
    expect(() => lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy", shares: 0 })).toThrow();
    expect(() => lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy", shares: -5 })).toThrow();
  });

  it("enforces maxCost slippage on a buy", () => {
    const quote = lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy", shares: 50 });
    const tooLow = (quote.cost - 1) as Credits;
    expect(() =>
      lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy", shares: 50, maxCost: tooLow }),
    ).toThrow();
    const enough = (quote.cost + 1) as Credits;
    expect(() =>
      lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy", shares: 50, maxCost: enough }),
    ).not.toThrow();
  });

  it("normalizes currentPrices to sum to exactly 1", () => {
    const prices = lmsrEngine.currentPrices(openState);
    const sum = Object.values(prices).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1);
  });

  it("quote() never mutates the input state", () => {
    const before = JSON.stringify(openState);
    lmsrEngine.quote(openState, { outcomeId: "Yes", side: "buy", shares: 25 });
    expect(JSON.stringify(openState)).toBe(before);
  });
});

