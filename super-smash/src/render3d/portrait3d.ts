/**
 * A HUD portrait rendered from the loaded model (Plan 6, Task 38; ruling D14): the head
 * and shoulders, once, a three-quarter turn toward the camera, lit as the match lights it,
 * into an offscreen target, read back into a 2D canvas held in memory for the match.
 * Never saved and never sent: the repo is public and the models are Nintendo's (SPEC §3.1).
 * A stand-in, a renderer without a read-back (a test's fake), or a read-back with nothing
 * in it (a context lost before three hears so) has none, and the HUD keeps the 2D rig's head.
 *
 * The target matches the match's own look (final wave, final review item 36): half floats,
 * so dark tones are not posterised as an 8-bit linear target posterises them (linear 1/255
 * is already sRGB 13), and 4 samples, as the match's canvas is antialiased. Blending and the
 * multisample resolve leave colour premultiplied by coverage; the read-back divides it out
 * before the canvas takes it as straight alpha, so edges are not darkened.
 */

import { DataUtils, HalfFloatType, OrthographicCamera, Scene, Vector3, WebGLRenderTarget, type Camera, type Object3D } from "three";

import type { Fighter3D } from "./fighter3d";

/** The portrait's side, px: the HUD's cell draws its head 96 across. */
export const PORTRAIT_SIZE = 96;
/** How far the portrait turns the model from side-on toward the camera, radians. UNVERIFIED (cosmetic): by eye. */
const PORTRAIT_TURN = 0.5;
/** The portrait target's multisampling, as the match's antialiased canvas. UNVERIFIED (cosmetic): 4 is three's usual MSAA count. */
const PORTRAIT_SAMPLES = 4;

/** The slice of `WebGLRenderer` a portrait renders and reads back through. */
export interface PortraitGL {
  render(scene: Object3D, camera: Camera): void;
  getRenderTarget?(): WebGLRenderTarget | null;
  setRenderTarget?(target: WebGLRenderTarget | null): void;
  readRenderTargetPixels?(target: WebGLRenderTarget, x: number, y: number, width: number, height: number, buffer: Uint16Array): void;
}

/** sRGB 0-255 from linear 0-1: a render target holds linear colour (three r186 writes sRGB only to the screen). */
const toSrgb = (c: number): number => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The canvas's RGBA bytes from a `size`-square target's half-float read-back, or null when
 * no texel has any alpha. A target's rows run bottom to top, a canvas's top to bottom; its
 * colour is linear and premultiplied, a canvas's sRGB and straight.
 */
function portraitPixels(halves: Uint16Array, size: number): Uint8ClampedArray | null {
  const out = new Uint8ClampedArray(size * size * 4);
  const row = size * 4;
  let seen = false;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < row; x += 4) {
      const from = (size - 1 - y) * row + x;
      const alpha = clamp01(DataUtils.fromHalfFloat(halves[from + 3]));
      const a = Math.round(255 * alpha);
      if (a === 0) continue;
      seen = true;
      const to = y * row + x;
      for (let c = 0; c < 3; c++) out[to + c] = toSrgb(clamp01(DataUtils.fromHalfFloat(halves[from + c]) / alpha));
      out[to + 3] = a;
    }
  }
  return seen ? out : null;
}

/**
 * `fighter`'s portrait, as it stands now (its last `update`), or null. `lights` are lights
 * of the match's own (`createLights`), made for the portrait's scene.
 */
export function renderPortrait(
  gl: PortraitGL,
  fighter: Fighter3D,
  lights: Readonly<Record<string, Object3D>>,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): HTMLCanvasElement | null {
  if (fighter.kind !== "glb" || gl.getRenderTarget === undefined || gl.setRenderTarget === undefined || gl.readRenderTargetPixels === undefined) return null;
  const placement = fighter.placement;
  const parent = placement.parent;
  const turned = placement.rotation.y;
  const scene = new Scene();
  scene.add(...Object.values(lights), placement);
  placement.rotation.y = turned >= 0 ? PORTRAIT_TURN : -PORTRAIT_TURN;
  placement.updateMatrixWorld(true);
  const head = new Vector3();
  const feet = placement.getWorldPosition(new Vector3());
  let canvas: HTMLCanvasElement | null = null;
  if (fighter.bonePosition("head", head)) {
    // A window round the head, sized by the fighter's own height to it: Kirby's whole ball, Donkey Kong's
    // head and shoulders. UNVERIFIED (cosmetic): the 0.35 and the 3-8 clamp are by eye.
    const half = Math.min(8, Math.max(3, (head.y - feet.y) * 0.35));
    const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 200);
    camera.position.set(head.x, head.y - half * 0.15, head.z + 60);
    camera.lookAt(head.x, head.y - half * 0.15, head.z);
    camera.updateMatrixWorld();
    const target = new WebGLRenderTarget(PORTRAIT_SIZE, PORTRAIT_SIZE, { type: HalfFloatType, samples: PORTRAIT_SAMPLES });
    const before = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    const halves = new Uint16Array(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    gl.readRenderTargetPixels(target, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, halves);
    gl.setRenderTarget(before);
    target.dispose();
    const pixels = portraitPixels(halves, PORTRAIT_SIZE);
    if (pixels !== null) {
      const out = makeCanvas();
      out.width = PORTRAIT_SIZE;
      out.height = PORTRAIT_SIZE;
      const ctx = out.getContext("2d");
      if (ctx !== null) {
        const image = ctx.createImageData(PORTRAIT_SIZE, PORTRAIT_SIZE);
        image.data.set(pixels);
        ctx.putImageData(image, 0, 0);
        canvas = out;
      }
    }
  }
  placement.rotation.y = turned;
  scene.remove(placement, ...Object.values(lights));
  if (parent !== null) parent.add(placement);
  placement.updateMatrixWorld(true);
  return canvas;
}
