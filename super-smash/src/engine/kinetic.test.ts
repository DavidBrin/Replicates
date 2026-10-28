import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticExec,
  kineticJump,
  kineticLaunch,
  kineticSet,
  kineticSetX,
  kineticSetY,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
import type { KineticState, KineticType } from "./kinetic";
import { paramsFromAttributes } from "./params";
import {
  airDrift,
  applyGravity,
  applyTraction,
  initialDashVelocity,
  runVelocity,
  walkVelocity,
} from "./physics";
import type { FighterAttributes, FighterState } from "./types";

/** Only the fields the KineticModule touches; the rest of a fighter is irrelevant here. */
function body(k: Partial<KineticState> = {}, over: Partial<FighterState> = {}): FighterState {
  return {
    vx: 0,
    vy: 0,
    launchSpeed: 0,
    kinetic: { ...emptyKinetic(), ...k },
    ...over,
  } as FighterState;
}

describe("energy sum", () => {
  it("adds CONTROL, STOP, MOTION and DAMAGE horizontally", () => {
    const f = body({ controlX: fx(1), stopX: fx(0.5), motionX: fx(2), damageX: -fx(0.25) });
    expect(kineticSumX(f)).toBe(fx(1) + fx(0.5) + fx(2) - fx(0.25));
  });

  it("adds GRAVITY, MOTION and DAMAGE vertically", () => {
    const f = body({ gravityY: -fx(1), motionY: fx(3), damageY: fx(0.5) });
    expect(kineticSumY(f)).toBe(-fx(1) + fx(3) + fx(0.5));
  });

  it("writes the sum back to vx/vy", () => {
    const f = body({ controlX: fx(1), gravityY: -fx(2) });
    kineticSum(f);
    expect([f.vx, f.vy]).toEqual([fx(1), -fx(2)]);
  });
});

describe("adopting a direct write", () => {
  it("is the identity when vx/vy already equal the sum", () => {
    const f = body({ controlX: fx(1), gravityY: fx(2) }, { vx: fx(1), vy: fx(2) });
    kineticAdopt(f);
    expect(f.kinetic).toEqual({ ...emptyKinetic(), controlX: fx(1), gravityY: fx(2) });
  });

  it("puts a horizontal write on the carrier it is told to, and on nothing else", () => {
    const toControl = body({}, { vx: fx(3) });
    kineticAdopt(toControl, "control");
    expect(toControl.kinetic).toEqual({ ...emptyKinetic(), controlX: fx(3) });
    const toStop = body({}, { vx: fx(3) });
    kineticAdopt(toStop, "stop");
    expect(toStop.kinetic).toEqual({ ...emptyKinetic(), stopX: fx(3) });
  });

  it("defaults the horizontal carrier to CONTROL", () => {
    const f = body({}, { vx: fx(3) });
    kineticAdopt(f);
    expect(f.kinetic).toEqual({ ...emptyKinetic(), controlX: fx(3) });
  });

  it("puts a vertical write on GRAVITY, and on nothing else", () => {
    const f = body({}, { vy: -fx(2) });
    kineticAdopt(f);
    expect(f.kinetic).toEqual({ ...emptyKinetic(), gravityY: -fx(2) });
  });

  it("adds only the difference, leaving MOTION and DAMAGE where they were", () => {
    const f = body(
      { motionX: fx(1), damageX: fx(1), motionY: fx(1), damageY: fx(1) },
      { vx: fx(4), vy: fx(5) },
    );
    kineticAdopt(f, "stop");
    expect(f.kinetic).toEqual({
      ...emptyKinetic(),
      motionX: fx(1),
      damageX: fx(1),
      motionY: fx(1),
      damageY: fx(1),
      stopX: fx(2), // 4 - (1 + 1)
      gravityY: fx(3), // 5 - (1 + 1)
    });
  });

  it("always restores vx/vy == sum, landing the difference on exactly one carrier per axis", () => {
    const q12 = fc.integer({ min: -fx(50), max: fx(50) });
    fc.assert(
      fc.property(q12, q12, q12, q12, q12, q12, q12, q12, q12, fc.boolean(), (cx, sx, gy, mx, my, dmx, dmy, vx, vy, stop) => {
        const f = body(
          { controlX: cx, stopX: sx, gravityY: gy, motionX: mx, motionY: my, damageX: dmx, damageY: dmy },
          { vx, vy },
        );
        const diffX = vx - (cx + sx + mx + dmx);
        const diffY = vy - (gy + my + dmy);
        kineticAdopt(f, stop ? "stop" : "control");
        expect(f.kinetic).toEqual({
          ...emptyKinetic(),
          controlX: cx + (stop ? 0 : diffX),
          stopX: sx + (stop ? diffX : 0),
          gravityY: gy + diffY,
          motionX: mx,
          motionY: my,
          damageX: dmx,
          damageY: dmy,
        });
        expect(kineticSumX(f)).toBe(vx);
        expect(kineticSumY(f)).toBe(vy);
      }),
    );
  });
});

describe("clearing", () => {
  it("zeroes every energy, the launch and the velocity", () => {
    const f = body(
      { controlX: 1, stopX: 2, gravityY: 3, motionX: 4, motionY: 5, damageX: 6, damageY: 7, fallFrames: 8, jumpInitial: 2 },
      { vx: 9, vy: 9, launchSpeed: 9 },
    );
    kineticClear(f);
    expect(f.kinetic).toEqual(emptyKinetic());
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([0, 0, 0]);
  });
});

/* ------------------------------ setting a velocity outright (Task 4) -- */

/** A fighter mid-launch with every energy in use, its `vx`/`vy` already the sum. */
function loaded(): FighterState {
  const f = body(
    { controlX: fx(1), stopX: fx(0.5), gravityY: -fx(2), motionX: fx(0.25), motionY: fx(0.75), damageX: fx(3), damageY: fx(4) },
    { launchSpeed: fx(5) },
  );
  kineticSum(f);
  return f;
}

describe("setting a velocity outright", () => {
  it("kineticSetX puts vx on CONTROL by default and zeroes every other horizontal energy", () => {
    const f = loaded();
    kineticSetX(f, fx(1.5));
    expect(f.kinetic).toMatchObject({ controlX: fx(1.5), stopX: 0, motionX: 0, damageX: 0 });
    expect(f.vx).toBe(fx(1.5));
  });

  it("kineticSetX puts vx on STOP when told to", () => {
    const f = loaded();
    kineticSetX(f, -fx(0.5), "stop");
    expect(f.kinetic).toMatchObject({ controlX: 0, stopX: -fx(0.5), motionX: 0, damageX: 0 });
    expect(f.vx).toBe(-fx(0.5));
  });

  it("kineticSetX leaves every vertical energy, the launch speed and vy alone", () => {
    const f = loaded();
    const before = { ...f.kinetic };
    const vy = f.vy;
    kineticSetX(f, 0);
    expect(f.kinetic).toMatchObject({
      gravityY: before.gravityY,
      motionY: before.motionY,
      damageY: before.damageY,
      fallFrames: before.fallFrames,
      jumpInitial: before.jumpInitial,
    });
    expect(f.vy).toBe(vy);
    expect(f.launchSpeed).toBe(fx(5));
  });

  it("kineticSetY puts vy on GRAVITY and zeroes MOTION and DAMAGE vertically", () => {
    const f = loaded();
    kineticSetY(f, fx(2.5));
    expect(f.kinetic).toMatchObject({ gravityY: fx(2.5), motionY: 0, damageY: 0 });
    expect(f.vy).toBe(fx(2.5));
  });

  it("kineticSetY leaves every horizontal energy, the launch speed and vx alone", () => {
    const f = loaded();
    const before = { ...f.kinetic };
    const vx = f.vx;
    kineticSetY(f, 0);
    expect(f.kinetic).toMatchObject({
      controlX: before.controlX,
      stopX: before.stopX,
      motionX: before.motionX,
      damageX: before.damageX,
    });
    expect(f.vx).toBe(vx);
    expect(f.launchSpeed).toBe(fx(5));
  });

  it("kineticSet sets both axes, on the carrier it is given", () => {
    const toControl = loaded();
    kineticSet(toControl, fx(1), -fx(1));
    expect(toControl.kinetic).toEqual({
      ...emptyKinetic(),
      controlX: fx(1),
      gravityY: -fx(1),
    });
    expect([toControl.vx, toControl.vy]).toEqual([fx(1), -fx(1)]);

    const toStop = loaded();
    kineticSet(toStop, fx(1), -fx(1), "stop");
    expect(toStop.kinetic).toEqual({ ...emptyKinetic(), stopX: fx(1), gravityY: -fx(1) });
    expect([toStop.vx, toStop.vy]).toEqual([fx(1), -fx(1)]);
  });

  it("kineticSet(0, 0) stops the fighter without ending the launch", () => {
    const f = loaded();
    kineticSet(f, 0, 0);
    expect([f.vx, f.vy]).toEqual([0, 0]);
    expect(f.launchSpeed).toBe(fx(5));
  });

  it("kineticJump replaces the vertical speed and ends the launch, keeping its horizontal part as drift", () => {
    const f = loaded();
    const vxBefore = f.vx;
    kineticJump(f, fx(2.5));
    expect(f.kinetic).toMatchObject({
      controlX: fx(1) + fx(3), // CONTROL took the launch's horizontal part
      damageX: 0,
      gravityY: fx(2.5),
      motionY: 0,
      damageY: 0,
    });
    expect(f.vx).toBe(vxBefore); // the fighter does not slow down sideways
    expect(f.vy).toBe(fx(2.5));
    expect(f.launchSpeed).toBe(0);
  });

  it("kineticJump with no launch moves nothing sideways", () => {
    const f = body({ controlX: fx(1), gravityY: -fx(1) });
    kineticSum(f);
    f.launchSpeed = fx(5); // stale: a jump zeroes it whatever the energies say
    kineticJump(f, fx(2));
    expect(f.kinetic).toMatchObject({ controlX: fx(1), damageX: 0, gravityY: fx(2) });
    expect([f.vx, f.vy]).toEqual([fx(1), fx(2)]);
    expect(f.launchSpeed).toBe(0);
  });

  it("kineticLaunch replaces the whole velocity and records the launch's magnitude", () => {
    const f = loaded();
    kineticLaunch(f, -fx(1.5), fx(2), fx(2.5));
    expect(f.kinetic).toEqual({ ...emptyKinetic(), controlX: -fx(1.5), gravityY: fx(2) });
    expect([f.vx, f.vy]).toEqual([-fx(1.5), fx(2)]);
    expect(f.launchSpeed).toBe(fx(2.5));
  });

  it("kineticLaunch(0, 0, speed) is a launch with no direction: still at rest, the speed still recorded", () => {
    const f = loaded();
    kineticLaunch(f, 0, 0, fx(1));
    expect([f.vx, f.vy]).toEqual([0, 0]);
    expect(f.launchSpeed).toBe(fx(1));
  });
});

/* ------------------------------------------- legacy equivalence (Task 3) -- */

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.155),
  initialDashSpeed: fx(1.936),
  runSpeed: fx(1.76),
  airSpeed: fx(1.208),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.07),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.102),
  fullHopVelocity: fx(2.514),
  shortHopVelocity: fx(1.747),
  airJumpVelocity: fx(2.514),
  jumps: 2,
  canWallJump: true,
  width: fx(2),
  height: fx(11),
  jumpSquatFrames: 3,
};
const PARAMS = paramsFromAttributes(ATTRS);

/** The pre-Plan-2 `applyMovement` switch and gravity block, on one vx/vy. */
function legacy(type: KineticType, f: FighterState, stickX: number, holdVertical: boolean): [number, number] {
  let vx = f.vx;
  let vy = f.vy;
  switch (type) {
    case "WALK":
      vx = walkVelocity(vx, stickX, ATTRS);
      break;
    case "DASH":
      vx = f.actionFrame <= 1 ? initialDashVelocity(f.facing, ATTRS) : runVelocity(vx, f.facing, ATTRS);
      break;
    case "RUN":
      vx = runVelocity(vx, f.facing, ATTRS);
      break;
    case "MOTION":
      break;
    case "NONE":
      return [0, 0];
    case "FALL":
    case "AIR_ESCAPE":
      vx = f.grounded ? applyTraction(vx, ATTRS) : airDrift(vx, stickX, ATTRS);
      break;
    case "GROUND_STOP":
      if (f.grounded) vx = applyTraction(vx, ATTRS);
      break;
  }
  if (!f.grounded) {
    if (!holdVertical) vy = applyGravity(vy, ATTRS, { fastFalling: f.fastFalling });
  } else if (vy < 0) {
    vy = 0;
  }
  return [vx, vy];
}

describe("kineticExec reproduces the legacy single-velocity movement", () => {
  const TYPES: KineticType[] = ["FALL", "GROUND_STOP", "WALK", "DASH", "RUN", "MOTION", "AIR_ESCAPE", "NONE"];
  it("for every kinetic type, carrier split, stick and situation", () => {
    const q12 = fc.integer({ min: -fx(6), max: fx(6) });
    fc.assert(
      fc.property(
        fc.constantFrom(...TYPES),
        q12,
        q12,
        q12,
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(-1, 0, 1),
        fc.constantFrom(-1, 1),
        fc.integer({ min: 0, max: 30 }),
        fc.boolean(),
        (type, a, b, gy, grounded, fastFalling, stickX, facing, actionFrame, holdVertical) => {
          // Speed may sit on either horizontal carrier when the frame starts.
          const f = body({ controlX: a, stopX: b, gravityY: gy }, { grounded, fastFalling, facing, actionFrame });
          kineticSum(f);
          const want = legacy(type, f, stickX, holdVertical);
          kineticExec(f, type, { stickX, params: PARAMS, holdVertical });
          return f.vx === want[0] && f.vy === want[1];
        },
      ),
      { numRuns: 2000 },
    );
  });
});
