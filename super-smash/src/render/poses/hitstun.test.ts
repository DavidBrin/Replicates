/**
 * The reel is the one clip in the library whose length is different every time
 * it plays, so every property worth asserting about it has to hold across the
 * whole range at once. These tests replay the clip the way `poseTimeFor` does —
 * `t = actionFrame / hitstun`, for every hitstun a hit can produce — and measure
 * the drawn skeleton rather than the keyframe table, because the question is
 * never "is this key at 0.07" but "does a four-frame reel still show a reel".
 */

import { describe, expect, it } from "vitest";
import { TUMBLE_HITSTUN } from "@/engine/constants";
import { BASE_RIG, BONE_NAMES, resolve, rigHeight } from "../skeleton";
import { samplePose, type PoseSample } from "./clip";
import { hitstun } from "./hitstun";

/**
 * Every reel length that can reach this clip.
 *
 * The ceiling is the engine's: a hit worth `TUMBLE_HITSTUN` frames or more is
 * sent to `tumble` at the moment of contact, so 31 is the longest reel there
 * is. The floor is three because `hitstun = floor(knockback × 0.4) − 1` and the
 * weakest hits in the game — jabs, weak-hit aerials — land in the fours and
 * fives; three is a frame under the realistic minimum and therefore the honest
 * worst case to hold every property at.
 */
const LENGTHS = Array.from({ length: TUMBLE_HITSTUN - 3 }, (_, i) => i + 3);

/** The whole rig's height, so thresholds can be stated as a share of a fighter. */
const BODY = rigHeight(BASE_RIG, 1.6);

/** `renderer.ts` pivots whole-body rotation here, not at the pelvis. */
const PIVOT = BODY * 0.45;

const DEG = 180 / Math.PI;

/** The frames a reel of `n` frames actually renders. `t` never reaches 1. */
function reel(n: number): PoseSample[] {
  return Array.from({ length: n }, (_, f) => samplePose(hitstun, f / n));
}

function skeletonOf(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: s.offsetX,
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
    pivot: PIVOT,
  });
}

/**
 * How far behind their own feet the fighter's head is, in rig units.
 *
 * One number for "how thrown back is this", and it is the right one because it
 * folds in everything that can throw a fighter back — the whole-body offset,
 * the whole-body rotation, the hip, the spine and the neck — rather than
 * privileging whichever of them a particular key happened to use.
 */
function thrownBack(s: PoseSample): number {
  return -skeletonOf(s).head.x1;
}

/** Degrees the spine is tipped away from the hit. Zero once upright or past it. */
function backwardLean(s: PoseSample): number {
  const sk = skeletonOf(s);
  const lean = Math.atan2(sk.torso.x1 - sk.hip.x0, -(sk.torso.y1 - sk.hip.y0)) * DEG;
  return Math.max(0, -lean);
}

/** Degrees the head is tipped away from the hit, measured on the neck alone. */
function headBack(s: PoseSample): number {
  const sk = skeletonOf(s);
  return -Math.atan2(sk.head.x1 - sk.head.x0, -(sk.head.y1 - sk.head.y0)) * DEG;
}

/** The largest turn any single bone makes between two frames, in degrees. */
function boneStep(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const name of BONE_NAMES) {
    const from = a.angles[name] ?? BASE_RIG[name].angle;
    const to = b.angles[name] ?? BASE_RIG[name].angle;
    let d = Math.abs((to - from) * DEG) % 360;
    if (d > 180) d = 360 - d;
    if (d > worst) worst = d;
  }
  return worst;
}

function argmax(values: number[]): number {
  return values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
}

describe("the snap", () => {
  it("is on the first frame at every length a hit can produce", () => {
    for (const n of LENGTHS) {
      const thrown = reel(n).map(thrownBack);
      expect(argmax(thrown), `${n}-frame reel peaks late`).toBe(0);
    }
  });

  it("throws the head clear of the fighter's own footprint", () => {
    // A quarter of a body height behind the feet. Below that the drawing reads
    // as a lean rather than as something that was done to them, and the frame
    // it is on is the one hitlag holds on screen for up to thirty frames.
    expect(thrownBack(reel(4)[0])).toBeGreaterThan(BODY * 0.25);
  });

  it("puts the whole body behind the feet, not just the spine", () => {
    for (const n of LENGTHS) {
      expect(reel(n)[0].offsetX, `${n}-frame reel`).toBeLessThan(-0.5);
    }
  });
});

describe("the recovery", () => {
  it("never goes back the way it came, at any length", () => {
    for (const n of LENGTHS) {
      const frames = reel(n);
      for (let f = 1; f < n; f++) {
        const label = `${n}-frame reel, frame ${f}`;
        expect(thrownBack(frames[f]), label).toBeLessThanOrEqual(thrownBack(frames[f - 1]) + 1e-9);
        expect(backwardLean(frames[f]), label).toBeLessThanOrEqual(
          backwardLean(frames[f - 1]) + 1e-9,
        );
        expect(frames[f].offsetX, label).toBeGreaterThanOrEqual(frames[f - 1].offsetX - 1e-9);
      }
    }
  });

  it("is most of the way home by the last frame, even on a three-frame reel", () => {
    // The whole point of the shape: a jab's reel is three or four samples of
    // this clip and it still has to say hit, held, free. If the last frame the
    // defender is stunned on were still two-thirds thrown back, hitstun ending
    // would be invisible at exactly the length where it matters most.
    for (const n of LENGTHS) {
      const frames = reel(n);
      const start = thrownBack(frames[0]);
      const end = thrownBack(frames[n - 1]);
      expect(end, `${n}-frame reel`).toBeLessThan(start * 0.3);
      expect(Math.abs(frames[n - 1].offsetX), `${n}-frame reel`).toBeLessThan(0.15);
    }
  });

  it("is still visibly moving on the frames a defender acts out of", () => {
    // The last fifth of a long reel is when a player starts moving again, and
    // an animation that has already arrived at its final pose hides that.
    const frames = reel(30);
    for (let f = 25; f < 30; f++) {
      expect(boneStep(frames[f - 1], frames[f]), `frame ${f}`).toBeGreaterThan(2);
    }
  });
});

describe("frame-to-frame", () => {
  it("never repeats a drawing on a long reel", () => {
    const frames = reel(30);
    for (let f = 1; f < 30; f++) {
      expect(boneStep(frames[f - 1], frames[f]), `frame ${f}`).toBeGreaterThan(0.5);
    }
  });

  it("slows down without ever stopping and starting again", () => {
    // The failure this catches has no single bad frame in it, which is why it
    // needs its own measure: give every span the library's default `smooth` and
    // the fighter arrives at each key with no velocity and leaves it with none,
    // so one continuous return of control turns into three separate twitches.
    // Deceleration is right — a recovery does slow — but halving in a frame is
    // a stall, and stalls are what the eye reads as further hits.
    const frames = reel(30);
    const speed = frames.slice(1).map((s, i) => boneStep(frames[i], s));
    // From the second step: the first is deliberately tiny, holding the impact.
    for (let i = 2; i < speed.length; i++) {
      expect(speed[i] / speed[i - 1], `frame ${i + 1}`).toBeGreaterThan(0.5);
    }
  });

  it("never pops on a long reel", () => {
    const frames = reel(30);
    for (let f = 1; f < 30; f++) {
      expect(boneStep(frames[f - 1], frames[f]), `frame ${f}`).toBeLessThan(20);
    }
  });

  it("never takes a limb the long way round, even at three frames", () => {
    // Three samples of a whole recovery are always going to be big steps; what
    // must not happen is a shoulder crossing 180° and unwinding backwards.
    const frames = reel(3);
    for (let f = 1; f < 3; f++) {
      expect(boneStep(frames[f - 1], frames[f]), `frame ${f}`).toBeLessThan(90);
    }
    // ...and every one of a jab's four frames is a different drawing, not one
    // pose with three interpolations of it.
    const jab = reel(4);
    for (let f = 1; f < 4; f++) {
      expect(boneStep(jab[f - 1], jab[f]), `jab frame ${f}`).toBeGreaterThan(15);
    }
  });
});

describe("the whip", () => {
  it("lands the head after the body, and only where a long reel can see it", () => {
    const frames = reel(30);
    const head = frames.map(headBack);
    const peak = argmax(head);
    // The body is at its furthest back on frame 0 and the head is not: the neck
    // keeps going for a couple of frames after the spine has stopped. That is
    // the secondary action, and it is deliberately parked inside the first
    // fifth — a jab samples t = 0, ¼, ½, ¾ and never sees it, which is why it
    // can be there at all without disturbing the short-reel read.
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(30 / 5);
  });

  it("does not make the fighter look more thrown back than the hit did", () => {
    const frames = reel(30);
    for (let f = 1; f < 30; f++) {
      expect(thrownBack(frames[f]), `frame ${f}`).toBeLessThan(thrownBack(frames[0]));
    }
  });
});

describe("the hand-over", () => {
  it("ends upright, so the fade into standing or falling has nowhere to travel", () => {
    const last = samplePose(hitstun, 1);
    expect(backwardLean(last)).toBe(0);
    expect(Math.abs(last.offsetX)).toBeLessThan(0.05);
    expect(Math.abs(last.offsetY)).toBeLessThan(0.05);
    expect(last.scaleX).toBe(1);
    expect(last.scaleY).toBe(1);
  });

  it("does not get there early and stand around waiting", () => {
    // Arriving at the standing pose halfway through would make the back half of
    // every long reel a still image of a fighter who cannot yet act.
    const frames = reel(30);
    expect(backwardLean(frames[14])).toBeGreaterThan(5);
  });
});
