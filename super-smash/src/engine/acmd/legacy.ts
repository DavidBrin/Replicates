/**
 * Every legacy `MoveDef` as a `game_` script (Plan 2, Task 14).
 *
 * The roster's moves were authored as hitbox tables with start and end frames.
 * This compiles each one, mechanically and at load, into the script the game
 * would run: `frame(start) ATTACK(...)`, `frame(end + 1) AttackModule::clear(id)`,
 * armour on and off, momentum, projectile spawns. Every hitbox hangs off the
 * root bone `top` with its legacy offset as the script's Z (forward) and Y (up),
 * so `LEGACY_BONE_TABLE` puts it exactly where it is today.
 *
 * `FighterDef.scripts` overrides a slot with a hand-written or imported script;
 * Plans 3 and 4 move slots onto the imported, bone-attached scripts there.
 */

import { ONE } from "../fixed";
import type { FighterDef, Hitbox, MoveDef, MoveSlot } from "../types";
import { ATTR_OF_EFFECT } from "./hitboxes";
import type { AcmdCommand, AcmdScript, AttackParams, MotionKind } from "./types";

/** Which SSBU motion each move slot plays (rubendal `Motions`, e.g. Mario's `game_attacks3` → `attack_s3_s`). */
export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
  jab1: "attack_11",
  jab2: "attack_12",
  jab3: "attack_13",
  rapidJab: "attack_100",
  ftilt: "attack_s3_s",
  utilt: "attack_hi3",
  dtilt: "attack_lw3",
  dashAttack: "attack_dash",
  fsmash: "attack_s4_s",
  usmash: "attack_hi4",
  dsmash: "attack_lw4",
  nair: "attack_air_n",
  fair: "attack_air_f",
  bair: "attack_air_b",
  uair: "attack_air_hi",
  dair: "attack_air_lw",
  neutralB: "special_n",
  sideB: "special_s",
  upB: "special_hi",
  downB: "special_lw",
  grab: "catch",
  dashGrab: "catch_dash",
  pummel: "catch_attack",
  fthrow: "throw_f",
  bthrow: "throw_b",
  uthrow: "throw_hi",
  dthrow: "throw_lw",
  ledgeAttack: "cliff_attack_quick",
  getUpAttack: "down_attack_u",
  finalSmash: "final",
};

/**
 * A legacy hitbox as `ATTACK` arguments on the root bone. A legacy hitbox is a
 * sphere: one with a far end (`x2`/`y2`) is refused rather than compiled to a
 * sphere, which would quietly shrink the move; a capsule is scripted with
 * `ATTACK(..., X2, Y2, Z2)` (Plan 3, Task 17).
 */
export function attackFromHitbox(hb: Hitbox): AttackParams {
  if (hb.x2 !== undefined || hb.y2 !== undefined) {
    throw new Error(`legacy hitbox ${hb.id} has a far end (x2/y2): a legacy hitbox is a sphere`);
  }
  return {
    id: hb.id,
    part: 0,
    bone: "top",
    damage: hb.damage,
    angle: hb.angle,
    kbg: hb.knockbackGrowth,
    fkb: hb.fixedKnockback ?? 0,
    bkb: hb.baseKnockback,
    size: hb.radius,
    x: 0,
    y: hb.y,
    z: hb.x,
    hitlag: hb.hitlagMultiplier ?? ONE,
    sdi: ONE,
    clang: hb.transcendent ? "ATTACK_SETOFF_KIND_THRU" : "ATTACK_SETOFF_KIND_ON",
    facing: "ATTACK_LR_CHECK_F",
    setWeight: hb.setWeight === true,
    shieldDamage: 0,
    trip: 0,
    rehit: 0,
    reflectable: false,
    absorbable: false,
    flinchless: false,
    noHitlag: false,
    direct: true,
    situation: "COLLISION_SITUATION_MASK_GA",
    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
    region: "ATTACK_REGION_NONE",
    // Explicit either way, so the hitbox pipeline never classifies a legacy
    // move's angle as a meteor on its own (Plan 3, Task 16).
    meteor: hb.meteor === true,
  };
}

interface Beat {
  readonly close: AcmdCommand[];
  readonly open: AcmdCommand[];
}

/** Compile one legacy move. Pure; `gameScriptFor` caches it. */
export function legacyGameScript(move: MoveDef): AcmdScript {
  const beats = new Map<number, Beat>();
  const at = (frame: number): Beat => {
    const f = frame < 1 ? 1 : frame;
    let b = beats.get(f);
    if (b === undefined) {
      b = { close: [], open: [] };
      beats.set(f, b);
    }
    return b;
  };

  for (const hb of move.hitboxes) {
    if (hb.endFrame < hb.startFrame) continue;
    if (hb.grabbing) {
      at(hb.startFrame).open.push({
        op: "catch",
        params: {
          id: hb.id,
          bone: "top",
          size: hb.radius,
          x: 0,
          y: hb.y,
          z: hb.x,
          status: "FIGHTER_STATUS_KIND_CAPTURE_PULLED",
          situation: "COLLISION_SITUATION_MASK_GA",
        },
      });
      at(hb.endFrame + 1).close.push({ op: "catchClear", id: hb.id });
      continue;
    }
    at(hb.startFrame).open.push({ op: "attack", params: attackFromHitbox(hb) });
    if (hb.shieldstunMultiplier !== undefined) {
      at(hb.startFrame).open.push({ op: "shieldSetoffMul", id: hb.id, mul: hb.shieldstunMultiplier });
    }
    at(hb.endFrame + 1).close.push({ op: "clear", id: hb.id });
  }
  if (move.superArmourFrames !== undefined) {
    const [from, to] = move.superArmourFrames;
    at(from).open.push({ op: "superArmour", on: true });
    at(to + 1).close.push({ op: "superArmour", on: false });
  }
  (move.momentum ?? []).forEach((m, order) => {
    at(m.frame).open.push({ op: "momentum", x: m.x, y: m.y, hold: m.hold ?? 0, order });
  });
  for (const p of move.projectiles ?? []) at(p.spawnFrame).open.push({ op: "spawnProjectile", id: p.id });

  const commands: AcmdCommand[] = [];
  for (const frame of [...beats.keys()].sort((a, b) => a - b)) {
    const b = beats.get(frame)!;
    commands.push({ op: "frame", frame }, ...b.close, ...b.open);
  }
  return { name: `game_${SLOT_MOTION[move.slot].replace(/_/g, "")}`, motion: SLOT_MOTION[move.slot], commands };
}

const compiled = new WeakMap<MoveDef, AcmdScript>();

/** The script a fighter runs for a move slot: its override, else the compiled legacy move. */
export function gameScriptFor(def: FighterDef, slot: MoveSlot): AcmdScript | null {
  const own = def.scripts?.[slot];
  if (own !== undefined) return own;
  const move = def.moves[slot];
  if (move === undefined) return null;
  let s = compiled.get(move);
  if (s === undefined) {
    s = legacyGameScript(move);
    compiled.set(move, s);
  }
  return s;
}
