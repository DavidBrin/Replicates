/**
 * What the shield break has to be, stated as things you could see.
 *
 * This clip runs for `SHIELD_BREAK_STUN` — 240 frames — which is four times
 * longer than anything else in the library and long enough that every weakness
 * of a pose clip gets several seconds to show itself. So the assertions here
 * are about the *motion over that whole stretch*: that no part of it is a still
 * image, that the cycle does not read as a metronome, that the wrap does not
 * pop, and that the fighter stays on the floor while it happens.
 */

import { describe, expect, it } from "vitest";

import { SHIELD_BREAK_STUN } from "@/engine/constants";
import { BASE_RIG, resolve } from "../skeleton";
import { samplePose, type PoseSample } from "./clip";
import { shieldBroken } from "./shieldBroken";

const CYCLE = shieldBroken.period as number;
const DEG = 180 / Math.PI;

/** The clip as the renderer drives it: `poseTimeFor` wraps `actionFrame / period`. */
function at(frame: number): PoseSample {
  return samplePose(shieldBroken, frame / CYCLE);
}

const STUN = Array.from({ length: SHIELD_BREAK_STUN }, (_, f) => at(f));
const ONE_CYCLE = Array.from({ length: CYCLE }, (_, f) => at(f));
/**
 * A cycle's worth starting part-way in, so that every turning point falls
 * *inside* the window: a window that begins on one is a window that cannot see
 * it, and `t = 0` is deliberately a turning point.
 */
const OFF_PHASE = Array.from({ length: CYCLE + 1 }, (_, f) => at(f + 20));

/** Degrees the chest is tilted from vertical, positive forward. */
function chestLean(s: PoseSample): number {
  return (s.rotation + (s.angles.hip ?? 0) + (s.angles.torso ?? 0)) * DEG;
}

/** Degrees the head is tilted from vertical, positive forward. */
function headTilt(s: PoseSample): number {
  return chestLean(s) + (s.angles.head ?? 0) * DEG;
}

/**
 * Where a bone lands in rig units, with the clip's own translation applied —
 * the same composition `renderer.ts` does before handing the pose to `resolve`.
 * x is forward, y is height above the floor.
 */
function boneAt(s: PoseSample, bone: "footR" | "footL" | "head", end: "base" | "tip") {
  const sk = resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
  const b = sk[bone];
  return end === "base"
    ? { x: b.x0 + s.offsetX, y: -b.y0 + s.offsetY }
    : { x: b.x1 + s.offsetX, y: -b.y1 + s.offsetY };
}

function range(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/**
 * Frames at which a series changes direction, plus the size of each swing.
 *
 * Deliberately blind to the keyframes: it reads the sampled curve, so a clip
 * that declared four keys but interpolated through them without ever reversing
 * would be caught.
 */
function reversals(series: readonly number[]): { frames: number[]; swings: number[] } {
  const frames: number[] = [];
  const swings: number[] = [];
  let dir = 0;
  let lastTurn = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (Math.abs(d) < 1e-9) continue;
    const s = Math.sign(d);
    if (dir !== 0 && s !== dir) {
      frames.push(i - 1);
      swings.push(Math.abs(series[i - 1] - series[lastTurn]));
      lastTurn = i - 1;
    }
    dir = s;
  }
  return { frames, swings };
}

describe("the shield break stagger", () => {
  it("is still moving in its fourth second — no window of it is a photograph", () => {
    // A one-shot over 240 frames, however many keys it has, ends up holding one
    // drawing. Sweep a two-thirds-of-a-second window over the whole stun and
    // require the head to have travelled a visible distance inside every one.
    const window = 40;
    for (let start = 0; start + window <= SHIELD_BREAK_STUN; start += 5) {
      const xs = STUN.slice(start, start + window).map((s) => boneAt(s, "head", "tip").x);
      expect(range(xs), `frames ${start}..${start + window}`).toBeGreaterThan(0.9);
    }
  });

  it("never once holds the head upright", () => {
    for (const [f, s] of STUN.entries()) {
      // Positive is forward: the neck has given up, and it never gets it back.
      expect(headTilt(s), `frame ${f}`).toBeGreaterThan(4);
      expect(headTilt(s), `frame ${f}`).toBeLessThan(32);
    }
  });

  it("lolls the head, and lolls it out of step with the body", () => {
    const head = ONE_CYCLE.map(headTilt);
    const chest = ONE_CYCLE.map(chestLean);
    expect(range(head)).toBeGreaterThan(12);

    // The head is dead weight: it arrives after the shoulders. If it moved with
    // them the two curves would peak together.
    const headPeak = head.indexOf(Math.max(...head));
    const chestPeak = chest.indexOf(Math.max(...chest));
    expect(Math.abs(headPeak - chestPeak)).toBeGreaterThan(CYCLE / 8);
  });

  it("sways the body far enough to read across a stage", () => {
    expect(range(ONE_CYCLE.map(chestLean))).toBeGreaterThan(20);
    // The rig is about twelve units tall, so the head crosses something like a
    // fifth of the fighter's own height every sway — a stagger, not a shiver.
    expect(range(ONE_CYCLE.map((s) => boneAt(s, "head", "tip").x))).toBeGreaterThan(2.0);
  });

  it("staggers rather than keeping time — the two sways in a cycle are unequal", () => {
    const { frames, swings } = reversals(OFF_PHASE.map(chestLean));
    // Two full oscillations per cycle: four turning points.
    expect(frames.length).toBeGreaterThanOrEqual(4);

    const throws_ = swings.slice(1); // the first is measured from an arbitrary start
    expect(Math.max(...throws_) / Math.min(...throws_)).toBeGreaterThan(1.6);

    const gaps = frames.slice(1).map((f, i) => f - frames[i]);
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeGreaterThan(1.5);
  });

  it("puts the knees on a different clock from the sway", () => {
    // The body sways twice a cycle and the legs give way once, so the two never
    // line up and the repeat has no single beat to be heard on.
    const sag = reversals(OFF_PHASE.map((s) => s.offsetY));
    expect(sag.frames).toHaveLength(2);
    expect(reversals(OFF_PHASE.map(chestLean)).frames.length).toBeGreaterThanOrEqual(4);
  });

  it("stays below standing height throughout, and visibly sags", () => {
    for (const [f, s] of STUN.entries()) expect(s.offsetY, `frame ${f}`).toBeLessThan(0);
    expect(range(ONE_CYCLE.map((s) => s.offsetY))).toBeGreaterThan(0.15);
  });

  it("crosses its own loop point without a pop or a kink", () => {
    // The stun runs 2.2 cycles, so this join is crossed twice per shield break,
    // more often than any other loop in the game is crossed in one state.
    // One cycle's worth of per-frame steps: the last of them, and only the
    // last, straddles it.
    const speeds: number[] = [];
    for (let f = 0; f < CYCLE; f++) speeds.push(distance(at(f), at(f + 1)));
    const join = speeds[CYCLE - 1];
    const rest = speeds.slice(0, CYCLE - 1).sort((a, b) => a - b);

    // Not merely "no worse than the worst frame" — the join is placed at a
    // turning point, where the body is momentarily still, so it has to be
    // *quieter* than a typical frame. A cut here would be the loudest step of
    // the cycle.
    expect(join).toBeLessThan(rest[Math.floor(rest.length / 2)]);

    // And no kink: the change in speed across the join is ordinary too.
    const accel = speeds.slice(1).map((v, i) => Math.abs(v - speeds[i]));
    expect(accel[CYCLE - 2]).toBeLessThanOrEqual(Math.max(...accel.slice(0, CYCLE - 3)));
  });

  it("keeps the leading foot on the floor and does not let it skate", () => {
    const heights = STUN.map((s) => boneAt(s, "footR", "base").y);
    for (const [f, y] of heights.entries()) {
      expect(Math.abs(y), `frame ${f} ankle height`).toBeLessThan(0.15);
    }
    // The feet shuffle under a swaying body; they do not travel with it.
    const footX = ONE_CYCLE.map((s) => boneAt(s, "footR", "base").x);
    expect(range(footX)).toBeLessThan(0.6);
    expect(range(ONE_CYCLE.map((s) => boneAt(s, "head", "tip").x))).toBeGreaterThan(
      range(footX) * 4,
    );
  });

  it("lifts the trailing foot as the body pitches over its toes", () => {
    const lift = ONE_CYCLE.map((s) => boneAt(s, "footL", "base").y);
    const chest = ONE_CYCLE.map(chestLean);
    expect(Math.max(...lift)).toBeGreaterThan(0.15);
    // And it lifts when the weight goes forward, not at some unrelated moment.
    expect(Math.abs(lift.indexOf(Math.max(...lift)) - chest.indexOf(Math.max(...chest)))).toBeLessThan(
      CYCLE / 8,
    );
  });
});

/** How far the whole figure moved between two samples, in comparable units. */
function distance(a: PoseSample, b: PoseSample): number {
  let d = Math.abs(a.offsetX - b.offsetX) + Math.abs(a.offsetY - b.offsetY);
  d += Math.abs(a.rotation - b.rotation) * 4;
  for (const bone of Object.keys(a.angles) as (keyof typeof a.angles)[]) {
    d += Math.abs((a.angles[bone] ?? 0) - (b.angles[bone] ?? 0));
  }
  return d;
}

