/**
 * Mario's Cape, through the real `step()` (Plan 5, Task 4). SmashWiki "Mario
 * (SSBU)/Side special": reflects frames 9–20 at ×1.5 damage; the hit (7%,
 * angle 110, FKB 80, KBG 100) turns the victim round; the first use in the air
 * stalls ("Vertical speed added 0.3").
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

function duel(gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function run(s0: GameState, frames: number, mario: (i: number) => InputFrame): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now: [InputFrame, InputFrame] = [mario(i), 0];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

describe("Mario's Cape", () => {
  it("turns the opponent it hits round, for 7%", () => {
    const { states } = run(duel(10), 30, (i) => (i === 0 ? Btn.Right | Btn.Special : 0));
    const end = states[states.length - 1].fighters[1];
    expect(end.facing).toBe(1);
    expect(toFloat(end.damage)).toBeCloseTo(7 * 1.05 * 1.2, 2);
  });

  it("sends a laser back at ×1.5, Mario's now", () => {
    // Far enough that the laser arrives inside the reflecting frames (9-20).
    const s = duel(100);
    s.projectiles.push(spawnProjectile(findProjectileDef(fox, "blaster")!, s.fighters[1], 1));
    s.nextProjectileId = 2;
    const { states, events } = run(s, 30, (i) => (i === 0 ? Btn.Right | Btn.Special : 0));
    const at = events.findIndex((e) => e.reflects.length > 0);
    expect(at).toBeGreaterThanOrEqual(8);
    const p = states[at].projectiles[0];
    expect(p.owner).toBe(0);
    expect(toFloat(p.chargeScale)).toBeCloseTo(1.5, 3);
    expect(states[states.length - 1].fighters[0].damage).toBe(0);
  });

  it("stalls a fall the first time in an airtime, and only the first", () => {
    const s = duel(80);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(90), vy: fx(-1.4) });
    const { states } = run(s, 80, (i) => (i === 0 || i === 40 ? Btn.Right | Btn.Special : 0));
    expect(states[0].fighters[0].vy).toBeGreaterThan(0);
    expect(states[40].fighters[0].vy).toBeLessThan(0);
    // Falling at the Cape's own falling speed, not Mario's 1.5, while it lasts.
    expect(Math.min(...states.slice(1, 34).map((x) => x.fighters[0].vy))).toBeGreaterThanOrEqual(-fx(1));
  });
});
