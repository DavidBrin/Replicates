/**
 * A fake glb for the 3D tests, from a committed skeleton and never a real glb
 * (shared by `fighter3d.test.ts` and the animation lab's `Lab3D.test.tsx`).
 *
 * Test support only: nothing in the app imports it.
 */

import { BufferAttribute, BufferGeometry, Group, Matrix4, Object3D, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Material } from "three";

import type { Rig3 } from "./skeleton/skeleton";
import { bonesFromRig } from "./threeRig";

/**
 * A tiny skinned model shaped like the pipeline's glbs (`scripts/models`), from
 * the committed skeleton, never a real glb: the skeleton hangs under a
 * `model-armature` node turned +90° about X (Blender's Z-up), its root bone
 * turned back by −90°, and a skinned mesh beside it bound the way three's
 * GLTFLoader binds one (identity bind matrix, inverse binds of the bind pose).
 * One vertex per bone, at the bone, weighted wholly to it; one material group
 * per material.
 */
export function armatureModel(rig: Rig3, materials: readonly Material[]): Group {
  const scene = new Group();
  const armature = new Object3D();
  armature.name = "model-armature";
  armature.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  scene.add(armature);
  const bones = bonesFromRig(rig);
  const undo = armature.quaternion.clone().invert();
  bones[0].quaternion.premultiply(undo);
  bones[0].position.applyQuaternion(undo);
  armature.add(bones[0]);
  scene.updateMatrixWorld(true);
  const n = bones.length;
  const positions = new Float32Array(n * 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  bones.forEach((b, i) => {
    const p = b.getWorldPosition(new Vector3());
    positions.set([p.x, p.y, p.z], i * 3);
    skinIndex[i * 4] = i;
    skinWeight[i * 4] = 1;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
  materials.forEach((_, k) => geometry.addGroup(0, n, k));
  const mesh = new SkinnedMesh(geometry, [...materials]);
  mesh.name = "body";
  armature.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones, bones.map((b) => b.matrixWorld.clone().invert())), new Matrix4());
  return scene;
}

