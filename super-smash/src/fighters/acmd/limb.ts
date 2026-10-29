/**
 * The published `game_` scripts whose hitboxes hang off limbs, switched on
 * (Plan 4, Task 13) — only in the game's own context, beside the bake that can
 * place those limbs (`game/bake.ts` `bakedContext`). The plain roster and
 * `registryContext` keep Plan 3's root-bone set, so a test that steps without
 * the bake never meets a bone it cannot place.
 *
 * The rule is Plan 3's `activatable` with the bones widened to the root plus
 * every bone in the fighter's committed skeleton (`src/render3d/skeletons/`);
 * `limb.json` is its output written out, regenerated and pinned by
 * `limb.test.ts`, so a reviewer sees exactly which moves changed.
 */

import type { BoneTable } from "@/engine/acmd/bones";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { withReferenceScripts } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import LIMB from "./limb.json";

/** Per fighter, the slots running their imported limb-bone script in the game. */
export const LIMB_SCRIPT_SLOTS = LIMB as Readonly<Record<string, readonly MoveSlot[]>>;

/** Each def's game form, per bone table it was placed through. */
const placed = new WeakMap<BoneTable, WeakMap<FighterDef, FighterDef>>();
/** Each def's game form with no table placed (the bake's input). */
const unplaced = new WeakMap<FighterDef, FighterDef>();

function formsFor(bones: BoneTable | null): WeakMap<FighterDef, FighterDef> {
  if (bones === null) return unplaced;
  let forms = placed.get(bones);
  if (forms === undefined) {
    forms = new WeakMap();
    placed.set(bones, forms);
  }
  return forms;
}

/**
 * `def` with its limb-bone slots running their imported scripts, at their
 * published lengths, and their `MoveDef` tables the scripts' boxes placed
 * through `bones` (`withReferenceScripts`, ruling R1(a)): the bake's table
 * wherever the game plays, `null` only for the bake's own input (`bakeRoster`),
 * which keeps the legacy tables. Same object for the same def and table, so the
 * game's context hands out the very defs `prepareRoster` checked.
 */
export function withLimbScripts(def: FighterDef, bones: BoneTable | null): FighterDef {
  const forms = formsFor(bones);
  let out = forms.get(def);
  if (out === undefined) {
    const slots = LIMB_SCRIPT_SLOTS[def.id] ?? [];
    out = slots.length === 0 ? def : withReferenceScripts(def, REFERENCE_SCRIPTS[def.id], slots, bones);
    forms.set(def, out);
  }
  return out;
}
