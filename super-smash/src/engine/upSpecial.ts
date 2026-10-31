/**
 * Up specials as published (Plan 5, Task 13b): the stick aims them and turns
 * them round, and they travel, drift and fall by their pages' own numbers.
 *
 * Everything here is read off the move's data (`MoveDef.aim`, `turn`, `rise`,
 * `launch`, `phases`, `fromAir`, `MoveMomentum.aimAt`/`endSpeed`/`decel`), with no
 * fighter id. What the stick chose is the one piece of state:
 * `CombatState.aimX`/`aimY`, the stick read on an aimed window's frame, cleared
 * when the special starts and ends (`clearSpecialMove`).
 *
 * The CPU judges its recovery by running these same rules (`ai/behaviours.ts`,
 * `upBPath`), so where a move goes is decided in one place.
 */

import type { ActiveMomentum } from "./acmd/interpreter";
import { DIAGONAL, ONE, cosDeg, magnitude, mul, sinDeg } from "./fixed";
import { moveFrameOf } from "./hitbox";
import { kineticReverseX } from "./kinetic";
import type { FighterParams } from "./params";
import type { FighterState, MoveAim, MoveDef, MoveLaunch, MoveMomentum, MovePhase } from "./types";

/** The stick as `Intent` gives it: −1/0/1 a side, and a soft tilt. */
export interface Stick {
  readonly x: number;
  readonly y: number;
  readonly soft: boolean;
}

/**
 * Whether the move `f` is in was begun in the air. Read off the airtime, which
 * needs no state of its own: `airTime` counts every frame begun in the air
 * (`step`, before `advanceFighter`) and, like `actionFrame`, stands still in
 * hitlag, so a move begun in the air has more airborne frames counted than move
 * frames, and one begun on the ground, whose first frame began on it, no more
 * (Plan 5, Task 4b fix round 1).
 */
export function begunInAir(f: Pick<FighterState, "airTime" | "actionFrame">): boolean {
  return f.airTime > f.actionFrame;
}

/** The move's launch, its own in the air where it has one there (`MoveDef.fromAir`). */
export function moveLaunch(move: MoveDef, f: Pick<FighterState, "airTime" | "actionFrame">): MoveLaunch | undefined {
  return (begunInAir(f) ? move.fromAir?.launch : undefined) ?? move.launch;
}

/** The physics stretch `f`'s move is on (`MoveDef.phases`, or `fromAir.phases` begun in the air), or undefined. */
export function movePhase(move: MoveDef, f: Pick<FighterState, "airTime" | "actionFrame">): MovePhase | undefined {
  const phases = (begunInAir(f) ? move.fromAir?.phases : undefined) ?? move.phases;
  if (phases === undefined) return undefined;
  const frame = moveFrameOf(f.actionFrame);
  return phases.find((p) => frame >= p.from && (p.to === undefined || frame <= p.to));
}

/** The fighter's params with a phase's air control, friction and gravity in place of its own. */
export function phaseParams(p: FighterParams, ph: MovePhase | undefined): FighterParams {
  if (ph === undefined) return p;
  const air = ph.air;
  return {
    ...p,
    ...(air !== undefined
      ? {
          air_accel_x_add: air.add ?? p.air_accel_x_add,
          air_accel_x_mul: air.mul ?? p.air_accel_x_mul,
          air_speed_x_stable: air.speed ?? (air.speedMul !== undefined ? mul(p.air_speed_x_stable, air.speedMul) : p.air_speed_x_stable),
        }
      : {}),
    ...(ph.brake !== undefined ? { air_brake_x: ph.brake } : {}),
    ...(ph.gravity !== undefined ? { air_accel_y: ph.gravity } : ph.gravityMul !== undefined ? { air_accel_y: mul(p.air_accel_y, ph.gravityMul) } : {}),
  };
}

/* ------------------------------------------------------------ the stick -- */

/** The stick read as an aim: each axis Q12, a soft tilt half (`Btn.Soft`, Plan 1's half deflection). */
function stickAim(s: Stick): { x: number; y: number } {
  const mag = s.soft ? ONE >> 1 : ONE;
  return { x: s.x * mag, y: s.y * mag };
}

/**
 * What the stick does on this move frame of an up special (Plan 5, Task 13b),
 * from the move's own `main` (and from `beginSpecial` for its first frame):
 * held back inside the move's `turn` window it turns the fighter round, and on
 * an aimed window's `aimAt` frame it is read as that window's aim. The turn
 * comes first, so an aim read on the same frame reads it the new way round.
 *
 * The turn is a B-reverse (fix round 1, ruling R-T13b-e): it turns the fighter's
 * horizontal speed round with it (`kineticReverseX`), and comes once a move, so a
 * stick wiggled inside the window does not turn it back (`CombatState.turned`).
 * SmashWiki "B-reversing" (https://www.ssbwiki.com/B-reversing): "turning around
 * and reversing their momentum".
 */
export function upSpecialStick(f: FighterState, move: MoveDef, s: Stick): void {
  const frame = moveFrameOf(f.actionFrame);
  const turn = move.turn;
  if (turn !== undefined && !f.combat.turned && frame >= turn[0] && frame <= turn[1] && s.x !== 0 && s.x !== f.facing) {
    f.facing = s.x;
    f.combat.turned = true;
    kineticReverseX(f);
  }
  const aim = move.aim;
  if (aim === undefined) return;
  let before: MoveMomentum | undefined;
  for (const w of move.momentum ?? []) {
    if (w.aimAt === frame) decideAim(f, aim, w, before, s);
    if (w.aimAt !== undefined && w.aimAt < frame) before = w;
  }
}

/**
 * Read the stick as window `w`'s aim. A second leg that does not turn far enough
 * from the leg before it, or that the stick does not point at all, is refused,
 * which is an aim of (0, 0) (Pikachu: "Minimum angle difference for second dash
 * 35°"). Any other window's (0, 0) is the stick at rest: it flies as authored.
 */
function decideAim(f: FighterState, aim: MoveAim, w: MoveMomentum, before: MoveMomentum | undefined, s: Stick): void {
  const next = stickAim(s);
  if (aim.kind === "legs" && w.second === true) {
    const prev = before === undefined ? null : effectiveDirection(before, f.combat.aimX, f.combat.aimY, f.facing);
    const ok = (next.x !== 0 || next.y !== 0) && (prev === null || turnsAtLeast(prev, { x: Math.sign(next.x), y: Math.sign(next.y) }, aim.minTurn));
    f.combat.aimX = ok ? next.x : 0;
    f.combat.aimY = ok ? next.y : 0;
    return;
  }
  f.combat.aimX = next.x;
  f.combat.aimY = next.y;
}

/** The world direction (signs) a leg flew: its aim, or as authored where the stick was at rest. */
function effectiveDirection(w: MoveMomentum, aimX: number, aimY: number, facing: number): { x: number; y: number } {
  if (aimX !== 0 || aimY !== 0) return { x: Math.sign(aimX), y: Math.sign(aimY) };
  return { x: Math.sign(w.x) * (facing >= 0 ? 1 : -1), y: Math.sign(w.y) };
}

/** Whether direction `b` turns at least `min` degrees (Q12) from `a`: cos θ = a·b / (|a||b|). */
function turnsAtLeast(a: { x: number; y: number }, b: { x: number; y: number }, min: number): boolean {
  const dot = (a.x * b.x + a.y * b.y) * ONE;
  const lengths = mul(magnitude(a.x * ONE, a.y * ONE), magnitude(b.x * ONE, b.y * ONE));
  return dot <= mul(cosDeg(min), lengths);
}

/* ------------------------------------------------------------ velocity -- */

/**
 * The velocity a live momentum window sets this frame, `x` facing-relative and
 * `y` absolute (as `kineticMotion` takes them), or null for a refused second leg.
 *
 * From the window as authored (`m`): a rise scaled by the move's height
 * multiplier where it began (`MoveDef.rise`); a speed that falls after its first
 * frames (`MoveMomentum.decel`, Fox's dash friction); and the stick's aim
 * (`MoveDef.aim`): turned by up to the move's deviation, or flown at the window's
 * speed the way the stick pointed.
 */
export function windowVelocity(
  move: MoveDef | undefined,
  m: ActiveMomentum,
  gameFrame: number,
  f: Pick<FighterState, "airTime" | "actionFrame" | "facing" | "combat">,
): { x: number; y: number } | null {
  const w = m.order === undefined ? undefined : move?.momentum?.[m.order];
  let x = m.x;
  let y = m.y;
  if (move === undefined || w === undefined) return { x, y };
  if (y > 0 && move.rise !== undefined) y = mul(y, begunInAir(f) ? move.rise.air : move.rise.ground);
  if (w.decel !== undefined) {
    const k = gameFrame - w.frame;
    const lost = k > w.decel.after - 1 ? (k - w.decel.after + 1) * w.decel.by : 0;
    if (lost > 0) {
      const speed = magnitude(x, y);
      const left = Math.max(0, speed - lost);
      x = speed === 0 ? 0 : Math.trunc((x * left) / speed);
      y = speed === 0 ? 0 : Math.trunc((y * left) / speed);
    }
  }
  const aim = move.aim;
  if (aim === undefined || w.aimAt === undefined) return { x, y };
  const side = f.facing >= 0 ? 1 : -1;
  const ax = f.combat.aimX;
  const ay = f.combat.aimY;
  if (aim.kind === "tilt") {
    // Turned toward the stick's side, forward positive: x' = x cos δ + y sin δ, y' = y cos δ − x sin δ.
    const delta = mul(aim.max, ax * side);
    const c = cosDeg(delta);
    const s = sinDeg(delta);
    return { x: mul(x, c) + mul(y, s), y: mul(y, c) - mul(x, s) };
  }
  if (ax === 0 && ay === 0) return aim.kind === "legs" && w.second === true ? null : { x, y };
  // One of the eight directions, at the window's own speed.
  const speed = magnitude(x, y);
  const sx = Math.sign(ax);
  const sy = Math.sign(ay);
  const each = sx !== 0 && sy !== 0 ? mul(speed, DIAGONAL) : speed;
  return { x: sx * each * side, y: sy * each };
}

/** The velocity a window hands on when it ends: its own, times `endSpeed` (`MoveMomentum.endSpeed`). */
export function windowEndSpeed(move: MoveDef | undefined, m: ActiveMomentum): { x: number; y: number } {
  const w = m.order === undefined ? undefined : move?.momentum?.[m.order];
  return { x: w?.endSpeed?.x ?? ONE, y: w?.endSpeed?.y ?? ONE };
}
