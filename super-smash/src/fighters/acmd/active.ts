/**
 * Which imported `game_` scripts the sim runs (Plan 3, Task 18).
 *
 * Plan 2 imported every fighter's published scripts as reference and kept the
 * sim on the compiled legacy moves. A script can run *now*, before Plan 4's
 * bone bake, only if the replica can place and honour everything in it:
 *
 * - every ATTACK and CATCH hangs off a bone the table can place (`placeable`):
 *   for Plan 3, the root bone `top`, the only bone `LEGACY_BONE_TABLE` places;
 *   for Plan 4's limb-bone scripts (`limb.ts`), the root and every bone our
 *   clips place (`render3d/retarget/placeable.ts`);
 * - a throw's `ATTACK_ABS`/`ATK_HIT_ABS` and a pummel's `set_catch_only_all`
 *   are lifted into commands the throw status and the hit pipeline honour
 *   (`lift.ts`; Plan 5, Task 7), so throws and pummels qualify like any move; a
 *   throw that lands by `ATK_HIT_ABS` alone hangs no box, and needs none;
 *   `REVERSE_LR` runs only in a throw, whose status turns the thrower;
 * - its legacy move carries nothing the script would drop: no scripted
 *   momentum, projectile, super armour, smash charge or special charge (those
 *   stay on the compiled legacy script until the energies and the charge read
 *   the script);
 * - every command is one the interpreter runs, or a cosmetic one listed below;
 * - the script clears its own boxes — one that leaves them for its status to
 *   clear (Fox's Reflector) would keep them live for the whole move here;
 * - no box carries an autolink angle the engine does not model (363°, 366°,
 *   368°; `AUTOLINK_UNMODELLED`, Plan 3, Task 19): `prepareFighterScripts`
 *   would refuse it at load, and the rule says so first.
 *
 * `ACTIVE_SCRIPT_SLOTS` is the rule's output written out, so a reviewer sees
 * the list and `active.test.ts` proves it is exactly the rule's output. Plan 4's
 * `LIMB_SCRIPT_SLOTS` (`limb.ts`) is the same rule over the bake's bones, written
 * out to `limb.json` and pinned the same way (`limb.test.ts`).
 */

import { LEGACY_BONE_TABLE, type BoneTable } from "@/engine/acmd/bones";
import { scriptHitboxTable } from "@/engine/acmd/hitboxes";
import { gameFrameOfMotion, runScript } from "@/engine/acmd/interpreter";
import { THROW_SLOTS } from "@/engine/acmd/legacy";
import { isUnmodelledAutolink } from "@/engine/knockback";
import type { AcmdCommand, AcmdScript } from "@/engine/acmd/types";
import type { FighterDef, Hitbox, MoveDef, MoveSlot } from "@/engine/types";
import { liftScript } from "./lift";
import type { ReferenceFighter } from "./reference";

/**
 * Commands the interpreter runs. The sim honours every one but `setFlag`, which
 * the interpreter tracks (`flags`) and nothing reads: a script's `ENABLE_COMBO`
 * and `ENABLE_LANDING` windows are ignored here, and the legacy move's
 * `followUp` and `autoCancel*` stand in for them (Task 18 review).
 */
const RUN_OPS: ReadonlySet<AcmdCommand["op"]> = new Set([
  "frame",
  "wait",
  "attack",
  "catch",
  "clearAll",
  "clear",
  "catchClearAll",
  "catchClear",
  "setFlag",
  "shieldSetoffMul",
  "motionRate",
  "loop",
  // Plan 5, Task 7: lifted from `unknown` by `liftScript`.
  "attackAbs",
  "hitAbs",
  "catchOnly",
  "catchStop",
]);

/** Engine calls with no effect on the replica's sim: collision pushboxes, hit-height tags, VFX, grab-cut bookkeeping. */
const COSMETIC_PREFIXES: readonly string[] = [
  "FighterAreaModuleImpl::enable_fix_jostle_area",
  "JostleModule::set_status",
  "AttackModule::set_attack_height_all",
  "AttackModule::set_no_damage_fly_smoke_all",
  "GrabModule::set_rebound",
  "methodlua2cpp::L2CFighterAnimcmdGameCommon::game_CaptureCutCommon",
  // Plan 5, Task 7: a throw's KO camera and cut-in zoom, and one call read as
  // bookkeeping. UNVERIFIED for that one: `FT_LEAVE_NEAR_OTTOTTO` steps the
  // thrower back from a ledge's teeter (the catch statuses stop at the cliff
  // here instead). `FT_CATCH_STOP` is not cosmetic: it is lifted (`lift.ts`).
  "CHECK_FINISH_CAMERA",
  "FighterCutInManager::",
  "FT_LEAVE_NEAR_OTTOTTO",
];

/** Longer than any move: a box still live here is never cleared by its script. */
const CLEARED_BY = 300;

function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing: boolean): boolean {
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") bones.add(c.params.bone);
    if (c.op === "attack" && isUnmodelledAutolink(c.params.angle)) return false;
    if (c.op === "loop") {
      if (!runnable(c.body, bones, throwing)) return false;
      continue;
    }
    // Only the throw status turns its fighter or stops it (`resolveThrows`).
    if (c.op === "reverseLr" || c.op === "catchStop") {
      if (!throwing) return false;
      continue;
    }
    if (c.op === "unknown") {
      if (!COSMETIC_PREFIXES.some((p) => c.raw.startsWith(p))) return false;
      continue;
    }
    if (!RUN_OPS.has(c.op)) return false;
  }
  return true;
}

/** Plan 3's bones: the root alone, the only bone `LEGACY_BONE_TABLE` places. */
export const ROOT_BONE_ONLY = (bone: string): boolean => bone === "top";

/**
 * The rule above, for one slot. `placeable` says which bones a bone table can
 * place: the root bone for Plan 3; the root and every bone our clips place for
 * Plan 4's `LIMB_SCRIPT_SLOTS` (`limb.ts`).
 */
export function activatable(
  slot: MoveSlot,
  move: MoveDef | undefined,
  script: AcmdScript,
  placeable: (bone: string) => boolean = ROOT_BONE_ONLY,
): boolean {
  if (move === undefined) return false;
  if (move.momentum !== undefined || move.projectiles !== undefined) return false;
  if (move.superArmourFrames !== undefined || move.chargeable === true || move.specialCharge !== undefined) return false;
  const lifted = liftScript(script);
  const bones = new Set<string>();
  if (!runnable(lifted.commands, bones, THROW_SLOTS.has(slot))) return false;
  // A throw lands by ATK_HIT_ABS, and may hang no box on a bone at all.
  const throws = THROW_SLOTS.has(slot) && lifted.commands.some(function lands(c: AcmdCommand): boolean {
    return c.op === "hitAbs" || (c.op === "loop" && c.body.some(lands));
  });
  if ((bones.size === 0 && !throws) || ![...bones].every(placeable)) return false;
  const end = runScript(lifted, CLEARED_BY);
  return end.attacks.length + end.catches.length === 0;
}

/**
 * `def` with `slots` running their imported scripts: `scripts[slot]` is the
 * reference script, its throw and pummel commands lifted (`liftScript`), and
 * the move's `totalFrames` becomes the game frame on which the script's motion
 * reaches its published first actionable frame (`CancelFrame`), − 1, so the
 * move ends when the game's does. `CancelFrame` is a motion frame, and a script
 * that runs `FT_MOTION_RATE` reaches it on another game frame (Plan 5, Task 7
 * fix round 1: `gameFrameOfMotion`; Link's jab, 25 → 24, UFD 23 total).
 *
 * The move's `hitboxes` become the script's own boxes, frame for frame
 * (`scriptHitboxTable`), because the sim is not their only reader: the
 * renderer's swing and timing, the CPU's reach and the charge hold read the
 * `MoveDef`, and a legacy table left in place would have them drawing,
 * spacing and holding for a move the sim no longer runs. The boxes are placed
 * through `bones` (ruling R1(a), Plan 4):
 * - `LEGACY_BONE_TABLE`, the default: Plan 3's slots, whose boxes hang off
 *   `top` alone. The bake places `top` exactly as this table does (it never
 *   bakes the root), so these tables stay right once the bake is installed;
 * - the bake's table: Plan 4's limb-bone slots (`withLimbScripts`), whose boxes
 *   only the bake can place;
 * - `null`: no table is placed and the legacy `hitboxes` stay — the scripts and
 *   their published lengths only. That is the bake's own input (`bakeRoster`),
 *   which reads nothing of a move but its `totalFrames` and its script, and has
 *   no bake to place through yet.
 *
 * A box the table cannot place throws, naming the fighter, the move and the
 * script. The compiled legacy script never reads this table: the script
 * overrides the slot (`gameScriptFor`). Everything else about the legacy move
 * stays.
 */
export function withReferenceScripts(
  def: FighterDef,
  ref: ReferenceFighter,
  slots: readonly MoveSlot[],
  bones: BoneTable | null = LEGACY_BONE_TABLE,
): FighterDef {
  const scripts: Partial<Record<MoveSlot, AcmdScript>> = { ...def.scripts };
  const moves: Partial<Record<MoveSlot, MoveDef>> = { ...def.moves };
  for (const slot of slots) {
    const key = ref.slots[slot];
    const move = def.moves[slot];
    if (key === undefined || move === undefined) throw new Error(`${def.id} ${slot}: no reference script or legacy move`);
    const script = liftScript(ref.scripts[key]);
    scripts[slot] = script;
    const faf = ref.faf[key];
    moves[slot] = {
      ...move,
      ...(faf !== undefined ? { totalFrames: gameFrameOfMotion(script, faf) - 1 } : {}),
      ...(bones !== null ? { hitboxes: syncedTable(def, slot, script, bones) } : {}),
    };
  }
  return { ...def, scripts, moves };
}

/** `scriptHitboxTable`, with the fighter, the move and the script named on a refusal. */
function syncedTable(def: FighterDef, slot: MoveSlot, script: AcmdScript, bones: BoneTable): Hitbox[] {
  try {
    return scriptHitboxTable(script, def.id, bones);
  } catch (e) {
    throw new Error(`${def.id} ${slot} (${script.name}): ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

/**
 * The slots each fighter runs from its imported script — every slot the rule
 * admits, no more (pinned by `active.test.ts`). 66 of the roster's moves; Plan 5
 * Task 7 added the 28 throws and pummels whose ATTACK_ABS the throw status now reads.
 */
export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>> = {
  mario: ["jab1", "dashAttack", "dair", "grab", "dashGrab", "pummel", "fthrow", "uthrow", "dthrow"],
  donkeyKong: ["dashAttack", "dair", "grab", "dashGrab", "pummel", "uthrow", "dthrow"],
  link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab", "pummel", "dthrow"],
  samus: ["dashAttack", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
  kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "dthrow"],
  fox: ["jab1", "jab2", "grab", "dashGrab", "pummel", "fthrow"],
  pikachu: ["jab1", "dtilt", "nair", "fair", "grab", "dashGrab", "fthrow", "bthrow", "uthrow"],
  marth: ["sideB", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
};
