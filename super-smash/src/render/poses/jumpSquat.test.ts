/**
 * The jumpsquat is three frames long, so there are only three drawings to be
 * right or wrong about, and every test here is about one of them as it reaches
 * the screen: sampled through `samplePoseForFighter` at the frames the state
 * machine actually produces, resolved onto the rig, and squashed by the same
 * `squashFor` the renderer applies. Angles in the file are not evidence — a key
 * can be perfect and be shown for none of the three frames.
 */

import { describe, expect, it } from "vitest";

import { JUMP_SQUAT_FRAMES } from "@/engine/constants";
import { squashFor } from "@/render/characterArt";
import { makeFighter } from "@/render/testFixtures";
import { BASE_RIG, DRAWN_BONES, resolve } from "@/render/skeleton";
import { samplePose, type PoseSample } from "./clip";
import { samplePoseForFighter } from "./timing";
import { jumpSquat } from "./jumpSquat";

const FRAMES = Array.from({ length: JUMP_SQUAT_FRAMES }, (_, f) => f);

const REST: PoseSample = { angles: {}, offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/**
 * What one drawn frame looks like, in rig units with +y up and the stage at 0.
 * Screen space is y-down, hence the sign flips.
 */
function drawn(s: PoseSample, squash: { scaleX: number; scaleY: number }) {
  const sk = resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX * squash.scaleX,
    scaleY: s.scaleY * squash.scaleY,
    facing: 1,
  });
  let sole = Infinity;
  for (const n of DRAWN_BONES) {
    const b = sk[n];
    const r = b.thickness / 2;
    sole = Math.min(sole, -b.y0 - r, -b.y1 - r);
  }
  return {
    head: -sk.head.y1 + s.offsetY,
    pelvis: -sk.root.y1 + s.offsetY,
    knee: -sk.thighR.y1 + s.offsetY,
    handX: sk.handR.x1,
    sole: sole + s.offsetY,
    scaleY: s.scaleY * squash.scaleY,
    /** Every drawn joint, so two whole poses can be compared. */
    joints: DRAWN_BONES.flatMap((n) => [sk[n].x1, -sk[n].y1 + s.offsetY]),
  };
}

/** The three drawings the renderer asks for, in order. */
const shown = FRAMES.map((f) => {
  const fighter = makeFighter({ action: "jumpSquat", actionFrame: f });
  return drawn(samplePoseForFighter(fighter, 0), squashFor(fighter));
});

/** The rig at rest, which is what a crouch has to be legible against. */
const standing = drawn(REST, { scaleX: 1, scaleY: 1 });

/** Furthest any one joint moves between two drawings. */
function separation(a: (typeof shown)[number], b: (typeof shown)[number]): number {
  let worst = 0;
  for (let i = 0; i < a.joints.length; i++) worst = Math.max(worst, Math.abs(a.joints[i] - b.joints[i]));
  return worst;
}

describe("jumpsquat", () => {
  it("spends each of its three frames on a different drawing", () => {
    // A rig is ~13 units tall, so a unit of movement at some joint is the
    // difference between a new pose and a re-shot photograph.
    for (let a = 0; a < shown.length; a++) {
      for (let b = a + 1; b < shown.length; b++) {
        expect(separation(shown[a], shown[b])).toBeGreaterThan(1);
      }
    }
  });

  it("holds each drawing for the whole of its frame rather than blending", () => {
    // Halfway to the next frame is still the same pose: the eye gets a held
    // drawing, not a smear that never settles on any of the three.
    for (const f of FRAMES) {
      const onFrame = samplePose(jumpSquat, f / JUMP_SQUAT_FRAMES);
      const halfway = samplePose(jumpSquat, (f + 0.5) / JUMP_SQUAT_FRAMES);
      expect(halfway.angles).toEqual(onFrame.angles);
      expect(halfway.offsetY).toBe(onFrame.offsetY);
      expect(halfway.scaleY).toBe(onFrame.scaleY);
    }
  });

  it("has no drawing stranded past the last frame the fighter is ever in", () => {
    // `poseTimeFor` never reaches 1 during jumpsquat — the state ends first —
    // so a key out there would be authored and never seen.
    expect(samplePose(jumpSquat, 1).angles).toEqual(
      samplePose(jumpSquat, (JUMP_SQUAT_FRAMES - 1) / JUMP_SQUAT_FRAMES).angles,
    );
  });

  it("compresses, and keeps compressing into the second frame", () => {
    expect(shown[0].head).toBeLessThan(standing.head);
    expect(shown[1].head).toBeLessThan(shown[0].head);
    // Deep enough to be a crouch and not a nod: the hips give up a fifth of
    // their standing height.
    expect(standing.pelvis - shown[1].pelvis).toBeGreaterThan(1);
  });

  it("is already extending on the last frame, so the cut to the jump continues it", () => {
    const bottom = shown[1];
    const last = shown[shown.length - 1];
    expect(last.head).toBeGreaterThan(bottom.head);
    expect(last.head).toBeGreaterThan(shown[0].head);
    // Taller than standing, because the ankles have extended under a body that
    // has not left the ground yet.
    expect(last.head).toBeGreaterThan(standing.head);
    // And extending from the legs, not only from the whole-body scale.
    expect(last.knee).toBeGreaterThan(bottom.knee);
  });

  it("stops squashing before it launches", () => {
    // `squashFor` flattens the whole state to 0.88, which is right for the
    // compression and wrong for the frame that leaves the floor, so the last
    // key has to take it back out. Anything under 1 here is a fighter squashing
    // and jumping at the same time.
    expect(shown[1].scaleY).toBeLessThan(shown[0].scaleY);
    expect(shown[shown.length - 1].scaleY).toBeGreaterThan(1);
  });

  it("keeps the feet on the stage for all three frames", () => {
    // The fighter is grounded until the frame after this clip ends. Bending the
    // legs without paying for it in `offsetY` sinks them through the floor,
    // which is what the deep single pose this replaced did.
    for (const g of shown) expect(Math.abs(g.sole - standing.sole)).toBeLessThan(0.15);
  });

  it("swings the arms back and then through", () => {
    // The clearest read at 1/12th of the screen height is the arm arc, and it
    // has to reverse inside three frames or the jump has no wind-up in it.
    expect(shown[0].handX).toBeLessThan(0);
    expect(shown[1].handX).toBeLessThan(shown[0].handX);
    expect(shown[shown.length - 1].handX).toBeGreaterThan(0);
  });
});
