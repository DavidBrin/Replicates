/**
 * What being held and being thrown have to look like, as things a viewer could
 * check.
 *
 * The two clips exist to say opposite things — one fighter is fighting the grip
 * and one has stopped — so most of what is worth asserting is a *contrast*:
 * amplitude that persists against amplitude that dies, a body that stays upright
 * against one that goes over, arms above the shoulders against arms below them.
 * None of it restates a keyframe; a clip could be re-authored from scratch and
 * still pass, which is the point.
 *
 * Everything is sampled at simulation-frame granularity, because a struggle that
 * looks frantic sampled continuously can still be four drawings and a strobe at
 * 60Hz.
 */

import { describe, expect, it } from "vitest";
import { samplePose, type PoseClip, type PoseSample } from "./clip";
import { BASE_RIG, BONE_NAMES, DRAWN_BONES, resolve } from "../skeleton";
import { grabbed, thrown } from "./grabbed";

/**
 * `poseTimeFor`'s clock, reproduced rather than imported, so these tests depend
 * on nothing but the two clips and the geometry they are drawn with.
 *
 * A looping clip is driven by `actionFrame` modulo its own period. A one-shot
 * whose state has no entry in `actionDurationFor` — which `thrown` does not —
 * plays across a thirty-frame fallback and then holds its last key, so the tail
 * of a longer launch is sampled here too.
 */
const THROWN_CLIP_FRAMES = 30;

function frameTime(clip: PoseClip, frame: number): number {
  if (clip.loop) {
    const period = clip.period ?? 30;
    return (((frame % period) + period) % period) / period;
  }
  return Math.min(1, frame / THROWN_CLIP_FRAMES);
}

function at(clip: PoseClip, frame: number): PoseSample {
  return samplePose(clip, frameTime(clip, frame));
}

const HELD_PERIOD = grabbed.period ?? 30;
const HELD_FRAMES = [...Array(HELD_PERIOD).keys()];
/** The clip plus the frozen tail a long launch coasts through. */
const THROWN_FRAMES = [...Array(45).keys()];

function skeletonOf(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: s.offsetX,
    // `resolve` works in screen space, y-down, so the pose's upward offset is
    // subtracted. Heights below are negated back into "above the fighter's feet".
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
}

function degrees(radians: number): number {
  let d = Math.abs((radians * 180) / Math.PI) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** The largest turn any single bone makes between two drawings, in degrees. */
function maxBoneTurn(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const name of BONE_NAMES) {
    const from = a.angles[name] ?? BASE_RIG[name].angle;
    const to = b.angles[name] ?? BASE_RIG[name].angle;
    worst = Math.max(worst, degrees(to - from));
  }
  return worst;
}

function turnsBetweenFrames(clip: PoseClip, frames: readonly number[]): number[] {
  return frames.map((f) => maxBoneTurn(at(clip, f), at(clip, f + 1)));
}

/** Lowest drawn point, in rig units above where the fighter's own feet are. */
function lowestPoint(s: PoseSample): number {
  const sk = skeletonOf(s);
  let bottom = Infinity;
  for (const name of DRAWN_BONES) {
    bottom = Math.min(bottom, -sk[name].y0, -sk[name].y1);
  }
  return bottom;
}

/** How high the hands are carried, relative to the shoulders. */
function handsAboveShoulders(s: PoseSample): number {
  const sk = skeletonOf(s);
  const hands = (-sk.handR.y1 + -sk.handL.y1) / 2;
  const shoulders = (-sk.upperArmR.y0 + -sk.upperArmL.y0) / 2;
  return hands - shoulders;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe("grabbed", () => {
  it("is never a photograph — every frame of the cycle is a new drawing", () => {
    for (const turn of turnsBetweenFrames(grabbed, HELD_FRAMES)) {
      expect(turn).toBeGreaterThan(0.5);
    }
  });

  it("struggles rather than sways: the body wrenches through a wide arc", () => {
    const torso = HELD_FRAMES.map((f) => (at(grabbed, f).angles.torso ?? 0));
    expect(degrees(Math.max(...torso) - Math.min(...torso))).toBeGreaterThan(45);
    // And it gets there in a hurry. A sway spreads its travel evenly; a wrench
    // spends most of it in two or three frames.
    expect(Math.max(...turnsBetweenFrames(grabbed, HELD_FRAMES))).toBeGreaterThan(12);
  });

  it("is dragged bodily around, not just waved: the whole rig crosses over", () => {
    const rot = HELD_FRAMES.map((f) => at(grabbed, f).rotation);
    const shift = HELD_FRAMES.map((f) => at(grabbed, f).offsetX);
    expect(Math.max(...rot)).toBeGreaterThan(0);
    expect(Math.min(...rot)).toBeLessThan(0);
    expect(Math.max(...shift)).toBeGreaterThan(0);
    expect(Math.min(...shift)).toBeLessThan(0);
  });

  it("closes its loop: the wrap is no bigger a step than the cycle's own", () => {
    const turns = turnsBetweenFrames(grabbed, HELD_FRAMES);
    const wrap = maxBoneTurn(at(grabbed, HELD_PERIOD - 1), at(grabbed, HELD_PERIOD));
    expect(at(grabbed, HELD_PERIOD)).toEqual(at(grabbed, 0));
    expect(wrap).toBeLessThanOrEqual(Math.max(...turns));
  });

  it("does not tick: the second half of the cycle is not the first half again", () => {
    const half = Math.floor(HELD_PERIOD / 2);
    const turns = turnsBetweenFrames(grabbed, HELD_FRAMES);
    // A metronome repeats itself every half period, mirrored or not. Compare
    // each frame with its opposite number: at no phase may the pose half a
    // cycle away be as close as an ordinary frame's worth of movement, or the
    // eye can pair them up and start predicting the swing.
    const opposites = HELD_FRAMES.map((f) => maxBoneTurn(at(grabbed, f), at(grabbed, f + half)));
    expect(Math.min(...opposites)).toBeGreaterThan(mean(turns));
  });

  it("has accents, and they land at uneven intervals", () => {
    const turns = turnsBetweenFrames(grabbed, HELD_FRAMES);
    // A struggle is a series of failed pulls: a shove that covers ground, then
    // a frame or two of getting nowhere. Travelling evenly is a sway.
    expect(Math.max(...turns)).toBeGreaterThan(mean(turns) * 2);
    expect(turns.filter((t) => t < mean(turns) / 4).length).toBeGreaterThan(2);

    // And the shoves are not on a beat. Equal gaps between the loud frames is
    // what a metronome is, whatever the poses in between look like.
    const loud = HELD_FRAMES.filter((f) => turns[f] > mean(turns) * 1.5);
    const gaps = loud.map((f, i) => (i === 0 ? f + HELD_PERIOD - loud[loud.length - 1] : f - loud[i - 1]));
    expect(new Set(gaps).size).toBeGreaterThan(2);
  });

  it("hangs off the ground for the whole hold — somebody is carrying the weight", () => {
    for (const f of HELD_FRAMES) {
      expect(at(grabbed, f).offsetY).toBeGreaterThan(0.5);
      expect(lowestPoint(at(grabbed, f))).toBeGreaterThan(0.3);
    }
  });

  it("keeps both hands up at the grip, never down at the sides", () => {
    for (const f of HELD_FRAMES) {
      expect(handsAboveShoulders(at(grabbed, f))).toBeGreaterThan(-0.5);
    }
  });
});

describe("thrown", () => {
  it("is a different animation from the grip, not an alias of it", () => {
    expect(thrown).not.toBe(grabbed);
  });

  it("cannot be mistaken for the struggle at any pair of moments", () => {
    // The cut into either clip is instant — `blend.ts` treats both as imposed —
    // so the two have to be separable on the single frame they change over, from
    // whatever phase of the struggle the throw interrupted.
    for (const held of HELD_FRAMES) {
      for (const flying of THROWN_FRAMES) {
        expect(maxBoneTurn(at(grabbed, held), at(thrown, flying))).toBeGreaterThan(45);
      }
    }
  });

  it("goes over: the body leaves vertical and stays off it", () => {
    const heldTilt = Math.max(...HELD_FRAMES.map((f) => degrees(at(grabbed, f).rotation)));
    for (const f of THROWN_FRAMES.filter((f) => f >= 4)) {
      expect(degrees(at(thrown, f).rotation)).toBeGreaterThan(heldTilt * 2);
    }
  });

  it("goes limp: the flailing dies out instead of keeping its amplitude", () => {
    const turns = turnsBetweenFrames(thrown, THROWN_FRAMES);
    const third = Math.floor(THROWN_CLIP_FRAMES / 3);
    const start = mean(turns.slice(0, third));
    const end = mean(turns.slice(THROWN_CLIP_FRAMES - third, THROWN_CLIP_FRAMES));
    expect(start).toBeGreaterThan(end * 3);

    // The struggle, over the same span, does not lose anything.
    const heldTurns = turnsBetweenFrames(grabbed, HELD_FRAMES);
    expect(mean(heldTurns)).toBeGreaterThan(end * 3);
  });

  it("drops the arms it was clawing with", () => {
    const clawing = Math.min(...HELD_FRAMES.map((f) => handsAboveShoulders(at(grabbed, f))));
    for (const f of THROWN_FRAMES.filter((f) => f >= 6)) {
      expect(handsAboveShoulders(at(thrown, f))).toBeLessThan(clawing);
    }
  });

  it("says nothing about which way it is going — it plays for all four throws", () => {
    for (const f of THROWN_FRAMES) {
      expect(Math.abs(at(thrown, f).offsetX)).toBeLessThan(0.1);
    }
  });

  it("ends on a pose a coasting body can hold, because a long launch holds it", () => {
    const last = at(thrown, THROWN_CLIP_FRAMES);
    for (const f of THROWN_FRAMES.filter((f) => f > THROWN_CLIP_FRAMES)) {
      expect(at(thrown, f)).toEqual(last);
    }
    // Not the clip's extreme: the widest frame is the whip, and freezing on
    // that would read as a fighter posing in mid-air.
    const widest = Math.max(...THROWN_FRAMES.map((f) => Math.abs(at(thrown, f).scaleY - 1)));
    expect(Math.abs(last.scaleY - 1)).toBeLessThan(widest);
  });
});
