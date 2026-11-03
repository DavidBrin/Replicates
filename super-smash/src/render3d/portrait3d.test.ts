import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { Light, MeshStandardMaterial, type Camera } from "three";

import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { armatureModel } from "./armatureModel";
import { fighterPoser } from "./bake/bake";
import { createFighter3D } from "./fighter3d";
import { PORTRAIT_SIZE, renderPortrait, type PortraitGL } from "./portrait3d";
import { createLights } from "./renderer3d";
import { parseSkeletonFile } from "./skeleton/skeleton";

const bake = readBakeFromDisk();
const mario = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!, bake.bones);
const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "mario.json"), "utf8")));
const poser = fighterPoser(mario, skeleton);

/** The slice of `WebGLRenderer` a portrait reads back through, recording each draw as it was made; every texel reads as `linear`. */
function fakePortraitGL(linear: number) {
  const drawn: { lights: number; fighters: number; background: unknown; camera: Camera; target: unknown }[] = [];
  let target: unknown = null;
  const gl: PortraitGL = {
    getRenderTarget: () => target as never,
    setRenderTarget: (t) => void (target = t),
    render: (scene, camera) => {
      let lights = 0;
      scene.traverse((o) => void ((o as Light).isLight && lights++));
      const fighters = scene.children.filter((c) => c.name.startsWith("fighter:")).length;
      drawn.push({ lights, fighters, background: (scene as unknown as { background: unknown }).background, camera, target });
    },
    readRenderTargetPixels: (_t, _x, _y, w, h, buffer) => {
      for (let i = 0; i < w * h * 4; i++) buffer[i] = i % 4 === 3 ? 255 : linear;
    },
  };
  return { gl, drawn, target: () => target };
}

/** A 2D canvas for the read-back, recording what is put on it (jsdom has none). */
function fakeCanvas() {
  const put: ImageData[] = [];
  const ctx = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: ImageData) => void put.push(image),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, put };
}

describe("a portrait from the loaded model (Plan 6, Task 38)", () => {
  it("draws the glb's head lit, on nothing, once, read back in sRGB into a square canvas held in memory", () => {
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    fighter.update({ f: makeFighter({ defId: "mario", action: "stand" }), x: 0, y: 0, frame: 0, blends: null, hitFlash: 0, hidden: false });
    const turned = fighter.placement.rotation.y;
    const { gl, drawn, target } = fakePortraitGL(128);
    const { canvas, put } = fakeCanvas();
    const out = renderPortrait(gl, fighter, createLights(), () => canvas);
    expect(out).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([PORTRAIT_SIZE, PORTRAIT_SIZE]);
    // Once, into a target of its own, the renderer's own target given back after.
    expect(drawn).toHaveLength(1);
    expect(drawn[0].target).not.toBeNull();
    expect(target()).toBeNull();
    // The fighter, lit as the match's scene is, on no background.
    expect(drawn[0].fighters).toBe(1);
    expect(drawn[0].lights).toBeGreaterThan(0);
    expect(drawn[0].background).toBeNull();
    // Linear 128 is sRGB 188: the target holds linear colour, the canvas shows sRGB.
    expect([...put[0].data.slice(0, 4)]).toEqual([188, 188, 188, 255]);
    // The fighter is handed back as it was.
    expect(fighter.placement.rotation.y).toBe(turned);
  });

  it("makes none for a stand-in, or without the renderer's read-back (the 2D head stays)", () => {
    const standIn = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const { canvas } = fakeCanvas();
    expect(renderPortrait(fakePortraitGL(128).gl, standIn, createLights(), () => canvas)).toBeNull();
    const glb = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    const noReadBack: PortraitGL = { ...fakePortraitGL(128).gl, readRenderTargetPixels: undefined };
    expect(renderPortrait(noReadBack, glb, createLights(), () => canvas)).toBeNull();
  });
});
