import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Card } from "@/engine/types";

import { CardTradePanel, type CardTradePanelProps } from "./CardTradePanel";

const CARDS: readonly Card[] = [
  { id: "japan", suit: "infantry", territory: 1 },
  { id: "indonesia", suit: "cavalry", territory: 2 },
  { id: "ukraine", suit: "artillery", territory: 3 },
];

const SET: readonly [string, string, string] = ["japan", "indonesia", "ukraine"];

const BASE: CardTradePanelProps = {
  cards: CARDS,
  sets: [SET],
  selected: [...SET],
  onToggle: () => {},
  value: 10,
  scheme: "fixed",
  bonusTerritoryName: null,
  forced: false,
  onTrade: () => {},
  onClose: () => {},
};

function renderPanel(patch: Partial<CardTradePanelProps> = {}) {
  return render(<CardTradePanel {...BASE} {...patch} />);
}

describe("CardTradePanel", () => {
  it("publishes the four bonus rows verbatim", () => {
    renderPanel();
    expect(screen.getByTestId("bonus-legend")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-4")).toHaveTextContent("4 Infantry");
    expect(screen.getByTestId("bonus-row-6")).toHaveTextContent("6 Cavalry");
    expect(screen.getByTestId("bonus-row-8")).toHaveTextContent("8 Artillery");
    expect(screen.getByTestId("bonus-row-10")).toHaveTextContent("10 All Three");
  });

  it("rings the row the current set is worth", () => {
    const { unmount } = renderPanel({ value: 10 });
    expect(screen.getByTestId("bonus-row-10").dataset["ringed"]).toBe("true");
    expect(screen.getByTestId("bonus-row-4").dataset["ringed"]).toBe("false");
    expect(screen.getByTestId("bonus-ring-10")).toBeInTheDocument();
    unmount();
    renderPanel({ value: 6 });
    expect(screen.getByTestId("bonus-row-6").dataset["ringed"]).toBe("true");
  });

  it("reads `Trade In Now +10` for a 10-value set", () => {
    renderPanel({ value: 10 });
    expect(screen.getByTestId("trade-in-now")).toHaveTextContent("Trade In Now +10");
  });

  it("reads the disabled `No Matching Cards` when there is no set", () => {
    renderPanel({ sets: [], selected: [], value: 0 });
    const pill = screen.getByTestId("trade-in-now");
    expect(pill).toHaveTextContent("No Matching Cards");
    expect(pill).toBeDisabled();
  });

  it("trades only once a whole set is selected", () => {
    const onTrade = vi.fn();
    const { unmount } = renderPanel({ selected: ["japan"], onTrade });
    expect(screen.getByTestId("trade-in-now")).toBeDisabled();
    unmount();
    renderPanel({ onTrade });
    fireEvent.click(screen.getByTestId("trade-in-now"));
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  it("fans one card per held card and toggles by id", () => {
    const onToggle = vi.fn();
    renderPanel({ selected: [], onToggle });
    for (const card of CARDS) expect(screen.getByTestId(`card-${card.id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-indonesia"));
    expect(onToggle).toHaveBeenCalledWith("indonesia");
  });

  it("lifts a selected card and gives it the dashed border", () => {
    renderPanel({ selected: ["japan"] });
    const card = screen.getByTestId("card-japan");
    expect(card.dataset["selected"]).toBe("true");
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card.style.transform).toContain("translateY(-14px)");
    expect(screen.getByTestId("card-japan-selected")).toBeInTheDocument();
    expect(screen.getByTestId("card-ukraine").dataset["selected"]).toBe("false");
  });

  it("humanises the card id into the territory name", () => {
    renderPanel();
    expect(screen.getByTestId("card-japan")).toHaveTextContent("Japan");
    expect(screen.getByTestId("card-ukraine")).toHaveTextContent("Ukraine");
  });

  it("is the same panel with the ✗ removed when the trade is forced", () => {
    const { unmount } = renderPanel({ forced: false });
    expect(screen.getByTestId("card-trade-close")).toBeInTheDocument();
    unmount();
    renderPanel({ forced: true });
    expect(screen.queryByTestId("card-trade-close")).toBeNull();
    expect(screen.getByTestId("bonus-legend")).toBeInTheDocument();
    expect(screen.getByTestId("trade-in-now")).toBeInTheDocument();
  });

  it("names the territory taking the +2", () => {
    renderPanel({ bonusTerritoryName: "Ukraine" });
    expect(screen.getByTestId("card-bonus-territory")).toHaveTextContent("+2 to Ukraine");
  });
});
