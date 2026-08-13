import { describe, expect, it } from "vitest";

import { samplePose, type PoseSample } from "./clip";
import { BASE_RIG, BONE_NAMES, resolve, type BoneName, type Skeleton } from "../skeleton";
import { idle } from "./idle";

/**
 * The idle is sampled through the same path the renderer uses, at the integer
 * frames the simulation actually asks for. `poseTimeFor` drives it from the
 * global frame plus `port * 27`, so the cycle is entered at an arbitrary phase
 * and every assertion here has to hold at every frame of it rather than at the
 * keys.
 */
const PERIOD = idle.period as number;

function at(frame: number): PoseSample {
  const f = ((frame % PERIOD) + PERIOD) % PERIOD;
  return samplePose(idle, f / PERIOD);
}

/** The pose as the renderer resolves it: rig space, feet at the origin. */
function skeletonOf(s: PoseSample): Skeleton {
  return resolve(BASE_RIG, s.angles, {
    x: s.offsetX,
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
  });
}

const CYCLE = Array.from({ length: PERIOD }, (_, f) => at(f));
const RIGGED = CYCLE.map(skeletonOf);

const degOf = (radians: number) => (radians * 180) / Math.PI;

/** Height above the ground, in rig units — `resolve` hands back screen y, down. */
const heightOf = (sk: Skeleton, bone: BoneName, tip = true) => (tip ? -sk[bone].y1 : -sk[bone].y0);

/** Shortest signed turn between two angles, in degrees. */
function turn(a: number, b: number): number {
  let d = (degOf(b - a) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/**
 * The parts of the body whose timing the eye picks up, each as one number per
 * frame. Angles are accumulated rig-space angles, so a channel moves when the
 * bone moves *in the world* — an arm that counter-rotates exactly as much as
 * the torso beneath it swings is a still arm, and is scored as one.
 */
const CHANNELS: Record<string, readonly number[]> = {
  chest: RIGGED.map((sk) => heightOf(sk, "torso")),
  head: RIGGED.map((sk) => -degOf(sk.head.angle)),
  nearArm: RIGGED.map((sk) => degOf(sk.upperArmR.angle)),
  farArm: RIGGED.map((sk) => degOf(sk.upperArmL.angle)),
};

/**
 * How far each knee sits ahead of its own ankle, in rig units — a soft knee is
 * forward of the foot and a straight one is over it. Measured off the resolved
 * skeleton rather than off the shin angle, because a shin angle only means
 * something next to the thigh it hangs from.
 */
const KNEE_AHEAD = {
  near: RIGGED.map((sk) => sk.shinR.x0 - sk.shinR.x1),
  far: RIGGED.map((sk) => sk.shinL.x0 - sk.shinL.x1),
};

describe("the idle cycle", () => {
  /**
   * The failure mode a two-key idle has: everything reaches its extreme on the
   * same frame, and a cycle with one beat in it is a metronome however small the
   * amplitude. Four parts, four different frames, none of them adjacent.
   */
  it("turns each part of the body round on a different frame", () => {
    const peaks = Object.entries(CHANNELS).map(([name, v]) => [name, argmax(v)] as const);
    const named = Object.fromEntries(peaks);

    for (const [a, fa] of peaks) {
      for (const [b, fb] of peaks) {
        if (a >= b) continue;
        const gap = Math.min(Math.abs(fa - fb), PERIOD - Math.abs(fa - fb));
        expect(gap, `${a} and ${b} both peak around frame ${fa}`).toBeGreaterThan(8);
      }
    }

    // And the lag runs the way a body does: the head is still on its way up when
    // the chest has already started down.
    const chestPeak = named.chest as number;
    expect(CHANNELS.head[chestPeak]).toBeLessThan(CHANNELS.head[named.head as number]);
  });

  /**
   * Every channel has to come back to where it started or the loop ticks once a
   * cycle. Continuity is not just equal endpoints — the step across the seam has
   * to be the size of an ordinary step, or the fighter jumps on the wrap frame.
   */
  it("closes the loop without a step at the seam", () => {
    const steps = Array.from({ length: PERIOD }, (_, f) => maxBoneTurn(at(f), at(f + 1)));
    const seam = maxBoneTurn(at(PERIOD - 1), at(0));
    const typical = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(seam).toBeLessThan(typical * 2);
  });

  /**
   * Twenty other clips end at, or start from, this stance, so it is a contract
   * rather than a pose. Nothing in the cycle may wander far from the average of
   * the cycle — the animation is life inside the stance, not a second stance.
   */
  it("stays inside its own stance all the way round", () => {
    const mean = meanPose();
    for (let f = 0; f < PERIOD; f++) {
      for (const bone of BONE_NAMES) {
        const angle = CYCLE[f].angles[bone] ?? BASE_RIG[bone].angle;
        expect(Math.abs(turn(mean[bone], angle)), `${bone} at frame ${f}`).toBeLessThan(4);
      }
    }
    // The whole silhouette, not just its bones: height and width barely move.
    const crown = RIGGED.map((sk) => heightOf(sk, "head"));
    expect(spread(crown)).toBeLessThan(0.5);
    expect(spread(RIGGED.map((sk) => sk.handR.x1))).toBeLessThan(0.5);
  });

  /**
   * A standing fighter's feet are on the floor. `offsetY` lifts the whole rig,
   * feet included, which is why most of the breath is carried by `scaleY`
   * instead — that stretches about the origin and leaves the soles where they
   * are.
   */
  it("keeps both feet on the ground and under the fighter", () => {
    const rest = skeletonOf(samplePose({ loop: false, keys: [{ t: 0, pose: {} }] }, 0));
    for (let f = 0; f < PERIOD; f++) {
      const sk = RIGGED[f];
      for (const foot of ["footL", "footR"] as const) {
        const lift = heightOf(sk, foot, false) - heightOf(rest, foot, false);
        expect(lift, `${foot} lifted at frame ${f}`).toBeLessThan(0.15);
        expect(lift, `${foot} sunk at frame ${f}`).toBeGreaterThan(-0.05);
        // And it stays under the fighter rather than stepping anywhere.
        const drift = sk[foot].x0 - rest[foot].x0;
        expect(Math.abs(drift), `${foot} drifted at frame ${f}`).toBeLessThan(0.1);
      }
    }
  });

  /**
   * Weight goes somewhere. In a strict profile the two ankles are stacked, so
   * the only honest symptom is the knees trading softness — which means they
   * have to trade it, not share it.
   */
  it("shifts weight from one leg to the other", () => {
    const { near, far } = KNEE_AHEAD;
    expect(spread(near)).toBeGreaterThan(0.05);
    expect(spread(far)).toBeGreaterThan(0.05);

    // Anti-correlated: the frame the near knee is softest is a frame the far
    // knee is straighter than its own average, and the other way round.
    const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(far[argmax(near)]).toBeLessThan(mean(far));
    expect(near[argmax(far)]).toBeLessThan(mean(near));

    // And the shift is its own event: it does not turn round with the breath,
    // which would fold it into the bob and leave the legs decorating it.
    const gap = Math.abs(argmax(near) - argmax(CHANNELS.chest));
    expect(Math.min(gap, PERIOD - gap)).toBeGreaterThan(8);
  });

  /**
   * `smooth` is zero-velocity at both ends of a span, so easing every span would
   * stop every bone in the body at every key — four dead frames a cycle, which
   * is the metronome the extra keys exist to break. Something is always moving.
   */
  it("never holds still long enough to read as a paused game", () => {
    // An eighth of a second is about the shortest stillness an eye can catch,
    // so that is the window: over any eight frames of the cycle, some part of
    // the fighter has visibly moved.
    for (let f = 0; f < PERIOD; f++) {
      expect(maxBoneTurn(at(f), at(f + 8)), `frames ${f}–${f + 8}`).toBeGreaterThan(0.15);
    }
  });

  /**
   * The other side of it: a stance this small has no business moving fast. A
   * degree a frame at 60Hz is a twitch, and a twitch in an idle reads as the
   * renderer glitching rather than as a fighter breathing.
   */
  it("moves slowly enough to read as breathing rather than as a twitch", () => {
    for (let f = 0; f < PERIOD; f++) {
      expect(maxBoneTurn(at(f), at(f + 1)), `frame ${f}`).toBeLessThan(0.5);
    }
  });

  /**
   * Sampled at `port * 27` frames apart, four fighters standing together are at
   * four different phases of this clip, and each of them has to look like a
   * fighter standing there rather than like a fighter mid-anything.
   */
  it("looks like a stance at every port's phase", () => {
    for (const port of [0, 1, 2, 3]) {
      const sk = RIGGED[(port * 27) % PERIOD];
      // Upright: shoulders over the hips, head over the shoulders.
      expect(Math.abs(sk.torso.x1 - sk.hip.x0)).toBeLessThan(0.6);
      expect(Math.abs(sk.head.x1 - sk.torso.x1)).toBeLessThan(0.6);
      // Standing at full height on straight-ish legs.
      expect(heightOf(sk, "head")).toBeGreaterThan(9);
      expect(Math.abs(degOf(sk.shinR.angle - sk.thighR.angle))).toBeLessThan(15);
      // Arms down at the sides: both hands hang below the waist.
      expect(heightOf(sk, "handR")).toBeLessThan(heightOf(sk, "hip"));
      expect(heightOf(sk, "handL")).toBeLessThan(heightOf(sk, "hip"));
    }
  });
});

/** The largest turn any bone makes between two poses, in degrees. */
function maxBoneTurn(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const bone of BONE_NAMES) {
    const from = a.angles[bone] ?? BASE_RIG[bone].angle;
    const to = b.angles[bone] ?? BASE_RIG[bone].angle;
    worst = Math.max(worst, Math.abs(turn(from, to)));
  }
  return worst;
}

/** The cycle's average pose — the stance the clip is a decoration on. */
function meanPose(): Record<BoneName, number> {
  const out = {} as Record<BoneName, number>;
  for (const bone of BONE_NAMES) {
    const sum = CYCLE.reduce((acc, s) => acc + (s.angles[bone] ?? BASE_RIG[bone].angle), 0);
    out[bone] = sum / CYCLE.length;
  }
  return out;
}
