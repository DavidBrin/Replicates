/**
 * Faces turn toward the camera (Plan 4 Task 21c), and no box moves.
 *
 * The game turns a fighter a pure ±90° and the clips pose limbs in the side
 * plane, so every face is drawn edge-on, and Kirby's (the front of his body)
 * never shows. The ruling: turn, at render only, bones whose own origin stays
 * where it is (a head; Kirby's body bone, which carries his face), about the
 * vertical through that origin, and choose them so that no other bone carrying a
 * hurt or hit capsule moves. These tests hold every fighter to that, on a sample
 * of states, facing either way, against the same fighter with no turn.
 */

import { Matrix4, MeshStandardMaterial, Quaternion, Vector3, type Bone, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import type { FighterState } from "@/engine/types";
import { FIGHTERS, FIGHTER_IDS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { armatureModel } from "./armatureModel";
import { fighterPoser } from "./bake/bake";
import { referenceScriptBones } from "./bake/roster";
import { FACE_TURNS } from "./faceTurn";
import { createFighter3D, type Fighter3D } from "./fighter3d";
import { SKELETONS } from "./skeletons";
import { hurtBonesFor } from "./skeletons/hurtBones";

const bake = readBakeFromDisk();

/** The states each fighter is checked in: standing, moving, airborne, attacking, reeling, dodging. */
const STATES: readonly Partial<FighterState>[] = [
  { action: "stand", actionFrame: 0 },
  { action: "stand", actionFrame: 37 },
  { action: "walk", actionFrame: 7, vx: fx(1) },
  { action: "jump", actionFrame: 4, grounded: false },
  { action: "attack", move: "jab1", actionFrame: 3 },
  { action: "attack", move: "fsmash", actionFrame: 12 },
  { action: "attack", move: "nair", actionFrame: 6, grounded: false },
  { action: "attack", move: "upB", actionFrame: 9, grounded: false },
  { action: "hitstun", actionFrame: 5, hitstun: 20, grounded: false },
  { action: "airDodge", actionFrame: 3, grounded: false },
];

function fighterOf(id: string, turned: boolean, model: "glb" | "standIn"): Fighter3D {
  const def = withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);
  const poser = fighterPoser(def, SKELETONS[id]);
  return createFighter3D({
    def,
    port: 0,
    poser,
    bake,
    model: model === "glb" ? { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } : { kind: "standIn", reason: "test" },
    ...(turned ? {} : { faceTurns: [] }),
  });
}

/** Every bone of the fighter's rig, by name, after `state` is drawn. */
function bonesAfter(fighter: Fighter3D, id: string, state: Partial<FighterState>): Map<string, Object3D> {
  const f = makeFighter({ defId: id, x: fx(12), y: fx(3), ...state });
  fighter.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });
  const out = new Map<string, Object3D>();
  fighter.placement.traverse((o) => {
    if ((o as Bone).isBone) out.set(o.name, o);
  });
  return out;
}

/** The bones that carry a hurt capsule (hurtBones.json) or a script's hitbox (`referenceScriptBones`), lower case. */
function capsuleBones(id: string): Set<string> {
  return new Set([...hurtBonesFor(id).bones.map((b) => b.toLowerCase()), ...referenceScriptBones(id)]);
}

describe("the face-turn table", () => {
  it("turns a head, and Kirby's body bone (his face is on it), and only those", () => {
    expect(Object.fromEntries(Object.entries(FACE_TURNS).map(([id, turns]) => [id, turns.map((t) => t.bone)]))).toEqual({
      mario: ["Head"],
      donkeyKong: ["Head"],
      link: ["Head"],
      samus: ["Head"],
      kirby: ["Body"],
      fox: ["Head"],
      pikachu: ["Head"],
      marth: ["Head"],
    });
    for (const turns of Object.values(FACE_TURNS)) for (const t of turns) expect(t.deg).toBeGreaterThan(0);
  });

  it.each(FIGHTER_IDS)("%s: no turned bone has a bone of the rig below it, so a turn can carry no other capsule with it", (id) => {
    const bones = SKELETONS[id].bones;
    const capsules = capsuleBones(id);
    for (const t of FACE_TURNS[id] ?? []) {
      expect(bones.some((b) => b.name === t.bone), `${id} has ${t.bone}`).toBe(true);
      const below = bones.filter((b) => b.parent === t.bone).map((b) => b.name);
      expect(below, `${id} ${t.bone}`).toEqual([]);
      expect([...capsules].filter((c) => below.some((b) => b.toLowerCase() === c))).toEqual([]);
    }
  });
});

describe("a face turned toward the camera moves no box", () => {
  it.each(FIGHTER_IDS)("%s: every bone stays where it is, facing either way, glb or stand-in; only the table's bones turn", (id) => {
    const turnedNames = new Set((FACE_TURNS[id] ?? []).map((t) => t.bone));
    const capsules = capsuleBones(id);
    for (const model of ["glb", "standIn"] as const) {
      const on = fighterOf(id, true, model);
      const off = fighterOf(id, false, model);
      for (const facing of [1, -1] as const) {
        for (const state of STATES) {
          const label = `${id} ${model} facing ${facing} ${state.action} ${state.move ?? ""} ${state.actionFrame}`;
          const a = bonesAfter(on, id, { ...state, facing });
          const b = bonesAfter(off, id, { ...state, facing });
          expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
          const turned: string[] = [];
          for (const [name, bone] of a) {
            const pa = bone.getWorldPosition(new Vector3());
            const pb = b.get(name)!.getWorldPosition(new Vector3());
            const why = capsules.has(name.toLowerCase()) ? "carries a capsule" : "a bone of the rig";
            expect(pa.distanceTo(pb), `${label}: ${name} (${why}) moved`).toBeLessThan(1e-9);
            // Matrices, not world quaternions: a clip's squash scales the model unevenly, and a
            // quaternion decomposed from a sheared matrix is not unit length.
            const ma = bone.matrixWorld.elements;
            const mb = b.get(name)!.matrixWorld.elements;
            if (ma.some((v, k) => Math.abs(v - mb[k]) > 1e-9)) turned.push(name);
          }
          expect(new Set(turned), label).toEqual(turnedNames);
        }
      }
      on.dispose();
      off.dispose();
    }
  });
});

describe("the turn is toward the camera, facing either way, and a turn, not a mirror", () => {
  /** A bone's transform in the model group's space: its pose, before the clip's scale and squash and the facing turn. */
  const inModel = (fighter: Fighter3D, bone: Object3D) => new Matrix4().copy(fighter.placement.children[0].matrixWorld).invert().multiply(bone.matrixWorld);

  it.each(FIGHTER_IDS)("%s: a turned bone is the unturned one turned about the vertical, toward the camera, by the table's angle", (id) => {
    const on = fighterOf(id, true, "glb");
    const off = fighterOf(id, false, "glb");
    for (const facing of [1, -1] as const) {
      for (const state of STATES) {
        const a = bonesAfter(on, id, { ...state, facing });
        const b = bonesAfter(off, id, { ...state, facing });
        for (const t of FACE_TURNS[id] ?? []) {
          const label = `${id} ${t.bone} facing ${facing} ${state.action} ${state.move ?? ""}`;
          // The turn that takes the unturned bone to the turned one, in the model's space.
          const delta = new Quaternion().setFromRotationMatrix(inModel(on, a.get(t.bone)!).multiply(inModel(off, b.get(t.bone)!).invert()));
          expect(Math.abs(new Vector3(delta.x, delta.y, delta.z).normalize().y), `${label}: about the vertical`).toBeCloseTo(1, 6);
          expect((2 * Math.acos(Math.min(1, Math.abs(delta.w))) * 180) / Math.PI, label).toBeCloseTo(t.deg, 6);
          // The fighter's forward (+Z in its model) turns toward the camera: model −X facing right, +X facing left.
          const forward = new Vector3(0, 0, 1).applyQuaternion(delta);
          expect(-facing * forward.x, `${label}: toward the camera`).toBeCloseTo(Math.sin((t.deg * Math.PI) / 180), 6);
          // A rotation, never a reflection.
          expect(a.get(t.bone)!.matrixWorld.determinant(), label).toBeGreaterThan(0);
        }
      }
    }
    on.dispose();
    off.dispose();
  });

  it.each(FIGHTER_IDS)("%s: in the world, standing, the turned face leans toward the camera at +z, facing right or left", (id) => {
    const on = fighterOf(id, true, "glb");
    const off = fighterOf(id, false, "glb");
    for (const facing of [1, -1] as const) {
      const a = bonesAfter(on, id, { action: "stand", actionFrame: 0, facing });
      const b = bonesAfter(off, id, { action: "stand", actionFrame: 0, facing });
      for (const t of FACE_TURNS[id] ?? []) {
        const delta = a.get(t.bone)!.getWorldQuaternion(new Quaternion()).multiply(b.get(t.bone)!.getWorldQuaternion(new Quaternion()).invert());
        const forward = new Vector3(facing, 0, 0).applyQuaternion(delta);
        // To 3 places: standing breathes, a squash that scales the model a few parts in 10 000 unevenly (exact in model space, above).
        expect(forward.z, `${id} facing ${facing}`).toBeCloseTo(Math.sin((t.deg * Math.PI) / 180), 3);
        expect(forward.x * facing, `${id} facing ${facing}: still facing its way`).toBeGreaterThan(0);
      }
    }
    on.dispose();
    off.dispose();
  });
});
