import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { DataUtils, Group, HalfFloatType, Light, MeshStandardMaterial, WebGLRenderTarget, type Camera } from "three";

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

/** One texel of a target as three leaves it: linear colour, premultiplied by alpha, 0-1. */
type Texel = readonly [r: number, g: number, b: number, a: number];

/** The slice of `WebGLRenderer` a portrait reads back through, recording each draw as it was made; every texel reads back as `texel`, in half floats. */
function fakePortraitGL(texel: Texel) {
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
      for (let i = 0; i < w * h * 4; i++) buffer[i] = DataUtils.toHalfFloat(texel[i % 4]);
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
    const { gl, drawn, target } = fakePortraitGL([0.5, 0.5, 0.5, 1]);
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
    // Linear 0.5 is sRGB 188: the target holds linear colour, the canvas shows sRGB.
    expect([...put[0].data.slice(0, 4)]).toEqual([188, 188, 188, 255]);
    // The fighter is handed back as it was.
    expect(fighter.placement.rotation.y).toBe(turned);
  });

  /**
   * The portrait takes the fighter out of the match's scene to light it alone, and a target is a
   * GPU allocation per fighter per match (final wave, item 33): the fighter must be back in the
   * scene the match draws, or it vanishes at frame 0, and the target freed.
   */
  it("puts the fighter back in the match's scene, and disposes its target", () => {
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    const matchScene = new Group();
    matchScene.add(fighter.placement);
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, "dispose");
    try {
      const { gl, drawn } = fakePortraitGL([0.5, 0.5, 0.5, 1]);
      const { canvas } = fakeCanvas();
      expect(renderPortrait(gl, fighter, createLights(), () => canvas)).toBe(canvas);
      // It was drawn in a scene of its own, not the match's.
      expect(drawn).toHaveLength(1);
      expect(drawn[0].fighters).toBe(1);
      // Back where it was: the match's scene holds it again.
      expect(fighter.placement.parent).toBe(matchScene);
      expect(matchScene.children).toContain(fighter.placement);
      // The one target it made is the one it freed.
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(dispose.mock.contexts[0]).toBe(drawn[0].target);
    } finally {
      dispose.mockRestore();
    }
  });

  it("makes none for a stand-in, or without the renderer's read-back (the 2D head stays)", () => {
    const standIn = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const { canvas } = fakeCanvas();
    expect(renderPortrait(fakePortraitGL([0.5, 0.5, 0.5, 1]).gl, standIn, createLights(), () => canvas)).toBeNull();
    const glb = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    const noReadBack: PortraitGL = { ...fakePortraitGL([0.5, 0.5, 0.5, 1]).gl, readRenderTargetPixels: undefined };
    expect(renderPortrait(noReadBack, glb, createLights(), () => canvas)).toBeNull();
  });

  /**
   * The final wave (final review item 36): the portraits looked muted beside the models in
   * the match. An 8-bit linear target posterised the dark tones, it had no multisampling,
   * and edges kept their premultiplied colour.
   */
  it("renders into a half-float, multisampled target, and reads its colour back straight: dark tones and edges keep their colour", () => {
    const glb = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    // A half-covered edge texel: straight linear (0.002, 0.25, 0.5) at alpha 0.5, premultiplied.
    const { gl, drawn } = fakePortraitGL([0.001, 0.125, 0.25, 0.5]);
    const { canvas, put } = fakeCanvas();
    expect(renderPortrait(gl, glb, createLights(), () => canvas)).toBe(canvas);
    const target = drawn[0].target as WebGLRenderTarget;
    expect([target.texture.type, target.samples]).toEqual([HalfFloatType, 4]);
    // Linear 0.002 is sRGB 7, a tone 8-bit linear cannot hold (linear 1/255 is sRGB 13).
    expect([...put[0].data.slice(0, 4)]).toEqual([7, 137, 188, 128]);
  });

  it("makes none from a read-back with nothing in it, a context lost before three hears so (the 2D head stays)", () => {
    const glb = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    const { canvas, put } = fakeCanvas();
    expect(renderPortrait(fakePortraitGL([0, 0, 0, 0]).gl, glb, createLights(), () => canvas)).toBeNull();
    expect(put).toEqual([]);
  });
});
