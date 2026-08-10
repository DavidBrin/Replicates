import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
            costBasis: 3800,
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
            costBasis: residualCostBasis,
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
