import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GameTypeCard } from "./GameTypeCard";
import { HandOffOverlay } from "./HandOffOverlay";
import { ModifierToggle } from "./ModifierToggle";

describe("HandOffOverlay", () => {
  it("is a modal dialog carrying the verbatim copy and the seat name", () => {
    render(<HandOffOverlay playerName="Wily Scout 31" colour="blue" onContinue={() => {}} />);
    const overlay = screen.getByTestId("handoff-overlay");
    expect(overlay).toHaveAttribute("role", "dialog");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(overlay).toHaveTextContent("Pass the device to");
    expect(screen.getByTestId("handoff-name")).toHaveTextContent("Wily Scout 31");
    expect(screen.getByTestId("handoff-continue")).toHaveTextContent("CONTINUE");
  });

  it("is purely presentational: CONTINUE only calls back, nothing dismisses itself", () => {
    const onContinue = vi.fn();
    render(<HandOffOverlay playerName="Bold General 42" colour="red" onContinue={onContinue} />);
    fireEvent.click(screen.getByTestId("handoff-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    // still mounted — the caller owns the dismissal
    expect(screen.getByTestId("handoff-overlay")).toBeInTheDocument();
  });

  it("is tinted with the owner's colour", () => {
    render(<HandOffOverlay playerName="Grim Warden" colour="purple" onContinue={() => {}} />);
    expect(screen.getByTestId("handoff-overlay")).toHaveAttribute("data-colour", "purple");
  });
});

describe("GameTypeCard", () => {
  it("renders the title, the description and the `?` info circle", () => {
    render(
      <GameTypeCard
        title="Solo"
        description="Battle the AI"
        icon="person"
        selected={false}
        onSelect={() => {}}
        testId="game-type-solo"
      />,
    );
    expect(screen.getByTestId("game-type-solo")).toHaveTextContent("Solo");
    expect(screen.getByTestId("game-type-solo")).toHaveTextContent("Battle the AI");
    expect(screen.getByTestId("game-type-solo-info")).toBeInTheDocument();
    expect(screen.getByTestId("icon-person")).toBeInTheDocument();
  });

  it("adds the sparkle and the straddling green ✓ when selected", () => {
    const { rerender } = render(
      <GameTypeCard title="Online" description="Casual games with other players" icon="globe"
        selected={false} onSelect={() => {}} testId="game-type-online" />,
    );
    expect(screen.queryByTestId("game-type-online-check")).toBeNull();
    rerender(
      <GameTypeCard title="Online" description="Casual games with other players" icon="globe"
        selected onSelect={() => {}} testId="game-type-online" />,
    );
    expect(screen.getByTestId("game-type-online-check")).toBeInTheDocument();
    expect(screen.getByTestId("game-type-online-sparkle")).toBeInTheDocument();
    expect(screen.getByTestId("game-type-online")).toHaveAttribute("aria-checked", "true");
  });
});

describe("ModifierToggle", () => {
  it("is a 68×68 radius-18 switch with its label beneath", () => {
    render(<ModifierToggle modifierKey="blizzards" label="Blizzards" icon="snowflake" on={false} onToggle={() => {}} />);
    const toggle = screen.getByTestId("modifier-blizzards");
    expect(toggle).toHaveAttribute("role", "switch");
    expect(toggle).toHaveStyle({ width: "68px", height: "68px", borderRadius: "18px" });
    expect(screen.getByTestId("modifier-blizzards-label")).toHaveTextContent("Blizzards");
  });

  it("is --danger when on and desaturated grey-blue when off", () => {
    const { rerender } = render(
      <ModifierToggle modifierKey="fog-of-war" label="Fog of War" icon="question" on={false} onToggle={() => {}} />,
    );
    expect(screen.getByTestId("modifier-fog-of-war")).toHaveStyle({ background: "var(--chrome-700)" });
    rerender(<ModifierToggle modifierKey="fog-of-war" label="Fog of War" icon="question" on onToggle={() => {}} />);
    expect(screen.getByTestId("modifier-fog-of-war")).toHaveStyle({ background: "var(--danger)" });
    expect(screen.getByTestId("modifier-fog-of-war")).toHaveAttribute("aria-checked", "true");
  });

  it("reports the flipped value", () => {
    const onToggle = vi.fn();
    render(<ModifierToggle modifierKey="capitals" label="Capitals" icon="capital" on={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("modifier-capitals"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
