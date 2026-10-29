import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Bone,
  type Material,
} from "three";

import { bonePoint, newBonePose } from "@/engine/acmd/bones";
import { poseIndexOf } from "@/engine/acmd/poseClock";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { PORT_COLOURS } from "@/render/rigKit";
import { makeFighter } from "@/render/testFixtures";
import { fighterPoser } from "./bake/bake";
import { createFighter3D, simWorldX, type Fighter3D } from "./fighter3d";
import { parseSkeletonFile, type Rig3 } from "./skeleton/skeleton";
import { bonesFromRig } from "./threeRig";
import type { ToonMaterial } from "./toon";

const bake = readBakeFromDisk();
/** The game's Mario: limb-bone scripts on, placed through the bake (ruling R1), as the bake and the play page have him. */
const mario = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!, bake.bones);
const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "mario.json"), "utf8")));
const poser = fighterPoser(mario, skeleton);
const frameOf = (f: ReturnType<typeof makeFighter>) => ({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });

/**
 * A tiny skinned model shaped like the pipeline's glbs (`scripts/models`), from
 * the committed skeleton, never a real glb: the skeleton hangs under a
 * `model-armature` node turned +90° about X (Blender's Z-up), its root bone
 * turned back by −90°, and a skinned mesh beside it bound the way three's
 * GLTFLoader binds one (identity bind matrix, inverse binds of the bind pose).
 * One vertex per bone, at the bone, weighted wholly to it; one material group
 * per material.
 */
function armatureModel(rig: Rig3, materials: readonly Material[]): Group {
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

/** A glb material as three's GLTFLoader makes one for each alpha mode (`toon.test.ts` pins that through the loader). */
const gltfMaterials = (): MeshStandardMaterial[] => [
  new MeshStandardMaterial({ name: "skin" }),
  new MeshStandardMaterial({ name: "eye", alphaTest: 0.5 }),
  new MeshStandardMaterial({ name: "scouter", transparent: true, depthWrite: false, opacity: 0.851 }),
];

/** A fighter's own materials, by name. */
function materialsOf(fighter: Fighter3D): Map<string, ToonMaterial> {
  const out = new Map<string, ToonMaterial>();
  fighter.placement.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of [mesh.material].flat()) out.set(m.name, m as ToonMaterial);
  });
  return out;
}

function skinnedOf(fighter: Fighter3D): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  fighter.placement.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) found = o as SkinnedMesh;
  });
  return found!;
}

describe("a fighter in the 3D scene", () => {
  it("puts a limb where the sim puts its hitbox, facing either way, legacy and adopted moves (Review Focus #4)", () => {
    // fsmash keeps its legacy script; uair runs its imported limb-bone script (limb.json).
    for (const [facing, move] of [[1, "fsmash"], [-1, "fsmash"], [1, "uair"], [-1, "uair"]] as const) {
      const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
      const f = makeFighter({ x: fx(20), y: fx(25), facing, grounded: move === "fsmash", action: "attack", move, actionFrame: move === "fsmash" ? 14 : 8 });
      fighter.update(frameOf(f));
      const at = poseIndexOf(mario, f, 100, bake.clock)!;
      for (const bone of ["arml", "kneer", "head"]) {
        const pose = newBonePose();
        expect(bake.bones.pose("mario", at.motion, at.frame, bone, pose)).toBe(true);
        const local = bonePoint(pose, 0, 0, 0);
        const p = new Vector3();
        expect(fighter.bonePosition(bone, p)).toBe(true);
        // Within the bake's quantum (1/256) plus float noise.
        expect(Math.abs(p.x - simWorldX(f, toFloat(local.x)))).toBeLessThan(0.01);
        expect(Math.abs(p.y - (toFloat(f.y) + toFloat(local.y)))).toBeLessThan(0.01);
      }
      fighter.dispose();
    }
  });

  it("hides a dead fighter, and one a move effect replaces", () => {
    const fighter = createFighter3D({ def: mario, port: 1, poser, bake, model: { kind: "standIn", reason: "test" } });
    fighter.update(frameOf(makeFighter({ action: "dead" })));
    expect(fighter.placement.visible).toBe(false);
    fighter.update({ ...frameOf(makeFighter()), hidden: true });
    expect(fighter.placement.visible).toBe(false);
    fighter.update(frameOf(makeFighter()));
    expect(fighter.placement.visible).toBe(true);
  });

  it("gives two players on the same model their own bones", () => {
    const scene = new Group();
    const bones = bonesFromRig(poser.rig3);
    scene.add(bones[0]);
    scene.add(new Mesh(undefined, new MeshBasicMaterial()));
    const a = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene } });
    const b = createFighter3D({ def: mario, port: 1, poser, bake, model: { kind: "glb", scene } });
    a.update(frameOf(makeFighter({ action: "attack", move: "fsmash", actionFrame: 14 })));
    b.update(frameOf(makeFighter({ action: "crouch", actionFrame: 9 })));
    const pa = new Vector3();
    const pb = new Vector3();
    a.bonePosition("arml", pa);
    b.bonePosition("arml", pb);
    expect(pa.distanceTo(pb)).toBeGreaterThan(0.5);
    // The shared source scene was never posed.
    expect(bones[0].position.toArray()).toEqual(poser.rig3.restLocalT[0]);
  });

  it("frees what it made, and only that", () => {
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const disposed = vi.fn();
    fighter.placement.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).geometry.addEventListener("dispose", disposed);
    });
    fighter.dispose();
    expect(disposed).toHaveBeenCalledTimes(skeleton.hurt.length);
    expect(fighter.placement.children).toHaveLength(0);
  });
});

describe("facing", () => {
  const link = withLimbScripts(FIGHTERS.find((f) => f.id === "link")!, bake.bones);
  const linkPoser = fighterPoser(link, parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "link.json"), "utf8"))));
  /** World z of each named bone, and every bone's world determinant, at one facing. */
  function at(fighter: Fighter3D, facing: 1 | -1, names: readonly string[]) {
    fighter.update(frameOf(makeFighter({ x: fx(4), y: fx(2), facing, action: "attack", move: "fsmash", actionFrame: 14 })));
    const z = names.map((n) => {
      const p = new Vector3();
      expect(fighter.bonePosition(n, p), n).toBe(true);
      return p.z;
    });
    const determinants: number[] = [];
    fighter.placement.traverse((o) => {
      if ((o as Bone).isBone) determinants.push(o.matrixWorld.determinant());
    });
    return { z, determinants };
  }

  it("turns the fighter round, never mirrors it: the hands trade depth, the blade stays in its hand, no bone is a reflection", () => {
    // SSBU turns its fighters, so a left-facing Link holds his sword in the same hand (brief, Task 17).
    // A mirror (a fixed turn and scale.z = facing) draws the same silhouette with every hitbox in place,
    // but leaves each hand where it was in depth and flips every bone's handedness.
    for (const [label, fighter, names] of [
      ["Mario, stand-in", createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } }), ["handl", "handr"]],
      ["Mario, glb", createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, gltfMaterials()) } }), ["handl", "handr"]],
      ["Link, stand-in", createFighter3D({ def: link, port: 0, poser: linkPoser, bake, model: { kind: "standIn", reason: "test" } }), ["handl", "handr", "sword1", "sword2"]],
    ] as const) {
      const right = at(fighter, 1, names);
      const left = at(fighter, -1, names);
      // The fighter's left side (+X in model space) is away from the camera facing right, and toward it facing left.
      expect(right.z[0], `${label}: left hand facing right`).toBeLessThan(right.z[1]);
      names.forEach((n, k) => {
        expect(Math.abs(right.z[k]), `${label}: ${n} off the play plane`).toBeGreaterThan(0.1);
        expect(left.z[k], `${label}: ${n} trades depth`).toBeCloseTo(-right.z[k], 9);
      });
      for (const d of [...right.determinants, ...left.determinants]) expect(d, `${label}: a bone's world handedness`).toBeGreaterThan(0);
      fighter.dispose();
    }
  });
});

describe("the clock", () => {
  it("draws the frame it is handed: an idle fighter on frame k is the bake's pose for k, not k + 1", () => {
    // Idle is the one status whose clock runs on the global frame (`poseIndexOf` "idle").
    const f = makeFighter({ action: "stand", actionFrame: 0 });
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const baked = (frame: number) => {
      const index = poseIndexOf(mario, f, frame, bake.clock)!;
      expect(bake.clock("mario", index.motion)!.kind).toBe("idle");
      const pose = newBonePose();
      expect(bake.bones.pose("mario", index.motion, index.frame, "head", pose)).toBe(true);
      const local = bonePoint(pose, 0, 0, 0);
      return { x: simWorldX(f, toFloat(local.x)), y: toFloat(f.y) + toFloat(local.y) };
    };
    // Frames where the head moves between k and k + 1 by more than the test can confuse.
    const moving = Array.from({ length: 120 }, (_, k) => k).filter((k) => Math.hypot(baked(k + 1).x - baked(k).x, baked(k + 1).y - baked(k).y) > 0.03);
    expect(moving.length).toBeGreaterThan(5);
    const p = new Vector3();
    for (const k of moving) {
      fighter.update({ ...frameOf(f), frame: k });
      fighter.bonePosition("head", p);
      const want = baked(k);
      expect(Math.hypot(p.x - want.x, p.y - want.y), `frame ${k}`).toBeLessThan(0.01);
    }
    fighter.dispose();
  });
});

describe("a fighter with no model", () => {
  it("is drawn as its own hurtbox capsules, one per capsule on its bone, posed, in its port's colour", () => {
    const fighter = createFighter3D({ def: mario, port: 2, poser, bake, model: { kind: "standIn", reason: "no model index (run pnpm models)" } });
    expect(fighter.kind).toBe("standIn");
    const f = makeFighter({ x: fx(-12), y: fx(8), facing: -1, action: "attack", move: "fsmash", actionFrame: 14 });
    fighter.update(frameOf(f));
    expect(fighter.placement.visible).toBe(true);
    const capsules: Mesh[] = [];
    fighter.placement.traverse((o) => {
      if ((o as Mesh).isMesh) capsules.push(o as Mesh);
    });
    // One capsule per hurt capsule, on its bone, as thick as it is.
    const described = (bone: string, middle: number, r: number) => `${bone} ${middle.toFixed(6)} ${r.toFixed(6)}`;
    expect(capsules.map((m) => described(m.parent!.name, m.position.x, (m.geometry as CapsuleGeometry).parameters.radius)).sort()).toEqual(
      skeleton.hurt.map((h) => described(h.bone, (h.x1 + h.x2) / 2, h.r)).sort(),
    );
    const port = new Color(PORT_COLOURS[2]);
    for (const mesh of capsules) {
      expect(mesh.visible).toBe(true);
      expect((mesh.material as ToonMaterial).color.getHex()).toBe(port.getHex());
      // The capsule's middle sits on its bone's +X, wherever the pose has put the bone.
      const want = mesh.parent!.localToWorld(new Vector3(mesh.position.x, 0, 0));
      expect(mesh.getWorldPosition(new Vector3()).distanceTo(want)).toBeLessThan(1e-9);
    }
    // Posed: the forward smash puts the arm somewhere other than where it rests.
    const rest = createFighter3D({ def: mario, port: 2, poser, bake, model: { kind: "standIn", reason: "test" } });
    rest.update(frameOf({ ...f, action: "stand", move: null, actionFrame: 0 }));
    const posed = new Vector3();
    const still = new Vector3();
    fighter.bonePosition("arml", posed);
    rest.bonePosition("arml", still);
    expect(posed.distanceTo(still)).toBeGreaterThan(0.5);
  });
});

describe("a fighter with a glb", () => {
  it("poses the model's bones where the bake puts them, through the armature node Blender's export puts above the root", () => {
    const glb = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, gltfMaterials()) } });
    const stand = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    expect(glb.kind).toBe("glb");
    for (const f of [
      makeFighter({ x: fx(20), y: fx(25), facing: 1, action: "attack", move: "fsmash", actionFrame: 14 }),
      makeFighter({ x: fx(-5), y: fx(40), facing: -1, grounded: false, action: "attack", move: "uair", actionFrame: 8 }),
    ]) {
      glb.update(frameOf(f));
      stand.update(frameOf(f));
      const mesh = skinnedOf(glb);
      const bones = mesh.skeleton.bones;
      for (const name of poser.rig3.names) {
        const want = new Vector3();
        const got = new Vector3();
        expect(stand.bonePosition(name, want)).toBe(true);
        expect(glb.bonePosition(name, got)).toBe(true);
        expect(got.distanceTo(want), name).toBeLessThan(1e-6);
        // The skin follows: the vertex bound to this bone is drawn at the bone.
        const i = bones.findIndex((b) => b.name === name);
        const vertex = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld);
        expect(vertex.distanceTo(want), `${name} vertex`).toBeLessThan(1e-4);
      }
    }
  });

  it("blinks only its own copies of the materials while intangible, each from its exported alpha mode and back to it", () => {
    const sources = gltfMaterials();
    const scene = armatureModel(poser.rig3, sources);
    const a = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene } });
    const b = createFighter3D({ def: mario, port: 1, poser, bake, model: { kind: "glb", scene } });
    const mine = materialsOf(a);
    const theirs = materialsOf(b);
    expect([...mine.keys()].sort()).toEqual(["eye", "scouter", "skin"]);
    for (const [name, m] of mine) {
      expect(m.type).toBe("MeshToonMaterial");
      expect(theirs.get(name)).not.toBe(m);
      expect(sources).not.toContain(m);
    }
    const exported = (m: ToonMaterial) => [m.transparent, m.opacity, m.alphaTest, m.depthWrite];
    expect(exported(mine.get("skin")!)).toEqual([false, 1, 0, true]);
    expect(exported(mine.get("eye")!)).toEqual([false, 1, 0.5, true]);
    expect(exported(mine.get("scouter")!)).toEqual([true, 0.851, 0, false]);

    // Intangible on an even blink frame: 0.42 (`intangibleAlpha`, as the 2D figure).
    a.update(frameOf(makeFighter({ action: "spotDodge", actionFrame: 6, intangible: 4 })));
    b.update(frameOf(makeFighter({ port: 1, action: "stand" })));
    expect(exported(mine.get("skin")!)).toEqual([true, 0.42, 0, true]);
    expect(exported(mine.get("eye")!)).toEqual([true, 0.42, 0.5 * 0.42, true]);
    expect(mine.get("scouter")!.opacity).toBeCloseTo(0.851 * 0.42, 12);
    expect(exported(theirs.get("skin")!)).toEqual([false, 1, 0, true]);
    expect(exported(theirs.get("eye")!)).toEqual([false, 1, 0.5, true]);
    // The cache's own materials are never touched.
    expect(sources.map((m) => [m.transparent, m.opacity, m.alphaTest])).toEqual([[false, 1, 0], [false, 1, 0.5], [true, 0.851, 0]]);

    a.update(frameOf(makeFighter({ action: "stand" })));
    expect(exported(mine.get("skin")!)).toEqual([false, 1, 0, true]);
    expect(exported(mine.get("eye")!)).toEqual([false, 1, 0.5, true]);
    expect(exported(mine.get("scouter")!)).toEqual([true, 0.851, 0, false]);
  });

  it("keeps a model's parts on one skeleton, its own, as the glb has them: one bone texture a frame, not one a part (Task 17 carry)", () => {
    const scene = armatureModel(poser.rig3, gltfMaterials());
    const body = scene.getObjectByName("body") as SkinnedMesh;
    // More primitives of the same skinned mesh: three's GLTFLoader binds every one of them to the one skeleton.
    for (let i = 0; i < 3; i++) {
      const part = new SkinnedMesh(body.geometry, body.material);
      body.parent!.add(part);
      part.bind(body.skeleton, body.bindMatrix);
    }
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene } });
    const parts: SkinnedMesh[] = [];
    fighter.placement.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh);
    });
    expect(parts).toHaveLength(4);
    const skeletons = new Set(parts.map((p) => p.skeleton));
    expect(skeletons.size).toBe(1);
    const [skeleton] = skeletons;
    expect(skeleton).not.toBe(body.skeleton);
    expect(skeleton.bones.some((b) => body.skeleton.bones.includes(b))).toBe(false);
    // Every part's skin follows this fighter's bones.
    fighter.update(frameOf(makeFighter({ action: "attack", move: "fsmash", actionFrame: 14 })));
    const want = new Vector3();
    expect(fighter.bonePosition("arml", want)).toBe(true);
    const arm = skeleton.bones.findIndex((b) => b.name.toLowerCase() === "arml");
    for (const part of parts) expect(part.getVertexPosition(arm, new Vector3()).applyMatrix4(part.matrixWorld).distanceTo(want)).toBeLessThan(1e-4);
    const freed = vi.spyOn(skeleton, "dispose");
    fighter.dispose();
    expect(freed).toHaveBeenCalledOnce();
  });

  it("frees its own materials and skeleton, never the cache's geometry, materials or textures", () => {
    const sources = gltfMaterials();
    const scene = armatureModel(poser.rig3, sources);
    const source = scene.getObjectByName("body") as SkinnedMesh;
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene } });
    const geometry = vi.fn();
    const cached = vi.fn();
    const own = vi.fn();
    source.geometry.addEventListener("dispose", geometry);
    for (const m of sources) m.addEventListener("dispose", cached);
    for (const m of materialsOf(fighter).values()) m.addEventListener("dispose", own);
    const skeleton = vi.spyOn(skinnedOf(fighter).skeleton, "dispose");
    const sourceSkeleton = vi.spyOn(source.skeleton, "dispose");
    fighter.dispose();
    expect(geometry).not.toHaveBeenCalled();
    expect(cached).not.toHaveBeenCalled();
    expect(sourceSkeleton).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledTimes(3);
    expect(skeleton).toHaveBeenCalledTimes(1);
    expect(fighter.placement.children).toHaveLength(0);
  });
});

