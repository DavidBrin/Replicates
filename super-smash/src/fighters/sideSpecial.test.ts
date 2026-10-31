/**
 * A side special pressed away from where the fighter faces turns it round first
 * (Plan 5, Task 4 fix rounds 1 and 2). SmashWiki "Side special move"
 * (https://www.ssbwiki.com/Side_special_move): "any character can quickly turn
 * around on the spot and immediately perform their side special move", but
 * "when running, the player cannot use their side special backward without
 * having to stop or turn around first". UNVERIFIED: the turn in the air (the
 * page does not say).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { beginSpecial } from "@/engine/states";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, MoveSlot } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, mario } from "./index";

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
        // Left and B pressed together are a smash input, so a side special with a
        // smash version turns into that (Plan 5, Task 13d: Samus's and Link's).
        expect([f.action, f.move, f.facing]).toEqual(["special", def.moves.sideB!.smashInput?.slot ?? "sideB", -1]);
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

  // "When running, the player cannot use their side special backward": a backward
  // press out of a run is the forward side special, on the run's momentum.
  for (const id of ["fox", "mario", "donkeyKong"]) {
    it(`does not turn ${id} out of a run: Left+B running right is the side special facing right`, () => {
      let s = alone(id, false);
      let prev: InputFrame = 0;
      for (let i = 0; i < 40 && s.fighters[0].action !== "run"; i++) {
        s = step(s, [Btn.Right, 0], { prevInputs: [prev, 0] }).state;
        prev = Btn.Right;
      }
      expect(s.fighters[0].action).toBe("run");
      const f = step(s, [Btn.Left | Btn.Special, 0], { prevInputs: [prev, 0] }).state.fighters[0];
      expect([f.action, f.move, f.facing]).toEqual(["special", "sideB", 1]);
      expect(f.vx).toBeGreaterThan(0);
    });
  }

  it("is a side special's only: up, down and neutral specials keep the facing whatever the stick says", () => {
    const s = alone("mario", false);
    const stage = STAGES.find((st) => st.id === "finalDestination")!;
    const facingAfter = (slot: MoveSlot, stickX: number): number => {
      const f = structuredClone(s.fighters[0]);
      expect(beginSpecial(f, { def: mario, stage, frame: 0, fighters: s.fighters }, slot, stickX)).toBe(true);
      return f.facing;
    };
    expect((["neutralB", "upB", "downB"] as MoveSlot[]).map((slot) => facingAfter(slot, -1))).toEqual([1, 1, 1]);
    expect(facingAfter("sideB", -1)).toBe(-1);
    // Through the stick too: up-back and down-back are the up and down specials, unturned.
    for (const [stick, slot] of [[Btn.Left | Btn.Up, "upB"], [Btn.Left | Btn.Down, "downB"]] as const) {
      const f = step(alone("mario", false), [stick | Btn.Special, 0], { prevInputs: [0, 0] }).state.fighters[0];
      expect([f.move, f.facing]).toEqual([slot, 1]);
    }
  });
});
