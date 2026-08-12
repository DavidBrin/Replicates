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
 * The functions come in two shapes. The small ones (`applyGravity`, `airDrift`)
 * are pure: value in, value out, so a single rule can be tested without building
 * a stage. The big ones (`resolveCollision`) mutate the `FighterState` handed to
 * them, because by the time they run `step()` is already working on its clone and
 * copying a fighter twice per frame to preserve a purity that nobody can observe
 * would cost the rollback budget for nothing.
 */

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

/** Frames of the ordinary landing animation, before any move's landing lag. */
export const LANDING_FRAMES = 4;

/** Ground acceleration is a multiple of traction — the stat Ultimate publishes. */
export const WALK_ACCEL_FACTOR = 2;
export const RUN_ACCEL_FACTOR = 3;

/** A top-blast KO faster than this reads as a screen KO rather than a star KO. */
export const SCREEN_KO_SPEED = fx(2.4);

/* ---------------------------------------------------------------- motion -- */

export interface GravityOptions {
  readonly fastFalling?: boolean;
  /**
   * The fighter is in hitstun from a near-vertical launch, so its downward speed
   * is pinned to a flat 1.8 instead of accelerating — Ultimate's "balloon
   * knockback", the reason a vertical kill move hangs at the top of the screen.
   */
  readonly balloon?: boolean;
}

/**
 * One frame of gravity, terminal velocity included.
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

/** Walking: approach the walk speed at twice traction. */
export function walkVelocity(vx: number, dir: number, attrs: FighterAttributes): number {
  return approach(vx, dir * attrs.walkSpeed, attrs.traction * WALK_ACCEL_FACTOR);
}

/**
 * The initial dash is a velocity *set*, not a ramp.
 *
 * Ultimate gives every fighter its initial dash speed on frame 1 of the dash and
 * only then decays it toward the (usually lower) run speed. That instant burst is
 * what dash-dancing is made of.
 */
export function initialDashVelocity(dir: number, attrs: FighterAttributes): number {
  return dir * attrs.initialDashSpeed;
}

/** Running: approach the run speed at three times traction. */
export function runVelocity(vx: number, dir: number, attrs: FighterAttributes): number {
  return approach(vx, dir * attrs.runSpeed, attrs.traction * RUN_ACCEL_FACTOR);
}

/** Friction. The one primitive behind skidding, run-braking and standing still. */
export function applyTraction(vx: number, attrs: FighterAttributes): number {
  return approach(vx, 0, attrs.traction);
}

/**
 * Air drift: base plus additional acceleration, capped at the fighter's air speed.
 *
 * The cap is one-directional on purpose. A fighter launched at eight units a
 * frame is well past its own air speed, and drifting *back* is allowed while
 * drifting further out is not — otherwise DI'ing away from the stage would add
 * to the launch instead of merely failing to fight it. Releasing the stick keeps
 * the momentum: Ultimate has no air friction.
 */
export function airDrift(vx: number, stickX: number, attrs: FighterAttributes): number {
  if (stickX === 0) return vx;
  const accel = attrs.airAccelBase + attrs.airAccelAdditional;
  if (stickX > 0 && vx >= attrs.airSpeed) return vx;
  if (stickX < 0 && vx <= -attrs.airSpeed) return vx;
  return approach(vx, stickX > 0 ? attrs.airSpeed : -attrs.airSpeed, accel);
}

/** Position integration. Velocities are units per frame, so this is an add. */
export function integrate(f: FighterState): void {
  f.x += f.vx;
  f.y += f.vy;
}

/**
 * Bleed a launch velocity by a flat amount per frame, keeping its direction.
 *
 * Knockback in Ultimate decays linearly rather than exponentially — 0.051 units
 * off the *magnitude* every frame regardless of how fast the victim is going —
 * which is why survival is about the total distance travelled, not about a
 * half-life. Scaling both components by the same ratio keeps the launch angle
 * intact while gravity bends it separately.
 */
export function decayLaunch(f: FighterState, decay: number): void {
  const mag = f.launchSpeed;
  if (mag <= 0) {
    f.launchSpeed = 0;
    return;
  }
  const next = mag - decay <= 0 ? 0 : mag - decay;
  if (next === 0) {
    f.launchSpeed = 0;
    return;
  }
  f.vx = Math.trunc((f.vx * next) / mag);
  f.vy = Math.trunc((f.vy * next) / mag);
  f.launchSpeed = next;
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
  /** The fighter was stopped by a wall or a ceiling. */
  blocked: boolean;
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
  const out: CollisionOutcome = { landed: false, leftGround: false, blocked: false };

  // Already standing on something: the only question is whether it is still there.
  if (f.grounded && f.platform >= 0 && f.platform < stage.platforms.length) {
    const p = stage.platforms[f.platform];
    const cx = platformCentreX(p, frame);
    if (abs(f.x - cx) > p.halfWidth) {
      f.grounded = false;
      f.platform = -1;
      out.leftGround = true;
    } else {
      // A moving platform carries its passenger; Smashville is unplayable otherwise.
      if (p.motion) f.x += cx - platformCentreX(p, frame - 1);
      f.y = p.y;
      f.vy = 0;
      return out;
    }
  }

  // Walls and ceilings, before landing: a fighter shoved out of a wall may then
  // land on the surface above it, which is the stage-side of a ledge trump.
  for (const p of stage.platforms) {
    if (p.soft) continue;
    const cx = platformCentreX(p, frame);
    // The wall stops the fighter's *origin*, not its whole body. Pushing the
    // body out instead would eject a fighter who walked off the edge to a full
    // half-width clear of the stage — past the 3.2-unit ledge grab box, so it
    // could never grab the ledge it just stepped off.
    const reach = p.halfWidth;
    const bottom = p.y - HARD_PLATFORM_DEPTH;
    const head = f.y + attrs.height;
    // Only a fighter that *crossed* a wall face this frame is pushed out. Testing
    // containment instead would shove anybody standing under the stage sideways,
    // and under the stage is where every edgeguard in the game takes place.
    const cameFromOutside = abs(prevX - cx) >= reach;
    if (cameFromOutside && f.y < p.y && head > bottom && abs(f.x - cx) < reach) {
      f.x = prevX <= cx ? cx - reach : cx + reach;
      f.vx = 0;
      out.blocked = true;
    }
    // Ceiling: rising into the underside of a solid body.
    if (f.vy > 0 && abs(f.x - cx) < reach && prevY + attrs.height <= bottom && head > bottom) {
      f.y = bottom - attrs.height;
      f.vy = 0;
      out.blocked = true;
    }
  }

  if (f.vy > 0) return out;

  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    if (p.soft && opts.passThroughSoft) continue;
    const cx = platformCentreX(p, frame);
    if (abs(f.x - cx) > p.halfWidth) continue;
    if (prevY < p.y) continue; // was already below the surface — no landing from under
    if (f.y > p.y) continue; // still above it
    f.y = p.y;
    f.vy = 0;
    f.grounded = true;
    f.platform = i;
    f.fastFalling = false;
    f.jumpsUsed = 0;
    f.airDodged = false;
    f.airTime = 0;
    f.launchSpeed = 0;
    f.ledge = null;
    out.landed = true;
    return out;
  }

  return out;
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
  f.vy = 0;
  return true;
}

/* ------------------------------------------------------------------ ledge -- */

export interface LedgeGrab {
  readonly platform: number;
  /** −1 for the left-hand ledge, +1 for the right-hand one. */
  readonly side: number;
}

/**
 * Can this fighter grab a ledge right now, and which one?
 *
 * The rear grab box is 40% shorter (`LEDGE_GRAB_BACK_PENALTY`), which is the
 * mechanic behind every "I turned around and dropped" recovery death: facing away
 * from the stage costs you almost half your reach. Hitstun disqualifies you
 * entirely — you cannot grab a ledge while you are still reeling, which is what
 * makes a low off-stage hit lethal rather than an inconvenience.
 */
export function findLedgeGrab(
  f: FighterState,
  stage: StageDef,
  frame: number,
): LedgeGrab | null {
  if (f.grounded || f.ledge !== null) return null;
  if (f.hitstun > 0 || f.hitlag > 0) return null;
  if (f.vy > 0) return null; // rising past a ledge does not snap you onto it

  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    if (!p.ledges) continue;
    const cx = platformCentreX(p, frame);
    for (const side of [-1, 1] as const) {
      const lx = cx + side * p.halfWidth;
      // Only reachable from outboard of the ledge.
      if ((f.x - lx) * side < 0) continue;
      // Facing the ledge means facing back toward the stage: the opposite of the side.
      const facingLedge = f.facing === -side;
      const rangeX = facingLedge ? LEDGE_GRAB_RANGE_X : mul(LEDGE_GRAB_RANGE_X, LEDGE_GRAB_BACK_PENALTY);
      if (abs(f.x - lx) > rangeX) continue;
      const drop = p.y - f.y;
      if (drop < 0 || drop > LEDGE_GRAB_RANGE_Y) continue;
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
