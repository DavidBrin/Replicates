/**
 * The one way the sim asks "what is this fighter's move doing this frame?".
 *
 * `step()` reads hitboxes, projectile spawns, super armour and scripted
 * momentum from the move's `game_` script through here (Plan 2, Task 15), so
 * the four can never disagree about which frame the move is on.
 */

import { actionFrameOf, chargeHoldFrame, moveFrameOf } from "../hitbox";
import { ONE } from "../fixed";
import { isUnmodelledAutolink } from "../knockback";
import type { FighterDef, FighterState, MoveSlot } from "../types";
import { newBonePose } from "./bones";
import type { BoneTable } from "./bones";
import { flatten, runScript, scheduleOf } from "./interpreter";
import type { ActiveMomentum, ScriptFrameState } from "./interpreter";
import { gameScriptFor } from "./legacy";
import type { AcmdScript } from "./types";

export interface MoveScriptFrame {
  readonly script: AcmdScript;
  /** `moveFrameOf(actionFrame)`: the move's game frame, quoted from 1. */
  readonly gameFrame: number;
  readonly state: ScriptFrameState;
}

/**
 * The move's script, run to the frame the move is on. `actionFrame` is 0 on a
 * status's first frame and never negative, so `gameFrame` is always at least 1.
 */
export function moveScriptFrame(def: FighterDef, f: Pick<FighterState, "move" | "actionFrame">): MoveScriptFrame | null {
  if (f.move === null) return null;
  const script = gameScriptFor(def, f.move);
  if (script === null) return null;
  const gameFrame = moveFrameOf(f.actionFrame);
  return { script, gameFrame, state: runScript(script, gameFrame) };
}

/* ------------------------------------------------ what a script leaves out -- */

/** The flag a smash's script raises on the frame its charge holds (`WorkModule::on_flag`). */
const START_SMASH_HOLD = "FIGHTER_STATUS_ATTACK_FLAG_START_SMASH_HOLD";

const opsCache = new WeakMap<AcmdScript, ReadonlySet<string>>();

/** Which commands a script uses at all, loops included (cached per script object). */
function opsOf(script: AcmdScript): ReadonlySet<string> {
  let ops = opsCache.get(script);
  if (ops === undefined) {
    const found = new Set<string>();
    for (const c of flatten(script)) found.add(c.op);
    ops = found;
    opsCache.set(script, ops);
  }
  return ops;
}

/**
 * A move's scripted movement this frame (Plan 5, Task 13). An imported `game_`
 * script publishes none: SSBU moves a fighter by its animation's translation,
 * which no source publishes. So a move running one keeps its legacy `momentum`,
 * on the legacy move's frames (quoted from one, as `gameFrame` is), the earliest
 * listed window winning where two are live, as the compiled script's `order`
 * does. A compiled legacy script carries it as `momentum` commands already, and
 * a script with any `momentum` command of its own is taken at its word.
 */
export function moveMomentum(def: Pick<FighterDef, "moves">, f: Pick<FighterState, "move">, run: MoveScriptFrame): ActiveMomentum | null {
  if (run.state.momentum !== null || f.move === null || opsOf(run.script).has("momentum")) return run.state.momentum;
  for (const m of def.moves[f.move]?.momentum ?? []) {
    const until = m.frame + (m.hold ?? 0);
    if (run.gameFrame >= m.frame && run.gameFrame <= until) return { x: m.x, y: m.y, until, ...(m.airOnly === true ? { airOnly: true } : {}) };
  }
  return null;
}

/**
 * Super armour this frame (Plan 5, Task 13): the script's, or, for a script
 * that never sets it, the legacy move's `superArmourFrames` window.
 */
export function moveSuperArmour(def: Pick<FighterDef, "moves">, f: Pick<FighterState, "move">, run: MoveScriptFrame): boolean {
  if (run.state.superArmour || f.move === null || opsOf(run.script).has("superArmour")) return run.state.superArmour;
  const w = def.moves[f.move]?.superArmourFrames;
  return w !== undefined && run.gameFrame >= w[0] && run.gameFrame <= w[1];
}

/**
 * The projectiles launched this frame (Plan 5, Task 13): the script's own
 * `spawnProjectile` (an imported `generate_article` the roster defines,
 * `ARTICLE_PROJECTILES`, or a compiled legacy spawn), or, for a script that
 * launches nothing, the legacy move's `spawnFrame`s.
 */
export function moveSpawns(def: Pick<FighterDef, "moves">, f: Pick<FighterState, "move">, run: MoveScriptFrame): string[] {
  if (f.move === null || opsOf(run.script).has("spawnProjectile")) {
    return run.state.fired.flatMap((c) => (c.op === "spawnProjectile" ? [c.id] : []));
  }
  return (def.moves[f.move]?.projectiles ?? []).filter((p) => p.spawnFrame === run.gameFrame).map((p) => p.id);
}

/**
 * The `actionFrame` a charging smash holds on (ruling P5-R15, one rule for every
 * reader: `attackMain` and the renderer's `MoveTiming.chargeHold`): its published
 * hold frame where the move gives one (`MoveDef.smashHold`, Task 13 fix round 2,
 * ruling R-T13i: every smash that runs its legacy move), else the game frame
 * before the one its script raises
 * `FIGHTER_STATUS_ATTACK_FLAG_START_SMASH_HOLD` on (Task 13 fix round 1, ruling
 * R-T13e: SmashWiki's "Charges between" is flag − 1 to flag on every page
 * checked, e.g. "Pikachu (SSBU)/Forward smash",
 * https://www.ssbwiki.com/Pikachu_(SSBU)/Forward_smash, revision 1659944,
 * "Charges between 9-10", its script raising it on 10), else
 * `chargeHoldFrame(move)`, one short of its earliest box: the same "one before"
 * as that rule. Every imported smash script raises it before its first box; a
 * compiled legacy script never does. Read off the schedule, so no frame is run.
 */
export function smashHoldFrame(def: Pick<FighterDef, "moves" | "scripts">, f: Pick<FighterState, "move">): number {
  if (f.move === null) return 1;
  const published = def.moves[f.move]?.smashHold;
  if (published !== undefined) return Math.max(1, actionFrameOf(published));
  const script = gameScriptFor(def, f.move);
  if (script !== null) {
    const { commands, fire } = scheduleOf(script);
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      if (c.op === "setFlag" && c.on && c.flag === START_SMASH_HOLD) return Math.max(1, actionFrameOf(fire[i]) - 1);
    }
  }
  const move = def.moves[f.move];
  return move === undefined ? 1 : chargeHoldFrame(move);
}

/**
 * The game frame a throw's `ATK_HIT_ABS` lands on — its strike, what its clip
 * and its timing anchor on (ruling P5-R9) — or null for a script that fires
 * none. Read off the schedule, so no frame is run.
 */
export function throwStrikeFrame(script: AcmdScript): number | null {
  const { commands, fire } = scheduleOf(script);
  for (let i = 0; i < commands.length; i++) if (commands[i].op === "hitAbs") return fire[i];
  return null;
}

/**
 * Get every script a fighter can run ready for `bones`, at load, and refuse
 * one the sim could not run — so nothing is refused, and nothing is compiled,
 * mid-match.
 *
 * - Each script's fire-frame schedule is built now (`scheduleOf`), so its first
 *   `runScript` does no BigInt work, and a script whose timing does not compile
 *   throws here.
 * - Every bone an ATTACK or CATCH names must be one `bones` can place, or this
 *   throws; the same refusal in `scriptHitboxes` would otherwise fire inside
 *   `step()`, the first frame that hitbox went live. Motion frame 1 is asked:
 *   a table answers every frame of a motion it knows, clamping the rest
 *   (`BoneTable.pose`), so a bone it places on one frame it places on all.
 * - An extended (capsule) ATTACK or CATCH loads like any other (Plan 3, Task
 *   17): its far end is on the same bone as its near end, so the bone check
 *   above covers both.
 * - A `MoveDef` hitbox with a far end (`x2`/`y2`) throws where the `MoveDef`
 *   is what runs: the legacy compile reads a sphere, and a capsule is scripted
 *   instead. Where a script overrides the slot the compile never reads it, and
 *   the table may be the script's own boxes, capsules included
 *   (`withReferenceScripts`; the renderer and the CPU read far ends, Plan 3,
 *   Task 18).
 * - A projectile's hitbox with a far end throws whatever runs the slot: a
 *   projectile is a sphere.
 * - A hitbox with an autolink angle the engine does not model (363°, 366°,
 *   368°) throws, in whatever runs the slot: a script's boxes, the compiled
 *   legacy move's, or a projectile's (Plan 3, Task 19; `AUTOLINK_UNMODELLED`).
 */
export function prepareFighterScripts(def: FighterDef, bones: BoneTable): void {
  const slots = new Set([...Object.keys(def.moves), ...Object.keys(def.scripts ?? {})] as MoveSlot[]);
  const scratch = newBonePose();
  for (const slot of slots) {
    refuseFarEnds(def, slot);
    refuseUnmodelledProjectileAngles(def, slot);
    const script = gameScriptFor(def, slot);
    if (script === null) continue;
    scheduleOf(script);
    for (const c of flatten(script)) {
      if (c.op === "attack") refuseUnmodelledAngle(def, slot, `hitbox ${c.params.id}`, c.params.angle);
      if (c.op !== "attack" && c.op !== "catch") continue;
      if (!bones.pose(def.id, script.motion, 1, c.params.bone, scratch)) {
        throw new Error(
          `${def.id} ${slot} (${script.name}): no pose for bone "${c.params.bone}" of motion ${script.motion} in bone table ${bones.fingerprint}`,
        );
      }
    }
  }
}

/**
 * Throw for an autolink angle the engine does not model (363°, 366°, 368°),
 * naming the fighter, the move and the angle. The sim would launch such a box as
 * something else (`isUnmodelledAutolink`), so it fails here, at load, and not in
 * a match.
 */
function refuseUnmodelledAngle(def: FighterDef, slot: MoveSlot, what: string, angle: number): void {
  if (!isUnmodelledAutolink(angle)) return;
  throw new Error(
    `${def.id} ${slot}: ${what} has angle ${angle / ONE}°, an autolink angle the engine does not model (only 365° and 367° are)`,
  );
}

/** The same refusal for the hitboxes of the projectiles `slot` throws, whatever runs the slot. */
function refuseUnmodelledProjectileAngles(def: FighterDef, slot: MoveSlot): void {
  for (const p of def.moves[slot]?.projectiles ?? []) {
    refuseUnmodelledAngle(def, slot, `projectile "${p.id}" hitbox`, p.hitbox.angle);
  }
}

/**
 * Throw for a far end (`x2`/`y2`) on a hitbox of the legacy `MoveDef` in `slot`
 * that the legacy compile would read (no script overrides the slot), or on one
 * of its projectiles.
 */
function refuseFarEnds(def: FighterDef, slot: MoveSlot): void {
  const move = def.moves[slot];
  if (move === undefined) return;
  const compiled = def.scripts?.[slot] === undefined;
  for (const hb of compiled ? move.hitboxes : []) {
    if (hb.x2 !== undefined || hb.y2 !== undefined) {
      throw new Error(`${def.id} ${slot}: hitbox ${hb.id} has a far end (x2/y2): a MoveDef hitbox is a sphere, script a capsule`);
    }
  }
  for (const p of move.projectiles ?? []) {
    if (p.hitbox.x2 !== undefined || p.hitbox.y2 !== undefined) {
      throw new Error(`${def.id} ${slot}: projectile "${p.id}" hitbox has a far end (x2/y2): a projectile's hitbox is a sphere`);
    }
  }
}
