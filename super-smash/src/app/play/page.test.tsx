/**
 * The play page's wiring: which match it builds, from where, and what it does
 * when the match ends or the link gives out. The runner and the link monitor
 * are stood in for — each has its own tests — so these watch what the page
 * hands them and what it does with what they report.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { routerMock } from "../../../vitest.setup";
import { ONLINE_RESULT_LINGER_MS } from "@/components/menu/Results";
import { resolveMatchStage } from "@/game/bootstrap";
import type { LinkMonitorOptions } from "@/game/linkMonitor";
import type { MatchRunnerOptions } from "@/game/matchRunner";
import { runnerSlotsFor } from "@/game/onlineConfig";
import type { GamepadOptions } from "@/input/gamepad";
import { useMatchConfig } from "@/lib/matchConfig";
import { leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import type { DoSignalStatus } from "@/net/adapters/doSignal";
import type { OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import type { NetStats } from "@/net/rollback";
import type { Role } from "@/net/signalProtocol";
import PlayPage from "./page";

const mocks = vi.hoisted(() => {
  const runners: { options: MatchRunnerOptions; runner: { stop: Mock; dispose: Mock; netStats: NetStats | null } }[] = [];
  const monitors: { options: LinkMonitorOptions; stop: Mock }[] = [];
  const pads: { options: GamepadOptions; detach: Mock }[] = [];
  return { runners, monitors, pads };
});

vi.mock("@/game/matchRunner", () => ({
  createMatchRunner: (options: MatchRunnerOptions) => {
    const runner = {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
      advance: vi.fn(),
      redraw: vi.fn(),
      netStats: null,
      stalled: false,
      frame: 0,
      state: { stageId: options.stage.id, fighters: [] },
    };
    mocks.runners.push({ options, runner });
    return runner;
  },
}));

vi.mock("@/game/linkMonitor", () => ({
  startLinkMonitor: (options: LinkMonitorOptions) => {
    const stop = vi.fn();
    mocks.monitors.push({ options, stop });
    return stop;
  },
}));

vi.mock("@/input/gamepad", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/input/gamepad")>();
  return {
    ...actual,
    createGamepadInput: (options: GamepadOptions) => {
      const pad = actual.createGamepadInput(options);
      mocks.pads.push({ options, detach: vi.spyOn(pad, "detach") });
      return pad;
    },
  };
});

const CONFIG: OnlineMatchConfig = {
  seed: 9,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 2, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [3, 1],
};

const STATS = { rttMs: 41.6, inputDelay: 3, rollbacks: 12 } as NetStats;

/** In a room, the start received, with this machine's own seats set to something else entirely. */
function goOnline(role: Role): { fake: FakeSession; link: { status: DoSignalStatus } } {
  const fake = fakeSession(role);
  const link = { status: "open" as DoSignalStatus };
  Object.assign(fake.session, { transport: link });
  setActiveSession(fake.session);
  useMatchConfig.getState().configureOnline();
  useMatchConfig.getState().setFighter(0, "link");
  useMatchConfig.getState().setFighter(1, "samus");
  useOnlineStore.getState().patch({ role, status: "connected", roomCode: "ABCD", config: CONFIG });
  return { fake, link };
}

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  return list[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.runners.length = 0;
  mocks.monitors.length = 0;
  mocks.pads.length = 0;
  routerMock.push.mockClear();
  useMatchConfig.getState().reset();
});

afterEach(() => {
  act(() => leaveOnline());
  vi.useRealTimers();
});

describe("the play page, online", () => {
  it.each([
    ["host", 0],
    ["guest", 1],
  ] as const)("plays the host's start config as the %s, on port %i, not the seats on this machine", (role, port) => {
    const { fake } = goOnline(role);
    render(<PlayPage />);
    const { options } = only(mocks.runners);
    expect(options.players).toEqual(runnerSlotsFor(CONFIG));
    expect(options.stage.id).toBe(resolveMatchStage(CONFIG.stageId, CONFIG.stageForm, CONFIG.seed).id);
    expect(options.rules).toEqual(CONFIG.rules);
    expect(options.seed).toBe(CONFIG.seed);
    expect(options.net?.transport).toBe(fake.session.transport);
    expect(options.net?.localPorts).toEqual([port]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands an online result to the results screen, and leaves the room to it", () => {
    const { fake } = goOnline("guest");
    render(<PlayPage />);
    const { options } = only(mocks.runners);
    act(() => options.onEnd?.({ kind: "stockOut", placings: [1, 0] }));
    expect(useMatchConfig.getState().result).toMatchObject({
      kind: "stockOut",
      placings: [1, 0],
      fighters: { 0: "mario", 1: "fox" },
      online: true,
    });
    expect(only(mocks.monitors).stop).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2400));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
    // The results screen holds the room open for its grace, then leaves.
    expect(getActiveSession()).toBe(fake.session);
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("keeps sending its last inputs for the results screen's grace, while the channel is open", () => {
    const { link } = goOnline("host");
    render(<PlayPage />);
    const { net } = only(mocks.runners).options;
    expect(net?.lingerMs).toBe(ONLINE_RESULT_LINGER_MS);
    expect(net?.isOpen?.()).toBe(true);
    link.status = "closed";
    expect(net?.isOpen?.()).toBe(false);
  });

  it("ends the match as Connection Lost the moment the link monitor gives up", () => {
    goOnline("host");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    act(() => only(mocks.monitors).options.onLost());
    expect(runner.stop).toHaveBeenCalled();
    expect(useMatchConfig.getState().result).toEqual({
      kind: "connectionLost",
      placings: [],
      stats: [],
      fighters: { 0: "mario", 1: "fox" },
      online: true,
    });
    act(() => vi.advanceTimersByTime(0));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
  });

  it("shows the link's numbers, and says when the opponent has switched tabs", () => {
    goOnline("guest");
    render(<PlayPage />);
    only(mocks.runners).runner.netStats = STATS;
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByText("PING 42 ms · DELAY 3f · ROLLBACKS 12")).toBeInTheDocument();
    act(() => only(mocks.monitors).options.onHealth("waiting", true));
    expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
  });

  it("never pauses on Esc, and leaving the match leaves the room", () => {
    goOnline("guest");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.getByText("The match keeps running · Esc to return")).toBeInTheDocument();
    expect(runner.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "LEAVE MATCH" }));
    expect(runner.dispose).toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
    expect(getActiveSession()).toBeNull();
  });

  it("lets every pad drive this player's own port, and lets go of them on unmount", () => {
    goOnline("guest");
    const { unmount } = render(<PlayPage />);
    const pad = only(mocks.pads);
    expect([0, 1, 2, 3].map((ordinal) => pad.options.portForPad?.(ordinal))).toEqual([1, 1, 1, 1]);
    expect(only(mocks.runners).options.gamepad).toBeTruthy();
    unmount();
    expect(pad.detach).toHaveBeenCalled();
    expect(only(mocks.runners).runner.dispose).toHaveBeenCalled();
  });
});

describe("the play page, local", () => {
  it("plays the menus' match with no network, each pad held to its human's port", () => {
    const config = useMatchConfig.getState();
    config.addPlayer();
    config.setPlayerKind(2, "human");
    const { unmount } = render(<PlayPage />);
    const { options } = only(mocks.runners);
    expect(options.net).toBeNull();
    expect(options.players).toHaveLength(3);
    expect(mocks.monitors).toEqual([]);
    const pad = only(mocks.pads);
    expect(pad.options.holdPorts).toBe(true);
    expect([0, 1, 2].map((ordinal) => pad.options.portForPad?.(ordinal))).toEqual([0, 2, -1]);
    unmount();
    expect(pad.detach).toHaveBeenCalled();
  });

  it("records a local result without the online flag", () => {
    render(<PlayPage />);
    act(() => only(mocks.runners).options.onEnd?.({ kind: "timeUp", placings: [0, 1] }));
    const result = useMatchConfig.getState().result;
    expect(result?.kind).toBe("timeUp");
    expect(result).not.toHaveProperty("online");
    act(() => vi.advanceTimersByTime(2400));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
  });
});
