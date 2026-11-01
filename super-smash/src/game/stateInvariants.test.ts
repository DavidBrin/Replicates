/**
 * The whole-state rules the golden and the baked sweep check on every frame
 * (`stateInvariants.ts`), each shown to flag a crafted state and to spare both
 * sides of every boundary (Plan 4 Task 12 re-review, N3): without this, a rule
 * that could never fire would pass both of them for ever.
 */

import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import { createInitialState, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, Platform, StageDef } from "@/engine/types";
import { getFighter } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { bootstrapEngine } from "./bootstrap";
import { ledgeInvariantBreaks, stageInvariantBreaks, stateInvariantBreaks } from "./stateInvariants";

bootstrapEngine();

const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;

/** A hard main platform at x 10, its surface at y 0, 40 wide each way; and a soft one above it. */
const HARD: Platform = { x: fx(10), y: 0, halfWidth: fx(40), soft: false, ledges: true };
const SOFT: Platform = { x: fx(10), y: fx(30), halfWidth: fx(15), soft: true, ledges: false };
const STAGE: StageDef = { ...STAGES[0], platforms: [HARD, SOFT] };

/** Two fighters, port 0 at (x, y) and port 1 far off to the side, at `frame`. */
function stateWith(x: number, y: number, over: Partial<FighterState> = {}, frame = 0): GameState {
  const s = createInitialState(STAGES[0].id, [{ defId: "mario" }, { defId: "fox" }], RULES, 1);
  return {
    ...s,
    frame,
    fighters: [
      { ...s.fighters[0], x, y, ledge: null, ...over },
      { ...s.fighters[1], x: fx(500), y: fx(500), ledge: null },
    ],
  };
}

describe("no fighter inside the stage", () => {
  const cx = HARD.x;
  const right = cx + HARD.halfWidth;
  const underside = HARD.y - HARD_PLATFORM_DEPTH;

  it("flags an origin strictly inside a hard platform's solid body, naming the frame, the port, where and the action", () => {
    expect(stageInvariantBreaks(stateWith(cx, -fx(5), { action: "fall" }), STAGE, 20)).toEqual(["frame 20, port 0: origin (10, -5) inside platform 0 (fall)"]);
  });

  it("spares the boundaries: on the surface, at the underside, level with either wall", () => {
    for (const [x, y] of [
      [cx, HARD.y],
      [cx, underside],
      [right, -fx(5)],
      [cx - HARD.halfWidth, -fx(5)],
    ]) {
      expect(stageInvariantBreaks(stateWith(x, y), STAGE, 1), `${x}, ${y}`).toEqual([]);
    }
  });

  it("flags one Q12 step inside each boundary", () => {
    for (const [x, y] of [
      [cx, HARD.y - 1],
      [cx, underside + 1],
      [right - 1, -fx(5)],
      [cx - HARD.halfWidth + 1, -fx(5)],
    ]) {
      expect(stageInvariantBreaks(stateWith(x, y), STAGE, 1), `${x}, ${y}`).toHaveLength(1);
    }
  });

  it("spares a fighter under the stage, beside it, and inside a soft platform's span below its surface", () => {
    expect(stageInvariantBreaks(stateWith(cx, underside - fx(5)), STAGE, 1)).toEqual([]);
    expect(stageInvariantBreaks(stateWith(right + fx(5), -fx(5)), STAGE, 1)).toEqual([]);
    expect(stageInvariantBreaks(stateWith(SOFT.x, SOFT.y - fx(5)), STAGE, 1)).toEqual([]);
  });

  it("measures a moving platform where it is on the stage's clock (`stageFrame`, which a pause stops; Plan 5 Task 14 fix round 1)", () => {
    const sweeping: Platform = { ...HARD, motion: { kind: "sweep", amplitude: fx(30), periodFrames: 240 } };
    const stage: StageDef = { ...STAGE, platforms: [sweeping] };
    const frame = 60;
    const there = platformCentreX(sweeping, frame);
    expect(there).not.toBe(platformCentreX(sweeping, 0));
    // Inside the platform where it is now, and outside where it started.
    const x = there + sweeping.halfWidth - fx(1);
    expect(Math.abs(x - platformCentreX(sweeping, 0))).toBeGreaterThan(sweeping.halfWidth);
    // The match's frame is later than the stage's: a pause has stopped the stage.
    expect(stageInvariantBreaks({ ...stateWith(x, -fx(5), {}, frame + 37), stageFrame: frame }, stage, 7)).toHaveLength(1);
    expect(stageInvariantBreaks({ ...stateWith(x, -fx(5), {}, frame), stageFrame: frame + 37 }, stage, 7)).toHaveLength(0);
  });

  // Plan 5 final wave 2, ruling R-FW2d (the final review's M3, found by this rule in a
  // four-player free-for-all): Fox, hit during Fire Fox beside Final Destination's
  // underside lip, was SDI'd from x 82.7 to 79.4 at y −26, his origin inside the stage
  // for 3 frames. His bones' ECB (half 2.75 in Fire Fox, the committed bake) already
  // overlapped the wall at 82.7, and the clamp skipped a body that started inside. Here
  // he is frozen there 20 frames in Fire Fox and mashes in on every other one.
  it("keeps Fox's origin out of Final Destination as he SDIs in beside its underside lip, his body already overlapping it (ruling R-FW2d)", () => {
    const ctx = bakedContext({ fighter: (id) => getFighter(id)!, stage: (id) => STAGES.find((st) => st.id === id)! }, readBakeFromDisk());
    const fd = ctx.stage("finalDestination");
    let s = createInitialState(fd.id, [{ defId: "mario" }, { defId: "fox" }], RULES, 1, ctx);
    s.fighters[0].x = fx(-50);
    Object.assign(s.fighters[1], { x: fx(82.7), y: fx(-26), grounded: false, platform: -1, action: "special", move: "upB", actionFrame: 20, hitstun: 30, hitlag: 20 });
    s.fighters[1].combat.victimFreeze = true;
    let prev: InputFrame[] = [0, 0];
    const xs: number[] = [];
    const breaks: string[] = [];
    for (let i = 0; i < 20; i++) {
      const now: InputFrame[] = [0, i % 2 === 0 ? Btn.Left : 0];
      s = step(s, now, { prevInputs: prev, ctx }).state;
      prev = now;
      xs.push(s.fighters[1].x);
      breaks.push(...stageInvariantBreaks(s, fd, i + 1));
    }
    expect(s.fighters[1].hitlag).toBe(0);
    expect(breaks).toEqual([]);
    expect(Math.min(...xs)).toBe(fx(82.7));
  });
});

describe("a ledge held by one fighter at most", () => {
  const twoAt = (a: FighterState["ledge"], b: FighterState["ledge"]): GameState => {
    const s = stateWith(0, 0);
    return { ...s, fighters: [{ ...s.fighters[0], ledge: a }, { ...s.fighters[1], ledge: b }] };
  };

  it("flags two fighters on the same ledge, naming both ports and the ledge", () => {
    expect(ledgeInvariantBreaks(twoAt({ platform: 0, side: 1 }, { platform: 0, side: 1 }), 9)).toEqual([
      "frame 9: ports 0 and 1 both hold the ledge at platform 0, side 1",
    ]);
  });

  it("spares two fighters on the two ledges of one platform, and one fighter alone", () => {
    expect(ledgeInvariantBreaks(twoAt({ platform: 0, side: 1 }, { platform: 0, side: -1 }), 9)).toEqual([]);
    expect(ledgeInvariantBreaks(twoAt({ platform: 0, side: 1 }, null), 9)).toEqual([]);
  });
});

describe("the whole state", () => {
  it("is both rules together", () => {
    const s = stateWith(HARD.x, -fx(5));
    const both: GameState = { ...s, fighters: s.fighters.map((f) => ({ ...f, ledge: { platform: 0, side: 1 } as const })) };
    expect(stateInvariantBreaks(both, STAGE, 3)).toEqual([...ledgeInvariantBreaks(both, 3), ...stageInvariantBreaks(both, STAGE, 3)]);
    expect(stateInvariantBreaks(both, STAGE, 3)).toHaveLength(2);
  });
});
