import { describe, expect, it } from "vitest";
import { brand, type OutcomeId } from "@/domain/entities";
import { credits, mul, sub, type Credits } from "@/domain/money";
import { averageBuyPrice, type LedgerTrade } from "@/domain/position-ledger";

const YES = brand<"OutcomeId">("yes");
const NO = brand<"OutcomeId">("no");

function buy(outcomeId: OutcomeId, shares: number, costCents: number): LedgerTrade {
  return { outcomeId, side: "buy", shares, cost: credits(costCents) };
}

function sell(outcomeId: OutcomeId, shares: number, costCents: number): LedgerTrade {
  return { outcomeId, side: "sell", shares, cost: credits(costCents) };
}

describe("averageBuyPrice", () => {
  it("is Σ buy cost ÷ Σ buy shares, as a 0..1 fraction of a credit", () => {
    // 3800 cents over 50 shares = 76 cents/share = 0.76 credits/share.
    expect(averageBuyPrice([buy(YES, 50, 3800)], YES)).toBeCloseTo(0.76, 10);
  });

  it("averages across multiple buys at different prices", () => {
    // 20 @ 40¢ = 800c, 30 @ 60¢ = 1800c -> 2600c / 50 shares = 52¢.
    const trades = [buy(YES, 20, 800), buy(YES, 30, 1800)];
    expect(averageBuyPrice(trades, YES)).toBeCloseTo(0.52, 10);
  });

  it("ignores other outcomes' trades", () => {
    const trades = [buy(YES, 10, 700), buy(NO, 10, 100)];
    expect(averageBuyPrice(trades, YES)).toBeCloseTo(0.7, 10);
    expect(averageBuyPrice(trades, NO)).toBeCloseTo(0.1, 10);
  });

  it("returns 0 when there are no buys for the outcome", () => {
    expect(averageBuyPrice([], YES)).toBe(0);
    expect(averageBuyPrice([sell(YES, 5, 400)], YES)).toBe(0);
  });

  /**
   * Finding C, the regression this module exists for.
   *
   * `trading.ts` reduces `Position.costBasis` on each sell by
   * `mul(costBasis, soldFraction, "nearest")` and never re-derives it. Each
   * of those reductions rounds, the error is never corrected, and dividing
   * the drifted residual by an ever-smaller `shares` amplifies it. This
   * test replays a buy → partial sell → partial sell exactly as the trading
   * service would, then asserts the two numbers diverge: the residual-based
   * average is wrong (and here, impossibly so — over 100¢ for a contract
   * that settles at 100¢), while the ledger-based one is untouched by the
   * sells.
   */
  it("stays correct — and inside 0..100¢ — across repeated partial sells", () => {
    // A deliberately awkward buy: 3 shares for 199 cents (66.333…¢/share),
    // so every subsequent fractional reduction has a remainder to round.
    const trades: LedgerTrade[] = [buy(YES, 3, 199)];

    // --- replay trading.ts's costBasis arithmetic, sell by sell ---
    // Unwinding most of the position in two goes, the second leaving a
    // dust-sized remainder — which is exactly where an uncorrected ±0.5¢
    // gets divided by a very small number.
    let shares = 3;
    let costBasis: Credits = credits(199);

    for (const sold of [2, 0.992]) {
      const soldFraction = Math.min(1, sold / shares);
      const removed = mul(costBasis, soldFraction, "nearest");
      shares = Math.max(0, shares - sold);
      costBasis = sub(costBasis, removed);
      // The sell rows exist in the ledger and must not perturb the average.
      trades.push(sell(YES, sold, removed));
    }

    // 0.008 shares left, holding a 1¢ residual that no longer means
    // "0.008 × 66.3¢" (which would be well under a cent).
    expect(shares).toBeCloseTo(0.008, 10);
    expect(costBasis).toBe(1);

    const residualAverageCents = (costBasis / shares / 100) * 100;
    const ledgerAverageCents = averageBuyPrice(trades, YES) * 100;

    // The old display: an impossible price for a ≤100¢ contract.
    expect(residualAverageCents).toBeGreaterThan(100);
    // The new one: the true average acquisition price, unmoved by sells.
    expect(ledgerAverageCents).toBeCloseTo(199 / 3, 10);
    expect(ledgerAverageCents).toBeGreaterThanOrEqual(0);
    expect(ledgerAverageCents).toBeLessThanOrEqual(100);
  });

  it("clamps a pathological ledger to 100¢ rather than rendering an impossible price", () => {
    // A rounding-up boundary on a dust-sized buy: 1 cent for 0.001 shares
    // would arithmetically be 1000¢/share.
    expect(averageBuyPrice([buy(YES, 0.001, 1)], YES)).toBe(1);
  });
});
