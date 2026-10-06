/** The HUD: roster, action bar, chrome and the turn timer (SPEC §7.1). */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { ActionBar, PIP_PHASES, phaseLabelFor, primaryLabelFor } from "./ActionBar";
import { BottomLeftStack, OverlayToolbar, TitlePill, UtilityButtons } from "./HudChrome";
import { Roster } from "./Roster";
import type { RosterRow } from "./RosterCapsule";
import { TurnTimerBar, secondsLeft, timerFraction } from "./TurnTimerBar";

function row(patch: Partial<RosterRow> = {}): RosterRow {
  return {
    seat: 0, name: "Ada", colour: "red", standing: "active", bot: false, you: true, active: true,
    troops: 39, territories: 15, cards: 2, ...patch,
  };
}

describe("the roster (D44)", () => {
  it("stacks the capsules on the right edge, not in a top bar", () => {
    render(<Roster rows={[row(), row({ seat: 1, name: "Bo", colour: "green", you: false, active: false })]} />);
    const roster = screen.getByTestId("roster");
    expect(roster).toHaveAttribute("data-orientation", "vertical");
    expect(roster.className).toContain("right-0");
    expect(within(roster).getAllByTestId(/^roster-row-/)).toHaveLength(2);
  });

  it("shows the troop and territory counts", () => {
    render(<Roster rows={[row()]} />);
    expect(screen.getByTestId("roster-troops-0")).toHaveTextContent("39");
    expect(screen.getByTestId("roster-territories-0")).toHaveTextContent("15");
  });

  it("reads ??? for both counts under Fog of War (R73, F52)", () => {
    render(<Roster rows={[row({ troops: null, territories: null })]} />);
    expect(screen.getByTestId("roster-troops-0")).toHaveTextContent("???");
    expect(screen.getByTestId("roster-territories-0")).toHaveTextContent("???");
  });

  it("marks the active seat and gives it the chevron tab", () => {
    render(<Roster rows={[row(), row({ seat: 1, active: false, you: false })]} />);
    expect(screen.getByTestId("roster-row-0")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("roster-active-tab-0")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-active-tab-1")).toBeNull();
  });

  it("carries the tilted card tag only when the seat holds cards", () => {
    render(<Roster rows={[row({ cards: 3 }), row({ seat: 1, cards: 0, active: false, you: false })]} />);
    expect(screen.getByTestId("roster-cards-0")).toHaveTextContent("3");
    expect(screen.getByTestId("roster-cards-0").style.transform).toBe("rotate(-12deg)");
    expect(screen.queryByTestId("roster-cards-1")).toBeNull();
  });

  it("desaturates an eliminated seat", () => {
    render(<Roster rows={[row({ standing: "eliminated" })]} />);
    expect(screen.getByTestId("roster-row-0").className).toContain("saturate-50");
    expect(screen.getByTestId("roster-row-0")).toHaveAttribute("data-standing", "eliminated");
  });

  it("draws a presence dot only when the game is online", () => {
    render(<Roster rows={[row({ online: true }), row({ seat: 1, active: false, you: false })]} />);
    expect(screen.getByTestId("roster-presence-0")).toHaveAttribute("data-online", "true");
    expect(screen.queryByTestId("roster-presence-1")).toBeNull();
  });

  it("pops a chat balloon to the LEFT of the capsule (§7.3)", () => {
    render(<Roster rows={[row()]} balloons={{ 0: "NO DICE!" }} />);
    const balloon = screen.getByTestId("roster-balloon-0");
    expect(balloon).toHaveTextContent("NO DICE!");
    expect(balloon.className).toContain("right-full");
  });

  it("becomes a horizontal strip in portrait (§8 Responsive)", () => {
    render(<Roster rows={[row()]} orientation="horizontal" />);
    expect(screen.getByTestId("roster")).toHaveAttribute("data-orientation", "horizontal");
  });
});

describe("the action bar", () => {
  const base = {
    phase: "attack" as const, phaseLabel: "ATTACK", prompt: "Select an adjacent territory to attack",
    seatName: "Ada", colour: "red" as const, you: true, bot: false,
    primaryLabel: "End Attack Phase", primaryDisabled: false,
    onPrimary: () => {}, onDice: () => {},
  };

  it("shows the phase label, the prompt and the primary pill", () => {
    render(<ActionBar {...base} />);
    expect(screen.getByTestId("phase-label")).toHaveTextContent("ATTACK");
    expect(screen.getByTestId("action-prompt"))
      .toHaveTextContent("Select an adjacent territory to attack");
    expect(screen.getByTestId("primary-action")).toHaveTextContent("End Attack Phase");
  });

  it("draws three pips as a progress bar, not tabs", () => {
    render(<ActionBar {...base} />);
    const pips = screen.getByTestId("phase-pips");
    expect(within(pips).getAllByTestId(/^phase-pip-/)).toHaveLength(3);
    expect(screen.getByTestId("phase-pip-draft")).toHaveAttribute("data-filled", "true");
    expect(screen.getByTestId("phase-pip-attack")).toHaveAttribute("data-filled", "true");
    expect(screen.getByTestId("phase-pip-fortify")).toHaveAttribute("data-filled", "false");
    expect(PIP_PHASES).toEqual(["draft", "attack", "fortify"]);
  });

  it("measures the pips at 92×12 with a 12 px gap", () => {
    render(<ActionBar {...base} />);
    const pip = screen.getByTestId("phase-pip-draft");
    expect(pip.style.width).toBe("92px");
    expect(pip.style.height).toBe("12px");
    expect(pip.style.borderRadius).toBe("6px");
    expect(screen.getByTestId("phase-pips").style.gap).toBe("12px");
  });

  it("fires the primary action", () => {
    const onPrimary = vi.fn();
    render(<ActionBar {...base} onPrimary={onPrimary} />);
    fireEvent.click(screen.getByTestId("primary-action"));
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("shows the turn timer only when the authority supplied a deadline", () => {
    const { rerender } = render(<ActionBar {...base} />);
    expect(screen.queryByTestId("turn-timer")).toBeNull();
    rerender(<ActionBar {...base} turnDeadline="2030-01-01T00:01:00.000Z" turnSeconds={90}
      now={Date.parse("2030-01-01T00:00:30.000Z")} />);
    expect(screen.getByTestId("turn-timer")).toBeInTheDocument();
  });
});

describe("primaryLabelFor (§7.1)", () => {
  const base = {
    phase: "draft" as const, yourTurn: true, botPlaying: false, mustTrade: false,
    tradeValue: 10, canTrade: true, troopsToPlace: 0, pendingMoveIn: false,
  };

  it("reads Opponent's Turn when it is not yours", () => {
    expect(primaryLabelFor({ ...base, yourTurn: false }))
      .toEqual({ label: "Opponent's Turn", disabled: true });
  });

  it("reads Opponent's Turn while a bot plays", () => {
    expect(primaryLabelFor({ ...base, botPlaying: true }).disabled).toBe(true);
  });

  it("disables End Draft Phase while troops remain (R17)", () => {
    expect(primaryLabelFor({ ...base, troopsToPlace: 3 }))
      .toEqual({ label: "End Draft Phase", disabled: true });
    expect(primaryLabelFor(base)).toEqual({ label: "End Draft Phase", disabled: false });
  });

  it("reads Trade In Now +N on a forced trade", () => {
    expect(primaryLabelFor({ ...base, mustTrade: true, tradeValue: 10 }))
      .toEqual({ label: "Trade In Now +10", disabled: false });
  });

  it("reads No Matching Cards when a forced trade has no set", () => {
    expect(primaryLabelFor({ ...base, mustTrade: true, canTrade: false }))
      .toEqual({ label: "No Matching Cards", disabled: true });
  });

  it("reads End Attack Phase and End Turn in their phases", () => {
    expect(primaryLabelFor({ ...base, phase: "attack" }).label).toBe("End Attack Phase");
    expect(primaryLabelFor({ ...base, phase: "fortify" }).label).toBe("End Turn");
  });

  it("asks for the move-in first when one is pending (R63)", () => {
    expect(primaryLabelFor({ ...base, phase: "attack", pendingMoveIn: true }).label).toBe("Move Troops");
  });
});

describe("phaseLabelFor", () => {
  it("upper-cases the three phases", () => {
    expect(phaseLabelFor("draft", false)).toBe("DRAFT");
    expect(phaseLabelFor("attack", false)).toBe("ATTACK");
    expect(phaseLabelFor("fortify", false)).toBe("FORTIFY");
  });

  it("reads CAPITAL in Capitals mode during the claim phase", () => {
    expect(phaseLabelFor("claim", true)).toBe("CAPITAL");
    expect(phaseLabelFor("claim", false)).toBe("CLAIM");
  });
});

describe("the HUD chrome", () => {
  it("draws three outline-only utility buttons", () => {
    render(<UtilityButtons onSettings={() => {}} onHelp={() => {}} onDiceSettings={() => {}} />);
    expect(screen.getByTestId("utility-settings")).toBeInTheDocument();
    expect(screen.getByTestId("utility-help")).toBeInTheDocument();
    expect(screen.getByTestId("utility-dice")).toBeInTheDocument();
    expect(screen.queryByTestId("sync-status")).toBeNull();
  });

  it("adds the connection glyph online only", () => {
    render(<UtilityButtons onSettings={() => {}} onHelp={() => {}} onDiceSettings={() => {}}
      syncStatus="polling" />);
    expect(screen.getByTestId("sync-status")).toHaveAttribute("data-status", "polling");
  });

  it("hides the title pill when there is nothing to say", () => {
    const { rerender } = render(<TitlePill text="" />);
    expect(screen.queryByTestId("title-pill")).toBeNull();
    rerender(<TitlePill text="Ada — round 2" />);
    expect(screen.getByTestId("title-pill")).toHaveTextContent("Ada — round 2");
  });

  it("badges the cards chip only when a trade is available", () => {
    const props = { cardCount: 4, unreadChat: 0, onStats: () => {}, onCards: () => {}, onChat: () => {} };
    const { rerender } = render(<BottomLeftStack {...props} tradeAvailable={false} />);
    expect(screen.getByTestId("cards-chip")).toHaveTextContent("4");
    expect(screen.queryByTestId("cards-badge")).toBeNull();
    rerender(<BottomLeftStack {...props} tradeAvailable />);
    expect(screen.getByTestId("cards-badge")).toBeInTheDocument();
  });

  it("tilts the cards chip by −8°", () => {
    render(<BottomLeftStack cardCount={1} tradeAvailable={false} unreadChat={0}
      onStats={() => {}} onCards={() => {}} onChat={() => {}} />);
    expect(screen.getByTestId("cards-chip").style.transform).toBe("rotate(-8deg)");
  });

  it("badges unread chat", () => {
    render(<BottomLeftStack cardCount={0} tradeAvailable={false} unreadChat={3}
      onStats={() => {}} onCards={() => {}} onChat={() => {}} />);
    expect(screen.getByTestId("chat-badge")).toHaveTextContent("3");
  });

  it("hides the overlay toolbar until an overlay is open", () => {
    const { rerender } = render(<OverlayToolbar mode="none" onMode={() => {}} />);
    expect(screen.queryByTestId("overlay-toolbar")).toBeNull();
    rerender(<OverlayToolbar mode="continents" onMode={() => {}} />);
    expect(screen.getByTestId("overlay-toolbar")).toBeInTheDocument();
  });

  it("marks the active overlay toggle gold and closes through the ✗", () => {
    const onMode = vi.fn();
    render(<OverlayToolbar mode="continents" onMode={onMode} />);
    expect(screen.getByTestId("overlay-continents")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("overlay-troops")).toHaveAttribute("data-active", "false");
    fireEvent.click(screen.getByTestId("overlay-close"));
    expect(onMode).toHaveBeenCalledWith("none");
  });
});

describe("the turn timer (D69)", () => {
  const deadline = "2030-01-01T00:01:30.000Z";
  const start = Date.parse("2030-01-01T00:00:00.000Z");

  it("drains from full to empty over the turn", () => {
    expect(timerFraction(deadline, 90, start)).toBeCloseTo(1, 6);
    expect(timerFraction(deadline, 90, start + 45_000)).toBeCloseTo(0.5, 6);
    expect(timerFraction(deadline, 90, start + 90_000)).toBeCloseTo(0, 6);
  });

  it("clamps past the deadline rather than going negative", () => {
    expect(timerFraction(deadline, 90, start + 200_000)).toBe(0);
    expect(secondsLeft(deadline, start + 200_000)).toBe(0);
  });

  it("goes urgent under ten seconds", () => {
    render(<TurnTimerBar deadline={deadline} totalSeconds={90} now={start + 85_000} />);
    expect(screen.getByTestId("turn-timer")).toHaveAttribute("data-urgent", "true");
  });

  it("is calm above ten seconds", () => {
    render(<TurnTimerBar deadline={deadline} totalSeconds={90} now={start} />);
    expect(screen.getByTestId("turn-timer")).toHaveAttribute("data-urgent", "false");
  });

  it("renders nothing offline", () => {
    render(<TurnTimerBar deadline={null} totalSeconds={null} />);
    expect(screen.queryByTestId("turn-timer")).toBeNull();
  });

  it("is a 4 px bar, never a ring", () => {
    render(<TurnTimerBar deadline={deadline} totalSeconds={90} now={start} />);
    expect(screen.getByTestId("turn-timer").style.height).toBe("4px");
  });
});
