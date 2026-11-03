// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { moveScriptFrame } from "@/engine/acmd/run";
import type { ClockedFighter } from "@/engine/acmd/poseClock";
import { fx, toFloat } from "@/engine/fixed";
import { capsulesOverlap, type Capsule } from "@/engine/hitbox";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { SKELETONS } from "../skeletons";
import { fighterPoser, rootXformOf, sampleAt, statusSamplers } from "./bake";
import { bakeRoster } from "./roster";
import { MESH_CAPPED, STANCE_UP } from "./stance";

/** Standing, at the origin, facing forward: the idle the lift is measured on. */
const STANDING: Omit<ClockedFighter, "defId"> = {
  action: "stand",
  actionFrame: 0,
  move: null,
  port: 0,
  charge: 0,
  hitstun: 0,
  jumpsUsed: 0,
  fastFalling: false,
  vx: 0,
  vy: 0,
  shortHop: false,
};

/** The bake without any lift, and with the committed one (both fresh, as `roster.test.ts` bakes). */
const before = bakeTables(bakeRoster(SKELETONS, {}), "before");
const after = bakeTables(bakeRoster(SKELETONS), "after");

const LEG = /^(knee|leg|foot|toe)/;

/** The lowest point of `def`'s leg hurtboxes over its whole idle cycle, world units. */
function lowestIdleLeg(def: FighterDef, bake: BakeTables): number {
  const boxes = bake.hurtboxes(def.id)!;
  let low = Infinity;
  for (let g = 0; g < bake.clock(def.id, "status_stand")!.frames; g++) {
    localHurtboxes(def, { ...STANDING, defId: def.id }, g, bake)!.forEach((c, i) => {
      if (LEG.test(boxes[i].bone)) low = Math.min(low, toFloat(Math.min(c.y1, c.y2) - c.r));
    });
  }
  return low;
}

describe("the stance lift (Plan 6, Task 19)", () => {
  it("raises each listed fighter's root by its STANCE_UP, and nobody else's", () => {
    for (const def of FIGHTERS) {
      const sample = sampleAt(statusSamplers(def).get("status_stand")!, 1).sample;
      const lifted = rootXformOf(fighterPoser(def, SKELETONS[def.id]), sample).up;
      const flat = rootXformOf(fighterPoser(def, SKELETONS[def.id], 0), sample).up;
      expect(lifted - flat, def.id).toBeCloseTo(STANCE_UP[def.id] ?? 0, 6);
    }
  });

  it("stands a lifted fighter's lowest idle leg hurtbox on the floor, never above it", () => {
    for (const def of FIGHTERS) {
      const was = lowestIdleLeg(def, before);
      const now = lowestIdleLeg(def, after);
      expect(now - was, def.id).toBeCloseTo(STANCE_UP[def.id] ?? 0, 2);
      if (STANCE_UP[def.id] === undefined) continue;
      // Lifted by the hurtboxes' sink, they meet the floor; capped by the mesh's (Kirby), they stay under it.
      if (MESH_CAPPED.has(def.id)) expect(now, def.id).toBeLessThan(0);
      else expect(now, def.id).toBeCloseTo(0, 1);
    }
  });
});

/** Every capsule `def`'s move `slot` hits with on game frame `g`, facing forward from the origin. */
function hitsOn(def: FighterDef, slot: MoveSlot, g: number, bake: BakeTables): Capsule[] {
  const run = moveScriptFrame(def, { move: slot, actionFrame: g - 1 });
  if (run === null) return [];
  return scriptHitboxes(run.state, def.id, run.script.motion, run.gameFrame, bake.bones).map((h) => ({
    x1: h.x,
    y1: h.y,
    x2: h.x2 ?? h.x,
    y2: h.y2 ?? h.y,
    r: h.radius,
  }));
}

/** The gaps (half units, 0-40) at which `slot` hits `target` standing there facing back, on some frame. */
function reached(attacker: FighterDef, slot: MoveSlot, target: FighterDef, bake: BakeTables): Set<number> {
  const def = withLimbScripts(attacker, bake.bones);
  const boxes = Array.from({ length: def.moves[slot]!.totalFrames }, (_, i) => hitsOn(def, slot, i + 1, bake)).flat();
  const hurt = localHurtboxes(target, { ...STANDING, defId: target.id, port: 1 }, 0, bake)!;
  const out = new Set<number>();
  for (let gap = 0; gap <= 80; gap++) {
    const at = fx(gap / 2);
    const placed = hurt.map((c) => ({ ...c, x1: at - c.x1, x2: at - c.x2 }));
    if (boxes.some((b) => placed.some((c) => capsulesOverlap(b, c)))) out.add(gap / 2);
  }
  return out;
}

describe("Review Focus: the stance lift turns no hit into a whiff (Plan 6, Task 19)", () => {
  it("every jab, ftilt, dtilt and dsmash that reached a standing opponent before the lift still does, its farthest reach within half a unit", () => {
    const lost: string[] = [];
    let reaches = 0;
    for (const a of FIGHTERS) {
      for (const slot of ["jab1", "ftilt", "dtilt", "dsmash"] as const) {
        for (const t of FIGHTERS) {
          const was = reached(a, slot, t, before);
          const now = reached(a, slot, t, after);
          reaches += was.size;
          const far = Math.max(...was);
          // The farthest gap alone may go, by one half-unit step: a box's round end moved along the target's.
          for (const gap of was) if (!now.has(gap) && !(gap === far && now.has(far - 0.5))) lost.push(`${a.id} ${slot} on ${t.id} at ${gap}`);
        }
      }
    }
    // Not vacuous: 9,364 (attacker, move, target, gap) reaches at 46e0706.
    expect(reaches).toBeGreaterThan(9_000);
    expect(lost).toEqual([]);
  }, 120_000);
});
