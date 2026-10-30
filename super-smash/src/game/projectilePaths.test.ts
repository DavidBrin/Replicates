/**
 * What the golden counts a projectile's end as (`projectilePaths.ts`), each path
 * shown on a crafted step (Plan 5, Task 13c fix round 1; the review's M4 and R17):
 * a clank this frame is the end only of the projectile that clanked, not of every
 * projectile gone on that frame.
 */

import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState } from "@/engine/simulate";
import type { GameState, ProjectileDef, ProjectileState } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bootstrapEngine } from "./bootstrap";
import { CLANK_REACH, projectilePathsOf } from "./projectilePaths";

bootstrapEngine();

const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
const SAMUS = FIGHTERS.find((f) => f.id === "samus")!;
const SHOT = findProjectileDef(SAMUS, "chargeShot")!;
const BOMB = findProjectileDef(SAMUS, "bomb")!;
const defOf = (p: ProjectileState): ProjectileDef | undefined => findProjectileDef(SAMUS, p.defId);

/** A state with Samus at port 0 and these projectiles. */
function withProjectiles(projectiles: ProjectileState[]): GameState {
  const s = createInitialState(STAGES[0].id, [{ defId: "samus" }, { defId: "link" }], RULES, 1);
  return { ...s, projectiles };
}

/** Samus's Charge Shot `id` at (x, y), `age` frames old. */
function shot(id: number, x: number, y: number, age = 10): ProjectileState {
  const s = createInitialState(STAGES[0].id, [{ defId: "samus" }, { defId: "link" }], RULES, 1);
  return { ...spawnProjectile(SHOT, s.fighters[0], id), x, y, age };
}

describe("a projectile's end, as the golden counts it", () => {
  it("counts a clank as the end only of the projectile that ended at its point, not of one gone elsewhere that frame", () => {
    // Both gone this frame, one clank at (0, 7): the shot beside it clanked; the one
    // 60 away (gone on a hit, say) did not.
    const near = shot(1, fx(1), fx(7));
    const far = shot(2, fx(60), fx(7));
    const out = projectilePathsOf(withProjectiles([near, far]), withProjectiles([]), [{ x: 0, y: fx(7) }], defOf);
    expect(out).toEqual([[1, "clanked"]]);
  });

  it("reaches as far as CLANK_REACH from the clank's point, each way, and no further", () => {
    const at = (dx: number, dy: number) =>
      projectilePathsOf(withProjectiles([shot(1, dx, fx(7) + dy)]), withProjectiles([]), [{ x: 0, y: fx(7) }], defOf);
    expect(at(CLANK_REACH, 0)).toEqual([[1, "clanked"]]);
    expect(at(-CLANK_REACH, CLANK_REACH)).toEqual([[1, "clanked"]]);
    expect(at(CLANK_REACH + 1, 0)).toEqual([]);
    expect(at(0, -CLANK_REACH - 1)).toEqual([]);
  });

  it("counts nothing for a projectile gone before its end with no clank this frame", () => {
    expect(projectilePathsOf(withProjectiles([shot(1, 0, fx(7))]), withProjectiles([]), [], defOf)).toEqual([]);
  });

  it("counts a projectile gone on the last frame of its life as expired, a clank beside it or not", () => {
    const last = shot(1, 0, fx(7), SHOT.lifetime - 1);
    expect(projectilePathsOf(withProjectiles([last]), withProjectiles([]), [{ x: 0, y: fx(7) }], defOf)).toEqual([[1, "expired"]]);
    expect(projectilePathsOf(withProjectiles([last]), withProjectiles([]), [], defOf)).toEqual([[1, "expired"]]);
  });

  it("counts a projectile still here as settled when it rests on a floor, and exploded when its late box is live", () => {
    const s = createInitialState(STAGES[0].id, [{ defId: "samus" }, { defId: "link" }], RULES, 1);
    const resting = { ...spawnProjectile(BOMB, s.fighters[0], 3), ground: 0 };
    expect(projectilePathsOf(withProjectiles([resting]), withProjectiles([resting]), [], defOf)).toEqual([[3, "settled"]]);
    const live = { ...spawnProjectile(BOMB, s.fighters[0], 4), age: BOMB.hitbox.startFrame };
    expect(projectilePathsOf(withProjectiles([live]), withProjectiles([live]), [], defOf)).toEqual([[4, "exploded"]]);
  });
});
