import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Settings } from "@/ports/settings";
import { continentVar } from "@/render/palette";

import { ContinentLegend } from "./ContinentLegend";
import { EliminationBanner } from "./EliminationBanner";
import { EndTurnConfirm } from "./EndTurnConfirm";
import { GetReadyOverlay } from "./GetReadyOverlay";
import { ManualDiceView } from "./ManualDiceView";
import { ReceivedTroops } from "./ReceivedTroops";
import { SettingsDialog } from "./SettingsDialog";
import { TipCard } from "./TipCard";
import { VictoryOverlay } from "./VictoryOverlay";

describe("EndTurnConfirm", () => {
  it("carries all three strings verbatim", () => {
    render(<EndTurnConfirm onYes={vi.fn()} onNo={vi.fn()} />);
    expect(screen.getByTestId("end-turn-confirm")).toBeInTheDocument();
    expect(screen.getByText("End Turn")).toBeInTheDocument();
    expect(screen.getByText("Skip Fortify phase?")).toBeInTheDocument();
    expect(screen.getByText("(This confirmation can be turned off in game settings)"))
      .toBeInTheDocument();
  });

  it("answers through the two circular buttons", () => {
    const onYes = vi.fn();
    const onNo = vi.fn();
    render(<EndTurnConfirm onYes={onYes} onNo={onNo} />);
    fireEvent.click(screen.getByTestId("end-turn-yes"));
    expect(onYes).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("end-turn-no"));
    expect(onNo).toHaveBeenCalledTimes(1);
  });
});

describe("GetReadyOverlay", () => {
  it("interpolates the seat number and the colour into both verbatim lines", () => {
    render(<GetReadyOverlay playerNumber={2} name="Solace" colour="red" />);
    expect(screen.getByTestId("get-ready")).toBeInTheDocument();
    expect(screen.getByTestId("get-ready-line-1"))
      .toHaveTextContent("You are player 2 – General of the Red Troops");
    expect(screen.getByTestId("get-ready-line-2"))
      .toHaveTextContent("Each turn you will DRAFT > ATTACK > FORTIFY.");
  });

  it("puts a filled colour disc before the colour word", () => {
    render(<GetReadyOverlay playerNumber={4} name="Ada" colour="purple" />);
    expect(screen.getByTestId("get-ready-disc").style.background).toContain("--p-purple");
    expect(screen.getByTestId("get-ready-line-1"))
      .toHaveTextContent("You are player 4 – General of the Purple Troops");
  });
});

describe("ReceivedTroops", () => {
  it("titles the three variants of the one popup", () => {
    const common = { name: "Solace", colour: "red", you: true, total: 3, territories: 10 } as const;
    const { unmount } = render(<ReceivedTroops variant="received" {...common} />);
    expect(screen.getByTestId("received-troops-header")).toHaveTextContent("Received Troops");
    unmount();
    const second = render(<ReceivedTroops variant="troopBonus" {...common} />);
    expect(screen.getByTestId("received-troops-header")).toHaveTextContent("Troop Bonus!");
    second.unmount();
    render(<ReceivedTroops variant="territoryBonus" {...common} />);
    expect(screen.getByTestId("received-troops-header"))
      .toHaveTextContent("Territory Card Bonus!");
  });

  it("rings the total and spells out the award line", () => {
    render(<ReceivedTroops variant="received" name="Solace" colour="red" you total={3}
      territories={10} />);
    expect(screen.getByTestId("received-troops-ring").dataset["value"]).toBe("3");
    expect(screen.getByText("Total troops")).toBeInTheDocument();
    expect(screen.getByTestId("received-troops-award"))
      .toHaveTextContent("Troops awarded for occupying 10 territories");
  });

  it("flags the viewer's own turn in the owner-coloured banner", () => {
    const { unmount } = render(<ReceivedTroops variant="received" name="Solace" colour="red" you
      total={3} territories={10} />);
    expect(screen.getByTestId("received-troops-banner")).toHaveTextContent("Solace turn (YOU)");
    unmount();
    render(<ReceivedTroops variant="received" name="Bot 2" colour="blue" you={false} total={5}
      territories={14} />);
    expect(screen.getByTestId("received-troops-banner")).toHaveTextContent("Bot 2 turn");
  });

  it("is a centred plate, not a full-bleed band (bt1-0055: x 428–1172, h 78)", () => {
    render(<ReceivedTroops variant="received" name="Solace" colour="red" you total={3}
      territories={10} />);
    const banner = screen.getByTestId("received-troops-banner");
    expect(banner.style.width).toBe("744px");
    expect(banner.style.height).toBe("78px");
    expect(banner.style.left).toBe("26.75%");
  });

  it("gives a bot only the turn banner — no scrim, no ring, no dialog", () => {
    render(<ReceivedTroops variant="received" name="Bot 1" colour="green" you={false} total={4}
      territories={12} bannerOnly />);
    expect(screen.getByTestId("received-troops-banner")).toHaveTextContent("Bot 1 turn");
    expect(screen.queryByTestId("received-troops-ring")).toBeNull();
    expect(screen.queryByTestId("received-troops-header")).toBeNull();
    expect(screen.queryByTestId("received-troops-award")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const root = screen.getByTestId("received-troops");
    expect(root).toHaveAttribute("data-banner-only", "true");
    expect(root.style.pointerEvents).toBe("none");
  });
});

describe("VictoryOverlay", () => {
  it("shows the title and the subtitle verbatim", () => {
    render(<VictoryOverlay name="Solace" colour="red" />);
    expect(screen.getByTestId("victory-overlay")).toBeInTheDocument();
    expect(screen.getByText("Victory!")).toBeInTheDocument();
    expect(screen.getByText("You conquered all your opponents!")).toBeInTheDocument();
  });

  it("mirrors Defeated! with a desaturated portrait", () => {
    render(<VictoryOverlay name="Solace" colour="red" defeated />);
    expect(screen.getByText("Defeated!")).toBeInTheDocument();
    expect(screen.queryByTestId("victory-subtitle")).toBeNull();
    const portrait = screen.getByTestId("victory-portrait").parentElement;
    expect(portrait?.style.filter).toContain("grayscale");
  });

  it("adds the tiebreak line on a Max-Rounds win", () => {
    const { unmount } = render(<VictoryOverlay name="Solace" colour="red" />);
    expect(screen.queryByTestId("victory-tiebreak")).toBeNull();
    unmount();
    render(<VictoryOverlay name="Solace" colour="red" reason="maxRounds" round={5} />);
    expect(screen.getByTestId("victory-tiebreak"))
      .toHaveTextContent("Most territories at the end of round 5");
  });

  it("fans ~24 five-pointed stars", () => {
    render(<VictoryOverlay name="Solace" colour="red" />);
    expect(screen.getByTestId("victory-stars").querySelectorAll("path")).toHaveLength(24);
  });
});

describe("SettingsDialog", () => {
  const SETTINGS: Settings = {
    cameraAnimations: true, phaseAnimations: true, endPhaseConfirmation: true,
    sound: true, music: false, colourPatterns: false, winChanceRamp: false,
  };

  it("is a modal, not a route", () => {
    render(<SettingsDialog settings={SETTINGS} onChange={vi.fn()} onChangeName={vi.fn()}
      onResign={vi.fn()} onLeave={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByTestId("settings-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("toggles all seven settings through onChange", () => {
    const onChange = vi.fn();
    render(<SettingsDialog settings={SETTINGS} onChange={onChange} onChangeName={vi.fn()}
      onResign={vi.fn()} onLeave={vi.fn()} onClose={vi.fn()} />);
    const expected: readonly [keyof Settings, boolean][] = [
      ["cameraAnimations", false], ["phaseAnimations", false], ["endPhaseConfirmation", false],
      ["sound", false], ["music", true], ["colourPatterns", true], ["winChanceRamp", true],
    ];
    for (const [key, next] of expected) {
      fireEvent.click(screen.getByTestId(`setting-${key}`));
      expect(onChange).toHaveBeenLastCalledWith({ [key]: next });
    }
    expect(onChange).toHaveBeenCalledTimes(7);
  });

  it("reports each toggle's state to assistive tech", () => {
    render(<SettingsDialog settings={SETTINGS} onChange={vi.fn()} onChangeName={vi.fn()}
      onResign={vi.fn()} onLeave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("setting-cameraAnimations")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("setting-music")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("End Phase Confirmation")).toBeInTheDocument();
    expect(screen.getByLabelText("Win-chance colour ramp")).toBeInTheDocument();
  });

  it("offers Change display name and the resign / leave actions", () => {
    const onChangeName = vi.fn();
    const onResign = vi.fn();
    const onLeave = vi.fn();
    render(<SettingsDialog settings={SETTINGS} onChange={vi.fn()} onChangeName={onChangeName}
      onResign={onResign} onLeave={onLeave} onClose={vi.fn()} />);
    const rename = screen.getByTestId("settings-change-name");
    expect(rename).toHaveTextContent("Change display name");
    fireEvent.click(rename);
    expect(onChangeName).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("settings-resign"));
    expect(onResign).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("settings-leave"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("ContinentLegend", () => {
  const ENTRIES = [
    { name: "North America", bonus: 5, held: 3, total: 9, at: { x: 400, y: 260 },
      colour: continentVar(0) },
    { name: "South America", bonus: 2, held: 4, total: 4, at: { x: 460, y: 520 },
      colour: continentVar(1) },
  ];

  it("draws a 33% arc for 3/9, from 12 o'clock clockwise", () => {
    render(<ContinentLegend entries={ENTRIES} />);
    const badge = screen.getByTestId("continent-legend-North America");
    const arc = badge.querySelector<SVGCircleElement>("[data-testid='continent-arc']");
    expect(arc?.getAttribute("data-percent")).toBe("33");
    expect(arc?.getAttribute("transform")).toContain("rotate(-90");
    const circumference = 2 * Math.PI * (36 - 7 / 2);
    const [dash] = (arc?.getAttribute("stroke-dasharray") ?? "").split(" ");
    expect(Number(dash)).toBeCloseTo(0.33 * circumference, 1);
  });

  it("captions each continent `held/total (pct%)` and plates its name and bonus", () => {
    render(<ContinentLegend entries={ENTRIES} />);
    expect(screen.getByTestId("continent-caption-North America")).toHaveTextContent("3/9 (33%)");
    expect(screen.getByTestId("continent-caption-South America")).toHaveTextContent("4/4 (100%)");
    expect(screen.getByText("North America")).toBeInTheDocument();
    expect(screen.getByTestId("continent-legend-North America")).toHaveTextContent("+5");
  });

  it("positions each badge at its centroid in raw map units", () => {
    render(<ContinentLegend entries={ENTRIES} />);
    const badge = screen.getByTestId("continent-legend-South America");
    expect(badge.style.left).toBe("460px");
    expect(badge.style.top).toBe("520px");
  });
});

describe("TipCard", () => {
  it("is modal and dismisses on tap, with no corner toast anywhere", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <TipCard text="Hold a whole continent to earn its bonus." onDismiss={onDismiss} />,
    );
    const tip = screen.getByTestId("tip-card");
    expect(tip).toHaveAttribute("role", "dialog");
    expect(tip).toHaveAttribute("aria-modal", "true");
    expect(container.querySelector("[data-testid*='toast']")).toBeNull();
    expect(container.querySelector("[class*='toast']")).toBeNull();
    fireEvent.click(screen.getByTestId("tip-card-body"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("clamps the body copy to two lines", () => {
    render(<TipCard text="One two three four." onDismiss={vi.fn()} />);
    const body = screen.getByText("One two three four.");
    expect(body.style.webkitLineClamp).toBe("2");
  });
});

describe("EliminationBanner", () => {
  it("announces the seizure and flies one card per seized card", () => {
    render(<EliminationBanner seat={2} by={0} name="Bot 2" colour="blue" cards={3}
      onDone={vi.fn()} />);
    expect(screen.getByText("Territory Cards Seized!")).toBeInTheDocument();
    expect(screen.getAllByTestId("seized-card")).toHaveLength(3);
    expect(screen.getByTestId("elimination-count")).toHaveTextContent("+3");
  });
});

describe("ManualDiceView", () => {
  it("throws the same cubes onto the board and settles face-up", () => {
    render(<ManualDiceView attacker={[6, 4, 2]} defender={[5, 1]} at={{ x: 300, y: 420 }}
      onDone={vi.fn()} />);
    const view = screen.getByTestId("manual-dice");
    expect(view.style.left).toBe("300px");
    expect(view.style.top).toBe("420px");
    expect(screen.getByTestId("manual-dice-cube-attacker-0").dataset["pips"]).toBe("6");
    expect(screen.getByTestId("manual-dice-cube-defender-1").dataset["pips"]).toBe("1");
  });

  it("reports done once the last cube has settled", () => {
    const onDone = vi.fn();
    render(<ManualDiceView attacker={[6, 4]} defender={[5]} at={{ x: 0, y: 0 }} onDone={onDone} />);
    fireEvent.animationEnd(screen.getByTestId("manual-die-attacker-0"), { bubbles: true });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.animationEnd(screen.getByTestId("manual-die-attacker-1"), { bubbles: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
