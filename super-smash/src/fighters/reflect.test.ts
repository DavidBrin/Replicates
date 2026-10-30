/**
 * Fox's Reflector against real projectiles, through the real `step()` (Plan 5,
 * Task 3). Numbers: SmashWiki "Fox (SSBU)/Down special" — ×1.4 damage, ×1.4
 * speed, reflects frames 4–23, loops while B is held, turns from frame 5,
 * stalls once per airtime; SmashWiki "Reflect" — seven reflections at most.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { MAX_REFLECTIONS } from "@/engine/reflect";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { grabLedge, startAction } from "@/engine/states";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Two fighters on Final Destination facing each other `gap` apart; port 0 on the left. */
function duel(left: string, right: string, gap = 40): GameState {
  const s = createInitialState("finalDestination", [{ defId: left }, { defId: right }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, {
      action: "stand",
      actionFrame: 0,
      grounded: true,
      platform: 0,
      x: fx(i === 0 ? -gap / 2 : gap / 2),
      y: 0,
      facing: i === 0 ? 1 : -1,
      intangible: 0,
    }),
  );
  return s;
}

type Script = (frame: number) => [InputFrame, InputFrame];

function run(s0: GameState, frames: number, script: Script): { state: GameState; events: StepEvents[]; states: GameState[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const events: StepEvents[] = [];
  const states: GameState[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    events.push(out.events);
    states.push(s);
  }
  return { state: s, events, states };
}

describe("Fox's Reflector", () => {
  it("sends Mario's fireball back at him, faster and 1.4× harder", () => {
    // Mario throws on frame 0; Fox raises the reflector as it nears and holds it.
    const { state, events, states } = run(duel("mario", "fox"), 120, (i) => [i === 0 ? Btn.Special : 0, i >= 14 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    expect(reflected).toBeGreaterThan(0);
    expect(events[reflected].reflects[0].port).toBe(1);
    const after = states[reflected].projectiles[0];
    expect(after.owner).toBe(1);
    expect(after.vx).toBeLessThan(0);
    expect(after.reflected).toBe(1);
    // Mario takes the fireball's 5% × 1.4 × 1.2 (one-on-one); Fox takes nothing.
    expect(toFloat(state.fighters[0].damage)).toBeCloseTo(5 * 1.4 * 1.2, 2);
    expect(state.fighters[1].damage).toBe(0);
  });

  it("stays up while B is held and ends 14 frames after it is let go", () => {
    const held = run(duel("mario", "fox", 80), 90, (i) => [0, i < 70 ? Btn.Down | Btn.Special : 0]).states;
    expect(held[60].fighters[1].move).toBe("downB");
    const release = 70;
    const done = held.findIndex((s, i) => i >= release && s.fighters[1].action !== "special");
    expect(done - release).toBeLessThanOrEqual(36 - 23 + 1);
    expect(done - release).toBeGreaterThanOrEqual(13);
  });

  it("turns round when back is held, from frame 5", () => {
    const { state } = run(duel("mario", "fox", 80), 12, (i) => [0, i === 0 ? Btn.Down | Btn.Special : i >= 6 ? Btn.Special | Btn.Right : Btn.Special]);
    expect(state.fighters[1].facing).toBe(1);
  });

  it("stalls a fall once per airtime, and not a second time", () => {
    const s = duel("mario", "fox", 80);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(80), vy: fx(-1.5) });
    const { states } = run(s, 80, (i) => [0, i === 0 || i === 40 ? Btn.Down | Btn.Special : 0]);
    expect(states[2].fighters[1].vy).toBe(0);
    expect(states[42].fighters[1].vy).toBeLessThan(0);
  });

  it("is intangible on frames 2-3", () => {
    const { states } = run(duel("mario", "fox", 80), 4, (i) => [0, i === 0 ? Btn.Down | Btn.Special : 0]);
    expect(states[1].fighters[1].intangible).toBeGreaterThan(0);
    expect(states[3].fighters[1].intangible).toBe(0);
  });
});

describe("whose a reflected projectile is", () => {
  it("is Fox's to hit with, and still Mario's fireball: `source` stays the spawner's", () => {
    const { events, states } = run(duel("mario", "fox"), 60, (i) => [i === 0 ? Btn.Special : 0, i >= 14 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    const after = states[reflected].projectiles[0];
    expect(after.owner).toBe(1);
    // SmashWiki "Reflect": "Reflected projectiles also change ownership from the
    // original user to the reflector". The definition is still Mario's, and the
    // roster context knows "mario", so step() goes on finding it.
    expect(after.source).toBe("mario");
    expect(states[reflected + 1].projectiles[0].x).toBeLessThan(after.x);
  });
});

/**
 * The three new `CombatState` fields on every exit path (Plan 5 dispatch rule).
 * `reflectHold` and `stalling` belong to one special and end with it, however
 * it ends; `specialStall` belongs to one airtime: SmashWiki "Fox (SSBU)"
 * (https://www.ssbwiki.com/Fox_(SSBU)): "he can only do it once until he lands
 * or gets hit".
 */
describe("the Reflector's bookkeeping on every exit path", () => {
  /** Fox two frames into an airborne Reflector, stalling, with a reflection's hold running. */
  function stallingFox(): GameState {
    const s = duel("mario", "fox", 80);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(80), vy: fx(-1.5) });
    const { state } = run(s, 2, () => [0, Btn.Down | Btn.Special]);
    const fox = state.fighters[1];
    expect(fox.action).toBe("special");
    expect(fox.combat.stalling).toBe(true);
    expect(fox.combat.specialStall).toBe(true);
    fox.combat.reflectHold = 7;
    return state;
  }

  it("a KO ends the move's and gives the airtime's stall back", () => {
    const s = stallingFox();
    s.fighters[1].x = fx(1000);
    const fox = step(s, [0, 0], { prevInputs: [0, 0] }).state.fighters[1];
    expect(fox.action).toBe("dead");
    expect(fox.combat.stalling).toBe(false);
    expect(fox.combat.reflectHold).toBe(0);
    expect(fox.combat.specialStall).toBe(false);
  });

  it("a hit gives the airtime's stall back", () => {
    const s = duel("mario", "fox", 40);
    s.fighters[1].combat.specialStall = true;
    const { events, states } = run(s, 60, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const hit = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(hit).toBeGreaterThan(0);
    expect(states[hit - 1].fighters[1].combat.specialStall).toBe(true);
    expect(states[hit].fighters[1].combat.specialStall).toBe(false);
  });

  it("a pummel is a hit too, and gives it back", () => {
    const s = duel("mario", "fox", 12);
    s.fighters[1].combat.specialStall = true;
    const { events, states } = run(s, 60, (i) => [i === 0 ? Btn.Grab : i >= 12 && i % 2 === 0 ? Btn.Attack : 0, 0]);
    const pummel = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(pummel).toBeGreaterThan(0);
    expect(states[pummel - 1].fighters[1].action).toBe("grabbed");
    expect(states[pummel].fighters[1].action).toBe("grabbed");
    expect(states[pummel - 1].fighters[1].combat.specialStall).toBe(true);
    expect(states[pummel].fighters[1].combat.specialStall).toBe(false);
  });

  it("a landing gives the airtime's stall back", () => {
    const s = duel("mario", "fox", 80);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(3), vy: fx(-1.5) });
    s.fighters[1].combat.specialStall = true;
    const { states } = run(s, 20, () => [0, 0]);
    const landed = states.findIndex((q) => q.fighters[1].grounded);
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(states[landed].fighters[1].combat.specialStall).toBe(false);
  });

  it("a ledge gives the airtime's stall back", () => {
    const fox = stallingFox().fighters[1];
    grabLedge(fox, 0, 1, fox.x, fox.y, 0);
    expect(fox.combat.specialStall).toBe(false);
    expect(fox.combat.stalling).toBe(false);
    expect(fox.combat.reflectHold).toBe(0);
  });

  it("being grabbed ends the move's, but not the airtime's stall (UNVERIFIED: as the air dodge)", () => {
    const fox = stallingFox().fighters[1];
    startAction(fox, "grabbed");
    expect(fox.combat.stalling).toBe(false);
    expect(fox.combat.reflectHold).toBe(0);
    expect(fox.combat.specialStall).toBe(true);
  });
});

describe("Review Focus: a reflected projectile reflected again", () => {
  it("bounces between two reflectors, stacking ×1.4 each time, and is gone after seven", () => {
    // Two Foxes, both holding their reflectors; a laser from the right-hand one
    // is already on its way to the left-hand one.
    const s = duel("fox", "fox", 60);
    const laser = findProjectileDef(fox, "blaster")!;
    s.projectiles.push(spawnProjectile(laser, s.fighters[1], 1));
    s.nextProjectileId = 2;
    const both: [InputFrame, InputFrame] = [Btn.Down | Btn.Special, Btn.Down | Btn.Special];
    const { events, states } = run(s, 200, () => both);
    const reflections = events.flatMap((e) => e.reflects);
    expect(reflections.length).toBe(MAX_REFLECTIONS);
    // Each reflection hands it to the other side.
    expect(reflections.map((r) => r.port)).toEqual([0, 1, 0, 1, 0, 1, 0]);
    const second = events.findIndex((_, i) => events.slice(0, i + 1).flatMap((x) => x.reflects).length === 2);
    expect(toFloat(states[second].projectiles[0].chargeScale)).toBeCloseTo(1.96, 2);
    // The eighth touch deletes it rather than reflecting it again, and nobody was hit.
    expect(states[states.length - 1].projectiles).toHaveLength(0);
    expect(states[states.length - 1].fighters.every((f) => f.damage === 0)).toBe(true);
  });
});
