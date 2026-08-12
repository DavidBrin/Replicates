/**
 * Where the data meets the engine.
 *
 * `engine/` deliberately imports neither the roster nor the stages — it holds a
 * registry and asks for definitions by id, which is what keeps the simulation
 * free of everything that would make it non-deterministic (DECISIONS D19). The
 * cost of that inversion is that *someone* has to fill the registry before the
 * first `step()`, and this is that someone.
 *
 * It also reconciles one seam. The menus and the input layer were built against
 * the same spec by different hands and named the control schemes differently —
 * the UI calls them `mirrored` and `rightCluster`, the input layer calls them
 * `wasd` and `localP2`. Rather than rename either and break one side's tests,
 * the mapping lives here, in the module whose whole job is joining the two.
 */

import { FIGHTERS, getFighter as lookupFighter } from "@/fighters";
import { STAGES, resolveStage } from "@/stages";
import { registerFighters, registerStages } from "@/engine/simulate";
import { allStageForms } from "@/stages";
import type { FighterDef, StageDef } from "@/engine/types";
import { CONFIG_ARROWS, CONFIG_WASD, CONFIG_LOCAL_P2, type Scheme } from "@/input/schemes";
import type { SchemeId } from "@/lib/matchConfig";

let registered = false;

/**
 * Idempotent because Next renders a client component more than once in
 * development, and registering the same fighter twice would either throw or
 * silently double the roster depending on the registry's mood. Cheap insurance.
 */
export function bootstrapEngine(): void {
  if (registered) return;
  registerFighters(FIGHTERS);
  // Every Ω and Battlefield form is registered too, because `GameState.stageId`
  // is a single string: a stage form has to be reachable by id or the match
  // cannot be recreated from its own state (which rollback requires).
  registerStages(allStageForms());
  registered = true;
}

export function getFighterOrThrow(id: string): FighterDef {
  const def = lookupFighter(id);
  if (!def) throw new Error(`Unknown fighter "${id}"`);
  return def;
}

export function getStageOrThrow(id: string): StageDef {
  const stage = resolveStage(id);
  if (!stage) throw new Error(`Unknown stage "${id}"`);
  return stage;
}

/** The menus' scheme vocabulary, translated to the input layer's. */
const SCHEME_BY_MENU_ID: Record<SchemeId, Scheme> = {
  arrows: CONFIG_ARROWS,
  mirrored: CONFIG_WASD,
  rightCluster: CONFIG_LOCAL_P2,
};

export function schemeForMenuId(id: SchemeId): Scheme {
  return SCHEME_BY_MENU_ID[id] ?? CONFIG_ARROWS;
}

export { FIGHTERS, STAGES };
