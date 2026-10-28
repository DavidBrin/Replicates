/**
 * From a script's live ATTACK/CATCH slots to the `Hitbox` records the combat
 * pipeline in `simulate.ts` already understands.
 *
 * Plan 2 keeps one combat pipeline: a script hitbox is resolved through the
 * bone table to a facing-relative point and handed on as a `Hitbox`, so
 * clanks, priority, shields and knockback are untouched. Plan 3 extends the
 * pipeline to read `AttackParams` directly (SDI, set weight, trip…).
 * An extended (capsule) ATTACK or CATCH — one with `x2/y2/z2` — resolves both
 * ends through the bone table, and the pipeline tests the capsule between them
 * (Plan 3, Task 17).
 *
 * An ATTACK's `direct`, `set_weight`, ground/air mask, LR check and downward
 * angle reach the pipeline as `Hitbox` fields (Plan 3, Task 16), and so does a
 * CATCH's ground/air mask (Task 16b). An attack's `bkb` is the box's
 * `baseKnockback` and a non-zero `fkb` its `fixedKnockback`, field for field
 * (Task 16b).
 *
 * One narrowing is NOT refused, because a `Hitbox` has no field for what is
 * dropped; Plan 3 owns it, by reading `AttackParams` directly: a
 * `collisionAttr` with no `HitEffect` (not in `EFFECT_OF_ATTR`) becomes a plain
 * normal hit.
 */

import { ONE, fx } from "../fixed";
import type { HitEffect, Hitbox } from "../types";
import { bonePoint, newBonePose } from "./bones";
import type { BonePose, BoneTable } from "./bones";
import { runScript, scheduleOf } from "./interpreter";
import type { ScriptFrameState } from "./interpreter";
import type { AcmdScript, AttackParams, CatchParams, MotionKind } from "./types";

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

/** An extended ATTACK or CATCH: one with a far end (`x2`/`y2`/`z2`). */
function isCapsule(p: Pick<AttackParams, "x2" | "y2" | "z2">): boolean {
  return p.x2 !== undefined || p.y2 !== undefined || p.z2 !== undefined;
}

function resolve(
  bones: BoneTable,
  fighterId: string,
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "bone" | "x" | "y" | "z">,
): { x: number; y: number } {
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
    baseKnockback: a.bkb,
    knockbackGrowth: a.kbg,
    ...(effect !== undefined && effect !== "normal" ? { effect } : {}),
    ...(a.fkb > 0 ? { fixedKnockback: a.fkb } : {}),
    ...(a.clang === "ATTACK_SETOFF_KIND_THRU" ? { transcendent: true } : {}),
    ...(a.hitlag !== ONE ? { hitlagMultiplier: a.hitlag } : {}),
    ...(setoff !== undefined ? { shieldstunMultiplier: setoff } : {}),
    ...((a.meteor ?? isSpikeAngle(a.angle)) ? { meteor: true } : {}),
    ...(a.direct ? {} : { direct: false }),
    ...(a.setWeight ? { setWeight: true } : {}),
    ...(SITUATION[a.situation] !== undefined ? { situation: SITUATION[a.situation] } : {}),
    ...(LR[a.facing] !== undefined ? { lr: LR[a.facing] } : {}),
  };
}

/**
 * Which victims a `COLLISION_SITUATION_MASK_*` restricts a box to; GA (both)
 * is no restriction. UNVERIFIED: that `_G_d` (the "_d" variants) restricts like
 * `_G` and not otherwise.
 */
const SITUATION: Readonly<Partial<Record<AttackParams["situation"], "ground" | "air">>> = {
  COLLISION_SITUATION_MASK_G: "ground",
  COLLISION_SITUATION_MASK_G_d: "ground",
  COLLISION_SITUATION_MASK_A: "air",
};

/**
 * `ATTACK_LR_CHECK_*` → the launch direction rule; F (forward) is the default.
 * UNVERIFIED: `_SPEED` (launch by the attacker's speed) is not modelled and
 * reads as forward.
 */
const LR: Readonly<Partial<Record<AttackParams["facing"], "position" | "back">>> = {
  ATTACK_LR_CHECK_POS: "position",
  ATTACK_LR_CHECK_B: "back",
};

/**
 * A downward launch (230°–310°) is a meteor: rubendal SSBU-Calculator
 * `js/knockback.js`, `this.spike = this.angle >= 230 && this.angle <= 310`
 * (https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/knockback.js#L1105).
 * What a meteor does to a grounded victim, a floor bounce as the launch fires
 * when it tumbles, is `releasePendingLaunch`'s. Legacy-compiled scripts say
 * `meteor` outright, either way, so only a script that does not say is
 * classified by its angle.
 */
function isSpikeAngle(angle: number): boolean {
  return angle >= SPIKE_ANGLE_MIN && angle <= SPIKE_ANGLE_MAX;
}
const SPIKE_ANGLE_MIN = fx(230);
const SPIKE_ANGLE_MAX = fx(310);

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
    // A grab's two boxes are often one ground-only and one air-only (Mario's
    // `game_catch`: `CATCH` id 0 `_G`, id 1 `_A`), and the candidate filter that
    // honours an ATTACK's mask honours this one the same way (Plan 3, Task 16b).
    ...(SITUATION[c.situation] !== undefined ? { situation: SITUATION[c.situation] } : {}),
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
    const far = farEnd(bones, fighterId, motion, state.motionFrame, a);
    out.push(withFarEnd(attackHitbox(a, gameFrame, at, state.shieldSetoff.get(a.id)), far));
  }
  for (const c of state.catches) {
    const at = resolve(bones, fighterId, motion, state.motionFrame, c);
    out.push(withFarEnd(catchHitbox(c, gameFrame, at), farEnd(bones, fighterId, motion, state.motionFrame, c)));
  }
  return out;
}

/**
 * The far end of an extended hitbox — `X2, Y2, Z2` on the same bone, an axis
 * left out taking the near end's value — or null for a sphere (Plan 3, Task 17).
 * Both ends sit on one bone, so a bone the table can place for one it can place
 * for the other.
 */
function farEnd(
  bones: BoneTable,
  fighterId: string,
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "bone" | "x" | "y" | "z" | "x2" | "y2" | "z2">,
): { x: number; y: number } | null {
  if (!isCapsule(p)) return null;
  return resolve(bones, fighterId, motion, frame, { bone: p.bone, x: p.x2 ?? p.x, y: p.y2 ?? p.y, z: p.z2 ?? p.z });
}

function withFarEnd(hb: Hitbox, far: { x: number; y: number } | null): Hitbox {
  return far === null ? hb : { ...hb, x2: far.x, y2: far.y };
}

/**
 * A script's boxes as a `MoveDef` hitbox table (Plan 3, Task 18): one entry per
 * stretch of game frames over which a box is live, unchanged and not issued
 * again, each exactly as `scriptHitboxes` builds it for the sim on those frames
 * — so `activeHitboxes(table, g)` lists, frame for frame and in the same order,
 * the boxes the sim hits with on game frame `g`.
 *
 * It is what keeps the readers of `MoveDef.hitboxes` — the renderer's swing and
 * timing, the CPU's reach, the charge hold — on the frames and boxes the sim
 * runs once a script overrides a slot (`withReferenceScripts`). A box issued
 * again (a multi-hit after `clear_all`) starts a new entry, as a new swing. A
 * slot reused in two windows (Mario's down-air drill) keeps its id in both: ids
 * are what the sim's lowest-id priority reads, so they are never renumbered.
 * Entries are by attacks, then catches, then id, then first frame.
 *
 * The boxes are placed through `bones` on the frame each window opens; a box
 * the table moves while it stays live is split into one entry per position. A
 * script that leaves a box live after its last command never clears it, and a
 * table cannot say "until the move ends": that is refused.
 */
export function scriptHitboxTable(script: AcmdScript, fighterId: string, bones: BoneTable): Hitbox[] {
  const { fire } = scheduleOf(script);
  let last = 1;
  for (const e of fire) if (e > last) last = e;
  const out: Hitbox[] = [];
  const open = new Map<string, { box: Hitbox; key: string }>();
  for (let g = 1; g <= last; g++) {
    const st = runScript(script, g);
    const issued = new Set(
      st.fired.flatMap((c) => (c.op === "attack" ? [`a${c.params.id}`] : c.op === "catch" ? [`c${c.params.id}`] : [])),
    );
    const live = new Map<string, Hitbox>();
    for (const hb of scriptHitboxes(st, fighterId, script.motion, g, bones)) live.set(`${hb.grabbing ? "c" : "a"}${hb.id}`, hb);
    for (const [slot, was] of [...open]) {
      const now = live.get(slot);
      if (now !== undefined && !issued.has(slot) && boxKey(now) === was.key) continue;
      out.push({ ...was.box, endFrame: g - 1 });
      open.delete(slot);
    }
    for (const [slot, hb] of live) if (!open.has(slot)) open.set(slot, { box: hb, key: boxKey(hb) });
  }
  if (open.size > 0) {
    throw new Error(`${fighterId} ${script.name}: a box is still live after the script's last command, so its script never clears it`);
  }
  return out.sort((a, b) => Number(a.grabbing === true) - Number(b.grabbing === true) || a.id - b.id || a.startFrame - b.startFrame);
}

/** Everything about a box but the frames it is live on, as a comparable string. */
function boxKey(hb: Hitbox): string {
  return JSON.stringify({ ...hb, startFrame: 0, endFrame: 0 });
}
