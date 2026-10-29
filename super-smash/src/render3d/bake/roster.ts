/**
 * The whole roster's bake, from the committed skeletons (`src/render3d/skeletons/`)
 * and the fighters as the game plays them: with their limb-bone scripts on
 * (`withLimbScripts`, Task 13), so an adopted limb-bone move is baked on its
 * imported script's motion and length, not the legacy move it replaced (Mario's
 * uair: 32 motion frames, not 30). They are the no-table form (`null`, ruling
 * R1(a)): the scripts and their published lengths, which are all a bake reads of
 * a move, with nothing placed through a bake that does not exist yet.
 * `roster.test.ts` writes it to `public/bake/roster.bin.gz` under `UPDATE_BAKE=1`
 * and otherwise proves the committed file is exactly what the current clips,
 * scripts and skeletons bake to.
 */

import type { BakedFighter } from "@/engine/acmd/bakeCodec";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { FIGHTERS } from "@/fighters";
import { REFERENCE_SCRIPTS } from "@/fighters/acmd";
import { withLimbScripts } from "@/fighters/acmd/limb";
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
    return bakeFighter({ def: withLimbScripts(def, null), skeleton, scriptBones: referenceScriptBones(def.id) });
  });
}
