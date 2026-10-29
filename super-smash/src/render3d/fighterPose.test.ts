import { describe, expect, it } from "vitest";
import { Group, Matrix4 } from "three";

import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { newBonePose } from "@/engine/acmd/bones";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fighterPoser } from "./bake/bake";
import { rootMatrix, sideBonePose } from "./bake/fk";
import { poseIndexOf } from "@/engine/acmd/poseClock";
import { fx } from "@/engine/fixed";
import { createVfx } from "@/render/vfx";
import { makeFighter } from "@/render/testFixtures";
import { bakedPoseAt, drawnPose, poseInputs } from "./fighterPose";
import { parseSkeletonFile } from "./skeleton/skeleton";
import { applyLocalPose, applyRoot, bonesFromRig } from "./threeRig";

const bake = readBakeFromDisk();
const skeletonOf = (id: string) =>
  parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", `${id}.json`), "utf8")));

/**
 * The guarantee the whole plan rests on (spec §3.1, research R§2): what the
 * renderer draws on a frame is what the sim's bone table says for that frame.
 * three.js poses the bones here exactly as `Fighter3D` does, and every baked
 * bone of every frame of every motion must match the committed bake to within
 * its own quantum. The fighters are the game's (`withLimbScripts` through the
 * bake's own bones, ruling R1): an adopted limb-bone move plays its imported
 * script's motion, and so must the drawing.
 */
describe("the renderer's pose equals the bake", () => {
  for (const def of FIGHTERS.map((d) => withLimbScripts(d, bake.bones))) {
    it(`${def.id}: every baked bone, every frame, every motion`, () => {
      const skeleton = skeletonOf(def.id);
      const poser = fighterPoser(def, skeleton);
      const inputs = poseInputs(poser, def, bake);
      const root = new Group();
      const bones = bonesFromRig(poser.rig3);
      root.add(bones[0]);
      const baked = bake.bones;
      let checked = 0;
      for (const [motion, sampler] of inputs.samplers) {
        for (let k = 1; k <= sampler.clock.frames; k++) {
          const drawn = bakedPoseAt(inputs, { motion, frame: k });
          applyLocalPose(bones, drawn.local);
          applyRoot(root, drawn.root);
          root.updateMatrixWorld(true);
          for (const name of ["kneer", "arml", "head", "hip"]) {
            const i = poser.rig3.byLower.get(name);
            const want = newBonePose();
            if (i === undefined || !baked.pose(def.id, motion, k, name, want)) continue;
            const got = sideBonePose(new Matrix4().copy(bones[i].matrixWorld).toArray());
            for (const key of ["tx", "ty", "m00", "m01", "m02", "m10", "m11", "m12"] as const) {
              expect(Math.abs(got[key] - want[key]), `${motion}#${k} ${name}.${key}`).toBeLessThanOrEqual(BAKE_QUANTUM);
            }
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
    }, 60_000);
  }
});

describe("the drawn limbs follow the sim's clock, so they are where the hurtboxes are", () => {
  it("a fast-fall begun mid-descent is drawn on the frame the sim's hurtboxes use, once the fade is over", () => {
    const def = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!, bake.bones);
    const inputs = poseInputs(fighterPoser(def, skeletonOf("mario")), def, bake);
    const blends = createVfx().poseBlend;
    let last = null as ReturnType<typeof drawnPose> | null;
    // Falling for 20 frames, then down is pressed: same action, new clip.
    for (let k = 0; k <= 32; k++) {
      const f = makeFighter({ action: "fall", grounded: false, actionFrame: k, fastFalling: k >= 20 });
      last = drawnPose(inputs, f, k, blends);
    }
    const f = makeFighter({ action: "fall", grounded: false, actionFrame: 32, fastFalling: true });
    expect(last!.index).toEqual(poseIndexOf(def, f, 32, bake.clock));
  });
});

describe("drawing a frame poses in place", () => {
  const def = withLimbScripts(FIGHTERS.find((f) => f.id === "fox")!, bake.bones);
  const inputs = poseInputs(fighterPoser(def, skeletonOf("fox")), def, bake);
  // A move (adopted limb script), a looping status, a dodge with a spin, a paced run, the idle.
  const states = [
    makeFighter({ defId: "fox", action: "attack", move: "nair", grounded: false, actionFrame: 6 }),
    makeFighter({ defId: "fox", action: "attack", move: "fsmash", actionFrame: 15 }),
    makeFighter({ defId: "fox", action: "roll", actionFrame: 9 }),
    makeFighter({ defId: "fox", action: "run", actionFrame: 23, vx: fx(2) }),
    makeFighter({ defId: "fox", action: "stand", actionFrame: 40 }),
    makeFighter({ defId: "fox", action: "airDodge", grounded: false, actionFrame: 3, charge: 7 }),
  ];

  it("draws exactly the baked pose when nothing fades, into the same buffers every frame", () => {
    const first = drawnPose(inputs, states[0], 100, null);
    const { local, root } = first;
    for (const f of states) {
      const drawn = drawnPose(inputs, f, 100, null);
      const index = poseIndexOf(def, f, 100, bake.clock)!;
      expect(drawn.index).toEqual(index);
      const exact = bakedPoseAt(inputs, index);
      expect(drawn.local.q).toEqual(exact.local.q);
      expect(drawn.local.t).toEqual(exact.local.t);
      expect(drawn.root).toEqual(exact.root);
      expect(drawn.sample).toEqual(exact.sample);
      // Reused, not reallocated: the renderer draws sixty of these a second per fighter.
      expect(drawn.local).toBe(local);
      expect(drawn.root).toBe(root);
      expect(drawn).toBe(first);
    }
  });

  it("puts the root transform on the group exactly as the bake's `rootMatrix`", () => {
    const group = new Group();
    for (const r of [
      { forward: 0, up: 0, squashForward: 1, squashUp: 1, scale: 1 },
      { forward: 2.5, up: -1.25, squashForward: 0.75, squashUp: 1.3, scale: 1.08 },
      { forward: -0.4, up: 3, squashForward: 1.1, squashUp: 0.9, scale: 0.92 },
    ]) {
      applyRoot(group, r);
      expect(group.matrix.toArray()).toEqual(rootMatrix(r));
      expect(group.matrixAutoUpdate).toBe(false);
    }
  });
});
