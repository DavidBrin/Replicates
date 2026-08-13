/**
 * The skid, checked at the four instants it is actually drawn.
 *
 * Everything here samples through `samplePose` at the times `poseTimeFor`
 * produces for `actionFrame` 0..3, because those are the only times the clip is
 * ever asked about. A property that holds at `t = 0.6` and nowhere a frame
 * lands is not a property of this animation.
 */

import { describe, expect, it } from "vitest";

import { RUN_BRAKE_FRAMES } from "@/engine/states";
import { BASE_RIG, resolve, type BoneName, type PoseAngles } from "../skeleton";
import { makeFighter } from "../testFixtures";
import { brake } from "./brake";
import { samplePose, type PoseSample } from "./clip";
import { idle } from "./idle";
import { poseTimeFor } from "./timing";

const DEG = 180 / Math.PI;

/** The clip time the renderer asks for on each simulation frame of the state. */
const FRAME_TIMES = Array.from({ length: RUN_BRAKE_FRAMES }, (_, f) =>
  poseTimeFor("brake", makeFighter({ action: "runBrake", actionFrame: f }), 0),
);

const frames = FRAME_TIMES.map((t) => samplePose(brake, t));

/** Bone positions in rig space: +x forward, feet at the origin, y-down screen. */
function bones(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    facing: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
  });
}

/** How far in front of the pelvis the shoulders are. Negative is rocked back. */
function shoulderLead(s: PoseSample): number {
  const b = bones(s);
  return b.torso.x1 - b.hip.x0;
}

/** Height of the pelvis above the ground, offset and squash included. */
function hipHeight(s: PoseSample): number {
  return s.offsetY + BASE_RIG.root.length * s.scaleY;
}

/** Largest angle any bone moves between two drawings, in degrees. */
function biggestMove(a: PoseAngles, b: PoseAngles): number {
  const names = new Set<BoneName>([
    ...(Object.keys(a) as BoneName[]),
    ...(Object.keys(b) as BoneName[]),
  ]);
  let worst = 0;
  for (const name of names) {
    const from = a[name] ?? BASE_RIG[name].angle;
    const to = b[name] ?? BASE_RIG[name].angle;
    worst = Math.max(worst, Math.abs(from - to) * DEG);
  }
  return worst;
}

describe("the skid", () => {
  it("is drawn four times and never past its last key", () => {
    expect(frames).toHaveLength(4);
    // The state ends on the frame after the third, so `t` never reaches 1 —
    // a key parked at the end of the clip would never be seen by anybody.
    expect(Math.max(...FRAME_TIMES)).toBeLessThan(1);
    expect(brake.keys[brake.keys.length - 1].t).toBeLessThanOrEqual(Math.max(...FRAME_TIMES));
  });

  it("shows a different drawing on every one of them", () => {
    for (let i = 1; i < frames.length; i++) {
      expect(
        biggestMove(frames[i - 1].angles, frames[i].angles),
        `frames ${i - 1} and ${i} are the same drawing`,
      ).toBeGreaterThan(8);
    }
  });

  it("rocks the torso back against the momentum, on the middle two frames", () => {
    // Still travelling on the plant, braced on the two the eye can catch, and
    // upright again by the time it hands off.
    expect(shoulderLead(frames[0])).toBeGreaterThan(0);
    expect(shoulderLead(frames[1])).toBeLessThan(-0.8);
    expect(shoulderLead(frames[2])).toBeLessThan(-0.8);
    expect(shoulderLead(frames[3])).toBeGreaterThan(0);

    // And the rock deepens rather than unwinding across the pair.
    expect(shoulderLead(frames[2])).toBeLessThan(shoulderLead(frames[1]));
  });

  it("puts the braking heel out in front of everything it has to stop", () => {
    for (const i of [1, 2]) {
      const b = bones(frames[i]);
      const heel = b.footR.x0;
      expect(heel - b.hip.x0, `frame ${i}`).toBeGreaterThan(1.5);
      expect(heel - b.torso.x1, `frame ${i}`).toBeGreaterThan(2.5);
      // Toe up off the floor: the shoe climbs away from the heel.
      expect(b.footR.y1, `frame ${i}`).toBeLessThan(b.footR.y0);
    }
  });

  it("drives the weight down into the dig and stands back up out of it", () => {
    const heights = frames.map(hipHeight);
    expect(heights[1]).toBeLessThan(heights[0]);
    expect(heights[2]).toBeLessThan(heights[1]);
    expect(heights[3]).toBeGreaterThan(heights[2]);
    // Enough of a drop to be a dig and not a wobble.
    expect(heights[0] - heights[2]).toBeGreaterThan(0.4);
  });

  it("cuts between the four rather than smearing one into the next", () => {
    // Every span holds, so a time between two frames is still the earlier
    // drawing. Ease this and the extremes become in-betweens of each other.
    for (const [between, frame] of [
      [0.12, 0],
      [0.37, 1],
      [0.62, 2],
      [0.87, 3],
    ] as const) {
      const s = samplePose(brake, between);
      expect(biggestMove(s.angles, frames[frame].angles), `t=${between}`).toBeLessThan(1e-6);
      expect(s.offsetY, `t=${between}`).toBeCloseTo(frames[frame].offsetY, 9);
    }
  });

  it("finishes close enough to the stand that the stop does not snap", () => {
    // Against the whole breath, not against one phase of it. `idle` is driven
    // by the global frame and offset per port, so a fighter can come to rest at
    // any point in its cycle — comparing to `t = 0` measures one arbitrary
    // instant and calls the breath's own amplitude a mismatch.
    const phases = Array.from({ length: 12 }, (_, i) => samplePose(idle, i / 12));
    const gaps = phases.map((p) => biggestMove(frames[3].angles, p.angles));
    expect(Math.min(...gaps)).toBeLessThan(8);
    expect(Math.max(...gaps)).toBeLessThan(14);
    for (const p of phases) {
      expect(Math.abs(frames[3].offsetY - p.offsetY)).toBeLessThan(0.2);
      expect(frames[3].scaleX).toBeCloseTo(p.scaleX, 1);
      expect(frames[3].scaleY).toBeCloseTo(p.scaleY, 1);
    }
  });

  it("starts somewhere a runner could be, not somewhere a stander is", () => {
    const stand = samplePose(idle, 0);
    expect(biggestMove(frames[0].angles, stand.angles)).toBeGreaterThan(30);
    // Feet split by a stride's worth, which is what it is braking out of.
    const b = bones(frames[0]);
    expect(b.footR.x0 - b.footL.x0).toBeGreaterThan(2.5);
  });
});
