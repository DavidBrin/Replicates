/**
 * The whole roster's bake inputs (Plan 4). Task 10 adds `bakeRoster`.
 */

import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { REFERENCE_SCRIPTS } from "@/fighters/acmd";

/** Every bone any of a fighter's reference scripts names (lower case, `top` excluded). */
export function referenceScriptBones(fighterId: string): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(REFERENCE_SCRIPTS[fighterId]?.scripts ?? {})) {
    for (const b of scriptBoneNames(s.commands)) out.add(b);
  }
  return out;
}
