import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { BlitzView, type BlitzViewProps, type DiceChoice } from "./BlitzView";

const BASE: BlitzViewProps = {
  attacker: { name: "Solace", colour: "red", troops: 7, you: true, bot: false },
  defender: { name: "Bot 3", colour: "purple", troops: 3, you: false, bot: true },
  winChance: 0.91,
  ramp: false,
  dice: "blitz",
  maxDice: 3,
  onDice: () => {},
  attackLimit: null,
  onAttackLimit: () => {},
  onBattle: () => {},
  onCancel: () => {},
};

function renderBlitz(patch: Partial<BlitzViewProps> = {}) {
  return render(<BlitzView {...BASE} {...patch} />);
}

describe("BlitzView", () => {
  it("is a full-screen takeover carrying the two measured labels", () => {
    renderBlitz();
    expect(screen.getByTestId("blitz-view")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/Blitz Win Chance/)).toBeInTheDocument();
    expect(screen.getByText(/Attack Limit/)).toBeInTheDocument();
    expect(screen.getByTestId("blitz-win-chance")).toHaveTextContent("91%");
  });

  it("keeps the win chance constant gold at EVERY probability when the ramp is off", () => {
    for (const chance of [0.06, 0.46, 0.91, 1]) {
      const { unmount } = renderBlitz({ winChance: chance });
      const readout = screen.getByTestId("blitz-win-chance");
      expect(readout.dataset["colour"]).toBe("var(--gold)");
      expect(readout).toHaveTextContent(`${Math.round(chance * 100)}%`);
      unmount();
    }
  });

  it("applies the opt-in ramp only when the setting is on", () => {
    const { unmount } = renderBlitz({ winChance: 0.91, ramp: true });
    expect(screen.getByTestId("blitz-win-chance").dataset["colour"]).toBe("var(--ok)");
    unmount();
    renderBlitz({ winChance: 0.06, ramp: true });
    expect(screen.getByTestId("blitz-win-chance").dataset["colour"]).toBe("var(--danger)");
  });

  it("cycles Blitz → 1 → 2 → 3 → Blitz on the forward stepper", () => {
    const seen: DiceChoice[] = [];
    const onDice = vi.fn((next: DiceChoice) => seen.push(next));
    for (const dice of ["blitz", 1, 2, 3] as const) {
      const { unmount } = renderBlitz({ dice, onDice });
      fireEvent.click(screen.getByTestId("blitz-dice-stepper-next"));
      unmount();
    }
    expect(seen).toEqual([1, 2, 3, "blitz"]);
  });

  it("runs the cycle backwards on the back stepper", () => {
    const seen: DiceChoice[] = [];
    const onDice = vi.fn((next: DiceChoice) => seen.push(next));
    for (const dice of ["blitz", 1, 2, 3] as const) {
      const { unmount } = renderBlitz({ dice, onDice });
      fireEvent.click(screen.getByTestId("blitz-dice-stepper-prev"));
      unmount();
    }
    expect(seen).toEqual([3, "blitz", 1, 2]);
  });

  it("never offers more dice than maxDice", () => {
    const onDice = vi.fn();
    renderBlitz({ dice: 2, maxDice: 2, onDice });
    fireEvent.click(screen.getByTestId("blitz-dice-stepper-next"));
    expect(onDice).toHaveBeenCalledWith("blitz");
  });

  it("shows `Blitz` under the dice until a count is chosen", () => {
    const { unmount } = renderBlitz({ dice: "blitz" });
    expect(screen.getByTestId("blitz-dice-label")).toHaveTextContent("Blitz");
    unmount();
    renderBlitz({ dice: 3 });
    expect(screen.getByTestId("blitz-dice-label")).toHaveTextContent("3");
  });

  it("reports the limiter's stopUntil from the Attack Limit slider", () => {
    const onAttackLimit = vi.fn();
    renderBlitz({ onAttackLimit });
    const slider = screen.getByTestId("attack-limit");
    expect(slider).toHaveAttribute("aria-label", "Attack Limit");
    expect(slider).toHaveAttribute("max", "6");
    fireEvent.change(slider, { target: { value: "4" } });
    expect(onAttackLimit).toHaveBeenCalledWith(4);
  });

  it("reads the committed troops back out of the limiter", () => {
    const { unmount } = renderBlitz({ attackLimit: null });
    expect(screen.getByTestId("blitz-committed")).toHaveTextContent("7/7 Troops");
    expect(screen.getByText("100%")).toBeInTheDocument();
    unmount();
    renderBlitz({ attackLimit: 4 });
    expect(screen.getByTestId("blitz-committed")).toHaveTextContent("3/7 Troops");
  });

  it("commits through the green BATTLE pill and backs out through the ✗", () => {
    const onBattle = vi.fn();
    const onCancel = vi.fn();
    renderBlitz({ onBattle, onCancel });
    const battle = screen.getByTestId("blitz-battle");
    expect(battle).toHaveTextContent("BATTLE");
    fireEvent.click(battle);
    expect(onBattle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("blitz-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("throws three dice and flags the bot defender", () => {
    renderBlitz();
    expect(screen.getByTestId("blitz-die-0")).toBeInTheDocument();
    expect(screen.getByTestId("blitz-die-1")).toBeInTheDocument();
    expect(screen.getByTestId("blitz-die-2")).toBeInTheDocument();
    expect(screen.getByTestId("blitz-attacker-chip")).toHaveTextContent("7");
    expect(screen.getByTestId("blitz-defender-chip")).toHaveTextContent("3");
  });
});
