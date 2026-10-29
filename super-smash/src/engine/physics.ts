/**
 * Movement, gravity, and the geometry a fighter can stand on.
 *
 * **The world is y-up and a fighter's origin is at its feet.** Both follow from
 * the stage data: blast zones are quoted as "top 192 / bottom −140" and a
 * platform carries a single `y` that is its *top surface*, so a fighter standing
 * on it has exactly that y. Every sign in this file reads off those two facts —
 * gravity subtracts from `vy`, falling means `vy < 0`, and landing means crossing
 * a surface downward.
 *
 * The functions come in two shapes. The small ones (`fastFallVelocity`,
 * `platformCentreX`) are pure: value in, value out, so a single rule can be
 * tested without building a stage. The big ones (`resolveCollision`) mutate the
 * `FighterState` handed to them, because by the time they run `step()` is
 * already working on its clone and copying a fighter twice per frame to
 * preserve a purity that nobody can observe would cost the rollback budget for
 * nothing.
 */

import { airDodgeKeepsAir, airDodgeRefusesLedge } from "./airDodge";
import { ONE, fx, mul, abs, clamp, approach, sinDeg } from "./fixed";
import {
  BALLOON_FALL_SPEED,
  LEDGE_AIRTIME_CAP,
  LEDGE_GRAB_BACK_PENALTY,
  LEDGE_GRAB_RANGE_X,
  LEDGE_GRAB_RANGE_Y,
  LEDGE_INTANGIBILITY_BASE,
  LEDGE_INTANGIBILITY_MAX,
  LEDGE_INTANGIBILITY_MIN,
  LEDGE_PERCENT_CAP,
  LEDGE_PERCENT_PENALTY,
  LEDGE_REGRAB_SCALING,
} from "./constants";
import { kineticAirDodgeHold, kineticLand, kineticSetX, kineticSetY, kineticTakeStep } from "./kinetic";
import { TURN } from "./knockback";
import type { FighterAttributes, FighterState, Platform, StageDef } from "./types";

/* ------------------------------------------------------------- constants -- */

/**
 * How deep a solid stage body reaches below its top surface.
 *
 * `Platform` carries a surface and a half-width but no thickness, because that
 * is all a *soft* platform needs. A hard platform needs a bottom to have walls
 * you can be pushed off and a ceiling you can be launched into, and 60 units —
 * roughly three fighter heights — is deep enough that nobody clips under Final
 * Destination and shallow enough that being under the stage is still a place you
 * can be, which is where every edgeguard in the game happens.
 */
export const HARD_PLATFORM_DEPTH = fx(60);

/** A top-blast KO faster than this reads as a screen KO rather than a star KO. */
export const SCREEN_KO_SPEED = fx(2.4);

/* ---------------------------------------------------------------- motion -- */

export interface GravityOptions {
  /** Read by the legacy `applyGravity` oracle only; the engine's fast fall is `FighterState.fastFalling`. */
  readonly fastFalling?: boolean;
  /**
   * The fighter is in hitstun from a near-vertical launch, so it falls by its
   * `damage_fly_top_*` params (`kineticReel`) instead of its ordinary gravity —
   * Ultimate's "balloon knockback", the reason a vertical kill move hangs at
   * the top of the screen.
   */
  readonly balloon?: boolean;
}

/**
 * Fast-falling snaps the fall speed; it does not add acceleration.
 *
 * This is why a fast fall is instant and irreversible: pressing down replaces the
 * velocity outright, and there is no way back to the slower fall until the
 * fighter lands. Fox's 3.68 fast fall against his 2.3 normal is a step change on
 * one frame, which is exactly what makes his landings hard to read.
 */
export function fastFallVelocity(attrs: FighterAttributes): number {
  return -attrs.fastFallSpeed;
}

/** Position integration. Velocities are units per frame, so this is an add. */
export function integrate(f: FighterState): void {
  // A sped-up launch frame plays several reaction frames; the extra ones'
  // displacement rides along (Plan 3, Task 6).
  const step = kineticTakeStep(f);
  f.x += f.vx + step.x;
  f.y += f.vy + step.y;
}

/**
 * Terminal velocity for a fighter currently reeling from a hit.
 *
 * `balloon` is *read*, never recomputed. The launch angle at contact decided it
 * (`knockbackToVelocity`), and the current velocity is no longer evidence of it:
 * gravity and the flat launch decay rotate the trajectory every frame, so a 45°
 * launch passes through the 70°–110° cone on the way down and a test against
 * `vx`/`vy` would switch the victim to balloon fall halfway through its hitstun.
 */
export function hitstunGravityOptions(f: FighterState): GravityOptions {
  return { balloon: f.hitstun > 0 && f.balloon };
}

/* ------------------------------------------ legacy movement (test oracles) -- */

/*
 * The pre-Plan-2 movement rules, on one `vx`/`vy`: gravity, walking, traction
 * and air drift. **TEST-ONLY: the engine calls none of them.** Its movement is
 * the KineticModule's (`kinetic.ts`: `gravityStep`, `airControlX`, and the
 * walk and stop brakes in `kineticExec`), so one rule of each ships. These
 * stay, frozen, as the oracle `kinetic.test.ts` holds `kineticExec` to through
 * `paramsFromAttributes`, and `physics.test.ts` pins them (DECISIONS D55).
 * Engine code must not call them, and `layering.test.ts` fails if any non-test
 * source but this file names one. The dash and run helpers went once those
 * kinetic types left the legacy rule (Task 23): nothing held them to anything.
 */

/** Legacy walking acceleration (`walkVelocity`): 2 × traction. */
const WALK_ACCEL_FACTOR = 2;

/**
 * One frame of gravity, terminal velocity included. Test oracle; the engine's
 * is `gravityStep`.
 *
 * Fast-falling is a *set*, not an acceleration — see `fastFallVelocity` — so all
 * this does is lower the floor the terminal velocity clamps to.
 */
export function applyGravity(
  vy: number,
  attrs: FighterAttributes,
  opts: GravityOptions = {},
): number {
  const terminal = opts.balloon
    ? BALLOON_FALL_SPEED
    : opts.fastFalling
      ? attrs.fastFallSpeed
      : attrs.fallSpeed;
  const next = vy - attrs.gravity;
  return next < -terminal ? -terminal : next;
}

/** Walking: approach the walk speed at twice traction. Test oracle. */
export function walkVelocity(vx: number, dir: number, attrs: FighterAttributes): number {
  return approach(vx, dir * attrs.walkSpeed, attrs.traction * WALK_ACCEL_FACTOR);
}

/** Friction. The one primitive behind skidding, run-braking and standing still. Test oracle. */
export function applyTraction(vx: number, attrs: FighterAttributes): number {
  return approach(vx, 0, attrs.traction);
}

/**
 * Air drift: base plus additional acceleration, capped at the fighter's air
 * speed. Test oracle; the engine's is `airControlX`.
 *
 * The cap is one-directional on purpose. A fighter launched at eight units a
 * frame is well past its own air speed, and drifting *back* is allowed while
 * drifting further out is not — otherwise DI'ing away from the stage would add
 * to the launch instead of merely failing to fight it. Releasing the stick keeps
 * the momentum: this legacy rule has no air friction (the engine's has, D55).
 */
export function airDrift(vx: number, stickX: number, attrs: FighterAttributes): number {
  if (stickX === 0) return vx;
  const accel = attrs.airAccelBase + attrs.airAccelAdditional;
  if (stickX > 0 && vx >= attrs.airSpeed) return vx;
  if (stickX < 0 && vx <= -attrs.airSpeed) return vx;
  return approach(vx, stickX > 0 ? attrs.airSpeed : -attrs.airSpeed, accel);
}

/* -------------------------------------------------------------- platforms -- */

/** Where a platform's centre is this frame. Only Smashville's actually moves. */
export function platformCentreX(p: Platform, frame: number): number {
  if (!p.motion) return p.x;
  const period = p.motion.periodFrames;
  const phase = Math.trunc((TURN * (((frame % period) + period) % period)) / period);
  return p.x + mul(p.motion.amplitude, sinDeg(phase));
}

export interface CollisionOutcome {
  /** The fighter touched down this frame. */
  landed: boolean;
  /** The fighter walked off the surface it was standing on. */
  leftGround: boolean;
  /** A wall or a ceiling pushed the fighter clear (and stopped it, if it was moving into it). */
  blocked: boolean;
  /**
   * A wall stopped the fighter's motion into it, and which way from the
   * fighter: 1 to its right, −1 to its left, 0 none (Plan 3, Task 12: a
   * tumbling fighter techs or bounces off it). A body pushed clear while
   * moving along or away from the wall was not stopped by it, so it is 0.
   */
  wall: number;
  /** A hard platform's underside stopped the fighter rising into it. */
  ceiling: boolean;
}

export interface CollisionOptions {
  /**
   * The fighter is deliberately passing through soft platforms — dropping through
   * from above, or rising through from below. There is no `dropThrough` field in
   * `FighterState`, so a drop places the fighter one unit *below* the surface it
   * left and the "was above last frame" test in `resolveCollision` declines to
   * catch it again. The flag exists for the frame of the drop itself.
   */
  readonly passThroughSoft?: boolean;
  /**
   * A grounded fighter that reaches the edge of its platform stops there rather
   * than walking off it. UNVERIFIED: the game's catch statuses (CATCH, CATCH_WAIT,
   * CATCH_ATTACK, THROW) use `GROUND_CORRECT_KIND_GROUND_CLIFF_STOP`; the replica
   * has no per-status ground-correct kind, so the four statuses pass this flag
   * (Plan 3, Task 14, fix round 2). Nothing else in the engine stops at a cliff.
   */
  readonly cliffStop?: boolean;
  /** This frame's ECB from the bake (Plan 4); `ecbOf` when absent. */
  readonly ecb?: Ecb;
}

/**
 * Land on things, be stopped by things, walk off things.
 *
 * A landing is a *crossing*, not an overlap: the fighter must have been at or
 * above the surface last frame and at or below it now, and must be moving down.
 * Testing overlap instead is how you get fighters snapping up onto platforms they
 * jumped past, and how a fast-faller teleports onto Battlefield's top platform
 * from underneath.
 */
export function resolveCollision(
  f: FighterState,
  prevX: number,
  prevY: number,
  stage: StageDef,
  attrs: FighterAttributes,
  frame: number,
  opts: CollisionOptions = {},
): CollisionOutcome {
  const out: CollisionOutcome = { landed: false, leftGround: false, blocked: false, wall: 0, ceiling: false };
  const ecb = opts.ecb ?? ecbOf(f, attrs);

  // Already standing on something: the only question is whether it is still there.
  if (f.grounded && f.platform >= 0 && f.platform < stage.platforms.length) {
    const p = stage.platforms[f.platform];
    const cx = platformCentreX(p, frame);
    if (opts.cliffStop === true && abs(f.x - cx) > p.halfWidth) {
      // At the edge: stop on it, not over it, and stay grounded.
      f.x = f.x > cx ? cx + p.halfWidth : cx - p.halfWidth;
      kineticSetX(f, 0);
    }
    if (abs(f.x - cx) > p.halfWidth) {
      f.grounded = false;
      f.platform = -1;
      out.leftGround = true;
    } else if (f.vy > 0) {
      // Rising off the surface, so this fighter is no longer standing on it.
      //
      // Without this the branch below pinned `y` to the platform and zeroed
      // `vy` every frame, and the only way out of `grounded` was to walk off
      // the edge — so a *scripted* upward movement could never lift anybody.
      // `applyMoveMomentum` set the velocity correctly and this threw it away
      // on the same frame, which is why Samus's Screw Attack and Marth's
      // Dolphin Slash both played their rising animation on the spot. Two
      // character agents found it independently, from opposite ends of the
      // roster, each having first suspected their own capture tooling.
      //
      // A jump does not come through here — `states.ts` clears `grounded`
      // itself on the jumpSquat transition — so this only reaches the case
      // that was silently broken: a move whose own data says it goes up.
      f.grounded = false;
      f.platform = -1;
      out.leftGround = true;
    } else {
      // A moving platform carries its passenger; Smashville is unplayable otherwise.
      if (p.motion) f.x += cx - platformCentreX(p, frame - 1);
      f.y = p.y;
      kineticSetY(f, 0);
      return out;
    }
  }

  // Walls and ceilings, before landing. A fighter that was above a surface last
  // frame is a landing candidate, not a wall hit: the wall leaves it to the
  // landing test below, so a fall onto the corner still lands.
  for (const p of stage.platforms) {
    if (p.soft) continue;
    const cx = platformCentreX(p, frame);
    // The wall stops the ECB's side point: the body, not the middle of it.
    // The ledge grab box is measured from the same side point (`findLedgeGrab`),
    // so a fighter pushed clear of the wall is still at the ledge it left.
    const reach = p.halfWidth;
    const body = reach + ecb.half;
    const bottom = p.y - HARD_PLATFORM_DEPTH;
    const head = f.y + ecb.top;
    // Only a fighter whose origin was outside the platform's span last frame is
    // pushed out. Testing containment instead would shove anybody standing under
    // the stage sideways, and under the stage is where every edgeguard happens.
    const cameFromOutside = abs(prevX - cx) >= reach;
    // Strictly above: a fighter level with the surface last frame (one stepping
    // or dropping off it) is already at the wall, not landing on it.
    const wasAbove = prevY + ecb.bottom > p.y;
    if (cameFromOutside && !wasAbove && f.y + ecb.bottom < p.y && head > bottom && abs(f.x - cx) < body) {
      const fromLeft = prevX <= cx;
      f.x = fromLeft ? cx - body : cx + body;
      // The push puts the body back outside; only motion *into* the wall is
      // stopped. A fighter launched out from the lip keeps its knockback, and
      // the wall is only reported (`wall`) when it actually stopped something.
      if (fromLeft ? f.vx > 0 : f.vx < 0) {
        kineticSetX(f, 0);
        out.wall = fromLeft ? 1 : -1;
      }
      out.blocked = true;
    }
    // Ceiling: the ECB's top rising into the underside of a solid body, from below it:
    // the feet were under the underside last frame. Not "the head was": with a bake the
    // ECB is this frame's bones' and changes shape every frame, so last frame's position
    // with this frame's top can read a body the underside stopped, its pose now any
    // taller, as already inside, and it rose through the stage (Plan 4, Task 12 fix
    // round 1). Nor last frame's own top: a pose can reach into the underside before
    // the body ever rises (the tech lab's Donkey Kong). Feet below and head above is a
    // body in the stage from underneath, and it is pushed back down.
    if (f.vy > 0 && abs(f.x - cx) < reach && prevY + ecb.bottom < bottom && head > bottom) {
      f.y = bottom - ecb.top;
      kineticSetY(f, 0);
      out.blocked = true;
      out.ceiling = true;
    }
  }

  if (f.vy > 0) return out;

  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    if (p.soft && opts.passThroughSoft) continue;
    const cx = platformCentreX(p, frame);
    if (abs(f.x - cx) > p.halfWidth) continue;
    // The ECB's bottom point does the landing.
    if (prevY + ecb.bottom < p.y) continue; // was already below the surface — no landing from under
    if (f.y + ecb.bottom > p.y) continue; // still above it
    f.y = p.y - ecb.bottom;
    // A directional air dodge's slingshot does not land: it is held on the
    // surface, in the air and in the dodge, its step into the floor stopped,
    // until the slide carries it off (`airDodgeKeepsAir`; Plan 3, Task 20c,
    // UNVERIFIED).
    if (airDodgeKeepsAir(f)) {
      kineticAirDodgeHold(f);
      return out;
    }
    kineticSetY(f, 0);
    f.grounded = true;
    f.platform = i;
    f.fastFalling = false;
    f.jumpsUsed = 0;
    f.airDodged = false;
    f.airTime = 0;
    kineticLand(f);
    f.ledge = null;
    f.ledgeLockout = 0;
    out.landed = true;
    return out;
  }

  return out;
}

/**
 * Keep a fighter that was *shifted* out of the stage's solid bodies.
 *
 * SDI and ASDI move a fighter who is frozen in hitlag, and a frozen fighter
 * skips the collision phase, so nothing stopped a shift from carrying the body
 * into the stage: down through a floor (after which nothing lands it, because
 * "was already below the surface — no landing from under"), in through a wall
 * (a fighter whose origin has crossed the edge "came from inside" and is never
 * pushed), or up into an underside. This applies the rules of `resolveCollision`
 * to the shift alone — `(prevX, prevY)` is where the fighter was before it, and
 * only a shift that *newly* overlaps a body is undone, so a fighter already
 * overlapping something is left as it was — and, unlike it, touches no
 * velocity and no grounded state: the fighter is still frozen, and its launch
 * has not happened yet.
 *
 * The way in decides the way out, as in `resolveCollision`: a fighter that was
 * above the surface and is over the span now lands on it; one whose origin was
 * beyond the platform's edge is otherwise pushed back out sideways; one whose
 * origin was within its span stays on top of it (or, from below, under it).
 * A soft platform only ever has the floor.
 *
 * The body is `ecb`, the one `resolveCollision` is given this frame: with a
 * bake, the bones' (Plan 4, ruling R6). A shift kept out by a smaller body
 * could leave the bones' ECB inside a wall that `resolveCollision`, finding the
 * origin already past the edge, would never push it out of. `ecbOf` when absent.
 */
export function clampShiftToStage(
  f: FighterState,
  prevX: number,
  prevY: number,
  stage: StageDef,
  attrs: FighterAttributes,
  frame: number,
  ecb: Ecb = ecbOf(f, attrs),
): void {
  if (f.x === prevX && f.y === prevY) return;
  for (const p of stage.platforms) {
    const cx = platformCentreX(p, frame);
    const reach = p.halfWidth;
    // At or above the surface before the shift (the ECB's bottom point decides).
    const wasAbove = prevY + ecb.bottom >= p.y;
    // Strictly above: `resolveCollision`'s wall test. One level with the surface
    // beside the stage is at the wall, not landing on it (Plan 3 final wave; the
    // Task 11 re-review's edge tie).
    const wasStrictlyAbove = prevY + ecb.bottom > p.y;
    if (p.soft) {
      if (wasAbove && f.y + ecb.bottom < p.y && abs(f.x - cx) <= reach) f.y = p.y - ecb.bottom;
      continue;
    }
    const body = reach + ecb.half;
    const bottom = p.y - HARD_PLATFORM_DEPTH;
    const inside = (x: number, y: number): boolean =>
      abs(x - cx) < body && y + ecb.bottom < p.y && y + ecb.top > bottom;
    if (inside(prevX, prevY) || !inside(f.x, f.y)) continue;
    // From above and now over the span: it lands, as `resolveCollision`'s landing
    // test lands it, even if its origin started past the edge (the lip). Strictly
    // above, as there: a fighter level with the surface past the edge is pushed
    // out sideways below, as `resolveCollision`'s wall pushes it.
    if (wasStrictlyAbove && abs(f.x - cx) <= reach) f.y = p.y - ecb.bottom;
    else if (abs(prevX - cx) > reach) f.x = prevX <= cx ? cx - body : cx + body;
    else if (wasAbove) f.y = p.y - ecb.bottom;
    else f.y = bottom - ecb.top;
  }
}

/**
 * Step a fighter off the platform it is standing on, downward through it.
 *
 * Placing it one fixed-point unit below the surface is what replaces the
 * drop-through flag `FighterState` has no room for: next frame the landing test
 * asks "were you above this surface last frame?", the answer is no, and the
 * fighter keeps falling.
 */
export function dropThroughPlatform(f: FighterState, stage: StageDef): boolean {
  if (!f.grounded || f.platform < 0 || f.platform >= stage.platforms.length) return false;
  if (!stage.platforms[f.platform].soft) return false;
  f.y -= 1;
  f.grounded = false;
  f.platform = -1;
  // Dropping through is leaving the ground without a jump: the ground jump is
  // spent, the midair jumps are not (see `onLeftGround`).
  f.jumpsUsed = Math.max(f.jumpsUsed, 1);
  kineticSetY(f, 0);
  return true;
}

/* ------------------------------------------------------------------ ledge -- */

export interface LedgeGrab {
  readonly platform: number;
  /** −1 for the left-hand ledge, +1 for the right-hand one. */
  readonly side: number;
}

/** Is a fighter other than `port` performing a ledge option (it holds `ledge` but is not hanging) on this ledge? */
function inLedgeOption(fighters: readonly FighterState[], port: number, platform: number, side: number): boolean {
  return fighters.some(
    (o) => o.port !== port && o.ledge !== null && o.action !== "ledgeHang" && o.ledge.platform === platform && o.ledge.side === side,
  );
}

/**
 * Can this fighter grab a ledge right now, and which one?
 *
 * The rear grab box is 40% shorter (`LEDGE_GRAB_BACK_PENALTY`), which is the
 * mechanic behind every "I turned around and dropped" recovery death: facing away
 * from the stage costs you almost half your reach. Hitstun disqualifies you
 * entirely — you cannot grab a ledge while you are still reeling, which is what
 * makes a low off-stage hit lethal rather than an inconvenience. So does the
 * lockout (`ledgeLockout`): after letting go of a ledge or being hit or grabbed
 * off one it stops a drop regrabbing on the frame it happens, and after being
 * trumped off one (Plan 3, Task 15) it keeps the fighter from taking it back.
 * And so does a directional air dodge in its first 24 frames
 * (`airDodgeRefusesLedge`; SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge:
 * "all characters can grab edges after the first 24 frames of their directional
 * air dodge"; Plan 3, Task 20c). Being the one rule, it holds for the trump as
 * well: a dodging fighter refused here trumps nobody. A neutral air dodge grabs
 * a ledge on any frame. UNVERIFIED: SmashWiki "Lucario (SSBU)/Air dodge" has
 * "neutral air dodge grabs ledge on frame 60+", past the end of Lucario's
 * 48-frame dodge, and the mods disagree on the mechanism; not modelled (D56).
 *
 * `fighters` is everybody in the match, for the one rule that is not a property
 * of the fighter asking: a ledge cannot be shared (SmashWiki "Ledge": "Multiple
 * characters cannot hold onto an edge at the same time"). A fighter hanging on
 * it is trumped off by the grab (`step` does that), but one in the middle of a
 * ledge option (anyone with `ledge` set who is not in `ledgeHang`) keeps it until
 * the option has left it: SmashWiki "Ledge trump" has buffering an option "the
 * moment it is grabbed" avoid the trump, and the ledge cannot be shared.
 * UNVERIFIED: that the ledge is refused, rather than grabbed and trumped, for
 * the whole of an option. The fighter asking is told by its port, not by
 * identity, so a copy of it asks as it would.
 *
 * The default list is empty, so a call without one is told nobody holds a ledge: the
 * rule is skipped, it fails open. That is safe, not an oversight (Plan 3 final wave,
 * part 4; the Task 15 review's N3). This is a pure query: only a caller that acts on
 * the answer can break "one fighter to a ledge", and the one that does, `step`, passes
 * `s.fighters` (a test per option, in `combat.test.ts`, fails if it stops). A caller
 * that forgot the list would be shown a grab the rule refuses and could not make it;
 * failing closed instead would refuse every ledge to every caller that has no list to
 * give, which a query for geometry alone (the physics tests) is.
 */
export function findLedgeGrab(
  f: FighterState,
  stage: StageDef,
  frame: number,
  ecbHalf = 0,
  fighters: readonly FighterState[] = [],
): LedgeGrab | null {
  if (f.grounded || f.ledge !== null) return null;
  if (f.hitstun > 0 || f.hitlag > 0) return null;
  if (f.ledgeLockout > 0) return null; // just let go of a ledge, or was hit off one, or trumped off it
  if (airDodgeRefusesLedge(f)) return null; // the first 24 frames of a directional air dodge
  if (f.vy > 0) return null; // rising past a ledge does not snap you onto it

  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    if (!p.ledges) continue;
    const cx = platformCentreX(p, frame);
    for (const side of [-1, 1] as const) {
      const lx = cx + side * p.halfWidth;
      // Only reachable from outboard of the ledge.
      const outboard = (f.x - lx) * side;
      if (outboard < 0) continue;
      // Facing the ledge means facing back toward the stage: the opposite of the side.
      const facingLedge = f.facing === -side;
      const rangeX = facingLedge ? LEDGE_GRAB_RANGE_X : mul(LEDGE_GRAB_RANGE_X, LEDGE_GRAB_BACK_PENALTY);
      // Measured from the ECB's near side point (`ecbHalf` in from the origin).
      if (outboard - ecbHalf > rangeX) continue;
      const drop = p.y - f.y;
      if (drop < 0 || drop > LEDGE_GRAB_RANGE_Y) continue;
      if (inLedgeOption(fighters, f.port, i, side)) continue;
      return { platform: i, side };
    }
  }
  return null;
}

/** World position of a ledge, for snapping a fighter onto it. */
export function ledgePosition(
  stage: StageDef,
  grab: LedgeGrab,
  frame: number,
): { x: number; y: number } {
  const p = stage.platforms[grab.platform];
  return { x: platformCentreX(p, frame) + grab.side * p.halfWidth, y: p.y };
}

/**
 * `floor(60 × (airTime/300) + 64 − (percent/120) × 44)`, bounded to [24, 124],
 * then scaled by how many times this ledge has already been grabbed.
 *
 * Longer in the air means more invincibility, higher percent means less — a
 * fighter who has been off-stage for five seconds gets the full 124 frames, one
 * at 120% gets the floor of 24. The regrab scaling (1, 0.8, 0.5, then nothing)
 * is what stops ledge-stalling: from the third regrab you hang there naked.
 */
export function ledgeIntangibilityFrames(
  airTime: number,
  percent: number,
  regrabs: number,
): number {
  const air = Math.min(airTime, LEDGE_AIRTIME_CAP);
  const fromAir = Math.floor((60 * air) / LEDGE_AIRTIME_CAP);
  const fromPercent = Math.floor(
    (Math.min(percent, LEDGE_PERCENT_CAP) * LEDGE_PERCENT_PENALTY) / LEDGE_PERCENT_CAP,
  );
  const raw = clamp(
    fromAir + LEDGE_INTANGIBILITY_BASE - fromPercent,
    LEDGE_INTANGIBILITY_MIN,
    LEDGE_INTANGIBILITY_MAX,
  );
  const scaling = LEDGE_REGRAB_SCALING[Math.min(regrabs, LEDGE_REGRAB_SCALING.length - 1)];
  return Math.trunc((raw * scaling) / ONE);
}

/* ------------------------------------------------------------ blast zone -- */

export type KOKind = "blast" | "star" | "screen";

/**
 * Is this fighter outside the stage's rectangle, and how did it look?
 *
 * The distinction is cosmetic — a KO is a KO — but Ultimate draws it from the
 * speed at the boundary, so it belongs to the simulation rather than the
 * renderer: a slow drift over the top is a star KO with the twinkle, a fast one
 * is a screen KO that cracks the camera.
 */
export function blastZoneKO(f: FighterState, stage: StageDef): KOKind | null {
  const b = stage.blastZone;
  if (f.y > b.top) return f.vy >= SCREEN_KO_SPEED ? "screen" : "star";
  if (f.y < b.bottom) return "blast";
  if (f.x < b.left || f.x > b.right) return "blast";
  return null;
}

/* -------------------------------------------------------------------- ECB -- */

/**
 * The environment collision box: four points relative to the origin — bottom
 * (0, bottom), top (0, top), left (−half, mid) and right (+half, mid), mid
 * halfway up. Ultimate derives it from bones each frame and locks the bottom
 * to the feet on the ground (research/rebuild-2026-10/README.md §3, "ECB").
 *
 * UNVERIFIED as a rule: nothing public gives the sizes per fighter or per
 * animation. With a bake, `step` reads it off this frame's bones (Plan 4,
 * `acmd/hurtboxes.ts` `bakedEcb`: the top of the highest body capsule, never
 * an arm's, the pelvis capsule's reach to either side, the bottom at the feet)
 * and passes it to `resolveCollision`, `clampShiftToStage`, the ledge grab and
 * the trump.
 * `ecbOf` is Plan 2's box, what they read without one: the hurtbox's height
 * and half-width, its bottom at the feet in the air as well. Either way
 * `resolveCollision` tests the side points against a platform's span as a
 * rectangle (no slanted diamond edges) and keeps the platform's own reach for
 * ceilings.
 */
export interface Ecb {
  readonly bottom: number;
  readonly top: number;
  readonly half: number;
}

export function ecbOf(_f: Pick<FighterState, "grounded">, attrs: FighterAttributes): Ecb {
  return { bottom: 0, top: attrs.height, half: attrs.width };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The ECB's four points in world space, from Plan 2's box. The engine does not
 * call it: collision (`resolveCollision`) and ledge grabs read an ECB's bottom,
 * top and half-width as a rectangle, which these four points stand for.
 */
export function ecbPoints(
  f: Pick<FighterState, "x" | "y" | "grounded">,
  attrs: FighterAttributes,
): { bottom: Point; top: Point; left: Point; right: Point } {
  const e = ecbOf(f, attrs);
  const mid = f.y + Math.trunc((e.bottom + e.top) / 2);
  return {
    bottom: { x: f.x, y: f.y + e.bottom },
    top: { x: f.x, y: f.y + e.top },
    left: { x: f.x - e.half, y: mid },
    right: { x: f.x + e.half, y: mid },
  };
}
