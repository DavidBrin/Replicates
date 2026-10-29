/**
 * The `SimContext` the game runs the engine with — offline in `matchRunner`,
 * online through `ENGINE_ROLLBACK_DEPS`.
 *
 * It is the registry context plus the bone table script hitboxes resolve
 * through (`SimContext.bones`, DECISIONS D55). It starts on Plan 2's root bone
 * (`LEGACY_BONE_TABLE`) and stays there until Plan 4's `installBake`
 * (`game/bake.ts`) swaps the bake in, once it has loaded: `bones` becomes the
 * bake's layered table (`layeredBoneTable(bakedBoneTable(…), LEGACY_BONE_TABLE)`),
 * `bake` its clocks and hurtboxes, and `fighter` hands out each registered
 * fighter with its limb-bone scripts on (`withLimbScripts`, Task 13), which only
 * the bake can place. Nothing installs it at load, so a test that steps with
 * this context plays the root bone and Plan 3's scripts until it installs the bake.
 *
 * `registerFighters` prepares and checks every script against
 * `registryContext.bones`, the root bone, not this context's, so that check says
 * nothing about the bake's. `installBake` therefore prepares the fighters it
 * hands out against the bake itself (`prepareFighterScripts`, via
 * `prepareRoster`): a bone the bake cannot place, or a 363°/366°/368° box, fails
 * at install, not mid-match, and leaves this context and `GAME_ENGINE_RULES`
 * untouched. The table is never a module global inside the engine: a caller
 * that wants a different one passes a different context.
 *
 * Installing the bake changes what `engineFingerprint` reads — the bones, and
 * the running slots in `GAME_ENGINE_RULES` — so it changes what `localBuild()`
 * stamps in the middle of a session (see `ensureBakeInstalled`).
 */

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { FNV_OFFSET, mixInt, mixString } from "@/engine/hash";
import { registryContext, type SimContext } from "@/engine/simulate";
import type { MoveSlot } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";

/** Mutable so `installBake` (Plan 4, `game/bake.ts`) can swap the bake in once it has loaded. */
export const GAME_SIM_CONTEXT: { -readonly [K in keyof SimContext]: SimContext[K] } = { ...registryContext, bones: LEGACY_BONE_TABLE };

/** What, besides the bones, makes two builds the same game (Plan 3, Task 20). */
export interface EngineRules {
  /** `ENGINE_RULES_VERSION`. */
  readonly version: number;
  /** Which moves run their imported scripts (`ACTIVE_SCRIPT_SLOTS`, plus `LIMB_SCRIPT_SLOTS` once the bake is installed). */
  readonly activeSlots: Readonly<Record<string, readonly MoveSlot[]>>;
}

/**
 * Mutable like `GAME_SIM_CONTEXT`: `installBake` (Plan 4) adds the limb-bone
 * slots it switches on (`LIMB_SCRIPT_SLOTS`), so a build with a different
 * `limb.json` has a different fingerprint even when its bake is the same.
 * Until then it names Plan 3's root-bone slots, the ones the plain roster runs.
 */
export const GAME_ENGINE_RULES: { -readonly [K in keyof EngineRules]: EngineRules[K] } = {
  version: ENGINE_RULES_VERSION,
  activeSlots: ACTIVE_SCRIPT_SLOTS,
};

/** Two slot tables as one: every slot either runs, each fighter's in a stable order. */
export function mergeSlots(
  a: Readonly<Record<string, readonly MoveSlot[]>>,
  b: Readonly<Record<string, readonly MoveSlot[]>>,
): Record<string, readonly MoveSlot[]> {
  const out: Record<string, readonly MoveSlot[]> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[id] = [...new Set([...(a[id] ?? []), ...(b[id] ?? [])])];
  }
  return out;
}

/** A 32-bit hash as the 8 lowercase hex digits the lobby reads (`FINGERPRINT`, net/online/lobby.ts). */
function hex8(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The rules half of what two online peers compare: eight hex digits over the
 * rules version and every fighter's active slots, fighters and slots in sorted
 * order so the order they are written in does not matter. A fighter with no
 * active slot is the same as one not listed.
 *
 * It reads only `rules`, which are fixed when the build loads, never any
 * match's state, so both peers of one build get the same digits every time.
 *
 * What it does not cover, because it hashes names and a hand-kept version and
 * not the data behind them: the contents of the imported scripts, the legacy
 * `MoveDef` tables, fighter and stage parameters, and the constants. A change
 * to any of those reaches it only through `ENGINE_RULES_VERSION`, which is
 * bumped once per plan; `rulesVersion.test.ts` pins that version to the golden
 * trace, and that sees only the behaviour its six matches exercise. Two
 * builds of one commit with different uncommitted edits are told apart by the
 * build id (`next.config.ts`), not by this, and the id cannot always do it:
 * every "dev" build (git could not name a commit) shares one id, and so does
 * every `-dirty-unknown` build of one commit (changes git could not read). Two
 * of either, with different rules inside one plan, pass every part of the
 * stamp. A production build refuses both (`resolveBuildId`), unless `BUILD_ID` is set
 * outright: `BUILD_ID=dev` for the first, and any `BUILD_ID` for the second, are the
 * allowed exceptions (`next.config.ts`), where whoever set it has said so.
 */
export function rulesFingerprint(rules: EngineRules = GAME_ENGINE_RULES): string {
  let h = mixInt(FNV_OFFSET, rules.version);
  for (const id of Object.keys(rules.activeSlots).sort()) {
    const slots = [...rules.activeSlots[id]].sort();
    if (slots.length === 0) continue;
    h = mixString(h, id);
    h = mixInt(h, slots.length);
    for (const slot of slots) h = mixString(h, slot);
  }
  return hex8(h);
}

/**
 * What two online peers compare before a match. A different bone table is a
 * different game — hitboxes land elsewhere — and so is a different rules
 * version or a different set of running scripts: rollback would desync on
 * the first hit, so a start whose fingerprint differs is refused. Eight hex
 * digits over the bone table's fingerprint and `rulesFingerprint`.
 *
 * This is what the online stamp's `bones` carries; the stamp also carries
 * `rulesFingerprint` alone, which is how a refusal can say that the rules
 * differ rather than the bones (`buildMismatch`, game/onlineConfig.ts). What
 * it cannot see is `rulesFingerprint`'s to say.
 */
export function engineFingerprint(ctx: SimContext = GAME_SIM_CONTEXT, rules: EngineRules = GAME_ENGINE_RULES): string {
  const bones = (ctx.bones ?? LEGACY_BONE_TABLE).fingerprint;
  return hex8(mixString(mixString(FNV_OFFSET, bones), rulesFingerprint(rules)));
}
