/**
 * What must hold of the whole game state on every frame, across fighters and
 * the stage, whatever the fighters do. The golden checks both rules on every
 * frame of its six matches (`golden.test.ts`), the baked CPU sweep checks the
 * stage's on 56 more (`stageSweep.test.ts`), and `stateInvariants.test.ts`
 * shows each rule flags a crafted state and spares both sides of every
 * boundary (Plan 4 Task 12 re-review, N3).
 *
 * Test support: nothing in the app imports it.
 */

import { toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import type { GameState, StageDef } from "@/engine/types";

/**
 * A ledge is held by one fighter at most. SmashWiki "Ledge" (https://www.ssbwiki.com/Ledge):
 * "Multiple characters cannot hold onto an edge at the same time". A fighter
 * hanging on one is trumped off it by the next grab, and one in a ledge option,
 * which keeps its `ledge` set, has it refused to everybody else (`findLedgeGrab`):
 * so two fighters with the same `ledge` is a rule broken, however it happened
 * (Plan 3 final wave, part 4; the Task 15 review's N4).
 */
export function ledgeInvariantBreaks(s: GameState, frame: number): string[] {
  const out: string[] = [];
  const holder = new Map<string, number>();
  for (const f of s.fighters) {
    if (f.ledge === null) continue;
    const key = `platform ${f.ledge.platform}, side ${f.ledge.side}`;
    const first = holder.get(key);
    if (first === undefined) holder.set(key, f.port);
    else out.push(`frame ${frame}: ports ${first} and ${f.port} both hold the ledge at ${key}`);
  }
  return out;
}

/**
 * No fighter's origin, its feet, is ever strictly inside a hard platform's
 * solid body: within its span, below its surface and above its underside
 * (`HARD_PLATFORM_DEPTH`). The walls, the ceilings and the SDI clamp all keep a
 * body out, and a body that got in, a fighter rising through the underside, is
 * otherwise invisible to the trace (Plan 4, Task 12 fix round 1: the bones' ECB
 * once let an up special rise straight through the stage). Strict at every
 * edge: feet on the surface, at the underside or level with a wall are out.
 */
export function stageInvariantBreaks(s: GameState, stage: StageDef, frame: number): string[] {
  const out: string[] = [];
  for (const f of s.fighters) {
    stage.platforms.forEach((p, i) => {
      if (p.soft) return;
      const inside = Math.abs(f.x - platformCentreX(p, s.frame)) < p.halfWidth && f.y < p.y && f.y > p.y - HARD_PLATFORM_DEPTH;
      if (inside) out.push(`frame ${frame}, port ${f.port}: origin (${toFloat(f.x)}, ${toFloat(f.y)}) inside platform ${i} (${f.action})`);
    });
  }
  return out;
}

/** Both rules: what the golden asks of every frame. */
export function stateInvariantBreaks(s: GameState, stage: StageDef, frame: number): string[] {
  return [...ledgeInvariantBreaks(s, frame), ...stageInvariantBreaks(s, stage, frame)];
}
