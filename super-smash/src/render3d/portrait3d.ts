/**
 * A HUD portrait rendered from the loaded model (Plan 6, Task 38; ruling D14): the head
 * and shoulders, once, a three-quarter turn toward the camera, lit as the match lights it,
 * into an offscreen target, read back into a 2D canvas held in memory for the match.
 * Never saved and never sent: the repo is public and the models are Nintendo's (SPEC §3.1).
 * A stand-in, or a renderer without a read-back (a test's fake), has none, and the HUD
 * keeps the 2D rig's head.
 */

import { OrthographicCamera, Scene, Vector3, WebGLRenderTarget, type Camera, type Object3D } from "three";

import type { Fighter3D } from "./fighter3d";

/** The portrait's side, px: the HUD's cell draws its head 96 across. */
export const PORTRAIT_SIZE = 96;
/** How far the portrait turns the model from side-on toward the camera, radians. UNVERIFIED (cosmetic): by eye. */
const PORTRAIT_TURN = 0.5;

/** The slice of `WebGLRenderer` a portrait renders and reads back through. */
export interface PortraitGL {
  render(scene: Object3D, camera: Camera): void;
  getRenderTarget?(): WebGLRenderTarget | null;
  setRenderTarget?(target: WebGLRenderTarget | null): void;
  readRenderTargetPixels?(target: WebGLRenderTarget, x: number, y: number, width: number, height: number, buffer: Uint8Array): void;
}

/** sRGB from linear, 0-255: a render target holds linear colour (three r186 writes sRGB only to the screen). */
const toSrgb = (v: number): number => {
  const c = v / 255;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};

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
    const target = new WebGLRenderTarget(PORTRAIT_SIZE, PORTRAIT_SIZE);
    const before = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    const pixels = new Uint8Array(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    gl.readRenderTargetPixels(target, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, pixels);
    gl.setRenderTarget(before);
    target.dispose();
    const out = makeCanvas();
    out.width = PORTRAIT_SIZE;
    out.height = PORTRAIT_SIZE;
    const ctx = out.getContext("2d");
    if (ctx !== null) {
      const image = ctx.createImageData(PORTRAIT_SIZE, PORTRAIT_SIZE);
      const row = PORTRAIT_SIZE * 4;
      // A target's rows run bottom to top, a canvas's top to bottom.
      for (let y = 0; y < PORTRAIT_SIZE; y++) {
        for (let i = 0; i < row; i++) {
          const v = pixels[(PORTRAIT_SIZE - 1 - y) * row + i];
          image.data[y * row + i] = i % 4 === 3 ? v : toSrgb(v);
        }
      }
      ctx.putImageData(image, 0, 0);
      canvas = out;
    }
  }
  placement.rotation.y = turned;
  scene.remove(placement, ...Object.values(lights));
  if (parent !== null) parent.add(placement);
  placement.updateMatrixWorld(true);
  return canvas;
}
