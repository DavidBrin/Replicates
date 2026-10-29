/**
 * The whole roster's bake, from the committed skeletons (`src/render3d/skeletons/`)
 * and the fighters as the game plays them (Task 13 adds their limb-bone scripts). `roster.test.ts` writes it to
 * `public/bake/roster.bin.gz` under `UPDATE_BAKE=1` and otherwise proves the
 * committed file is exactly what the current clips, scripts and skeletons bake to.
 */

import type { BakedFighter } from "@/engine/acmd/bakeCodec";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { FIGHTERS } from "@/fighters";
import { REFERENCE_SCRIPTS } from "@/fighters/acmd";
import type { SkeletonFile } from "../skeleton/skeleton";
import { bakeFighter } from "./bake";

/** Every bone any of a fighter's reference scripts names (lower case, `top` excluded). */
export function referenceScriptBones(fighterId: string): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(REFERENCE_SCRIPTS[fighterId]?.scripts ?? {})) {
    for (const b of scriptBoneNames(s.commands)) out.add(b);
  }
  return out;
}

export function bakeRoster(skeletons: Readonly<Record<string, SkeletonFile>>): BakedFighter[] {
  return FIGHTERS.map((def) => {
    const skeleton = skeletons[def.id];
    if (skeleton === undefined) throw new Error(`bake: no committed skeleton for ${def.id} (run pnpm models)`);
    return bakeFighter({ def, skeleton, scriptBones: referenceScriptBones(def.id) });
  });
}
