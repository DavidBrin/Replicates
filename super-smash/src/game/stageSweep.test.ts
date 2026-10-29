// @vitest-environment node
/**
 * The baked CPU sweep (Plan 4 Task 12 re-review, N3): every ordered pair of the
 * roster's eight fighters, 56 matches, round the six stages, CPU level 9
 * against level 7, up to 3,600 frames each, stepped on the game's baked context
 * and checked on every frame for one thing: no fighter's origin inside a hard
 * platform's solid body (`stageInvariantBreaks`).
 *
 * The golden's six matches never reach the corner that once let a body rise
 * through the stage's underside (Task 12 fix round 1, C1): with that fix
 * undone, the golden stays green and this sweep fails. Which match reaches a
 * corner case moves with every engine change, so the net is wide (all 56
 * pairs, the full 3,600 frames), not tuned to the matches that once found it.
 * Step and check only, no trace: about two seconds on its own, longer with the
 * rest of the suite running beside it, hence its own timeout.
 */

import { describe, expect, it } from "vitest";

import { cpuInput, type CpuWorld } from "@/ai/cpu";
import { airBrakeFromDef, airDodgeFromDef, meleeReachFromDef, stageViewFromDef } from "@/ai/behaviours";
import { createInitialState, step, type SimContext } from "@/engine/simulate";
import type { InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { stageInvariantBreaks } from "./stateInvariants";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const CTX = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGE_BY_ID.get(id)! }, readBakeFromDisk());
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const FRAMES = 3_600;

/** One CPU match, `a` (level 9) against `b` (level 7), and the first few frames that put a fighter inside the stage. */
function sweep(ctx: SimContext, a: string, b: string, stageId: string, smashBall: boolean, seed: number): { frames: number; breaks: string[] } {
  let state = createInitialState(stageId, [{ defId: a }, { defId: b }], { ...RULES, smashBall }, seed, ctx);
  const stage = ctx.stage(stageId);
  const view = stageViewFromDef(stage);
  const worlds: CpuWorld[] = [a, b].map((id) => {
    const def = ctx.fighter(id);
    return { stage: view, jumps: def.attributes.jumps, meleeReach: meleeReachFromDef(def), airBrake: airBrakeFromDef(def), airDodge: airDodgeFromDef(def) };
  });
  let cpuSeed = seed ^ 0x1f2e3d4c;
  let prev: readonly InputFrame[] = [0, 0];
  const breaks: string[] = [];
  let frame = 0;
  while (frame < FRAMES && state.outcome === null) {
    frame++;
    const inputs = [0, 1].map((port) => {
      const r = cpuInput(state, port, port === 0 ? 9 : 7, cpuSeed, worlds[port]);
      cpuSeed = r.seed;
      return r.input;
    });
    state = step(state, inputs, { prevInputs: prev, ctx }).state;
    prev = inputs;
    if (breaks.length < 3) breaks.push(...stageInvariantBreaks(state, stage, frame));
  }
  return { frames: frame, breaks };
}

describe("the baked CPU sweep", () => {
  it("keeps every fighter's origin out of the stage's solid bodies, on every frame of 56 CPU matches", () => {
    const ids = FIGHTERS.map((f) => f.id);
    const found: Record<string, string[]> = {};
    let n = 0;
    let stepped = 0;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const stageId = STAGES[n % STAGES.length].id;
        const { frames, breaks } = sweep(CTX, a, b, stageId, n % 2 === 0, 1000 + n);
        stepped += frames;
        if (breaks.length > 0) found[`${a}-${b}@${stageId}`] = breaks;
        n++;
      }
    }
    expect(n).toBe(56);
    // A sweep that ended every match at once would prove nothing.
    expect(stepped).toBeGreaterThan(56 * 1_000);
    expect(found).toEqual({});
  }, 60_000);
});
