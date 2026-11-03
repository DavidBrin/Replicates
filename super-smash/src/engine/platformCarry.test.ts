/**
 * Smashville's moving platform and what it carries (Plan 6, Task 12). A passenger is
 * carried, then judged against the platform where it now is; a fighter frozen in hitlag
 * or trapped by a Final Smash rides it too (decision D6, UNVERIFIED: SmashWiki "Hitlag"
 * freezes fighters "in place" and no page says whose place); and while a Final Smash's
 * scene stands the stage still (ruling R-T14f), nothing on it is carried.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "./fixed";
import { platformCentreX } from "./physics";
import { createInitialState, registerFighters, registerStages, step } from "./simulate";
import type { GameState, MatchRules, StageDef } from "./types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const SV: StageDef = STAGES.find((s) => s.id === "smashville")!;
const MOVER = SV.platforms.findIndex((p) => p.motion !== undefined);
const PLAT = SV.platforms[MOVER];

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Mario standing on the moving platform at `dx` from its centre on stage frame `frame`; Fox far away on the floor. */
function onPlatform(dx: number, stageFrame: number): GameState {
  const s = createInitialState("smashville", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  s.stageFrame = stageFrame;
  Object.assign(s.fighters[0], {
    action: "stand", actionFrame: 10, grounded: true, platform: MOVER, x: platformCentreX(PLAT, stageFrame) + dx, y: PLAT.y, facing: 1, intangible: 0, vx: 0, vy: 0,
  });
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -fx(60), y: 0, intangible: 0 });
  return s;
}

/** How far the platform moves on the next step from `s` (the stage's clock runs first). */
const delta = (s: GameState) => platformCentreX(PLAT, s.stageFrame + 1) - platformCentreX(PLAT, s.stageFrame);

/**
 * Fox's Team Star Fox start holding Mario, who stands on the platform at its centre:
 * Fox far off on the floor, in the start's lock-on (no scene yet) or, with `scene`, in
 * its scene (`cinematic`), which stands the stage still.
 */
function trapped(scene: boolean): GameState {
  const s = onPlatform(0, 1);
  Object.assign(s.fighters[1], { action: "special", move: scene ? "finalAttack" : "finalSmash", actionFrame: 5, intangible: 0 });
  Object.assign(s.fighters[0], { action: "finalTrapped", actionFrame: 0 });
  s.fighters[0].combat.trappedBy = 1;
  if (scene) s.cinematic = 1;
  return s;
}

describe("Smashville's platform carries what stands on it (Plan 6, Task 12)", () => {
  it("keeps a passenger at its trailing end mid-sweep, at every phase where it moves fastest", () => {
    const period = PLAT.motion!.periodFrames;
    for (const at of [0, 1, 2, period / 2 - 1, period / 2, period / 2 + 1]) {
      const s = onPlatform(0, at);
      const trailing = delta(s) > 0 ? -1 : 1;
      s.fighters[0].x = platformCentreX(PLAT, at) + trailing * (PLAT.halfWidth - fx(0.3));
      const after = step(s, [0, 0], { prevInputs: [0, 0] }).state;
      expect(after.fighters[0].grounded, `stage frame ${at}`).toBe(true);
      expect(after.fighters[0].platform).toBe(MOVER);
    }
  });

  it("carries a fighter frozen in hitlag", () => {
    const s = onPlatform(0, 1);
    s.fighters[0].hitlag = 5;
    const moved = delta(s);
    const after = step(s, [0, 0], { prevInputs: [0, 0] }).state;
    expect(after.fighters[0].x - s.fighters[0].x).toBe(moved);
  });

  it("carries a fighter trapped by a Final Smash", () => {
    const s = trapped(false);
    const moved = delta(s);
    const after = step(s, [0, 0], { prevInputs: [0, 0] }).state;
    expect(after.fighters[0].action, "still trapped").toBe("finalTrapped");
    expect(after.fighters[0].x - s.fighters[0].x).toBe(moved);
  });

  it("carries nobody while a Final Smash's scene stands the stage still (ruling R-T14f)", () => {
    // The trapped fighter, and a bystander the scene stands still: neither slides.
    const s = trapped(true);
    const by = createInitialState("smashville", [{ defId: "mario" }, { defId: "fox" }, { defId: "kirby" }], { ...RULES, oneOnOne: false }, 5);
    by.stageFrame = s.stageFrame;
    by.cinematic = 1;
    Object.assign(by.fighters[0], s.fighters[0], { combat: { ...s.fighters[0].combat } });
    Object.assign(by.fighters[1], s.fighters[1], { combat: { ...s.fighters[1].combat } });
    Object.assign(by.fighters[2], { action: "stand", actionFrame: 10, grounded: true, platform: MOVER, x: platformCentreX(PLAT, by.stageFrame) + fx(10), y: PLAT.y, intangible: 0, vx: 0, vy: 0 });
    let st = by;
    for (let i = 0; i < 5; i++) st = step(st, [0, 0, 0], { prevInputs: [0, 0, 0] }).state;
    expect(st.stageFrame, "the stage's clock stood still").toBe(by.stageFrame);
    expect([st.fighters[0].x, st.fighters[2].x]).toEqual([by.fighters[0].x, by.fighters[2].x]);
  });
});
