import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createInitialState, apply as realApply } from "@/engine";
import { engine as realEngine } from "./engineApi";
import type { Action, GameState, RuntimeTile, TileDefinition } from "@/engine/types";
import type { ProgressPort } from "@/ports/localProgress";

import { DEMO_MAP } from "./demoMap";
import type { EngineApi } from "./engineApi";
import { createSession, type SavedSession } from "./session";
import type { SessionConfig } from "./sessionConfig";

/* --------------------------------------------------------------- fixture -- */

function tile(x: number, y: number, extra: Partial<RuntimeTile> = {}): RuntimeTile {
  return { x, y, terrain: "grass", owner: null, building: null, unit: null, decoration: null, road: false, graveAge: 0, provinceId: null, ...extra };
}

/** A 4×2 hand-built state: blue city+knight west, red city east. */
function fixtureState(): GameState {
  const tiles = [
    tile(0, 0, { owner: 0, building: "city", provinceId: "b" }),
    tile(1, 0, { owner: 0, unit: { level: 1, readyToMove: true }, provinceId: "b" }),
    tile(2, 0, { owner: 1, provinceId: "r" }),
    tile(3, 0, { owner: 1, building: "city", provinceId: "r" }),
    tile(0, 1, { owner: 0, provinceId: "b" }),
    tile(1, 1, { owner: 0, provinceId: "b" }),
    tile(2, 1),
    tile(3, 1, { owner: 1, provinceId: "r" }),
  ];
  const core = {
    width: 4,
    height: 2,
    biome: "grass" as const,
    tiles,
    provinces: {
      b: { id: "b", owner: 0, tileKeys: ["0,0", "1,0", "0,1", "1,1"], city: { x: 0, y: 0 }, gold: 10 },
      r: { id: "r", owner: 1, tileKeys: ["2,0", "3,0", "3,1"], city: { x: 3, y: 0 }, gold: 10 },
    },
    players: [
      { index: 0, colour: "blue" as const, kind: "human" as const, aiDifficulty: null, eliminated: false },
      { index: 1, colour: "red" as const, kind: "ai" as const, aiDifficulty: "normal" as const, eliminated: false },
    ],
    activePlayerIndex: 0,
    turnNumber: 0,
    rng: { seed: 1 },
    outcome: null,
  };
  return { ...core, history: [], turnStart: core };
}

const campaignConfig: SessionConfig = {
  source: { kind: "campaign", levelId: "01" },
  seats: [
    { index: 0, kind: "human", aiDifficulty: "normal" },
    { index: 1, kind: "ai", aiDifficulty: "normal" },
  ],
  difficulty: "hard",
  seed: 5,
};

/** A scripted engine: `apply` is a spy the test programs per action type. */
function mockEngine(initial: GameState): EngineApi & { applyMock: ReturnType<typeof vi.fn> } {
  const applyMock = vi.fn((state: GameState, action: Action) => {
    switch (action.type) {
      case "MOVE": {
        const next = structuredClone(state);
        const from = next.tiles[action.unitAt.y * 4 + action.unitAt.x]!;
        const to = next.tiles[action.to.y * 4 + action.to.x]!;
        to.unit = { level: from.unit!.level, readyToMove: to.owner === 0 };
        from.unit = null;
        const captured = to.owner !== 0;
        to.owner = 0;
        next.history = [...state.history, action];
        return {
          state: next,
          events: [
            { type: "moved" as const, from: action.unitAt, to: action.to, player: 0 },
            ...(captured ? [{ type: "captured" as const, at: action.to, from: 1, to: 0, attackerFrom: action.unitAt }] : []),
          ],
        };
      }
      case "END_TURN": {
        const next = structuredClone(state);
        const nextSeat = state.activePlayerIndex === 0 ? 1 : 0;
        next.activePlayerIndex = nextSeat;
        if (nextSeat === 0) next.turnNumber += 1;
        next.history = [];
        return {
          state: next,
          events: [
            { type: "turnEnded" as const, player: state.activePlayerIndex },
            { type: "turnStarted" as const, player: nextSeat, turnNumber: next.turnNumber },
            { type: "income" as const, provinceId: nextSeat === 0 ? "b" : "r", amount: 3, city: { x: nextSeat === 0 ? 0 : 3, y: 0 } },
          ],
        };
      }
      case "UNDO": {
        if (state.history.length === 0) return { state, events: [], error: "nothing to undo" };
        return { state: initial, events: [{ type: "undone" as const }] };
      }
      case "BUY":
        return { state, events: [], error: "not enough gold" };
    }
  });
  return {
    applyMock,
    createInitialState: () => initial,
    apply: applyMock as unknown as EngineApi["apply"],
    legalMoveZone: (_s, from) => (from.x === 1 && from.y === 0 ? [{ x: 1, y: 1 }, { x: 2, y: 0 }] : []),
    legalBuildZone: () => [{ x: 1, y: 1 }],
    defenceNumber: (_s, at) => (at.x >= 2 ? 1 : 0),
    provinceAt: (s, at) => {
      const t = s.tiles[at.y * s.width + at.x];
      return t?.provinceId ? (s.provinces[t.provinceId] ?? null) : null;
    },
    aiTakeTurn: () => ({ actions: [{ type: "END_TURN" }], nextSeed: 99 }),
  };
}

function progressSpy(): ProgressPort & {
  recordLevelWin: Mock<ProgressPort["recordLevelWin"]>;
  recordChallengeWin: Mock<ProgressPort["recordChallengeWin"]>;
} {
  const empty = { levels: {}, challengeMedals: {}, deviceId: "d" };
  return {
    read: () => empty,
    recordLevelWin: vi.fn<ProgressPort["recordLevelWin"]>(() => empty),
    recordChallengeWin: vi.fn<ProgressPort["recordChallengeWin"]>(() => empty),
    reset: vi.fn(),
  };
}

describe("session runner (mocked engine)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the human's turn, fires levelIntro, and selects a unit with its move zone", () => {
    const engine = mockEngine(fixtureState());
    const map = { ...DEMO_MAP, tutorial: [{ triggerId: "levelIntro" as const, text: "GO" }, { triggerId: "unitSelected:first" as const, text: "PICK" }] };
    const session = createSession({ map, config: campaignConfig, engine, now: () => 0 });
    session.start();
    const ui = session.store.getState();
    expect(ui.tutorialStep?.text).toBe("GO");
    expect(ui.actingPlayer).toBe(0);
    expect(ui.banner).toBeNull(); // no banner on day 1
    session.dismissTutorial();
    session.tapTile({ x: 1, y: 0 });
    const after = session.store.getState();
    expect(after.selected).toEqual({ x: 1, y: 0 });
    expect(after.litZone).toEqual([{ x: 1, y: 1 }, { x: 2, y: 0 }]);
    // shield on the capturable red tile only, in red
    expect(after.shields).toEqual([{ at: { x: 2, y: 0 }, defence: 1, colour: "red" }]);
    expect(after.tutorialStep?.text).toBe("PICK");
  });

  it("taps a lit tile to MOVE, keeps the unit selected after a reposition, deselects after a capture", () => {
    const engine = mockEngine(fixtureState());
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, now: () => 0 });
    session.start();
    session.tapTile({ x: 1, y: 0 });
    session.tapTile({ x: 1, y: 1 }); // own empty tile → reposition
    expect(engine.applyMock).toHaveBeenLastCalledWith(expect.anything(), { type: "MOVE", unitAt: { x: 1, y: 0 }, to: { x: 1, y: 1 } });
    expect(session.state.tiles[1 * 4 + 1]!.unit).toEqual({ level: 1, readyToMove: true });
    expect(session.store.getState().selected).toEqual({ x: 1, y: 1 });
    expect(session.store.getState().version).toBe(1);
    // capture from the original fixture again
    const s2 = createSession({ map: DEMO_MAP, config: campaignConfig, engine: mockEngine(fixtureState()), now: () => 0 });
    s2.start();
    s2.tapTile({ x: 1, y: 0 });
    s2.tapTile({ x: 2, y: 0 });
    expect(s2.state.tiles[2]!.owner).toBe(0);
    expect(s2.store.getState().selected).toBeNull();
    expect(s2.anims.items.some((a) => a.type === "slide")).toBe(true);
    expect(s2.anims.items.some((a) => a.type === "flash")).toBe(true);
  });

  it("END_TURN hands to the AI, replays its actions ~300 ms apart with the HUD recoloured, then shows Next day", () => {
    const engine = mockEngine(fixtureState());
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, now: () => 0 });
    session.start();
    session.endTurn();
    let ui = session.store.getState();
    expect(ui.aiPlaying).toBe(true);
    expect(ui.actingPlayer).toBe(1);
    expect(session.dispatch({ type: "END_TURN" }).error).toBe("not your turn");
    vi.advanceTimersByTime(299);
    expect(session.state.activePlayerIndex).toBe(1);
    vi.advanceTimersByTime(1);
    ui = session.store.getState();
    expect(session.state.activePlayerIndex).toBe(0);
    expect(session.state.turnNumber).toBe(1);
    expect(ui.aiPlaying).toBe(false);
    expect(ui.actingPlayer).toBe(0);
    expect(ui.banner).toBe("Next day...");
    expect(session.anims.items.some((a) => a.type === "float" && a.text === "+3")).toBe(true);
    vi.advanceTimersByTime(1100);
    expect(session.store.getState().banner).toBeNull();
  });

  it("UNDO is a no-op with an empty history and restores the previous state otherwise", () => {
    const engine = mockEngine(fixtureState());
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, now: () => 0 });
    session.start();
    session.undo();
    expect(engine.applyMock).not.toHaveBeenCalled();
    session.tapTile({ x: 1, y: 0 });
    session.tapTile({ x: 2, y: 0 });
    expect(session.state.tiles[2]!.owner).toBe(0);
    session.undo();
    expect(session.state.tiles[2]!.owner).toBe(1);
    expect(session.state.history).toEqual([]);
  });

  it("surfaces an engine rejection as a toast and leaves the state untouched", () => {
    const engine = mockEngine(fixtureState());
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, now: () => 0 });
    session.start();
    const before = session.state;
    session.dispatch({ type: "BUY", item: "farm", at: { x: 1, y: 1 } });
    expect(session.state).toBe(before);
    expect(session.store.getState().toast).toBe("NOT ENOUGH GOLD");
    vi.advanceTimersByTime(900);
    expect(session.store.getState().toast).toBeNull();
  });

  it("an unaffordable card fires notEnoughGold every time and never dispatches", () => {
    const engine = mockEngine(fixtureState());
    const map = { ...DEMO_MAP, tutorial: [{ triggerId: "notEnoughGold" as const, text: "POOR" }] };
    const session = createSession({ map, config: campaignConfig, engine, now: () => 0 });
    session.start();
    session.tapCard("stoneTower"); // 15 > 10 gold
    expect(engine.applyMock).not.toHaveBeenCalled();
    expect(session.store.getState().tutorialStep?.text).toBe("POOR");
    session.dismissTutorial();
    session.tapCard("farm");
    expect(session.store.getState().tutorialStep?.text).toBe("POOR");
    // an affordable card enters placement mode with the build zone lit
    session.dismissTutorial();
    session.tapCard("woodwall");
    expect(session.store.getState().shopItem).toBe("woodwall");
    expect(session.store.getState().litZone).toEqual([{ x: 1, y: 1 }]);
  });

  it("records a campaign win through localProgress with the level, difficulty and turn count", () => {
    const state = fixtureState();
    const engine = mockEngine(state);
    engine.applyMock.mockImplementationOnce((s: GameState) => ({
      state: { ...s, outcome: { winner: 0 } },
      events: [{ type: "gameOver" as const, winner: 0 }],
    }));
    const progress = progressSpy();
    const save = vi.fn();
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, progress, save, now: () => 0 });
    session.start();
    session.dispatch({ type: "END_TURN" });
    expect(progress.recordLevelWin).toHaveBeenCalledWith("01", "hard", 1);
    expect(session.store.getState().gameOver).toEqual({ winner: 0, humanWon: true });
    expect(save).toHaveBeenLastCalledWith(null);
  });

  it("records a challenge medal for a challenge source and nothing for a defeat", () => {
    const engine = mockEngine(fixtureState());
    engine.applyMock.mockImplementationOnce((s: GameState) => ({ state: { ...s, outcome: { winner: 0 } }, events: [] }));
    const progress = progressSpy();
    const config: SessionConfig = { ...campaignConfig, source: { kind: "challenge", mapId: "m1", weekKey: "2026-W39" } };
    const session = createSession({ map: DEMO_MAP, config, engine, progress, now: () => 0 });
    session.start();
    session.dispatch({ type: "END_TURN" });
    expect(progress.recordChallengeWin).toHaveBeenCalledWith("2026-W39", "m1", "hard");

    const lost = mockEngine(fixtureState());
    lost.applyMock.mockImplementationOnce((s: GameState) => ({ state: { ...s, outcome: { winner: 1 } }, events: [] }));
    const p2 = progressSpy();
    const s2 = createSession({ map: DEMO_MAP, config, engine: lost, progress: p2, now: () => 0 });
    s2.start();
    s2.dispatch({ type: "END_TURN" });
    expect(p2.recordChallengeWin).not.toHaveBeenCalled();
    expect(s2.store.getState().gameOver).toEqual({ winner: 1, humanWon: false });
  });

  it("hot-seat: shows the hand-off before a second human's turn and hides the board until continued", () => {
    const state = fixtureState();
    state.players[1] = { ...state.players[1]!, kind: "human", aiDifficulty: null };
    const engine = mockEngine(state);
    const config: SessionConfig = {
      ...campaignConfig,
      source: { kind: "generated", map: DEMO_MAP, seed: 3 },
      seats: [
        { index: 0, kind: "human", aiDifficulty: "normal", name: "Ann" },
        { index: 1, kind: "human", aiDifficulty: "normal", name: "Bob" },
      ],
    };
    const session = createSession({ map: DEMO_MAP, config, engine, now: () => 0 });
    session.start();
    expect(session.store.getState().handOff).toEqual({ player: 0 });
    expect(session.store.getState().hidden).toBe(true);
    session.continueHandOff();
    expect(session.store.getState().hidden).toBe(false);
    session.endTurn();
    const ui = session.store.getState();
    expect(ui.handOff).toEqual({ player: 1 });
    expect(ui.hidden).toBe(true);
    expect(ui.aiPlaying).toBe(false);
    expect(session.tapTile({ x: 2, y: 0 })).toBeUndefined();
    session.continueHandOff();
    expect(session.store.getState().actingPlayer).toBe(1);
    expect(session.store.getState().handOff).toBeNull();
  });

  it("autosaves after every accepted action and resumes from a save", () => {
    const engine = mockEngine(fixtureState());
    const save = vi.fn();
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, save, now: () => 0 });
    session.start();
    session.tapTile({ x: 1, y: 0 });
    session.tapTile({ x: 1, y: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0] as SavedSession;
    expect(saved.state.tiles[5]!.unit).not.toBeNull();
    const resumed = createSession({ map: DEMO_MAP, config: campaignConfig, engine, resume: saved, now: () => 0 });
    resumed.start();
    expect(resumed.state.tiles[5]!.unit).not.toBeNull();
  });

  it("skipAnimations empties the queue and collapses AI pacing to the next tick", () => {
    const engine = mockEngine(fixtureState());
    const session = createSession({ map: DEMO_MAP, config: campaignConfig, engine, skipAnimations: true, now: () => 0 });
    session.start();
    session.tapTile({ x: 1, y: 0 });
    session.tapTile({ x: 2, y: 0 });
    expect(session.anims.items).toEqual([]);
    session.endTurn();
    vi.advanceTimersByTime(0);
    expect(session.state.activePlayerIndex).toBe(0);
    expect(session.store.getState().banner).toBeNull();
  });
});

describe("session runner (real engine smoke)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const config: SessionConfig = {
    source: { kind: "generated", map: DEMO_MAP, seed: 11 },
    seats: [
      { index: 0, kind: "human", aiDifficulty: "normal" },
      { index: 1, kind: "ai", aiDifficulty: "easy" },
    ],
    difficulty: "normal",
    seed: 11,
  };

  it("the demo map is a valid map and the human's knight has a move zone", () => {
    const state = createInitialState(DEMO_MAP, 11);
    expect(state.players).toHaveLength(2);
    const session = createSession({ map: DEMO_MAP, config, engine: realEngine, now: () => 0 });
    session.start();
    session.dismissTutorial();
    session.tapTile({ x: 3, y: 4 });
    const ui = session.store.getState();
    expect(ui.selected).toEqual({ x: 3, y: 4 });
    expect(ui.litZone.length).toBeGreaterThan(0);
  });

  it("plays a full round against the real AI and comes back to the human on day 2", () => {
    const session = createSession({ map: DEMO_MAP, config, engine: realEngine, now: () => 0 });
    session.start();
    session.dismissTutorial();
    session.tapTile({ x: 3, y: 4 });
    const target = session.store.getState().litZone.find((t) => {
      const tile = session.state.tiles[t.y * session.state.width + t.x]!;
      return tile.owner === null && !tile.unit && !tile.building;
    });
    expect(target).toBeDefined();
    session.tapTile(target!);
    expect(session.state.tiles[target!.y * session.state.width + target!.x]!.owner).toBe(0);
    expect(session.state.history).toHaveLength(1);
    const banners: Array<string | null> = [];
    session.store.subscribe((s) => banners.push(s.banner));
    session.endTurn();
    expect(session.store.getState().aiPlaying).toBe(true);
    vi.advanceTimersByTime(300 * 60);
    expect(session.store.getState().aiPlaying).toBe(false);
    expect(session.state.activePlayerIndex).toBe(0);
    expect(session.state.turnNumber).toBe(1);
    expect(banners).toContain("Next day..."); // shown for the human's day 2, then cleared
    expect(session.store.getState().banner).toBeNull();
    // sanity: the real reducer accepts the same END_TURN the runner sent
    expect(realApply(session.state, { type: "END_TURN" }).error).toBeUndefined();
  });

  it("applyForTest bypasses the turn guard but still runs the AI after END_TURN", () => {
    const session = createSession({ map: DEMO_MAP, config, engine: realEngine, skipAnimations: true, now: () => 0 });
    session.start();
    session.applyForTest({ type: "END_TURN" });
    vi.runAllTimers();
    expect(session.state.activePlayerIndex).toBe(0);
    expect(session.state.turnNumber).toBe(1);
    expect(() => session.applyForTest({ type: "MOVE", unitAt: { x: 0, y: 0 }, to: { x: 1, y: 0 } })).toThrow();
  });

  it("the demo map's tiles are what the renderer expects to draw", () => {
    const kinds = new Set(DEMO_MAP.tiles.map((t: TileDefinition) => t.terrain));
    for (const k of ["water", "grass", "forestPine", "mountain", "grassField", "bridge"]) expect(kinds.has(k as TileDefinition["terrain"])).toBe(true);
  });
});
