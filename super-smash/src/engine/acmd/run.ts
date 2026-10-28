/**
 * The one way the sim asks "what is this fighter's move doing this frame?".
 *
 * `step()` reads hitboxes, projectile spawns, super armour and scripted
 * momentum from the move's `game_` script through here (Plan 2, Task 15), so
 * the four can never disagree about which frame the move is on.
 */

import { moveFrameOf } from "../hitbox";
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
 * - A `MoveDef` hitbox or a projectile's hitbox with a far end (`x2`/`y2`)
 *   throws: both are spheres (the legacy compile, the renderer and the AI read
 *   them so), and a capsule is scripted instead. A script overriding the slot
 *   does not excuse its `MoveDef`.
 */
export function prepareFighterScripts(def: FighterDef, bones: BoneTable): void {
  const slots = new Set([...Object.keys(def.moves), ...Object.keys(def.scripts ?? {})] as MoveSlot[]);
  const scratch = newBonePose();
  for (const slot of slots) {
    refuseFarEnds(def, slot);
    const script = gameScriptFor(def, slot);
    if (script === null) continue;
    scheduleOf(script);
    for (const c of flatten(script)) {
      if (c.op !== "attack" && c.op !== "catch") continue;
      if (!bones.pose(def.id, script.motion, 1, c.params.bone, scratch)) {
        throw new Error(
          `${def.id} ${slot} (${script.name}): no pose for bone "${c.params.bone}" of motion ${script.motion} in bone table ${bones.fingerprint}`,
        );
      }
    }
  }
}

/** Throw for a far end (`x2`/`y2`) on a hitbox of the legacy `MoveDef` in `slot`, or of one of its projectiles. */
function refuseFarEnds(def: FighterDef, slot: MoveSlot): void {
  const move = def.moves[slot];
  if (move === undefined) return;
  for (const hb of move.hitboxes) {
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
