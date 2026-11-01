/**
 * Fox's Reflector against real projectiles, through the real `step()` (Plan 5,
 * Task 3). Numbers:
 * - SmashWiki "Fox (SSBU)/Down special"
 *   (https://www.ssbwiki.com/Fox_(SSBU)/Down_special): ×1.4 damage, ×1.4
 *   speed, lifetime ×1, size 8.5u, damage threshold 50%, intangible 2-3,
 *   reflects 4-23, loop points 3-4 and 23-24, turns from frame 5, a 20-frame
 *   minimum reflection period that a roll, spot dodge or jump cancels,
 *   interruptible 37 (14 from the loop); the stall's ×0.5, 4 frames and 0.027.
 * - UltimateFrameData (https://ultimateframedata.com/fox): "Total 36",
 *   "Invulnerable on frame 2-3 Reflects as early as frame 4".
 * - SmashWiki "Reflector (Fox)" (https://www.ssbwiki.com/Reflector_(Fox)):
 *   "However, it now only stalls Fox once in midair".
 * - SmashWiki "Reflection" (https://www.ssbwiki.com/Reflection): seven
 *   reflections at most; Link's "Remote Bomb (SSBU only)" is reflectable.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, mul, toFloat } from "@/engine/fixed";
import { MAX_REFLECTIONS, activeReflector, reflectProjectiles } from "@/engine/reflect";
import type { ReflectCandidate } from "@/engine/reflect";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, registryContext, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { grabLedge, startAction } from "@/engine/states";
import { Btn, emptyEvents } from "@/engine/types";
import type { FighterDef, GameState, InputFrame, MatchRules, ProjectileDef, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox, mario } from "./index";

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
    // Fox's now, it stales by none of his moves and queues none: neither Fox's queue nor
    // Mario's has the Fireball's move (Plan 5 final wave 2, ruling R-FW2b; UNVERIFIED).
    expect(state.fighters[1].staleQueue).not.toContain("neutralB");
    expect(state.fighters[0].staleQueue).toEqual([]);
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

  it("a pummel is a hit too, and gives it back (held past the edge, so the hold does not)", () => {
    // Mario at the right lip of Final Destination (half-width 79.995), facing
    // out: Fox is held beyond it, in the air, where being held is no landing.
    const s = duel("mario", "fox");
    Object.assign(s.fighters[0], { x: fx(77), facing: 1 });
    Object.assign(s.fighters[1], { x: fx(79.9), facing: -1 });
    s.fighters[1].combat.specialStall = true;
    const { events, states } = run(s, 40, (i) => [i === 0 ? Btn.Grab : i >= 12 && i % 2 === 0 ? Btn.Attack : 0, 0]);
    const pummel = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(pummel).toBeGreaterThan(0);
    const before = states[pummel - 1].fighters[1];
    expect(before).toMatchObject({ action: "grabbed", grounded: false });
    expect(before.combat.specialStall).toBe(true);
    expect(states[pummel].fighters[1].action).toBe("grabbed");
    expect(states[pummel].fighters[1].combat.specialStall).toBe(false);
  });

  it("being held over the ground gives it back, as a landing does (`holdAtCaptor`)", () => {
    const s = duel("mario", "fox", 12);
    s.fighters[1].combat.specialStall = true;
    const { states } = run(s, 20, (i) => [i === 0 ? Btn.Grab : 0, 0]);
    const caught = states.findIndex((q) => q.fighters[1].action === "grabbed");
    expect(caught).toBeGreaterThan(0);
    // The catch lands in phase 6; the hold places Fox on the floor the frame after.
    expect(states[caught].fighters[1].combat.specialStall).toBe(true);
    expect(states[caught + 1].fighters[1]).toMatchObject({ action: "grabbed", grounded: true });
    expect(states[caught + 1].fighters[1].combat.specialStall).toBe(false);
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

  it("being grabbed ends the move's, but not the airtime's stall until held over ground (UNVERIFIED: as the air dodge)", () => {
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

/* -------------------------------------------- Fox's data, as published -- */

const FOX_DOWN_SPECIAL = "https://www.ssbwiki.com/Fox_(SSBU)/Down_special";
const UFD_FOX = "https://ultimateframedata.com/fox";

describe("Fox's Reflector data", () => {
  it(`is the published move (${FOX_DOWN_SPECIAL}; ${UFD_FOX})`, () => {
    expect(fox.moves.downB).toMatchObject({
      // UFD "Total 36"; SmashWiki "Interruptible (from loop) 37 (14)".
      totalFrames: 36,
      // "Intangibility 2-3"; UFD "Invulnerable on frame 2-3".
      intangible: [2, 3],
      reflector: {
        // "Reflection 4-23"; UFD "Reflects as early as frame 4".
        active: [4, 23],
        // "Size 8.5u". UNVERIFIED: the centre, y 6.5 (the 2% box's, script `top`).
        radius: fx(8.5),
        x: 0,
        y: fx(6.5),
        // "Damage multiplier 1.4", "Speed multiplier 1.4", "Lifetime multiplier 1".
        damage: fx(1.4),
        speed: fx(1.4),
        lifetime: fx(1),
        // "Damage threshold 50%".
        maxDamage: fx(50),
        // "Minimum reflection period 20 frames".
        holdAfterReflect: 20,
        // "Loop points 3-4 and 23-24".
        loop: [4, 23],
        // "From frame 5 onward, Fox can also turn around".
        turnFrom: 5,
      },
      // "Horizontal speed multiplier on startup 0.5", "Period before applying
      // gravity 4 frames", "Gravity 0.027".
      stall: { startX: fx(0.5), boostY: 0, noGravityFrames: 4, gravity: fx(0.027) },
    });
  });
});

describe("Fox's Reflector, frame by frame", () => {
  /** `states[i]` is the frame after step i; Fox's B press on step 0 is the move's frame 1. */
  const tap = (frames: number, extra: (i: number) => InputFrame = () => 0) =>
    run(duel("mario", "fox", 80), frames, (i) => [0, (i === 0 ? Btn.Down | Btn.Special : 0) | extra(i)]).states;

  it("lasts its 36 frames when tapped with nothing to reflect (UFD Total 36: release after one pass, not before)", () => {
    const states = tap(40);
    expect(states[35].fighters[1].action).toBe("special");
    expect(states[36].fighters[1].action).toBe("stand");
  });

  it("is intangible on frames 2 and 3 and no other (UFD: 'Invulnerable on frame 2-3')", () => {
    const states = tap(5);
    expect(states.map((s) => s.fighters[1].intangible > 0)).toEqual([false, true, true, false, false]);
  });

  it("reflects from frame 4, not 3 (UFD: 'Reflects as early as frame 4')", () => {
    const states = tap(5);
    expect(activeReflector(states[2].fighters[1], fox)).toBeNull();
    expect(activeReflector(states[3].fighters[1], fox)).toBe(fox.moves.downB?.reflector);
  });

  it("turns round from frame 5, not 4 (SmashWiki: 'From frame 5 onward')", () => {
    // Back (Right, for a Fox facing left) on one frame only: step k is frame k + 1.
    const facingAfter = (k: number) => tap(8, (i) => (i === k ? Btn.Right : 0))[7].fighters[1].facing;
    expect(facingAfter(3)).toBe(-1);
    expect(facingAfter(4)).toBe(1);
  });

  it("loops from frame 23 back to frame 4 while B is held (SmashWiki: 'Loop points 3-4 and 23-24')", () => {
    const states = run(duel("mario", "fox", 80), 30, () => [0, Btn.Down | Btn.Special]).states;
    const restart = states.findIndex((s, i) => i > 0 && s.fighters[1].actionFrame < states[i - 1].fighters[1].actionFrame);
    expect(states[restart - 1].fighters[1].actionFrame).toBe(22); // frame 23
    expect(states[restart].fighters[1].actionFrame).toBe(3); // frame 4
    expect(states[restart].fighters[1].charge).toBe(1);
    expect(activeReflector(states[restart].fighters[1], fox)).not.toBeNull();
  });

  it("stays up 20 frames after a reflection, then ends 13 frames later: 33 in all ('Minimum reflection period 20 frames')", () => {
    // A single tap; the fireball meets the reflector on its first pass, B already up.
    const { events, states } = run(duel("mario", "fox"), 90, (i) => [i === 0 ? Btn.Special : 0, i === 14 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    expect(reflected).toBeGreaterThan(14);
    expect(states[reflected].fighters[1].charge).toBe(0);
    const done = states.findIndex((s, i) => i > reflected && s.fighters[1].action !== "special");
    expect(done - reflected).toBe(33);
  });

  it("sends a projectile back at exactly ×1.4 its speed ('Speed multiplier 1.4')", () => {
    const { events, states } = run(duel("mario", "fox"), 40, (i) => [i === 0 ? Btn.Special : 0, i >= 14 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    const before = states[reflected - 1].projectiles[0];
    const after = states[reflected].projectiles[0];
    expect(after.vx).toBe(-mul(before.vx, fx(1.4)));
  });
});

describe("Fox's Reflector bubble and threshold", () => {
  const FIREBALL = findProjectileDef(mario, "fireball")!;

  /** Fox on frame 6 of the Reflector at x 20; Mario's fireball at `x`, the bubble's height, `damage` strong. */
  function meets(x: number, damage = FIREBALL.hitbox.damage) {
    const s = duel("mario", "fox");
    Object.assign(s.fighters[1], { action: "special", move: "downB", actionFrame: 5 });
    const p = spawnProjectile(FIREBALL, s.fighters[0], 1);
    Object.assign(p, { x, y: fx(6.5) });
    s.projectiles.push(p);
    const c: ReflectCandidate = { projectile: p, hitbox: { radius: FIREBALL.hitbox.radius, damage }, x, y: fx(6.5), prevX: x, prevY: fx(6.5), suppressed: false };
    reflectProjectiles(s, [mario, fox], () => FIREBALL, [c], emptyEvents(), new Set());
    return c.suppressed;
  }

  it("reaches 8.5 units round its centre, plus the projectile's own radius ('Size 8.5u')", () => {
    // Centre x 20; the fireball's radius 2.6: the edge is at 20 − 11.1 = 8.9.
    expect(FIREBALL.hitbox.radius).toBe(fx(2.6));
    expect(meets(fx(8.95))).toBe(true);
    expect(meets(fx(8.85))).toBe(false);
  });

  it("reflects a projectile of exactly 50%, and lets a stronger one through ('Damage threshold 50%')", () => {
    expect(meets(fx(15), fx(50))).toBe(true);
    expect(meets(fx(15), fx(50) + 1)).toBe(false);
  });
});

describe("reflection comes before clanks (Plan 5: `reflectProjectiles` is phase 6a)", () => {
  // Every projectile in the roster is transcendent and never clanks, so this
  // borrows a plain one from a stand-in moveset that only the lookup reads.
  const PELLET: ProjectileDef = {
    id: "pellet",
    spawnFrame: 1,
    offsetX: 0,
    offsetY: 0,
    vx: fx(2),
    vy: 0,
    gravity: 0,
    lifetime: 60,
    destroyOnHit: true,
    visual: "energy",
    reflectable: true,
    hitbox: { id: 0, startFrame: 0, endFrame: 60, x: 0, y: 0, radius: fx(2), damage: fx(5), angle: fx(45), baseKnockback: fx(30), knockbackGrowth: fx(50) },
  };
  const ZONER: FighterDef = { ...mario, id: "zoner", moves: { neutralB: { slot: "neutralB", name: "Pellet", totalFrames: 20, hitboxes: [], projectiles: [PELLET] } } };
  const CTX: SimContext = { ...registryContext, fighter: (id) => (id === "zoner" ? ZONER : registryContext.fighter(id)) };

  /** Mario's pellet and one of Fox's side by side, about to reach Fox's bubble; Fox reflecting or standing. */
  function scene(reflecting: boolean) {
    const s = duel("mario", "fox");
    if (reflecting) Object.assign(s.fighters[1], { action: "special", move: "downB", actionFrame: 5 });
    for (const [id, owner] of [[1, 0], [2, 1]]) {
      const p = spawnProjectile(PELLET, s.fighters[owner], id, "zoner");
      Object.assign(p, { x: fx(9), y: fx(6.5), vx: fx(2), facing: 1, age: 5 });
      s.projectiles.push(p);
    }
    s.nextProjectileId = 3;
    const input: InputFrame = reflecting ? Btn.Down | Btn.Special : 0;
    return step(s, [0, input], { prevInputs: [0, input], ctx: CTX });
  }

  it("the two pellets clank when nothing reflects (the scene's control)", () => {
    const { state, events } = scene(false);
    expect(events.clanks).toHaveLength(1);
    expect(state.projectiles).toHaveLength(0);
  });

  it("a projectile that meets the bubble and a clank on one frame is reflected, and neither clanks", () => {
    const { state, events } = scene(true);
    expect(events.reflects).toHaveLength(1);
    expect(events.clanks).toHaveLength(0);
    expect(state.projectiles.map((p) => [p.instanceId, p.owner])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });
});

describe("the escape out of a reflection (SmashWiki: 'canceled by a roll, spot dodge, or jump during this period')", () => {
  /** A tapped Reflector meets Mario's fireball on its first pass, on the ground; `extra` is pressed on top. */
  const play = (extra: (i: number) => InputFrame) =>
    run(duel("mario", "fox"), 70, (i) => [i === 0 ? Btn.Special : 0, (i === 14 ? Btn.Down | Btn.Special : 0) | extra(i)]);
  /** The frame of the reflection, with nothing else pressed. */
  const reflection = () => play(() => 0).events.findIndex((e) => e.reflects.length > 0);

  it("jumps, rolls or spot dodges out on the frame after the reflection", () => {
    const at = reflection() + 1;
    const after = (b: InputFrame) => play((i) => (i === at ? b : 0)).states[at].fighters[1].action;
    expect(after(Btn.Jump)).toBe("jumpSquat");
    expect(after(Btn.Shield | Btn.Down)).toBe("spotDodge");
    expect(after(Btn.Shield | Btn.Right)).toBe("roll");
    expect(after(Btn.Shield | Btn.Left)).toBe("roll");
    // UNVERIFIED input mapping: a shield press with the stick at rest is no escape.
    expect(after(Btn.Shield)).toBe("special");
  });

  it("can still escape on the 20th frame of the period, and not on the 21st", () => {
    const jumpAt = (at: number) => play((i) => (i === at ? Btn.Jump : 0)).states[at].fighters[1].action;
    expect(jumpAt(reflection() + 20)).toBe("jumpSquat");
    expect(jumpAt(reflection() + 21)).toBe("special");
  });

  it("has no escape without a reflection (UFD Total 36)", () => {
    const states = run(duel("mario", "fox", 80), 14, (i) => [0, i === 0 ? Btn.Down | Btn.Special : i === 10 ? Btn.Jump : i === 12 ? Btn.Shield | Btn.Down : 0]).states;
    expect(states[10].fighters[1].action).toBe("special");
    expect(states[12].fighters[1].action).toBe("special");
  });

  it("has none in the air ('When Fox reflects a projectile on the ground')", () => {
    const { states } = play(() => 0);
    const s = states[reflection()];
    Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(40) });
    const next = step(s, [0, Btn.Jump], { prevInputs: [0, 0] }).state;
    expect(next.fighters[1].action).toBe("special");
  });
});

describe("Fox's Reflector in the air", () => {
  /** Fox falling from high above the stage, `vx` drifting right. */
  function falling(): GameState {
    const s = duel("mario", "fox", 80);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(80), vy: fx(-1.5), vx: fx(0.8) });
    s.fighters[1].kinetic.controlX = fx(0.8);
    return s;
  }

  it("halves the drift on its first frame, holds still 4 frames, then falls by 0.027 a frame", () => {
    const control = run(falling(), 1, () => [0, 0]).states[0].fighters[1];
    const states = run(falling(), 12, () => [0, Btn.Down | Btn.Special]).states;
    // "Horizontal speed multiplier on startup 0.5", on the drift this frame left.
    expect(states[0].fighters[1].vx).toBe(mul(control.vx, fx(0.5)));
    // "Period before applying gravity 4 frames".
    expect(states.slice(0, 4).map((s) => s.fighters[1].vy)).toEqual([0, 0, 0, 0]);
    // "Gravity 0.027".
    for (let i = 4; i < 12; i++) {
      expect(states[i].fighters[1].vy - states[i - 1].fighters[1].vy).toBe(-fx(0.027));
    }
  });

  it("held, does not hover: every later pass keeps falling at the move's gravity (stalls once in midair)", () => {
    const states = run(falling(), 60, () => [0, Btn.Down | Btn.Special]).states;
    const restarts = states.flatMap((s, i) => (i > 0 && s.fighters[1].actionFrame < states[i - 1].fighters[1].actionFrame ? [i] : []));
    expect(restarts.length).toBeGreaterThanOrEqual(2);
    for (let i = 5; i < 60; i++) {
      expect(states[i].fighters[1].vy).toBe(states[i - 1].fighters[1].vy - fx(0.027));
      expect(states[i].fighters[1].y).toBeLessThan(states[i - 1].fighters[1].y);
    }
  });

  it("held long enough, settles at Fox's own falling speed, 2.1 (the stall at its terminal; Task 4 fix round 1)", () => {
    const s = falling();
    s.fighters[1].y = fx(160);
    const states = run(s, 100, () => [0, Btn.Down | Btn.Special]).states;
    expect(states.slice(90).map((x) => [x.fighters[1].action, x.fighters[1].vy])).toEqual(states.slice(90).map(() => ["special", -fx(2.1)]));
  });

  // Plan 5 final wave 2, ruling R-FW2j (Task 4 re-review 1, Minor 3): the move's gravity
  // replaces Fox's from the speed the frame started with, so it reaches his terminal
  // 0.027 at a time. It used to read that speed back from his own fall's, which stops at
  // his terminal: a frame starting within 0.23 (his own gravity) of −2.1 went to −2.1 at
  // once, 0.198 too far at the worst.
  /** Each frame's fall from the 5th on, against the move's own: `vy` less 0.027, never past −2.1. */
  function offTheMovesGravity(s: GameState): string[] {
    const states = run(s, 100, () => [0, Btn.Down | Btn.Special]).states;
    const off: string[] = [];
    for (let i = 5; i < 100; i++) {
      const want = Math.max(-fx(2.1), states[i - 1].fighters[1].vy - fx(0.027));
      if (states[i].fighters[1].vy !== want) off.push(`${i}: ${toFloat(states[i - 1].fighters[1].vy)} -> ${toFloat(states[i].fighters[1].vy)}`);
    }
    expect(states[99].fighters[1].vy).toBe(-fx(2.1));
    return off;
  }

  it("held from high up, falls into Fox's terminal by the move's gravity alone: no one-frame snap within 0.23 of it (ruling R-FW2j)", () => {
    const s = falling();
    s.fighters[1].y = fx(160);
    expect(offTheMovesGravity(s)).toEqual([]);
  });

  // Fast falling, his own fall's step stops at his fast-fall speed instead (3.4), which
  // the move's physics must not mistake for his falling speed (the Task 4 report's
  // surviving "terminal guard ignores fast fall" mutant; ruling R-FW2j).
  it("held while fast falling, falls into the move's terminal by the move's gravity alone too", () => {
    const s = falling();
    Object.assign(s.fighters[1], { y: fx(160), fastFalling: true });
    expect(offTheMovesGravity(s)).toEqual([]);
  });
});

describe("what the Reflector reflects", () => {
  it("sends Link's Remote Bomb back rather than taking its 8.40% (SmashWiki 'Reflection': 'Remote Bomb (SSBU only)')", () => {
    // Link pulls a bomb and throws it on frame 17; Fox holds the Reflector up.
    const { events, states } = run(duel("link", "fox"), 120, (i) => [i === 0 ? Btn.Down | Btn.Special : 0, i >= 14 && i < 60 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    expect(reflected).toBeGreaterThan(0);
    expect(states[reflected].projectiles[0]).toMatchObject({ defId: "remoteBomb", owner: 1, source: "link", reflected: 1 });
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    // Back at Link: the replica's 7% box (UNVERIFIED: see link.ts) × 1.4 × 1.2 one-on-one.
    expect(toFloat(end.fighters[0].damage)).toBeCloseTo(7 * 1.4 * 1.2, 2);
  });

  it("starts a boomerang's flight over: it slows from its reflected speed, turns, and its new owner catches it (UNVERIFIED)", () => {
    // Fox near the right edge so the boomerang turns before the blast zone.
    const s = duel("link", "fox");
    s.fighters[0].x = fx(30);
    s.fighters[1].x = fx(70);
    // The tilt throw, a soft tilt: Right and B together are the smash throw (Plan 5, Task 13d).
    const { events, states } = run(s, 300, (i) => [i === 0 ? Btn.Soft | Btn.Right | Btn.Special : 0, i >= 10 && i < 80 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    expect(reflected).toBeGreaterThan(0);
    const boomerang = (i: number) => states[i].projectiles.find((p) => p.defId === "boomerang");
    expect(boomerang(reflected)).toMatchObject({ owner: 1, age: 0, returning: false });
    // Sent back at its speed when it met the Reflector (×1), it slows 0.047 a frame
    // and turns once it would be under 0.3 (Plan 5, Task 13c: its page's numbers).
    const speed = -boomerang(reflected)!.vx;
    const turn = Math.floor((speed - fx(0.3)) / fx(0.047)) + 1;
    expect(boomerang(reflected + turn - 1)?.vx).toBeLessThan(0);
    expect(boomerang(reflected + turn - 1)?.returning).toBe(false);
    expect(boomerang(reflected + turn)?.vx).toBeGreaterThan(0);
    expect(boomerang(reflected + turn)?.returning).toBe(true);
    // Caught by Fox, not hitting him.
    const gone = states.findIndex((q, i) => i > reflected + turn && boomerang(i) === undefined);
    expect(gone).toBeGreaterThan(reflected + turn);
    expect(Math.abs(toFloat(boomerang(gone - 1)!.x) - 70)).toBeLessThan(12);
    expect(states[gone].fighters[1].damage).toBe(0);
  });
});
