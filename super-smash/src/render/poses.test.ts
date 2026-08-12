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

  it("gives the walk cycle four keys", () => {
    expect(POSE_LIBRARY.walk.keys).toHaveLength(4);
    expect(POSE_LIBRARY.walk.loop).toBe(true);
  });

  /**
   * Every clip that declares a strike is an attack, and every attack has the
   * same four-beat shape: anticipate, hit, follow through, settle. The
   * follow-through key is the one that is easy to leave out and impossible to
   * miss once it is gone — without it the recovery is a single ease from the
   * extension to the rest pose, which across a forward smash's thirty recovery
   * frames is well under a degree a frame and reads as a frozen fighter.
   */
  it("gives every attack a strike key on the beat it claims, and a follow-through after it", () => {
    const attacks = names.filter((n) => POSE_LIBRARY[n].strike !== undefined);
    expect(attacks.length).toBeGreaterThan(15);

    for (const name of attacks) {
      const clip = POSE_LIBRARY[name];
      const strike = clip.strike as number;
      // The strike lands in the first half — the rest is recovery.
      expect(strike, name).toBeLessThan(0.5);

      const keys = clip.keys;
      const strikeIndex = keys.findIndex((k) => Math.abs(k.t - strike) < 1e-9);
      expect(strikeIndex, `${name} declares strike ${strike} but has no key there`).toBeGreaterThan(0);

      // Accelerate into the hit, decelerate out of it.
      expect(keys[strikeIndex - 1].ease, name).toBe("in");
      expect(keys[strikeIndex].ease, name).toBe("out");

      // At least one key between the strike and the end, and the end itself.
      expect(keys.length - strikeIndex, `${name} has no follow-through`).toBeGreaterThanOrEqual(3);
      expect(keys[keys.length - 1].t, name).toBe(1);
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
    const noHitboxes = { total: 44, firstActive: -1, lastActive: -1 };
    expect(poseTimeFor("fsmash", f, 0, noHitboxes)).toBeCloseTo(0.5, 9);
    expect(
      poseTimeFor("jab", { ...f, actionFrame: 9 }, 0, { total: 18, firstActive: -1, lastActive: -1 }),
    ).toBeCloseTo(0.5, 9);
  });

  it("parks a charging smash on its wind-up", () => {
    const f = makeFighter({ action: "attack", move: "fsmash", actionFrame: 40, charge: 25 });
    expect(poseTimeFor("fsmash", f, 0, { total: 44, firstActive: 15, lastActive: 17 })).toBeLessThan(
      POSE_LIBRARY.fsmash.strike as number,
    );
  });

  /**
   * The one that matters. A shared clip can only serve every move in the game
   * if its extension lands on the frame the hitbox goes live — and the failure
   * when it does not is silent, because the fighter is still animating and
   * damage is still being dealt, just not at the same time.
   */
  it("puts full extension on the frame the hitbox goes live, whatever the frame data", () => {
    const shapes = [
      { total: 47, firstActive: 15 }, // Mario's forward smash
      { total: 20, firstActive: 2 }, // a jab
      { total: 60, firstActive: 44 }, // a slow, late-hitting swing
      { total: 9, firstActive: 3 }, // about as short as a move gets
    ];
    for (const shape of shapes) {
      const timing = { ...shape, lastActive: shape.firstActive + 2 };
      const f = makeFighter({ action: "attack", move: "fsmash", actionFrame: shape.firstActive });
      expect(poseTimeFor("fsmash", f, 0, timing)).toBeCloseTo(
        POSE_LIBRARY.fsmash.strike as number,
        9,
      );
    }
  });

  it("holds the clip monotonic across the join, so nothing snaps backwards", () => {
    const timing = { total: 47, firstActive: 15, lastActive: 17 };
    let previous = -1;
    for (let frame = 0; frame <= timing.total; frame++) {
      const t = poseTimeFor("fsmash", makeFighter({ action: "attack", move: "fsmash", actionFrame: frame }), 0, timing);
      expect(t).toBeGreaterThanOrEqual(previous);
      previous = t;
    }
    expect(previous).toBeCloseTo(1, 9);
  });

  it("falls back to the plain ratio for a move that is live on its first frame", () => {
    // Nothing to stretch: there is no wind-up, so anchoring would divide by zero
    // and — worse — would put the extension on frame 0 of every such move.
    const timing = { total: 30, firstActive: 0, lastActive: 4 };
    const f = makeFighter({ action: "attack", move: "fsmash", actionFrame: 15 });
    expect(poseTimeFor("fsmash", f, 0, timing)).toBeCloseTo(0.5, 9);
  });

  it("accelerates into the strike rather than easing into it", () => {
    // Halfway through the wind-up in *time*, an attack should be well short of
    // halfway there in *space*. A smoothstepped wind-up is at exactly half, and
    // that is what made every attack read as a fighter drifting into position.
    const clip = POSE_LIBRARY.fsmash;
    const strike = clip.strike as number;
    const start = samplePose(clip, 0);
    const mid = samplePose(clip, strike / 2);
    const end = samplePose(clip, strike);
    const travelled = Math.abs(angleDelta(start.angles.upperArmR as number, mid.angles.upperArmR as number));
    const total = Math.abs(angleDelta(start.angles.upperArmR as number, end.angles.upperArmR as number));
    expect(travelled / total).toBeLessThan(0.25);
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
