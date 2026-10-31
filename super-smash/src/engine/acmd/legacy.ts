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
 * A throw compiles as SSBU writes one (Plan 5, Task 7): its launch, the last
 * box to open, is `ATTACK_ABS` + `ATK_HIT_ABS` on that box's frame, laid on the
 * fighter held whatever the geometry; every box of a throw or a pummel is
 * `set_catch_only_all`, hitting the fighter held and nobody else; and a back
 * throw authored pointing forward turns its thrower on `MoveDef.turnAt`
 * (`REVERSE_LR`, ruling P5-R7).
 *
 * `FighterDef.scripts` overrides a slot with a hand-written or imported script;
 * Plans 3 and 4 move slots onto the imported, bone-attached scripts there.
 */

import { ONE } from "../fixed";
import type { FighterDef, Hitbox, MoveDef, MoveSlot } from "../types";
import { ATTR_OF_EFFECT } from "./hitboxes";
import type { AbsParams, AcmdCommand, AcmdScript, AttackParams, MotionKind } from "./types";

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
  // Plan 5, Task 5: Marth's counterattack, `special_lw_hit` (SmashWiki
  // "Marth (SSBU)/Down special", https://www.ssbwiki.com/Marth_(SSBU)/Down_special:
  // "Upon countering an attack, Marth immediately transitions to the first frame
  // of this state").
  counterAttack: "special_lw_hit",
  // Plan 5, Task 8: Donkey Kong's cargo throws (rubendal Motions: `throw_f_f`,
  // `throw_f_b`, `throw_f_hi`, `throw_f_lw`, the motions of `game_throwff` …).
  cargoFthrow: "throw_f_f",
  cargoBthrow: "throw_f_b",
  cargoUthrow: "throw_f_hi",
  cargoDthrow: "throw_f_lw",
  // Plan 5, Task 9: Kirby's swallow and spit (skyline-smash `lua_const.rs`:
  // FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_SWALLOW, _SPIT; the motions' names are
  // the replica's).
  inhaleSwallow: "special_n_swallow",
  inhaleSpit: "special_n_spit",
  // Plan 5, Task 13b: an up special begun in the air (rubendal Motions: Link's
  // `special_air_hi`, the motion of `game_specialairhi`).
  upBAir: "special_air_hi",
};

/**
 * A legacy box's `Hitbox.situation` as the mask an `ATTACK` or `CATCH` takes:
 * ground-only `_G`, air-only `_A`, else both (Plan 5, Task 9 fix round 1: Kirby's
 * Inhale, whose 5.3 catch box takes airborne fighters only and whose far pull
 * takes grounded ones only). No other legacy box sets it.
 */
function situationOf(hb: Hitbox): AttackParams["situation"] {
  if (hb.situation === "ground") return "COLLISION_SITUATION_MASK_G";
  if (hb.situation === "air") return "COLLISION_SITUATION_MASK_A";
  return "COLLISION_SITUATION_MASK_GA";
}

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
    // A transcendent box is the published no-clank setting (`cannotClank`, Plan 5
    // Task 13), a trampling one the no-rebound one (`cannotRebound`, its fix round 1).
    clang: hb.transcendent ? "ATTACK_SETOFF_KIND_OFF" : hb.noRebound ? "ATTACK_SETOFF_KIND_THRU" : "ATTACK_SETOFF_KIND_ON",
    // Plan 5, Task 13 fix round 1: a box that launches by position or backwards says so.
    facing: hb.lr === "position" ? "ATTACK_LR_CHECK_POS" : hb.lr === "back" ? "ATTACK_LR_CHECK_B" : "ATTACK_LR_CHECK_F",
    setWeight: hb.setWeight === true,
    shieldDamage: 0,
    trip: 0,
    rehit: 0,
    reflectable: false,
    absorbable: false,
    // Plan 5, Task 6: a windbox is `Flinchless=true`; written with
    // `DisableHitlag=true` too, as F.L.U.D.D.'s water is (`mario_pumpwater`).
    flinchless: hb.windbox === true,
    noHitlag: hb.windbox === true,
    direct: true,
    situation: situationOf(hb),
    // Plan 5: a turning hit is SSBU's `collision_attr_turn` (Mario's Cape).
    collisionAttr: hb.reverse === true ? "collision_attr_turn" : ATTR_OF_EFFECT[hb.effect ?? "normal"],
    region: "ATTACK_REGION_NONE",
    // Explicit either way, so the hitbox pipeline never classifies a legacy
    // move's angle as a meteor on its own (Plan 3, Task 16).
    meteor: hb.meteor === true,
    ...(hb.forceReaction === true ? { forceReaction: true } : {}),
    ...(hb.whileGrounded !== undefined ? { whileGrounded: hb.whileGrounded } : {}),
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

  // A throw's launch is `ATTACK_ABS` + `ATK_HIT_ABS` (Plan 5): the last box to
  // open is the launch, applied to the held fighter whatever the geometry, and
  // any box before it hits the held fighter only, as a pummel's does.
  const isThrow = THROW_SLOTS.has(move.slot);
  const launch = isThrow ? lastToOpen(move.hitboxes) : null;
  if (isThrow || move.slot === "pummel") at(1).open.push({ op: "catchOnly", on: true });
  if (isThrow && move.turnAt !== undefined) at(move.turnAt).open.push({ op: "reverseLr" });
  for (const hb of move.hitboxes) {
    if (hb.endFrame < hb.startFrame) continue;
    if (hb === launch) {
      at(hb.startFrame).open.push({ op: "attackAbs", params: absFromHitbox(hb) }, { op: "hitAbs" });
      continue;
    }
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
          situation: situationOf(hb),
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
    at(m.frame).open.push({ op: "momentum", x: m.x, y: m.y, hold: m.hold ?? 0, order, ...(m.airOnly === true ? { airOnly: true } : {}) });
  });
  for (const p of move.projectiles ?? []) at(p.spawnFrame).open.push({ op: "spawnProjectile", id: p.id });

  const commands: AcmdCommand[] = [];
  for (const frame of [...beats.keys()].sort((a, b) => a - b)) {
    const b = beats.get(frame)!;
    commands.push({ op: "frame", frame }, ...b.close, ...b.open);
  }
  return { name: `game_${SLOT_MOTION[move.slot].replace(/_/g, "")}`, motion: SLOT_MOTION[move.slot], commands };
}

/**
 * Every throw, whose launch is an `ATTACK_ABS` the throw status lands (Plan 5,
 * Task 7): the four, and Donkey Kong's four cargo throws (Task 8).
 */
export const THROW_SLOTS: ReadonlySet<MoveSlot> = new Set([
  "fthrow",
  "bthrow",
  "uthrow",
  "dthrow",
  "cargoFthrow",
  "cargoBthrow",
  "cargoUthrow",
  "cargoDthrow",
]);

/** The box a legacy throw launches with: the last to open (the later listed of a tie). */
function lastToOpen(hitboxes: readonly Hitbox[]): Hitbox | null {
  let last: Hitbox | null = null;
  for (const hb of hitboxes) if (!hb.grabbing && (last === null || hb.startFrame >= last.startFrame)) last = hb;
  return last;
}

/**
 * A legacy throw box as `ATTACK_ABS(Kind=FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, …)`,
 * field for field as `attackFromHitbox` maps a box: `bkb` the base knockback, a
 * fixed knockback `fkb`. Its hitlag is the box's own multiplier where it states
 * one, else none (fix round 1): SmashWiki "Throw" (https://www.ssbwiki.com/Throw),
 * "Throw releases also usually inflict no hitlag", and every imported throw's
 * `ATTACK_ABS` but Pikachu's down throw carries `Hitlag=0.0`.
 */
export function absFromHitbox(hb: Hitbox): AbsParams {
  return {
    kind: "throw",
    damage: hb.damage,
    angle: hb.angle,
    kbg: hb.knockbackGrowth,
    fkb: hb.fixedKnockback ?? 0,
    bkb: hb.baseKnockback,
    hitlag: hb.hitlagMultiplier ?? 0,
    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
  };
}

const compiled = new WeakMap<MoveDef, AcmdScript>();

/** The script a fighter runs for a move slot: its override, else the compiled legacy move. */
export function gameScriptFor(def: Pick<FighterDef, "moves" | "scripts">, slot: MoveSlot): AcmdScript | null {
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
