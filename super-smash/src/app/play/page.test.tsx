/**
 * The play page's wiring: which match it builds, from where, and what it does
 * when the match ends or the link gives out. The runner and the link monitor
 * are stood in for — each has its own tests — so these watch what the page
 * hands them and what it does with what they report. So are the bake (in at
 * once) and the 3D world (Plan 4): its presenter is ready at once unless a test
 * holds it back, and a match's clock starts only then.
 */

import { StrictMode, useLayoutEffect, type ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { routerMock } from "../../../vitest.setup";
import { AudioEngine } from "@/audio";
import { STALL_HINT_MS } from "@/components/match/NetHud";
import { CharacterSelect } from "@/components/menu/CharacterSelect";
import { Results } from "@/components/menu/Results";
import { readBakeFromDisk } from "@/game/bakeNode";
import { getFighterOrThrow, resolveMatchStage } from "@/game/bootstrap";
import { STALL_LOST_MS, type LinkMonitorOptions } from "@/game/linkMonitor";
import type { MatchRunnerOptions } from "@/game/matchRunner";
import { localBuild, runnerSlotsFor } from "@/game/onlineConfig";
import { GAME_SIM_CONTEXT } from "@/game/simContext";
import type { World3dModule } from "@/game/useWorld3d";
import type { WorldLayers, WorldOptions } from "@/game/world3d";
import type { FighterDef, StageDef } from "@/engine/types";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import type { GamepadOptions } from "@/input/gamepad";
import { claimContext } from "@/render3d/fakeContext";
import { createModelCache } from "@/render3d/models/loader";
import { createRenderer3D, type GLLike, type Presenter3D } from "@/render3d/renderer3d";
import { SKELETONS } from "@/render3d/skeletons";
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
  const runners: {
    options: MatchRunnerOptions;
    runner: { start: Mock; stop: Mock; dispose: Mock; redraw: Mock; advance: Mock; netStats: NetStats | null; stalled: boolean; state: { stageId: string; fighters: unknown[] } };
  }[] = [];
  const monitors: { options: LinkMonitorOptions; stop: Mock }[] = [];
  const pads: { options: GamepadOptions; detach: Mock }[] = [];
  /** Set to make the next runner refuse to build. */
  const fail = { next: false };
  /** A 3D world built for a match, and the hand that makes its fighters ready. */
  const worlds: {
    layers: WorldLayers;
    defs: readonly { id: string }[];
    options: WorldOptions | undefined;
    presenter: { ready: Promise<void>; dispose: Mock; info: Mock };
    resolve: () => void;
    reject: (e: Error) => void;
  }[] = [];
  /** Set to keep the next world's fighters loading until the test says. */
  const holdModels = { next: false };
  /** Set to build every world with this instead of the stub presenter: the real one, say. */
  const buildWorld = { with: null as ((layers: WorldLayers, stage: StageDef, defs: readonly FighterDef[], bake: BakeTables) => Presenter3D) | null };
  /** What `useBake` says; a test sets it before rendering. */
  const bake = { state: { tables: {} as object | null, error: null as string | null } };
  return { runners, monitors, pads, fail, worlds, holdModels, buildWorld, bake };
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
      // As the real runner does (`MatchRunner.dispose`, 20.1): the presenter goes with it.
      dispose: vi.fn(() => options.presenter?.dispose()),
      advance: vi.fn(),
      redraw: vi.fn(),
      netStats: null,
      stalled: false,
      frame: 0,
      state: { stageId: options.stage.id, fighters: [] as unknown[] },
    };
    mocks.runners.push({ options, runner });
    return runner;
  },
}));

vi.mock("@/game/linkMonitor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/game/linkMonitor")>()),
  startLinkMonitor: (options: LinkMonitorOptions) => {
    const stop = vi.fn();
    mocks.monitors.push({ options, stop });
    return stop;
  },
}));

// The bake, installed at once (the same object every render, as the hook's state is).
vi.mock("@/game/useBake", () => ({ useBake: () => mocks.bake.state }));

// The 3D world's module, as `useWorld3d` hands it over once its chunk is in.
const WORLD = vi.hoisted(() => ({
  createWorld: (layers: WorldLayers, stage: StageDef, defs: readonly FighterDef[], bake: BakeTables, options?: WorldOptions) => {
    if (mocks.buildWorld.with !== null) {
      const real = mocks.buildWorld.with(layers, stage, defs, bake);
      const presenter = { ...real, dispose: vi.fn(real.dispose), info: vi.fn(real.info) };
      mocks.worlds.push({ layers, defs, options, presenter, resolve: () => {}, reject: () => {} });
      return presenter;
    }
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const held = mocks.holdModels.next;
    mocks.holdModels.next = false;
    const ready = held
      ? new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        })
      : Promise.resolve();
    const presenter = {
      ready,
      paint: vi.fn(),
      resize: vi.fn(),
      info: vi.fn(() => ({ calls: 9, triangles: 99, lost: false, buffer: { width: 1280, height: 720 }, fighters: ["glb", "standIn"] })),
      dispose: vi.fn(),
    };
    mocks.worlds.push({ layers, defs, options, presenter, resolve, reject });
    return presenter;
  },
  followSize: vi.fn(() => vi.fn()),
  preloadModels: vi.fn(async () => {}),
}));
const WORLD_STATE = vi.hoisted(() => ({ world: WORLD as unknown, error: null as string | null }));
vi.mock("@/game/useWorld3d", () => ({ useWorld3d: () => WORLD_STATE as { world: World3dModule | null; error: string | null } }));
// What the online character select preloads through `import()`.
vi.mock("@/game/world3d", () => ({ preloadModels: vi.fn(async () => {}) }));

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
  mocks.worlds.length = 0;
  mocks.holdModels.next = false;
  mocks.buildWorld.with = null;
  mocks.bake.state = { tables: {}, error: null };
  WORLD_STATE.world = WORLD;
  WORLD_STATE.error = null;
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  useMatchConfig.getState().reset();
});

/** Render, and let the match start: the bake and the 3D world are in, and the fighters are ready. */
async function renderPage(ui: ReactElement = <PlayPage />) {
  const result = render(ui);
  await act(async () => {});
  return result;
}

/** The 2D overlay: the canvas the runner paints the HUD on, and starts with. */
function overlay(): HTMLCanvasElement {
  return screen.getByLabelText("Match").querySelector<HTMLCanvasElement>('canvas[data-layer="overlay"]')!;
}

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
  ] as const)("plays the host's start config as the %s, on port %i, not the seats on this machine", async (role, port) => {
    const { fake } = goOnline(role);
    await renderPage();
    const { options } = only(mocks.runners);
    expect(options.players).toEqual(runnerSlotsFor(CONFIG));
    expect(options.stage.id).toBe(resolveMatchStage(CONFIG.stageId, CONFIG.stageForm, CONFIG.seed).id);
    expect(options.rules).toEqual(CONFIG.rules);
    expect(options.seed).toBe(CONFIG.seed);
    expect(options.net?.transport).toBe(fake.session.transport);
    expect(options.net?.localPorts).toEqual([port]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands an online result to the results screen, and leaves the room to it", async () => {
    const { fake } = goOnline("guest");
    await renderPage();
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

  it("keeps sending its last inputs for the results screen's grace, while the channel is open", async () => {
    const { link } = goOnline("host");
    await renderPage();
    const { net } = only(mocks.runners).options;
    expect(net?.lingerMs).toBe(ONLINE_RESULT_LINGER_MS);
    expect(net?.isOpen?.()).toBe(true);
    link.status = "closed";
    expect(net?.isOpen?.()).toBe(false);
  });

  it("ends the match as Connection Lost the moment the link monitor gives up", async () => {
    goOnline("host");
    await renderPage();
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
  it("ends the match as out of sync the moment the confirmed states disagree, and stops playing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      goOnline("guest");
      const { unmount } = await renderPage();
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
  it("leaves a finished match alone when a desync or a lost link is reported during its play-out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      goOnline("host");
      await renderPage();
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
  it("stops the match and says why, without results, when the guest refuses this host's start", async () => {
    const { fake } = goOnline("host");
    await renderPage();
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
  it("says the settings could not be read when the guest refuses a start it could not read", async () => {
    const { fake } = goOnline("host");
    await renderPage();
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
  it("keeps a refusal that lands between its render and its effect on screen, back where the room is", async () => {
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
  it("plays on as the guest when a refusal arrives", async () => {
    const { fake } = goOnline("guest");
    await renderPage();
    const { runner } = only(mocks.runners);
    act(() => fake.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" } }));
    expect(runner.stop).not.toHaveBeenCalled();
    expect(only(mocks.monitors).stop).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has the link monitor watch the match's confirmed frame, so a match stuck with packets still arriving is lost", async () => {
    goOnline("host");
    await renderPage();
    const { runner } = only(mocks.runners);
    const { confirmedFrame } = only(mocks.monitors).options;
    expect(confirmedFrame?.()).toBe(-1);
    runner.netStats = { ...STATS, confirmedFrame: 418 };
    expect(confirmedFrame?.()).toBe(418);
  });

  it("shows the link's numbers, and says when the opponent has switched tabs", async () => {
    goOnline("guest");
    await renderPage();
    only(mocks.runners).runner.netStats = STATS;
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByText("PING 42 ms · DELAY 3f · ROLLBACKS 12")).toBeInTheDocument();
    act(() => only(mocks.monitors).options.onHealth("waiting", true));
    expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
  });

  it("says it is waiting when the match has been held at the prediction cap for over a second", async () => {
    goOnline("host");
    await renderPage();
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

  it("never pauses on Esc, and leaving the match leaves the room", async () => {
    goOnline("guest");
    await renderPage();
    const { runner } = only(mocks.runners);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.getByText("The match keeps running · Esc to return")).toBeInTheDocument();
    expect(runner.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "LEAVE MATCH" }));
    expect(runner.dispose).toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
    expect(getActiveSession()).toBeNull();
  });

  it("lets every pad drive this player's own port, and lets go of them on unmount", async () => {
    goOnline("guest");
    const { unmount } = await renderPage();
    const pad = only(mocks.pads);
    expect([0, 1, 2, 3].map((ordinal) => pad.options.portForPad?.(ordinal))).toEqual([1, 1, 1, 1]);
    expect(only(mocks.runners).options.gamepad).toBeTruthy();
    unmount();
    expect(pad.detach).toHaveBeenCalled();
    expect(only(mocks.runners).runner.dispose).toHaveBeenCalled();
  });
});

describe("the play page, leaving online", () => {
  it("leaves the room when the page goes away mid-match", async () => {
    const { fake } = goOnline("guest");
    const { unmount } = await renderPage();
    unmount();
    flushTimers();
    expect(getActiveSession()).toBeNull();
    expect(fake.session.close).toHaveBeenCalled();
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it("leaves the room when the page goes away during the KO's play-out", async () => {
    goOnline("host");
    const { unmount } = await renderPage();
    act(() => only(mocks.runners).options.onEnd?.({ kind: "stockOut", placings: [0, 1] }));
    act(() => vi.advanceTimersByTime(1000));
    unmount();
    flushTimers();
    expect(getActiveSession()).toBeNull();
    // ...and never bounces to the results it walked away from.
    act(() => vi.advanceTimersByTime(5000));
    expect(routerMock.push).not.toHaveBeenCalledWith("/results");
  });

  it("keeps the room for the results screen once the result is handed over", async () => {
    const { fake } = goOnline("guest");
    const { unmount } = await renderPage();
    act(() => only(mocks.runners).options.onEnd?.({ kind: "stockOut", placings: [1, 0] }));
    act(() => vi.advanceTimersByTime(2400));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
    unmount();
    flushTimers();
    expect(getActiveSession()).toBe(fake.session);
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("keeps the room through React's development remount", async () => {
    const { fake } = goOnline("guest");
    await renderPage(
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

  it("stops watching the link and drops its e2e handle on unmount", async () => {
    goOnline("host");
    const { unmount } = await renderPage();
    expect((window as { __smashNet?: unknown }).__smashNet).toBeDefined();
    unmount();
    expect(only(mocks.monitors).stop).toHaveBeenCalled();
    expect((window as { __smashNet?: unknown }).__smashNet).toBeUndefined();
  });

  it("does not bounce to the results after leaving during the KO's play-out", async () => {
    goOnline("guest");
    await renderPage();
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
    async (role, screenPath) => {
      // Seated online, but the opponent left between the start and this page: no config.
      const { fake } = goOnline(role);
      useOnlineStore.getState().patch({ config: null });
      await renderPage();
      expect(mocks.runners).toEqual([]);
      expect(routerMock.replace).toHaveBeenCalledWith(screenPath);
      // The room stays, so it can pair again; that screen shows why it is waiting.
      flushTimers();
      expect(getActiveSession()).toBe(fake.session);
      expect(fake.session.close).not.toHaveBeenCalled();
      expect(useMatchConfig.getState().online).toBe(true);
    },
  );

  it("goes back to the lobby when it is seated online with no room at all", async () => {
    useMatchConfig.getState().configureOnline();
    await renderPage();
    expect(mocks.runners).toEqual([]);
    expect(routerMock.replace).toHaveBeenCalledWith("/online");
    expect(useMatchConfig.getState().online).toBe(false);
  });
});

describe("the play page, local", () => {
  it("pauses on Esc and resumes on Esc again", async () => {
    await renderPage();
    const { runner } = only(mocks.runners);
    expect(runner.start).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(runner.stop).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.queryByText("PAUSED")).toBeNull();
    expect(runner.start).toHaveBeenCalledTimes(2);
    expect(runner.start).toHaveBeenLastCalledWith(overlay());
  });

  it("does not bounce to the results after quitting during the KO's play-out", async () => {
    await renderPage();
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
      await renderPage();
      await act(async () => {});
      expect(screen.getByRole("alert")).toHaveTextContent("The runner refused to build");
      expect(release).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      unlock.mockRestore();
      dispose.mockRestore();
    }
  });

  /** The match's own teardown releases the sound too (Plan 1's test above covers only a runner that cannot be built). */
  it("releases the sound when the match goes away", async () => {
    const release = vi.fn();
    const unlock = vi.spyOn(AudioEngine.prototype, "unlockOnGesture").mockReturnValue(release);
    const dispose = vi.spyOn(AudioEngine.prototype, "dispose");
    try {
      const { unmount } = await renderPage();
      expect(only(mocks.runners).runner.start).toHaveBeenCalled();
      expect(dispose).not.toHaveBeenCalled();
      unmount();
      expect(release).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      unlock.mockRestore();
      dispose.mockRestore();
    }
  });

  it("plays the menus' match with no network, each pad held to its human's port", async () => {
    const config = useMatchConfig.getState();
    config.addPlayer();
    config.setPlayerKind(2, "human");
    const { unmount } = await renderPage();
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

  it("records a local result without the online flag", async () => {
    await renderPage();
    act(() => only(mocks.runners).options.onEnd?.({ kind: "timeUp", placings: [0, 1] }));
    const result = useMatchConfig.getState().result;
    expect(result?.kind).toBe("timeUp");
    expect(result?.rules).toEqual(useMatchConfig.getState().rules);
    expect(result).not.toHaveProperty("online");
    act(() => vi.advanceTimersByTime(2400));
    expect(routerMock.push).toHaveBeenCalledWith("/results");
  });
});

describe("the play page in 3D (Plan 4)", () => {
  function layer(name: "background" | "world" | "overlay"): HTMLCanvasElement {
    return screen.getByLabelText("Match").querySelector<HTMLCanvasElement>(`canvas[data-layer="${name}"]`)!;
  }

  it("stacks the sky, the 3D world and the overlay inside the Match element, and hands each to its painter", async () => {
    await renderPage();
    const match = screen.getByLabelText("Match");
    expect([...match.querySelectorAll("canvas")].map((c) => c.dataset.layer)).toEqual(["background", "world", "overlay"]);
    const { options, runner } = only(mocks.runners);
    const world = only(mocks.worlds);
    expect(world.layers).toEqual({ gl: layer("world"), background: layer("background") });
    expect(options.presenter).toBe(world.presenter);
    expect(options.background).toBe(layer("background"));
    expect(runner.start).toHaveBeenCalledWith(layer("overlay"));
    expect(WORLD.followSize).toHaveBeenCalledWith(layer("world"), world.presenter);
  });

  /** One set of defs for the sim, the CPU, the overlay and the 3D world: the game's, limb-bone scripts and all (carry 7). */
  it("plays and draws the game's fighters, as the sim context hands them out", async () => {
    // With no bake installed, the context hands out the registry's own defs; a
    // context of distinct objects tells "the game's" from "the registry's".
    const real = GAME_SIM_CONTEXT.fighter;
    const game = new Map<string, FighterDef>();
    GAME_SIM_CONTEXT.fighter = (id) => game.get(id) ?? (game.set(id, { ...real(id) }), game.get(id)!);
    try {
      await renderPage();
      const { options } = only(mocks.runners);
      expect(options.getFighter("mario")).toBe(GAME_SIM_CONTEXT.fighter("mario"));
      expect(options.getFighter("mario")).not.toBe(getFighterOrThrow("mario"));
      const world = only(mocks.worlds);
      expect(world.defs).toHaveLength(options.players.length);
      world.defs.forEach((def, i) => {
        expect(def).toBe(GAME_SIM_CONTEXT.fighter(options.players[i].selection.defId));
        expect(def).not.toBe(getFighterOrThrow(def.id));
      });
    } finally {
      GAME_SIM_CONTEXT.fighter = real;
    }
  });

  it("reports a move's length from the game's fighter, so a limb slot says its script's (carry 7)", async () => {
    const real = GAME_SIM_CONTEXT.fighter;
    const marth = real("marth");
    GAME_SIM_CONTEXT.fighter = (id) => (id === "marth" ? { ...marth, moves: { ...marth.moves, fair: { ...marth.moves.fair!, totalFrames: 77 } } } : real(id));
    try {
      await renderPage();
      only(mocks.runners).runner.state.fighters = [{ port: 0, defId: "marth", move: "fair" }];
      const debug = (window as unknown as { __smashDebug: { moveFrames(): { total: number }[] } }).__smashDebug;
      expect(debug.moveFrames()).toEqual([{ port: 0, move: "fair", total: 77 }]);
    } finally {
      GAME_SIM_CONTEXT.fighter = real;
    }
  });

  it("starts the clock only once every fighter has a model or a stand-in, and says it is loading meanwhile", async () => {
    mocks.holdModels.next = true;
    await renderPage();
    const { runner } = only(mocks.runners);
    expect(runner.start).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading fighters…");
    await act(async () => only(mocks.worlds).resolve());
    expect(runner.start).toHaveBeenCalledOnce();
    expect(runner.start).toHaveBeenCalledWith(overlay());
    expect(screen.queryByText("Loading fighters…")).toBeNull();
  });

  /**
   * DISPATCH-NOTES 20.4: an e2e `stepped` match pauses through `__smashDebug`
   * the moment it exists, which is now before the fighters are ready. The
   * ready must not start the clock under the test's steps; the runner still
   * gets its canvas, so each step paints.
   */
  it("keeps a test's pause, taken while the fighters load, when they are ready", async () => {
    mocks.holdModels.next = true;
    await renderPage();
    const { runner } = only(mocks.runners);
    const debug = (window as unknown as { __smashDebug: { pause(): void; resume(): void; step(n?: number): void } }).__smashDebug;
    debug.pause();
    debug.step(72);
    expect(runner.advance).toHaveBeenCalledWith(72);
    await act(async () => only(mocks.worlds).resolve());
    // Handed its canvas and stopped again at once, before a frame could run: the clock stays the test's.
    expect(runner.start).toHaveBeenCalledOnce();
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(runner.stop.mock.invocationCallOrder[0]).toBeGreaterThan(runner.start.mock.invocationCallOrder[0]);
    expect(runner.redraw).toHaveBeenCalledOnce();
    debug.pause();
    expect(runner.stop).toHaveBeenCalledOnce();
    debug.resume();
    expect(runner.start).toHaveBeenCalledTimes(2);
    debug.resume();
    expect(runner.start).toHaveBeenCalledTimes(2);
  });

  it("does not start the match behind the pause menu opened while the fighters load", async () => {
    mocks.holdModels.next = true;
    await renderPage();
    const { runner } = only(mocks.runners);
    fireEvent.keyDown(window, { code: "Escape" });
    await act(async () => only(mocks.worlds).resolve());
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(runner.stop).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { code: "Escape" });
    expect(runner.start).toHaveBeenCalledTimes(2);
    expect(runner.start).toHaveBeenLastCalledWith(overlay());
  });

  it("says why when a fighter cannot be drawn at all, rather than loading for ever", async () => {
    mocks.holdModels.next = true;
    await renderPage();
    const { runner } = only(mocks.runners);
    await act(async () => only(mocks.worlds).reject(new Error("no skeleton for luigi")));
    expect(screen.getByRole("alert")).toHaveTextContent("no skeleton for luigi");
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.dispose).toHaveBeenCalled();
  });

  it("shows the bake's own sentence when it cannot load, and builds no match", async () => {
    const sentence = "The fighters' animation data does not match this version of the game. Reload the page.";
    mocks.bake.state = { tables: null, error: sentence };
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(mocks.runners).toEqual([]);
    expect(mocks.worlds).toEqual([]);
  });

  it("says so when the 3D world's code cannot load", async () => {
    WORLD_STATE.world = null;
    WORLD_STATE.error = "Loading chunk 812 failed.";
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Loading chunk 812 failed.");
    expect(mocks.runners).toEqual([]);
  });

  it("frees the 3D world when the runner cannot be built", async () => {
    mocks.fail.next = true;
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("The runner refused to build");
    expect(only(mocks.worlds).presenter.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(WORLD.followSize).mock.results.at(-1)?.value).toHaveBeenCalledOnce();
  });

  it("publishes what the 3D layer is doing for e2e while the match is up", async () => {
    const { unmount } = await renderPage();
    const handle = (window as unknown as { __smashRender?: { info(): unknown } }).__smashRender;
    expect(handle?.info()).toEqual(only(mocks.worlds).presenter.info());
    unmount();
    expect((window as unknown as { __smashRender?: unknown }).__smashRender).toBeUndefined();
  });

  /**
   * The Task 19 review, ruled in Task 20 (carry 14 amended): React's
   * development remount, with the bake and the 3D chunk already in, builds a
   * second match on the same canvases at once. The presenter leaves its canvas
   * usable (`renderer3d.test.ts`), so the remount's match is the one that runs.
   */
  it("survives React's development double mount: the first match goes before it starts, the second runs on the same canvases", async () => {
    await renderPage(
      <StrictMode>
        <PlayPage />
      </StrictMode>,
    );
    expect(mocks.runners).toHaveLength(2);
    const [first, second] = mocks.runners;
    expect(first.runner.dispose).toHaveBeenCalled();
    expect(first.runner.start).not.toHaveBeenCalled();
    expect(second.runner.dispose).not.toHaveBeenCalled();
    expect(second.runner.start).toHaveBeenCalledOnce();
    expect(second.runner.start).toHaveBeenCalledWith(overlay());
    expect(mocks.worlds[1].layers.gl).toBe(mocks.worlds[0].layers.gl);
    expect(mocks.worlds[1].layers.gl).toBe(layer("world"));
  });

  /**
   * The same double mount with the real presenter on a modelled WebGL context
   * (`fakeContext.ts`): the first match's presenter is disposed with its runner,
   * and the second is built on the very same canvas. A presenter that forced
   * its context lost on dispose, however spelled, would stop the second one
   * here, as it does in Chromium ("THE MATCH COULD NOT START").
   */
  it("builds the double mount's second presenter on the canvas the first one drew on, and starts its match", async () => {
    mocks.bake.state = { tables: readBakeFromDisk(), error: null };
    const models = createModelCache({ index: async () => null, load: async () => Promise.reject(new Error("unused")) }, () => {});
    const contextGL = (canvas: HTMLCanvasElement): GLLike => ({
      domElement: canvas,
      info: { render: { calls: 0, triangles: 0 } },
      setPixelRatio: () => {},
      setSize: () => {},
      setClearColor: () => {},
      render: () => {},
      dispose: () => {},
      ...claimContext(canvas),
    });
    mocks.buildWorld.with = (layers, stage, defs, bake) =>
      createRenderer3D({ canvas: layers.gl, stage, defs, bake, skeletons: SKELETONS, models, makeGL: contextGL });
    await renderPage(
      <StrictMode>
        <PlayPage />
      </StrictMode>,
    );
    await act(async () => {});
    expect(screen.queryByText("THE MATCH COULD NOT START")).toBeNull();
    expect(mocks.worlds).toHaveLength(2);
    expect(mocks.worlds[1].layers.gl).toBe(mocks.worlds[0].layers.gl);
    expect(mocks.worlds[0].presenter.dispose).toHaveBeenCalledOnce();
    const [first, second] = mocks.runners;
    expect(first.runner.start).not.toHaveBeenCalled();
    expect(second.runner.start).toHaveBeenCalledWith(overlay());
    expect(mocks.worlds[1].presenter.info()).toMatchObject({ lost: false, fighters: ["standIn", "standIn"] });
  });

  it("plays a second match on the same canvases once the first is over", async () => {
    await renderPage();
    act(() => useMatchConfig.getState().setStocks(2));
    await act(async () => {});
    expect(mocks.runners).toHaveLength(2);
    const [first, second] = mocks.runners;
    expect(first.runner.dispose).toHaveBeenCalled();
    expect(second.options.rules.stocks).toBe(2);
    expect(second.runner.start).toHaveBeenCalledWith(overlay());
    expect(mocks.worlds.map((w) => w.layers.gl)).toEqual([layer("world"), layer("world")]);
  });

  it("waits on the loader's own timeouts locally, with no cap of its own", async () => {
    await renderPage();
    expect(only(mocks.worlds).options?.modelWaitMs).toBeUndefined();
  });

  /**
   * Ruling R3(a): online, a match waits for its models at most five seconds,
   * then plays the rest as stand-ins; and its link monitor starts with the
   * match, not at mount, so a slow download is never read as a dead link.
   */
  /**
   * DISPATCH-NOTES 20.6: the room's guards run before the page waits for the
   * bake and the 3D world. A refusal recorded while they load still sends the
   * host back to where the room is, rather than leaving it on a loading screen.
   */
  it("runs the room's guards before it waits for the bake and the 3D world", async () => {
    mocks.bake.state = { tables: null, error: null };
    goOnline("host");
    useOnlineStore.getState().patch({ status: "error", errorReason: "engine-mismatch", error: "The other player is running a different version. Both reload the page." });
    await renderPage();
    expect(routerMock.replace).toHaveBeenCalledWith("/stage");
    expect(mocks.runners).toEqual([]);
  });

  it("caps the wait for models online, and watches the link only once the match starts", async () => {
    mocks.holdModels.next = true;
    goOnline("host");
    await renderPage();
    const world = only(mocks.worlds);
    expect(world.options).toEqual({ modelWaitMs: 5_000 });
    // Room for the two peers' starts to land apart within the other's link monitor's patience.
    expect(world.options!.modelWaitMs!).toBeLessThanOrEqual(STALL_LOST_MS / 2);
    expect(mocks.monitors).toEqual([]);
    const { runner } = only(mocks.runners);
    expect(runner.start).not.toHaveBeenCalled();
    await act(async () => world.resolve());
    expect(only(mocks.monitors)).toBeDefined();
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("never starts, nor watches, an online match the guest refused while its fighters loaded", async () => {
    mocks.holdModels.next = true;
    const { fake } = goOnline("host");
    await renderPage();
    act(() => fake.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("different version");
    const { runner } = only(mocks.runners);
    await act(async () => only(mocks.worlds).resolve());
    expect(mocks.monitors).toEqual([]);
    // Handed its canvas, then stopped before a frame could run.
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(runner.stop.mock.invocationCallOrder[0]).toBeGreaterThan(runner.start.mock.invocationCallOrder[0]);
  });
});
