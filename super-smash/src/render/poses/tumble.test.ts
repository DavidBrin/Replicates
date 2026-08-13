/**
 * Tumble is judged on motion, not on angles, so everything here is measured
 * off `samplePose` at the 32 clip times the match actually draws.
 *
 * The thresholds sit where they separate this clip from the two-key version it
 * replaced, which scored: rate spread 1.00 (a dead constant turn), knee and
 * ankle lag 0.000 (a rigid limb), and shin and foot arcs of 4° and 0° — limbs
 * that never moved relative to the body at all.
 */

import { describe, it, expect } from "vitest";
import { BASE_RIG, BONE_NAMES, resolve, type BoneName } from "../skeleton";
import { samplePose } from "./clip";
import { tumble } from "./tumble";

const PERIOD = tumble.period ?? 30;
const SPIN = tumble.spin ?? 0;
const TAU = Math.PI * 2;
const degOf = (r: number) => (r * 180) / Math.PI;

/**
 * The poses the match actually draws. `poseTimeFor` drives a looping clip from
 * a raw `actionFrame / period` ramp, so simulation frame `f` is the clip at
 * `f / period`, and frame `period` is frame 0 of the next cycle.
 */
const frames = Array.from({ length: PERIOD }, (_, f) => samplePose(tumble, f / PERIOD));

/** The bones this clip actually poses. */
const MOVERS = BONE_NAMES.filter((n) => frames[0].angles[n] !== undefined);

/** Total body rotation the renderer applies on frame `f`: the keys plus `spin`. */
function turnAt(f: number): number {
  return samplePose(tumble, f / PERIOD).rotation + (SPIN * TAU * f) / PERIOD;
}

/** Signed turn from frame `f` to the next, unwrapped across the cycle seam. */
function turnStep(f: number): number {
  return turnAt(f + 1) - turnAt(f);
}

function skeletonAt(f: number) {
  return resolve(BASE_RIG, frames[f].angles, { x: 0, y: 0, scale: 1, facing: 1 });
}

/** A bone's accumulated pose angle, with the whole-body spin left out of it. */
function boneAngles(bone: BoneName): number[] {
  return frames.map((_, f) => skeletonAt(f)[bone].angle);
}

/** Mean distance from the pelvis out to the extremities, in rig units. */
function reach(f: number): number {
  const sk = skeletonAt(f);
  const tips: BoneName[] = ["footL", "footR", "handL", "handR", "head"];
  return (
    tips.reduce((a, n) => a + Math.hypot(sk[n].x1 - sk.hip.x0, sk[n].y1 - sk.hip.y0), 0) / tips.length
  );
}

/**
 * Where in the cycle a joint's swing peaks, as a fraction of a cycle.
 *
 * The first Fourier component rather than the largest sample: a swing sampled
 * at eight keys has its true peak between samples, and comparing lags of two or
 * three frames needs finer resolution than "which key was highest".
 */
function peakPhase(series: readonly number[]): number {
  let re = 0;
  let im = 0;
  for (let f = 0; f < series.length; f++) {
    const a = (TAU * f) / series.length;
    re += series[f] * Math.cos(a);
    im += series[f] * Math.sin(a);
  }
  return (((Math.atan2(im, re) / TAU) % 1) + 1) % 1;
}

/** How far `child` peaks after `parent`, in cycles, going forward round the loop. */
function lagBetween(parent: BoneName, child: BoneName): number {
  return (peakPhase(boneAngles(child)) - peakPhase(boneAngles(parent)) + 1) % 1;
}

describe("tumble loops without a seam", () => {
  it("crosses back into frame 0 no harder than it crosses any frame inside the cycle", () => {
    const steps = Array.from({ length: PERIOD }, (_, f) => {
      const a = frames[f];
      const b = frames[(f + 1) % PERIOD];
      return Math.max(...MOVERS.map((n) => Math.abs(degOf(a.angles[n]! - b.angles[n]!))));
    });
    const seam = steps[PERIOD - 1];
    const inside = steps.slice(0, PERIOD - 1);
    expect(seam).toBeLessThanOrEqual(Math.max(...inside));
    // Nor does it stall there: a seam that pauses is as visible as one that jumps.
    expect(seam).toBeGreaterThan(0.5 * Math.min(...inside));
  });

  it("turns through the seam at the same rate as everywhere else", () => {
    const steps = Array.from({ length: PERIOD }, (_, f) => turnStep(f));
    const inside = steps.slice(0, PERIOD - 1);
    expect(steps[PERIOD - 1]).toBeGreaterThanOrEqual(Math.min(...inside) - 1e-9);
    expect(steps[PERIOD - 1]).toBeLessThanOrEqual(Math.max(...inside) + 1e-9);
  });

  it("comes back to the same drawn orientation exactly one turn later", () => {
    const round = turnAt(PERIOD) - turnAt(0);
    expect(Math.abs(round)).toBeCloseTo(TAU, 9);
    // A fractional turn per cycle would jump by that fraction at every seam.
    expect(Math.abs(round / TAU - Math.round(round / TAU))).toBeLessThan(1e-9);
  });
});

describe("tumble is a body, not a shape being rotated", () => {
  it("draws a different pose on every one of the simulation frames", () => {
    for (let a = 0; a < PERIOD; a++) {
      for (let b = a + 1; b < PERIOD; b++) {
        const apart = Math.max(
          ...MOVERS.map((n) => Math.abs(degOf(frames[a].angles[n]! - frames[b].angles[n]!))),
        );
        expect(apart, `frames ${a} and ${b} are the same drawing`).toBeGreaterThan(2);
      }
    }
  });

  it("swings every limb through a real arc instead of carrying it along", () => {
    for (const bone of MOVERS) {
      const vals = frames.map((s) => degOf(s.angles[bone]!));
      expect(Math.max(...vals) - Math.min(...vals), `${bone} barely moves`).toBeGreaterThan(20);
    }
  });

  it("opens and closes the gap between the legs, so they never read as one shape", () => {
    const split = frames.map((s) => degOf(s.angles.thighL! - s.angles.thighR!));
    expect(Math.min(...split)).toBeGreaterThan(10);
    expect(Math.max(...split) - Math.min(...split)).toBeGreaterThan(40);
  });

  it("changes how far the mass sits from the pivot", () => {
    const r = Array.from({ length: PERIOD }, (_, f) => reach(f));
    expect(Math.max(...r) / Math.min(...r)).toBeGreaterThan(1.15);
  });
});

describe("the limbs trail the turn", () => {
  it("arrives at the knee after the hip, and at the ankle after the knee", () => {
    for (const [thigh, shin, foot] of [
      ["thighR", "shinR", "footR"],
      ["thighL", "shinL", "footL"],
    ] as const) {
      const knee = lagBetween(thigh, shin);
      const ankle = lagBetween(shin, foot);
      expect(knee, `${shin} does not trail ${thigh}`).toBeGreaterThan(0.03);
      expect(knee).toBeLessThan(0.5);
      expect(ankle, `${foot} does not trail ${shin}`).toBeGreaterThan(0.03);
      expect(ankle).toBeLessThan(0.5);
    }
  });

  it("arrives at the forearm after the upper arm", () => {
    for (const [upper, fore] of [
      ["upperArmR", "forearmR"],
      ["upperArmL", "forearmL"],
    ] as const) {
      const elbow = lagBetween(upper, fore);
      expect(elbow, `${fore} does not trail ${upper}`).toBeGreaterThan(0.03);
      expect(elbow).toBeLessThan(0.5);
    }
  });

  it("keeps the near and far sides out of step with each other", () => {
    for (const [near, far] of [
      ["thighR", "thighL"],
      ["upperArmR", "upperArmL"],
    ] as const) {
      const lag = lagBetween(near, far);
      expect(Math.min(lag, 1 - lag), `${near} and ${far} swing together`).toBeGreaterThan(0.1);
    }
  });
});

describe("the turn is uneven, and uneven for a reason", () => {
  it("never stalls and never reverses", () => {
    const steps = Array.from({ length: PERIOD }, (_, f) => turnStep(f));
    for (const s of steps) expect(Math.sign(s)).toBe(Math.sign(SPIN));
    expect(Math.min(...steps.map(Math.abs))).toBeGreaterThan(TAU / PERIOD / 2);
  });

  it("does not turn at a constant rate", () => {
    const steps = Array.from({ length: PERIOD }, (_, f) => Math.abs(turnStep(f)));
    expect(Math.max(...steps) / Math.min(...steps)).toBeGreaterThan(1.15);
  });

  it("turns fastest with the limbs pulled in and slowest with them flung out", () => {
    const r = Array.from({ length: PERIOD }, (_, f) => reach(f));
    const tightest = r.indexOf(Math.min(...r));
    const widest = r.indexOf(Math.max(...r));
    expect(Math.abs(turnStep(tightest))).toBeGreaterThan(Math.abs(turnStep(widest)));
  });
});

describe("the pose stays anatomical", () => {
  it("never hyperextends a knee, on any frame it could be caught on", () => {
    for (let f = 0; f < PERIOD * 4; f++) {
      const s = samplePose(tumble, f / (PERIOD * 4));
      expect(degOf(s.angles.shinR!)).toBeGreaterThan(0);
      expect(degOf(s.angles.shinL!)).toBeGreaterThan(0);
    }
  });

  it("never scales the rig, since scale is applied in world axes and shears a turning body", () => {
    for (const k of tumble.keys) {
      expect(k.scaleX ?? 1).toBe(1);
      expect(k.scaleY ?? 1).toBe(1);
    }
  });
});
