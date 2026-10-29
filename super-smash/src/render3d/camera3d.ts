/**
 * The 3D side camera, framed by the existing 2D camera (`render/camera.ts`).
 *
 * `camera.ts` already decides where the view is and how far it is zoomed —
 * fighters in frame, KO punch-in, shake — in screen pixels per world unit. A
 * perspective camera looking down −Z maps the z = 0 plane (where the sim lives)
 * linearly onto the screen, so placing it at the distance where one world unit
 * is `zoom` pixels makes every point on that plane land exactly where
 * `worldToScreen` says. The 2D overlay (HUD, projectiles, move effects, the
 * magnifying glass) therefore lines up with the 3D fighters by construction,
 * while depth — the stage's front face, the far side of a body — still gets
 * Ultimate's gentle perspective.
 */

import { PerspectiveCamera } from "three";

import { VIEW_HEIGHT, VIEW_WIDTH, type Camera } from "@/render/camera";

/** Vertical field of view, degrees. Narrow, like Ultimate's side camera. UNVERIFIED: tuned by eye. */
export const SIDE_FOV_DEG = 26;

export interface SideCameraPose {
  readonly x: number;
  readonly y: number;
  /** Distance from the z = 0 plane. */
  readonly z: number;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
}

/** Where the 3D camera sits for a 2D camera state. Pure. */
export function sideCameraPose(cam: Pick<Camera, "x" | "y" | "zoom" | "shakeX" | "shakeY">, fovDeg = SIDE_FOV_DEG): SideCameraPose {
  const half = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const z = VIEW_HEIGHT / 2 / (cam.zoom * half);
  return {
    // worldToScreen adds the shake in pixels; moving the camera the other way by
    // the same distance in units is the same picture.
    x: cam.x - cam.shakeX / cam.zoom,
    y: cam.y + cam.shakeY / cam.zoom,
    z,
    fov: fovDeg,
    // UNVERIFIED (tuning): the clip planes are set by eye, not measured; the test
    // only pins that they bracket the z = 0 plane with room to spare.
    near: Math.max(0.5, z * 0.25),
    far: z + 800,
  };
}

export function createSideCamera(): PerspectiveCamera {
  return new PerspectiveCamera(SIDE_FOV_DEG, VIEW_WIDTH / VIEW_HEIGHT, 1, 1000);
}

/** Point a three.js camera where `sideCameraPose` says. */
export function applySideCamera(three: PerspectiveCamera, cam: Pick<Camera, "x" | "y" | "zoom" | "shakeX" | "shakeY">): void {
  const p = sideCameraPose(cam, three.fov);
  three.position.set(p.x, p.y, p.z);
  three.near = p.near;
  three.far = p.far;
  three.aspect = VIEW_WIDTH / VIEW_HEIGHT;
  three.lookAt(p.x, p.y, 0);
  three.updateProjectionMatrix();
  three.updateMatrixWorld();
}
