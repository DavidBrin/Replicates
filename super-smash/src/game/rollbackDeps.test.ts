import { beforeAll, describe, expect, it, vi } from "vitest";

import { hashState } from "@/engine/hash";
import { DEFAULT_SEED, createInitialState, step } from "@/engine/simulate";
import { Btn, type GameState, type MatchRules } from "@/engine/types";
import { bootstrapEngine } from "./bootstrap";
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
import { GAME_SIM_CONTEXT } from "./simContext";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 60 * 60 * 7, smashBall: false, oneOnOne: true };

/** Both fighters on the ground and actionable. */
function landed(): GameState {
  let state = createInitialState("battlefield", [{ defId: "mario" }, { defId: "fox" }], RULES, DEFAULT_SEED);
  for (let i = 0; i < 90; i++) state = step(state, [0, 0], { prevInputs: [0, 0] }).state;
  return state;
}

beforeAll(() => {
  bootstrapEngine();
});

describe("the engine, as the rollback session sees it", () => {
  it("passes prevInputs through, so a press is a press (D25)", () => {
    const state = landed();
    const press = ENGINE_ROLLBACK_DEPS.step(state, [Btn.Jump, 0], [0, 0]).state;
    const hold = ENGINE_ROLLBACK_DEPS.step(state, [Btn.Jump, 0], [Btn.Jump, 0]).state;
    expect(hashState(press)).not.toBe(hashState(hold));
  });

  it("is the engine's own step, exactly", () => {
    const state = landed();
    expect(hashState(ENGINE_ROLLBACK_DEPS.step(state, [Btn.Right, 0], [0, 0]).state)).toBe(
      hashState(step(state, [Btn.Right, 0], { prevInputs: [0, 0] }).state),
    );
  });

  it("clones deeply, so a saved frame cannot change behind the session's back", () => {
    const state = landed();
    const copy = ENGINE_ROLLBACK_DEPS.cloneState(state);
    expect(copy).not.toBe(state);
    expect(copy.fighters).not.toBe(state.fighters);
    expect(ENGINE_ROLLBACK_DEPS.hashState(copy)).toBe(hashState(state));
  });

  it("steps with the game's SimContext, so a bone bake reaches online play too", () => {
    const state = landed();
    const spy = vi.spyOn(GAME_SIM_CONTEXT, "fighter");
    ENGINE_ROLLBACK_DEPS.step(state, [0, 0], [0, 0]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
