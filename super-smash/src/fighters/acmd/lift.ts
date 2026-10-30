/**
 * The commands the importer leaves as `unknown` that Plan 5 runs: a throw's
 * `ATTACK_ABS` and `ATK_HIT_ABS`, a pummel's `set_catch_only_all`, and Marth's
 * throws' `FT_CATCH_STOP` and Fox's grabs' `FT_START_ADJUST_MOTION_FRAME` (fix
 * round 1).
 *
 * Lifted here, at activation, rather than in the generated files, so the
 * committed imports stay byte-for-byte what `scripts/import-acmd.mjs` wrote.
 * `parseArgs` is the importer's own argument splitter.
 */

import { fx } from "@/engine/fixed";
import type { AbsParams, AcmdCommand, AcmdScript } from "@/engine/acmd/types";
import { parseArgs, unhash } from "./parse";

const ABS = /^ATTACK_ABS\((.*)\)$/;
/** `FT_CATCH_STOP(4, 1)`: the stop's length, then a flag the replica does not read. */
const CATCH_STOP = /^FT_CATCH_STOP\((\d+),/;

/**
 * `ATTACK_ABS(Kind=…, ID=0, Damage=8.0, Angle=45, KBG=65, FKB=0, BKB=60, Hitlag=0.0, …)`,
 * or null for anything else, another kind, or a number that does not read (the
 * command then stays `unknown`, and `activatable` keeps its script off).
 */
export function parseAbs(raw: string): AbsParams | null {
  const m = ABS.exec(raw);
  if (m === null) return null;
  const a = parseArgs(m[1]);
  const kind = a.Kind === "FIGHTER_ATTACK_ABSOLUTE_KIND_THROW" ? "throw" : a.Kind === "FIGHTER_ATTACK_ABSOLUTE_KIND_CATCH" ? "catch" : null;
  if (kind === null) return null;
  const nums = [a.Damage, a.Angle, a.KBG, a.FKB, a.BKB, a.Hitlag].map(Number);
  if (!nums.every(Number.isFinite)) return null;
  const [damage, angle, kbg, fkb, bkb, hitlag] = nums.map(fx);
  return { kind, damage, angle, kbg, fkb, bkb, hitlag, collisionAttr: unhash(a.Effect ?? 'hash40("collision_attr_normal")') };
}

/** The lifted commands, or the very same array when none of them lifts. */
function liftAll(commands: readonly AcmdCommand[]): readonly AcmdCommand[] {
  const out = commands.map(lift);
  return out.every((c, i) => c === commands[i]) ? commands : out;
}

function lift(c: AcmdCommand): AcmdCommand {
  if (c.op === "loop") {
    const body = liftAll(c.body);
    return body === c.body ? c : { ...c, body };
  }
  if (c.op !== "unknown") return c;
  const abs = parseAbs(c.raw);
  if (abs !== null) return { op: "attackAbs", params: abs };
  if (c.raw.startsWith("ATK_HIT_ABS(FIGHTER_ATTACK_ABSOLUTE_KIND_THROW")) return { op: "hitAbs" };
  if (c.raw.startsWith("AttackModule::set_catch_only_all(true")) return { op: "catchOnly", on: true };
  if (c.raw.startsWith("AttackModule::set_catch_only_all(false")) return { op: "catchOnly", on: false };
  // Fox's grab and dash grab run `FT_MOTION_RATE` 0.8 and 0.9 from frame 1 and call
  // this on the catch frame. UNVERIFIED reading: the motion runs at 1 from there.
  // It is what makes UFD's numbers (https://ultimateframedata.com/fox): the grab on
  // game frame 6 of 36 and the dash grab on 10 of 44, out of CancelFrames 38 and
  // 46; at 0.8 and 0.9 throughout they would end on 30 and 41. No other imported
  // script calls it.
  if (c.raw === "FT_START_ADJUST_MOTION_FRAME_arg1(1)") return { op: "motionRate", rate: [1, 1] };
  const stop = CATCH_STOP.exec(c.raw);
  if (stop !== null && Number(stop[1]) >= 1) return { op: "catchStop", frames: Number(stop[1]) };
  return c;
}

const cache = new WeakMap<AcmdScript, AcmdScript>();

/**
 * `script` with the commands above lifted: the same object for the same script,
 * and `script` itself when it has none of them.
 */
export function liftScript(script: AcmdScript): AcmdScript {
  let out = cache.get(script);
  if (out === undefined) {
    const commands = liftAll(script.commands);
    out = commands === script.commands ? script : { ...script, commands };
    cache.set(script, out);
  }
  return out;
}
