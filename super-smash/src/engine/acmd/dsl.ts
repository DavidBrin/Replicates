/**
 * Authoring helpers for `game_` scripts, in the shape of smash-script's macros.
 *
 * Fighter data is written in decimals, as the game's scripts are; these turn
 * them into Q12 with `fx()` once, at module load — the same authoring-time
 * conversion every fighter file already does. Nothing here runs inside `step`.
 */

import { fx } from "../fixed";
import type {
  AcmdCommand,
  AcmdScript,
  AttackLr,
  AttackSetoff,
  BoneName,
  CollisionSituation,
  HitStatus,
  MotionKind,
  Rate,
} from "./types";

export interface AttackSpec {
  readonly id: number;
  readonly part?: number;
  readonly bone: BoneName;
  readonly damage: number;
  readonly angle: number;
  readonly kbg: number;
  readonly fkb?: number;
  readonly bkb: number;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly hitlag?: number;
  readonly sdi?: number;
  readonly clang?: AttackSetoff;
  readonly facing?: AttackLr;
  readonly setWeight?: boolean;
  readonly shieldDamage?: number;
  readonly trip?: number;
  readonly rehit?: number;
  readonly reflectable?: boolean;
  readonly absorbable?: boolean;
  readonly flinchless?: boolean;
  readonly noHitlag?: boolean;
  readonly direct?: boolean;
  readonly situation?: CollisionSituation;
  readonly collisionAttr?: string;
  readonly region?: string;
  readonly meteor?: boolean;
}

/** `ATTACK(...)`. Omitted arguments take the values the game's scripts use most. */
export function ATTACK(s: AttackSpec): AcmdCommand {
  return {
    op: "attack",
    params: {
      id: s.id,
      part: s.part ?? 0,
      bone: s.bone,
      damage: fx(s.damage),
      angle: fx(s.angle),
      kbg: fx(s.kbg),
      fkb: fx(s.fkb ?? 0),
      bkb: fx(s.bkb),
      size: fx(s.size),
      x: fx(s.x),
      y: fx(s.y),
      z: fx(s.z),
      ...(s.x2 !== undefined ? { x2: fx(s.x2) } : {}),
      ...(s.y2 !== undefined ? { y2: fx(s.y2) } : {}),
      ...(s.z2 !== undefined ? { z2: fx(s.z2) } : {}),
      hitlag: fx(s.hitlag ?? 1),
      sdi: fx(s.sdi ?? 1),
      clang: s.clang ?? "ATTACK_SETOFF_KIND_ON",
      facing: s.facing ?? "ATTACK_LR_CHECK_F",
      setWeight: s.setWeight ?? false,
      shieldDamage: fx(s.shieldDamage ?? 0),
      trip: fx(s.trip ?? 0),
      rehit: s.rehit ?? 0,
      reflectable: s.reflectable ?? false,
      absorbable: s.absorbable ?? false,
      flinchless: s.flinchless ?? false,
      noHitlag: s.noHitlag ?? false,
      direct: s.direct ?? true,
      situation: s.situation ?? "COLLISION_SITUATION_MASK_GA",
      collisionAttr: s.collisionAttr ?? "collision_attr_normal",
      region: s.region ?? "ATTACK_REGION_NONE",
      ...(s.meteor ? { meteor: true } : {}),
    },
  };
}

export interface CatchSpec {
  readonly id: number;
  readonly bone: BoneName;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly status?: string;
  readonly situation?: CollisionSituation;
}

/** `CATCH(...)`. */
export function CATCH(s: CatchSpec): AcmdCommand {
  return {
    op: "catch",
    params: {
      id: s.id,
      bone: s.bone,
      size: fx(s.size),
      x: fx(s.x),
      y: fx(s.y),
      z: fx(s.z),
      ...(s.x2 !== undefined ? { x2: fx(s.x2) } : {}),
      ...(s.y2 !== undefined ? { y2: fx(s.y2) } : {}),
      ...(s.z2 !== undefined ? { z2: fx(s.z2) } : {}),
      status: s.status ?? "FIGHTER_STATUS_KIND_CAPTURE_PULLED",
      situation: s.situation ?? "COLLISION_SITUATION_MASK_GA",
    },
  };
}

export const frame = (n: number): AcmdCommand => ({ op: "frame", frame: n });
export const wait = (n: number): AcmdCommand => ({ op: "wait", frames: n });
export const clearAll = (): AcmdCommand => ({ op: "clearAll" });
export const clear = (id: number): AcmdCommand => ({ op: "clear", id });
export const catchClearAll = (): AcmdCommand => ({ op: "catchClearAll" });
export const catchClear = (id: number): AcmdCommand => ({ op: "catchClear", id });
export const atkPower = (id: number, damage: number): AcmdCommand => ({ op: "atkPower", id, damage: fx(damage) });
export const shieldSetoffMul = (id: number, mul: number): AcmdCommand => ({ op: "shieldSetoffMul", id, mul: fx(mul) });
export const setFlag = (flag: string, on = true): AcmdCommand => ({ op: "setFlag", flag, on });
export const superArmour = (on: boolean): AcmdCommand => ({ op: "superArmour", on });
export const wholeHit = (status: HitStatus): AcmdCommand => ({ op: "wholeHit", status });
export const intangible = (on: boolean): AcmdCommand => wholeHit(on ? "HIT_STATUS_XLU" : "HIT_STATUS_NORMAL");
export const spawnProjectile = (id: string): AcmdCommand => ({ op: "spawnProjectile", id });
export const reverseLr = (): AcmdCommand => ({ op: "reverseLr" });
export const loop = (count: number, body: readonly AcmdCommand[]): AcmdCommand => ({ op: "loop", count, body });
export const unknown = (raw: string): AcmdCommand => ({ op: "unknown", raw });
export const momentum = (x: number, y: number, hold = 0, order = 0): AcmdCommand => ({
  op: "momentum",
  x: fx(x),
  y: fx(y),
  hold,
  order,
});

/**
 * `FT_MOTION_RATE(FSM=r)`. A decimal becomes the exact fraction it spells
 * (0.91 → 91/100), so the interpreter never accumulates a rounded rate; a
 * fraction may also be given directly, e.g. `[1, 3]`.
 */
export function motionRate(fsm: number | Rate): AcmdCommand {
  const rate = typeof fsm === "number" ? decimalRatio(fsm) : fsm;
  if (!(Number.isInteger(rate[0]) && Number.isInteger(rate[1]) && rate[0] > 0 && rate[1] > 0)) {
    throw new Error(`motionRate needs a positive rate, got ${String(fsm)}`);
  }
  return { op: "motionRate", rate };
}

export function decimalRatio(v: number): Rate {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`motionRate needs a positive rate, got ${v}`);
  const text = String(v);
  const dot = text.indexOf(".");
  const den = dot < 0 ? 1 : 10 ** (text.length - dot - 1);
  const num = Math.round(v * den);
  const g = gcd(num, den);
  return [num / g, den / g];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x === 0 ? 1 : x;
}

export function script(name: string, motion: MotionKind, commands: readonly AcmdCommand[]): AcmdScript {
  return { name, motion, commands };
}
