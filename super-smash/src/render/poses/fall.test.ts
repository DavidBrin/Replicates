/**
 * What the falls have to look like, expressed as things a viewer could check.
 *
 * Every assertion here is about the *motion* — silhouette width, how far a bone
 * travels between two frames the screen actually shows, whether the loop closes
 * — rather than about the keyframe numbers, because the numbers are the thing
 * being tested and restating them proves only that the file was copied
 * correctly. Poses are sampled at simulation-frame granularity: a clip that
 * looks right when sampled continuously can still be a strobe at 60Hz.
 */

import { describe, expect, it } from "vitest";
import { samplePose, type PoseClip, type PoseSample } from "./clip";
import { BASE_RIG, BONE_NAMES, DRAWN_BONES, resolve, type BoneName } from "../skeleton";
import { fall, fastFall } from "./fall";

/**
 * `poseTimeFor`'s clock, reproduced rather than imported.
 *
 * A loop is driven by `actionFrame` modulo its own period; a one-shot plays
 * across the fall state's fallback length and then holds. Written out here so
 * these tests depend on nothing but the two clips and the geometry they are
 * drawn with.
 */
const FALL_STATE_FRAMES = 30;

function frameTime(clip: PoseClip, frame: number): number {
  if (clip.loop) {
    const period = clip.period ?? 30;
    return (((frame % period) + period) % period) / period;
  }
  return Math.min(1, frame / FALL_STATE_FRAMES);
}

function at(clip: PoseClip, frame: number): PoseSample {
  return samplePose(clip, frameTime(clip, frame));
}

const FALL_PERIOD = fall.period ?? 30;
const FALL_FRAMES = [...Array(FALL_PERIOD).keys()];
/** Long enough to cover the clip and the frozen tail a slow plunge sits in. */
const FAST_FRAMES = [...Array(45).keys()];

/**
 * The fighter as drawn: `resolve` with the sample's own offset, squash and
 * body rotation applied, in rig units with the feet at the origin.
 */
function skeletonOf(s: PoseSample) {
  return resolve(BASE_RIG, s.angles, {
    x: s.offsetX,
    // `resolve` works in screen space, y-down, so the pose's upward offset is
    // subtracted. Extents below are negated back into "height above the feet".
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
}

interface Extent {
  readonly width: number;
  /** Highest and lowest drawn point, in rig units above the fighter's feet. */
  readonly top: number;
  readonly bottom: number;
}

function extent(s: PoseSample): Extent {
  const sk = skeletonOf(s);
  let minX = Infinity;
  let maxX = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const name of DRAWN_BONES) {
    const b = sk[name];
    for (const [x, y] of [
      [b.x0, b.y0],
      [b.x1, b.y1],
    ]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      top = Math.max(top, -y);
      bottom = Math.min(bottom, -y);
    }
  }
  return { width: maxX - minX, top, bottom };
}

/** How far the hands and feet are held out from the body's centre line. */
function limbSpread(s: PoseSample): number {
  const sk = skeletonOf(s);
  const hipX = sk.hip.x0;
  const tips: BoneName[] = ["handL", "handR", "footL", "footR"];
  return tips.reduce((sum, n) => sum + Math.abs(sk[n].x1 - hipX), 0) / tips.length;
}

/** The largest turn any single bone makes between two drawings, in degrees. */
function maxBoneTurn(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const name of BONE_NAMES) {
    const from = a.angles[name] ?? BASE_RIG[name].angle;
    const to = b.angles[name] ?? BASE_RIG[name].angle;
    let d = Math.abs(((to - from) * 180) / Math.PI) % 360;
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  return worst;
}

function turnsBetweenFrames(clip: PoseClip, frames: readonly number[]): number[] {
  return frames.map((f) => maxBoneTurn(at(clip, f), at(clip, f + 1)));
}

describe("fall", () => {
  it("is never a photograph — every frame of the cycle is a new drawing", () => {
    for (const turn of turnsBetweenFrames(fall, FALL_FRAMES)) {
      expect(turn).toBeGreaterThan(0.1);
    }
  });

  it("drifts rather than flails: no bone swings faster than a limb falling", () => {
    for (const turn of turnsBetweenFrames(fall, FALL_FRAMES)) {
      expect(turn).toBeLessThan(8);
    }
  });

  it("has no still half-second — the body rises and settles across the cycle", () => {
    const tops = FALL_FRAMES.map((f) => extent(at(fall, f)).top);
    const spreads = FALL_FRAMES.map((f) => limbSpread(at(fall, f)));
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(1);
    expect(Math.max(...spreads) - Math.min(...spreads)).toBeGreaterThan(0.5);
  });

  it("closes its loop: the wrap is the quietest step in the cycle, not a jump", () => {
    const turns = turnsBetweenFrames(fall, FALL_FRAMES);
    const wrap = maxBoneTurn(at(fall, FALL_PERIOD - 1), at(fall, FALL_PERIOD));
    expect(at(fall, FALL_PERIOD)).toEqual(at(fall, 0));
    expect(wrap).toBeLessThan(Math.max(...turns));
  });

  it("opens at the top of an arc: highest, most stretched, arms not yet dropped", () => {
    const first = at(fall, 0);
    const rest = FALL_FRAMES.slice(1).map((f) => at(fall, f));
    expect(extent(first).top).toBeGreaterThan(Math.max(...rest.map((s) => extent(s).top)));
    expect(first.scaleY).toBeGreaterThan(Math.max(...rest.map((s) => s.scaleY)));
    const handHeight = (s: PoseSample) => -skeletonOf(s).handR.y1;
    expect(handHeight(first)).toBeGreaterThan(Math.max(...rest.map(handHeight)));
  });

  it("keeps the feet on the fighter's own position, so a landing does not clip", () => {
    for (const f of FALL_FRAMES) {
      expect(extent(at(fall, f)).bottom).toBeGreaterThan(-0.1);
    }
  });

  it("stays upright — an ordinary fall is not a tumble", () => {
    for (const f of FALL_FRAMES) {
      expect(at(fall, f).rotation).toBe(0);
    }
  });
});

describe("fastFall", () => {
  it("begins on the ordinary fall's own drawing, so committing at the apex cannot pop", () => {
    const ordinary = skeletonOf(at(fall, 0));
    const committed = skeletonOf(at(fastFall, 0));
    for (const name of DRAWN_BONES) {
      expect(committed[name].x1).toBeCloseTo(ordinary[name].x1, 9);
      expect(committed[name].y1).toBeCloseTo(ordinary[name].y1, 9);
    }
  });

  it("snaps: the pose arrives with the velocity instead of winding up for it", () => {
    expect(maxBoneTurn(at(fastFall, 0), at(fastFall, 1))).toBeGreaterThan(45);
  });

  it("is committed inside three frames and never opens back up", () => {
    const widest = Math.max(...FAST_FRAMES.filter((f) => f >= 3).map((f) => extent(at(fastFall, f)).width));
    const narrowestOrdinary = Math.min(...FALL_FRAMES.map((f) => extent(at(fall, f)).width));
    expect(widest).toBeLessThan(narrowestOrdinary * 0.6);
  });

  it("gathers the limbs onto the body — the ordinary fall holds them out", () => {
    const gathered = Math.max(...FAST_FRAMES.filter((f) => f >= 6).map((f) => limbSpread(at(fastFall, f))));
    const held = Math.min(...FALL_FRAMES.map((f) => limbSpread(at(fall, f))));
    expect(gathered).toBeLessThan(held * 0.6);
  });

  it("holds the tuck long enough to be read, then cuts", () => {
    expect(at(fastFall, 4)).toEqual(at(fastFall, 3));
    expect(at(fastFall, 5)).toEqual(at(fastFall, 3));
    expect(maxBoneTurn(at(fastFall, 5), at(fastFall, 6))).toBeGreaterThan(20);
  });

  it("goes rigid once committed, and stays that way for a long plunge", () => {
    for (const turn of turnsBetweenFrames(fastFall, FAST_FRAMES.filter((f) => f >= 8))) {
      expect(turn).toBeLessThan(1.5);
    }
  });

  it("rakes forward without ever rocking back", () => {
    const rotations = FAST_FRAMES.map((f) => at(fastFall, f).rotation);
    for (let i = 1; i < rotations.length; i++) {
      expect(rotations[i]).toBeGreaterThanOrEqual(rotations[i - 1] - 1e-12);
    }
    expect(Math.max(...rotations)).toBeGreaterThan(0.1);
  });

  it("does not sink the fighter through the floor it is about to land on", () => {
    for (const f of FAST_FRAMES) {
      expect(extent(at(fastFall, f)).bottom).toBeGreaterThan(-0.5);
    }
  });
});
