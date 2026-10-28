/**
 * KineticModule — a fighter's velocity as a sum of named energies.
 *
 * Ultimate does not keep one velocity per fighter. Its `KineticModule` keeps
 * several *energies*, each with its own rules, and moves the fighter by their
 * sum every frame (skyline-smash `FIGHTER_KINETIC_ENERGY_ID_*`). Which energies
 * run, and how, is chosen by the fighter's status through a *kinetic type*.
 * That separation is the mechanic: a launch (DAMAGE) decays at its own 0.051
 * per frame (SmashWiki Knockback, Formula > Variables: launch speed is
 * knockback x 0.03 and "decays by 0.051 every frame"; the passage names no
 * single game, so it is the series figure, not an Ultimate-only measurement,
 * https://www.ssbwiki.com/Knockback) while gravity (GRAVITY) and the player's
 * drift (CONTROL) act beside it, instead of all three fighting over one `vx`.
 *
 * `FighterState.vx` / `vy` remain, as the **sum**, for every reader that only
 * wants to know how fast a fighter is going (renderer, CPU, blast-zone test).
 * Every energy mutator here ends by writing that sum back, so the two never
 * disagree. Code that still writes `vx`/`vy` directly is *adopted*: the
 * difference is folded into the carrier energy (see `kineticAdopt`) — that is
 * the strangler seam, and Task 4 closes it.
 */

import { LAUNCH_SPEED_DECAY } from "./constants";
import { ONE, abs, approach, mul, sqrt } from "./fixed";
import type { FighterParams } from "./params";
import type { ActionState, FighterState } from "./types";

/** skyline-smash `lua_const.rs`. The replica uses the five below. */
export const FIGHTER_KINETIC_ENERGY_ID_MOTION = 0;
export const FIGHTER_KINETIC_ENERGY_ID_GRAVITY = 1;
export const FIGHTER_KINETIC_ENERGY_ID_CONTROL = 2;
export const FIGHTER_KINETIC_ENERGY_ID_STOP = 3;
export const FIGHTER_KINETIC_ENERGY_ID_DAMAGE = 4;

export interface KineticState {
  /** CONTROL — stick-driven horizontal speed: walk, dash, run, air drift. Q12/frame. */
  controlX: number;
  /** STOP — horizontal speed with no driver, braking toward zero. Q12/frame. */
  stopX: number;
  /** GRAVITY — vertical speed from jumps and gravity, clamped at fall speed. Q12/frame. */
  gravityY: number;
  /** MOTION — a move's scripted velocity while it holds. Q12/frame. */
  motionX: number;
  motionY: number;
  /** DAMAGE — the launch vector. Its magnitude is `FighterState.launchSpeed`. Q12/frame. */
  damageX: number;
  damageY: number;
  /** Consecutive airborne frames at or past `air_speed_y_stable`; decides a heavy landing (Task 24). */
  fallFrames: number;
  /** Full-hop initial rise (Task 19): 0 none; 1–4 the rise frame about to play; 5 hand over to gravity. */
  jumpInitial: number;
}

export function emptyKinetic(): KineticState {
  return {
    controlX: 0,
    stopX: 0,
    gravityY: 0,
    motionX: 0,
    motionY: 0,
    damageX: 0,
    damageY: 0,
    fallFrames: 0,
    jumpInitial: 0,
  };
}

export function cloneKinetic(k: KineticState): KineticState {
  return {
    controlX: k.controlX,
    stopX: k.stopX,
    gravityY: k.gravityY,
    motionX: k.motionX,
    motionY: k.motionY,
    damageX: k.damageX,
    damageY: k.damageY,
    fallFrames: k.fallFrames,
    jumpInitial: k.jumpInitial,
  };
}

export function kineticSumX(f: Pick<FighterState, "kinetic">): number {
  const k = f.kinetic;
  return k.controlX + k.stopX + k.motionX + k.damageX;
}

export function kineticSumY(f: Pick<FighterState, "kinetic">): number {
  const k = f.kinetic;
  return k.gravityY + k.motionY + k.damageY;
}

/** Write the energies' sum back to `vx`/`vy`. Every mutator ends here. */
export function kineticSum(f: FighterState): void {
  f.vx = kineticSumX(f);
  f.vy = kineticSumY(f);
}

/** Which horizontal energy carries speed a status does not drive itself. */
export type HorizontalCarrier = "control" | "stop";

/**
 * Fold a direct write to `vx`/`vy` into the energies.
 *
 * The horizontal difference goes to `carrier`, the vertical one to GRAVITY. A
 * fighter whose `vx`/`vy` already equal the sum is untouched, so calling this
 * defensively costs nothing.
 */
export function kineticAdopt(f: FighterState, carrier: HorizontalCarrier = "control"): void {
  const dx = f.vx - kineticSumX(f);
  const dy = f.vy - kineticSumY(f);
  if (dx !== 0) {
    if (carrier === "control") f.kinetic.controlX += dx;
    else f.kinetic.stopX += dx;
  }
  if (dy !== 0) f.kinetic.gravityY += dy;
}

/** Every energy to zero, the launch included: a ledge, a respawn, a KO. */
export function kineticClear(f: FighterState): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.motionX = 0;
  k.motionY = 0;
  k.damageX = 0;
  k.damageY = 0;
  k.fallFrames = 0;
  k.jumpInitial = 0;
  f.launchSpeed = 0;
  kineticSum(f);
}

/* --------------------------------------------- setting a velocity outright -- */

/**
 * Set the horizontal speed outright: every horizontal energy to zero, then
 * `vx` on `carrier`. The KineticModule equivalent of `f.vx = vx`.
 *
 * `vx`/`vy` must already equal the energies' sum when this is called (it
 * rewrites them from the energies); call `kineticAdopt` first if a raw write is pending.
 */
export function kineticSetX(f: FighterState, vx: number, carrier: HorizontalCarrier = "control"): void {
  const k = f.kinetic;
  k.controlX = carrier === "control" ? vx : 0;
  k.stopX = carrier === "stop" ? vx : 0;
  k.motionX = 0;
  if (k.damageX !== 0) {
    // A launch stopped along one axis keeps only the other.
    k.damageX = 0;
    f.launchSpeed = abs(k.damageY);
  }
  kineticSum(f);
}

/**
 * Set the vertical speed outright, on GRAVITY. The equivalent of `f.vy = vy`.
 * Like `kineticSetX`, it needs `vx`/`vy` to equal the sum already: `kineticAdopt` first if a raw write is pending.
 */
export function kineticSetY(f: FighterState, vy: number): void {
  const k = f.kinetic;
  k.gravityY = vy;
  k.motionY = 0;
  // An outright vertical speed ends a full hop's initial rise: a jump, an air
  // dodge's stillness, a grab, a landing or a ledge jump all replace it.
  k.jumpInitial = 0;
  if (k.damageY !== 0) {
    k.damageY = 0;
    f.launchSpeed = abs(k.damageX);
  }
  kineticSum(f);
}

/** Both at once. */
export function kineticSet(f: FighterState, vx: number, vy: number, carrier: HorizontalCarrier = "control"): void {
  kineticSetX(f, vx, carrier);
  kineticSetY(f, vy);
}

/**
 * A jump's vertical speed, which also ends any launch: the launch's horizontal
 * part stays with the fighter as ordinary drift (CONTROL), its vertical part is
 * replaced, and `launchSpeed` stops decaying anything.
 */
export function kineticJump(f: FighterState, vy: number): void {
  const k = f.kinetic;
  k.controlX += k.damageX;
  k.damageX = 0;
  f.launchSpeed = 0;
  kineticSetY(f, vy);
}

/**
 * A knockback launch, on the DAMAGE energy. It replaces everything else the
 * fighter was doing — drift, a jump's rise, scripted motion — and decays on its
 * own from here (`kineticDecayDamage`); `launchSpeed` is its magnitude.
 */
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.motionX = 0;
  k.motionY = 0;
  k.jumpInitial = 0;
  k.damageX = vx;
  k.damageY = vy;
  f.launchSpeed = speed;
  kineticSum(f);
}

/* ---------------------------------------------------------- kinetic types -- */

/**
 * How a status drives the energies — the replica's `FIGHTER_KINETIC_TYPE_*`.
 *
 * Names follow skyline-smash where the game has a matching type (FALL 0x0,
 * GROUND_STOP 0x6, DASH 0x1D, MOTION 0x10, AIR_ESCAPE 0xD, NONE 0xFFFFFFFF).
 * WALK and RUN are replica names: the game drives both through the CONTROL
 * energy of its ground statuses rather than through a named type.
 */
export type KineticType =
  | "FALL"
  | "GROUND_STOP"
  | "WALK"
  | "DASH"
  | "RUN"
  | "MOTION"
  | "AIR_ESCAPE"
  | "NONE";

/**
 * Each action's kinetic type, transcribed from the legacy `applyMovement`
 * switch. The status objects (Tasks 6–11) declare the same values; this table
 * is the fallback until they all exist and is deleted in Task 28.
 */
export const KINETIC_TYPE_OF_ACTION: Readonly<Record<ActionState, KineticType>> = {
  stand: "GROUND_STOP",
  walk: "WALK",
  dashStart: "DASH",
  run: "RUN",
  runBrake: "GROUND_STOP",
  turnaround: "GROUND_STOP",
  crouchStart: "GROUND_STOP",
  crouch: "GROUND_STOP",
  crouchEnd: "GROUND_STOP",
  jumpSquat: "GROUND_STOP",
  jump: "FALL",
  fall: "FALL",
  land: "GROUND_STOP",
  landingLag: "GROUND_STOP",
  attack: "FALL",
  special: "FALL",
  grab: "FALL",
  grabHold: "FALL",
  pummel: "FALL",
  throw: "FALL",
  shieldStart: "GROUND_STOP",
  shield: "GROUND_STOP",
  shieldRelease: "GROUND_STOP",
  shieldStun: "GROUND_STOP",
  shieldBroken: "GROUND_STOP",
  spotDodge: "GROUND_STOP",
  roll: "MOTION",
  airDodge: "AIR_ESCAPE",
  hitstun: "GROUND_STOP",
  tumble: "GROUND_STOP",
  grabbed: "GROUND_STOP",
  thrown: "GROUND_STOP",
  downed: "GROUND_STOP",
  getUp: "GROUND_STOP",
  ledgeHang: "GROUND_STOP",
  ledgeGetUp: "GROUND_STOP",
  ledgeAttack: "GROUND_STOP",
  ledgeRoll: "GROUND_STOP",
  ledgeJump: "GROUND_STOP",
  respawnPlatform: "NONE",
  dead: "NONE",
  entering: "FALL",
};

/**
 * The horizontal energy a kinetic type drives. Exactly one of CONTROL and STOP
 * holds horizontal speed at a time; `kineticTransfer` moves it across when the
 * type changes, which is what keeps the split numerically identical to the
 * single `vx` it replaced.
 */
export function carrierOf(type: KineticType): HorizontalCarrier {
  return type === "WALK" || type === "DASH" || type === "RUN" || type === "FALL" || type === "AIR_ESCAPE"
    ? "control"
    : "stop";
}

export function kineticTransfer(f: FighterState, type: KineticType): void {
  const k = f.kinetic;
  if (carrierOf(type) === "control") {
    if (k.stopX !== 0) {
      k.controlX += k.stopX;
      k.stopX = 0;
    }
  } else if (k.controlX !== 0) {
    k.stopX += k.controlX;
    k.controlX = 0;
  }
}

/** Legacy ground acceleration: walking approaches at 2 × traction, running at 3 ×. */
export const WALK_ACCEL_FACTOR = 2;
export const RUN_ACCEL_FACTOR = 3;

export interface KineticInput {
  /** Horizontal stick, −1/0/1 from the keyboard. */
  readonly stickX: number;
  /**
   * How far the stick is deflected, Q12: ONE for a key or a full tilt, ONE / 2
   * for `Btn.Soft` (Plan 1's half-deflection reading — UNVERIFIED, the
   * bitfield carries one bit of magnitude). Defaults to ONE.
   */
  readonly stickMag?: number;
  readonly params: FighterParams;
  /** Air dodge only: its intangible window is open, so gravity waits. */
  readonly holdVertical: boolean;
}

/** One frame of gravity toward `terminal`, which is a positive speed. */
export function gravityStep(vy: number, g: number, terminal: number): number {
  const next = vy - g;
  return next < -terminal ? -terminal : next;
}

/**
 * Air drift: base plus additional acceleration, capped at air speed — but only
 * in the direction being held, so drifting back against a fast launch is
 * allowed while drifting further out is not. With the stick neutral, air
 * friction (`air_brake_x`) bleeds the drift instead (SmashWiki "Air friction").
 */
export function airControlX(vx: number, stickX: number, p: FighterParams): number {
  if (stickX === 0) return approach(vx, 0, p.air_brake_x);
  const accel = p.air_accel_x_add + p.air_accel_x_mul;
  if (stickX > 0 && vx >= p.air_speed_x_stable) return vx;
  if (stickX < 0 && vx <= -p.air_speed_x_stable) return vx;
  return approach(vx, stickX > 0 ? p.air_speed_x_stable : -p.air_speed_x_stable, accel);
}

/**
 * KineticModule exec for one frame of a non-reeling fighter: drive the
 * energies the kinetic type names, then write their sum to `vx`/`vy`.
 */
export function kineticExec(f: FighterState, type: KineticType, input: KineticInput): void {
  if (type === "NONE") {
    kineticClear(f);
    return;
  }
  const k = f.kinetic;
  const p = input.params;
  // A launch outlives its hitstun and keeps decaying while the fighter acts.
  if (f.launchSpeed > 0) kineticDecayDamage(f, f.grounded ? LAUNCH_SPEED_DECAY + p.ground_brake : LAUNCH_SPEED_DECAY);
  kineticTransfer(f, type);
  switch (type) {
    case "WALK": {
      // walk_accel_add at any deflection, walk_accel_mul scaled by it; the top
      // speed scales with deflection too. UNVERIFIED: that scaling is linear
      // here; the game's `walk_slow_speed_mul`, `walk_middle_ratio` and
      // `walk_fast_ratio` (skyline-smash FighterParamTable) shape it, and no
      // source used here publishes their values.
      const mag = input.stickMag ?? ONE;
      k.controlX = approach(k.controlX, input.stickX * mul(p.walk_speed_max, mag), p.walk_accel_add + mul(p.walk_accel_mul, mag));
      break;
    }
    case "DASH":
      // UNVERIFIED: the initial dash speed is held for the dash's first frame only.
      k.controlX =
        f.actionFrame <= 1 ? f.facing * p.dash_speed : runControlX(k.controlX, f.facing, p, input.stickMag ?? ONE);
      break;
    case "RUN":
      k.controlX = runControlX(k.controlX, f.facing, p, input.stickMag ?? ONE);
      break;
    case "FALL":
    case "AIR_ESCAPE":
      k.controlX = f.grounded ? approach(k.controlX, 0, p.ground_brake) : airControlX(k.controlX, input.stickX, p);
      break;
    case "GROUND_STOP":
      k.stopX = approach(k.stopX, 0, f.grounded ? p.ground_brake : p.air_brake_x);
      break;
    case "MOTION":
      break;
  }
  if (!f.grounded) {
    const skip = jumpFrame(f, p) || input.holdVertical;
    if (!skip) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
    // Frames at full fall speed (or faster: a fast fall) decide a heavy landing.
    k.fallFrames = kineticSumY(f) <= -p.air_speed_y_stable ? k.fallFrames + 1 : 0;
  } else {
    const sumY = kineticSumY(f);
    if (sumY < 0) k.gravityY -= sumY;
  }
  kineticSum(f);
}

/* ------------------------------------------------------------ DAMAGE energy -- */

/**
 * Bleed the launch by a flat `decay` along its own direction (SmashWiki
 * "Knockback": 0.051 per frame). Only the DAMAGE energy moves; gravity and
 * drift are separate energies and keep their own rules.
 */
export function kineticDecayDamage(f: FighterState, decay: number): void {
  const k = f.kinetic;
  const mag = f.launchSpeed;
  const next = mag - decay;
  if (mag <= 0 || next <= 0) {
    k.damageX = 0;
    k.damageY = 0;
    f.launchSpeed = 0;
    return;
  }
  k.damageX = Math.trunc((k.damageX * next) / mag);
  k.damageY = Math.trunc((k.damageY * next) / mag);
  f.launchSpeed = next;
}

/**
 * One frame of a fighter in hitstun: the launch decays, gravity builds toward
 * the fall speed, and nothing the player holds moves them. A vertical
 * ("balloon") launch falls by the fighter's `damage_fly_top_air_accel_y` toward
 * `damage_fly_top_speed_y_stable` (1.8 for every fighter on this roster). On
 * the ground the launch also loses `ground_brake` a frame.
 */
export function kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void {
  const k = f.kinetic;
  kineticDecayDamage(f, f.grounded ? LAUNCH_SPEED_DECAY + p.ground_brake : LAUNCH_SPEED_DECAY);
  if (!f.grounded) {
    k.gravityY = balloon
      ? gravityStep(k.gravityY, p.damage_fly_top_air_accel_y, p.damage_fly_top_speed_y_stable)
      : gravityStep(k.gravityY, p.air_accel_y, p.air_speed_y_stable);
  } else {
    kineticTransfer(f, "GROUND_STOP");
    k.stopX = approach(k.stopX, 0, p.ground_brake);
    const sumY = kineticSumY(f);
    if (sumY < 0) k.gravityY -= sumY;
  }
  kineticSum(f);
}

/** Touching down ends a launch: its horizontal part becomes ordinary sliding (STOP). */
export function kineticLand(f: FighterState): void {
  const k = f.kinetic;
  k.stopX += k.damageX;
  k.damageX = 0;
  k.damageY = 0;
  f.launchSpeed = 0;
  kineticSum(f);
}

/* ------------------------------------------------------------ MOTION energy -- */

/**
 * A move's scripted velocity (`momentum` in its `game_` script): set, not
 * added, so a Fox Illusion out of a run goes exactly as far as one from a
 * standstill. Every other energy stops while it holds, the launch included.
 */
export function kineticMotion(f: FighterState, vx: number, vy: number): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.jumpInitial = 0; // a full hop's initial rise is gravity's, and stops with it
  k.damageX = 0;
  k.damageY = 0;
  f.launchSpeed = 0;
  k.motionX = vx;
  k.motionY = vy;
  kineticSum(f);
}

/**
 * The hold is over: the velocity it left becomes drift and gravity's to change.
 * A no-op when MOTION is already zero, so it is safe to call whenever no hold is live.
 */
export function kineticEndMotion(f: FighterState): void {
  const k = f.kinetic;
  k.controlX += k.motionX;
  k.gravityY += k.motionY;
  k.motionX = 0;
  k.motionY = 0;
  kineticSum(f);
}

/* ------------------------------------------------------------------- jumps -- */

/**
 * SmashWiki "Jump" (https://www.ssbwiki.com/Jump): "In Smash 4 and Ultimate,
 * the game encodes jump height, and works backwards using gravity to figure out
 * the correct force to use." The page's source gives the force as
 * `f = sqrt(2g*h) + g/2` (and `sqrt(2g*(h-i)) + g/2` for a full hop after its
 * initial height i).
 *
 * That formula reaches h under one integration order: every airborne frame,
 * the first included, applies gravity and then moves. The peak of a launch v is
 * then v²/2g − v/2 + g·φ(1−φ)/2 (φ the fractional part of v/g), which for
 * v = √(2gh) + g/2 is h − g/8 + g·φ(1−φ)/2 — between h − g/8 and h. Skipping
 * gravity on the first frame instead would overshoot by about √(2gh), more than
 * two units for every fighter here. So this engine applies gravity on every
 * airborne frame, a jump's first one included (DECISIONS D55 records the
 * SmashWiki sentence that says otherwise).
 */
export function jumpLaunchSpeed(g: number, h: number): number {
  if (h <= 0) return 0;
  return sqrt(2 * mul(g, h)) + (g >> 1);
}

/**
 * The full hop's initial rise: `jump_initial_y` over its first 4 airborne
 * frames (SmashWiki "Jump": "the height that a character will reach in the
 * first 4 frames of a full hop"). UNVERIFIED: how that height is split across
 * the 4 frames is not published; this rises it evenly, the remainder on the 4th.
 */
export function initialRiseStep(initial: number, frame: number): number {
  const q = Math.trunc(initial / 4);
  return frame < 4 ? q : initial - 3 * q;
}

/**
 * Leave the ground. A full hop with a published initial height rises
 * `jump_initial_y` over its first 4 frames and then flies as a jump of the
 * remaining height; a short hop (and a full hop without an initial height)
 * launches at once, at `jumpLaunchSpeed`.
 */
export function kineticGroundJump(f: FighterState, p: FighterParams, full: boolean): void {
  if (full && p.jump_initial_y > 0) {
    kineticJump(f, 0);
    f.kinetic.jumpInitial = 1;
    return;
  }
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, full ? p.jump_y : p.mini_jump_y));
}

/** The vertical half of a jump frame: true while the initial rise replaces gravity. */
function jumpFrame(f: FighterState, p: FighterParams): boolean {
  const k = f.kinetic;
  if (k.jumpInitial >= 1 && k.jumpInitial <= 4) {
    k.gravityY = initialRiseStep(p.jump_initial_y, k.jumpInitial);
    k.jumpInitial += 1;
    return true;
  }
  if (k.jumpInitial === 5) {
    // The rest of the hop launches here, and this frame's gravity applies to it.
    k.gravityY = jumpLaunchSpeed(p.air_accel_y, p.jump_y - p.jump_initial_y);
    k.jumpInitial = 0;
  }
  return false;
}

/**
 * Dash and run acceleration (SmashWiki "Dash"): below run speed, accelerate by
 * `run_accel_add` plus `run_accel_mul` scaled by deflection; above it (an
 * initial dash faster than the run), brake by traction down to it.
 */
export function runControlX(vx: number, dir: number, p: FighterParams, mag: number): number {
  const target = dir * p.run_speed_max;
  if (vx * dir > 0 && abs(vx) > p.run_speed_max) return approach(vx, target, p.ground_brake);
  return approach(vx, target, p.run_accel_add + mul(p.run_accel_mul, mag));
}
