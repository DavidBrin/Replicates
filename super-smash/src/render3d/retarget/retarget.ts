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
 *   down; `ref` is 180°, less the drive's `turn` (the swordsmen's hand, 90°).
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
 * Both run one body of arithmetic: `retargetInto` writes into a `PoseBuffer` the
 * caller keeps, so the renderer allocates nothing per frame, and `retarget` is
 * that on a fresh buffer (the bake's form).
 */

import { BONE_NAMES, type BoneName, type PoseAngles, type Rig } from "@/render/skeleton";
import {
  mAxis,
  mRotation,
  mTranslation,
  normalize,
  qConjInto,
  qCopyInto,
  qFromTo,
  qMul,
  qMulInto,
  qRotateInto,
  qRotXInto,
  type Quat,
  type QuatOut,
  type Vec3,
  type Vec3Out,
} from "../math/rigid";
import type { Rig3 } from "../skeleton/skeleton";
import { PIVOT_BONE, driveFor } from "./map";

interface DriveEntry {
  readonly index: number;
  readonly our: BoneName;
  /** `our`'s place in `BONE_NAMES`, where `retargetInto` keeps its accumulated angle. */
  readonly ourAt: number;
  readonly base: Quat;
  readonly ref: number;
}

/** Each 2D bone's place in `BONE_NAMES` (parents come before children there). */
const BONE_AT: ReadonlyMap<BoneName, number> = new Map(BONE_NAMES.map((n, k) => [n, k]));
/** The 2D root's place: its accumulated angle turns the whole body. */
const ROOT_AT = BONE_AT.get("root")!;

/**
 * Where `accumulatedAnglesInto` keeps the pose rotation: one place past the
 * bones, so a root bone reads it as its parent's angle, as `resolve()` starts
 * its walk from it.
 */
const ROTATION_AT = BONE_NAMES.length;

/** A 2D rig by place in `BONE_NAMES`: each bone's parent's place (`ROTATION_AT` for a root) and its rest angle. */
interface RigByPlace {
  readonly parent: Int32Array;
  readonly rest: Float64Array;
}

const byPlace = new WeakMap<Rig, RigByPlace>();
function rigByPlace(rig2d: Rig): RigByPlace {
  let r = byPlace.get(rig2d);
  if (r === undefined) {
    r = {
      parent: Int32Array.from(BONE_NAMES, (n) => {
        const p = rig2d[n].parent;
        return p ? BONE_AT.get(p)! : ROTATION_AT;
      }),
      rest: Float64Array.from(BONE_NAMES, (n) => rig2d[n].angle),
    };
    byPlace.set(rig2d, r);
  }
  return r;
}

/** Room for every 2D bone's accumulated angle, and the pose rotation after them. */
const newAccumulated = (): Float64Array => new Float64Array(ROTATION_AT + 1);

export interface Calibration {
  readonly rig: Rig3;
  readonly drives: readonly DriveEntry[];
  /**
   * For each rig bone, the index in `drives` of the drive that poses it, or −1
   * for a bone that rides its parent. Where two drives name one bone the later
   * one poses it.
   */
  readonly driveOf: readonly number[];
  /** World height of the pelvis in bind pose, model units. */
  readonly pivotY: number;
}

const DIR_DOWN: Vec3 = [0, -1, 0];

/**
 * How far a root bone may sit from y = z = 0 and still count as at the feet.
 * The dump rounds to five decimals, so anything this large is a real offset;
 * it is also well under the bake's 1/256-unit grid.
 */
const ROOT_AT_FEET_TOLERANCE = 1e-4;

/**
 * Precompute every driven bone's reference rotation against the fighter's 2D
 * rig (`rig2d` supplies the rest angles a "bind" drive is relative to). Throws
 * naming the fighter and the bone (or the root) that cannot be calibrated.
 */
export function calibrate(rig: Rig3, rig2d: Rig): Calibration {
  // `retarget` shifts a root bone by P - R*P to pivot about the pelvis. That is
  // the turn of a root bone at the feet; a root off the y/z origin would need
  // R*T + (P - R*P). SSBU's root is at the feet, and a skeleton that is not
  // fails here, by name, rather than posing with a pelvis that drifts.
  rig.parent.forEach((p, i) => {
    if (p >= 0) return;
    const [, y, z] = mTranslation(rig.restWorld[i]);
    if (Math.abs(y) > ROOT_AT_FEET_TOLERANCE || Math.abs(z) > ROOT_AT_FEET_TOLERANCE) {
      throw new Error(
        `retarget ${rig.fighter}: root bone ${rig.names[i]} sits at y ${y}, z ${z}, not at the feet; the whole-body pivot assumes y = z = 0`,
      );
    }
  });
  const drives: DriveEntry[] = [];
  const rest2d = accumulatedAngles(rig2d, {}, 0);
  for (const our of BONE_NAMES) {
    const drive = driveFor(rig.fighter, our);
    if (!drive) continue;
    const present = drive.bones.map((b) => rig.byLower.get(b.toLowerCase()));
    if (present.every((i) => i === undefined)) {
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
        const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        if (Math.hypot(d[0], d[1], d[2]) < 1e-9) {
          throw new Error(`retarget ${rig.fighter}: ${name} and its tip ${tipName} sit at the same point, so ${our} has no direction`);
        }
        along = normalize(d);
      } else {
        along = normalize(mAxis(world, 0));
      }
      if (drive.rest === "down") {
        // A `turn` sets the bone that far past the 2D bone (`map.ts`, the swordsmen's grip).
        const ref = drive.turn === undefined ? Math.PI : Math.PI - (drive.turn * Math.PI) / 180;
        drives.push({ index, our, ourAt: BONE_AT.get(our)!, base: qMul(qFromTo(along, DIR_DOWN), mRotation(world)), ref });
        return;
      }
      // "bind": keep the bind direction's side-plane angle, drop its sideways lean.
      const side = Math.hypot(along[1], along[2]);
      if (side < 0.5) {
        throw new Error(`retarget ${rig.fighter}: ${name} points sideways in its bind pose; give ${our} rest "down"`);
      }
      const inPlane: Vec3 = [0, along[1] / side, along[2] / side];
      drives.push({ index, our, ourAt: BONE_AT.get(our)!, base: qMul(qFromTo(along, inPlane), mRotation(world)), ref: rest2d[our] });
    });
  }
  const pivot = rig.byLower.get(PIVOT_BONE.toLowerCase());
  if (pivot === undefined) throw new Error(`retarget ${rig.fighter}: skeleton lacks ${PIVOT_BONE}`);
  const driveOf = rig.names.map(() => -1);
  drives.forEach((d, k) => (driveOf[d.index] = k));
  return { rig, drives, driveOf, pivotY: mTranslation(rig.restWorld[pivot])[1] };
}

/** Accumulated 2D angles, the way `resolve()` walks them. */
export function accumulatedAngles(rig2d: Rig, angles: PoseAngles, rotation: number): Record<BoneName, number> {
  const at = accumulatedAnglesInto(rig2d, angles, rotation, newAccumulated());
  const out = {} as Record<BoneName, number>;
  BONE_NAMES.forEach((name, k) => (out[name] = at[k]));
  return out;
}

/**
 * `accumulatedAngles` by place in `BONE_NAMES`, written into `out`: the same
 * sums, shaped so that posing allocates nothing. Every number lives in a typed
 * array (the rotation too, at `ROTATION_AT`), never in a record keyed by name,
 * and each branch adds and stores its own term: merging a property read with
 * an unboxed number (`angles[name] ?? rest`, `parent ? out[p] : rotation`)
 * makes V8 box one number per bone.
 */
function accumulatedAnglesInto(rig2d: Rig, angles: PoseAngles, rotation: number, out: Float64Array): Float64Array {
  const { parent, rest } = rigByPlace(rig2d);
  out[ROTATION_AT] = rotation;
  for (let k = 0; k < BONE_NAMES.length; k++) {
    const own = angles[BONE_NAMES[k]];
    if (own === undefined) out[k] = out[parent[k]] + rest[k];
    else out[k] = out[parent[k]] + own;
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
 * A `LocalPose` its owner refills (`retargetInto`): the renderer keeps one per
 * fighter and poses it sixty times a second without allocating. `worldQ` and
 * `acc` are the posing's own scratch: each bone's world rotation and the 2D
 * rig's accumulated angles.
 */
export interface PoseBuffer extends LocalPose {
  readonly q: readonly QuatOut[];
  readonly t: readonly Vec3Out[];
  readonly worldQ: readonly QuatOut[];
  /** Accumulated 2D angles by place in `BONE_NAMES` (and the pose rotation after them). */
  readonly acc: Float64Array;
}

/** A buffer for poses of `rig`'s bones. */
export function newPoseBuffer(rig: Pick<Rig3, "names">): PoseBuffer {
  const quats = () => rig.names.map((): QuatOut => [0, 0, 0, 1]);
  return { q: quats(), t: rig.names.map((): Vec3Out => [0, 0, 0]), worldQ: quats(), acc: newAccumulated() };
}

/** Scratch for `retargetInto`'s whole-body turn: a turn about +X, and the pelvis before and after it. */
const turnX: QuatOut = [0, 0, 0, 1];
const conj: QuatOut = [0, 0, 0, 1];
const pivot: Vec3Out = [0, 0, 0];
const spun: Vec3Out = [0, 0, 0];

/**
 * Local rotations and translations for every bone of `cal.rig`.
 *
 * `rig2d` supplies rest angles for bones the sample does not name, exactly as
 * `resolve()` does; `rotation` already includes any `spin`.
 */
export function retarget(cal: Calibration, rig2d: Rig, angles: PoseAngles, rotation: number): LocalPose {
  return retargetInto(cal, rig2d, angles, rotation, newPoseBuffer(cal.rig));
}

/** `retarget`, written into `out`: every entry of `out.q` and `out.t` is rewritten, nothing allocated. */
export function retargetInto(cal: Calibration, rig2d: Rig, angles: PoseAngles, rotation: number, out: PoseBuffer): PoseBuffer {
  const { rig } = cal;
  const n = rig.names.length;
  if (out.q.length !== n) throw new Error(`retarget ${rig.fighter}: a pose buffer for ${out.q.length} bones, not ${n}`);
  const acc = accumulatedAnglesInto(rig2d, angles, rotation, out.acc);
  const { q, t, worldQ } = out;
  // Whole body: the 2D root's angle and the pose rotation turn everything at the
  // root; `rotation` alone pivots about the pelvis (resolve()'s P − R·P shift,
  // right for a root at the feet, which `calibrate` checks).
  const bodyTurn = acc[ROOT_AT];
  for (let i = 0; i < n; i++) {
    const p = rig.parent[i];
    const base = rig.restLocalT[i];
    if (p < 0) {
      qMulInto(q[i], qRotXInto(turnX, bodyTurn), rig.restLocalQ[i]);
      pivot[0] = 0;
      pivot[1] = cal.pivotY;
      pivot[2] = 0;
      qRotateInto(spun, qRotXInto(turnX, rotation), pivot);
      t[i][0] = base[0];
      t[i][1] = base[1] + pivot[1] - spun[1];
      t[i][2] = base[2] + pivot[2] - spun[2];
      qCopyInto(worldQ[i], q[i]);
      continue;
    }
    t[i][0] = base[0];
    t[i][1] = base[1];
    t[i][2] = base[2];
    const d = cal.driveOf[i];
    if (d < 0) {
      qCopyInto(q[i], rig.restLocalQ[i]);
      qMulInto(worldQ[i], worldQ[p], q[i]);
    } else {
      const drive = cal.drives[d];
      qMulInto(worldQ[i], qRotXInto(turnX, acc[drive.ourAt] - drive.ref), drive.base);
      qMulInto(q[i], qConjInto(conj, worldQ[p]), worldQ[i]);
    }
  }
  return out;
}

/** The bind pose as a `LocalPose`. */
export function restPose(rig: Rig3): LocalPose {
  return { q: rig.restLocalQ.slice(), t: rig.restLocalT.slice() };
}
