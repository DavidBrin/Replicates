/**
 * Where the stage's solid bodies are on screen, for the overlay to keep move
 * effects and projectiles off them (Plan 5, Task 17 fix round 3, ruling R-T17l;
 * the Task 17 re-review 2's V2).
 *
 * The overlay is a canvas of its own over the 3D one, so anything it paints at
 * z = 0 below a platform's top shows in front of the stage's face rather than
 * behind it: Zero Laser's lower fringe and end blast, Mario Finale's flame 8 below
 * the floor. The 3D stage extrudes each solid platform `HARD_PLATFORM_DEPTH` deep
 * and `MAIN_DEPTH_Z` toward and away from the camera (`render3d/stage3d.ts`), but
 * since Plan 6, Task 33 (ruling D11) that depth hides nothing: the stage draws first,
 * writing no depth, and every fighter is drawn over its front face. So the overlay
 * clips out the body's section in the play plane alone, where an effect at z = 0 is
 * inside the solid (`clipOutStage`); past the wall, where the front face only
 * overhangs in perspective, an effect shows in full, as the fighter beside it does.
 * A soft platform has no body.
 *
 * Three-free, like the rest of the overlay (`app/chunkSplit.test.ts`): the 3D
 * stage takes its depth from here.
 */

import { toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import type { StageDef } from "@/engine/types";
import { SIDE_FOV_DEG, VIEW_HEIGHT, VIEW_WIDTH, type Camera } from "./camera";

/** How far a solid platform reaches toward and away from the camera, in units. UNVERIFIED: by eye. */
export const MAIN_DEPTH_Z = 36;

export interface Point {
  x: number;
  y: number;
}

/**
 * Each solid platform's section in the play plane (z = 0), projected through the 3D
 * side camera the overlay is framed with (`render3d/camera3d.ts`: at z = 0 it is
 * `worldToScreen` exactly), as a convex polygon in screen pixels (Plan 6, Task 33).
 */
export function stageSolidsOnScreen(stage: StageDef, stageFrame: number, cam: Pick<Camera, "x" | "y" | "zoom" | "shakeX" | "shakeY">): Point[][] {
  const distance = VIEW_HEIGHT / 2 / (cam.zoom * Math.tan((SIDE_FOV_DEG * Math.PI) / 180 / 2));
  const eyeX = cam.x - cam.shakeX / cam.zoom;
  const eyeY = cam.y + cam.shakeY / cam.zoom;
  const project = (x: number, y: number, z: number): Point => {
    const k = (cam.zoom * distance) / (distance - z);
    return { x: VIEW_WIDTH / 2 + (x - eyeX) * k, y: VIEW_HEIGHT / 2 - (y - eyeY) * k };
  };
  const out: Point[][] = [];
  for (const p of stage.platforms) {
    if (p.soft) continue;
    const cx = toFloat(platformCentreX(p, stageFrame));
    const half = toFloat(p.halfWidth);
    const top = toFloat(p.y);
    const bottom = top - toFloat(HARD_PLATFORM_DEPTH);
    const corners: Point[] = (
      [
        [cx - half, top],
        [cx + half, top],
        [cx + half, bottom],
        [cx - half, bottom],
      ] as const
    ).map(([x, y]) => project(x, y, 0));
    out.push(hull(corners));
  }
  return out;
}

/**
 * Paint `paint` with the stage's solid bodies (`stageSolidsOnScreen`) clipped out:
 * even-odd, the view and then each body, saved and restored round it.
 */
export function paintClearOfStage<T>(ctx: CanvasRenderingContext2D, solids: readonly (readonly Point[])[], paint: () => T): T {
  if (solids.length === 0) return paint();
  ctx.save();
  clipOut(ctx, solids);
  try {
    return paint();
  } finally {
    ctx.restore();
  }
}

function clipOut(ctx: CanvasRenderingContext2D, polys: readonly (readonly Point[])[]): void {
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  for (const poly of polys) {
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }
  ctx.clip("evenodd");
}

/** The convex hull of `points` (Andrew's monotone chain), counter-clockwise. */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
