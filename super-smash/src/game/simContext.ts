/**
 * The `SimContext` the game runs the engine with — offline in `matchRunner`,
 * online through `ENGINE_ROLLBACK_DEPS`.
 *
 * It is the registry context plus the bone table script hitboxes resolve
 * through (`SimContext.bones`, DECISIONS D55). Plan 2 has only the root bone
 * (`LEGACY_BONE_TABLE`); Plan 4 replaces that value with its bake
 * (`layeredBoneTable(bakedBoneTable(…), LEGACY_BONE_TABLE)`). That alone is not
 * enough: `registerFighters` prepares and checks every script against
 * `registryContext.bones`, not this context's `bones`, so Plan 4 must also
 * prepare the scripts against the bake (`prepareFighterScripts`), or a bone the
 * bake cannot place fails mid-match instead of at load. The table is never a
 * module global inside the engine: a caller that wants a different one passes
 * a different context.
 */

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { registryContext, type SimContext } from "@/engine/simulate";

export const GAME_SIM_CONTEXT: SimContext = { ...registryContext, bones: LEGACY_BONE_TABLE };

/**
 * What two online peers compare before a match. A different bone table is a
 * different game — hitboxes land elsewhere — and rollback would desync on the
 * first hit, so a peer whose fingerprint differs is refused.
 */
export function engineFingerprint(ctx: SimContext = GAME_SIM_CONTEXT): string {
  return (ctx.bones ?? LEGACY_BONE_TABLE).fingerprint;
}
