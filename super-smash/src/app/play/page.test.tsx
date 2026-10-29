/**
 * The play page's wiring: which match it builds, from where, and what it does
 * when the match ends or the link gives out. The runner and the link monitor
 * are stood in for — each has its own tests — so these watch what the page
 * hands them and what it does with what they report.
 */

import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { routerMock } from "../../../vitest.setup";
import { AudioEngine } from "@/audio";
import { STALL_HINT_MS } from "@/components/match/NetHud";
import { CharacterSelect } from "@/components/menu/CharacterSelect";
import { Results } from "@/components/menu/Results";
import { resolveMatchStage } from "@/game/bootstrap";
import type { LinkMonitorOptions } from "@/game/linkMonitor";
import type { MatchRunnerOptions } from "@/game/matchRunner";
import { localBuild, runnerSlotsFor } from "@/game/onlineConfig";
import type { GamepadOptions } from "@/input/gamepad";
import { resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { ONLINE_RESULT_LINGER_MS, bindSession, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import type { DoSignalStatus } from "@/net/adapters/doSignal";
import type { OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import type { NetStats } from "@/net/rollback";
import type { Role } from "@/net/signalProtocol";
import PlayPage from "./page";

const mocks = vi.hoisted(() => {
  const runners: { options: MatchRunnerOptions; runner: { start: Mock; stop: Mock; dispose: Mock; netStats: NetStats | null; stalled: boolean } }[] = [];
  const monitors: { options: LinkMonitorOptions; stop: Mock }[] = [];
  const pads: { options: GamepadOptions; detach: Mock }[] = [];
  /** Set to make the next runner refuse to build. */
  const fail = { next: false };
  return { runners, monitors, pads, fail };
});

vi.mock("@/game/matchRunner", () => ({
  createMatchRunner: (options: MatchRunnerOptions) => {
    if (mocks.fail.next) {
      mocks.fail.next = false;
      throw new Error("The runner refused to build");
    }
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
  ...localBuild(),
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
  mocks.fail.next = false;
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  useMatchConfig.getState().reset();
});

/** Whatever the page left on a timer for "a moment later" — its deferred leave. */
function flushTimers() {
  act(() => vi.advanceTimersByTime(0));
}

/** Esc, then the overlay's way out. */
function quitFromMenu(name: "QUIT MATCH" | "LEAVE MATCH") {
  fireEvent.keyDown(window, { code: "Escape" });
  fireEvent.click(screen.getByRole("button", { name }));
}

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
      // The host's rules, which this machine's own config never held.
      rules: CONFIG.rules,
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
      rules: CONFIG.rules,
      online: true,
    });
    act(() => vi.advanceTimersByTime(0));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
  });

  /**
   * Two machines that disagree about a confirmed frame are no longer playing
   * the same match: neither may crown anyone. Stopping here also stops the
   * inputs, so the other side finds out too — by its own check, or its link
   * monitor.
   */
  it("ends the match as out of sync the moment the confirmed states disagree, and stops playing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      goOnline("guest");
      const { unmount } = render(<PlayPage />);
      const { options, runner } = only(mocks.runners);
      const report = { frame: 600, localHash: 1, remoteHash: 2, peerId: "h1", port: 0 };
      act(() => options.net?.onDesync?.(report));
      expect(runner.stop).toHaveBeenCalled();
      expect(only(mocks.monitors).stop).toHaveBeenCalled();
      expect(useMatchConfig.getState().result).toEqual({
        kind: "desync",
        placings: [],
        stats: [],
        fighters: { 0: "mario", 1: "fox" },
        rules: CONFIG.rules,
        online: true,
      });
      // Kept for diagnosis.
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/desync/), report);

      // A second report changes nothing; the results come at once.
      act(() => options.net?.onDesync?.({ ...report, frame: 630 }));
      act(() => vi.advanceTimersByTime(0));
      expect(routerMock.push).toHaveBeenCalledTimes(1);
      expect(routerMock.push).toHaveBeenCalledWith("/results");
      unmount();
      expect(runner.dispose).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  /** The match ended here first: its result is final, and its play-out and input linger run as normal. */
  it("leaves a finished match alone when a desync or a lost link is reported during its play-out", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      goOnline("host");
      render(<PlayPage />);
      const { options, runner } = only(mocks.runners);
      act(() => options.onEnd?.({ kind: "stockOut", placings: [0, 1] }));
      act(() => options.net?.onDesync?.({ frame: 600, localHash: 1, remoteHash: 2, peerId: "g1", port: 1 }));
      act(() => only(mocks.monitors).options.onLost());
      expect(runner.stop).not.toHaveBeenCalled();
      expect(useMatchConfig.getState().result).toMatchObject({ kind: "stockOut", placings: [0, 1] });
      act(() => vi.advanceTimersByTime(2399));
      expect(routerMock.push).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(routerMock.push).toHaveBeenCalledWith("/results");
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The guest could not play this host's start: it runs another build (Plan 2
   * Task 27). Nothing was played, so nobody wins and there are no results: the
   * page stops, says why, and its way out leaves the room.
   */
  it("stops the match and says why, without results, when the guest refuses this host's start", () => {
    const { fake } = goOnline("host");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    const monitor = only(mocks.monitors);
    act(() => fake.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" } }));

    expect(runner.stop).toHaveBeenCalled();
    expect(monitor.stop).toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("THE MATCH COULD NOT START");
    expect(alert).toHaveTextContent("The other player is running a different version. Both reload the page.");
    // The guest leaving next, as it does after refusing, ends nothing a second time.
    act(() => monitor.options.onLost());
    act(() => vi.advanceTimersByTime(5_000));
    expect(useMatchConfig.getState().result).toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "BACK TO MENU" }));
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
    expect(getActiveSession()).toBeNull();
  });

  /** The guest read the start's stamp as this build's and still could not play it: the host is told so, not "a different version". */
  it("says the settings could not be read when the guest refuses a start it could not read", () => {
    const { fake } = goOnline("host");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    act(() => fake.emit({ type: "lobby", message: { kind: "refuse", reason: "unreadable-start" } }));

    expect(runner.stop).toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("THE MATCH COULD NOT START");
    expect(alert).toHaveTextContent("The match settings could not be read, so leave the room and start again.");
    expect(alert).not.toHaveTextContent("different version");
  });

  /**
   * The refusal can land after this page read the start while rendering but
   * before its effect runs: the store has already withdrawn the start and
   * recorded why. That is not a match left behind (which leaves the room), so
   * it goes back to where the room is, as when stranded, keeping the sentence.
   */
  it("keeps a refusal that lands between its render and its effect on screen, back where the room is", () => {
    // The host's console says the guest refused; the guest's says why.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake } = goOnline("host");
    bindSession(fake.session);
    function RefusedMeanwhile() {
      useLayoutEffect(() => fake.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" } }), []);
      return null;
    }
    render(
      <>
        <RefusedMeanwhile />
        <PlayPage />
      </>,
    );
    expect(mocks.runners).toHaveLength(0);
    expect(routerMock.replace).toHaveBeenCalledWith("/stage");
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "engine-mismatch",
      error: "The other player is running a different version. Both reload the page.",
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  /** Only a host's start can be refused: a refusal sent to the guest is nobody's to act on. */
  it("plays on as the guest when a refusal arrives", () => {
    const { fake } = goOnline("guest");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    act(() => fake.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" } }));
    expect(runner.stop).not.toHaveBeenCalled();
    expect(only(mocks.monitors).stop).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has the link monitor watch the match's confirmed frame, so a match stuck with packets still arriving is lost", () => {
    goOnline("host");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    const { confirmedFrame } = only(mocks.monitors).options;
    expect(confirmedFrame?.()).toBe(-1);
    runner.netStats = { ...STATS, confirmedFrame: 418 };
    expect(confirmedFrame?.()).toBe(418);
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

  it("says it is waiting when the match has been held at the prediction cap for over a second", () => {
    goOnline("host");
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    runner.stalled = true;
    // The next stats sample sees the stall; the HUD times it from there.
    act(() => vi.advanceTimersByTime(250));
    act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for opponent…");
    runner.stalled = false;
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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

describe("the play page, leaving online", () => {
  it("leaves the room when the page goes away mid-match", () => {
    const { fake } = goOnline("guest");
    const { unmount } = render(<PlayPage />);
    unmount();
    flushTimers();
    expect(getActiveSession()).toBeNull();
    expect(fake.session.close).toHaveBeenCalled();
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it("leaves the room when the page goes away during the KO's play-out", () => {
    goOnline("host");
    const { unmount } = render(<PlayPage />);
    act(() => only(mocks.runners).options.onEnd?.({ kind: "stockOut", placings: [0, 1] }));
    act(() => vi.advanceTimersByTime(1000));
    unmount();
    flushTimers();
    expect(getActiveSession()).toBeNull();
    // ...and never bounces to the results it walked away from.
    act(() => vi.advanceTimersByTime(5000));
    expect(routerMock.push).not.toHaveBeenCalledWith("/results");
  });

  it("keeps the room for the results screen once the result is handed over", () => {
    const { fake } = goOnline("guest");
    const { unmount } = render(<PlayPage />);
    act(() => only(mocks.runners).options.onEnd?.({ kind: "stockOut", placings: [1, 0] }));
    act(() => vi.advanceTimersByTime(2400));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
    unmount();
    flushTimers();
    expect(getActiveSession()).toBe(fake.session);
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("keeps the room through React's development remount", () => {
    const { fake } = goOnline("guest");
    render(
      <StrictMode>
        <PlayPage />
      </StrictMode>,
    );
    flushTimers();
    expect(getActiveSession()).toBe(fake.session);
    expect(useOnlineStore.getState().config).toBe(CONFIG);
    // The remount's match is the one left running.
    expect(mocks.runners.at(-1)?.runner.dispose).not.toHaveBeenCalled();
  });

  it("does not send the guest straight back into the match it walked away from", async () => {
    goOnline("guest");
    resetRosterCache();
    function Screen({ at }: { at: "play" | "fighters" }) {
      return at === "play" ? <PlayPage /> : <CharacterSelect />;
    }
    const { rerender } = render(<Screen at="play" />);
    routerMock.push.mockClear();
    // One commit: the match unmounts and character select mounts, as a browser Back does.
    rerender(<Screen at="fighters" />);
    await act(async () => {});
    flushTimers();
    expect(routerMock.push).not.toHaveBeenCalledWith("/play");
    expect(getActiveSession()).toBeNull();
  });

  /**
   * Browser Back from the results during their grace. This page reads the
   * room while it renders, and the results' unmount leaves it in the same
   * commit, after that read: building the match anyway would play on a closed
   * transport, frozen for ten seconds before calling the connection lost.
   */
  it("goes back to the lobby, building no match, when Back from the results lands here as they leave the room", async () => {
    const { fake } = goOnline("guest");
    useMatchConfig.getState().setResult({ kind: "stockOut", placings: [1, 0], stats: [], fighters: { 0: "mario", 1: "fox" }, online: true });
    resetRosterCache();
    function Screen({ at }: { at: "play" | "results" }) {
      return at === "play" ? <PlayPage /> : <Results />;
    }
    const { rerender } = render(<Screen at="results" />);
    await act(async () => {});
    expect(getActiveSession()).toBe(fake.session);

    // One commit: the results unmount and the match page mounts, as a browser Back does.
    rerender(<Screen at="play" />);
    await act(async () => {});

    expect(mocks.runners).toEqual([]);
    expect(routerMock.replace).toHaveBeenCalledWith("/online");
    expect(getActiveSession()).toBeNull();
    expect(useMatchConfig.getState().online).toBe(false);
  });

  it("stops watching the link and drops its e2e handle on unmount", () => {
    goOnline("host");
    const { unmount } = render(<PlayPage />);
    expect((window as { __smashNet?: unknown }).__smashNet).toBeDefined();
    unmount();
    expect(only(mocks.monitors).stop).toHaveBeenCalled();
    expect((window as { __smashNet?: unknown }).__smashNet).toBeUndefined();
  });

  it("does not bounce to the results after leaving during the KO's play-out", () => {
    goOnline("guest");
    render(<PlayPage />);
    act(() => only(mocks.runners).options.onEnd?.({ kind: "stockOut", placings: [1, 0] }));
    quitFromMenu("LEAVE MATCH");
    act(() => vi.advanceTimersByTime(5000));
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
    expect(routerMock.push).not.toHaveBeenCalledWith("/results");
  });

  it.each([
    ["host", "/stage"],
    ["guest", "/fighters"],
  ] as const)(
    "sends the %s back to %s with the room kept, not into a local match, when the start was withdrawn before it mounted",
    (role, screenPath) => {
      // Seated online, but the opponent left between the start and this page: no config.
      const { fake } = goOnline(role);
      useOnlineStore.getState().patch({ config: null });
      render(<PlayPage />);
      expect(mocks.runners).toEqual([]);
      expect(routerMock.replace).toHaveBeenCalledWith(screenPath);
      // The room stays, so it can pair again; that screen shows why it is waiting.
      flushTimers();
      expect(getActiveSession()).toBe(fake.session);
      expect(fake.session.close).not.toHaveBeenCalled();
      expect(useMatchConfig.getState().online).toBe(true);
    },
  );

  it("goes back to the lobby when it is seated online with no room at all", () => {
    useMatchConfig.getState().configureOnline();
    render(<PlayPage />);
    expect(mocks.runners).toEqual([]);
    expect(routerMock.replace).toHaveBeenCalledWith("/online");
    expect(useMatchConfig.getState().online).toBe(false);
  });
});

describe("the play page, local", () => {
  it("pauses on Esc and resumes on Esc again", () => {
    render(<PlayPage />);
    const { runner } = only(mocks.runners);
    expect(runner.start).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(runner.stop).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.queryByText("PAUSED")).toBeNull();
    expect(runner.start).toHaveBeenCalledTimes(2);
    expect(runner.start).toHaveBeenLastCalledWith(screen.getByLabelText("Match"));
  });

  it("does not bounce to the results after quitting during the KO's play-out", () => {
    render(<PlayPage />);
    act(() => only(mocks.runners).options.onEnd?.({ kind: "stockOut", placings: [0, 1] }));
    quitFromMenu("QUIT MATCH");
    act(() => vi.advanceTimersByTime(5000));
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
    expect(routerMock.push).not.toHaveBeenCalledWith("/results");
  });

  it("releases the sound when the match cannot be built", async () => {
    const release = vi.fn();
    const unlock = vi.spyOn(AudioEngine.prototype, "unlockOnGesture").mockReturnValue(release);
    const dispose = vi.spyOn(AudioEngine.prototype, "dispose");
    try {
      mocks.fail.next = true;
      render(<PlayPage />);
      await act(async () => {});
      expect(screen.getByRole("alert")).toHaveTextContent("The runner refused to build");
      expect(release).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      unlock.mockRestore();
      dispose.mockRestore();
    }
  });

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
    expect(result?.rules).toEqual(useMatchConfig.getState().rules);
    expect(result).not.toHaveProperty("online");
    act(() => vi.advanceTimersByTime(2400));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
  });
});
