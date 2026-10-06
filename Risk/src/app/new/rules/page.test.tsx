import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_VORONOI, sessionConfigStore } from "@/game/sessionConfig";
import { routerMock } from "../../../../vitest.setup";

import RulesPage from "./page";

/** A random source keeps the hero synchronous; the slug hero is covered by MapTile's own suite. */
function withRandomMap() {
  sessionConfigStore.getState().setSource({ kind: "random", options: DEFAULT_VORONOI, seed: "seed-1" });
}

beforeEach(() => {
  sessionConfigStore.getState().reset();
  routerMock.push.mockClear();
  withRandomMap();
});

describe("/new/rules (Modes and Modifiers)", () => {
  it("heads the screen `Modes and Modifiers` and shows the mode plate with its CUSTOM sub-chip", () => {
    render(<RulesPage />);
    expect(screen.getByRole("heading", { name: "Modes and Modifiers" })).toBeInTheDocument();
    expect(screen.getByTestId("rules-mode-plate")).toHaveTextContent("World Domination");
    expect(screen.getByTestId("rules-custom-chip")).toHaveTextContent("CUSTOM");
    expect(screen.getByTestId("rules-player-count")).toHaveTextContent("3/6");
  });

  it("stacks the eight §7 modifier toggles and shows the rules readout", () => {
    render(<RulesPage />);
    for (const key of [
      "blizzards", "fog-of-war", "portals", "capitals",
      "percentage-domination", "manual-placement", "max-rounds", "round-delay",
    ]) {
      expect(screen.getByTestId(`modifier-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("rules-readout-dice-rolls")).toHaveTextContent("Dice Rolls: Balanced Blitz");
  });

  it("writes every modifier into sessionConfigStore", () => {
    render(<RulesPage />);
    fireEvent.click(screen.getByTestId("modifier-blizzards"));
    fireEvent.click(screen.getByTestId("modifier-fog-of-war"));
    fireEvent.click(screen.getByTestId("modifier-portals"));
    fireEvent.click(screen.getByTestId("modifier-percentage-domination"));
    fireEvent.click(screen.getByTestId("modifier-manual-placement"));
    fireEvent.click(screen.getByTestId("modifier-max-rounds"));
    fireEvent.click(screen.getByTestId("modifier-round-delay"));
    const rules = sessionConfigStore.getState().rules;
    expect(rules.blizzards).toBe(true);
    expect(rules.fogOfWar).toBe(true);
    expect(rules.portals).toBe("stable");
    expect(rules.winCondition).toBe("percentage");
    expect(rules.manualPlacement).toBe(true);
    expect(rules.maxRounds).toBe(5);
    expect(rules.roundDelayMs).toBeGreaterThan(0);
    // the readout follows the live Rules
    expect(screen.getByTestId("rules-readout-setup")).toHaveTextContent("Setup: Manual");
    expect(screen.getByTestId("rules-mode-plate")).toHaveTextContent("Percentage Domination");
  });

  it("opens the per-seat Modifiers panel and adds or removes seats within 2–6", () => {
    render(<RulesPage />);
    fireEvent.click(screen.getByTestId("rules-modifiers"));
    expect(screen.getByTestId("modifiers-panel")).toBeInTheDocument();
    expect(screen.getByTestId("seat-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("seat-count")).toHaveTextContent("3");

    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByTestId("seat-add"));
    expect(sessionConfigStore.getState().seats).toHaveLength(6);
    expect(screen.getByTestId("seat-add")).toBeDisabled();

    for (let i = 0; i < 6; i += 1) {
      const last = sessionConfigStore.getState().seats.length - 1;
      fireEvent.click(screen.getByTestId(`seat-remove-${last}`));
    }
    expect(sessionConfigStore.getState().seats).toHaveLength(2);
  });

  it("reaches the rest of the Rules interface from the panel, including `5-Rounds Rumble`", () => {
    render(<RulesPage />);
    fireEvent.click(screen.getByTestId("rules-modifiers"));

    fireEvent.click(screen.getByTestId("rules-max-rounds-up"));
    expect(screen.getByTestId("rules-max-rounds-value")).toHaveTextContent("5-Rounds Rumble");

    fireEvent.change(screen.getByTestId("rules-domination"), { target: { value: "85" } });
    expect(sessionConfigStore.getState().rules.dominationThreshold).toBeCloseTo(0.85);

    fireEvent.click(screen.getByTestId("rules-card-bonus-progressive"));
    fireEvent.click(screen.getByTestId("rules-dice-mode-trueRandom"));
    fireEvent.click(screen.getByTestId("rules-alliances-on"));
    fireEvent.click(screen.getByTestId("rules-ai-difficulty-expert"));
    fireEvent.click(screen.getByTestId("rules-capital-draft-bonus-on"));
    fireEvent.click(screen.getByTestId("rules-portals-unstable"));
    fireEvent.click(screen.getByTestId("rules-win-capitals"));
    fireEvent.click(screen.getByTestId("rules-round-delay-600"));

    const rules = sessionConfigStore.getState().rules;
    expect(rules).toMatchObject({
      cardBonus: "progressive",
      diceMode: "trueRandom",
      alliances: true,
      aiDifficulty: "expert",
      capitalDraftBonus: true,
      portals: "unstable",
      winCondition: "capitals",
      roundDelayMs: 600,
      maxRounds: 5,
    });
  });

  it("keeps the turn timer online-only", () => {
    render(<RulesPage />);
    fireEvent.click(screen.getByTestId("rules-modifiers"));
    expect(screen.getByTestId("rules-turn-timer-offline")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modifiers-close"));
    act(() => { sessionConfigStore.getState().setMode("online"); withRandomMap(); });
    fireEvent.click(screen.getByTestId("rules-modifiers"));
    fireEvent.click(screen.getByTestId("rules-turn-timer-120"));
    expect(sessionConfigStore.getState().rules.turnSeconds).toBe(120);
  });

  it("sets ready and routes into the game from BATTLE", () => {
    render(<RulesPage />);
    fireEvent.click(screen.getByTestId("rules-battle"));
    expect(sessionConfigStore.getState().ready).toBe(true);
    expect(routerMock.push).toHaveBeenCalledWith("/play/solo");

    act(() => { sessionConfigStore.getState().setMode("pass-and-play"); withRandomMap(); });
    fireEvent.click(screen.getByTestId("rules-battle"));
    expect(routerMock.push).toHaveBeenLastCalledWith("/play/pass-and-play");
  });
});
