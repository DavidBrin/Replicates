/**
 * KineticModule — a fighter's velocity as a sum of named energies.
 *
 * Ultimate does not keep one velocity per fighter. Its `KineticModule` keeps
 * several *energies*, each with its own rules, and moves the fighter by their
 * sum every frame (skyline-smash `FIGHTER_KINETIC_ENERGY_ID_*`). Which energies
 * run, and how, is chosen by the fighter's status through a *kinetic type*.
 * That separation is the mechanic: a launch (DAMAGE) decays at its own 0.051
 * per frame while gravity (GRAVITY) and the player's drift (CONTROL) act
 * beside it, instead of all three fighting over one `vx`.
 *
 * `FighterState.vx` / `vy` remain, as the **sum**, for every reader that only
 * wants to know how fast a fighter is going (renderer, CPU, blast-zone test).
 * Every energy mutator here ends by writing that sum back, so the two never
 * disagree. Code that still writes `vx`/`vy` directly is *adopted*: the
 * difference is folded into the carrier energy (see `kineticAdopt`) — that is
 * the strangler seam, and Task 4 closes it.
 */

import { approach } from "./fixed";
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
 * allowed while drifting further out is not.
 */
export function airControlX(vx: number, stickX: number, p: FighterParams): number {
  if (stickX === 0) return vx;
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
  kineticTransfer(f, type);
  switch (type) {
    case "WALK":
      k.controlX = approach(k.controlX, input.stickX * p.walk_speed_max, p.ground_brake * WALK_ACCEL_FACTOR);
      break;
    case "DASH":
      k.controlX =
        f.actionFrame <= 1
          ? f.facing * p.dash_speed
          : approach(k.controlX, f.facing * p.run_speed_max, p.ground_brake * RUN_ACCEL_FACTOR);
      break;
    case "RUN":
      k.controlX = approach(k.controlX, f.facing * p.run_speed_max, p.ground_brake * RUN_ACCEL_FACTOR);
      break;
    case "FALL":
    case "AIR_ESCAPE":
      k.controlX = f.grounded ? approach(k.controlX, 0, p.ground_brake) : airControlX(k.controlX, input.stickX, p);
      break;
    case "GROUND_STOP":
      if (f.grounded) k.stopX = approach(k.stopX, 0, p.ground_brake);
      break;
    case "MOTION":
      break;
  }
  if (!f.grounded) {
    if (!input.holdVertical) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
  } else {
    const sumY = kineticSumY(f);
    if (sumY < 0) k.gravityY -= sumY;
  }
  kineticSum(f);
}
