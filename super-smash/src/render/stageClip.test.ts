/**
 * Move effects and projectiles are not painted over the stage's front face
 * (Plan 5, Task 17 fix round 3, ruling R-T17l; the re-review 2's V2).
 */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import { applySideCamera, createSideCamera } from "@/render3d/camera3d";
import { STAGES } from "@/stages";
import { VIEW_HEIGHT, VIEW_WIDTH, createCamera, worldToScreen } from "./camera";
import { stageSolidsOnScreen } from "./stageClip";

/** Even-odd point-in-polygon. */
function inside(poly: readonly { x: number; y: number }[], p: { x: number; y: number }): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
const anyInside = (polys: readonly { x: number; y: number }[][], p: { x: number; y: number }) => polys.some((poly) => inside(poly, p));

describe("the stage's solid bodies on screen, as the 3D stage draws them (ruling R-T17l)", () => {
  const fd = STAGES.find((s) => s.id === "finalDestination")!;
  const main = fd.platforms.find((p) => !p.soft)!;
  const half = toFloat(main.halfWidth);
  const top = toFloat(main.y);
  const cam = { ...createCamera(fd), x: 0, y: 20, zoom: 14 };

  it("covers what is inside the body or behind its front face, and nothing above the floor", () => {
    const polys = stageSolidsOnScreen(fd, 0, cam);
    expect(polys.length).toBe(1);
    // Under the floor, where Mario Finale's flame and Zero Laser's lower fringe reached.
    for (const y of [-1, -8, -20]) expect(anyInside(polys, worldToScreen(cam, 10, top + y)), `y ${y}`).toBe(true);
    // Over it, where the fighters stand.
    for (const y of [0.5, 5, 20]) expect(anyInside(polys, worldToScreen(cam, 10, top + y)), `y ${y}`).toBe(false);
  });

  /** Ruling D11 (Plan 6, Task 33): the 3D stage's depth hides nothing at z = 0 outside the solid. */
  it("is the body's section in the play plane: a lobe just inside the wall is clipped, one just past it shows, as the fighter there does", () => {
    const polys = stageSolidsOnScreen(fd, 0, cam);
    expect(anyInside(polys, worldToScreen(cam, half - 0.5, top - 4))).toBe(true);
    expect(anyInside(polys, worldToScreen(cam, half + 0.5, top - 4))).toBe(false);
  });

  /**
   * The re-review 3's N11: the clip is the 3D side camera's own picture, shake and
   * all. Since Plan 6, Task 33 (ruling D11) it is the picture of the body's section
   * in the sim's plane (z 0): its corners are three.js's projection
   * (`applySideCamera`, as the 3D layer places its camera) of the body's four
   * corners there, from above the floor and from below it.
   */
  it.each([
    ["above the floor, shaken", { x: 10, y: 20, zoom: 14, shakeX: 14, shakeY: -9 }],
    ["below it, shaken the other way", { x: -40, y: -30, zoom: 9, shakeX: -11, shakeY: 12 }],
  ] as const)("is the 3D side camera's picture of the body's section at z = 0, %s", (_, view) => {
    const shaken = { ...createCamera(fd), ...view };
    const three = createSideCamera();
    applySideCamera(three, shaken);
    const project = (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).project(three);
      return { x: ((v.x + 1) / 2) * VIEW_WIDTH, y: ((1 - v.y) / 2) * VIEW_HEIGHT };
    };
    const cx = toFloat(platformCentreX(main, 0));
    const bottom = top - toFloat(HARD_PLATFORM_DEPTH);
    const corners = [cx - half, cx + half].flatMap((x) => [top, bottom].map((y) => project(x, y, 0)));
    const [poly] = stageSolidsOnScreen(fd, 0, shaken);
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
    expect(poly).toHaveLength(4);
    for (const c of corners) expect(poly.some((v) => near(c, v)), `corner ${c.x.toFixed(1)}, ${c.y.toFixed(1)}`).toBe(true);
  });

  it("leaves soft platforms out: they have no body", () => {
    const bf = STAGES.find((s) => s.id === "battlefield")!;
    expect(stageSolidsOnScreen(bf, 0, { ...createCamera(bf), x: 0, y: 20, zoom: 10 }).length).toBe(bf.platforms.filter((p) => !p.soft).length);
  });
});
