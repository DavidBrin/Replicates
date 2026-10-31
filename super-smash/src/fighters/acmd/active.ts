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
 * - its legacy move carries nothing timed against its own frames that the
 *   script cannot carry (`PLAN5_BEHAVIOUR`: a charge loop, a reflector or
 *   counter window, a mouthful, a carry, a stall, ...). Scripted momentum,
 *   projectiles, super armour and a smash's charge no longer keep a move off
 *   its script (Plan 5, Task 13): the engine reads each from the script, or from
 *   the legacy move where the script publishes none (`engine/acmd/run.ts`), and
 *   a `generate_article` of a projectile the roster defines is lifted to a
 *   spawn (`lift.ts`);
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
import { frame as frameCmd } from "@/engine/acmd/dsl";
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
  // Plan 5, Task 13: a roster projectile's `generate_article`, lifted by `liftScript`.
  "spawnProjectile",
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

/**
 * Engine calls with an effect the replica does not model, which an aerial up
 * special's script may make and still run (Plan 5, Task 13b: Link's aerial Spin
 * Attack, `game_specialairhi`, the one the brief asks to run):
 * - `notify_event_msc_cmd(0x2127e37c07, GROUND_CLIFF_CHECK_KIND_*)`, the frame a
 *   move starts to grab ledges (SmashWiki "Link (SSBU)/Up special": "The move enables
 *   ledge grabs from the front starting on frame 15, and from behind starting on
 *   frame 34"). The replica's ledge rule is the engine's own for every falling
 *   fighter (`findLedgeGrab`); per-move ledge windows are not modelled.
 * - the position vector its back hits set, `as_hash()const(1, hash40("top"), 10, 20,
 *   10)` then `AttackModule::set_vec_target_pos()` (the page: "All back hits use a
 *   position vector with offsets [10, 20] for 10 frames"): a pull toward a point,
 *   not modelled; the box launches at its own angle.
 * UNVERIFIED (both): what leaving them out changes in a match.
 *
 * Only in the `upBAir` slot. Accepted everywhere, they would also run Samus's and
 * Marth's grounded `game_specialhi`, and Marth's clip lifts its sword boxes about
 * twice as high as his legacy table reaches (the reach ratchet: up 16.0 → 33.8):
 * a placement fault of the kind ruling P5-R16 holds, and outside this task.
 */
const UNMODELLED_PREFIXES: readonly string[] = [
  "notify_event_msc_cmd(0x2127e37c07, GROUND_CLIFF_CHECK_KIND_",
  'methodlib::L2CValue::as_hash()const(1, hash40("top"), 10, 20, 10)',
  "AttackModule::set_vec_target_pos()",
];

/** Longer than any move: a box still live here is never cleared by its script. */
const CLEARED_BY = 300;

function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing: boolean, aerialUp = false): boolean {
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") bones.add(c.params.bone);
    if (c.op === "attack" && isUnmodelledAutolink(c.params.angle)) return false;
    if (c.op === "loop") {
      if (!runnable(c.body, bones, throwing, aerialUp)) return false;
      continue;
    }
    // Only the throw status turns its fighter or stops it (`resolveThrows`).
    if (c.op === "reverseLr" || c.op === "catchStop") {
      if (!throwing) return false;
      continue;
    }
    if (c.op === "unknown") {
      if (!COSMETIC_PREFIXES.some((p) => c.raw.startsWith(p)) && !(aerialUp && UNMODELLED_PREFIXES.some((p) => c.raw.startsWith(p)))) return false;
      continue;
    }
    if (!RUN_OPS.has(c.op)) return false;
  }
  return true;
}

/**
 * Fields whose behaviour is timed against the legacy move's frames, and which
 * no `game_` script carries (Plan 5): a charge loop, a reflector or counter
 * window and its counterattack, Inhale's mouthful, its held loop and pull, its
 * release and its aerial length, Donkey Kong's carry and his cargo throws'
 * knockback armour, a stall, an aerial animation's length, the move's own
 * intangibility, a copied move's damage. A move carrying any of them keeps its
 * compiled legacy script, so they stay on the frames they were authored on.
 *
 * Not here: what the engine reads off the script, or off the legacy move where
 * the script publishes nothing (`moveMomentum`, `moveSpawns`, `moveSuperArmour`,
 * `smashHoldFrame`; Task 13); a back throw's `turnAt`, which only places the
 * turn in the compiled script, a script turning by its own `REVERSE_LR` (Task 7,
 * P5-R7); and `helpless`, the fall that follows whatever ends the move. Nor the
 * up specials' `aim`, `turn`, `rise`, `launch`, `phases`, `fromAir` and
 * `descentHold` (Task 13b), which the engine reads off the move whatever script
 * runs it (`upSpecial.ts`); and a `specialCharge` that loops inside the script's
 * lead, before its first command (`chargeInLead`: Link's Spin Attack). Task 14
 * adds a Final Smash's part (`final`): its trap, scene and launch are the engine's
 * reading of the move, and a cutscene script's boxes hang off `virtualfinalattack`
 * bones no skeleton has. Task 16 adds a rehit.
 */
export const PLAN5_BEHAVIOUR: readonly (keyof MoveDef)[] = [
  "specialCharge",
  "reflector",
  "counter",
  "counterDamage",
  "inhale",
  "holdLoop",
  "release",
  "aerialTotalFrames",
  "cargo",
  "heavyArmour",
  "stall",
  "airTotalFrames",
  "intangible",
  "copyDamage",
  "final",
];

/**
 * A charge that loops inside the move's script lead (`MoveDef.scriptLead`), on a
 * frame before the imported script's first command, is timed against nothing the
 * script runs: the script carries the move whatever the charge holds (Plan 5, Task
 * 13b: Link's Spin Attack, "Charges between 3-4" in its 3-frame start).
 */
function chargeInLead(move: MoveDef): boolean {
  const sc = move.specialCharge;
  return sc !== undefined && sc.loopFrame <= (move.scriptLead ?? 0);
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
  if (PLAN5_BEHAVIOUR.some((k) => move[k] !== undefined && !(k === "specialCharge" && chargeInLead(move)))) return false;
  const lifted = liftScript(script);
  const bones = new Set<string>();
  if (!runnable(lifted.commands, bones, THROW_SLOTS.has(slot), slot === "upBAir")) return false;
  // A throw lands by ATK_HIT_ABS, a projectile special by its spawn (Task 13):
  // either may hang no box on a bone at all.
  const lands = function lands(c: AcmdCommand): boolean {
    return (THROW_SLOTS.has(slot) && c.op === "hitAbs") || c.op === "spawnProjectile" || (c.op === "loop" && c.body.some(lands));
  };
  if ((bones.size === 0 && !lifted.commands.some(lands)) || ![...bones].every(placeable)) return false;
  const end = runScript(lifted, CLEARED_BY);
  return end.attacks.length + end.catches.length === 0;
}

/** Every `frame(n)` in `commands` moved `lead` frames on, loops included. */
function leadFrames(commands: readonly AcmdCommand[], lead: number): AcmdCommand[] {
  return commands.map((c) => (c.op === "frame" ? frameCmd(c.frame + lead) : c.op === "loop" ? { ...c, body: leadFrames(c.body, lead) } : c));
}

const led = new WeakMap<AcmdScript, Map<number, AcmdScript>>();

/**
 * The imported script a move runs: lifted (`liftScript`) and, for a move whose
 * script starts after a segment the import lacks (`MoveDef.scriptLead`; Plan 5,
 * Task 13 fix round 1, R-T13f), with its timeline moved that many frames on: its
 * commands open on frame `lead + 1` and every `frame(n)` is `frame(n + lead)`.
 * At the default rate the motion runs in step, so its `CancelFrame` moves with
 * it (`gameFafOf`). A script that sets a motion rate before its first frame()
 * cannot be led (the rate would govern the lead): none is. Same object for the
 * same script and lead.
 */
export function gameScriptOf(move: Pick<MoveDef, "scriptLead"> | undefined, script: AcmdScript): AcmdScript {
  const lifted = liftScript(script);
  const lead = move?.scriptLead ?? 0;
  if (lead === 0) return lifted;
  let byLead = led.get(lifted);
  if (byLead === undefined) {
    byLead = new Map();
    led.set(lifted, byLead);
  }
  let out = byLead.get(lead);
  if (out === undefined) {
    const first = lifted.commands.findIndex((c) => c.op === "frame" || c.op === "wait");
    if (lifted.commands.slice(0, first < 0 ? lifted.commands.length : first).some((c) => c.op === "motionRate")) {
      throw new Error(`${script.name}: a motion rate before its first frame() cannot be led ${lead} frames`);
    }
    out = { ...lifted, commands: [frameCmd(lead + 1), ...leadFrames(lifted.commands, lead)] };
    byLead.set(lead, out);
  }
  return out;
}

/** The game frame on which the script a move runs reaches its published `CancelFrame` (`faf`, a motion frame), its lead included. */
export function gameFafOf(move: Pick<MoveDef, "scriptLead"> | undefined, script: AcmdScript, faf: number): number {
  return gameFrameOfMotion(gameScriptOf(move, script), faf + (move?.scriptLead ?? 0));
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
    const script = gameScriptOf(move, ref.scripts[key]);
    scripts[slot] = script;
    const faf = ref.faf[key];
    moves[slot] = {
      ...move,
      ...(faf !== undefined ? { totalFrames: gameFafOf(move, ref.scripts[key], faf) - 1 } : {}),
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
 * admits, no more (pinned by `active.test.ts`). 71 of the roster's moves; Plan 5
 * Task 7 added the 28 throws and pummels whose ATTACK_ABS the throw status now reads,
 * and Task 13 the 5 its momentum, spawn, armour and charge fallbacks free: Mario's
 * down smash and Fireball, Pikachu's forward and down smashes and Thunder Jolt.
 */
export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>> = {
  mario: ["jab1", "dashAttack", "dsmash", "dair", "neutralB", "grab", "dashGrab", "pummel", "fthrow", "uthrow", "dthrow"],
  donkeyKong: ["dashAttack", "dair", "grab", "dashGrab", "pummel", "uthrow", "dthrow"],
  link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab", "pummel", "dthrow"],
  samus: ["dashAttack", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
  kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "dthrow"],
  fox: ["jab1", "jab2", "grab", "dashGrab", "pummel", "fthrow"],
  pikachu: ["jab1", "dtilt", "fsmash", "dsmash", "nair", "fair", "neutralB", "grab", "dashGrab", "fthrow", "bthrow", "uthrow"],
  marth: ["sideB", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
};
