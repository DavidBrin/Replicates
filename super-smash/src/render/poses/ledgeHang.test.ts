import { describe, expect, it } from "vitest";
import { BASE_RIG, BONE_NAMES, resolve, type BoneName } from "../skeleton";
import { samplePose, type PoseClip, type PoseSample } from "./clip";
import { idle } from "./idle";
import { ledgeGetUp, ledgeHang } from "./ledgeHang";

/**
 * The engine's own frame counts, restated rather than imported — a test that
 * reads the same constant the clip was authored against cannot tell you the
 * clip is the right length.
 */
const HANG_PERIOD = 72;
const GETUP_FRAMES = 26;

/** A clip sampled the way `poseTimeFor` samples it: by simulation frame. */
function at(clip: PoseClip, frame: number, frames: number): PoseSample {
  return samplePose(clip, clip.loop ? (((frame % frames) + frames) % frames) / frames : frame / frames);
}

/** Every bone's tip, in rig units, y-up, relative to the fighter's origin. */
function tips(s: PoseSample): Record<BoneName, { x: number; y: number }> {
  const sk = resolve(BASE_RIG, s.angles, {
    x: s.offsetX,
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
  const out = {} as Record<BoneName, { x: number; y: number }>;
  for (const n of BONE_NAMES) out[n] = { x: sk[n].x1, y: -sk[n].y1 };
  return out;
}

const DEG = 180 / Math.PI;

/** The largest angle any single bone turns between two poses, in degrees. */
function biggestTurn(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const n of BONE_NAMES) {
    const from = a.angles[n] ?? BASE_RIG[n].angle;
    const to = b.angles[n] ?? BASE_RIG[n].angle;
    let d = Math.abs((to - from) * DEG) % 360;
    if (d > 180) d = 360 - d;
    if (d > worst) worst = d;
  }
  return worst;
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

const hangFrames = Array.from({ length: HANG_PERIOD }, (_, f) => at(ledgeHang, f, HANG_PERIOD));
const getUpFrames = Array.from({ length: GETUP_FRAMES + 1 }, (_, f) => at(ledgeGetUp, f, GETUP_FRAMES));

describe("ledgeHang", () => {
  /**
   * The one that matters, and the one no other clip in the library has to
   * satisfy: the ledge is a fixed point in the world, so the hands are too. A
   * hand that wanders half a unit over the cycle is a fighter sliding along the
   * edge they are supposed to be gripping.
   */
  it("keeps both hands on one fixed point for the whole cycle", () => {
    for (const side of ["handR", "handL"] as const) {
      const xs = hangFrames.map((s) => tips(s)[side].x);
      const ys = hangFrames.map((s) => tips(s)[side].y);
      expect(spread(xs), `${side} x`).toBeLessThan(0.2);
      expect(spread(ys), `${side} y`).toBeLessThan(0.2);
    }
  });

  /** And they hold it *overhead*, which is the only way to hang from it. */
  it("holds that point above and in front of the shoulder", () => {
    for (const s of hangFrames) {
      const t = tips(s);
      expect(t.handR.y).toBeGreaterThan(t.torso.y + 2);
      expect(t.handR.x).toBeGreaterThan(t.torso.x + 1);
    }
  });

  /** A fighter dangling by their fingertips is never still. */
  it("moves the body under those hands rather than holding a photograph", () => {
    const feet = hangFrames.map((s) => tips(s).footR);
    const head = hangFrames.map((s) => tips(s).head);
    expect(spread(feet.map((p) => p.x))).toBeGreaterThan(0.6);
    expect(spread(head.map((p) => p.x))).toBeGreaterThan(0.4);
    // Rising and falling as well as swinging: a pendulum is highest at its ends.
    expect(spread(feet.map((p) => p.y))).toBeGreaterThan(0.4);
  });

  /**
   * The legs are hung off the body, so they arrive at their extreme after it
   * does. Without that lag the fighter swings as one rigid plank.
   */
  it("swings the legs a quarter cycle behind the body", () => {
    const extreme = (get: (s: PoseSample) => number) => {
      let best = 0;
      for (let f = 1; f < HANG_PERIOD; f++) {
        if (get(hangFrames[f]) > get(hangFrames[best])) best = f;
      }
      return best;
    };
    const body = extreme((s) => tips(s).head.x);
    const legs = extreme((s) => tips(s).footR.x);
    const lag = Math.min(
      Math.abs(body - legs),
      HANG_PERIOD - Math.abs(body - legs),
    );
    expect(lag).toBeGreaterThan(HANG_PERIOD / 8);
  });

  /**
   * A looping clip has one join the contact sheet never shows, and a hang is
   * held long enough to cross it dozens of times. Measuring every frame gap in
   * the cycle *including* the wrap catches both a discontinuous loop and a lurch
   * in the middle, with one number.
   */
  it("loops without a seam, and never lurches", () => {
    let worst = 0;
    for (let f = 0; f < HANG_PERIOD; f++) {
      worst = Math.max(worst, biggestTurn(hangFrames[f], hangFrames[(f + 1) % HANG_PERIOD]));
    }
    expect(worst).toBeLessThan(1.5);
  });
});

describe("ledgeGetUp", () => {
  it("starts from the hang", () => {
    // The pass through the middle of the sway, which is where a fighter deciding
    // to climb is most likely to be.
    expect(biggestTurn(getUpFrames[0], at(ledgeHang, HANG_PERIOD / 4, HANG_PERIOD))).toBeLessThan(10);
  });

  /** Holds the ledge, then commits: the release happens once, and late. */
  it("keeps the grip through the pull and lets go for the second half", () => {
    const grip = tips(getUpFrames[0]).handR;
    const away = getUpFrames.map((s) => {
      const h = tips(s).handR;
      return Math.hypot(h.x - grip.x, h.y - grip.y);
    });
    for (let f = 0; f <= 9; f++) expect(away[f], `frame ${f}`).toBeLessThan(0.35);
    expect(away[GETUP_FRAMES]).toBeGreaterThan(5);
    // Every frame of the second half is further off the ledge than the pull was:
    // the fighter commits, rather than groping back at it.
    for (let f = 13; f <= GETUP_FRAMES; f++) expect(away[f], `frame ${f}`).toBeGreaterThan(2);
  });

  /** The fighter arrives *on* the stage: higher than they started, on their feet. */
  it("climbs, and finishes standing on the ground line", () => {
    const start = tips(getUpFrames[0]);
    const end = tips(getUpFrames[GETUP_FRAMES]);
    expect(end.head.y - start.head.y).toBeGreaterThan(1.2);
    // Both feet start below the lip and end level with it.
    expect(Math.max(start.footR.y, start.footL.y)).toBeLessThan(-1);
    expect(Math.abs(end.footR.y)).toBeLessThan(0.4);
    expect(Math.abs(end.footL.y)).toBeLessThan(0.4);
  });

  /**
   * A climb that moves at one rate throughout is a fighter being winched up. The
   * accents — the knee drive out of the gather, the leg extension off the lip —
   * have to be several times the rate of the frames around them, and a clip
   * lerped evenly from key to key cannot pass this however many keys it has.
   *
   * The ceiling catches the opposite failure: a span wide enough that the
   * shortest-path lerp unwinds a joint the long way round shows up as a bone
   * crossing an eighth of a turn between two frames.
   */
  it("accents rather than winches, and never snaps a joint", () => {
    const steps = Array.from({ length: GETUP_FRAMES }, (_, f) =>
      biggestTurn(getUpFrames[f], getUpFrames[f + 1]),
    );
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(Math.max(...steps)).toBeGreaterThan(median * 3);
    expect(Math.max(...steps)).toBeLessThan(45);
  });

  /**
   * The join. `stand` follows `ledgeGetUp` immediately, and a bone this clip
   * leaves anywhere but `idle`'s first key pops on the handover — including the
   * legs, which `idle` never names and therefore inherits at rest.
   */
  it("ends on the idle pose, legs and feet included", () => {
    const last = getUpFrames[GETUP_FRAMES];
    // Against every phase of the breath, not one key of it: `poseTimeFor` runs
    // the standing loop off the global frame, so a climb can hand over into any
    // part of it. Six degrees is the width of `idle`'s own swing plus a little.
    for (let f = 0; f < 108; f++) {
      expect(biggestTurn(last, at(idle, f, 108)), `idle frame ${f}`).toBeLessThan(6);
    }
    expect(Math.abs(last.offsetY)).toBeLessThan(0.2);
    expect(last.scaleY).toBeCloseTo(1, 6);
  });
});
