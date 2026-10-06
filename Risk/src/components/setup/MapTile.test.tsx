import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_RULES } from "@/engine/types";
import { playMapSlugs } from "@/game/pending";

import { MapTile } from "./MapTile";
import { RulesReadout } from "./RulesReadout";
import { SeatRow } from "./SeatRow";

describe("MapTile", () => {
  it("shows a skeleton until the MapDef resolves, then draws the board", async () => {
    const slug = playMapSlugs()[0] as string;
    render(<MapTile slug={slug} onSelect={() => {}} />);
    expect(screen.getByTestId("map-tile-skeleton")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("map-tile-board")).toBeInTheDocument());
    expect(screen.queryByTestId("map-tile-skeleton")).toBeNull();
  });

  it("draws one path per territory straight from the MapDef `d` strings", async () => {
    const slug = playMapSlugs()[0] as string;
    render(<MapTile slug={slug} onSelect={() => {}} />);
    const board = await screen.findByTestId("map-tile-board");
    const paths = board.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]?.getAttribute("d")).toMatch(/^M /);
    // the glass tray is tilted ~30° back and ~6° yawed
    expect(screen.getByTestId("map-tile-tray").getAttribute("style")).toContain("rotateX(30deg)");
  });

  it("is never locked, reports its slug and selects on click", async () => {
    const onSelect = vi.fn();
    const slug = playMapSlugs()[0] as string;
    render(<MapTile slug={slug} selected onSelect={onSelect} />);
    const tile = screen.getByTestId(`map-tile-${slug}`);
    expect(tile).toHaveAttribute("data-selected", "true");
    expect(tile).not.toBeDisabled();
    fireEvent.click(tile);
    expect(onSelect).toHaveBeenCalledTimes(1);
    await screen.findByTestId("map-tile-board");
  });
});

describe("RulesReadout", () => {
  it("renders the six §7 lines verbatim off the live Rules", () => {
    render(<RulesReadout rules={{ ...DEFAULT_RULES, aiDifficulty: "expert", turnSeconds: 60 }} />);
    expect(screen.getByTestId("rules-readout-setup")).toHaveTextContent("Setup: Auto");
    expect(screen.getByTestId("rules-readout-turn-timer")).toHaveTextContent("Turn Timer: 60s");
    expect(screen.getByTestId("rules-readout-ai-difficulty")).toHaveTextContent("AI Difficulty: Expert");
    expect(screen.getByTestId("rules-readout-card-bonus")).toHaveTextContent("Card Bonus: Fixed");
    expect(screen.getByTestId("rules-readout-dice-rolls")).toHaveTextContent("Dice Rolls: Balanced Blitz");
    expect(screen.getByTestId("rules-readout-alliances")).toHaveTextContent("Alliances: Off");
  });

  it("tracks the Rules it is given", () => {
    render(<RulesReadout rules={{ ...DEFAULT_RULES, manualPlacement: true, alliances: true, cardBonus: "progressive" }} />);
    expect(screen.getByTestId("rules-readout-setup")).toHaveTextContent("Setup: Manual");
    expect(screen.getByTestId("rules-readout-alliances")).toHaveTextContent("Alliances: On");
    expect(screen.getByTestId("rules-readout-card-bonus")).toHaveTextContent("Card Bonus: Progressive");
  });

  it("lays the six entries out as three centred lines, no boxes", () => {
    const { container } = render(<RulesReadout rules={DEFAULT_RULES} />);
    const lines = container.querySelectorAll('[data-testid="rules-readout"] > div');
    expect(lines).toHaveLength(3);
  });
});

describe("SeatRow", () => {
  const seat = { kind: "bot", name: "Bot 1", colour: "green", tier: "hard" } as const;

  it("renders the kind toggle, the name field and the colour picker", () => {
    render(<SeatRow index={1} seat={seat} taken={[]} onChange={() => {}} />);
    expect(screen.getByTestId("seat-row-1")).toHaveAttribute("data-kind", "bot");
    expect(screen.getByTestId("seat-name-1")).toHaveValue("Bot 1");
    expect(screen.getByTestId("seat-colour-1-green")).toHaveAttribute("data-selected", "true");
  });

  it("shows the AI Difficulty select only for a bot seat", () => {
    const { rerender } = render(<SeatRow index={0} seat={seat} taken={[]} onChange={() => {}} />);
    expect(screen.getByTestId("seat-tier-0")).toHaveValue("hard");
    rerender(<SeatRow index={0} seat={{ ...seat, kind: "human", tier: null }} taken={[]} onChange={() => {}} />);
    expect(screen.queryByTestId("seat-tier-0")).toBeNull();
  });

  it("disables a colour another seat already holds", () => {
    render(<SeatRow index={2} seat={seat} taken={["red", "blue"]} onChange={() => {}} />);
    expect(screen.getByTestId("seat-colour-2-red")).toBeDisabled();
    expect(screen.getByTestId("seat-colour-2-green")).toBeEnabled();
  });

  it("reports every edit as a SeatConfig patch", () => {
    const onChange = vi.fn();
    render(<SeatRow index={3} seat={seat} taken={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("seat-name-3"), { target: { value: "Rook" } });
    expect(onChange).toHaveBeenCalledWith({ name: "Rook" });
    fireEvent.click(screen.getByTestId("seat-colour-3-pink"));
    expect(onChange).toHaveBeenCalledWith({ colour: "pink" });
    fireEvent.click(screen.getByTestId("seat-kind-3-human"));
    expect(onChange).toHaveBeenCalledWith({ kind: "human" });
    fireEvent.change(screen.getByTestId("seat-tier-3"), { target: { value: "expert" } });
    expect(onChange).toHaveBeenCalledWith({ tier: "expert" });
  });
});
