import { describe, expect, it } from "vitest";

import { fx, toFloat } from "./fixed";
import { BALLOON_FALL_SPEED, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X } from "./constants";
import {
  HARD_PLATFORM_DEPTH,
  airDrift,
  applyGravity,
  applyTraction,
  blastZoneKO,
  decayLaunch,
  dropThroughPlatform,
  fastFallVelocity,
  findLedgeGrab,
  hitstunGravityOptions,
  initialDashVelocity,
  integrate,
  ledgeIntangibilityFrames,
  ledgePosition,
  platformCentreX,
  resolveCollision,
  runVelocity,
  walkVelocity,
} from "./physics";
import type { FighterAttributes, FighterState, StageDef } from "./types";

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.1),
  initialDashSpeed: fx(1.76),
  runSpeed: fx(1.5),
  airSpeed: fx(1.15),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.05),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.08),
  fullHopVelocity: fx(3.1),
  shortHopVelocity: fx(1.7),
  airJumpVelocity: fx(2.85),
  jumps: 2,
  canWallJump: true,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

/** One hard main platform with ledges, one soft platform floating above it. */
const STAGE: StageDef = {
  id: "test",
  name: "Test",
  series: "test",
  platforms: [
    { x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true },
    { x: 0, y: fx(30), halfWidth: fx(20), soft: true, ledges: false },
  ],
  blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
  spawns: [
    { x: fx(-40), y: fx(20) },
    { x: fx(40), y: fx(20) },
  ],
  theme: "test",
};

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "test",
    costume: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    platform: -1,
    action: "fall",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: fx(50),
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    ...over,
  };
}

describe("gravity", () => {
  it("accelerates downward one gravity per frame", () => {
    expect(applyGravity(0, ATTRS)).toBe(-ATTRS.gravity);
    expect(applyGravity(fx(1), ATTRS)).toBe(fx(1) - ATTRS.gravity);
  });

  it("clamps at terminal velocity", () => {
    let vy = 0;
    for (let i = 0; i < 200; i++) vy = applyGravity(vy, ATTRS);
    expect(vy).toBe(-ATTRS.fallSpeed);
  });

  it("uses the fast-fall speed as the floor while fast-falling", () => {
    let vy = 0;
    for (let i = 0; i < 200; i++) vy = applyGravity(vy, ATTRS, { fastFalling: true });
    expect(vy).toBe(-ATTRS.fastFallSpeed);
  });

  it("pins a balloon launch to a flat 1.8 fall speed", () => {
    let vy = 0;
    for (let i = 0; i < 200; i++) vy = applyGravity(vy, ATTRS, { balloon: true });
    expect(vy).toBe(-BALLOON_FALL_SPEED);
  });
});

describe("balloon knockback is classified once, at launch", () => {
  it("reads the flag the launch set rather than re-deriving it from velocity", () => {
    // A 45° launch is not balloon knockback. Its velocity says so on the frame
    // of contact and then stops saying so: gravity subtracts from `vy` every
    // frame, and after enough of them the pair points steeply enough downward
    // to sit inside the 70°-110° cone. A test on `vx`/`vy` would therefore flip
    // a shallow hit to a flat 1.8 fall halfway through its own hitstun.
    const launched = fighter({ hitstun: 30, balloon: false, vx: fx(2.5), vy: fx(2.5) });
    expect(hitstunGravityOptions(launched).balloon).toBe(false);

    // Several frames of gravity later, still the same 45° hit.
    launched.vy = -fx(8);
    expect(Math.abs(launched.vx)).toBeLessThan(Math.abs(launched.vy) / 2); // "looks" vertical
    expect(hitstunGravityOptions(launched).balloon).toBe(false);
  });

  it("keeps a genuine vertical launch on the flat fall speed for the whole hitstun", () => {
    const launched = fighter({ hitstun: 30, balloon: true, vx: 0, vy: fx(4) });
    expect(hitstunGravityOptions(launched).balloon).toBe(true);
    // …including once drift has given it a horizontal component it did not
    // launch with, which the velocity test would have read as "not balloon".
    launched.vx = fx(3);
    launched.vy = -fx(1);
    expect(hitstunGravityOptions(launched).balloon).toBe(true);
  });

  it("stops applying once hitstun is over", () => {
    expect(hitstunGravityOptions(fighter({ hitstun: 0, balloon: true })).balloon).toBe(false);
  });
});

describe("fast fall", () => {
  it("is a velocity set, not an acceleration", () => {
    // Pressing down replaces the fall speed outright and irreversibly.
    expect(fastFallVelocity(ATTRS)).toBe(-ATTRS.fastFallSpeed);
  });
});

describe("ground movement", () => {
  it("ramps toward walk speed and stops there", () => {
    let vx = 0;
    for (let i = 0; i < 60; i++) vx = walkVelocity(vx, 1, ATTRS);
    expect(vx).toBe(ATTRS.walkSpeed);
  });

  it("gives the initial dash its whole speed on frame one", () => {
    expect(initialDashVelocity(1, ATTRS)).toBe(ATTRS.initialDashSpeed);
    expect(initialDashVelocity(-1, ATTRS)).toBe(-ATTRS.initialDashSpeed);
  });

  it("decays the initial dash down to run speed", () => {
    let vx = initialDashVelocity(1, ATTRS);
    expect(vx).toBeGreaterThan(ATTRS.runSpeed);
    for (let i = 0; i < 60; i++) vx = runVelocity(vx, 1, ATTRS);
    expect(vx).toBe(ATTRS.runSpeed);
  });

  it("brings a fighter to a stop at traction, symmetrically", () => {
    expect(applyTraction(fx(1), ATTRS)).toBe(fx(1) - ATTRS.traction);
    expect(applyTraction(fx(-1), ATTRS)).toBe(fx(-1) + ATTRS.traction);
    expect(applyTraction(fx(0.01), ATTRS)).toBe(0);
  });
});

describe("air movement", () => {
  it("accelerates at base plus additional and caps at air speed", () => {
    let vx = 0;
    expect(airDrift(vx, 1, ATTRS)).toBe(ATTRS.airAccelBase + ATTRS.airAccelAdditional);
    for (let i = 0; i < 200; i++) vx = airDrift(vx, 1, ATTRS);
    expect(vx).toBe(ATTRS.airSpeed);
  });

  it("keeps momentum when the stick is released — there is no air friction", () => {
    expect(airDrift(fx(5), 0, ATTRS)).toBe(fx(5));
  });

  it("refuses to add to a launch that already exceeds air speed", () => {
    const launched = fx(8);
    expect(airDrift(launched, 1, ATTRS)).toBe(launched);
  });

  it("still lets a launched fighter drift back against the launch", () => {
    const launched = fx(8);
    expect(airDrift(launched, -1, ATTRS)).toBeLessThan(launched);
  });
});

describe("launch decay", () => {
  it("bleeds the magnitude at a flat rate and keeps the direction", () => {
    const f = fighter({ vx: fx(3), vy: fx(4), launchSpeed: fx(5) });
    decayLaunch(f, fx(1));
    expect(f.launchSpeed).toBe(fx(4));
    // 3:4 preserved at four fifths of the original magnitude.
    expect(toFloat(f.vx)).toBeCloseTo(2.4, 1);
    expect(toFloat(f.vy)).toBeCloseTo(3.2, 1);
  });

  it("stops rather than reversing", () => {
    const f = fighter({ vx: fx(1), vy: 0, launchSpeed: fx(0.5) });
    decayLaunch(f, fx(1));
    expect(f.launchSpeed).toBe(0);
  });
});

describe("platform collision", () => {
  it("lands a falling fighter that crosses the surface", () => {
    const f = fighter({ x: 0, y: fx(-0.5), vy: -fx(1) });
    const out = resolveCollision(f, 0, fx(0.5), STAGE, ATTRS, 0);
    expect(out.landed).toBe(true);
    expect(f.grounded).toBe(true);
    expect(f.y).toBe(0);
    expect(f.vy).toBe(0);
    expect(f.platform).toBe(0);
  });

  it("does not land a fighter moving upward through a surface", () => {
    const f = fighter({ x: 0, y: fx(29), vy: fx(2) });
    const out = resolveCollision(f, 0, fx(27), STAGE, ATTRS, 0);
    expect(out.landed).toBe(false);
    expect(f.grounded).toBe(false);
  });

  it("does not land a fighter that was already below the surface", () => {
    // Rising from under the soft platform, then falling back: no snap upward.
    const f = fighter({ x: 0, y: fx(28), vy: -fx(1) });
    const out = resolveCollision(f, 0, fx(29), STAGE, ATTRS, 0);
    expect(out.landed).toBe(false);
  });

  it("misses a platform the fighter is horizontally clear of", () => {
    const f = fighter({ x: fx(100), y: fx(-1), vy: -fx(2) });
    const out = resolveCollision(f, fx(100), fx(1), STAGE, ATTRS, 0);
    expect(out.landed).toBe(false);
  });

  it("passes through a soft platform when asked to", () => {
    const f = fighter({ x: 0, y: fx(29), vy: -fx(2) });
    const out = resolveCollision(f, 0, fx(31), STAGE, ATTRS, 0, { passThroughSoft: true });
    expect(out.landed).toBe(false);
    expect(f.grounded).toBe(false);
  });

  it("drops a fighter through a soft platform it is standing on", () => {
    const f = fighter({ x: 0, y: fx(30), grounded: true, platform: 1, action: "stand" });
    expect(dropThroughPlatform(f, STAGE)).toBe(true);
    expect(f.grounded).toBe(false);
    expect(f.y).toBeLessThan(fx(30));
    // And the next frame's landing test declines to catch it again.
    const out = resolveCollision(f, 0, f.y, STAGE, ATTRS, 0);
    expect(out.landed).toBe(false);
  });

  it("refuses to drop through a hard platform", () => {
    const f = fighter({ x: 0, y: 0, grounded: true, platform: 0, action: "stand" });
    expect(dropThroughPlatform(f, STAGE)).toBe(false);
    expect(f.grounded).toBe(true);
  });

  it("walks a grounded fighter off the end of its platform", () => {
    const f = fighter({ x: fx(81), y: 0, grounded: true, platform: 0, action: "walk" });
    const out = resolveCollision(f, fx(79), 0, STAGE, ATTRS, 0);
    expect(out.leftGround).toBe(true);
    expect(f.grounded).toBe(false);
  });

  it("stops a fighter that drifts into the side of a hard platform", () => {
    const f = fighter({ x: fx(78), y: fx(-10), vx: -fx(2) });
    const out = resolveCollision(f, fx(82), fx(-10), STAGE, ATTRS, 0);
    expect(out.blocked).toBe(true);
    expect(f.x).toBe(fx(80));
    expect(f.vx).toBe(0);
  });

  it("stops a fighter rising into the underside of a hard platform", () => {
    const bottom = -HARD_PLATFORM_DEPTH;
    const f = fighter({ x: 0, y: bottom - fx(11), vy: fx(3) });
    const out = resolveCollision(f, 0, bottom - fx(14), STAGE, ATTRS, 0);
    expect(out.blocked).toBe(true);
    expect(f.vy).toBe(0);
  });

  it("keeps a fighter on a moving platform", () => {
    const moving: StageDef = {
      ...STAGE,
      platforms: [
        {
          x: 0,
          y: fx(30),
          halfWidth: fx(20),
          soft: true,
          ledges: false,
          motion: { kind: "sweep", amplitude: fx(40), periodFrames: 240 },
        },
      ],
    };
    const centre = platformCentreX(moving.platforms[0], 30);
    const f = fighter({ x: centre, y: fx(30), grounded: true, platform: 0, action: "stand" });
    resolveCollision(f, f.x, f.y, moving, ATTRS, 30);
    const drift = centre - platformCentreX(moving.platforms[0], 29);
    expect(f.x - centre).toBe(drift);
    expect(drift).not.toBe(0);
  });
});

describe("integration", () => {
  it("adds velocity to position", () => {
    const f = fighter({ x: fx(1), y: fx(2), vx: fx(3), vy: fx(-4) });
    integrate(f);
    expect(f.x).toBe(fx(4));
    expect(f.y).toBe(fx(-2));
  });
});

describe("ledges", () => {
  it("grabs a ledge the fighter is facing", () => {
    const f = fighter({ x: fx(82), y: fx(-2), vy: -fx(1), facing: -1 });
    expect(findLedgeGrab(f, STAGE, 0)).toEqual({ platform: 0, side: 1 });
  });

  it("reaches 40% less far grabbing backwards", () => {
    const backwards = fighter({ x: fx(82), y: fx(-2), vy: -fx(1), facing: 1 });
    expect(findLedgeGrab(backwards, STAGE, 0)).toBeNull();
    // Inside the shortened box, the rear grab does connect.
    const closer = fighter({ x: fx(81), y: fx(-2), vy: -fx(1), facing: 1 });
    expect(findLedgeGrab(closer, STAGE, 0)).not.toBeNull();
    expect(toFloat(LEDGE_GRAB_RANGE_X) * toFloat(LEDGE_GRAB_BACK_PENALTY)).toBeCloseTo(1.92, 2);
  });

  it("refuses a ledge while rising, in hitstun, or already hanging", () => {
    expect(findLedgeGrab(fighter({ x: fx(82), y: fx(-2), vy: fx(1), facing: -1 }), STAGE, 0)).toBeNull();
    expect(
      findLedgeGrab(fighter({ x: fx(82), y: fx(-2), vy: -fx(1), facing: -1, hitstun: 5 }), STAGE, 0),
    ).toBeNull();
    expect(
      findLedgeGrab(
        fighter({ x: fx(82), y: fx(-2), vy: -fx(1), facing: -1, ledge: { platform: 0, side: 1 } }),
        STAGE,
        0,
      ),
    ).toBeNull();
  });

  it("refuses a ledge from above the surface", () => {
    const f = fighter({ x: fx(82), y: fx(4), vy: -fx(1), facing: -1 });
    expect(findLedgeGrab(f, STAGE, 0)).toBeNull();
  });

  it("locates the ledge it grabbed", () => {
    expect(ledgePosition(STAGE, { platform: 0, side: -1 }, 0)).toEqual({ x: fx(-80), y: 0 });
    expect(ledgePosition(STAGE, { platform: 0, side: 1 }, 0)).toEqual({ x: fx(80), y: 0 });
  });

  it("computes ledge intangibility from air time, percent and regrabs", () => {
    expect(ledgeIntangibilityFrames(0, 0, 0)).toBe(64);
    expect(ledgeIntangibilityFrames(300, 0, 0)).toBe(124);
    expect(ledgeIntangibilityFrames(600, 0, 0)).toBe(124); // air time is capped
    // 64 - 44 = 20, raised to the floor of 24.
    expect(ledgeIntangibilityFrames(0, fx(120), 0)).toBe(24);
    expect(ledgeIntangibilityFrames(0, fx(300), 0)).toBe(24); // percent is capped too
  });

  it("scales intangibility away over successive regrabs", () => {
    expect(ledgeIntangibilityFrames(0, 0, 1)).toBe(51); // 64 * 0.8
    expect(ledgeIntangibilityFrames(0, 0, 2)).toBe(32); // 64 * 0.5
    expect(ledgeIntangibilityFrames(0, 0, 3)).toBe(0);
    expect(ledgeIntangibilityFrames(0, 0, 9)).toBe(0);
  });
});

describe("blast zones", () => {
  it("KOs past every edge", () => {
    expect(blastZoneKO(fighter({ x: fx(-241) }), STAGE)).toBe("blast");
    expect(blastZoneKO(fighter({ x: fx(241) }), STAGE)).toBe("blast");
    expect(blastZoneKO(fighter({ y: fx(-141) }), STAGE)).toBe("blast");
  });

  it("tells a star KO from a screen KO by the speed at the boundary", () => {
    expect(blastZoneKO(fighter({ y: fx(193), vy: fx(0.5) }), STAGE)).toBe("star");
    expect(blastZoneKO(fighter({ y: fx(193), vy: fx(6) }), STAGE)).toBe("screen");
  });

  it("leaves a fighter inside the rectangle alone", () => {
    expect(blastZoneKO(fighter({ x: fx(100), y: fx(100) }), STAGE)).toBeNull();
  });
});
