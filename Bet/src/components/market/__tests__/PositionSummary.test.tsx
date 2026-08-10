import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionSummary } from "../PositionSummary";

describe("PositionSummary", () => {
  it("renders average cost per share as cents, not credits — costBasis is already cents (G6)", () => {
    // 3800 cents of cost basis over 50 shares = 76 cents/share average cost.
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
            currentPrice: 0.8,
          },
        ]}
      />,
    );
    expect(screen.getByText("76¢")).toBeInTheDocument();
  });
});
