/**
 * A side special pressed away from where the fighter faces turns it round first
 * (Plan 5, Task 4 fix round 1). SmashWiki "Side special move"
 * (https://www.ssbwiki.com/Side_special_move): "any character can quickly turn
 * around on the spot and immediately perform their side special move".
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `id` at x −30 facing right, Mario far off at x 60. */
function alone(id: string, air: boolean): GameState {
  const s = createInitialState("finalDestination", [{ defId: id }, { defId: "mario" }], RULES, 5);
  Object.assign(s.fighters[0], { action: air ? "fall" : "stand", actionFrame: 0, grounded: !air, platform: air ? -1 : 0, x: fx(-30), y: air ? fx(40) : 0, facing: 1, intangible: 0 });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0 });
  return s;
}

describe("a side special pressed backward", () => {
  for (const def of FIGHTERS.filter((d) => d.moves.sideB !== undefined)) {
    for (const air of [false, true]) {
      it(`turns ${def.id} round first, ${air ? "in the air" : "on the ground"}`, () => {
        const f = step(alone(def.id, air), [Btn.Left | Btn.Special, 0], { prevInputs: [0, 0] }).state.fighters[0];
        expect([f.action, f.move, f.facing]).toEqual(["special", "sideB", -1]);
      });
    }
  }

  it("lets Mario Cape an opponent behind him", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-10), y: 0, facing: 1, intangible: 0 });
    let state = s;
    let prev: [InputFrame, InputFrame] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const now: [InputFrame, InputFrame] = [i === 0 ? Btn.Left | Btn.Special : 0, 0];
      state = step(state, now, { prevInputs: prev }).state;
      prev = now;
    }
    expect(state.fighters[0].facing).toBe(-1);
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(7 * 1.05 * 1.2, 2);
    expect(state.fighters[1].facing).toBe(-1);
  });
});
