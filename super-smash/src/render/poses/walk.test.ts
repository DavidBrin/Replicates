/**
 * The walk is checked as *motion*, not as the numbers that were typed.
 *
 * Every assertion here goes through `samplePose`, so it sees the eased,
 * interpolated frames a fighter is actually drawn in rather than the four keys
 * — which is where the interesting failures live. Three of them fail against
 * the version this replaced, and each names something that was visible on
 * screen: at the contact keys *neither* foot reached the ground, the stance
 * foot's backward sweep fell to a tenth of its own top speed at every key
 * because the spans were smoothstepped, and the foot never went flat.
 *
 * Sample counts are 24, the shortest cycle any fighter gets (Fox, at 36 world
 * units a cycle and 1.523 a frame), so a frame the tests never look at is a
 * frame nobody is ever drawn in either.
 */

import { describe, it, expect } from "vitest";
import { BASE_RIG, BONE_NAMES, resolve, type BoneName } from "../skeleton";
import { samplePose, still, type PoseSample } from "./clip";
import { walk } from "./walk";

/** Fox's cycle: the fewest frames the clip is ever sampled at. */
const FRAMES = 24;

const deg = (r: number) => (r * 180) / Math.PI;

interface Geometry {
  readonly hip: number;
  readonly crown: number;
  readonly ankle: { R: number; L: number };
  readonly heelY: { R: number; L: number };
  readonly toeY: { R: number; L: number };
  readonly sole: { R: number; L: number };
  readonly hand: { R: number; L: number };
}

/**
 * The clip as the eye sees it: heights above the ground line and distances
 * forward of the pelvis, in rig units, with the body offset folded in.
 */
function geometry(sample: PoseSample): Geometry {
  const sk = resolve(BASE_RIG, sample.angles, { x: 0, y: 0, scale: 1, facing: 1 });
  const up = (y: number) => sample.offsetY - y;
  // Feet are capsules, so the sole is the bone line less half the thickness.
  const r = BASE_RIG.footR.thickness / 2;
  const sole = (n: "footR" | "footL") => Math.min(up(sk[n].y0), up(sk[n].y1)) - r;
  return {
    hip: up(sk.hip.y0),
    crown: up(sk.head.y1),
    ankle: { R: sk.footR.x0, L: sk.footL.x0 },
    heelY: { R: up(sk.footR.y0), L: up(sk.footL.y0) },
    toeY: { R: up(sk.footR.y1), L: up(sk.footL.y1) },
    sole: { R: sole("footR"), L: sole("footL") },
    hand: { R: sk.handR.x1, L: sk.handL.x1 },
  };
}

const cycle: Geometry[] = Array.from({ length: FRAMES }, (_, f) =>
  geometry(samplePose(walk, f / FRAMES)),
);

/** Where the rig's own standing foot sits — the walk's ground plane. */
const REST_SOLE = geometry(samplePose(still({}), 0)).sole.R;

describe("the walk cycle", () => {
  it("is symmetric, so the fighter does not limp", () => {
    // Half a cycle later the fighter must be in the same pose with the legs and
    // arms swapped. `forearm` is the one bone whose mirror is a negation — see
    // the note in walk.ts — so it is compared against its own negative.
    const swapped: Partial<Record<BoneName, BoneName>> = {};
    for (const name of BONE_NAMES) {
      if (name.endsWith("L")) swapped[name] = (name.slice(0, -1) + "R") as BoneName;
      if (name.endsWith("R")) swapped[name] = (name.slice(0, -1) + "L") as BoneName;
    }
    for (let f = 0; f < FRAMES; f++) {
      const a = samplePose(walk, f / FRAMES);
      const b = samplePose(walk, f / FRAMES + 0.5);
      for (const name of Object.keys(a.angles) as BoneName[]) {
        const partner = swapped[name] ?? name;
        const flip = name.startsWith("forearm") && partner !== name ? -1 : 1;
        expect(
          deg(b.angles[partner] as number) * flip,
          `${name} at frame ${f} vs ${partner} half a cycle later`,
        ).toBeCloseTo(deg(a.angles[name] as number), 4);
      }
      expect(b.offsetY).toBeCloseTo(a.offsetY, 9);
    }
  });

  it("keeps one foot on the ground and lifts the other clear of it", () => {
    for (let f = 0; f < FRAMES; f++) {
      const g = cycle[f];
      const down = Math.min(g.sole.R, g.sole.L);
      const lifted = Math.max(g.sole.R, g.sole.L);
      // Somebody is always in contact: a walk has no flight phase, which is the
      // whole thing that distinguishes it from the run clip next door.
      expect(down, `frame ${f}: lower foot`).toBeLessThan(REST_SOLE + 0.12);
      expect(down, `frame ${f}: lower foot is not buried`).toBeGreaterThan(REST_SOLE - 0.15);
      // ...and the other foot is either sharing the load at a contact key or
      // swinging over the top. What it must never be is ploughing.
      expect(lifted, `frame ${f}: upper foot`).toBeGreaterThan(REST_SOLE - 0.15);
    }
    // At the passing keys the swing foot is unambiguously airborne.
    for (const t of [0.25, 0.75]) {
      const g = geometry(samplePose(walk, t));
      const lift = Math.max(g.sole.R, g.sole.L) - Math.min(g.sole.R, g.sole.L);
      expect(lift, `swing clearance at t=${t}`).toBeGreaterThan(0.6);
    }
  });

  it("sweeps the standing foot backwards at a steady rate, so it reads as planted", () => {
    // The right foot is down from t=0 to t=0.5. Over that half cycle it must
    // travel backwards *through* the body and never pause, because the ground
    // it is standing on does not pause: clip time here is distance covered.
    const N = 24;
    const steps: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = geometry(samplePose(walk, (i / N) * 0.5)).ankle.R;
      const b = geometry(samplePose(walk, ((i + 1) / N) * 0.5)).ankle.R;
      steps.push(b - a);
    }
    for (const [i, d] of steps.entries()) {
      expect(d, `stance step ${i} moves backwards`).toBeLessThan(0);
    }
    // A smoothstepped span would stall to nearly zero at each key; the whole
    // point of `linear` is that the slowest step stays within reach of the
    // fastest. The tail is allowed to ease as the foot rolls onto its toe.
    const fastest = Math.min(...steps);
    const slowest = Math.max(...steps.slice(0, -4));
    expect(slowest / fastest).toBeGreaterThan(0.7);

    // And the sweep is worth having: near the whole excursion the leg can
    // reach. Anything much under three units means the stride was given away.
    const total = geometry(samplePose(walk, 0)).ankle.R - geometry(samplePose(walk, 0.5)).ankle.R;
    expect(total).toBeGreaterThan(3.2);
  });

  it("rolls the foot from heel to toe instead of holding one angle", () => {
    const contact = geometry(samplePose(walk, 0));
    // Heel strike: the toe is still up, so the heel is the lower end.
    expect(contact.toeY.R - contact.heelY.R).toBeGreaterThan(0.15);
    const mid = geometry(samplePose(walk, 0.2));
    expect(Math.abs(mid.toeY.R - mid.heelY.R), "flat through midstance").toBeLessThan(0.15);
    const off = geometry(samplePose(walk, 0.5));
    // Toe off: the heel is high and the toe is the last thing on the ground.
    expect(off.heelY.R - off.toeY.R).toBeGreaterThan(0.4);
    expect(off.toeY.R - REST_SOLE - BASE_RIG.footR.thickness / 2).toBeLessThan(0.15);
  });

  it("counter-swings the arms against the legs at every frame", () => {
    // Asserted on direction rather than on position, because the library's
    // forearm convention puts a constant backward bias on the right hand (see
    // walk.ts) which would make a "right hand behind right foot" check pass or
    // fail on the size of the elbow rather than on the phase of the swing.
    // Where the hand and the foot are *going* has no such bias.
    for (let f = 0; f < FRAMES; f++) {
      const a = cycle[f];
      const b = cycle[(f + 1) % FRAMES];
      const foot = b.ankle.R - a.ankle.R;
      const hand = b.hand.R - a.hand.R;
      expect(
        Math.sign(foot) * Math.sign(hand),
        `frame ${f}: right foot moved ${foot.toFixed(2)}, right hand ${hand.toFixed(2)}`,
      ).toBe(-1);
    }
    // And the swing is worth seeing. The previous version's arms moved a third
    // of this and vanished into the torso's silhouette at match scale.
    const reach = cycle.map((g) => g.hand.R);
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(2.5);
    // ...but a walk is not a march: the hands do not outswing the feet.
    const feet = cycle.map((g) => g.ankle.R);
    expect(Math.max(...reach) - Math.min(...reach)).toBeLessThan(
      (Math.max(...feet) - Math.min(...feet)) * 1.25,
    );
  });

  it("bobs twice a cycle, lowest at the contacts and highest at the passes", () => {
    const heights = cycle.map((g) => g.crown);
    const lowest = heights.indexOf(Math.min(...heights));
    const highest = heights.indexOf(Math.max(...heights));
    expect([0, FRAMES / 2]).toContain(lowest);
    expect([FRAMES / 4, (3 * FRAMES) / 4]).toContain(highest);
    // Two bobs, not one: the second half of the cycle repeats the first.
    expect(cycle[FRAMES / 2].crown).toBeCloseTo(cycle[0].crown, 6);
    expect(cycle[(3 * FRAMES) / 4].crown).toBeCloseTo(cycle[FRAMES / 4].crown, 6);

    // A walk is a spacing tool, not a lope: the bob is a couple of percent of
    // the fighter's height. Much more and it reads as a strut.
    const bob = Math.max(...heights) - Math.min(...heights);
    expect(bob / cycle[0].crown).toBeGreaterThan(0.015);
    expect(bob / cycle[0].crown).toBeLessThan(0.045);
  });

  it("loops without a seam and without a snap anywhere in the cycle", () => {
    const worst = { step: 0, bone: "", frame: -1 };
    for (let f = 0; f < FRAMES; f++) {
      const a = samplePose(walk, f / FRAMES);
      const b = samplePose(walk, (f + 1) / FRAMES); // f+1 == FRAMES wraps to t=1 == t=0
      for (const name of Object.keys(a.angles) as BoneName[]) {
        const d = Math.abs(deg((b.angles[name] as number) - (a.angles[name] as number)));
        if (d > worst.step) Object.assign(worst, { step: d, bone: name, frame: f });
      }
    }
    // No single frame may jump: the seam at t=1→0 is just another span, and a
    // discontinuity there is the classic looping-clip bug.
    expect(worst.step, `${worst.bone} between frames ${worst.frame} and ${worst.frame + 1}`)
      .toBeLessThan(12);
  });
});
