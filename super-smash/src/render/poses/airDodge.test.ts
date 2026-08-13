/**
 * What the air dodge has to look like, stated as measurements of the drawing.
 *
 * The clip is played at two lengths (`AIR_DODGE_FRAMES` and
 * `DIRECTIONAL_AIR_DODGE_FRAMES`), so everything here is checked against the
 * sampled skeleton at a real frame count rather than against the keyframe
 * numbers — a key at `t = 0.3` says nothing about whether the fighter is
 * actually curled up on the frames they are intangible on, and that is the only
 * interesting question.
 */

import { describe, expect, it } from "vitest";

import {
  AIR_DODGE_FRAMES,
  AIR_DODGE_INTANGIBLE,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  DIRECTIONAL_AIR_DODGE_INTANGIBLE,
} from "@/engine/constants";
import { BASE_RIG, DRAWN_BONES, resolve, type BoneName } from "../skeleton";
import { samplePose, type PoseSample } from "./clip";
import { airDodge } from "./airDodge";

const NEUTRAL = AIR_DODGE_FRAMES;
const DIRECTIONAL = DIRECTIONAL_AIR_DODGE_FRAMES;

/** The pose on simulation frame `frame` of a dodge that lasts `total` frames. */
function at(frame: number, total: number): PoseSample {
  return samplePose(airDodge, Math.min(1, frame / total));
}

function skeletonOf(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
}

/**
 * How far the furthest point of the fighter is from their own pelvis.
 *
 * Measured from the pelvis rather than as a bounding box because it has to be
 * blind to the body's rotation: a curled fighter turned on their side is still
 * curled, and a bounding box would call them tall again.
 */
function reach(s: PoseSample): number {
  const sk = skeletonOf(s);
  const px = sk.hip.x0;
  const py = sk.hip.y0;
  let worst = 0;
  for (const name of DRAWN_BONES) {
    const b = sk[name];
    worst = Math.max(worst, Math.hypot(b.x1 - px, b.y1 - py), Math.hypot(b.x0 - px, b.y0 - py));
  }
  return worst;
}

const ALL_BONES = Object.keys(BASE_RIG) as BoneName[];

function degreesBetween(a: number, b: number): number {
  let d = Math.abs(((b - a) * 180) / Math.PI) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function angleOf(s: PoseSample, bone: BoneName): number {
  return s.angles[bone] ?? BASE_RIG[bone].angle;
}

/** The largest angle any single bone turns between two poses, in degrees. */
function maxBoneStep(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const n of ALL_BONES) worst = Math.max(worst, degreesBetween(angleOf(a, n), angleOf(b, n)));
  return worst;
}

/** How different two drawings are: the mean bone-angle difference, in degrees. */
function poseDistance(a: PoseSample, b: PoseSample): number {
  let sum = 0;
  for (const n of ALL_BONES) sum += degreesBetween(angleOf(a, n), angleOf(b, n));
  return sum / ALL_BONES.length + degreesBetween(a.rotation, b.rotation);
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

/** Every frame of a dodge of the given length, as sampled poses. */
function everyFrame(total: number): PoseSample[] {
  return Array.from({ length: total + 1 }, (_, f) => at(f, total));
}

describe("the air dodge", () => {
  it("is at its most compact while it is intangible, at both lengths", () => {
    for (const [total, window] of [
      [NEUTRAL, AIR_DODGE_INTANGIBLE],
      [DIRECTIONAL, DIRECTIONAL_AIR_DODGE_INTANGIBLE],
    ] as const) {
      const frames = everyFrame(total);
      const reaches = frames.map(reach);
      const tightest = reaches.indexOf(Math.min(...reaches));
      expect(tightest, `${total}-frame dodge peaks its curl on frame ${tightest}`).toBeGreaterThanOrEqual(
        window[0],
      );
      expect(tightest).toBeLessThanOrEqual(window[1]);

      // Curled for the rest of the window rather than at one instant in it. The
      // opening frames are excluded on purpose: intangibility starts on frame 3
      // and the fighter is still winding up, which is true of the real move —
      // being safe and looking safe are a few frames apart.
      const settled = reaches[total];
      for (let f = Math.round((window[0] + window[1]) / 2); f <= window[1]; f++) {
        expect(reaches[f] / settled, `frame ${f} of ${total} is not curled up`).toBeLessThan(0.8);
      }
    }
  });

  it("opens out through the back half and finishes wider than it started", () => {
    const reaches = everyFrame(NEUTRAL).map(reach);
    const tightest = Math.min(...reaches);

    // Nothing re-compacts once the fighter has begun to uncurl: from halfway to
    // the flail the silhouette only ever grows.
    for (let f = Math.round(NEUTRAL * 0.5); f < Math.round(NEUTRAL * 0.78); f++) {
      expect(reaches[f + 1], `frame ${f + 1} tucked back in`).toBeGreaterThanOrEqual(reaches[f] - 1e-9);
    }

    // The limbs are flung well past where they settle — the uncurl throws them.
    const widest = Math.max(...reaches);
    expect(widest).toBeGreaterThan(reaches[NEUTRAL] * 1.05);
    expect(reaches[NEUTRAL]).toBeGreaterThan(tightest * 1.5);
    expect(reaches[Math.round(NEUTRAL * 0.9)]).toBeGreaterThan(tightest * 1.4);
  });

  it("turns the body away and brings it all the way back", () => {
    const frames = everyFrame(DIRECTIONAL);
    const turns = frames.map((s) => degrees(s.rotation));
    expect(Math.max(...turns)).toBeGreaterThan(40);

    // The windup goes the other way first — the anticipation the real move has.
    expect(Math.min(...turns.slice(0, Math.round(DIRECTIONAL * 0.12)))).toBeLessThan(-6);

    // And the turn is spent by the end: the clip cuts straight into `fall`, so a
    // fighter still tilted on the last frame snaps upright on the next one.
    expect(Math.abs(turns[DIRECTIONAL])).toBeLessThan(3);
    expect(Math.abs(turns[Math.round(DIRECTIONAL * 0.9)])).toBeLessThan(12);
  });

  it("ends in a fall and not in a dodge", () => {
    const end = at(NEUTRAL, NEUTRAL);
    const reaches = everyFrame(NEUTRAL).map(reach);
    const tuck = at(reaches.indexOf(Math.min(...reaches)), NEUTRAL);
    const late = at(Math.round(NEUTRAL * 0.9), NEUTRAL);

    // Nine tenths of the way through, the fighter is already almost the drawing
    // they will be handed off to `fall` as, and nothing like the dodge shape.
    expect(poseDistance(late, end)).toBeLessThan(poseDistance(late, tuck) / 3);

    // Legs hanging rather than gathered, and the body its own size again.
    for (const [thigh, shin] of [
      ["thighR", "shinR"],
      ["thighL", "shinL"],
    ] as const) {
      expect(Math.abs(degrees(angleOf(end, thigh)) - 180)).toBeLessThan(20);
      expect(Math.abs(degrees(angleOf(end, shin)))).toBeLessThan(45);
    }
    expect(Math.abs(end.scaleX - 1)).toBeLessThan(0.08);
    expect(Math.abs(end.scaleY - 1)).toBeLessThan(0.08);
  });

  it("snaps into the tuck and drifts out of the recovery", () => {
    const frames = everyFrame(DIRECTIONAL);
    const steps = frames.slice(0, -1).map((s, i) => maxBoneStep(s, frames[i + 1]));

    // The fastest frame in the animation is the whip into the tuck, and it is a
    // whip: everything after it is slower, which is the difference between a
    // dodge and its recovery stated as a number.
    const fastest = steps.indexOf(Math.max(...steps));
    expect(fastest, `fastest frame is ${fastest} of ${DIRECTIONAL}`).toBeLessThan(DIRECTIONAL / 4);
    expect(steps[fastest], "nothing in this clip is fast enough to be a tuck").toBeGreaterThan(12);

    // And once the limbs have been flung out, the last fifth only drifts.
    for (let f = Math.round(DIRECTIONAL * 0.8); f < DIRECTIONAL; f++) {
      expect(steps[f], `frame ${f} is still being animated at speed`).toBeLessThan(8);
    }

    // Fast, but never a teleport: no bone crosses a third of a turn in a frame
    // at 60Hz, or the fighter reads as replaced rather than moved.
    expect(Math.max(...steps)).toBeLessThan(32);
    for (let i = 0; i < steps.length - 1; i++) {
      expect(degreesBetween(frames[i].rotation, frames[i + 1].rotation)).toBeLessThan(26);
    }
  });

  it("never stands still for long, at either length", () => {
    // The bug this replaces was a single frozen pose held for fifty frames. Any
    // stretch of the clip where nothing at all moves is that bug coming back.
    for (const total of [NEUTRAL, DIRECTIONAL]) {
      const frames = everyFrame(total);
      let stillFor = 0;
      let longest = 0;
      for (let f = 0; f < total; f++) {
        const moved =
          maxBoneStep(frames[f], frames[f + 1]) > 0.15 ||
          Math.abs(reach(frames[f]) - reach(frames[f + 1])) > 0.01;
        stillFor = moved ? 0 : stillFor + 1;
        longest = Math.max(longest, stillFor);
      }
      expect(longest, `${total}-frame dodge freezes for ${longest} frames`).toBeLessThan(6);
    }
  });
});
