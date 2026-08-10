import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { credits, zero } from "@/domain/money";
import { fixedOddsEngine } from "../fixed-odds";
import type { MarketState, Position } from "../types";
import { runPricingInvariants } from "./invariants";

const CONFIGS: { outcomes: string[]; prices: number[] }[] = [
  { outcomes: ["Yes", "No"], prices: [0.5, 0.5] },
  { outcomes: ["Yes", "No"], prices: [0.3, 0.7] },
  { outcomes: ["Yes", "No"], prices: [0.65, 0.35] },
  { outcomes: ["A", "B", "C"], prices: [0.5, 0.3, 0.2] },
  { outcomes: ["A", "B", "C", "D"], prices: [0.4, 0.3, 0.2, 0.1] },
];

function freshState(config: (typeof CONFIGS)[number]): MarketState {
  return {
    kind: "fixedOdds",
    status: "open",
    openingPrices: Object.fromEntries(config.outcomes.map((o, i) => [o, config.prices[i]])),
    escrow: Object.fromEntries(config.outcomes.map((o) => [o, zero()])),
  };
}

const arbFixedOddsFreshState: fc.Arbitrary<MarketState> = fc.constantFrom(...CONFIGS).map(freshState);

runPricingInvariants("fixedOdds", fixedOddsEngine, arbFixedOddsFreshState);

describe("fixed-odds pricing", () => {
  it("price never moves regardless of trade size (priceImpact is always 0)", () => {
    const state = freshState(CONFIGS[1]); // Yes 0.3 / No 0.7
    const before = fixedOddsEngine.currentPrices(state);
    const { newState, quote } = fixedOddsEngine.execute(state, {
      outcomeId: "Yes",
      side: "buy",
      shares: 40,
    });
    expect(quote.priceImpact).toBe(0);
    const after = fixedOddsEngine.currentPrices(newState);
    expect(after.Yes).toBeCloseTo(before.Yes, 9);
    expect(after.No).toBeCloseTo(before.No, 9);
  });

  it("cost = shares × openingPrice, rounded up in the pot's favor", () => {
    const state = freshState(CONFIGS[1]); // Yes @ 0.30
    const { quote } = fixedOddsEngine.execute(state, { outcomeId: "Yes", side: "buy", shares: 7 });
    // 7 * 0.30 = 2.10 credits = 210 cents exactly.
    expect(quote.cost).toBe(credits(210));
    expect(quote.avgPrice).toBeCloseTo(0.3, 9);
  });

  it("budget-based buys derive shares from price", () => {
    const state = freshState(CONFIGS[0]); // 0.5 / 0.5
    const { quote } = fixedOddsEngine.execute(state, {
      outcomeId: "Yes",
      side: "buy",
      budget: credits(1000), // 10 credits
    });
    expect(quote.shares).toBeCloseTo(20, 9); // 10 / 0.5
    expect(quote.cost).toBe(credits(1000));
  });

  it("selling more than is escrowed on that outcome is rejected", () => {
    const state = freshState(CONFIGS[0]);
    expect(() =>
      fixedOddsEngine.execute(state, { outcomeId: "Yes", side: "sell", shares: 10 }),
    ).toThrow();
  });

  it("rejects a closed market (BasePricingEngine guard)", () => {
    const state = { ...freshState(CONFIGS[0]), status: "closed" as const };
    expect(() =>
      fixedOddsEngine.quote(state, { outcomeId: "Yes", side: "buy", shares: 10 }),
    ).toThrow();
  });
});

describe("fixed-odds settlement — peer-to-peer matching rule", () => {
  it("pays winners at par and returns the unmatched remainder to losing stakers", () => {
    // Yes @ 0.5 / No @ 0.5. Two Yes backers stake 30+20=50 credits total
    // (buying 60+40=100 shares at 0.5); one No backer stakes 80 credits
    // (buying 160 shares at 0.5). Total pot = 130 credits. Yes wins:
    // owed = 100 shares * 1 credit = 100 credits, collected = 130 -> the
    // 30-credit remainder goes back to the (sole) No staker.
    const state: MarketState = {
      kind: "fixedOdds",
      status: "resolving",
      openingPrices: { Yes: 0.5, No: 0.5 },
      escrow: { Yes: credits(5000), No: credits(8000) },
    };
    const positions: Position[] = [
      { userId: "alice", outcomeId: "Yes", shares: 60, costBasis: credits(3000) },
      { userId: "bob", outcomeId: "Yes", shares: 40, costBasis: credits(2000) },
      { userId: "carol", outcomeId: "No", shares: 160, costBasis: credits(8000) },
    ];

    const payouts = fixedOddsEngine.settle(state, "Yes", positions);
    const byUser = Object.fromEntries(payouts.map((p) => [p.userId, p.amount]));

    expect(byUser.alice).toBe(credits(6000)); // 60 shares * 1cr par
    expect(byUser.bob).toBe(credits(4000)); // 40 shares * 1cr par
    expect(byUser.carol).toBe(credits(3000)); // unmatched remainder, 30cr

    const total = payouts.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(13000); // exactly the pot, no cent lost or invented
  });

  it("haircut branch: if the pot cannot cover par, winners split it pro-rata and nobody gets a remainder", () => {
    const state: MarketState = {
      kind: "fixedOdds",
      status: "resolving",
      openingPrices: { Yes: 0.9, No: 0.1 },
      escrow: { Yes: credits(9000), No: credits(1000) },
    };
    // Yes backers hold 100 shares total (owed 100cr) but only 100cr total
    // sits in the pot combined (9000+1000 cents) — exactly enough here, so
    // adjust: give Yes backers MORE shares than the pot can cover at par.
    const positions: Position[] = [
      { userId: "alice", outcomeId: "Yes", shares: 90, costBasis: credits(8100) },
      { userId: "dave", outcomeId: "Yes", shares: 30, costBasis: credits(2700) },
      { userId: "carol", outcomeId: "No", shares: 10, costBasis: credits(1000) },
    ];
    // owed = 120cr, pot = (9000+1000)/100 + dave's extra stake not reflected
    // in escrow (escrow is per-outcome total, already 90cr on Yes from the
    // fixture above alone plus dave's 27cr would need escrow updated too —
    // keep this fixture self-consistent by setting escrow to match stakes):
    const consistentState: MarketState = {
      ...state,
      escrow: { Yes: credits(8100 + 2700), No: credits(1000) },
    };
    const payouts = fixedOddsEngine.settle(consistentState, "Yes", positions);
    const total = payouts.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(8100 + 2700 + 1000); // every cent of the pot handed out
    const byUser = Object.fromEntries(payouts.map((p) => [p.userId, p.amount]));
    expect(byUser.carol).toBeUndefined(); // No staker gets nothing — Yes won
    // alice (90 shares) got 3x dave's (30 shares) payout, proportionally:
    expect(byUser.alice / byUser.dave).toBeCloseTo(3, 1);
  });

  it("settlement never pays out more than a fuzzed pot ever collected", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFIGS),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 30 })), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 3 }),
        (config, orders, winnerIdx) => {
          let state = freshState(config);
          const positions = new Map<string, Position>();
          orders.forEach(([outcomeIdx, shares], i) => {
            const outcomeId = config.outcomes[outcomeIdx % config.outcomes.length];
            const userId = `user-${i % 3}`;
            const { newState, quote } = fixedOddsEngine.execute(state, {
              outcomeId,
              side: "buy",
              shares,
            });
            state = newState;
            const key = `${userId}:${outcomeId}`;
            const prior = positions.get(key);
            positions.set(key, {
              userId,
              outcomeId,
              shares: (prior?.shares ?? 0) + quote.shares,
              costBasis: credits((prior?.costBasis ?? 0) + quote.cost),
            });
          });
          const totalCollected = Object.values((state as Extract<MarketState, { kind: "fixedOdds" }>).escrow).reduce(
            (sum, e) => sum + e,
            0,
          );
          const winningOutcomeId = config.outcomes[winnerIdx % config.outcomes.length];
          const payouts = fixedOddsEngine.settle(state, winningOutcomeId, Array.from(positions.values()));
          const totalPaid = payouts.reduce((sum, p) => sum + p.amount, 0);
          expect(totalPaid).toBeLessThanOrEqual(totalCollected);
        },
      ),
    );
  });

  /**
   * Final-review minor #7, targeted where the generic fuzz above is
   * weakest.
   *
   * That property draws each order's outcome uniformly, so it almost never
   * produces a genuinely **one-sided** book — and one-sidedness is exactly
   * where a peer-funded engine can plausibly promise more than it holds.
   * The escrow only ever receives `shares × openingPrice`, but each winning
   * share is owed a full credit at par, so a book where everyone piled onto
   * the same outcome collects strictly less than it owes. `settle()` must
   * take the haircut branch there and hand out at most the pot; if it ever
   * paid par regardless, it would be minting credits that nobody staked.
   *
   * Both directions of one-sidedness are generated:
   *  - every stake on the outcome that WINS (the pot is short of par), and
   *  - every stake on outcomes that LOSE (no winning claimant at all — the
   *    whole pot is "unmatched remainder" and must return to the stakers,
   *    without any of it being conjured or dropped).
   */
  it("never pays out more than was escrowed on a deliberately ONE-SIDED book", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFIGS),
        // Stake sizes for 1..6 backers, all piling onto a single outcome.
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 6 }),
        // Which outcome the whole book backs.
        fc.integer({ min: 0, max: 3 }),
        // Whether that backed outcome is the one that wins.
        fc.boolean(),
        (config, stakes, backedIdx, backedWins) => {
          const backed = config.outcomes[backedIdx % config.outcomes.length]!;
          const winningOutcomeId = backedWins
            ? backed
            : config.outcomes[(backedIdx + 1) % config.outcomes.length]!;

          let state = freshState(config);
          const positions: Position[] = [];
          stakes.forEach((shares, i) => {
            const { newState, quote } = fixedOddsEngine.execute(state, {
              outcomeId: backed,
              side: "buy",
              shares,
            });
            state = newState;
            positions.push({
              userId: `user-${i}`,
              outcomeId: backed,
              shares: quote.shares,
              costBasis: quote.cost,
            });
          });

          const escrow = (state as Extract<MarketState, { kind: "fixedOdds" }>).escrow;
          const totalCollected = Object.values(escrow).reduce((sum, e) => sum + e, 0);
          expect(totalCollected).toBeGreaterThan(0);

          const payouts = fixedOddsEngine.settle(state, winningOutcomeId, positions);
          const totalPaid = payouts.reduce((sum, p) => sum + p.amount, 0);

          // The invariant under test: the engine is peer-funded, so it can
          // never distribute a cent that was not staked.
          expect(totalPaid).toBeLessThanOrEqual(totalCollected);

          if (backedWins) {
            // Every share is owed 1 credit but was bought for less than
            // one (opening prices are strictly in (0,1)), so this book is
            // necessarily short of par — the haircut branch. Winners still
            // receive the whole pot, just not par.
            const totalOwed = Math.floor(positions.reduce((s, p) => s + p.shares, 0) * 100);
            expect(totalCollected).toBeLessThan(totalOwed);
            expect(totalPaid).toBe(totalCollected);
          } else {
            // Nobody backed the winner: the entire pot is unmatched money
            // that was never at risk, and must go back to the stakers —
            // not vanish, and not multiply.
            expect(totalPaid).toBe(totalCollected);
          }
        },
      ),
    );
  });
});
