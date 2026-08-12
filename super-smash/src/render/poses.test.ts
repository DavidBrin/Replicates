import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { ActionState, MoveSlot } from "@/engine/types";
import {
  POSE_LIBRARY,
  angleDelta,
  blendSamples,
  lerpAngle,
  poseNameFor,
  poseTimeFor,
  samplePose,
  samplePoseForFighter,
  smoothstep,
  type PoseName,
} from "./poses";
import { makeFighter } from "./testFixtures";
import type { BoneName } from "./skeleton";

const TAU = Math.PI * 2;

/** Are two angles the same direction, ignoring full turns? */
function sameDirection(a: number, b: number): boolean {
  return Math.abs(angleDelta(a, b)) < 1e-9;
}

describe("angle interpolation", () => {
  it("always takes the short way round", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (a, b) => {
          const d = angleDelta(a, b);
          expect(d).toBeGreaterThan(-Math.PI - 1e-9);
          expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
          // The delta is a genuine route from a to b, modulo full turns.
          expect(sameDirection(a + d, b)).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("never travels further than half a turn over a whole interpolation", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b, t) => {
          const v = lerpAngle(a, b, t);
          expect(Math.abs(v - a)).toBeLessThanOrEqual(Math.PI + 1e-9);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("hits both endpoints exactly", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (a, b) => {
          expect(lerpAngle(a, b, 0)).toBeCloseTo(a, 9);
          expect(sameDirection(lerpAngle(a, b, 1), b)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("crosses the wrap point the short way — 350° to 10° goes up through 0", () => {
    const from = (350 * Math.PI) / 180;
    const to = (10 * Math.PI) / 180;
    const mid = lerpAngle(from, to, 0.5);
    // Equivalent to 0°, not to 180°.
    expect(Math.abs(angleDelta(mid, 0))).toBeLessThan(1e-9);
  });

  it("is monotonic along the chosen arc", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -6, max: 6, noNaN: true }),
        fc.double({ min: -6, max: 6, noNaN: true }),
        (a, b) => {
          const d = angleDelta(a, b);
          let prev = -Infinity;
          for (let i = 0; i <= 10; i++) {
            const travelled = (lerpAngle(a, b, i / 10) - a) * Math.sign(d || 1);
            expect(travelled).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = travelled;
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("smoothstep", () => {
  it("is clamped, symmetric and flat at both ends", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 9);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
    // Zero velocity at the ends: the first step is much smaller than the middle.
    expect(smoothstep(0.05)).toBeLessThan(0.05);
    expect(smoothstep(0.55) - smoothstep(0.45)).toBeGreaterThan(0.1);
  });
});

describe("the library", () => {
  const names = Object.keys(POSE_LIBRARY) as PoseName[];

  it("has a clip for every pose name, all with sorted keys in [0,1]", () => {
    expect(names.length).toBeGreaterThanOrEqual(40);
    for (const name of names) {
      const clip = POSE_LIBRARY[name];
      expect(clip.keys.length).toBeGreaterThan(0);
      let last = -1;
      for (const k of clip.keys) {
        expect(k.t).toBeGreaterThanOrEqual(0);
        expect(k.t).toBeLessThanOrEqual(1);
        expect(k.t).toBeGreaterThan(last);
        last = k.t;
      }
    }
  });

  it("gives the walk cycle four keys and the attacks their anticipation key", () => {
    expect(POSE_LIBRARY.walk.keys).toHaveLength(4);
    expect(POSE_LIBRARY.walk.loop).toBe(true);
    for (const attack of ["jab", "ftilt", "fsmash", "fair", "dsmash", "upB"] as PoseName[]) {
      expect(POSE_LIBRARY[attack].keys.length).toBe(3);
      // The strike lands in the first half — the rest is recovery.
      expect(POSE_LIBRARY[attack].keys[1].t).toBeLessThan(0.5);
    }
  });

  it("makes idle breathe — the two keys differ", () => {
    const a = samplePose(POSE_LIBRARY.idle, 0);
    const b = samplePose(POSE_LIBRARY.idle, 0.5);
    expect(a.offsetY).not.toBeCloseTo(b.offsetY, 3);
    expect(a.angles.torso).not.toBeCloseTo(b.angles.torso as number, 3);
  });

  it("produces finite angles everywhere in every clip", () => {
    for (const name of names) {
      for (let i = 0; i <= 20; i++) {
        const s = samplePose(POSE_LIBRARY[name], i / 20);
        for (const bone of Object.keys(s.angles) as BoneName[]) {
          expect(Number.isFinite(s.angles[bone])).toBe(true);
        }
        expect(Number.isFinite(s.offsetX)).toBe(true);
        expect(Number.isFinite(s.offsetY)).toBe(true);
        expect(Number.isFinite(s.rotation)).toBe(true);
        expect(s.scaleX).toBeGreaterThan(0);
        expect(s.scaleY).toBeGreaterThan(0);
      }
    }
  });
});

describe("sampling", () => {
  it("returns a keyframe unchanged at its own time", () => {
    const clip = POSE_LIBRARY.fsmash;
    const strike = clip.keys[1];
    const s = samplePose(clip, strike.t);
    expect(s.angles.upperArmR).toBeCloseTo(strike.pose.upperArmR as number, 9);
  });

  it("wraps a looping clip and clamps a non-looping one", () => {
    const loopA = samplePose(POSE_LIBRARY.walk, 0.25);
    const loopB = samplePose(POSE_LIBRARY.walk, 1.25);
    expect(loopB.angles.thighR).toBeCloseTo(loopA.angles.thighR as number, 9);

    const endA = samplePose(POSE_LIBRARY.jab, 1);
    const endB = samplePose(POSE_LIBRARY.jab, 4);
    expect(endB.angles.upperArmR).toBeCloseTo(endA.angles.upperArmR as number, 9);
  });

  it("interpolates the loop's last key back around to its first", () => {
    const s = samplePose(POSE_LIBRARY.walk, 0.875);
    const last = POSE_LIBRARY.walk.keys[3].pose.thighR as number;
    const first = POSE_LIBRARY.walk.keys[0].pose.thighR as number;
    const lo = Math.min(last, first);
    const hi = Math.max(last, first);
    expect(s.angles.thighR).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(s.angles.thighR).toBeLessThanOrEqual(hi + 1e-6);
  });

  it("holds a bone that only one of the two keys names", () => {
    const clip = {
      loop: false,
      keys: [
        { t: 0, pose: { torso: 0.4, handR: 1.2 } },
        { t: 1, pose: { torso: 0.8 } },
      ],
    };
    const s = samplePose(clip, 0.5);
    expect(s.angles.handR).toBeCloseTo(1.2, 9);
    expect(s.angles.torso).toBeGreaterThan(0.4);
  });

  it("blends two samples", () => {
    const a = samplePose(POSE_LIBRARY.idle, 0);
    const b = samplePose(POSE_LIBRARY.shield, 0);
    const mid = blendSamples(a, b, 0.5);
    expect(mid.offsetY).toBeCloseTo((a.offsetY + b.offsetY) / 2, 9);
  });
});

describe("state to pose", () => {
  const ACTIONS: ActionState[] = [
    "stand", "walk", "dashStart", "run", "runBrake", "turnaround",
    "crouchStart", "crouch", "crouchEnd", "jumpSquat", "jump", "fall",
    "land", "landingLag", "attack", "special", "grab", "grabHold", "pummel",
    "throw", "shieldStart", "shield", "shieldRelease", "shieldStun",
    "shieldBroken", "spotDodge", "roll", "airDodge", "hitstun", "tumble",
    "grabbed", "thrown", "downed", "getUp", "ledgeHang", "ledgeGetUp",
    "ledgeAttack", "ledgeRoll", "ledgeJump", "respawnPlatform", "dead", "entering",
  ];

  it("maps every action state onto a clip that exists", () => {
    for (const action of ACTIONS) {
      const name = poseNameFor(action, "jab1");
      expect(POSE_LIBRARY[name], `no clip for ${action}`).toBeDefined();
    }
  });

  const SLOTS: MoveSlot[] = [
    "jab1", "jab2", "jab3", "rapidJab", "ftilt", "utilt", "dtilt", "dashAttack",
    "fsmash", "usmash", "dsmash", "nair", "fair", "bair", "uair", "dair",
    "neutralB", "sideB", "upB", "downB", "grab", "dashGrab", "pummel",
    "fthrow", "bthrow", "uthrow", "dthrow", "ledgeAttack", "getUpAttack", "finalSmash",
  ];

  it("maps every move slot onto a clip that exists", () => {
    for (const slot of SLOTS) {
      const name = poseNameFor("attack", slot);
      expect(POSE_LIBRARY[name], `no clip for ${slot}`).toBeDefined();
    }
  });

  it("times an attack against its own frame data, not a fixed duration", () => {
    const f = makeFighter({ action: "attack", move: "fsmash", actionFrame: 22 });
    expect(poseTimeFor("fsmash", f, 0, 44)).toBeCloseTo(0.5, 9);
    expect(poseTimeFor("jab", { ...f, actionFrame: 9 }, 0, 18)).toBeCloseTo(0.5, 9);
  });

  it("parks a charging smash on its wind-up", () => {
    const f = makeFighter({ action: "attack", move: "fsmash", actionFrame: 40, charge: 25 });
    expect(poseTimeFor("fsmash", f, 0, 44)).toBeLessThan(0.2);
  });

  it("desynchronises idle breathing between ports", () => {
    const p0 = poseTimeFor("idle", makeFighter({ port: 0 }), 0);
    const p1 = poseTimeFor("idle", makeFighter({ port: 1 }), 0);
    expect(p0).not.toBeCloseTo(p1, 3);
  });

  it("drives the walk from the action frame so it starts on a contact key", () => {
    expect(poseTimeFor("walk", makeFighter({ actionFrame: 0 }), 500)).toBe(0);
  });

  it("samples a whole fighter without needing move data", () => {
    const s = samplePoseForFighter(makeFighter({ action: "tumble", actionFrame: 13 }), 200);
    expect(Number.isFinite(s.rotation)).toBe(true);
    expect(Object.keys(s.angles).length).toBeGreaterThan(4);
  });
});

describe("angle range", () => {
  it("keeps every authored angle inside two turns, so nothing lerps the long way by accident", () => {
    for (const name of Object.keys(POSE_LIBRARY) as PoseName[]) {
      for (const key of POSE_LIBRARY[name].keys) {
        for (const bone of Object.keys(key.pose) as BoneName[]) {
          expect(Math.abs(key.pose[bone] as number)).toBeLessThan(2 * TAU);
        }
      }
    }
  });
});
