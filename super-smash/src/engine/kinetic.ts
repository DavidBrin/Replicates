/**
 * KineticModule — a fighter's velocity as a sum of named energies.
 *
 * Ultimate does not keep one velocity per fighter. Its `KineticModule` keeps
 * several *energies*, each with its own rules, and moves the fighter by their
 * sum every frame (skyline-smash `FIGHTER_KINETIC_ENERGY_ID_*`,
 * https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/lua_const.rs). Which energies
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
 * disagree, and nothing outside this file writes them (`velocity-writes.test.ts`).
 * The strangler seam's last trace is `kineticAdopt`, still called at the top of
 * `applyMovement`: it would fold a direct write into the carrier energy, and
 * with none left in the engine it changes nothing.
 */

import {
  LAUNCH_SPEED_DECAY,
  LEDGE_JUMP_VELOCITY,
  SET_WEIGHT_FALL_SPEED,
  SET_WEIGHT_GRAVITY,
  SET_WEIGHT_LAUNCH_FRAMES,
} from "./constants";
import { ONE, abs, approach, mul, sqrt } from "./fixed";
import { damageSpeedUpMag, damageSpeedUpMaxMag } from "./knockback";
import type { FighterParams } from "./params";
import type { FighterState } from "./types";

/** skyline-smash `lua_const.rs` (pinned in the header). The replica uses the five below. */
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
  /**
   * Consecutive airborne frames at or past `air_speed_y_stable`; decides a
   * heavy landing (Task 24). Only `kineticExec` counts it, so it holds still
   * (stale) across frames that skip it: a live scripted-momentum hold and
   * hitstun. A landing straight out of one reads the count from before it.
   * Known and left as it is: the window is a few frames (Plan 2 final review).
   */
  fallFrames: number;
  /** Full-hop initial rise (Task 19): 0 none; 1–4 the rise frame about to play; 5 hand over to gravity. */
  jumpInitial: number;
  /**
   * Balloon speed-up (Plan 3, Task 6): the launch's reaction frames still to
   * play, Q12 — rubendal's `damage_reaction_frame`. Meaningful while `speedUpMax > 0`.
   */
  speedUpFrame: number;
  /** The launch's reaction frames at the start (`damage_reaction_frame_last`), an integer. */
  speedUpFaf: number;
  /** The first-frame multiplier, Q12 (`damage_speed_up_max_mag`); 0 when no speed-up is running. */
  speedUpMax: number;
  /**
   * Set weight's launch (Plan 3, Task 16b): reaction frames left in which a
   * set-weight launch falls by `SET_WEIGHT_GRAVITY` toward `SET_WEIGHT_FALL_SPEED`
   * instead of the fighter's own (or balloon) gravity. 0 when none is running.
   */
  setWeightFrames: number;
  /**
   * Where this frame's extra reaction frames moved the fighter, Q12: a sped-up
   * real frame plays several of the game's frames, and all but the last land
   * here for `integrate` to add (`kineticTakeStep`). Zero between frames.
   */
  stepX: number;
  stepY: number;
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
    speedUpFrame: 0,
    speedUpFaf: 0,
    speedUpMax: 0,
    setWeightFrames: 0,
    stepX: 0,
    stepY: 0,
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
    speedUpFrame: k.speedUpFrame,
    speedUpFaf: k.speedUpFaf,
    speedUpMax: k.speedUpMax,
    setWeightFrames: k.setWeightFrames,
    stepX: k.stepX,
    stepY: k.stepY,
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

/**
 * Disarm what a launch arms besides its velocity, the balloon speed-up (Plan 3,
 * Task 6) and set weight's fall (Task 16b), without touching any energy: a
 * status that ends a launch's hitstun outright, a grab, must not leave either
 * armed for whatever reels this fighter next.
 */
export function kineticDisarmLaunch(f: FighterState): void {
  const k = f.kinetic;
  k.speedUpFrame = 0;
  k.speedUpFaf = 0;
  k.speedUpMax = 0;
  k.setWeightFrames = 0;
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
  k.stepX = 0;
  k.stepY = 0;
  kineticDisarmLaunch(f);
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
  // An outright vertical speed ends a full hop's initial rise: a jump, a grab,
  // a landing or a ledge jump all replace it (a directional air dodge ends it
  // too, in `kineticAirDodge`).
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
  k.speedUpMax = 0;
  k.setWeightFrames = 0;
  f.launchSpeed = 0;
  kineticSetY(f, vy);
}

/**
 * A knockback launch, on the DAMAGE energy. It replaces everything else the
 * fighter was doing — drift, a jump's rise, scripted motion — and decays on its
 * own from here (`kineticDecayDamage`); `launchSpeed` is its magnitude.
 *
 * `speedUpFaf` > 0 arms the balloon speed-up for a launch of that many
 * reaction frames (`computeHitstun + 1`): the caller passes 0 for a launch
 * that does not tumble or has set knockback (Plan 3, Task 6).
 *
 * `setWeight` arms set weight's own fall for the launch's first
 * `SET_WEIGHT_LAUNCH_FRAMES` reaction frames (Plan 3, Task 16b; see `reelOnce`).
 */
export function kineticLaunch(
  f: FighterState,
  vx: number,
  vy: number,
  speed: number,
  speedUpFaf = 0,
  setWeight = false,
): void {
  const k = f.kinetic;
  const max = speedUpFaf > 0 ? damageSpeedUpMaxMag(speedUpFaf) : 0;
  k.speedUpFaf = speedUpFaf;
  k.speedUpFrame = speedUpFaf * ONE;
  k.speedUpMax = max > ONE ? max : 0;
  k.setWeightFrames = setWeight ? SET_WEIGHT_LAUNCH_FRAMES : 0;
  k.stepX = 0;
  k.stepY = 0;
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

/**
 * A launch bounced off a surface (Plan 3, Task 12): `kineticLaunch`, except
 * that GRAVITY keeps `gravityY` instead of being zeroed. rubendal
 * SSBU-Calculator `js/knockback.js` resets gravity on a floor bounce and keeps
 * it on a wall or ceiling bounce (`resetGravity`, L136-146:
 * https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/knockback.js#L136-L146).
 * The caller passes 0 for a floor and the gravity the fighter had before the
 * collision for the others (a ceiling stop has already zeroed it). The balloon
 * speed-up is disarmed, as in `kineticLaunch`, and so is set weight's fall
 * (Task 16b); whether the game carries either through a bounce is UNVERIFIED
 * (`damage_fly_reflect_reaction_frame_mul` shortens the hitstun, which the
 * caller does).
 */
export function kineticReflect(f: FighterState, vx: number, vy: number, speed: number, gravityY: number): void {
  kineticLaunch(f, vx, vy, speed);
  f.kinetic.gravityY = gravityY;
  kineticSum(f);
}

/**
 * Point a live launch along (dx, dy) without changing its speed — knockback
 * stacking's kept launch (Plan 3, Task 8). A zero vector leaves it as it was.
 */
export function kineticTurnLaunch(f: FighterState, dx: number, dy: number): void {
  const len = sqrt(mul(dx, dx) + mul(dy, dy));
  if (len <= 0) return;
  const k = f.kinetic;
  k.damageX = Math.trunc((dx * f.launchSpeed) / len);
  k.damageY = Math.trunc((dy * f.launchSpeed) / len);
  kineticSum(f);
}

/* ---------------------------------------------------------- kinetic types -- */

/**
 * How a status drives the energies — the replica's `FIGHTER_KINETIC_TYPE_*`.
 *
 * Names follow skyline-smash where the game has a matching type (FALL 0x0,
 * GROUND_STOP 0x6, DASH 0x1D, MOTION 0x10, AIR_ESCAPE 0xD, NONE 0xFFFFFFFF;
 * `FIGHTER_KINETIC_TYPE_*`, https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/lua_const.rs).
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
}

/** One frame of gravity toward `terminal`, which is a positive speed. */
export function gravityStep(vy: number, g: number, terminal: number): number {
  const next = vy - g;
  return next < -terminal ? -terminal : next;
}

/**
 * Air drift: base plus additional acceleration, capped at air speed in the
 * direction being held. With the stick neutral, air friction (`air_brake_x`)
 * bleeds the drift instead (SmashWiki "Air friction").
 *
 * The cap is on CONTROL alone. A launch lives on DAMAGE, which this cannot
 * see, so once hitstun is over a fighter holding away from the stage adds up
 * to its air speed on top of whatever is left of the launch: the launch decays
 * on its own energy, which is Ultimate's model. The legacy single-velocity rule
 * (`airDrift`) capped drift against the launch itself and never decayed a
 * launch after hitstun, so this is a visible change from it (D55, Launches).
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
  // Out of hitstun nothing is sped up any more, and set weight's fall is over:
  // UNVERIFIED, the page counts "the first 10 frames of the launch" and does not
  // say whether an earlier end to the hitstun ends them (Plan 3, Task 16b).
  k.speedUpMax = 0;
  k.setWeightFrames = 0;
  const p = input.params;
  // A launch outlives its hitstun and keeps decaying while the fighter acts.
  if (f.launchSpeed > 0) kineticDecayDamage(f, launchDecay(f, p));
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
      // UNVERIFIED: the initial dash speed is held for the dash's first two frames
      // (actionFrame 0, the frame it starts, and 1); SmashWiki "Dash" does not say how long.
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
    if (!jumpFrame(f, p)) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
    // Frames at full fall speed decide a heavy landing (SmashWiki "Lag").
    // UNVERIFIED: that a fast fall's faster frames count too ("or faster"); the
    // page says "maximum falling speed" and does not mention fast falling.
    k.fallFrames = kineticSumY(f) <= -p.air_speed_y_stable ? k.fallFrames + 1 : 0;
  } else {
    const sumY = kineticSumY(f);
    if (sumY < 0) k.gravityY -= sumY;
  }
  kineticSum(f);
}

/* ------------------------------------------------------------ DAMAGE energy -- */

/**
 * How much launch speed a launch loses this frame: 0.051 (SmashWiki
 * "Knockback"), plus `ground_brake` while grounded. UNVERIFIED: the grounded
 * extra is kept for parity with the legacy engine, which braked a grounded
 * launch by traction; no source says Ultimate does.
 */
function launchDecay(f: Pick<FighterState, "grounded">, p: FighterParams): number {
  return f.grounded ? LAUNCH_SPEED_DECAY + p.ground_brake : LAUNCH_SPEED_DECAY;
}

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
 * How many of the game's reaction frames this real frame plays (Plan 3,
 * Task 6): `damageSpeedUpMag` of them while the speed-up runs, at least one,
 * rounded to whole frames by where the count crosses an integer (rubendal
 * `DamageSpeedUpFrames` / `GetFrameWithSpeedUp`). One when nothing is sped up.
 */
function speedUpSteps(f: FighterState): number {
  const k = f.kinetic;
  if (k.speedUpMax <= 0) return 1;
  const before = Math.ceil(k.speedUpFrame / ONE);
  const mag = damageSpeedUpMag(k.speedUpFrame, k.speedUpFaf, k.speedUpMax);
  k.speedUpFrame -= mag < ONE ? ONE : mag;
  if (mag <= ONE) k.speedUpMax = 0;
  const steps = before - Math.ceil(k.speedUpFrame / ONE);
  return steps < 1 ? 1 : steps;
}

/**
 * One reaction frame of reeling — Plan 2's `kineticReel` body: the launch
 * decays, and gravity builds toward the fall speed. A vertical ("balloon")
 * launch falls by the fighter's `damage_fly_top_air_accel_y` toward
 * `damage_fly_top_speed_y_stable` (1.8 for every fighter on this roster: the
 * calculator's DamageFlyTopFallSpeed, https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/<fighter>/data.json).
 * On the ground the launch also loses `ground_brake` a frame (`launchDecay`).
 *
 * A set-weight launch falls by 0.087 toward 1.5 for its first 10 reaction
 * frames, whatever the fighter and the angle (SmashWiki "Knockback",
 * https://www.ssbwiki.com/Knockback, revision 2063895; `SET_WEIGHT_GRAVITY`),
 * and by its own gravity after: the caller never marks one balloon. Each
 * reaction frame counts one, a sped-up real frame several (UNVERIFIED: the page
 * says "frames"; a set-weight launch with set knockback is never sped up).
 */
function reelOnce(f: FighterState, p: FighterParams, balloon: boolean): void {
  const k = f.kinetic;
  kineticDecayDamage(f, launchDecay(f, p));
  const setWeight = k.setWeightFrames > 0;
  if (setWeight) k.setWeightFrames -= 1;
  if (!f.grounded) {
    k.gravityY = setWeight
      ? gravityStep(k.gravityY, SET_WEIGHT_GRAVITY, SET_WEIGHT_FALL_SPEED)
      : balloon
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

/**
 * One frame of a fighter in hitstun: `reelOnce`, and nothing the player holds
 * moves them.
 *
 * A tumbling launch plays several reaction frames per real frame at first —
 * the balloon speed-up (SmashWiki "Launch": "the process of the character
 * getting launched is sped up"). Each is a full reaction frame of decay and
 * gravity; the displacement of all but the last is left in `stepX`/`stepY`
 * for `integrate`, so the path is the same as the un-sped launch, sampled.
 */
export function kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void {
  const steps = speedUpSteps(f);
  const k = f.kinetic;
  for (let i = 1; i < steps; i++) {
    reelOnce(f, p, balloon);
    k.stepX += f.vx;
    k.stepY += f.vy;
  }
  reelOnce(f, p, balloon);
}

/**
 * The displacement of this frame's extra reaction frames, handed to
 * `integrate` and zeroed, so it is added exactly once.
 */
export function kineticTakeStep(f: FighterState): { x: number; y: number } {
  const k = f.kinetic;
  const step = { x: k.stepX, y: k.stepY };
  k.stepX = 0;
  k.stepY = 0;
  return step;
}

/** Touching down ends a launch: its horizontal part becomes ordinary sliding (STOP). */
export function kineticLand(f: FighterState): void {
  const k = f.kinetic;
  k.stopX += k.damageX;
  k.damageX = 0;
  k.damageY = 0;
  k.speedUpMax = 0;
  k.setWeightFrames = 0;
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
  k.speedUpMax = 0;
  k.setWeightFrames = 0;
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

/* --------------------------------------------------- directional air dodge -- */

/**
 * One frame of a directional air dodge's own movement (Plan 3, Task 20c): the
 * slingshot back, then the slide (`directionalDodgeFrame`, `airDodge.ts`). The
 * dodge's velocity goes on MOTION, as a move's scripted momentum does, and
 * nothing else moves the fighter: drift (CONTROL, STOP) and gravity are off,
 * as the reimplementations of the vanilla status disable them for the slide
 * (HewDraw Remix `airdodge.rs` L505-507,
 * https://github.com/HDR-Development/HewDraw-Remix/blob/a56075404c96853b260689a341d63fcb90a33f93/fighters/common/src/general_statuses/airdodge.rs#L505-L507;
 * ssbexo `escape_air.rs` L153-154,
 * https://github.com/Armasher5872/ssbexo/blob/e725aa375677092adf81c67e5a982cde3e478670/fighters/common/src/status/escape/escape_air.rs#L153-L154).
 * A full hop's initial rise is gravity's, and stops with it.
 *
 * A launch survives the slingshot, decaying as it always does, and is cleared
 * when the slide starts (`endLaunch`): WuBor Patch `escape_air.rs` L379-385
 * clears the DAMAGE energy there, in live code
 * (https://github.com/WuBoytH/The-WuBor-Patch/blob/9d5e5cf90d7d686f5ab367a92789019c05574dec/fighters/common/src/status/escape/escape_air.rs#L379-L385).
 * UNVERIFIED: HewDraw Remix keeps it until the landing (`airdodge.rs`
 * L143-146, "prevents knockback speed from applying into wavelands"), and
 * SmashWiki "Lucario (SSBU)/Air dodge"'s "This backward shifting can cause
 * Lucario to die needlessly at times when knockback received is too strong"
 * needs it through the slingshot at least.
 */
export function kineticAirDodge(f: FighterState, vx: number, vy: number, endLaunch: boolean, p: FighterParams): void {
  const k = f.kinetic;
  k.speedUpMax = 0;
  k.setWeightFrames = 0;
  if (endLaunch) {
    k.damageX = 0;
    k.damageY = 0;
    f.launchSpeed = 0;
  } else if (f.launchSpeed > 0) {
    kineticDecayDamage(f, launchDecay(f, p));
  }
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.jumpInitial = 0;
  k.fallFrames = 0;
  k.motionX = vx;
  k.motionY = vy;
  kineticSum(f);
}

/**
 * A directional air dodge's slide is over: the end speed along its direction
 * becomes drift's (CONTROL) and gravity's (GRAVITY), and the fall's rules
 * (`kineticExec`) take it from this same frame. HewDraw Remix hands the slide's
 * x to CONTROL and its y to GRAVITY when the slide ends (`airdodge.rs`
 * L587-621,
 * https://github.com/HDR-Development/HewDraw-Remix/blob/a56075404c96853b260689a341d63fcb90a33f93/fighters/common/src/general_statuses/airdodge.rs#L587-L621).
 */
export function kineticAirDodgeHandOff(f: FighterState, vx: number, vy: number): void {
  const k = f.kinetic;
  k.motionX = 0;
  k.motionY = 0;
  k.stopX = 0;
  k.controlX = vx;
  k.gravityY = vy;
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
 * UNVERIFIED for Ultimate: the page's wording of that rule is in its Melee
 * section (D55, Walking and running).
 */
export function runControlX(vx: number, dir: number, p: FighterParams, mag: number): number {
  const target = dir * p.run_speed_max;
  if (vx * dir > 0 && abs(vx) > p.run_speed_max) return approach(vx, target, p.ground_brake);
  return approach(vx, target, p.run_accel_add + mul(p.run_accel_mul, mag));
}

/* ------------------------------------------------------------ rise timing -- */

export type JumpKind = "full" | "short" | "air" | "ledge";

/**
 * The vertical speed on every frame of a jump's `jump` action — each rising
 * frame, then the frame whose speed first stops being positive (the status
 * turns to FALL on the frame after) — by exactly the rule `kineticExec` applies
 * (the initial rise, then `jumpLaunchSpeed` with gravity on every frame). Pure and
 * stateless, for the layers that time a clip by the rise: the renderer
 * (`jumpTimingFor`) and the animation lab. `airJump` indexes
 * `jump_aerial_y_list` (0 = the first midair jump), clamped at both ends the
 * way the midair jump itself (`airJump` in `states.ts`) clamps it. A "ledge"
 * jump is the one `finishLedgeOption` launches at `LEDGE_JUMP_VELOCITY`.
 */
export function jumpRiseSpeeds(p: FighterParams, kind: JumpKind, airJump = 0): number[] {
  const out: number[] = [];
  const g = p.air_accel_y;
  if (g <= 0) return out;
  let v: number;
  if (kind === "full" && p.jump_initial_y > 0) {
    for (let n = 1; n <= 4; n++) out.push(initialRiseStep(p.jump_initial_y, n));
    v = jumpLaunchSpeed(g, p.jump_y - p.jump_initial_y);
  } else if (kind === "ledge") {
    v = LEDGE_JUMP_VELOCITY;
  } else {
    const list = p.jump_aerial_y_list;
    const air = list === undefined ? p.jump_aerial_y : list[Math.min(Math.max(airJump, 0), list.length - 1)];
    v = jumpLaunchSpeed(g, kind === "full" ? p.jump_y : kind === "short" ? p.mini_jump_y : air);
  }
  for (;;) {
    v = gravityStep(v, g, p.air_speed_y_stable);
    out.push(v);
    if (v <= 0) return out;
  }
}
