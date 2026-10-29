/**
 * Where the 2D overlay hangs a fighter's port tag, move effects, dizzy stars
 * and Final Smash aura over the 3D world (Plan 4): the top of the head hurt
 * capsule, placed through the same baked head bone `Fighter3D` draws
 * (`fighterPose.test.ts` proves the two agree). Pure: no three.js, so the
 * match runner computes it before the overlay paints, and the play page's
 * initial chunk stays free of three (`app/chunkSplit.test.ts`).
 *
 * It is `localHurtboxes`' head capsule, worked out on its own: the overlay asks
 * for it every paint, for every fighter, and needs none of the others.
 */

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { bonePoint, newBonePose } from "@/engine/acmd/bones";
import { poseIndexOf, type ClockedFighter } from "@/engine/acmd/poseClock";
import { toFloat } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import type { OverlayAnchor } from "@/render/renderer";
import { hurtBonesFor } from "./skeletons/hurtBones";

/** Refilled by every call. */
const pose = newBonePose();

/** The head's anchor this frame, or null without a bake (the overlay then uses the 2D rig). */
export function overlayAnchor(
  def: FighterDef,
  f: ClockedFighter & { readonly facing: number },
  globalFrame: number,
  bake: BakeTables | undefined,
): OverlayAnchor | null {
  if (bake === undefined) return null;
  const want = hurtBonesFor(def.id).head.toLowerCase();
  const head = bake.hurtboxes(def.id)?.find((h) => h.bone === want);
  if (head === undefined) return null;
  const at = poseIndexOf(def, f, globalFrame, bake.clock);
  if (at === null || !bake.bones.pose(def.id, at.motion, at.frame, head.bone, pose)) return null;
  const a = bonePoint(pose, head.x1, 0, 0);
  const b = bonePoint(pose, head.x2, 0, 0);
  return { headX: (f.facing >= 0 ? 1 : -1) * toFloat((a.x + b.x) / 2), headTop: toFloat(Math.max(a.y, b.y) + head.r) };
}
