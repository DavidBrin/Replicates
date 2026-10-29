/**
 * The whole-state rules the golden and the baked sweep check on every frame
 * (`stateInvariants.ts`), each shown to flag a crafted state and to spare both
 * sides of every boundary (Plan 4 Task 12 re-review, N3): without this, a rule
 * that could never fire would pass both of them for ever.
 */

import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import { createInitialState } from "@/engine/simulate";
import type { FighterState, GameState, Platform, StageDef } from "@/engine/types";
import { STAGES } from "@/stages";
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

  it("measures a moving platform where it is on the state's frame", () => {
    const sweeping: Platform = { ...HARD, motion: { kind: "sweep", amplitude: fx(30), periodFrames: 240 } };
    const stage: StageDef = { ...STAGE, platforms: [sweeping] };
    const frame = 60;
    const there = platformCentreX(sweeping, frame);
    expect(there).not.toBe(platformCentreX(sweeping, 0));
    // Inside the platform where it is now, and outside where it started.
    const x = there + sweeping.halfWidth - fx(1);
    expect(Math.abs(x - platformCentreX(sweeping, 0))).toBeGreaterThan(sweeping.halfWidth);
    expect(stageInvariantBreaks(stateWith(x, -fx(5), {}, frame), stage, 7)).toHaveLength(1);
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
