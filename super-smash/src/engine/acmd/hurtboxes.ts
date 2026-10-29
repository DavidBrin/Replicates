/**
 * Per-bone hurtboxes and the bone-derived ECB (Plan 4).
 *
 * Ultimate's hurtboxes are capsules on bones (research R§3, "Hurtboxes"). The
 * replica's are the capsules the bake derived from each fighter's mesh weights
 * (UNVERIFIED: no public source lists them), placed every frame through the
 * same baked bone table the hitboxes use — so a crouch lowers the head
 * hurtbox, a kick extends a leg into the opponent's reach, and what you see is
 * what can be hit.
 *
 * Facing-relative bone points are mirrored by facing exactly as hitboxes are
 * (`hitboxWorldPos`). When the fighter's motion has no bake, the caller keeps
 * Plan 2's single capsule.
 *
 * Sizes are SSBU's (D57): with a bake, a fighter's body is its model's — DK's
 * standing hurtboxes reach 26.3 units up where his box stood 15, Kirby's 9.4
 * where his stood 6.6 — and `attributes.width` / `height` are only the no-bake
 * fallback. `src/game/hurt.allow.json` records, per fighter, the old box beside
 * the bones' numbers.
 */

import { bonePoint, newBonePose, type BoneTable } from "./bones";
import type { Ecb } from "../physics";
import type { Capsule } from "../hitbox";
import type { FighterDef } from "../types";
import type { BakeTables } from "./bakeTables";
import { poseIndexOf, type ClockedFighter } from "./poseClock";

type Placed = ClockedFighter & { readonly x: number; readonly y: number; readonly facing: number };

/** Facing-relative capsules (origin at the feet, +x forward), or null without a bake. */
export function localHurtboxes(def: FighterDef, f: ClockedFighter, globalFrame: number, bake: BakeTables, bones: BoneTable = bake.bones): Capsule[] | null {
  const boxes = bake.hurtboxes(def.id);
  if (boxes === undefined || boxes.length === 0) return null;
  const at = poseIndexOf(def, f, globalFrame, bake.clock);
  if (at === null) return null;
  const out: Capsule[] = [];
  const pose = newBonePose();
  for (const h of boxes) {
    if (!bones.pose(def.id, at.motion, at.frame, h.bone, pose)) return null;
    const a = bonePoint(pose, h.x1, 0, 0);
    const b = bonePoint(pose, h.x2, 0, 0);
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: h.r });
  }
  return out;
}

/** World-space hurtbox capsules for this frame, or null without a bake. */
export function fighterHurtboxes(def: FighterDef, f: Placed, globalFrame: number, bake: BakeTables, bones: BoneTable = bake.bones): Capsule[] | null {
  const local = localHurtboxes(def, f, globalFrame, bake, bones);
  if (local === null) return null;
  const s = f.facing >= 0 ? 1 : -1;
  return local.map((c) => ({ x1: f.x + s * c.x1, y1: f.y + c.y1, x2: f.x + s * c.x2, y2: f.y + c.y2, r: c.r }));
}

/**
 * Bones whose capsules set the ECB's half-width: the pelvis (Kirby's whole
 * round `Body`), not the chest or a flailing limb. The chest was tried first on
 * the real skeletons: DK's barrel chest (r 6.1, hunched 4.7 forward) made his
 * standing ECB 21.6 units wide against a legacy 6.4, enough to grab a ledge
 * from a stage-width away; the pelvis gives 8.6 (UNVERIFIED, D57).
 */
export const ECB_BODY_BONES: ReadonlySet<string> = new Set(["hip", "body"]);

/**
 * The ECB from this frame's hurt capsules: the top is the highest point of any
 * capsule; the half-width is the widest reach of the body capsules either side
 * of the origin; the bottom stays at the feet, as Ultimate locks it on the
 * ground (UNVERIFIED in the air — kept at the feet there too, D57).
 *
 * Never narrower than `minHalf` or shorter than `minTop` (half the fighter's
 * standing ECB, `restEcb`), so a tumbling or crouching body cannot shrink the
 * ECB to a point and slip through a platform edge.
 */
export function ecbFromHurtboxes(
  local: readonly Capsule[],
  bones: readonly string[],
  minHalf: number,
  minTop: number,
): Ecb {
  let top = minTop;
  let half = minHalf;
  local.forEach((c, i) => {
    top = Math.max(top, c.y1 + c.r, c.y2 + c.r);
    if (ECB_BODY_BONES.has(bones[i])) half = Math.max(half, Math.abs(c.x1) + c.r, Math.abs(c.x2) + c.r);
  });
  return { bottom: 0, top, half };
}

const STANDING: Omit<ClockedFighter, "defId"> = {
  action: "stand",
  actionFrame: 0,
  move: null,
  port: 0,
  charge: 0,
  hitstun: 0,
  jumpsUsed: 0,
  fastFalling: false,
  vx: 0,
  vy: 0,
  shortHop: false,
};
const restCache = new WeakMap<BakeTables, WeakMap<BoneTable, Map<string, Ecb | null>>>();

/** The fighter's ECB standing still on frame 0 — the size of its body (D57) — or null without a bake. */
export function restEcb(def: FighterDef, bake: BakeTables, bones: BoneTable = bake.bones): Ecb | null {
  let byBones = restCache.get(bake);
  if (byBones === undefined) restCache.set(bake, (byBones = new WeakMap()));
  let byFighter = byBones.get(bones);
  if (byFighter === undefined) byBones.set(bones, (byFighter = new Map()));
  if (!byFighter.has(def.id)) {
    const local = localHurtboxes(def, { ...STANDING, defId: def.id }, 0, bake, bones);
    const names = (bake.hurtboxes(def.id) ?? []).map((h) => h.bone.toLowerCase());
    byFighter.set(def.id, local === null ? null : ecbFromHurtboxes(local, names, 0, 0));
  }
  return byFighter.get(def.id)!;
}

/** The ECB for a fighter this frame, or null without a bake. */
export function bakedEcb(def: FighterDef, f: ClockedFighter, globalFrame: number, bake: BakeTables, bones: BoneTable = bake.bones): Ecb | null {
  const rest = restEcb(def, bake, bones);
  if (rest === null) return null;
  const local = localHurtboxes(def, f, globalFrame, bake, bones);
  if (local === null) return null;
  const names = (bake.hurtboxes(def.id) ?? []).map((h) => h.bone.toLowerCase());
  return ecbFromHurtboxes(local, names, rest.half >> 1, rest.top >> 1);
}
