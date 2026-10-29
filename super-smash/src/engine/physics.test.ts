import { describe, expect, it } from "vitest";

import { fx, toFloat } from "./fixed";
import { BALLOON_FALL_SPEED, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X } from "./constants";
import { emptyCombat } from "./combat";
import { emptyKinetic, kineticLaunch } from "./kinetic";
import {
  HARD_PLATFORM_DEPTH,
  airDrift,
  applyGravity,
  applyTraction,
  blastZoneKO,
  clampShiftToStage,
  dropThroughPlatform,
  ecbOf,
  ecbPoints,
  fastFallVelocity,
  findLedgeGrab,
  hitstunGravityOptions,
  integrate,
  ledgeIntangibilityFrames,
  ledgePosition,
  platformCentreX,
  resolveCollision,
  walkVelocity,
} from "./physics";
import type { ActionState, FighterAttributes, FighterState, StageDef } from "./types";
import { battlefield as BATTLEFIELD } from "@/stages/battlefield";

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
    ledgeLockout: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
}

describe("legacy gravity (a test oracle; the engine uses gravityStep)", () => {
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

describe("legacy ground movement (a test oracle; the engine uses kineticExec)", () => {
  it("ramps toward walk speed and stops there", () => {
    let vx = 0;
    for (let i = 0; i < 60; i++) vx = walkVelocity(vx, 1, ATTRS);
    expect(vx).toBe(ATTRS.walkSpeed);
  });

  it("brings a fighter to a stop at traction, symmetrically", () => {
    expect(applyTraction(fx(1), ATTRS)).toBe(fx(1) - ATTRS.traction);
    expect(applyTraction(fx(-1), ATTRS)).toBe(fx(-1) + ATTRS.traction);
    expect(applyTraction(fx(0.01), ATTRS)).toBe(0);
  });
});

describe("legacy air movement (a test oracle; the engine uses airControlX)", () => {
  it("accelerates at base plus additional and caps at air speed", () => {
    let vx = 0;
    expect(airDrift(vx, 1, ATTRS)).toBe(ATTRS.airAccelBase + ATTRS.airAccelAdditional);
    for (let i = 0; i < 200; i++) vx = airDrift(vx, 1, ATTRS);
    expect(vx).toBe(ATTRS.airSpeed);
  });

  it("keeps momentum when the stick is released — the legacy rule has no air friction", () => {
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

  it("ends a launch on landing, its horizontal part sliding on as STOP (kineticLand)", () => {
    const f = fighter({ x: 0, y: fx(-0.5) });
    kineticLaunch(f, fx(2), -fx(1), fx(2.2));
    const out = resolveCollision(f, 0, fx(0.5), STAGE, ATTRS, 0);
    expect(out.landed).toBe(true);
    expect(f.launchSpeed).toBe(0);
    expect(f.kinetic).toMatchObject({ damageX: 0, damageY: 0, stopX: fx(2) });
    expect([f.vx, f.vy]).toEqual([fx(2), 0]);
  });

  /**
   * A scripted rise lifts a grounded fighter off the floor.
   *
   * `MoveDef.momentum` is what makes Samus's Screw Attack and Marth's Dolphin
   * Slash go up. `applyMoveMomentum` set `vy` correctly and this function threw
   * it away on the same frame: a fighter still inside their platform's bounds
   * took the "still standing on it" branch, which pins `y` and zeroes `vy`, and
   * the only escape from `grounded` was walking off the edge. So both moves
   * played their rising animation on the spot, for the whole roster.
   *
   * Two character agents found it independently, each having first suspected
   * their own capture tooling. It is asserted here rather than in either of
   * their files because it is nobody's character — it is every up-special.
   */
  it("lifts a grounded fighter who has been given upward velocity", () => {
    const f = fighter({ x: 0, y: 0, vy: fx(2.9) });
    f.grounded = true;
    f.platform = 0;
    const out = resolveCollision(f, 0, 0, STAGE, ATTRS, 0);
    expect(f.vy, "the rise was cancelled on the frame it was applied").toBe(fx(2.9));
    expect(f.grounded, "still standing on the floor while rising off it").toBe(false);
    expect(out.leftGround).toBe(true);
  });

  it("still pins a grounded fighter who is not going anywhere", () => {
    // The other half: standing still must stay standing, at the surface, with
    // no drift — otherwise this fix trades a broken up-special for a roster
    // that sinks through the stage.
    const f = fighter({ x: 0, y: fx(0.4), vy: 0 });
    f.grounded = true;
    f.platform = 0;
    resolveCollision(f, 0, 0, STAGE, ATTRS, 0);
    expect(f.grounded).toBe(true);
    expect(f.y).toBe(0);
    expect(f.vy).toBe(0);
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
    // The ECB's left point stops at the wall face, so the origin rests half a body out.
    expect(f.x).toBe(fx(80) + ATTRS.width);
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

/*
 * A shift that did not come through `resolveCollision` (SDI and ASDI move a
 * fighter who is frozen in hitlag) must not carry the body into the stage.
 */
describe("clampShiftToStage", () => {
  /** `f` moved from (`fromX`, `fromY`) to where it is now. */
  function shifted(f: FighterState, fromX: number, fromY: number, stage: StageDef = STAGE, frame = 0): FighterState {
    clampShiftToStage(f, fromX, fromY, stage, ATTRS, frame);
    return f;
  }

  it("leaves a shift through open air alone", () => {
    const f = shifted(fighter({ x: fx(118), y: fx(60) }), fx(120), fx(60));
    expect([f.x, f.y]).toEqual([fx(118), fx(60)]);
  });

  it("does nothing for a fighter that did not move", () => {
    const f = shifted(fighter({ x: fx(0), y: fx(-30) }), fx(0), fx(-30));
    expect([f.x, f.y]).toEqual([fx(0), fx(-30)]);
  });

  it("holds a fighter that was above a hard surface on top of it", () => {
    const f = shifted(fighter({ x: fx(10), y: fx(-5), vy: fx(-1), grounded: false }), fx(10), fx(1));
    expect(f.y).toBe(0);
    // Only the position: the fighter is frozen, so nothing about its motion changes.
    expect(f.vy).toBe(fx(-1));
    expect(f.grounded).toBe(false);
  });

  it("holds a standing fighter on the floor when the shift is straight down", () => {
    const f = shifted(fighter({ x: 0, y: fx(-1), grounded: true, platform: 0 }), 0, 0);
    expect(f.y).toBe(0);
    expect(f.grounded).toBe(true);
  });

  it("holds a fighter that was above a soft platform on top of it, but lets one rise through from below", () => {
    expect(shifted(fighter({ x: 0, y: fx(25) }), 0, fx(31)).y).toBe(fx(30));
    expect(shifted(fighter({ x: 0, y: fx(35) }), 0, fx(25)).y).toBe(fx(35));
  });

  it("finds a moving soft platform where it is this frame", () => {
    const moving: StageDef = {
      ...STAGE,
      platforms: [
        { x: 0, y: fx(30), halfWidth: fx(20), soft: true, ledges: false, motion: { kind: "sweep", amplitude: fx(40), periodFrames: 240 } },
      ],
    };
    // A quarter of the way round the sweep, the platform's centre is at x = 40.
    expect(platformCentreX(moving.platforms[0], 60)).toBe(fx(40));
    expect(shifted(fighter({ x: fx(40), y: fx(25) }), fx(40), fx(31), moving, 60).y).toBe(fx(30));
  });

  it("pushes a fighter that was beside the stage back out of its side", () => {
    // The ECB's side point stops at the wall face, half a body out (as `resolveCollision` does).
    const right = shifted(fighter({ x: fx(77), y: fx(-10) }), fx(87), fx(-10));
    expect(right.x).toBe(fx(80) + ATTRS.width);
    const left = shifted(fighter({ x: fx(-77), y: fx(-10) }), fx(-87), fx(-10));
    expect(left.x).toBe(fx(-80) - ATTRS.width);
  });

  // The lip: the origin is just past the edge but the fighter is above the
  // surface, and the shift carries it back over the span. `resolveCollision` lands
  // that fighter (its wall test is "Strictly above: a fighter level with the surface
  // last frame (one stepping or dropping off it) is already at the wall, not landing
  // on it", `physics.ts`), so the shift does too, instead of throwing it out sideways.
  // On the real Battlefield (`BATTLEFIELD`): its main platform reaches 79.99 and its
  // floor is at y = 0.111, not 0 (`stages/battlefield.ts`); the fighter starts 1.51
  // beyond the ledge. (A hand-built stage at y = 0 stood in until the Task 11 re-review.)
  it("lands a fighter above the surface on a diagonal shift back over the lip, not out sideways", () => {
    const f = shifted(fighter({ x: fx(-79.5), y: fx(-1) }), fx(-81.5), fx(1), BATTLEFIELD);
    expect([f.x, f.y]).toEqual([fx(-79.5), fx(0.111)]);
    // ...as the collision phase does for the same move.
    const g = fighter({ x: fx(-79.5), y: fx(-1) });
    expect(resolveCollision(g, fx(-81.5), fx(1), BATTLEFIELD, ATTRS, 0).landed).toBe(true);
    expect(g.x).toBe(fx(-79.5));
    expect(g.y).toBe(fx(0.111));
  });

  // The edge tie (Task 11 re-review; Plan 3 final wave): a fighter exactly level with the
  // surface, beside the stage, is at the wall in `resolveCollision` ("Strictly above"), so
  // a shift that carries it back over the span pushes it out sideways there too.
  it("pushes a fighter level with the surface beside the stage out sideways, as the wall does", () => {
    // Level: the previous frame's origin is exactly Battlefield's floor, 0.111.
    const f = shifted(fighter({ x: fx(-79.5), y: fx(-2) }), fx(-81.5), fx(0.111), BATTLEFIELD);
    const g = fighter({ x: fx(-79.5), y: fx(-2) });
    const out = resolveCollision(g, fx(-81.5), fx(0.111), BATTLEFIELD, ATTRS, 0);
    expect(out.landed).toBe(false);
    expect([g.x, g.y]).toEqual([fx(-79.99) - ATTRS.width, fx(-2)]);
    expect([f.x, f.y]).toEqual([g.x, g.y]);
  });

  it("stops a fighter that was under the stage at its underside", () => {
    const head = ATTRS.height;
    const f = shifted(fighter({ x: 0, y: -HARD_PLATFORM_DEPTH - head + fx(9) }), 0, -HARD_PLATFORM_DEPTH - head - fx(1));
    expect(f.y).toBe(-HARD_PLATFORM_DEPTH - head);
  });

  it("keeps a fighter at the ledge level when the shift is straight down", () => {
    // Its origin is exactly at the edge: it is on the surface, not beside the wall.
    const f = shifted(fighter({ x: fx(80), y: fx(-2) }), fx(80), 0);
    expect([f.x, f.y]).toEqual([fx(80), 0]);
  });

  it("does not touch a fighter that was already inside the body", () => {
    const f = shifted(fighter({ x: 0, y: fx(-31) }), 0, fx(-30));
    expect([f.x, f.y]).toEqual([0, fx(-31)]);
  });

  // Plan 4, ruling R6: with a bake the fighter's body is its bones' ECB, which `step`
  // passes in, so a shift is kept out by the same body `resolveCollision` pushes.
  it("keeps the ECB it is given out of the stage, not the attributes' box (Plan 4, R6)", () => {
    const bones = { bottom: 0, top: fx(20), half: fx(7) };
    // Beside the wall: 85 is clear of the box (80 + 4) but inside the bones' body (80 + 7).
    const side = fighter({ x: fx(85), y: fx(-10) });
    clampShiftToStage(side, fx(90), fx(-10), STAGE, ATTRS, 0, bones);
    expect(side.x).toBe(fx(87));
    expect(shifted(fighter({ x: fx(85), y: fx(-10) }), fx(90), fx(-10)).x).toBe(fx(85));
    // Under the stage: the bones' head is 20 up, not 12.
    const under = fighter({ x: 0, y: -HARD_PLATFORM_DEPTH - fx(19) });
    clampShiftToStage(under, 0, -HARD_PLATFORM_DEPTH - fx(21), STAGE, ATTRS, 0, bones);
    expect(under.y).toBe(-HARD_PLATFORM_DEPTH - fx(20));
  });

  it("never leaves a shifted fighter inside the body, whichever way it comes in", () => {
    const reach = fx(80) + ATTRS.width;
    const inside = (x: number, y: number): boolean =>
      Math.abs(x) < reach && y < 0 && y + ATTRS.height > -HARD_PLATFORM_DEPTH;
    // Every non-overlapping start on a grid around the stage, every stick direction, a few pulses.
    for (let x = -100; x <= 100; x += 3) {
      for (let y = -80; y <= 20; y += 3) {
        if (inside(fx(x), fx(y))) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const f = fighter({ x: fx(x), y: fx(y) });
          for (let pulse = 0; pulse < 5; pulse++) {
            const fromX = f.x;
            const fromY = f.y;
            f.x += dx * fx(2.3);
            f.y += dy * fx(2.3);
            clampShiftToStage(f, fromX, fromY, STAGE, ATTRS, 0);
            expect(inside(f.x, f.y)).toBe(false);
          }
        }
      }
    }
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

  // Plan 3, Task 15 (fix round 1). SmashWiki "Ledge" (https://www.ssbwiki.com/Ledge): "Multiple
  // characters cannot hold onto an edge at the same time". A ledge trump takes it from a hanging
  // fighter (the grab succeeds; `step` trumps), but SmashWiki "Ledge trump" has buffering an
  // option "the moment it is grabbed" avoid it, so a fighter in an option keeps its ledge.
  // UNVERIFIED: that the ledge is refused for the whole option.
  describe("a ledge another fighter is performing an option on", () => {
    const asking = (): FighterState => fighter({ port: 0, x: fx(82), y: fx(-2), vy: -fx(1), facing: -1 });
    const holding = (action: ActionState, over: Partial<FighterState> = {}): FighterState =>
      fighter({ port: 1, x: fx(80), y: 0, action, ledge: { platform: 0, side: 1 }, intangible: 30, ...over });

    it.each(["ledgeGetUp", "ledgeRoll", "ledgeAttack", "ledgeJump"] as const)("cannot be grabbed during %s", (action) => {
      const me = asking();
      expect(findLedgeGrab(me, STAGE, 0, 0, [me, holding(action)])).toBeNull();
    });

    it("can be grabbed while the fighter on it hangs: the grab trumps it", () => {
      const me = asking();
      expect(findLedgeGrab(me, STAGE, 0, 0, [me, holding("ledgeHang")])).toEqual({ platform: 0, side: 1 });
    });

    it("is free once the option has left it", () => {
      const me = asking();
      expect(findLedgeGrab(me, STAGE, 0, 0, [me, holding("ledgeJump", { ledge: null })])).toEqual({ platform: 0, side: 1 });
    });

    it("is that one ledge only", () => {
      const me = asking();
      const far = holding("ledgeRoll", { x: fx(-80), ledge: { platform: 0, side: -1 } });
      expect(findLedgeGrab(me, STAGE, 0, 0, [me, far])).toEqual({ platform: 0, side: 1 });
    });

    // The ledge is one platform's one side: an option on a *different platform's* ledge
    // on the same side leaves this one free (`inLedgeOption` compares both).
    it("is that one platform's ledge only", () => {
      const twoLedges: StageDef = {
        ...STAGE,
        platforms: [STAGE.platforms[0], { x: 0, y: fx(40), halfWidth: fx(80), soft: false, ledges: true }],
      };
      const me = asking();
      const upstairs = holding("ledgeRoll", { y: fx(40), ledge: { platform: 1, side: 1 } });
      expect(findLedgeGrab(me, twoLedges, 0, 0, [me, upstairs])).toEqual({ platform: 0, side: 1 });
      // The same fighter on this platform's ledge does shut it.
      expect(findLedgeGrab(me, twoLedges, 0, 0, [me, holding("ledgeRoll")])).toBeNull();
    });

    // The list knows the fighter asking by its port, so a copy of it is not another fighter.
    it("does not count the fighter asking, or a copy of it", () => {
      const me = asking();
      const mine = holding("ledgeJump", { port: 0 });
      expect(findLedgeGrab(me, STAGE, 0, 0, [mine])).toEqual({ platform: 0, side: 1 });
    });
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

describe("the environment collision box (ECB)", () => {
  // Ultimate collides a fighter with the stage through a four-point diamond —
  // bottom, top, left, right — whose bottom is locked to the feet on the ground
  // (research/rebuild-2026-10/README.md §3, "ECB"). This is a partial seam, and
  // its rule is UNVERIFIED: the size is the hurtbox's, the bottom stays at the
  // feet in the air too, walls test the side points against the platform's
  // span (a rectangle, not the diamond's slanted edges), and ceilings still use
  // the platform's reach. Plan 4 derives the diamond from bones and completes it.

  it("is a diamond on the hurtbox, its bottom at the feet", () => {
    const e = ecbOf(fighter({ grounded: true }), ATTRS);
    expect(e).toEqual({ bottom: 0, top: ATTRS.height, half: ATTRS.width });
    const pts = ecbPoints(fighter({ x: fx(10), y: fx(5) }), ATTRS);
    expect(pts.left).toEqual({ x: fx(10) - ATTRS.width, y: fx(5) + ATTRS.height / 2 });
    expect(pts.right).toEqual({ x: fx(10) + ATTRS.width, y: fx(5) + ATTRS.height / 2 });
    expect(pts.bottom).toEqual({ x: fx(10), y: fx(5) });
    expect(pts.top).toEqual({ x: fx(10), y: fx(5) + ATTRS.height });
  });

  it("reaches a ledge from the side of the body, not the middle of it (Review Focus #5)", () => {
    const half = ATTRS.width;
    const reach = LEDGE_GRAB_RANGE_X;
    // Origin just inside 3.2 + half from the ledge at x = 80: the body's side is within 3.2.
    const near = fighter({ x: fx(80) + reach + half - fx(0.05), y: fx(-2), vy: -fx(1), facing: -1 });
    expect(findLedgeGrab(near, STAGE, 0, half)).toEqual({ platform: 0, side: 1 });
    expect(findLedgeGrab(near, STAGE, 0)).toBeNull(); // the legacy origin rule would not reach
    const far = fighter({ x: fx(80) + reach + half + fx(0.05), y: fx(-2), vy: -fx(1), facing: -1 });
    expect(findLedgeGrab(far, STAGE, 0, half)).toBeNull();
  });

  it("still takes the ledge a fighter walked off, after the wall pushes the body clear", () => {
    // Origin left the platform last frame, body still overlapping the wall.
    const f = fighter({ x: fx(81), y: fx(-1), vy: -fx(1), facing: 1, grounded: false, platform: -1 });
    resolveCollision(f, fx(80.5), 0, STAGE, ATTRS, 0);
    expect(f.x).toBe(fx(80) + ATTRS.width);
    // A fighter who walked off faces out, away from the ledge: the rear grab box reaches it.
    expect(findLedgeGrab(f, STAGE, 0, ATTRS.width)).toEqual({ platform: 0, side: 1 });
  });

  // Plan 4: with a bake the ECB is this frame's bones' (`acmd/hurtboxes.ts`), which
  // `step` passes in; without one it is still the box above.
  it("pushes and stops the ECB it is given, not the attributes' box (Plan 4)", () => {
    const bones = { bottom: 0, top: fx(20), half: fx(7) };
    // The wall: the bones' side point, 7 out, not the box's 4.
    const f = fighter({ x: fx(81), y: fx(-1), vy: -fx(1), facing: 1 });
    resolveCollision(f, fx(80.5), 0, STAGE, ATTRS, 0, { ecb: bones });
    expect(f.x).toBe(fx(87));
    // The ceiling: a head 20 up meets the underside the box's 12 would still be below.
    const rising = (ecb?: typeof bones) => {
      const g = fighter({ x: 0, y: -HARD_PLATFORM_DEPTH - fx(19), vy: fx(2) });
      const out = resolveCollision(g, 0, -HARD_PLATFORM_DEPTH - fx(21), STAGE, ATTRS, 0, ecb === undefined ? {} : { ecb });
      return { y: g.y, ceiling: out.ceiling };
    };
    expect(rising(bones)).toEqual({ y: -HARD_PLATFORM_DEPTH - fx(20), ceiling: true });
    expect(rising()).toEqual({ y: -HARD_PLATFORM_DEPTH - fx(19), ceiling: false });
  });

  // Plan 4 Task 12, fix round 1 (C1): a bone ECB changes shape every frame, so the
  // underside cannot ask whether last frame's position was below it with THIS frame's
  // top. A body stopped there, whose pose is then any taller, would read as already
  // inside and rise through the stage. It asks whether the feet were below.
  it("stops a rising body at the underside even when its top grew since the stop (fix round 1, C1)", () => {
    const bottom = -HARD_PLATFORM_DEPTH;
    // Last frame the underside stopped a top of 20 (its head exactly there); now the
    // pose is taller, by a unit or by one Q12 step, and it rises 2.
    for (const grown of [fx(21), fx(20) + 1]) {
      const prevY = bottom - fx(20);
      const f = fighter({ x: 0, y: prevY + fx(2), vy: fx(2) });
      const out = resolveCollision(f, 0, prevY, STAGE, ATTRS, 0, { ecb: { bottom: 0, top: grown, half: fx(4) } });
      expect(out.ceiling, `top ${grown}`).toBe(true);
      expect(f.y, `top ${grown}`).toBe(bottom - grown);
    }
  });

  it("leaves a body whose feet were already inside the stage to the stage, as before", () => {
    // Feet inside the solid body last frame (between its underside and its surface):
    // nothing pushes it down out of the stage, as nothing did with Plan 2's box.
    const f = fighter({ x: 0, y: -fx(29), vy: fx(2) });
    const out = resolveCollision(f, 0, -fx(31), STAGE, ATTRS, 0, { ecb: { bottom: 0, top: fx(20), half: fx(4) } });
    expect(out.ceiling).toBe(false);
    expect(f.y).toBe(-fx(29));
  });

  it("pushes a body moving away from the wall clear without stopping it", () => {
    // Launched outward from the lip: the body still overlaps the wall, the motion leaves it.
    for (const side of [1, -1] as const) {
      const out = fx(1) * side;
      const f = fighter({ x: fx(81.5) * side, y: fx(-1), vx: out, kinetic: { ...emptyKinetic(), damageX: out } });
      const res = resolveCollision(f, fx(80.5) * side, fx(-0.5), STAGE, ATTRS, 0);
      expect(f.x, `side ${side}`).toBe((fx(80) + ATTRS.width) * side);
      expect(f.vx, `side ${side}`).toBe(out);
      expect(f.kinetic.damageX, `side ${side}`).toBe(out);
      expect(res.landed, `side ${side}`).toBe(false);
    }
  });

  it("lands a fighter that falls onto the corner from above, rather than shoving it off the wall", () => {
    // Above the surface last frame and inside the span now: a landing, not a wall.
    const f = fighter({ x: fx(79.5), y: fx(-0.3), vx: -fx(1), vy: -fx(0.8), facing: -1 });
    const out = resolveCollision(f, fx(80.5), fx(0.5), STAGE, ATTRS, 0);
    expect(out.landed).toBe(true);
    expect(out.blocked).toBe(false);
    expect(f.grounded).toBe(true);
    expect(f.platform).toBe(0);
    expect(f.y).toBe(0);
    expect(f.x).toBe(fx(79.5)); // the end-of-frame x: a landing does not move it back to where it crossed
  });
});
