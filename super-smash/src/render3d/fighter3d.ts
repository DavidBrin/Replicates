/**
 * One fighter in the 3D scene: their SSBU model (or a stand-in), posed every
 * frame by `drawnPose`, turned to face the way they face, and flashed, blinked
 * or hidden the way the 2D figure was.
 *
 * Facing is a real turn (±90° about +Y), not a mirror: SSBU turns its fighters
 * round, so a left-facing Link holds his sword in the same hand. Every bone's
 * side-plane position is the same either way, so a hitbox the sim mirrors by
 * facing sits on the limb you see (`fighter3d.test.ts`, Review Focus #4).
 *
 * A fighter with no model (`LoadedModel` "standIn": no index, a 404, a bad
 * download, a timeout) is drawn as its own hurtbox capsules on the same bones,
 * in its port's colour, and plays on.
 *
 * Per frame, nothing here makes an array, matrix, quaternion or pose: the pose
 * is retargeted into a buffer made here once (`poseInputs`, `retargetInto`) and
 * written into the bones' and groups' own transforms and the materials' own
 * fields. An update still allocates, measured (Task 17 fix round):
 * - the clip sample it starts from, the 2D clip sampler's fresh `PoseSample`
 *   each frame, which the clip fade (D42) keeps hold of: about 3 KB;
 * - the engine clock's `PoseIndex` (and a move's script run): about 0.7 KB;
 * - about 200–250 B of numbers V8 boxes as `retargetInto` reads that sample's
 *   name-keyed angles.
 * The fade and the flash box numbers only until V8 has optimised them.
 */

import { CapsuleGeometry, Group, Mesh, type Material, type Object3D, type SkinnedMesh, type Vector3 } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, FighterState } from "@/engine/types";
import type { PoseBlend } from "@/render/blend";
import { hitlagShake } from "@/render/characterArt";
import { intangibleAlpha } from "@/render/renderer";
import { PORT_COLOURS } from "@/render/rigKit";
import type { FighterPoser } from "./bake/bake";
import { drawnPose, poseInputs, type FighterPoseInputs } from "./fighterPose";
import type { LoadedModel } from "./models/loader";
import { applyLocalPose, applyRoot, bindBones, bonesFromRig, hangBonesAsRig } from "./threeRig";
import { setFade, setHitFlash, toonFor, toonMaterial, type ToonMaterial } from "./toon";

export interface FighterFrame {
  readonly f: FighterState;
  /** Interpolated world position (`interpolatePosition`). */
  readonly x: number;
  readonly y: number;
  /** Sim frame, for the idle clock and the clip fade. */
  readonly frame: number;
  readonly blends: PoseBlend[] | null;
  readonly hitFlash: number;
  /** A move effect replaces the fighter this frame (Kirby's Stone). */
  readonly hidden: boolean;
}

export interface Fighter3D {
  /** Positioned and turned in world space; add it to the scene. */
  readonly placement: Group;
  readonly kind: LoadedModel["kind"];
  update(frame: FighterFrame): void;
  /** World position of a bone this frame (call after `update`); false if the rig lacks it. */
  bonePosition(name: string, out: Vector3): boolean;
  dispose(): void;
}

interface Built {
  readonly root: Object3D;
  readonly materials: ToonMaterial[];
}

function standInModel(poser: FighterPoser, port: number): Built {
  const bones = bonesFromRig(poser.rig3);
  const material = toonMaterial(null);
  material.color.set(PORT_COLOURS[port % PORT_COLOURS.length]);
  for (const h of poser.rig3.hurt) {
    const i = poser.rig3.byLower.get(h.bone.toLowerCase());
    if (i === undefined) continue;
    const length = Math.max(0.01, h.x2 - h.x1);
    const mesh = new Mesh(new CapsuleGeometry(h.r, length, 4, 8), material);
    // CapsuleGeometry runs along +Y; the hurt capsule runs along the bone's +X.
    mesh.rotation.z = -Math.PI / 2;
    mesh.position.x = (h.x1 + h.x2) / 2;
    mesh.frustumCulled = false;
    bones[i].add(mesh);
  }
  return { root: bones[0], materials: [material] };
}

function glbModel(scene: Object3D): Built {
  const root = cloneSkinned(scene);
  const materials: ToonMaterial[] = [];
  const swapped = new Map<Material, ToonMaterial>();
  const swap = (m: Material): ToonMaterial => {
    let t = swapped.get(m);
    if (t === undefined) {
      // This fighter's own copy, in the glb's own alpha mode: its blink fades nobody else.
      t = toonFor(m);
      swapped.set(m, t);
      materials.push(t);
    }
    return t;
  };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    // Skinned bounds are the bind pose's; a kick would cull its own foot.
    mesh.frustumCulled = false;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  // The originals (geometry, materials, textures) are the shared cache's; only our replacements are ours to free.
  return { root, materials };
}

export interface Fighter3DOptions {
  readonly def: FighterDef;
  readonly port: number;
  readonly poser: FighterPoser;
  readonly bake: BakeTables;
  readonly model: LoadedModel;
}

export function createFighter3D(opts: Fighter3DOptions): Fighter3D {
  const { poser } = opts;
  const inputs: FighterPoseInputs = poseInputs(poser, opts.def, opts.bake);
  const built = opts.model.kind === "glb" ? glbModel(opts.model.scene) : standInModel(poser, opts.port);
  const rootGroup = new Group();
  rootGroup.add(built.root);
  const placement = new Group();
  placement.name = `fighter:${opts.port}:${opts.def.id}`;
  placement.add(rootGroup);
  const bones = bindBones(poser.rig3, built.root);
  if (opts.model.kind === "glb") hangBonesAsRig(poser.rig3, bones, built.root);
  const materials = built.materials;
  let opacity = 1;
  let flash = 0;

  return {
    placement,
    kind: opts.model.kind,
    update(fr) {
      const f = fr.f;
      placement.visible = f.action !== "dead" && !fr.hidden;
      if (!placement.visible) return;
      placement.position.set(fr.x + hitlagShake(f), fr.y, 0);
      placement.rotation.set(0, f.facing >= 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      const pose = drawnPose(inputs, f, fr.frame, fr.blends);
      applyLocalPose(bones, pose.local);
      applyRoot(rootGroup, pose.root);
      const alpha = intangibleAlpha(f);
      if (alpha !== opacity || fr.hitFlash !== flash) {
        for (let k = 0; k < materials.length; k++) {
          setFade(materials[k], alpha);
          setHitFlash(materials[k], fr.hitFlash);
        }
        opacity = alpha;
        flash = fr.hitFlash;
      }
      placement.updateMatrixWorld(true);
    },
    bonePosition(name, out) {
      // Scripts and the sim spell bones in lower case already; only another spelling pays for `toLowerCase`.
      const i = poser.rig3.byLower.get(name) ?? poser.rig3.byLower.get(name.toLowerCase());
      const b = i === undefined ? null : bones[i];
      if (b === null) return false;
      b.getWorldPosition(out);
      return true;
    },
    dispose() {
      placement.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        // A stand-in's capsules are ours; a glb's geometry is the cache's, but its clone's skeleton (and bone texture) is ours.
        if (opts.model.kind === "standIn") mesh.geometry.dispose();
        else if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).skeleton.dispose();
      });
      for (const m of materials) m.dispose();
      placement.clear();
    },
  };
}

/** Where a fighter's facing-relative point is in the world — the sim's own mirror rule. */
export function simWorldX(f: Pick<FighterState, "x" | "facing">, localX: number): number {
  return toFloat(f.x) + (f.facing >= 0 ? localX : -localX);
}
