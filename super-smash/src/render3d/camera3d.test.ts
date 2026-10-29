import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";

import { MAX_ZOOM, MIN_ZOOM, VIEW_HEIGHT, VIEW_WIDTH, createCamera, worldToScreen } from "@/render/camera";
import { applySideCamera, createSideCamera, sideCameraPose } from "./camera3d";

/** Project a world point through the three.js camera into 1920×1080 pixels. */
function project(three: PerspectiveCamera, x: number, y: number, z = 0) {
  const v = new Vector3(x, y, z).project(three);
  return { x: ((v.x + 1) / 2) * VIEW_WIDTH, y: ((1 - v.y) / 2) * VIEW_HEIGHT };
}

describe("the 3D side camera", () => {
  it("puts every point of the sim's plane exactly where the 2D overlay draws it", () => {
    const cam = { ...createCamera(null), x: 12, y: 30, zoom: 7.5, shakeX: 14, shakeY: -9 };
    const three = createSideCamera();
    applySideCamera(three, cam);
    for (const [wx, wy] of [[0, 0], [12, 30], [-80, 5], [60, 90], [-200, -100]]) {
      const got = project(three, wx, wy);
      const want = worldToScreen(cam, wx, wy);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it("shows nearer things bigger: a fighter's near side is in front of the plane", () => {
    const cam = { ...createCamera(null), x: 0, y: 0, zoom: 10, shakeX: 0, shakeY: 0 };
    const three = createSideCamera();
    applySideCamera(three, cam);
    const near = project(three, 5, 0, 3);
    const flat = project(three, 5, 0, 0);
    expect(near.x - VIEW_WIDTH / 2).toBeGreaterThan(flat.x - VIEW_WIDTH / 2);
  });

  it("backs away as the 2D camera zooms out, keeping the stage between near and far", () => {
    const close = sideCameraPose({ x: 0, y: 0, zoom: 15, shakeX: 0, shakeY: 0 });
    const wide = sideCameraPose({ x: 0, y: 0, zoom: 3.6, shakeX: 0, shakeY: 0 });
    expect(wide.z).toBeGreaterThan(close.z * 4);
    for (const p of [close, wide]) {
      expect(p.near).toBeLessThan(p.z - 40);
      expect(p.far).toBeGreaterThan(p.z + 200);
    }
  });

  // Points spread across the stage and past its blast zones, nowhere near the camera's centre.
  const POINTS = [[0, 0], [12, 30], [-80, 5], [60, 90], [-200, -100], [240, 200]];

  it("lines up at every zoom the 2D camera reaches (KO punch-in included), with shake of either sign", () => {
    // `updateCamera` lets the KO punch-in zoom up to MAX_ZOOM * 1.6 (`camera.ts`).
    for (const zoom of [MIN_ZOOM, 5, 7.5, 10, MAX_ZOOM, MAX_ZOOM * 1.6]) {
      for (const [shakeX, shakeY] of [[0, 0], [14, -9], [-22, 17]]) {
        const cam = { ...createCamera(null), x: 12, y: 30, zoom, shakeX, shakeY };
        const three = createSideCamera();
        applySideCamera(three, cam);
        for (const [wx, wy] of POINTS) {
          const got = project(three, wx, wy);
          const want = worldToScreen(cam, wx, wy);
          expect(got.x).toBeCloseTo(want.x, 6);
          expect(got.y).toBeCloseTo(want.y, 6);
        }
      }
    }
  });

  it("hands the pose's near, far and fov to the camera and its projection matrix", () => {
    const cam = { ...createCamera(null), x: 0, y: 0, zoom: 4, shakeX: 0, shakeY: 0 };
    const three = createSideCamera();
    applySideCamera(three, cam);
    const p = sideCameraPose(cam, three.fov);
    expect(three.near).toBe(p.near);
    expect(three.far).toBe(p.far);
    expect(three.fov).toBe(p.fov);
    const want = new PerspectiveCamera(p.fov, VIEW_WIDTH / VIEW_HEIGHT, p.near, p.far);
    expect(three.projectionMatrix.elements).toEqual(want.projectionMatrix.elements);
  });

  it("still lines up when the three.js camera's fov is not the default", () => {
    const cam = { ...createCamera(null), x: 12, y: 30, zoom: 7.5, shakeX: 14, shakeY: -9 };
    const three = createSideCamera();
    three.fov = 40;
    applySideCamera(three, cam);
    for (const [wx, wy] of POINTS) {
      const got = project(three, wx, wy);
      const want = worldToScreen(cam, wx, wy);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });
});
