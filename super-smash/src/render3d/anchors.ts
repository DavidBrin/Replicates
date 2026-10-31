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
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
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

/**
 * How far the port tag's top stands over the head capsule, in world units, as
 * the overlay draws it at a close-up's zoom (`renderer.ts` `drawOneFighter`): a
 * unit over the capsule, 14 px, then the tag's 24 px at `zoom / 7` (5.0 to 5.25
 * at zooms 24 to 17).
 */
export const PORT_TAG_UNITS = 5.5;

/**
 * How tall a fighter is drawn this frame, above its feet, in world units: its
 * highest hurt capsule, an arm or a sword raised included, or its port tag over
 * the head, whichever is higher (Plan 5, Task 17 fix round 2: the camera keeps
 * it whole, `camera.ts` `DrawnTops`, and a Final Smash's scene keeps its user off
 * a launched fighter while the two are level, `RenderState.tops`). Null without a
 * bake.
 */
export function drawnTop(def: FighterDef, f: ClockedFighter & { readonly facing: number }, globalFrame: number, bake: BakeTables | undefined): number | null {
  if (bake === undefined) return null;
  const caps = localHurtboxes(def, f, globalFrame, bake);
  if (caps === null) return null;
  let top = -Infinity;
  for (const c of caps) top = Math.max(top, toFloat(Math.max(c.y1, c.y2) + c.r));
  const head = overlayAnchor(def, f, globalFrame, bake);
  return head === null ? top : Math.max(top, head.headTop + PORT_TAG_UNITS);
}
