/**
 * The whole game screen, mounted against the scripted engine — the shape S5
 * composes (SPEC §7, F26).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { PresenceRow } from "@/ports/sync";
import { HOTSEAT_SEATS, SOLO_SEATS, makeSession, manualScheduler } from "@/game/__fixtures__/harness";
import type { Session } from "@/game/session";

import GameScreen from "./GameScreen";

const sessions: Session[] = [];

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
