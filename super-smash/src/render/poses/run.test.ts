/**
 * The run, checked against the two things that make it one: a foot that is
 * genuinely down while the body passes over it, and a moment when neither foot
 * is.
 *
 * Everything here measures the *drawing* — bone positions out of `resolve` at
 * the rig's own scale — rather than the numbers in `run.ts`. An assertion that
 * `keys[3].t === 0.375` passes for a clip that has been broken; an assertion
 * that both feet clear the floor somewhere in the cycle does not. The walk is
 * imported as the control: almost every claim below is only interesting as a
 * comparison, because "leans forward" and "bobs" are true of a walk too.
 */

import { describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { BASE_RIG, resolve, type BoneName, type PoseAngles, type Rig } from "../skeleton";
import { getCharacterRig } from "../characterArt";
import { makeFighter } from "../testFixtures";
import { samplePose, type PoseClip, type PoseSample } from "./clip";
import { poseTimeFor } from "./timing";
import { run } from "./run";
import { walk } from "./walk";

const DEG = 180 / Math.PI;

/** Fine enough to catch a foot that dips between two keys. */
const STEPS = 96;
const TIMES = Array.from({ length: STEPS }, (_, i) => i / STEPS);

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Bone ends in ground-relative rig space: y is height above the floor with the
 * clip's own `offsetY` and squash folded in, x is forward of the fighter's
 * position. This is the space the animation is judged in — `resolve` alone
 * answers in screen coordinates about a rig whose origin the clip has moved.
 */
function drawing(clip: PoseClip, t: number, rig: Rig = BASE_RIG) {
  const s: PoseSample = samplePose(clip, t);
  const sk = resolve(rig, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
  });
  const base = (n: BoneName): Point => ({ x: s.offsetX + sk[n].x0, y: s.offsetY - sk[n].y0 });
  const tip = (n: BoneName): Point => ({ x: s.offsetX + sk[n].x1, y: s.offsetY - sk[n].y1 });
  return { sample: s, base, tip };
}

/**
 * How high off the floor the lower of the two feet is.
 *
 * A foot is a bone from the heel to the toe, so the height that matters is
 * whichever end is nearer the floor: a heel strike has the toe in the air and a
 * toe-off has the heel in the air, and both are contact.
 */
function lowerFoot(clip: PoseClip, t: number, rig: Rig = BASE_RIG): number {
  const d = drawing(clip, t, rig);
  const foot = (n: "footL" | "footR") => Math.min(d.base(n).y, d.tip(n).y);
  return Math.min(foot("footL"), foot("footR"));
}

/** Pelvis height above the floor. */
function hipHeight(clip: PoseClip, t: number, rig: Rig = BASE_RIG): number {
  return drawing(clip, t, rig).base("hip").y;
}

/** How far in front of the pelvis the shoulders are carried. */
function shoulderLead(clip: PoseClip, t: number): number {
  const d = drawing(clip, t);
  return d.tip("torso").x - d.base("hip").x;
}

/** The near upper arm's angle in world terms, 180 straight down, 90 forward. */
function shoulderAngle(clip: PoseClip, t: number): number {
  const s = samplePose(clip, t);
  const sk = resolve(BASE_RIG, s.angles, { x: 0, y: 0, scale: 1, facing: 1 });
  return sk.upperArmR.angle * DEG;
}

/** Every bone's parent-relative angle, in degrees, rest angles filled in. */
function angles(clip: PoseClip, t: number): Record<string, number> {
  const a: PoseAngles = samplePose(clip, t).angles;
  const out: Record<string, number> = {};
  for (const name of Object.keys(BASE_RIG) as BoneName[]) {
    out[name] = (a[name] ?? BASE_RIG[name].angle) * DEG;
  }
  return out;
}

/** The near foot's stance: from its contact key to the moment it leaves. */
const STANCE = TIMES.filter((t) => t <= 0.25);

describe("the run cycle", () => {
  it("has a flight phase, which is the thing a walk does not have", () => {
    const airborne = Math.max(...TIMES.map((t) => lowerFoot(run, t)));
    const walking = Math.max(...TIMES.map((t) => lowerFoot(walk, t)));

    // A whole unit of daylight under the lower foot — against a rig whose foot
    // capsule is 1.35 across, that is unmistakably off the floor.
    expect(airborne).toBeGreaterThan(1.0);
    // The walk always has a foot down: that is the definition of a walk.
    expect(walking).toBeLessThan(0.3);
  });

  it("is airborne for a fifth of each stride, not for a single instant", () => {
    const off = TIMES.filter((t) => lowerFoot(run, t) > 0.5);
    expect(off.length / STEPS).toBeGreaterThan(0.25);
    expect(off.length / STEPS).toBeLessThan(0.6);
  });

  it("puts a foot on the floor at both contacts, where the dust is spawned", () => {
    // `footPlanted` in vfx.ts puffs dust whenever the clip crosses a half-cycle,
    // so t = 0 and t = 0.5 are the two frames the game claims a footfall on.
    for (const t of [0, 0.5]) {
      expect(lowerFoot(run, t), `t=${t}`).toBeLessThan(0.25);
    }
  });

  it("keeps that foot down for the whole stance rather than touching and leaving", () => {
    for (const t of STANCE) {
      expect(lowerFoot(run, t), `t=${t.toFixed(3)}`).toBeLessThan(0.3);
    }
  });

  it("never lets the planted foot travel forwards while it is down", () => {
    // The one thing a distance-paced cycle can be authored to get right. The
    // body advances underneath it either way; a foot that also moved forward
    // would be skating in the direction of travel, which is what reads as wrong.
    const heel = STANCE.map((t) => drawing(run, t).base("footR").x);
    const toe = STANCE.map((t) => drawing(run, t).tip("footR").x);
    for (let i = 1; i < heel.length; i++) {
      expect(heel[i], `heel at step ${i}`).toBeLessThan(heel[i - 1]);
      expect(toe[i], `toe at step ${i}`).toBeLessThan(toe[i - 1]);
    }
    // And it gives back a real distance doing it, not a token half-unit.
    expect(heel[0] - heel[heel.length - 1]).toBeGreaterThan(3);
  });

  it("is the same drawing at the same distance covered, whatever the fighter", () => {
    // The whole point of `PACED_BY_SPEED`: clip time is `frame × |vx| / STRIDE`,
    // so the pose is a function of ground covered. Fox and Kirby are the extremes
    // of the roster's run speed, and one stride in must find them identically
    // posed — which is why a foot authored to look planted for one of them is
    // planted for all of them.
    const foxSpeed = 2.402;
    const kirbySpeed = 1.727;
    for (let distance = 0; distance <= 36; distance += 1.5) {
      const poseAt = (speed: number) => {
        const f = makeFighter({ action: "run", actionFrame: distance / speed, vx: fx(speed) });
        return samplePose(run, poseTimeFor("run", f, 0)).angles;
      };
      const fox = poseAt(foxSpeed);
      const kirby = poseAt(kirbySpeed);
      for (const name of Object.keys(fox) as BoneName[]) {
        expect(
          Math.abs((fox[name] as number) - (kirby[name] as number)) * DEG,
          `${name} at ${distance} units`,
        ).toBeLessThan(0.5);
      }
    }
    // Guard the premise: these really are different numbers of frames.
    expect(Math.round(36 / foxSpeed)).not.toBe(Math.round(36 / kirbySpeed));
    expect(toFloat(fx(foxSpeed))).toBeGreaterThan(toFloat(fx(kirbySpeed)));
  });

  it("leans further forward than the walk at every instant of the cycle", () => {
    const walkMax = Math.max(...TIMES.map((t) => shoulderLead(walk, t)));
    for (const t of TIMES) {
      // Deeper than the walk ever gets, and deep in its own right: three
      // quarters of a unit is a fifth of the torso's length.
      expect(shoulderLead(run, t), `t=${t.toFixed(3)}`).toBeGreaterThan(walkMax);
      expect(shoulderLead(run, t), `t=${t.toFixed(3)}`).toBeGreaterThan(0.75);
    }
  });

  it("rides up and down far more than the walk does", () => {
    const spread = (clip: PoseClip) => {
      const h = TIMES.map((t) => hipHeight(clip, t));
      return Math.max(...h) - Math.min(...h);
    };
    expect(spread(run)).toBeGreaterThan(spread(walk) * 2.5);
    expect(spread(run)).toBeGreaterThan(0.9);
    // Twice per cycle, because one stride is one bounce.
    const rising = TIMES.map(
      (t, i) => hipHeight(run, t) > hipHeight(run, TIMES[(i + STEPS - 1) % STEPS]),
    );
    const turns = rising.filter((up, i) => up !== rising[(i + STEPS - 1) % STEPS]).length;
    expect(turns).toBe(4);
  });

  it("drives the arms through far more than the walk's swing", () => {
    // Two measures, because either alone can be gamed: the shoulder's arc says
    // the upper arm is really being thrown, and the hand's path length says the
    // elbow is doing something as well as riding along.
    const shoulderArc = (clip: PoseClip) => {
      const a = TIMES.map((t) => shoulderAngle(clip, t));
      return Math.max(...a) - Math.min(...a);
    };
    const handPath = (clip: PoseClip) => {
      const p = TIMES.map((t) => drawing(clip, t).tip("handR"));
      return p.reduce(
        (sum, q, i) => sum + Math.hypot(q.x - p[(i + STEPS - 1) % STEPS].x, q.y - p[(i + STEPS - 1) % STEPS].y),
        0,
      );
    };
    expect(shoulderArc(run)).toBeGreaterThan(shoulderArc(walk) * 2);
    expect(shoulderArc(run)).toBeGreaterThan(100);
    expect(handPath(run)).toBeGreaterThan(handPath(walk) * 2.25);
  });

  it("never straightens an arm, which is what Donkey Kong's would swing through the floor", () => {
    // DK's arms are 1.44x the reference rig's and hang to his knees. Any key
    // that lets an elbow open puts a six-unit limb through the stage.
    const dk = getCharacterRig("dk").bones;
    for (const t of TIMES) {
      const a = angles(run, t);
      for (const arm of ["forearmL", "forearmR"] as const) {
        expect(Math.abs(a[arm]), `${arm} at t=${t.toFixed(3)}`).toBeGreaterThan(25);
      }
      const d = drawing(run, t, dk);
      expect(d.tip("handL").y, `handL at t=${t.toFixed(3)}`).toBeGreaterThan(0);
      expect(d.tip("handR").y, `handR at t=${t.toFixed(3)}`).toBeGreaterThan(0);
    }
  });

  it("is the same stride twice, mirrored", () => {
    const swap: Record<string, string> = {
      thighL: "thighR", shinL: "shinR", footL: "footR",
      upperArmL: "upperArmR", forearmL: "forearmR", handL: "handR",
    };
    for (const t of TIMES) {
      const now = angles(run, t);
      const half = angles(run, t + 0.5);
      for (const [left, right] of Object.entries(swap)) {
        expect(half[right], `${right} at t=${t.toFixed(3)}`).toBeCloseTo(now[left], 4);
        expect(half[left], `${left} at t=${t.toFixed(3)}`).toBeCloseTo(now[right], 4);
      }
      // The body's own rise and fall repeats every stride, not every cycle.
      expect(samplePose(run, t + 0.5).offsetY).toBeCloseTo(samplePose(run, t).offsetY, 6);
    }
  });

  it("crosses its own loop point at the speed it moves everywhere else", () => {
    // A cycle that eases into `t = 1` stops dead once per stride. Measure the
    // largest angle any bone turns between adjacent samples, and check the step
    // that straddles the wrap is an ordinary one.
    const steps = TIMES.map((t, i) => {
      const a = angles(run, t);
      const b = angles(run, TIMES[(i + 1) % STEPS] + (i === STEPS - 1 ? 1 : 0));
      return Math.max(...Object.keys(a).map((n) => Math.abs(b[n] - a[n])));
    });
    const wrap = steps[STEPS - 1];
    const median = [...steps].sort((p, q) => p - q)[Math.floor(STEPS / 2)];
    expect(wrap).toBeGreaterThan(median * 0.5);
    expect(wrap).toBeLessThan(median * 1.6);
  });
});
