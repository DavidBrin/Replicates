/**
 * What the golden counts a projectile's life as having come to (`golden.test.ts`,
 * `PROJECTILE_PATHS`), from the states either side of each step. Its own module so
 * `projectilePaths.test.ts` can show each path on a crafted step (Plan 5, Task 13c
 * fix round 1; the review's M4: a clank is the end only of the projectile that
 * clanked).
 *
 * Test support: nothing in the app imports it.
 */

import { projectileHitboxActive } from "@/engine/projectile";
import type { GameState, ProjectileDef, ProjectileState } from "@/engine/types";

/**
 * What a projectile's life can come to, each of which some match must reach
 * (Plan 5, Task 13c; the Task 6 carry: no golden match let a projectile reach the
 * end of its life): its end ("expired": gone on the last frame of its life), a
 * rest ("settled": Samus's bomb on the floor), a box that comes out late going
 * live ("exploded": the bomb's, on its timer), and a clank that ended it
 * ("clanked"). The projectile lab reaches all four; a CPU match may too.
 */
export type ProjectilePath = "expired" | "settled" | "exploded" | "clanked";
export const PROJECTILE_PATHS: readonly ProjectilePath[] = ["expired", "settled", "exploded", "clanked"];

/**
 * How near a clank's point a projectile ended for the clank to be its end (Task 13c
 * fix round 1): the point is half way between the two boxes, so within their
 * radii, and the projectile moved this frame; 16 covers both on the roster.
 */
export const CLANK_REACH = 16 * 4096;

/**
 * What became of the projectiles over one step, from the states either side of it
 * (`ProjectilePath`), each as its `instanceId` and the path. A projectile gone on the
 * last frame of its life expired; one gone before it, near a clank's point this
 * frame, clanked (Task 13c fix round 1: only the projectile that clanked).
 */
export function projectilePathsOf(
  before: GameState,
  after: GameState,
  clanks: readonly { x: number; y: number }[],
  defOf: (p: ProjectileState) => ProjectileDef | undefined,
): [number, ProjectilePath][] {
  const out: [number, ProjectilePath][] = [];
  for (const p of before.projectiles) {
    if (after.projectiles.some((q) => q.instanceId === p.instanceId)) continue;
    const def = defOf(p);
    const lastFrame = p.mode === "fly" ? def !== undefined && p.age === def.lifetime - 1 : p.life === 1;
    const nearClank = clanks.some((c) => Math.abs(c.x - p.x) <= CLANK_REACH && Math.abs(c.y - p.y) <= CLANK_REACH);
    if (lastFrame) out.push([p.instanceId, "expired"]);
    else if (nearClank) out.push([p.instanceId, "clanked"]);
  }
  for (const p of after.projectiles) {
    const def = defOf(p);
    if (p.mode === "fly" && p.ground >= 0) out.push([p.instanceId, "settled"]);
    if (def !== undefined && def.hitbox.startFrame > 0 && projectileHitboxActive(p, def)) out.push([p.instanceId, "exploded"]);
  }
  return out;
}
