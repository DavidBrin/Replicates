import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { averageBuyPrice, type LedgerTrade } from "@/domain/position-ledger";
import { brand } from "@/domain/entities";
import { credits } from "@/domain/money";
import { PositionSummary } from "../PositionSummary";

const YES = brand<"OutcomeId">("yes");

describe("PositionSummary", () => {
  it("renders average cost per share as cents, not credits (G6)", () => {
    // 3800 cents of cost over 50 shares = 76 cents/share average cost.
    // A stray `/ 100` here would render "0.76¢" (100x too small) while
    // still claiming to be cents.
    render(
      <PositionSummary
        positions={[
          {
            outcomeId: "yes",
            outcomeLabel: "Yes",
            shares: 50,
            costBasis: credits(3800),
            avgCostPerShare: 0.76,
            currentPrice: 0.8,
          },
        ]}
      />,
    );
    expect(screen.getByText("76¢")).toBeInTheDocument();
  });

  /**
   * Finding C, end to end through the component. The market page derives
   * `avgCostPerShare` from the trade ledger; feeding this component the
   * ledger for a buy → partial sell → partial sell sequence must render the
   * true acquisition price, not the drifted `costBasis / shares` residual
   * that the same sequence leaves behind (which here is 125¢ — impossible
   * for a contract that settles at 100¢).
   */
  it("shows the ledger's average, not the drifted residual, after repeated partial sells", () => {
    const trades: LedgerTrade[] = [
      { outcomeId: YES, side: "buy", shares: 3, cost: credits(199) },
      { outcomeId: YES, side: "sell", shares: 2, cost: credits(133) },
      { outcomeId: YES, side: "sell", shares: 0.992, cost: credits(65) },
    ];
    const remainingShares = 0.008;
    const residualCostBasis = 1; // 199 - 133 - 65

    // Sanity: the number this fix removed really was impossible.
    expect((residualCostBasis / remainingShares / 100) * 100).toBeGreaterThan(100);

    render(
      <PositionSummary
        positions={[
          {
            outcomeId: "yes",
            outcomeLabel: "Yes",
            shares: remainingShares,
            costBasis: credits(residualCostBasis),
            avgCostPerShare: averageBuyPrice(trades, YES),
            currentPrice: 0.7,
          },
        ]}
      />,
    );

    // 199c / 3 shares = 66.33c/share, rendered to the nearest cent.
    expect(screen.getByText("66¢")).toBeInTheDocument();
    expect(screen.queryByText("125¢")).not.toBeInTheDocument();
  });
});

/**
 * A RESOLVED market has no live mark. Before this gate, `positionSummaryItems`
 * was built with no status check at all, so the tab kept marking a settled
 * position against the frozen final price. The worked case from the review:
 * alice buys 50 Yes for 2810c, bob 30 No for 1241c, b=100; Yes wins and
 * alice is PAID 5000c — realized P/L +21.90 — while the tab showed
 * "Unrealized P/L -0.61" in red, because 50 x p(Yes)=0.54983 marks at 2749c.
 */
describe("PositionSummary — a resolved market shows the settled payout, not a live mark", () => {
  const settledProps = {
    positions: [
      {
        outcomeId: "yes",
        outcomeLabel: "Yes",
        shares: 50,
        costBasis: credits(2810),
        avgCostPerShare: 0.562,
        currentPrice: 0.54983,
      },
    ],
    settlement: {
      winningOutcomeId: "yes",
      winningLabel: "Yes",
      payout: credits(5000),
      realizedPnl: credits(2190),
      hasPosition: true,
    },
  };

  it("never renders a mark-to-market unrealized P/L once resolved", () => {
    render(<PositionSummary {...settledProps} />);
    expect(screen.queryByText("Unrealized P/L")).not.toBeInTheDocument();
    // -0.61 is the contradictory figure the live mark produced.
    expect(screen.queryByText("-0.61")).not.toBeInTheDocument();
  });

  it("renders the settled payout and the realized P/L that was actually banked", () => {
    render(<PositionSummary {...settledProps} />);
    const panel = within(screen.getByTestId("position-settlement"));
    expect(panel.getByText("Payout")).toBeInTheDocument();
    expect(panel.getByText("50.00")).toBeInTheDocument();
    expect(panel.getByText("Realized P/L")).toBeInTheDocument();
    expect(panel.getByText("+21.90")).toBeInTheDocument();
    // And the row itself reports the settled value, not the live mark.
    expect(screen.getByText("50.00 · Won")).toBeInTheDocument();
  });

  it("still marks to market while the market is live", () => {
    render(<PositionSummary positions={settledProps.positions} />);
    expect(screen.getByText("Unrealized P/L")).toBeInTheDocument();
    expect(screen.queryByTestId("position-settlement")).not.toBeInTheDocument();
  });
});
