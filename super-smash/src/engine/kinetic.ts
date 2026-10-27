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

import type { FighterState } from "./types";

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
