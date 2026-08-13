/**
 * What the crouch has to be true about.
 *
 * Everything here is measured through `resolve()` on the reference rig, so the
 * assertions are about where the fighter's head and boots actually end up on
 * the stage rather than about the numbers in the clip. That matters most for
 * the feet: `offsetY` lowers the whole rig, feet included, and the only thing
 * that keeps the boots out of the floor is the leg fold buying the drop back.
 * A test that read `offsetY` would have passed happily while the placeholder
 * stood a fighter knee-deep in the stage.
 *
 * Frame times come from `poseTimeFor`, so these are the five `t` values the
 * renderer really asks for and not five values chosen here.
 */

import { describe, expect, it } from "vitest";

import { CROUCH_END_FRAMES, CROUCH_START_FRAMES } from "@/engine/states";
import type { ActionState } from "@/engine/types";
import { samplePose, type PoseClip } from "./clip";
import { crouch, crouchEnd, crouchStart } from "./crouch";
import { idle } from "./idle";
import { poseTimeFor } from "./timing";
import type { PoseName } from "./library";
import { makeFighter } from "../testFixtures";
import { CHARACTER_RIGS } from "../characterArt";
import { BASE_RIG, resolve, type BoneName, type PoseAngles, type Rig } from "../skeleton";

/**
 * Heights above the stage, in rig units, stacked the way the renderer stacks
 * them: it puts the ground line at `y - offsetY * scale` and draws downward
 * from there, so a joint's height above the stage is `-y1`.
 */
function stage(clip: PoseClip, t: number, rig: Rig = BASE_RIG) {
  const s = samplePose(clip, t);
  const sk = resolve(rig, s.angles, {
    x: 0,
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
  });
  return {
    crown: -sk.head.y1,
    hip: -sk.hip.y0,
    // The boot is one fat capsule from the ankle to the toe; the lowest point
    // it paints — either end, plus half the capsule's width — is what the eye
    // reads as the sole against the stage.
    sole: Math.min(
      ...(["footR", "footL"] as BoneName[]).flatMap((n) => [
        -sk[n].y0 - rig[n].thickness / 2,
        -sk[n].y1 - rig[n].thickness / 2,
      ]),
    ),
    sample: s,
  };
}

/** The `t` the renderer asks for on each simulation frame of an action. */
function frameTimes(action: ActionState, name: PoseName, frames: number): number[] {
  return Array.from({ length: frames }, (_, f) =>
    poseTimeFor(name, makeFighter({ action, actionFrame: f }), 0),
  );
}

const START = frameTimes("crouchStart", "crouchStart", CROUCH_START_FRAMES);
const END = frameTimes("crouchEnd", "crouchEnd", CROUCH_END_FRAMES);

const descent = START.map((t) => stage(crouchStart, t));
const rise = END.map((t) => stage(crouchEnd, t));
const settled = stage(crouch, 0);

/** Standing, over a whole breath — idle is where both clips join on. */
const standing = Array.from({ length: 12 }, (_, i) => stage(idle, i / 12));
const standCrown = standing.reduce((a, s) => a + s.crown, 0) / standing.length;
const standSole = Math.min(...standing.map((s) => s.sole));

const DEG = Math.PI / 180;

/**
 * Largest disagreement between two poses, in degrees.
 *
 * A bone a pose does not name is at the rig's rest angle, not at zero — `idle`
 * names six bones and leaves the legs alone, so comparing against it any other
 * way reports a ninety-degree gap on a leg that never moved.
 */
function maxAngleGap(a: PoseAngles, b: PoseAngles): number {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<BoneName>;
  let worst = 0;
  for (const n of names) {
    const gap = (a[n] ?? BASE_RIG[n].angle) - (b[n] ?? BASE_RIG[n].angle);
    worst = Math.max(worst, Math.abs(gap) / DEG);
  }
  return worst;
}

/** The biggest step a clip takes between two frames it actually draws. */
function largestStep(frames: ReturnType<typeof stage>[]): number {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    worst = Math.max(worst, maxAngleGap(frames[i - 1].sample.angles, frames[i].sample.angles));
  }
  return worst;
}

/** How far the nearest phase of idle is from a pose, in degrees. */
function gapToIdle(pose: PoseAngles): number {
  return Math.min(...standing.map((s) => maxAngleGap(s.sample.angles, pose)));
}

describe("the settled crouch", () => {
  it("is a real drop in height, not a shorter drawing of a standing fighter", () => {
    expect(settled.crown).toBeLessThan(standCrown * 0.85);
    // And not so deep the fighter is sitting down.
    expect(settled.crown).toBeGreaterThan(standCrown * 0.65);
    // The hips carry the drop; the head must not be doing it alone by leaning.
    expect(settled.hip).toBeLessThan(standing[0].hip * 0.7);
  });

  it("keeps its boots on the stage", () => {
    expect(settled.sole).toBeGreaterThan(standSole - 0.35);
  });

  it("breathes rather than freezing", () => {
    expect(crouch.loop).toBe(true);
    expect(crouch.period).toBeGreaterThan(30);

    const cycle = Array.from({ length: 16 }, (_, i) => stage(crouch, i / 16));
    const crowns = cycle.map((c) => c.crown);
    const swing = Math.max(...crowns) - Math.min(...crowns);
    // It moves...
    expect(swing).toBeGreaterThan(0.02);
    // ...but `crouchEnd` cuts in from an arbitrary phase of this loop and
    // nothing interpolates between clips, so the swing has to stay small
    // enough that the cut is not a pop.
    expect(swing).toBeLessThan(0.3);
    for (const c of cycle) expect(c.sole).toBeGreaterThan(standSole - 0.35);
  });
});

describe("the descent", () => {
  it("starts at standing height and finishes at the settled crouch", () => {
    expect(descent[0].crown).toBeGreaterThan(standCrown * 0.94);
    expect(descent[descent.length - 1].crown).toBeCloseTo(settled.crown, 9);
    // The last frame is the exact pose `crouch` picks up from — the state
    // machine hands over between them with nothing in between.
    expect(maxAngleGap(descent[descent.length - 1].sample.angles, settled.sample.angles)).toBe(0);
  });

  it("joins onto idle rather than snapping out of it", () => {
    // Frame 0 is not the standing pose — five frames cannot afford to spend one
    // repeating what the previous frame already showed. What it has to be is a
    // seam no more violent than the motion either side of it, so the eye reads
    // a continuous move rather than a cut.
    expect(gapToIdle(descent[0].sample.angles)).toBeLessThan(largestStep(descent));
    expect(gapToIdle(descent[0].sample.angles)).toBeLessThan(30);
  });

  it("is a release and not a slide: most of it happens in the first half", () => {
    const total = descent[0].crown - descent[descent.length - 1].crown;
    const firstHalf = descent[0].crown - descent[2].crown;
    expect(firstHalf / total).toBeGreaterThan(0.6);
  });

  it("passes below the height it settles at, and comes back up to it", () => {
    const lowest = Math.min(...descent.map((d) => d.crown));
    expect(lowest).toBeLessThan(settled.crown);
    expect(descent[descent.length - 1].crown).toBeGreaterThan(lowest);
  });

  it("drops monotonically to the bottom — no frame goes back up on the way down", () => {
    for (let i = 1; i <= 2; i++) {
      expect(descent[i].crown, `frame ${i}`).toBeLessThan(descent[i - 1].crown);
    }
  });

  it("keeps its boots on the stage the whole way down", () => {
    for (const [i, d] of descent.entries()) {
      expect(d.sole, `frame ${i}`).toBeGreaterThan(standSole - 0.35);
    }
  });

  it("lets the spine and the arms trail the legs", () => {
    // Halfway down, the legs are past the crouch they are heading for while the
    // arms are still short of it. That lag is the follow-through.
    const legLead =
      Math.abs(descent[2].sample.angles.thighR! - settled.sample.angles.thighR!) / DEG;
    const armLag =
      Math.abs(descent[2].sample.angles.upperArmL! - settled.sample.angles.upperArmL!) / DEG;
    expect(descent[2].sample.angles.thighR!).toBeLessThan(settled.sample.angles.thighR!);
    expect(legLead).toBeGreaterThan(2);
    expect(armLag).toBeGreaterThan(0);
  });
});

describe("the rise", () => {
  it("starts at the settled crouch and finishes standing", () => {
    expect(rise[0].crown).toBeCloseTo(settled.crown, 6);
    expect(rise[rise.length - 1].crown).toBeGreaterThan(standCrown * 0.98);
  });

  it("hands back to idle without a pop", () => {
    // The other seam is the one that has to be invisible: the frame after this
    // clip's last is a standing fighter breathing, and the player is not doing
    // anything, so there is nothing to cover a jump.
    expect(gapToIdle(rise[rise.length - 1].sample.angles)).toBeLessThan(3);
    // Never above standing height: the next frame is idle, and an overshoot
    // here would snap back down.
    for (const r of rise) expect(r.crown).toBeLessThan(standCrown * 1.02);
  });

  it("is a push and not a release: most of it happens in the second half", () => {
    const total = rise[rise.length - 1].crown - rise[0].crown;
    const secondHalf = rise[rise.length - 1].crown - rise[2].crown;
    expect(secondHalf / total).toBeGreaterThan(0.6);
  });

  it("rises monotonically", () => {
    for (let i = 1; i < rise.length; i++) {
      expect(rise[i].crown, `frame ${i}`).toBeGreaterThan(rise[i - 1].crown);
    }
  });

  it("keeps its boots on the stage the whole way up", () => {
    for (const [i, r] of rise.entries()) {
      expect(r.sole, `frame ${i}`).toBeGreaterThan(standSole - 0.35);
    }
  });

  it("is not the descent played backwards", () => {
    // Same two poses at the ends...
    expect(rise[0].crown).toBeCloseTo(descent[descent.length - 1].crown, 6);
    // ...but a different journey between them. Falling into a crouch is
    // gravity and standing up out of one is muscle, so the frame that sits
    // halfway through each clip is nowhere near the other's mirror.
    const mirrored = descent[2].crown;
    expect(Math.abs(rise[2].crown - mirrored)).toBeGreaterThan(0.3);
  });

  it("leaves the crouch hips-first, with the chest still folded", () => {
    // Two frames in, the legs have given back more of their crouch than the
    // spine has of its fold.
    const legProgress =
      (rise[2].sample.angles.thighR! - rise[0].sample.angles.thighR!) /
      (rise[rise.length - 1].sample.angles.thighR! - rise[0].sample.angles.thighR!);
    const spineProgress =
      (rise[2].sample.angles.torso! - rise[0].sample.angles.torso!) /
      (rise[rise.length - 1].sample.angles.torso! - rise[0].sample.angles.torso!);
    expect(legProgress).toBeGreaterThan(spineProgress);
  });
});

describe("both transitions", () => {
  it("never jumps more than a limb can travel in one frame", () => {
    // A knee is the joint that moves furthest here and sixty degrees in a
    // frame is not a bug at this length — jumpsquat's knee covers fifty-eight
    // between its bottom and its unload. Past about seventy and the pose has
    // stopped being a step in a movement and become a different drawing.
    expect(largestStep(descent)).toBeLessThan(70);
    expect(largestStep(rise)).toBeLessThan(70);
  });

  it("are five frames each, the length the state machine gives them", () => {
    expect(START).toHaveLength(5);
    expect(END).toHaveLength(5);
    // t = 1 is never asked for: the frame that would reach it is already the
    // next state, so the last key has to land on 0.8 to ever be drawn.
    expect(Math.max(...START)).toBeCloseTo(0.8, 9);
    expect(crouchStart.keys[crouchStart.keys.length - 1].t).toBeLessThanOrEqual(0.8);
    expect(crouchEnd.keys[crouchEnd.keys.length - 1].t).toBeLessThanOrEqual(0.8);
  });
});

/**
 * The eight rigs share these three clips, and they do not share proportions:
 * Pikachu's legs are 2.3 units against Marth's 4.76. `offsetY` is an absolute
 * number, and the fold that repays it is proportional to leg length, so any
 * translation at all pulls the roster's feet apart. This is the test that keeps
 * that spread inside a boot — and the one that fails first if somebody buys
 * extra depth with `offsetY` instead of with `scaleY`.
 */
describe("on every fighter's rig", () => {
  const rigs = Object.entries(CHARACTER_RIGS).filter(([id]) => id !== "dk");

  it("keeps every fighter's soles within a boot of where standing leaves them", () => {
    for (const [id, cr] of rigs) {
      // Idle's own lowest sole is the definition of "planted" for this rig.
      const planted = Math.min(
        ...Array.from({ length: 12 }, (_, i) => stage(idle, i / 12, cr.bones).sole),
      );
      const samples = [
        ...START.map((t) => stage(crouchStart, t, cr.bones)),
        ...END.map((t) => stage(crouchEnd, t, cr.bones)),
        ...Array.from({ length: 8 }, (_, i) => stage(crouch, i / 8, cr.bones)),
      ];
      for (const s of samples) {
        expect(s.sole - planted, `${id} sinks`).toBeGreaterThan(-0.4);
        expect(s.sole - planted, `${id} floats`).toBeLessThan(0.4);
      }
    }
  });

  it("crouches by a visible amount on all of them", () => {
    for (const [id, cr] of rigs) {
      const standTop =
        Array.from({ length: 12 }, (_, i) => -stage(idle, i / 12, cr.bones).crown).reduce(
          (a, b) => a + b,
          0,
        ) / -12;
      const crouchTop = stage(crouch, 0, cr.bones).crown;
      // Kirby is the shallowest and cannot be otherwise: four fifths of his
      // height is a head circle, and a head circle does not fold.
      expect(crouchTop / standTop, id).toBeLessThan(0.9);
      expect(crouchTop / standTop, id).toBeGreaterThan(0.6);
    }
  });
});
