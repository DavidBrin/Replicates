import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LAUNCH_SPEED_DECAY } from "./constants";
import { ONE, fx } from "./fixed";
import {
  airControlX,
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticEndMotion,
  kineticExec,
  kineticJump,
  kineticLand,
  kineticLaunch,
  kineticMotion,
  kineticReel,
  kineticReflect,
  kineticSet,
  kineticSetX,
  kineticSetY,
  kineticSum,
  kineticSumX,
  kineticSumY,
  kineticTakeStep,
} from "./kinetic";
import { damageSpeedUpMaxMag } from "./knockback";
import type { KineticState, KineticType } from "./kinetic";
import { paramsFromAttributes } from "./params";
import {
  airDrift,
  applyGravity,
  applyTraction,
  walkVelocity,
} from "./physics";
import { moveScriptFrame } from "./acmd/run";
import { createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
import type { FighterAttributes, FighterState, InputFrame, MatchRules } from "./types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

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
      {
        controlX: 1,
        stopX: 2,
        gravityY: 3,
        motionX: 4,
        motionY: 5,
        damageX: 6,
        damageY: 7,
        fallFrames: 8,
        jumpInitial: 2,
        speedUpFrame: 9,
        speedUpFaf: 10,
        speedUpMax: 11,
        stepX: 12,
        stepY: 13,
      },
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

  it("kineticSetX leaves every vertical energy and vy alone, and the launch keeps its vertical part", () => {
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
    expect(f.launchSpeed).toBe(fx(4)); // |damageY|: Task 17 re-derives it when DAMAGE loses a component
  });

  it("kineticSetY puts vy on GRAVITY and zeroes MOTION and DAMAGE vertically", () => {
    const f = loaded();
    kineticSetY(f, fx(2.5));
    expect(f.kinetic).toMatchObject({ gravityY: fx(2.5), motionY: 0, damageY: 0 });
    expect(f.vy).toBe(fx(2.5));
  });

  it("kineticSetY leaves every horizontal energy and vx alone, and the launch keeps its horizontal part", () => {
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
    expect(f.launchSpeed).toBe(fx(3)); // |damageX|
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

  it("kineticSet(0, 0) stops the fighter, which takes both launch components and so the launch speed", () => {
    const f = loaded();
    kineticSet(f, 0, 0);
    expect([f.vx, f.vy]).toEqual([0, 0]);
    expect(f.launchSpeed).toBe(0);
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

  it("kineticLaunch replaces the whole velocity on DAMAGE and records the launch's magnitude", () => {
    const f = loaded();
    kineticLaunch(f, -fx(1.5), fx(2), fx(2.5));
    expect(f.kinetic).toEqual({ ...emptyKinetic(), damageX: -fx(1.5), damageY: fx(2) });
    expect([f.vx, f.vy]).toEqual([-fx(1.5), fx(2)]);
    expect(f.launchSpeed).toBe(fx(2.5));
  });

  it("kineticLaunch(0, 0, speed) is a launch with no direction: still at rest, the speed still recorded", () => {
    const f = loaded();
    kineticLaunch(f, 0, 0, fx(1));
    expect([f.vx, f.vy]).toEqual([0, 0]);
    expect(f.launchSpeed).toBe(fx(1));
  });

  // rubendal `js/knockback.js` L136-146: a floor bounce resets gravity, a wall or
  // ceiling bounce keeps it. The caller says which gravity the launch carries.
  it("kineticReflect is a launch that keeps the gravity it is given, and the sum holds", () => {
    const f = loaded();
    kineticReflect(f, fx(1.5), -fx(2), fx(2.5), -fx(0.6));
    expect(f.kinetic).toEqual({ ...emptyKinetic(), damageX: fx(1.5), damageY: -fx(2), gravityY: -fx(0.6) });
    expect([f.vx, f.vy]).toEqual([fx(1.5), -fx(2) - fx(0.6)]);
    expect(f.launchSpeed).toBe(fx(2.5));
    kineticReflect(f, 0, fx(2), fx(2), 0);
    expect(f.kinetic.gravityY).toBe(0);
    expect([f.vx, f.vy]).toEqual([0, fx(2)]);
  });
});

/* ------------------------------------------- legacy equivalence (Task 3) -- */

/**
 * Mario's `FighterAttributes` (src/fighters/mario.ts; rubendal SSBU-Calculator
 * at 233590e, https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/mario/data.json),
 * with a test-only width and height. Any fighter would do: the property below
 * compares two rules over the same numbers.
 */
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

/**
 * The kinetic types still on the legacy rule. DASH and RUN left it in Task 23
 * (SmashWiki "Dash"; see fighters/movement.test.ts), and their legacy helpers
 * went with it.
 */
type LegacyType = Exclude<KineticType, "DASH" | "RUN">;
const TYPES: readonly LegacyType[] = ["FALL", "GROUND_STOP", "WALK", "MOTION", "AIR_ESCAPE", "NONE"];

/** The pre-Plan-2 `applyMovement` switch and gravity block, on one vx/vy. */
function legacy(type: LegacyType, f: FighterState, stickX: number, holdVertical: boolean): [number, number] {
  let vx = f.vx;
  let vy = f.vy;
  switch (type) {
    case "WALK":
      vx = walkVelocity(vx, stickX, ATTRS);
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

/* ------------------------------------------------- DAMAGE energy (Task 17) -- */

describe("the DAMAGE energy: a launch decays on its own", () => {
  // SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback): knockback × 0.03 is
  // launch speed, which "then decays by 0.051 every frame … air friction [is]
  // disabled; however, falling speed still takes effect".
  const launch = (): FighterState => {
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    return f;
  };

  it("replaces every other energy at the moment of launch", () => {
    const f = body({ controlX: fx(1), stopX: fx(1), gravityY: -fx(1), motionX: fx(1) }, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    expect(f.kinetic).toMatchObject({ controlX: 0, stopX: 0, gravityY: 0, motionX: 0, damageX: fx(3), damageY: fx(4) });
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([fx(3), fx(4), fx(5)]);
  });

  it("loses exactly 0.051 of launch speed per frame while gravity builds separately", () => {
    const f = launch();
    for (let frame = 1; frame <= 20; frame++) {
      kineticReel(f, PARAMS, false);
      expect(f.launchSpeed).toBe(fx(5) - frame * LAUNCH_SPEED_DECAY);
      expect(f.kinetic.gravityY).toBe(-Math.min(frame * PARAMS.air_accel_y, PARAMS.air_speed_y_stable));
      expect(f.vy).toBe(f.kinetic.damageY + f.kinetic.gravityY);
    }
  });

  it("keeps the launch's direction as it shrinks", () => {
    const f = launch();
    for (let i = 0; i < 30; i++) kineticReel(f, PARAMS, false);
    // 3:4 at every step, to within one Q12 unit of truncation per frame.
    expect(Math.abs(f.kinetic.damageX * 4 - f.kinetic.damageY * 3)).toBeLessThan(4 * 30);
  });

  it("falls from a vertical launch by the damage_fly_top gravity and fall speed", () => {
    // fighter_param.prc damage_fly_top_air_accel_y / damage_fly_top_speed_y_stable
    // (calculator DamageFlyTopGravity / DamageFlyTopFallSpeed, 1.8 for the whole roster).
    const p = { ...PARAMS, damage_fly_top_air_accel_y: fx(0.05), damage_fly_top_speed_y_stable: fx(1.5) };
    const f = body({}, { grounded: false });
    kineticLaunch(f, 0, fx(1), fx(1));
    kineticReel(f, p, true);
    expect(f.kinetic.gravityY).toBe(-fx(0.05));
    for (let i = 0; i < 200; i++) kineticReel(f, p, true);
    expect(f.kinetic.gravityY).toBe(-fx(1.5));
  });

  it("keeps decaying after hitstun, while the stick drifts and gravity pulls", () => {
    const f = launch();
    for (let i = 0; i < 5; i++) kineticReel(f, PARAMS, false);
    const before = { speed: f.launchSpeed, control: f.kinetic.controlX, gravity: f.kinetic.gravityY };
    kineticExec(f, "FALL", { stickX: -1, params: PARAMS, holdVertical: false });
    expect(f.launchSpeed).toBe(before.speed - LAUNCH_SPEED_DECAY);
    expect(f.kinetic.controlX).toBe(before.control - (PARAMS.air_accel_x_add + PARAMS.air_accel_x_mul));
    expect(f.kinetic.gravityY).toBe(Math.max(before.gravity - PARAMS.air_accel_y, -PARAMS.air_speed_y_stable));
    expect(f.vx).toBe(f.kinetic.controlX + f.kinetic.damageX);
    expect(f.vy).toBe(f.kinetic.gravityY + f.kinetic.damageY);
  });

  // UNVERIFIED: the grounded extra is legacy parity (see `launchDecay`), pinned so it changes on purpose.
  it("loses ground_brake on top of 0.051 while grounded, reeling or acting", () => {
    const reeling = body({}, { grounded: true });
    kineticLaunch(reeling, fx(3), 0, fx(3));
    kineticReel(reeling, PARAMS, false);
    expect(reeling.launchSpeed).toBe(fx(3) - LAUNCH_SPEED_DECAY - PARAMS.ground_brake);

    const acting = body({}, { grounded: true });
    kineticLaunch(acting, fx(3), 0, fx(3));
    kineticExec(acting, "GROUND_STOP", { stickX: 0, params: PARAMS, holdVertical: false });
    expect(acting.launchSpeed).toBe(fx(3) - LAUNCH_SPEED_DECAY - PARAMS.ground_brake);
  });

  it("falls by ordinary gravity from a launch that is not vertical, whatever damage_fly_top says", () => {
    const p = { ...PARAMS, damage_fly_top_air_accel_y: fx(0.05), damage_fly_top_speed_y_stable: fx(0.5) };
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(1), fx(1), fx(1.4));
    kineticReel(f, p, false);
    expect(f.kinetic.gravityY).toBe(-PARAMS.air_accel_y);
    for (let i = 0; i < 200; i++) kineticReel(f, p, false);
    expect(f.kinetic.gravityY).toBe(-PARAMS.air_speed_y_stable);
  });

  it("ends on landing, leaving its horizontal part to brake on the ground", () => {
    const f = launch();
    kineticLand(f);
    expect(f.launchSpeed).toBe(0);
    expect(f.kinetic).toMatchObject({ damageX: 0, damageY: 0, stopX: fx(3) });
  });

  it("loses the component a wall or a ceiling stops, and the speed with it", () => {
    const f = launch();
    kineticSetX(f, 0);
    expect(f.launchSpeed).toBe(fx(4));
    kineticSetY(f, 0);
    expect(f.launchSpeed).toBe(0);
  });
});

/* ------------------------------------------------- MOTION energy (Task 18) -- */

// The 0.5 / 2.9 and 0.35 / 2.5 velocities below are arbitrary test inputs, not published figures.
describe("the MOTION energy: a move's scripted velocity", () => {
  it("replaces every other energy while it holds", () => {
    const f = body({ controlX: fx(1), stopX: fx(1), gravityY: -fx(1), damageX: fx(2) }, { launchSpeed: fx(2) });
    kineticMotion(f, fx(0.5), fx(2.9));
    expect(f.kinetic).toMatchObject({ controlX: 0, stopX: 0, gravityY: 0, damageX: 0, motionX: fx(0.5), motionY: fx(2.9) });
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([fx(0.5), fx(2.9), 0]);
  });

  it("hands its velocity to drift and gravity when the hold ends, so the fighter carries on", () => {
    const f = body({}, { grounded: false });
    kineticMotion(f, fx(0.5), fx(2.9));
    kineticEndMotion(f);
    expect(f.kinetic).toMatchObject({ motionX: 0, motionY: 0, controlX: fx(0.5), gravityY: fx(2.9) });
    expect([f.vx, f.vy]).toEqual([fx(0.5), fx(2.9)]);
  });

  it("ends a live launch instead of leaving it frozen underneath", () => {
    // A launch outlives hitstun, so a move can start while one is still decaying.
    // The old path wrote `launchSpeed = 0` and left the DAMAGE vector behind: it
    // never decayed again and rode along until the fighter landed.
    const f = body({}, { grounded: false });
    kineticLaunch(f, -fx(2), fx(1.5), fx(2.5));
    for (let i = 0; i < 3; i++) kineticReel(f, PARAMS, false);
    expect(f.launchSpeed).toBeGreaterThan(0); // the launch really is live
    expect(f.kinetic.damageX).toBeLessThan(0);

    kineticMotion(f, fx(0.35), fx(2.5));
    expect(f.kinetic).toMatchObject({ damageX: 0, damageY: 0 });
    expect(f.launchSpeed).toBe(0);

    // Hold, hand over, then ten frames of ordinary air: nothing brings the launch back.
    for (let i = 0; i < 3; i++) kineticMotion(f, fx(0.35), fx(2.5));
    kineticEndMotion(f);
    for (let i = 0; i < 10; i++) kineticExec(f, "FALL", { stickX: 0, params: PARAMS, holdVertical: false });
    expect(f.kinetic).toMatchObject({ damageX: 0, damageY: 0 });
    expect(f.launchSpeed).toBe(0);
    expect(f.vx).toBe(f.kinetic.controlX);
  });
});

describe("a scripted move started during a live launch (the engine, not the energy)", () => {
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
  const CTX: SimContext = {
    fighter(id) {
      const d = FIGHTERS.find((x) => x.id === id);
      if (d === undefined) throw new Error(`unknown fighter ${id}`);
      return d;
    },
    stage(id) {
      const d = STAGES.find((x) => x.id === id);
      if (d === undefined) throw new Error(`unknown stage ${id}`);
      return d;
    },
  };

  it("Link's up-special, pressed mid-launch, ends the launch when its momentum starts", () => {
    let state = createInitialState("finalDestination", [{ defId: "link" }, { defId: "link" }], RULES, 0x7a18, CTX);
    for (const f of state.fighters) f.x = fx(f === state.fighters[0] ? 0 : 150);
    const f0 = state.fighters[0];
    f0.action = "fall";
    f0.actionFrame = 0;
    f0.grounded = false;
    f0.y = fx(70);
    f0.hitstun = 0; // out of hitstun, still decaying: how a launch outlives it
    kineticLaunch(f0, -fx(2), fx(1.5), fx(2.5));

    const input: InputFrame = Btn.Up | Btn.Special;
    let prev: InputFrame = 0;
    let launchLiveBeforeMotion = false;
    let momentumSeen = false;
    let framesInWindow = 0;
    for (let i = 0; i < 60; i++) {
      const out = step(state, [input, 0], { prevInputs: [prev, 0], ctx: CTX });
      state = out.state;
      prev = input;
      const f = state.fighters[0];
      const k = f.kinetic;
      // Ask the move's own script whether its momentum has begun, not the energies.
      const inWindow = moveScriptFrame(CTX.fighter("link"), f)?.state.momentum != null;
      if (inWindow) framesInWindow++;
      momentumSeen ||= inWindow;
      if (!momentumSeen) {
        if (k.damageX !== 0 || k.damageY !== 0) launchLiveBeforeMotion = true;
        continue;
      }
      // From the script's first momentum frame onward, through the window and past its end,
      // the launch is gone, not parked.
      expect([k.damageX, k.damageY, f.launchSpeed], `frame ${i} of the run`).toEqual([0, 0, 0]);
      expect(f.vx, `frame ${i} of the run`).toBe(k.controlX + k.stopX + k.motionX);
    }
    // Guard against passing for the wrong reason: the launch was live when the move began,
    // and the move did reach its momentum and run it out.
    expect(launchLiveBeforeMotion).toBe(true);
    expect(framesInWindow).toBeGreaterThan(10);
    const end = state.fighters[0].kinetic;
    expect([end.damageX, end.damageY, state.fighters[0].launchSpeed]).toEqual([0, 0, 0]);
  });
});

describe("a momentum hold cut short by a landing", () => {
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
  const CTX: SimContext = {
    fighter(id) {
      const d = FIGHTERS.find((x) => x.id === id);
      if (d === undefined) throw new Error(`unknown fighter ${id}`);
      return d;
    },
    stage(id) {
      const d = STAGES.find((x) => x.id === id);
      if (d === undefined) throw new Error(`unknown stage ${id}`);
      return d;
    },
  };

  it("Kirby's Final Cutter lands on Battlefield's lower platform mid-hold and does not slide forever", () => {
    // From the main stage at x = -40, under the left lower platform: the second
    // Final Cutter window carries him down onto the platform while it still holds.
    // The landing clears `move`, so nothing ever ran the hold's last frame: MOTION
    // kept its 0.2 a frame and he slid until he left the platform.
    let state = createInitialState("battlefield", [{ defId: "kirby" }, { defId: "kirby" }], RULES, 0x7a19, CTX);
    state.fighters[1].x = fx(150);
    const f0 = state.fighters[0];
    f0.x = fx(-40);
    f0.y = fx(0.111);
    f0.grounded = true;
    f0.platform = 0;
    f0.action = "stand";
    f0.actionFrame = 0;
    f0.facing = 1;

    let prev: InputFrame = 0;
    const go = (input: InputFrame): FighterState => {
      state = step(state, [input, 0], { prevInputs: [prev, 0], ctx: CTX }).state;
      prev = input;
      return state.fighters[0];
    };
    for (let i = 0; i < 4; i++) go(0);
    const cutter: InputFrame = Btn.Up | Btn.Special;
    let before = go(cutter);
    let landed: FighterState | null = null;
    for (let i = 0; i < 80 && landed === null; i++) {
      const f = go(cutter);
      if (f.action === "land") landed = f;
      else before = f;
    }
    // Guards against passing for the wrong reason: he really landed in the middle of the hold.
    expect(landed, "Kirby never landed").not.toBeNull();
    expect(before.action).toBe("special");
    expect(before.kinetic.motionX, "the hold should still be live on the frame before he lands").not.toBe(0);

    // MOTION is handed back within a few frames of the landing, and stays handed back.
    let settled: FighterState | null = null;
    for (let i = 0; i < 4; i++) settled = go(0);
    expect(settled!.kinetic.motionX).toBe(0);
    expect(settled!.kinetic.motionY).toBe(0);
    expect(settled!.vx).toBe(0);
    const x = settled!.x;
    for (let i = 0; i < 30; i++) {
      const f = go(0);
      expect([f.kinetic.motionX, f.kinetic.motionY, f.vx], `${i} frames after settling`).toEqual([0, 0, 0]);
    }
    expect(state.fighters[0].x).toBe(x);
  });
});

/* ------------------------------------------------- air friction (Task 21) -- */

describe("air friction (SmashWiki Air friction, https://www.ssbwiki.com/Air_friction)", () => {
  // "Air friction only applies when the player is not holding the Control Stick
  // in a horizontal direction." `air_brake_x` is the calculator's AirFriction.
  const P = { ...PARAMS, air_brake_x: fx(0.0075) };
  const NEUTRAL = { stickX: 0, params: P, holdVertical: false };
  const accel = P.air_accel_x_add + P.air_accel_x_mul;

  describe("airControlX", () => {
    it("bleeds a rightward drift by air_brake_x with the stick neutral", () => {
      expect(airControlX(fx(1), 0, P)).toBe(fx(1) - P.air_brake_x);
    });

    it("bleeds a leftward drift by air_brake_x too, toward zero from below", () => {
      expect(airControlX(-fx(1), 0, P)).toBe(-fx(1) + P.air_brake_x);
    });

    it("stops at zero rather than reversing", () => {
      const small = P.air_brake_x - 1;
      expect(airControlX(small, 0, P)).toBe(0);
      expect(airControlX(-small, 0, P)).toBe(0);
      expect(airControlX(0, 0, P)).toBe(0);
    });

    it("applies air acceleration, not friction, when the stick opposes the drift", () => {
      // "If the player is attempting to slow down, air acceleration applies instead."
      expect(airControlX(fx(0.5), -1, P)).toBe(fx(0.5) - accel);
      expect(airControlX(-fx(0.5), 1, P)).toBe(-fx(0.5) + accel);
    });

    it("leaves a drift alone while the stick holds it at air speed", () => {
      expect(airControlX(P.air_speed_x_stable, 1, P)).toBe(P.air_speed_x_stable);
      expect(airControlX(-P.air_speed_x_stable, -1, P)).toBe(-P.air_speed_x_stable);
    });

    it("is the identity at air_brake_x 0, which is every legacy fighter", () => {
      expect(PARAMS.air_brake_x).toBe(0);
      expect(airControlX(fx(1), 0, PARAMS)).toBe(fx(1));
      expect(airControlX(-fx(1), 0, PARAMS)).toBe(-fx(1));
    });
  });

  describe("an airborne STOP carrier", () => {
    const stop = (k: Partial<KineticState>, over: Partial<FighterState>): FighterState => {
      const f = body(k, { grounded: false, ...over });
      kineticExec(f, "GROUND_STOP", NEUTRAL);
      return f;
    };

    it("bleeds by exactly air_brake_x and leaves DAMAGE and MOTION alone", () => {
      const f = stop({ stopX: fx(1), damageX: fx(0.5), motionX: fx(0.25) }, {});
      expect(f.kinetic.stopX).toBe(fx(1) - P.air_brake_x);
      expect(f.kinetic.damageX).toBe(fx(0.5));
      expect(f.kinetic.motionX).toBe(fx(0.25));
    });

    it("bleeds a leftward carrier toward zero and stops there", () => {
      expect(stop({ stopX: -fx(1) }, {}).kinetic.stopX).toBe(-fx(1) + P.air_brake_x);
      expect(stop({ stopX: P.air_brake_x - 1 }, {}).kinetic.stopX).toBe(0);
    });

    it("still brakes by ground_brake on the ground, not air_brake_x", () => {
      const f = stop({ stopX: fx(1) }, { grounded: true });
      expect(f.kinetic.stopX).toBe(fx(1) - P.ground_brake);
      expect(P.ground_brake).not.toBe(P.air_brake_x);
    });
  });

  it("a fighter in hitstun is not slowed: the launch decays on its own energy (SmashWiki Knockback)", () => {
    // Deliberate: the Knockback page says air friction is disabled while a launch
    // decays (see the DAMAGE energy's tests), so `kineticReel` bleeds neither
    // carrier. The Air friction page's note on ignored input in hitstun can be
    // read the other way; D55 records which page the engine follows.
    const f = body({ controlX: fx(1), stopX: fx(0.5) }, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    f.kinetic.controlX = fx(1);
    f.kinetic.stopX = fx(0.5);
    kineticReel(f, P, false);
    expect([f.kinetic.controlX, f.kinetic.stopX]).toEqual([fx(1), fx(0.5)]);
  });
});

/* ------------------------------------- the balloon speed-up (Plan 3, Task 6) -- */

describe("the DAMAGE energy, sped up (init_damage_speed_up)", () => {
  // rubendal SSBU-Calculator `js/knockback.js` plays a sped-up launch as the
  // ordinary one, sampled: each real frame shows the position several of the
  // game's reaction frames on. So a real frame must cover exactly the
  // reaction frames it consumes, no more and no less.
  const FAF = 80; // 6x on the first frame
  const sped = (): FighterState => {
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5), FAF);
    return f;
  };
  const plain = (): FighterState => {
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    return f;
  };

  it("arms the speed-up at launch: the reaction frames and the first-frame multiplier", () => {
    const f = sped();
    expect(f.kinetic).toMatchObject({ speedUpFrame: FAF * ONE, speedUpFaf: FAF, speedUpMax: damageSpeedUpMaxMag(FAF) });
    expect(plain().kinetic.speedUpMax).toBe(0);
  });

  it("covers its first frame's six reaction frames in one real frame", () => {
    const f = sped();
    kineticReel(f, PARAMS, false);
    const g = plain();
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 6; i++) {
      kineticReel(g, PARAMS, false);
      dx += g.vx;
      dy += g.vy;
    }
    expect(f.launchSpeed).toBe(g.launchSpeed);
    expect(f.kinetic.gravityY).toBe(g.kinetic.gravityY);
    // The last of the six is this frame's velocity; the other five ride as a step.
    expect([f.vx + f.kinetic.stepX, f.vy + f.kinetic.stepY]).toEqual([dx, dy]);
  });

  it("hands the step to integrate once, and only once", () => {
    const f = sped();
    kineticReel(f, PARAMS, false);
    const step = kineticTakeStep(f);
    expect(step.x).not.toBe(0);
    expect(kineticTakeStep(f)).toEqual({ x: 0, y: 0 });
  });

  it("slows to one reaction frame a real frame once the multiplier is spent", () => {
    const f = sped();
    let frames = 0;
    while (f.kinetic.speedUpMax > 0) {
      kineticReel(f, PARAMS, false);
      kineticTakeStep(f);
      frames += 1;
      expect(frames).toBeLessThan(FAF);
    }
    const g = { ...f, kinetic: { ...f.kinetic } } as FighterState;
    kineticReel(f, PARAMS, false);
    expect(f.kinetic.stepX).toBe(0);
    expect(f.launchSpeed).toBe(g.launchSpeed - LAUNCH_SPEED_DECAY);
  });

  it("is disarmed by anything that ends the launch", () => {
    for (const end of [kineticClear, kineticLand, (f: FighterState) => kineticMotion(f, 0, 0)]) {
      const f = sped();
      end(f);
      expect(f.kinetic.speedUpMax).toBe(0);
    }
  });
});
