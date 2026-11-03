// @vitest-environment node
/**
 * The stance probe (Plan 6, Task 19): how far below the floor each fighter's drawn model reaches
 * at idle, by body part, in world units. Opt-in and local: it reads the git-ignored models
 * (`pnpm models` builds them into `public/models/`), poses each exactly as a match does
 * (`createFighter3D` → `drawnPose`, over the whole idle cycle), skins every vertex, and prints one
 * JSON line per fighter. It writes nothing, and makes no image (SPEC §3.1: the models are
 * Nintendo's, the repo is public). A fighter without a local model is measured as its stand-in:
 * a smoke test of the probe, not a measurement (a stand-in's low-poly capsules sit up to about
 * 0.1 above the hurtboxes' true bottoms, which `stance.test.ts` measures).
 *
 *   STANCE_PROBE=1 pnpm vitest run src/render3d/bake/stance.probe.test.ts --reporter=verbose
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it } from "vitest";
import { Mesh, SkinnedMesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { FIGHTERS } from "@/fighters";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { SKELETONS } from "../skeletons";
import { createFighter3D } from "../fighter3d";
import { parseModelIndex, type LoadedModel } from "../models/loader";
import { fighterPoser } from "./bake";

const FEET = /^(knee|leg|foot|toe)/i;
const HANDS = /^(arm|hand|finger|have)/i;
const MODELS = join(process.cwd(), "public", "models");

/** A fighter's glb, parsed in Node: three's loader reads `self.URL`, and a texture it cannot decode is left out (the probe needs none). */
async function loadModel(id: string): Promise<LoadedModel> {
  const indexFile = join(MODELS, "index.json");
  const entry = existsSync(indexFile) ? parseModelIndex(JSON.parse(readFileSync(indexFile, "utf8")))?.models[id] : undefined;
  if (entry === undefined || !existsSync(join(MODELS, entry.file))) return { kind: "standIn", reason: "no local model" };
  (globalThis as { self?: unknown }).self ??= globalThis;
  const bytes = readFileSync(join(MODELS, entry.file));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return { kind: "glb", scene: gltf.scene };
}

/** The bone a vertex hangs off: its heaviest joint (skinned), or the bone a stand-in capsule rides. */
function boneOf(mesh: Mesh, i: number): string {
  if (!(mesh as SkinnedMesh).isSkinnedMesh) return mesh.parent?.name ?? "";
  const skinned = mesh as SkinnedMesh;
  const index = skinned.geometry.getAttribute("skinIndex");
  const weight = skinned.geometry.getAttribute("skinWeight");
  let best = 0;
  for (let k = 1; k < 4; k++) if (weight.getComponent(i, k) > weight.getComponent(i, best)) best = k;
  return skinned.skeleton.bones[index.getComponent(i, best)]?.name ?? "";
}

/** The lowest drawn point of `root`'s meshes as posed now, by part. */
function lowest(root: Object3D, low: { feet: number; hands: number; all: number }): void {
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const n = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < n; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      low.all = Math.min(low.all, v.y);
      const bone = boneOf(mesh, i);
      if (FEET.test(bone)) low.feet = Math.min(low.feet, v.y);
      if (HANDS.test(bone)) low.hands = Math.min(low.hands, v.y);
    }
  });
}

describe.skipIf(process.env.STANCE_PROBE !== "1")("the stance probe (Plan 6, Task 19; local, numbers only)", () => {
  it("prints each fighter's lowest drawn point at idle, by part", async () => {
    const bake = readBakeFromDisk();
    for (const def of FIGHTERS) {
      const model = await loadModel(def.id);
      const fighter = createFighter3D({ def, port: 0, poser: fighterPoser(def, SKELETONS[def.id]), bake, model, faceTurns: [] });
      const frames = bake.clock(def.id, "status_stand")?.frames ?? 1;
      const low = { feet: Infinity, hands: Infinity, all: Infinity };
      for (let g = 0; g < frames; g++) {
        fighter.update({ f: makeFighter({ defId: def.id, action: "stand" }), x: 0, y: 0, frame: g, blends: null, hitFlash: 0, hidden: false });
        lowest(fighter.placement, low);
      }
      const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
      console.log(JSON.stringify({ id: def.id, kind: model.kind, feet: round(low.feet), hands: round(low.hands), all: round(low.all) }));
      fighter.dispose();
    }
  }, 300_000);
});
