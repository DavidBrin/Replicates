import { describe, expect, it } from "vitest";
import { aiTakeTurn } from "./ai";
import { generateRandomMap } from "./generator";
import { apply } from "./reducer";
import { provinceIncome, provinceUpkeep, provincesOf } from "./rules";
import { createInitialState } from "./state";
import { asciiMap } from "./testing/asciiMap";
import { padSpec } from "./testing/fixtures";
import type { Action, Difficulty, GameState, MapDefinition } from "./types";

/** Runs one AI turn through `apply`, asserting the action list is well-formed. */
function playAiTurn(s: GameState, seed: number): { state: GameState; actions: Action[]; nextSeed: number } {
  const me = s.activePlayerIndex;
  const r = aiTakeTurn(s, me, seed);
  expect(r.actions.length).toBeGreaterThan(0);
  expect(r.actions[r.actions.length - 1]).toEqual({ type: "END_TURN" });
  expect(r.actions.filter((a) => a.type === "END_TURN")).toHaveLength(1);
  expect(r.actions.some((a) => a.type === "UNDO")).toBe(false);
  let state = s;
  for (let i = 0; i < r.actions.length; i++) {
    const action = r.actions[i] as Action;
    if (i === r.actions.length - 1) {
      // Before END_TURN: the AI's provinces can pay next turn's upkeep.
      for (const p of provincesOf(state, me)) {
        const net = provinceIncome(state, p) - provinceUpkeep(state, p);
        const startNet = solvencyAtTurnStart.get(p.id);
        if (startNet === undefined || startNet >= 0) expect(p.gold + net, `${p.id} gold ${p.gold} net ${net}`).toBeGreaterThanOrEqual(0);
      }
    }
    const res = apply(state, action);
    expect(res.error, `${JSON.stringify(action)} → ${res.error}`).toBeUndefined();
    state = res.state;
    if (state.outcome !== null) break;
  }
  return { state, actions: r.actions, nextSeed: r.nextSeed };
}

/** Projected balance of each of the AI's provinces at its turn start (an inherited deficit is not the AI's doing). */
const solvencyAtTurnStart = new Map<string, number>();
function noteTurnStart(s: GameState): void {
  solvencyAtTurnStart.clear();
  for (const p of provincesOf(s, s.activePlayerIndex)) solvencyAtTurnStart.set(p.id, p.gold + provinceIncome(s, p) - provinceUpkeep(s, p));
}

function playGame(map: MapDefinition, seed: number, difficulty: Difficulty, maxTurns: number): GameState {
  let s = createInitialState(map, seed, { seats: map.players.map(() => ({ kind: "ai" as const, aiDifficulty: difficulty })) });
  let rng = seed;
  for (let turn = 0; turn < maxTurns && s.outcome === null; turn++) {
    noteTurnStart(s);
    const r = playAiTurn(s, rng);
    s = r.state;
    rng = r.nextSeed;
  }
  return s;
}

const fixture = asciiMap(
  padSpec({
    terrain: ["~~~~~~~~~~~~~~", "~............~", "~....^...T...~", "~............~", "~......f.....~", "~............~", "~......~.....~", "~............~", "~~~~~~~~~~~~~~"],
    owners: ["..............", ".000......111.", ".000......111.", ".000......111.", "..............", ".222......333.", ".222......333.", ".222......333.", ".............."],
    objects: ["..............", ".C1........C1.", "..............", "..1........M..", ".....$........", ".C1........C1.", "..............", "..............", ".............."],
    startGold: 10,
  }),
);

describe("AI (SPEC §11, D17)", () => {
  it("Normal AI never ends its own turn bankrupt on a generated medium map — 50 seeds", () => {
    for (let seed = 0; seed < 50; seed++) {
      const map = generateRandomMap({ size: "medium", biome: "grass", seats: [{ kind: "ai" }, { kind: "ai" }, { kind: "ai" }] }, seed);
      playGame(map, seed, "normal", 60);
    }
  });

  it("Normal AI never ends its own turn bankrupt on the hand-built fixture — 50 seeds", () => {
    for (let seed = 0; seed < 50; seed++) playGame(fixture, seed, "normal", 80);
  });

  it("Easy and Hard produce legal turns too, and Hard tends to finish games", () => {
    let finished = 0;
    for (let seed = 0; seed < 10; seed++) {
      playGame(fixture, seed, "easy", 40);
      const hard = playGame(fixture, seed, "hard", 300);
      if (hard.outcome !== null) finished++;
    }
    expect(finished).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed and returns a fresh seed", () => {
    const s = createInitialState(fixture, 3, { seats: fixture.players.map(() => ({ kind: "ai" as const })) });
    const a = aiTakeTurn(s, 0, 123);
    const b = aiTakeTurn(s, 0, 123);
    expect(a).toEqual(b);
    expect(a.nextSeed).not.toBe(123);
    expect(aiTakeTurn(s, 0, 124).nextSeed).not.toBe(a.nextSeed);
  });

  it("acts: captures neutral land and buys knights when it can afford them", () => {
    const s = createInitialState(fixture, 5, { seats: fixture.players.map(() => ({ kind: "ai" as const })) });
    const r = aiTakeTurn(s, 0, 5);
    expect(r.actions.filter((a) => a.type === "MOVE").length).toBeGreaterThanOrEqual(1);
    expect(r.actions.some((a) => a.type === "BUY" && a.item === "knight1")).toBe(true);
  });

  it("returns only END_TURN when asked to play a seat that is not active or a finished game", () => {
    const s = createInitialState(fixture, 5);
    expect(aiTakeTurn(s, 1, 9).actions).toEqual([{ type: "END_TURN" }]);
    expect(aiTakeTurn({ ...s, outcome: { winner: 0 } }, 0, 9).actions).toEqual([{ type: "END_TURN" }]);
  });
});
