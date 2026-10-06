/**
 * The whole game screen, mounted against the scripted engine — the shape S5
 * composes (SPEC §7, F26).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { PresenceRow } from "@/ports/sync";
import { HOTSEAT_SEATS, SOLO_SEATS, makeSession, manualScheduler } from "@/game/__fixtures__/harness";
import type { Session } from "@/game/session";
import { engineApi } from "@/game/engineApi";

import GameScreen from "./GameScreen";

const sessions: Session[] = [];

/** jsdom has no `PointerEvent` constructor; `input.test.ts` builds them the same way. */
function pointerEvent(type: string, id: number, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: id },
    clientX: { value: x },
    clientY: { value: y },
    pointerType: { value: "mouse" },
  });
  return event;
}

afterEach(() => {
  for (const s of sessions.splice(0)) s.destroy();
});

function mountHotseat(options: Parameters<typeof makeSession>[0] = {}) {
  const h = makeSession({ seats: HOTSEAT_SEATS, schedule: manualScheduler().schedule, ...options });
  sessions.push(h.session);
  h.session.start();
  return h;
}

describe("GameScreen", () => {
  it("mounts the board, the roster and the action bar", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();
    expect(screen.getByTestId("board-stage")).toBeInTheDocument();
    expect(screen.getByTestId("roster")).toBeInTheDocument();
    expect(screen.getByTestId("action-bar")).toBeInTheDocument();
  });

  it("keeps a press alive across a stage resize (§9)", () => {
    /*
     * The regression this pins: `BoardCanvas`'s input effect used to depend on
     * the measured stage size, so every `ResizeObserver` tick detached the
     * pointer listeners and built a fresh `createInput` — `pointers` map and
     * all. A resize that landed **between a `pointerdown` and its
     * `pointerup`** lost the tap in silence, because the new handle had never
     * seen the press and `onPointerUp` returned before the hit test. Both
     * events still arrived at `#stage` and the hit test still resolved, which
     * is what made it read as "the session is ignoring taps".
     *
     * Resizes are routine: a phone rotating, a mobile URL bar collapsing
     * `100dvh`, a window dragged, and the document scrollbar the lobby has
     * and the board does not.
     */
    const ticks: (() => void)[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      private readonly cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        ticks.push(() => this.cb());
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    try {
      const h = mountHotseat();
      h.session.continueHandOff();
      const tap = vi.spyOn(h.session, "tapTerritory");
      render(<GameScreen session={h.session} />);

      const stage = screen.getByTestId("board-stage");
      const path = screen.getByTestId("board-wrapper").querySelector("[data-territory]")!;
      // jsdom has no layout, so the app's own hit test is stubbed the way
      // `input.test.ts` stubs it.
      (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint =
        () => path;

      stage.dispatchEvent(pointerEvent("pointerdown", 1, 40, 40));

      // The resize: a new measurement, then the observer's callback.
      stage.getBoundingClientRect = () =>
        ({ x: 0, y: 0, width: 800, height: 450, top: 0, left: 0, right: 800, bottom: 450 }) as DOMRect;
      act(() => {
        for (const tick of ticks) tick();
      });

      stage.dispatchEvent(pointerEvent("pointerup", 1, 40, 40));
      expect(tap, "a resize between down and up must not eat the tap").toHaveBeenCalledWith(
        Number(path.getAttribute("data-territory")),
      );
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("builds the board inside the wrapper, sized to the map's viewBox", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    const wrapper = screen.getByTestId("board-wrapper");
    const [, , w, hgt] = h.map.viewBox;
    expect(wrapper.style.width).toBe(`${w}px`);
    expect(wrapper.style.height).toBe(`${hgt}px`);
    expect(wrapper.querySelector("svg")).not.toBeNull();
  });

  it("draws one path per territory", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    const paths = screen.getByTestId("board-wrapper").querySelectorAll("[data-territory]");
    expect(paths).toHaveLength(h.map.territories.length);
  });

  it("gives one roster row per seat", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    expect(screen.getAllByTestId(/^roster-row-/)).toHaveLength(HOTSEAT_SEATS.length);
  });

  it("shows the hand-off overlay and hides the board behind it (§5.4)", () => {
    const h = mountHotseat();
    render(<GameScreen session={h.session} />);
    expect(screen.getByTestId("handoff-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("board-stage")).toHaveAttribute("data-hidden", "true");
    expect(screen.queryByTestId("roster")).toBeNull();
  });

  it("CONTINUE lifts the overlay and reveals the board", () => {
    const h = mountHotseat();
    render(<GameScreen session={h.session} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.queryByTestId("handoff-overlay")).toBeNull();
    expect(screen.getByTestId("board-stage")).toHaveAttribute("data-hidden", "false");
  });

  it("prints the verbatim draft prompt", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    expect(screen.getByTestId("action-prompt"))
      .toHaveTextContent("Tap any of your territories to begin deploying troops");
  });

  it("disables the primary pill while troops are undrafted (R17)", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    expect(screen.getByTestId("primary-action")).toHaveTextContent("End Draft Phase");
    expect(screen.getByTestId("primary-action")).toBeDisabled();
  });

  it("reads Opponent's Turn while a bot plays", () => {
    const h = makeSession({ seats: SOLO_SEATS, schedule: manualScheduler().schedule });
    sessions.push(h.session);
    h.session.start();
    render(<GameScreen session={h.session} />);
    if (h.session.store.getState().botPlaying) {
      expect(screen.getByTestId("primary-action")).toHaveTextContent("Opponent's Turn");
      expect(screen.getByTestId("primary-action")).toBeDisabled();
    }
  });

  it("opens the count dialog with the verbatim Deploy Troops title", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    const mine = h.session.view.territories.findIndex((t) => t.owner === h.session.store.getState().actingSeat);
    act(() => h.session.tapTerritory(mine));
    expect(screen.getByText("Deploy Troops")).toBeInTheDocument();
  });

  it("shows the Get Ready overlay at the top of a human turn", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    expect(screen.getByTestId("get-ready")).toBeInTheDocument();
  });

  it("opens the settings dialog from the ⚙ button", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    h.session.setModal(null);
    render(<GameScreen session={h.session} />);
    fireEvent.click(screen.getByTestId("utility-settings"));
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
  });

  it("opens the card panel from the cards chip", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    h.session.setModal(null);
    render(<GameScreen session={h.session} />);
    fireEvent.click(screen.getByTestId("cards-chip"));
    expect(screen.getByTestId("card-trade-panel")).toBeInTheDocument();
  });

  it("shows the overlay toolbar once an overlay is open", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    h.session.setModal(null);
    render(<GameScreen session={h.session} />);
    expect(screen.queryByTestId("overlay-toolbar")).toBeNull();
    act(() => h.session.setOverlay("continents"));
    expect(screen.getByTestId("overlay-toolbar")).toBeInTheDocument();
  });

  it("shows no connection glyph and no timer offline", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    render(<GameScreen session={h.session} />);
    expect(screen.queryByTestId("sync-status")).toBeNull();
    expect(screen.queryByTestId("turn-timer")).toBeNull();
  });

  it("renders presence dots and the timer bar from the online props (F26)", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    const presence: PresenceRow[] = HOTSEAT_SEATS.map((_, seat) => ({
      seat, standing: "active" as const, online: seat === 0, missedTurns: 0,
    }));
    render(
      <GameScreen
        session={h.session}
        presence={presence}
        turnDeadline={new Date(Date.now() + 60_000).toISOString()}
      />,
    );
    expect(screen.getByTestId("roster-presence-0")).toHaveAttribute("data-online", "true");
    expect(screen.getByTestId("roster-presence-1")).toHaveAttribute("data-online", "false");
    expect(screen.getByTestId("turn-timer")).toBeInTheDocument();
  });

  it("routes a chat line through onChat when the host supplies one", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    h.session.setModal(null);
    const onChat = vi.fn();
    h.session.store.setState({ chatOpen: true });
    render(<GameScreen session={h.session} chat={[]} onChat={onChat} />);
    fireEvent.click(screen.getByTestId("dialog-line-20"));
    expect(onChat).toHaveBeenCalledWith({ lineId: 20 });
  });

  it("writes to the session's own log when no onChat is supplied", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    h.session.setModal(null);
    h.session.store.setState({ chatOpen: true });
    render(<GameScreen session={h.session} />);
    fireEvent.click(screen.getByTestId("dialog-line-34"));
    expect(h.session.store.getState().chat.at(-1)?.lineId).toBe(34);
  });

  /*
   * R80 — the alliance affordance. It exists only when the rule is on, it never appears on the
   * viewer's own capsule, and every button dispatches through the session, so the same control
   * works online.
   */
  describe("the alliance popover", () => {
    function mountAllied() {
      const h = mountHotseat({ rules: { alliances: true }, engine: engineApi });
      h.session.continueHandOff();
      const me = h.session.mySeat();
      const them = h.session.confirmed().seats.find((s) => s.seat !== me)?.seat as number;
      return { h, me, them };
    }

    it("is absent while alliances are off", () => {
      const h = mountHotseat();
      h.session.continueHandOff();
      render(<GameScreen session={h.session} />);
      fireEvent.click(screen.getByTestId("roster-row-1"));
      expect(screen.queryByTestId("alliance-popover-1")).toBeNull();
    });

    it("opens on an opponent's capsule and offers Propose", () => {
      const { h, them } = mountAllied();
      render(<GameScreen session={h.session} />);
      fireEvent.click(screen.getByTestId(`roster-row-${them}`));
      expect(screen.getByTestId(`alliance-popover-${them}`)).toBeInTheDocument();
      expect(screen.getByTestId(`alliance-status-${them}`)).toHaveTextContent("Not allied");
      fireEvent.click(screen.getByTestId(`alliance-propose-${them}`));
      expect(h.session.store.getState().allianceOffers).toHaveLength(1);
      // The offer shows on the capsule as a badge, and the popover closes.
      expect(screen.queryByTestId(`alliance-popover-${them}`)).toBeNull();
      expect(screen.getByTestId(`roster-alliance-${them}`)).toHaveAttribute("data-alliance", "proposed");
    });

    it("offers Accept for an offer made TO me, and then Break", () => {
      const { h, me, them } = mountAllied();
      act(() => {
        h.session.submit({ type: "ALLIANCE_PROPOSE", seat: them, to: me });
      });
      render(<GameScreen session={h.session} />);
      fireEvent.click(screen.getByTestId(`roster-row-${them}`));
      expect(screen.getByTestId(`alliance-status-${them}`)).toHaveTextContent("wants an alliance");
      fireEvent.click(screen.getByTestId(`alliance-accept-${them}`));
      expect(h.session.confirmed().seats[me]?.allies).toContain(them);

      fireEvent.click(screen.getByTestId(`roster-row-${them}`));
      expect(screen.getByTestId(`alliance-status-${them}`)).toHaveTextContent("Allied");
      expect(screen.getByTestId(`roster-alliance-${them}`)).toHaveAttribute("data-alliance", "allied");
      fireEvent.click(screen.getByTestId(`alliance-break-${them}`));
      expect(h.session.confirmed().seats[me]?.allies).not.toContain(them);
    });

    it("never opens on my own capsule", () => {
      const { h, me } = mountAllied();
      render(<GameScreen session={h.session} />);
      fireEvent.click(screen.getByTestId(`roster-row-${me}`));
      expect(screen.queryByTestId(`alliance-popover-${me}`)).toBeNull();
    });

    it("unlocks the two ally-only chat lines once an alliance is live (lines 28, 29)", () => {
      const { h, me, them } = mountAllied();
      h.session.store.setState({ chatOpen: true, modal: null });
      const { unmount } = render(<GameScreen session={h.session} />);
      expect(screen.queryByTestId("dialog-line-28")).toBeNull();
      unmount();

      act(() => {
        h.session.submit({ type: "ALLIANCE_PROPOSE", seat: them, to: me });
        h.session.submit({ type: "ALLIANCE_ACCEPT", seat: me, from: them });
      });
      h.session.store.setState({ chatOpen: true, modal: null });
      render(<GameScreen session={h.session} />);
      expect(screen.getByTestId("dialog-line-28")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-line-29")).toBeInTheDocument();
    });
  });

  it("never puts the GameState into React state", () => {
    const h = mountHotseat();
    h.session.continueHandOff();
    const { container } = render(<GameScreen session={h.session} />);
    // The board is imperative DOM built outside React: React's own tree holds
    // the wrapper, and the SVG inside it has no React fibre props.
    const svg = container.querySelector("#board svg");
    expect(svg).not.toBeNull();
    const keys = Object.keys(svg as object).filter((k) => k.startsWith("__react"));
    expect(keys).toEqual([]);
  });
});
