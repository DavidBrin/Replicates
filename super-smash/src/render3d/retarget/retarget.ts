/**
 * Retargeting: a 2D pose sample → local rotations for an SSBU skeleton.
 *
 * ## The rule
 *
 * A 2D bone at accumulated angle `a` (rig space: 0 = up, clockwise positive
 * toward the fighter's front, `skeleton.ts`) points along (forward, up) =
 * (sin a, cos a). In SSBU model space forward is +Z and up is +Y, so the target
 * is the model-space direction (0, cos a, sin a), and the turn that reaches it
 * from straight up is a rotation of `a` about +X — the side view's screen normal.
 *
 * Each driven SSBU bone is calibrated once per fighter (`map.ts` `rest`):
 * - "bind": `base` is its bind rotation, with any sideways lean swung out so its
 *   along-axis lies in the side plane at angle β; `ref` is the 2D bone's own
 *   rest angle. At the 2D rest pose the bone sits at β, SSBU's stance.
 * - "down": `base` is its bind rotation swung so its along-axis points straight
 *   down; `ref` is 180°.
 * Its world rotation for a pose is then
 *
 *   world = Rx(a − ref) · base
 *
 * and its local rotation is that world rotation seen from its (already posed)
 * parent. Undriven bones keep their bind-local rotation. Translations are always
 * bind-local: SSBU's limbs keep SSBU's lengths, which is the point — hitboxes
 * hang off the real limbs.
 *
 * ## Whole-body channels
 *
 * `rotation` (key rotation plus `spin`) and the 2D root bone's angle turn the
 * whole body about +X at the root bone; `rotation` pivots about the pelvis
 * exactly as `resolve()` does. Offsets and squash are the caller's
 * (`rootXform`), because squash is not a rigid transform and offsets are not
 * scaled by it in the 2D renderer either.
 *
 * Pure: `Math` only, no three.js, so `bake/bake.ts` runs it at build time and
 * the renderer runs it per frame, and `fighter3d.test.ts` proves they agree.
 */

import { BONE_NAMES, type BoneName, type PoseAngles, type Rig } from "@/render/skeleton";
import {
  mAxis,
  mRotation,
  mTranslation,
  normalize,
  qConj,
  qFromTo,
  qMul,
  qRotate,
  qRotX,
  type Quat,
  type Vec3,
} from "../math/rigid";
import type { Rig3 } from "../skeleton/skeleton";
import { PIVOT_BONE, RETARGET, RETARGET_OVERRIDES, type Drive } from "./map";

interface DriveEntry {
  readonly index: number;
  readonly our: BoneName;
  readonly base: Quat;
  readonly ref: number;
}

export interface Calibration {
  readonly rig: Rig3;
  readonly drives: readonly DriveEntry[];
  /** World height of the pelvis in bind pose, model units. */
  readonly pivotY: number;
}

const DIR_DOWN: Vec3 = [0, -1, 0];

function driveFor(fighter: string, our: BoneName): Drive | undefined {
  return RETARGET_OVERRIDES[fighter]?.[our] ?? RETARGET[our];
}

/**
 * Precompute every driven bone's reference rotation against the fighter's 2D
 * rig (`rig2d` supplies the rest angles a "bind" drive is relative to). Throws
 * naming the missing bone.
 */
export function calibrate(rig: Rig3, rig2d: Rig): Calibration {
  const drives: DriveEntry[] = [];
  const rest2d = accumulatedAngles(rig2d, {}, 0);
  for (const our of BONE_NAMES) {
    const drive = driveFor(rig.fighter, our);
    if (!drive) continue;
    const present = drive.bones.map((b) => rig.byLower.get(b.toLowerCase()));
    if (present.every((i) => i === undefined)) {
      if (drive.optional) continue;
      throw new Error(`retarget ${rig.fighter}: skeleton lacks ${our}'s bone (tried ${drive.bones.join(", ")})`);
    }
    drive.bones.forEach((name, k) => {
      const index = present[k];
      if (index === undefined) return;
      const world = rig.restWorld[index];
      const tipName = drive.tips?.[k] ?? null;
      let along: Vec3;
      if (tipName !== null) {
        const tip = rig.byLower.get(tipName.toLowerCase());
        if (tip === undefined) throw new Error(`retarget ${rig.fighter}: skeleton lacks ${name}'s tip ${tipName}`);
        const a = mTranslation(world);
        const b = mTranslation(rig.restWorld[tip]);
        along = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      } else {
        along = normalize(mAxis(world, 0));
      }
      if (drive.rest === "down") {
        drives.push({ index, our, base: qMul(qFromTo(along, DIR_DOWN), mRotation(world)), ref: Math.PI });
        return;
      }
      // "bind": keep the bind direction's side-plane angle, drop its sideways lean.
      const side = Math.hypot(along[1], along[2]);
      if (side < 0.5) {
        throw new Error(`retarget ${rig.fighter}: ${name} points sideways in its bind pose; give ${our} rest "down"`);
      }
      const inPlane: Vec3 = [0, along[1] / side, along[2] / side];
      drives.push({ index, our, base: qMul(qFromTo(along, inPlane), mRotation(world)), ref: rest2d[our] });
    });
  }
  const pivot = rig.byLower.get(PIVOT_BONE.toLowerCase());
  if (pivot === undefined) throw new Error(`retarget ${rig.fighter}: skeleton lacks ${PIVOT_BONE}`);
  return { rig, drives, pivotY: mTranslation(rig.restWorld[pivot])[1] };
}

/** Accumulated 2D angles, the way `resolve()` walks them. */
export function accumulatedAngles(rig2d: Rig, angles: PoseAngles, rotation: number): Record<BoneName, number> {
  const out = {} as Record<BoneName, number>;
  for (const name of BONE_NAMES) {
    const bone = rig2d[name];
    out[name] = (bone.parent ? out[bone.parent] : rotation) + (angles[name] ?? bone.angle);
  }
  return out;
}

export interface LocalPose {
  /** Local rotation per `Rig3` bone, parent-relative. */
  readonly q: readonly Quat[];
  /** Local translation per bone, parent-relative (bind, except the root's pivot shift). */
  readonly t: readonly Vec3[];
}

/**
 * Local rotations and translations for every bone of `cal.rig`.
 *
 * `rig2d` supplies rest angles for bones the sample does not name, exactly as
 * `resolve()` does; `rotation` already includes any `spin`.
 */
export function retarget(cal: Calibration, rig2d: Rig, angles: PoseAngles, rotation: number): LocalPose {
  const { rig } = cal;
  const n = rig.names.length;
  const acc = accumulatedAngles(rig2d, angles, rotation);
  const wanted = new Map<number, Quat>();
  for (const d of cal.drives) wanted.set(d.index, qMul(qRotX(acc[d.our] - d.ref), d.base));

  const worldQ: Quat[] = new Array(n);
  const q: Quat[] = new Array(n);
  const t: Vec3[] = rig.restLocalT.slice();
  // Whole body: the 2D root's angle and the pose rotation turn everything at the
  // root; `rotation` alone pivots about the pelvis (resolve()'s P − R·P shift).
  const bodyTurn = acc.root;
  for (let i = 0; i < n; i++) {
    const p = rig.parent[i];
    if (p < 0) {
      const turn = qRotX(bodyTurn);
      const local = qMul(turn, rig.restLocalQ[i]);
      const pivot: Vec3 = [0, cal.pivotY, 0];
      const spun = qRotate(qRotX(rotation), pivot);
      const base = rig.restLocalT[i];
      t[i] = [base[0], base[1] + pivot[1] - spun[1], base[2] + pivot[2] - spun[2]];
      q[i] = local;
      worldQ[i] = local;
      continue;
    }
    const w = wanted.get(i);
    if (w === undefined) {
      q[i] = rig.restLocalQ[i];
      worldQ[i] = qMul(worldQ[p], q[i]);
    } else {
      q[i] = qMul(qConj(worldQ[p]), w);
      worldQ[i] = w;
    }
  }
  return { q, t };
}

/** The bind pose as a `LocalPose`. */
export function restPose(rig: Rig3): LocalPose {
  return { q: rig.restLocalQ.slice(), t: rig.restLocalT.slice() };
}
