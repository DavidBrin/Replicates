import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import { SMASH_BALL_CEILING, SMASH_BALL_FLOOR, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import type { FighterDef, MatchRules, StageDef } from "./types";

const STAGE: StageDef = {
  id: "s",
  name: "S",
  series: "",
  platforms: [{ x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true }],
  blastZone: { left: fx(-240), right: fx(240), top: fx(190), bottom: fx(-140) },
  spawns: [{ x: fx(-20), y: 0 }],
  theme: "",
};
const DEF = { id: "t", moves: {}, attributes: { width: fx(2), height: fx(11) } } as unknown as FighterDef;
const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };
const RULES: MatchRules = { mode: "time", stocks: 1, timeLimit: 60 * 60 * 5, smashBall: true, oneOnOne: false };

describe("the Smash Ball (Plan 5)", () => {
  it("floats over the stage and never drifts out of reach", () => {
    let s = createInitialState("s", [{ defId: "t" }], RULES, 77, CTX);
    s.fighters[0].action = "dead";
    s.fighters[0].stocks = 0;
    s.smashBall = { active: true, x: 0, y: fx(30), vx: 0, vy: 0, health: fx(4000), driftTimer: 0 };
    for (let i = 0; i < 3000; i++) {
      s = step(s, [0], { ctx: CTX }).state;
      // One frame of drift past the edge at most, then it turns back.
      expect(Math.abs(s.smashBall.x)).toBeLessThanOrEqual(fx(80) + fx(2));
      expect(s.smashBall.y).toBeLessThanOrEqual(SMASH_BALL_CEILING + fx(2));
      expect(s.smashBall.y).toBeGreaterThanOrEqual(SMASH_BALL_FLOOR - fx(2));
    }
  });
});
