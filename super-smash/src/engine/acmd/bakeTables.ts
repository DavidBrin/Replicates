/**
 * The decoded bake, as the sim reads it: the layered bone table (baked limbs
 * over Plan 2's root bone), the motion clocks, and the per-bone hurtboxes —
 * plus the fingerprint two online peers compare before a match.
 *
 * Built once at start-up (`game/bake.ts`) and handed to the sim through its
 * context; nothing here is mutable, so `cloneState`/`hashState` never see it.
 */

import { bakedBoneTable, layeredBoneTable, LEGACY_BONE_TABLE, type BoneTable } from "./bones";
import type { BakedFighter, BoneHurtbox } from "./bakeCodec";
import type { MotionClock } from "./poseClock";
import type { MotionKind } from "./types";

export interface BakeTables {
  /** Baked limbs over Plan 2's root bone; its `fingerprint` is the bake's (8 hex). */
  readonly bones: BoneTable;
  clock(fighterId: string, motion: MotionKind): MotionClock | undefined;
  hurtboxes(fighterId: string): readonly BoneHurtbox[] | undefined;
  /** SHA-256 (hex) of the uncompressed roster file; "legacy" with no bake. */
  readonly fingerprint: string;
}

/**
 * Refuse a clock table that does not match the bones it times: a motion with
 * no clock, a clock with no motion, or a clock of another length. The bones are
 * checked by `bakedBoneTable` (`assertWellFormed`: at least one frame, data the
 * right length), so together every clock the pose clock reads has a whole
 * number of frames, at least 1, that indexes its motion: a 0-frame clock would
 * index frame 0 (once, scaled) or NaN (`n % 0`: loop, idle, paced).
 */
function assertClocksMatch(f: BakedFighter): void {
  const id = f.bones.fighter;
  for (const [name, m] of Object.entries(f.bones.motions)) {
    const c = Object.hasOwn(f.clocks, name) ? f.clocks[name] : undefined;
    if (c === undefined) throw new Error(`bone bake for "${id}/${name}": no clock`);
    if (c.frames !== m.frames) throw new Error(`bone bake for "${id}/${name}": a ${c.frames}-frame clock for a ${m.frames}-frame motion`);
  }
  for (const name of Object.keys(f.clocks)) {
    if (!Object.hasOwn(f.bones.motions, name)) throw new Error(`bone bake for "${id}/${name}": a clock for a motion the bake does not have`);
  }
}

/**
 * The tables over a decoded bake. Throws on a malformed one, here, where it is
 * built (DISPATCH-NOTES 10.4): the bones through `bakedBoneTable`, the clocks
 * through `assertClocksMatch`.
 */
export function bakeTables(fighters: readonly BakedFighter[], fingerprint: string): BakeTables {
  const layered = layeredBoneTable(bakedBoneTable(fighters.map((f) => f.bones)), LEGACY_BONE_TABLE);
  for (const f of fighters) assertClocksMatch(f);
  const clocks = new Map(fighters.map((f) => [f.bones.fighter, new Map(Object.entries(f.clocks))]));
  const hurt = new Map(fighters.map((f) => [f.bones.fighter, f.hurt]));
  return {
    // The online handshake compares this (Plan 2 `engineFingerprint`): two
    // peers on different bakes would put hitboxes in different places.
    bones: { fingerprint: fingerprint.slice(0, 8), pose: (id, motion, frame, bone, out) => layered.pose(id, motion, frame, bone, out) },
    clock: (id, motion) => clocks.get(id)?.get(motion),
    hurtboxes: (id) => hurt.get(id),
    fingerprint,
  };
}

/** No bake: the root bone only, one capsule per fighter (Plan 2 behaviour). */
export const LEGACY_BAKE: BakeTables = {
  bones: LEGACY_BONE_TABLE,
  clock: () => undefined,
  hurtboxes: () => undefined,
  fingerprint: "legacy",
};
