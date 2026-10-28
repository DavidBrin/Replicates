/**
 * From a script's live ATTACK/CATCH slots to the `Hitbox` records the combat
 * pipeline in `simulate.ts` already understands.
 *
 * Plan 2 keeps one combat pipeline: a script hitbox is resolved through the
 * bone table to a facing-relative point and handed on as a `Hitbox`, so
 * clanks, priority, shields and knockback are untouched. Plan 3 extends the
 * pipeline to read `AttackParams` directly (capsules, SDI, set weight, trip…).
 * Until then an extended (capsule) ATTACK or CATCH — one with `x2/y2/z2` — is
 * refused loudly: the pipeline has only spheres, and dropping the far end
 * would quietly shrink the move.
 *
 * Two narrowings are NOT refused, because a `Hitbox` has no field for what is
 * dropped; Plan 3 owns both, by reading `AttackParams` directly:
 * - a `collisionAttr` with no `HitEffect` (not in `EFFECT_OF_ATTR`) becomes a
 *   plain normal hit;
 * - a set-knockback attack (`fkb > 0`) carries `fkb` as its one
 *   `baseKnockback` and its `bkb` is dropped.
 */

import { ONE } from "../fixed";
import type { HitEffect, Hitbox } from "../types";
import { bonePoint, newBonePose } from "./bones";
import type { BonePose, BoneTable } from "./bones";
import type { ScriptFrameState } from "./interpreter";
import type { AttackParams, CatchParams, MotionKind } from "./types";

/** `collision_attr_*` ↔ the replica's `HitEffect`. */
export const EFFECT_OF_ATTR: Readonly<Record<string, HitEffect>> = {
  collision_attr_normal: "normal",
  collision_attr_elec: "electric",
  collision_attr_fire: "fire",
  collision_attr_cutup: "slash",
  collision_attr_sting: "stab",
  collision_attr_purple: "darkness",
  collision_attr_aura: "aura",
  collision_attr_ice: "freeze",
  collision_attr_bury: "bury",
  collision_attr_paralyze: "paralyze",
};

/** The inverse of `EFFECT_OF_ATTR`; a literal over every `HitEffect`, so a new effect cannot be left out. */
export const ATTR_OF_EFFECT: Readonly<Record<HitEffect, string>> = {
  normal: "collision_attr_normal",
  electric: "collision_attr_elec",
  fire: "collision_attr_fire",
  slash: "collision_attr_cutup",
  stab: "collision_attr_sting",
  darkness: "collision_attr_purple",
  aura: "collision_attr_aura",
  freeze: "collision_attr_ice",
  bury: "collision_attr_bury",
  paralyze: "collision_attr_paralyze",
};

/** Scratch for `BoneTable.pose`, reused so resolving a hitbox allocates no pose. Not state. */
const POSE = newBonePose();

/** Zero the scratch, so a table that returns true without writing a field cannot leak the last lookup's. */
function clearPose(p: BonePose): void {
  p.tx = p.ty = p.m00 = p.m01 = p.m02 = p.m10 = p.m11 = p.m12 = 0;
}

function resolve(
  bones: BoneTable,
  fighterId: string,
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "id" | "bone" | "x" | "y" | "z" | "x2" | "y2" | "z2">,
): { x: number; y: number } {
  if (p.x2 !== undefined || p.y2 !== undefined || p.z2 !== undefined) {
    throw new Error(`capsule hitbox (x2/y2/z2) id ${p.id} of ${fighterId}/${motion}: not supported until Plan 3`);
  }
  clearPose(POSE);
  if (!bones.pose(fighterId, motion, frame, p.bone, POSE)) {
    throw new Error(`no pose for bone "${p.bone}" of ${fighterId}/${motion} frame ${frame}`);
  }
  return bonePoint(POSE, p.x, p.y, p.z);
}

function attackHitbox(
  a: AttackParams,
  gameFrame: number,
  at: { x: number; y: number },
  setoff: number | undefined,
): Hitbox {
  const effect = EFFECT_OF_ATTR[a.collisionAttr];
  return {
    id: a.id,
    startFrame: gameFrame,
    endFrame: gameFrame,
    x: at.x,
    y: at.y,
    radius: a.size,
    damage: a.damage,
    angle: a.angle,
    baseKnockback: a.fkb > 0 ? a.fkb : a.bkb,
    knockbackGrowth: a.kbg,
    ...(effect !== undefined && effect !== "normal" ? { effect } : {}),
    ...(a.fkb > 0 ? { setKnockback: true } : {}),
    ...(a.clang === "ATTACK_SETOFF_KIND_THRU" ? { transcendent: true } : {}),
    ...(a.hitlag !== ONE ? { hitlagMultiplier: a.hitlag } : {}),
    ...(setoff !== undefined ? { shieldstunMultiplier: setoff } : {}),
    ...(a.meteor ? { meteor: true } : {}),
  };
}

function catchHitbox(c: CatchParams, gameFrame: number, at: { x: number; y: number }): Hitbox {
  return {
    id: c.id,
    startFrame: gameFrame,
    endFrame: gameFrame,
    x: at.x,
    y: at.y,
    radius: c.size,
    damage: 0,
    angle: 0,
    baseKnockback: 0,
    knockbackGrowth: 0,
    grabbing: true,
  };
}

/** Every live hitbox of a script on `gameFrame`: attacks by id, then catches by id. */
export function scriptHitboxes(
  state: ScriptFrameState,
  fighterId: string,
  motion: MotionKind,
  gameFrame: number,
  bones: BoneTable,
): Hitbox[] {
  const out: Hitbox[] = [];
  for (const a of state.attacks) {
    const at = resolve(bones, fighterId, motion, state.motionFrame, a);
    out.push(attackHitbox(a, gameFrame, at, state.shieldSetoff.get(a.id)));
  }
  for (const c of state.catches) {
    out.push(catchHitbox(c, gameFrame, resolve(bones, fighterId, motion, state.motionFrame, c)));
  }
  return out;
}
