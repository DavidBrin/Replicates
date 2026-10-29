/**
 * The three.js side of a posed skeleton: find a model's bones by SSBU name,
 * write a `LocalPose` into them, and put the root transform on the group above.
 *
 * Nothing here allocates per frame: a pose is written into the bones' own
 * `position` and `quaternion`, the root into the group's own `matrix`.
 */

import { Bone, Object3D } from "three";

import type { RootXform } from "./bake/fk";
import type { LocalPose } from "./retarget/retarget";
import type { Rig3 } from "./skeleton/skeleton";

/** The model's bone for each `Rig3` bone (by case-insensitive name), or null if absent. */
export function bindBones(rig: Rig3, model: Object3D): (Object3D | null)[] {
  const byLower = new Map<string, Object3D>();
  model.traverse((o) => {
    if ((o as Bone).isBone) byLower.set(o.name.toLowerCase(), o);
  });
  return rig.names.map((n) => byLower.get(n.toLowerCase()) ?? null);
}

/**
 * Hang each bound bone from the bone its `Rig3` parent is bound to, and a root
 * bone from the model itself, keeping where it is.
 *
 * A pose is parent-relative (`retarget`), and a `Rig3` root's local is in SSBU
 * model space. A glb from `pnpm models` has a node between the two: Blender's
 * exporter puts the skeleton under `model-armature`, turned +90° about X for
 * glTF's Y-up, and turns the root bone `Trans` back by −90°. Writing the root's
 * pose under that node would lay the fighter on its back. The bones are the
 * fighter's own clone (`SkeletonUtils.clone`), never the cached source, and a
 * skinned mesh follows its bones' world matrices wherever they hang.
 */
export function hangBonesAsRig(rig: Rig3, bones: readonly (Object3D | null)[], model: Object3D): void {
  model.updateMatrixWorld(true);
  bones.forEach((b, i) => {
    if (b === null) return;
    const p = rig.parent[i];
    const parent = p < 0 ? model : bones[p];
    if (parent !== null && b.parent !== parent) parent.attach(b);
  });
}

/** A bare bone hierarchy for a `Rig3` — the stand-in's skeleton, and the test harness's. */
export function bonesFromRig(rig: Rig3): Bone[] {
  const bones = rig.names.map((name, i) => {
    const b = new Bone();
    b.name = name;
    b.position.set(...rig.restLocalT[i]);
    b.quaternion.set(...rig.restLocalQ[i]);
    return b;
  });
  rig.parent.forEach((p, i) => {
    if (p >= 0) bones[p].add(bones[i]);
  });
  return bones;
}

export function applyLocalPose(bones: readonly (Object3D | null)[], pose: LocalPose): void {
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    if (b === null) continue;
    const t = pose.t[i];
    const q = pose.q[i];
    b.position.set(t[0], t[1], t[2]);
    b.quaternion.set(q[0], q[1], q[2], q[3]);
  }
}

/**
 * The clip's offsets and squash, and the fighter's size, on the group that
 * holds the model: exactly `rootMatrix(root)` (`bake/fk.ts`, what the bake
 * applied), written in place. It has no rotation, so it is a scale and a
 * translation.
 */
export function applyRoot(group: Object3D, root: RootXform): void {
  group.matrixAutoUpdate = false;
  group.matrix.makeScale(root.scale, root.scale * root.squashUp, root.scale * root.squashForward).setPosition(0, root.up, root.forward);
  group.matrixWorldNeedsUpdate = true;
}
