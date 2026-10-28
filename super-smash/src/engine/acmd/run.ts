/**
 * The one way the sim asks "what is this fighter's move doing this frame?".
 *
 * `step()` reads hitboxes, projectile spawns, super armour and scripted
 * momentum from the move's `game_` script through here (Plan 2, Task 15), so
 * the four can never disagree about which frame the move is on.
 */

import { moveFrameOf } from "../hitbox";
import { ONE } from "../fixed";
import { isUnmodelledAutolink } from "../knockback";
import type { FighterDef, FighterState, MoveSlot } from "../types";
import { newBonePose } from "./bones";
import type { BoneTable } from "./bones";
import { flatten, runScript, scheduleOf } from "./interpreter";
import type { ScriptFrameState } from "./interpreter";
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
