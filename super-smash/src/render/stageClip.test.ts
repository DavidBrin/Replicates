/**
 * Move effects and projectiles are not painted over the stage's front face
 * (Plan 5, Task 17 fix round 3, ruling R-T17l; the re-review 2's V2).
 */
import { describe, expect, it } from "vitest";
import { toFloat } from "@/engine/fixed";
import { STAGES } from "@/stages";
import { createCamera, worldToScreen } from "./camera";
import { MAIN_DEPTH_Z, stageSolidsOnScreen } from "./stageClip";

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

  it("is the front face's projection: a little wider than the body's middle, so a lobe just past the ledge's middle plane is still behind it; open air past that", () => {
    const polys = stageSolidsOnScreen(fd, 0, cam);
    expect(MAIN_DEPTH_Z).toBe(36);
    expect(anyInside(polys, worldToScreen(cam, half + 0.5, top - 4))).toBe(true);
    expect(anyInside(polys, worldToScreen(cam, half + 30, top - 4))).toBe(false);
  });

  it("leaves soft platforms out: they have no body", () => {
    const bf = STAGES.find((s) => s.id === "battlefield")!;
    expect(stageSolidsOnScreen(bf, 0, { ...createCamera(bf), x: 0, y: 20, zoom: 10 }).length).toBe(bf.platforms.filter((p) => !p.soft).length);
  });
});
