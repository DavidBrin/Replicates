import { describe, expect, it } from "vitest";

import { TURNAROUND_FRAMES } from "@/engine/states";
import { BASE_RIG, deg, resolve, type BoneName } from "../skeleton";
import { angleDelta, samplePose, type PoseSample } from "./clip";
import { idle } from "./idle";
import { poseTimeFor } from "./timing";
import { turn } from "./turn";
import { makeFighter } from "../testFixtures";

const DEG = 180 / Math.PI;

/**
 * The eleven poses the game actually draws, taken through `poseTimeFor` rather
 * than by dividing by eleven here — the whole point of the clip is that it is
 * sampled at those instants and no others, and a test that computed its own
 * frame times could not notice if that stopped being true.
 */
const FRAMES: readonly PoseSample[] = Array.from({ length: TURNAROUND_FRAMES }, (_, f) =>
  samplePose(turn, poseTimeFor("turn", makeFighter({ action: "turnaround", actionFrame: f }), 0)),
);

const BONES: readonly BoneName[] = [
  "hip", "torso", "head",
  "thighR", "shinR", "footR",
  "thighL", "shinL", "footL",
  "upperArmR", "forearmR",
  "upperArmL", "forearmL",
];

/** A bone's angle in degrees, falling back to the rig's rest angle. */
function angle(s: PoseSample, bone: BoneName): number {
  return (s.angles[bone] ?? BASE_RIG[bone].angle) * DEG;
}

/** Angle accumulated down a chain, which is what the eye sees. */
function chain(s: PoseSample, ...bones: BoneName[]): number {
  return bones.reduce((sum, b) => sum + angle(s, b), 0);
}

/** How far apart two drawings are, summed over every bone, in degrees. */
function poseDistance(a: PoseSample, b: PoseSample): number {
  return BONES.reduce(
    (sum, bone) => sum + Math.abs(angleDelta(angle(a, bone) / DEG, angle(b, bone) / DEG)) * DEG,
    0,
  );
}

/**
 * Height of the lowest point of either foot above the ground line, in rig
 * units. `offsetY` raises the whole fighter and the rig's own y is scaled, which
 * is exactly what the renderer does with the two of them.
 */
function groundClearance(s: PoseSample): number {
  const sk = resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    facing: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
  });
  const low = Math.max(sk.footR.y1, sk.footL.y1, sk.footR.y0, sk.footL.y0);
  return -low + s.offsetY;
}

const widths = FRAMES.map((s) => s.scaleX);
const narrowest = widths.indexOf(Math.min(...widths));

/** The standing loop, all the way round it, because the hand-off can land anywhere. */
const STAND: readonly PoseSample[] = Array.from({ length: 8 }, (_, i) => samplePose(idle, i / 8));

describe("the pivot", () => {
  it("is eleven distinct drawings, not one held pose", () => {
    expect(FRAMES).toHaveLength(11);
    for (let f = 1; f < FRAMES.length; f++) {
      // The tightest real gap in the clip is about 55°, spread over thirteen
      // bones. Less than half of that is still a different drawing; anything
      // under it is a frame the eye would see twice.
      expect(poseDistance(FRAMES[f - 1], FRAMES[f]), `frames ${f - 1} and ${f}`).toBeGreaterThan(24);
    }
  });

  /**
   * The animation's whole job. The renderer mirrors by facing and the facing has
   * already flipped, so the only way a body can be part-way round is to be
   * narrower than a body square to the camera.
   */
  it("squeezes to edge-on in the middle and is square-on at both ends", () => {
    expect(widths[0]).toBeCloseTo(1, 1);
    expect(widths[widths.length - 1]).toBeCloseTo(1, 1);

    // Narrowest inside the middle third of the eleven frames.
    expect(narrowest).toBeGreaterThanOrEqual(Math.floor(TURNAROUND_FRAMES / 3));
    expect(narrowest).toBeLessThan(Math.ceil((TURNAROUND_FRAMES * 2) / 3));

    // Far enough to read as a turn rather than as a fighter breathing in.
    expect(widths[narrowest]).toBeLessThan(0.6);
  });

  it("closes and reopens once, with no second squeeze", () => {
    for (let f = 1; f <= narrowest; f++) {
      expect(widths[f], `frame ${f} should be narrower than ${f - 1}`).toBeLessThan(widths[f - 1]);
    }
    for (let f = narrowest + 1; f < FRAMES.length; f++) {
      expect(widths[f], `frame ${f} should be wider than the narrowest`).toBeGreaterThan(
        widths[narrowest],
      );
    }
    // And it gets all the way back: somewhere after the middle the body is at
    // least as wide as it started.
    expect(Math.max(...widths.slice(narrowest))).toBeGreaterThanOrEqual(widths[0]);
  });

  /**
   * The body starts committed to the direction it came from and ends committed
   * to the one it is now facing, and passes through upright exactly once on the
   * way. Two crossings would be a wobble; none would be a fighter who never
   * turned.
   */
  it("carries the lean through from the old direction to the new one", () => {
    const leans = FRAMES.map((s) => chain(s, "hip", "torso"));
    expect(leans[0]).toBeLessThan(-10);
    expect(leans[leans.length - 1]).toBeGreaterThan(0);

    const crossings = leans.filter((v, i) => i > 0 && Math.sign(v) !== Math.sign(leans[i - 1]));
    expect(crossings).toHaveLength(1);

    // And it happens while the body is side-on, not while it is square to the
    // camera — that is the difference between turning and leaning over.
    const at = leans.findIndex((v, i) => i > 0 && Math.sign(v) !== Math.sign(leans[i - 1]));
    expect(widths[at]).toBeLessThan(0.7);
  });

  /**
   * Knees bend backwards on a fighter facing away and forwards on one facing
   * you, so both shins have to invert somewhere in eleven frames. The squeeze
   * exists to cover it: at full width an inverting knee is a broken leg.
   */
  it("inverts both knees only while the body is too narrow to show it", () => {
    // Up to the catch, which is the widest the fighter gets. What the legs do
    // between there and the stand is the settle's business, and the rig's own
    // rest pose carries a couple of degrees of hyperextension anyway.
    const catchFrame = widths.indexOf(Math.max(...widths));
    expect(catchFrame).toBeGreaterThan(narrowest);

    for (const shin of ["shinR", "shinL"] as const) {
      const path = FRAMES.slice(0, catchFrame + 1).map((s) => angle(s, shin));
      expect(path[0], `${shin} starts bent the other way`).toBeLessThan(0);
      expect(path[path.length - 1], `${shin} ends bent towards the camera`).toBeGreaterThan(0);

      const flips = path
        .map((v, i) => (i > 0 && Math.sign(v) !== Math.sign(path[i - 1]) ? i : -1))
        .filter((i) => i > 0);
      expect(flips, `${shin} should invert once`).toHaveLength(1);
      expect(widths[flips[0]], `${shin} inverts at frame ${flips[0]}`).toBeLessThan(0.7);
    }
  });

  /**
   * A pivot turns the body over a foot that stays where it is. The right foot is
   * the one that is planted when the state begins, and it points the same way on
   * frame 10 as on frame 0 — which is also where `BASE_RIG` rests it, so the
   * stand the fighter drops into is the one the pivot left them in.
   */
  it("never swivels the planted foot", () => {
    const heading = FRAMES.map((s) => chain(s, "hip", "thighR", "shinR", "footR"));
    expect(Math.max(...heading) - Math.min(...heading)).toBeLessThan(45);
    expect(Math.abs(angleDelta(heading[0] / DEG, heading[heading.length - 1] / DEG)) * DEG).toBeLessThan(15);

    // The other foot swings round with the leg, but it is a step, not a spin.
    const swing = FRAMES.map((s) => chain(s, "hip", "thighL", "shinL", "footL"));
    expect(Math.max(...swing) - Math.min(...swing)).toBeLessThan(60);
  });

  /**
   * A fighter mid-stride is off the ground and a fighter braking is not. Frame 0
   * inherits the run's airborne stride; from the plant onwards a foot is on the
   * floor, give or take the give in it.
   */
  it("plants a foot by the third frame and keeps it down", () => {
    expect(groundClearance(FRAMES[0])).toBeGreaterThan(0.5);
    for (let f = 2; f < FRAMES.length; f++) {
      const clearance = groundClearance(FRAMES[f]);
      expect(clearance, `frame ${f} floats`).toBeLessThan(0.35);
      expect(clearance, `frame ${f} sinks`).toBeGreaterThan(-0.35);
    }
  });

  /**
   * `turnaround` hands straight over to `stand` and nothing blends between
   * clips, so whatever is left on frame 10 is a snap — and it has to be a small
   * one at *every* phase of the standing loop, because `poseTimeFor` drives idle
   * from the global frame and the fighter arrives wherever the breath happens to
   * be. Hence the whole cycle here rather than its first key.
   */
  it("settles into the stand instead of snapping into it", () => {
    const last = FRAMES[FRAMES.length - 1];

    for (const stand of STAND) {
      for (const bone of BONES) {
        const target = stand.angles[bone] ?? BASE_RIG[bone].angle;
        const off = Math.abs(angleDelta(angle(last, bone) / DEG, target)) * DEG;
        expect(off, `${bone} is ${off.toFixed(1)}° from the stand`).toBeLessThan(8);
      }
      expect(Math.abs(last.offsetY - stand.offsetY)).toBeLessThan(0.12);
      expect(Math.abs(last.scaleY - stand.scaleY)).toBeLessThan(0.05);
    }
    expect(last.offsetX).toBeCloseTo(0, 1);
    expect(last.scaleX).toBeCloseTo(1, 1);
  });

  it("starts from the run rather than from the stand", () => {
    // Frame 0 is the drawing the run was making, reflected: whatever else it is,
    // it is nothing like the pose the clip finishes in.
    for (const stand of STAND) {
      expect(poseDistance(FRAMES[0], stand)).toBeGreaterThan(200);
    }
    // A stride, not a stance — the feet are a long way apart along the ground.
    const sk = resolve(BASE_RIG, FRAMES[0].angles, { x: 0, y: 0, scale: 1, facing: 1 });
    expect(Math.abs(sk.footR.x1 - sk.footL.x1)).toBeGreaterThan(2.5);
  });

  it("keeps every authored angle within a turn of the rig, so nothing lerps the long way", () => {
    for (const key of turn.keys) {
      for (const bone of Object.keys(key.pose) as BoneName[]) {
        expect(Math.abs((key.pose[bone] as number) - BASE_RIG[bone].angle), bone).toBeLessThan(
          deg(360),
        );
      }
    }
  });
});
