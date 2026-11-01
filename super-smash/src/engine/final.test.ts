/**
 * Final Smashes (Plan 5, Task 14): `final.ts`, on stand-in moves of the shape
 * Task 15's cinematic Final Smashes take.
 *
 * Sources: SmashWiki "Final Smash" (https://www.ssbwiki.com/Final_Smash): "the
 * character's neutral special move is replaced with a single use of their Final
 * Smash"; "If the hitbox created from this action makes contact with an opponent,
 * the game effectively pauses as an unskippable scene plays out"; "Characters on
 * Final Smash standby can also randomly drop it from any hit that deals hitstun".
 * SmashWiki "Smash Ball" (https://www.ssbwiki.com/Smash_Ball): a fighter in
 * standby can be attacked "to make them 'drop' the Smash Ball, at which point it
 * will begin roaming the stage again". SmashWiki "Unblockable attack"
 * (https://www.ssbwiki.com/Unblockable_attack): an unblockable attack "cannot be
 * defended against with a shield or a counterattack", and "in Ultimate, all Final
 * Smashes are unblockable". Every other reading here is marked UNVERIFIED where it
 * is pinned.
 */

import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { smashville } from "@/stages/smashville";
import { frame, momentum, script } from "./acmd/dsl";
import { ONE, fx, toFloat } from "./fixed";
import { FINAL_SMASH_READY, travelWindows } from "./final";
import { hashState } from "./hash";
import { kineticSet } from "./kinetic";
import { platformCentreX } from "./physics";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { stoneOf } from "./stone";
import { Btn } from "./types";
import type { FighterAttributes, FighterDef, GameState, Hitbox, InputFrame, MatchRules, MoveDef, ProjectileState, StageDef, StepEvents } from "./types";

/* ------------------------------------------------------------- fixtures -- */

const ATTRS: FighterAttributes = {
  weight: 100,
  walkSpeed: fx(1.1),
  initialDashSpeed: fx(1.76),
  runSpeed: fx(1.5),
  airSpeed: fx(1.15),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.05),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.08),
  fullHopVelocity: fx(3.1),
  shortHopVelocity: fx(1.7),
  airJumpVelocity: fx(2.85),
  jumps: 2,
  canWallJump: false,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

function box(over: Partial<Hitbox>): Hitbox {
  return { id: 0, startFrame: 1, endFrame: 1, x: fx(8), y: fx(6), radius: fx(6), damage: fx(10), angle: fx(45), baseKnockback: fx(80), knockbackGrowth: fx(100), ...over };
}

/**
 * A three-part cinematic Final Smash: a trap box on frame 5, three 2% scene
 * hits, then a 10% launch — the shape of Jungle Rush, Ultra Sword and the rest.
 * The scene's boxes are 500 units off: they reach the trapped wherever they are.
 */
const FINAL: MoveDef = { slot: "finalSmash", name: "Final", totalFrames: 20, intangible: [1, 20], final: { phase: "start", trap: true, next: "finalAttack" }, hitboxes: [box({ startFrame: 5, endFrame: 6, damage: fx(5), baseKnockback: 0, knockbackGrowth: 0 })] };
const SCENE: MoveDef = {
  slot: "finalAttack",
  name: "Scene",
  totalFrames: 30,
  intangible: [1, 30],
  final: { phase: "attack", next: "finalEnd" },
  hitboxes: [5, 12, 19].map((f, i) => box({ id: i, startFrame: f, endFrame: f, damage: fx(2), x: fx(500) })),
};
const END: MoveDef = { slot: "finalEnd", name: "End", totalFrames: 20, intangible: [1, 20], final: { phase: "end" }, hitboxes: [box({ startFrame: 3, endFrame: 3, x: fx(500), damage: fx(10), baseKnockback: fx(90), knockbackGrowth: fx(96), angle: fx(70) })] };
const JAB: MoveDef = { slot: "jab1", name: "Jab", totalFrames: 10, hitboxes: [box({ startFrame: 2, endFrame: 3 })] };
const SHOT = { id: "shot", spawnFrame: 2, offsetX: 0, offsetY: fx(6), vx: fx(1), vy: 0, gravity: 0, lifetime: 200, visual: "energy" as const, hitbox: box({ startFrame: 0, endFrame: 200, damage: fx(1), radius: fx(1) }) };

/**
 * A counter that catches anything in frames 1-30, then answers with a 1% jab. Its
 * bubble is Marth's (SmashWiki "Marth (SSBU)/Down special": "Counter bubble size
 * 10.5u", "Counter bubble offsets [0, 10, 0]"), so it reaches the trap box.
 */
const COUNTER: MoveDef = {
  slot: "downB",
  name: "Counter",
  totalFrames: 40,
  hitboxes: [],
  counter: { active: [1, 30], radius: fx(10.5), x: 0, y: fx(10), multiplier: fx(1.2), minDamage: fx(1), maxDamage: fx(50), freeze: 5, then: "counterAttack" },
};
const COUNTER_ATTACK: MoveDef = { slot: "counterAttack", name: "Riposte", totalFrames: 20, counterDamage: true, hitboxes: [box({ startFrame: 2, endFrame: 3, damage: fx(1) })] };

const MOVES = {
  finalSmash: FINAL,
  finalAttack: SCENE,
  finalEnd: END,
  jab1: JAB,
  downB: COUNTER,
  counterAttack: COUNTER_ATTACK,
  neutralB: { slot: "neutralB", name: "Shot", totalFrames: 10, hitboxes: [], projectiles: [SHOT] },
  // Armour against any knockback, for a hit that deals no hitstun.
  sideB: { slot: "sideB", name: "Armour", totalFrames: 40, hitboxes: [], heavyArmour: fx(1000) },
};

function defWith(moves: object): FighterDef {
  return { id: "t", name: "T", series: "", number: 0, attributes: ATTRS, moves, palette: {} as FighterDef["palette"], blurb: "" } as unknown as FighterDef;
}

const DEF = defWith(MOVES);

const STAGE: StageDef = {
  id: "s",
  name: "S",
  series: "",
  platforms: [{ x: 0, y: 0, halfWidth: fx(150), soft: false, ledges: true }],
  blastZone: { left: fx(-300), right: fx(300), top: fx(300), bottom: fx(-200) },
  spawns: [{ x: fx(-10), y: 0 }, { x: fx(0), y: 0 }, { x: fx(80), y: 0 }, { x: fx(100), y: 0 }],
  theme: "",
};
const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };
const RULES: MatchRules = { mode: "time", stocks: 3, timeLimit: 60 * 60, smashBall: false, oneOnOne: false };

/** The user (port 0) with the Smash Ball's power, a victim in front, a bystander far off. */
function ready(rules: MatchRules = RULES, ctx: SimContext = CTX): GameState {
  const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }, { defId: "t" }], rules, 1, ctx);
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, facing: i === 0 ? 1 : -1, intangible: 0, x: [fx(-10), fx(0), fx(80)][i], y: 0 }));
  s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
  return s;
}

function run(s0: GameState, frames: number, script: (i: number) => InputFrame[], ctx: SimContext = CTX): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = s.fighters.map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev, ctx });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const USE = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, 0, 0];

/** The bystander's (port 2) shot, still, at (`x`, `y`): its box is 8 ahead of it (facing left) and 6 up. */
function hangingShot(x: number, y: number): ProjectileState {
  return { instanceId: 1, defId: "shot", owner: 2, x, y, vx: 0, vy: 0, facing: -1, age: 10, bouncesLeft: 0, chargeScale: ONE, hitPorts: [], returning: false, source: "t", charge: 0, reflected: 0, damageMul: ONE, mode: "fly", life: 0, ground: -1, staleAs: null, staleDamage: ONE, staleKnockback: ONE };
}

/** For each of `states`, stepped on from `start`: whether its step began with `user`'s scene playing (a paused step, ruling R-T14g). */
function pausedSteps(start: GameState, states: readonly GameState[], user = 0): boolean[] {
  return states.map((_, i) => (i === 0 ? start : states[i - 1]).cinematic === user);
}

/* ---------------------------------------------------------------- tests -- */

describe("a Final Smash", () => {
  it("is what the special button does with the Smash Ball's power, and spends it", () => {
    const { states, events } = run(ready(), 2, USE);
    expect(states[0].fighters[0].move).toBe("finalSmash");
    expect(states[0].fighters[0].finalSmashReady).toBe(0);
    expect(events[0].finalSmashes).toEqual([0]);
  });

  it("traps what its first hit touches, plays its scene with everybody else still, then launches", () => {
    const { states } = run(ready(), 90, USE);
    const trappedAt = states.findIndex((s) => s.fighters[1].action === "finalTrapped");
    expect(trappedAt).toBeGreaterThan(0);
    expect(states[trappedAt].fighters[1].combat.trappedBy).toBe(0);
    const scene = states.filter((s) => s.cinematic === 0);
    expect(scene.length).toBeGreaterThan(20);
    // The bystander does not move a frame while the scene plays...
    const frames = new Set(scene.map((s) => s.fighters[2].actionFrame));
    expect(frames.size).toBe(1);
    // ...and the trapped plays on with its user: its status runs, and each hit's freeze runs out.
    expect(new Set(scene.map((s) => s.fighters[1].actionFrame)).size).toBeGreaterThan(20);
    expect(scene.some((s) => s.fighters[1].hitlag === 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.cinematic).toBe(-1);
    // 5 (trap) + 3 × 2 (scene) + 10 (end), each a fresh move's ×1.05: every
    // box landed once, on the trapped one only.
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
    expect(end.fighters[2].damage).toBe(0);
    expect(end.fighters[1].action).not.toBe("finalTrapped");
    expect(end.fighters[1].combat.trappedBy).toBe(-1);
    expect(end.fighters[1].vy !== 0 || end.fighters[1].vx !== 0 || end.fighters[1].hitstun > 0).toBe(true);
  });

  it("plays the same from a later port than its victim's (port order is no part of it)", () => {
    // Port 2 has the power and traps port 1, ten units in front of it; port 0 is the bystander.
    const s = ready();
    s.fighters[0].finalSmashReady = 0;
    s.fighters[2].finalSmashReady = FINAL_SMASH_READY;
    Object.assign(s.fighters[1], { x: fx(70) });
    Object.assign(s.fighters[0], { x: fx(-60) });
    const { states } = run(s, 90, (i) => [0, 0, i === 0 ? Btn.Special : 0]);
    const scene = states.filter((st) => st.cinematic === 2);
    expect(scene.length).toBeGreaterThan(20);
    expect(new Set(scene.map((st) => st.fighters[0].actionFrame)).size).toBe(1);
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
    expect(end.fighters[0].damage).toBe(0);
    expect(end.fighters[1].action).not.toBe("finalTrapped");
  });

  it("stops the clock and every projectile while the scene plays", () => {
    const s = ready();
    // The bystander fires first; its shot hangs in the air through the scene.
    const { states } = run(s, 60, (i) => [i === 4 ? Btn.Special : 0, 0, i === 0 ? Btn.Special : 0]);
    const scene = states.filter((st) => st.cinematic === 0);
    expect(scene.length).toBeGreaterThan(0);
    expect(new Set(scene.map((st) => st.timeRemaining)).size).toBe(1);
    expect(scene[0].projectiles).toHaveLength(1);
    expect(new Set(scene.map((st) => st.projectiles[0]?.x)).size).toBe(1);
  });

  it("lets no projectile hit while the scene plays: a shot hanging on the user, out of the scene's intangibility, does nothing", () => {
    // A scene the user is not intangible in; its start and end still are.
    const ctx: SimContext = { fighter: () => defWith({ ...MOVES, finalAttack: { ...SCENE, intangible: undefined } }), stage: () => STAGE };
    const straight = run(ready(RULES, ctx), 90, USE, ctx).states;
    // The step the scene starts on ends with `cinematic` set; every step after it,
    // to the one its launch ends it on, is paused (ruling R-T14g).
    const entry = straight.findIndex((st) => st.cinematic === 0);
    expect(entry).toBeGreaterThan(0);
    // Into that state, the bystander's shot, still and clear of the floor, its box
    // (8 ahead and 6 up of it, facing left) on the user's body.
    const s = cloneState(straight[entry]);
    s.projectiles.push(hangingShot(fx(-2), fx(4)));
    s.nextProjectileId += 1;
    expect(s.fighters[0].intangible).toBe(0);
    const { states, events } = run(s, 80, () => [0, 0, 0], ctx);
    const paused = pausedSteps(s, states);
    expect(paused.filter(Boolean).length).toBeGreaterThan(20);
    for (const [i, st] of states.entries()) if (paused[i]) expect(st.projectiles[0].x, `step ${i}`).toBe(fx(-2));
    expect(events.filter((_, i) => paused[i]).flatMap((e) => e.hits).filter((h) => h.attacker === 2)).toEqual([]);
  });

  it("freezes the fighters and the world together: both start on the step after the scene's, and both end after the launch's (ruling R-T14g)", () => {
    // The bystander's shot in flight, the clock, a roaming Smash Ball, the stage clock.
    const s = ready({ ...RULES, smashBall: true });
    Object.assign(s.smashBall, { active: true, x: fx(40), y: fx(80), vx: fx(1), vy: 0, health: fx(40), driftTimer: 1000 });
    const { states } = run(s, 100, (i) => [i === 4 ? Btn.Special : 0, 0, i === 0 ? Btn.Special : 0]);
    const moved = (a: GameState, b: GameState) => ({
      bystander: b.fighters[2].actionFrame !== a.fighters[2].actionFrame,
      shot: b.projectiles[0]?.x !== a.projectiles[0]?.x,
      clock: b.timeRemaining !== a.timeRemaining,
      ball: b.smashBall.x !== a.smashBall.x,
      stage: b.stageFrame !== a.stageFrame,
    });
    const all = { bystander: true, shot: true, clock: true, ball: true, stage: true };
    const none = { bystander: false, shot: false, clock: false, ball: false, stage: false };
    const entry = states.findIndex((st) => st.cinematic === 0);
    const exit = states.findIndex((st, i) => i > entry && st.cinematic === -1);
    expect([entry > 0, exit > entry]).toEqual([true, true]);
    // The scene starts on `entry`: that step still runs the whole world...
    expect(moved(states[entry - 1], states[entry])).toEqual(all);
    // ...and every step after it stands it still, the launch's included...
    for (let i = entry + 1; i <= exit; i++) expect(moved(states[i - 1], states[i]), `step ${i}`).toEqual(none);
    // ...and the step after the launch's runs it all again.
    expect(moved(states[exit], states[exit + 1])).toEqual(all);
  });

  it("stops the Smash Ball too, and a bystander's shield neither wears nor grows", () => {
    const s = ready({ ...RULES, smashBall: true });
    Object.assign(s.smashBall, { active: true, x: fx(40), y: fx(80), vx: fx(1), vy: 0, health: fx(40), driftTimer: 1000 });
    // The bystander raises its shield, worn a little so it would grow back too.
    s.fighters[2].shieldHealth -= fx(10);
    const { states } = run(s, 100, (i) => [i === 0 ? Btn.Special : 0, 0, Btn.Shield]);
    const scene = states.filter((st) => st.cinematic === 0);
    expect(scene.length).toBeGreaterThan(0);
    expect(new Set(scene.map((st) => `${st.smashBall.x},${st.smashBall.y},${st.smashBall.health}`)).size).toBe(1);
    expect(new Set(scene.map((st) => st.fighters[2].shieldHealth)).size).toBe(1);
    // ...and the ball moves again once the scene is over.
    const last = states.map((st) => st.cinematic).lastIndexOf(0);
    expect(states[last + 2].smashBall.x).not.toBe(states[last].smashBall.x);
  });

  it("whiffs when its first hit touches nobody: no scene, nobody trapped", () => {
    const s = ready();
    s.fighters[1].x = fx(120);
    const { states } = run(s, 40, USE);
    expect(states.every((st) => st.cinematic === -1)).toBe(true);
    expect(states.every((st) => st.fighters[1].action !== "finalTrapped")).toBe(true);
    expect(states[states.length - 1].fighters[0].action).toBe("stand");
  });

  it("lets the trapped go when the Final Smash is over without a launch", () => {
    // A scene with no end phase: its last frame lets go of the trapped.
    const ctx: SimContext = { fighter: () => defWith({ ...MOVES, finalAttack: { ...SCENE, final: { phase: "attack" } } }), stage: () => STAGE };
    const { states } = run(ready(RULES, ctx), 90, USE, ctx);
    expect(states.some((st) => st.cinematic === 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.cinematic).toBe(-1);
    expect(end.fighters[1].action).toBe("stand");
    expect(end.fighters[1].combat.trappedBy).toBe(-1);
    // The trap and the scene's three hits, no launch.
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(11 * 1.05, 2);
  });
});

describe("the trapped (Plan 5, Task 14)", () => {
  it("are out of everybody else's reach until the launch (UNVERIFIED: no source says a bystander cannot hit them)", () => {
    const s = ready();
    // The bystander stands beside the victim and jabs it once it is trapped,
    // while the Final Smash's start still plays and nothing is paused.
    Object.assign(s.fighters[2], { x: fx(10), facing: -1 });
    const { states } = run(s, 90, (i) => [i === 0 ? Btn.Special : 0, 0, i === 8 ? Btn.Attack : 0]);
    expect(states[8].fighters[1].action).toBe("finalTrapped");
    expect(states[8].cinematic).toBe(-1);
    expect(states.slice(8, 14).some((st) => st.fighters[2].move === "jab1")).toBe(true);
    expect(toFloat(states[states.length - 1].fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
  });

  it("stay where the trap caught them, even one in the air beside a ledge it would take", () => {
    const hung = (action: "fall" | "finalTrapped"): GameState => {
      const s = ready();
      Object.assign(s.fighters[0], { x: fx(140), action: "special", move: "finalSmash", actionFrame: 8, finalSmashReady: 0 });
      Object.assign(s.fighters[1], { action, x: fx(152), y: fx(-5), grounded: false, platform: -1, facing: -1 });
      s.fighters[1].combat.trappedBy = action === "finalTrapped" ? 0 : -1;
      return s;
    };
    // Falling, it takes the ledge at once...
    expect(run(hung("fall"), 1, () => [0, 0, 0]).states[0].fighters[1].action).toBe("ledgeHang");
    // ...trapped, it stays where it is, off the ground and off the ledge.
    const { states } = run(hung("finalTrapped"), 6, () => [0, 0, 0]);
    for (const st of states) {
      expect(st.fighters[1].action).toBe("finalTrapped");
      expect([st.fighters[1].x, st.fighters[1].y, st.fighters[1].ledge]).toEqual([fx(152), fx(-5), null]);
    }
  });

  it("stop dead where the trap caught them: one dashing into it loses its speed", () => {
    // The victim dashes at the user and is caught on the way.
    const { states } = run(ready(), 40, (i) => [i === 0 ? Btn.Special : 0, i < 3 ? Btn.Left : 0, 0]);
    const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(at).toBeGreaterThan(0);
    expect(states[at - 1].fighters[1].vx).toBeLessThan(0);
    for (const st of states.slice(at)) {
      if (st.fighters[1].action !== "finalTrapped") break;
      expect([st.fighters[1].x, st.fighters[1].vx, st.fighters[1].vy]).toEqual([states[at].fighters[1].x, 0, 0]);
    }
  });

  it("are taken off a ledge they hung from, which locks it out (UNVERIFIED: as a grab does)", () => {
    // A trap box big enough to reach below the ledge.
    const ctx: SimContext = { fighter: () => defWith({ ...MOVES, finalSmash: { ...FINAL, hitboxes: [{ ...FINAL.hitboxes[0], radius: fx(20) }] } }), stage: () => STAGE };
    const s0 = ready(RULES, ctx);
    Object.assign(s0.fighters[0], { x: fx(140) });
    Object.assign(s0.fighters[1], { action: "fall", x: fx(152), y: fx(-5), grounded: false, platform: -1, facing: -1 });
    const hanging = run(s0, 1, () => [0, 0, 0], ctx).states[0];
    expect(hanging.fighters[1].action).toBe("ledgeHang");
    hanging.fighters[1].intangible = 0;
    const { states } = run(hanging, 10, USE, ctx);
    const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[1].ledge).toBeNull();
    expect(states[at].fighters[1].ledgeLockout).toBeGreaterThan(0);
  });

  it("lose a launch still to fire when they are caught (UNVERIFIED: as a grab cancels one)", () => {
    const s = ready();
    // The victim is frozen in a hit's hitlag, its launch parked.
    Object.assign(s.fighters[1], { hitlag: 12, pendingKnockback: fx(60), pendingAngle: fx(45), pendingFacing: -1, hitstun: 30, action: "hitstun" });
    const { states } = run(s, 30, USE);
    const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(at).toBeGreaterThan(0);
    for (const st of states.slice(at)) {
      expect(st.fighters[1].action).toBe("finalTrapped");
      expect([st.fighters[1].vx, st.fighters[1].vy, st.fighters[1].hitstun, st.fighters[1].pendingFacing]).toEqual([0, 0, 0, 0]);
    }
  });

  it("take the trap's freeze and the scene's without SDI (UNVERIFIED: as a held fighter's is undone by its hold)", () => {
    // The victim mashes the stick through the whole Final Smash.
    const mash = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, i >= 5 ? [Btn.Up, Btn.Down, Btn.Left, Btn.Right][i % 4] : 0, 0];
    const { states } = run(ready(), 80, mash);
    const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[1].hitlag).toBeGreaterThan(0);
    for (const st of states.slice(at)) {
      if (st.fighters[1].action !== "finalTrapped") break;
      expect([st.fighters[1].x, st.fighters[1].y]).toEqual([states[at].fighters[1].x, states[at].fighters[1].y]);
    }
  });

  it("are reached by their own user's scene alone, not by another's", () => {
    // One Final Smash at a time (ruling R-T14h), so this is a state play cannot reach:
    // as port 0's scene starts, port 2 is put in a Final Smash of its own with port 3
    // trapped in it. Port 0's scene reaches port 1 and not port 3.
    const s0 = createInitialState("s", [{ defId: "t" }, { defId: "t" }, { defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    s0.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, facing: i === 0 ? 1 : -1, intangible: 0, x: [fx(-10), fx(0), fx(80), fx(100)][i], y: 0 }));
    s0.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const straight = run(s0, 60, (i) => [i === 0 ? Btn.Special : 0, 0, 0, 0]).states;
    const s = cloneState(straight[straight.findIndex((st) => st.cinematic === 0)]);
    Object.assign(s.fighters[2], { action: "special", move: "finalSmash", actionFrame: 10 });
    Object.assign(s.fighters[3], { action: "finalTrapped" });
    s.fighters[3].combat.trappedBy = 2;
    const { states } = run(s, 80, () => [0, 0, 0, 0]);
    const paused = pausedSteps(s, states);
    expect(paused.filter(Boolean).length).toBeGreaterThan(20);
    for (const st of states.filter((_, i) => paused[i])) {
      expect(st.fighters[3].action).toBe("finalTrapped");
      expect(st.fighters[3].damage).toBe(0);
    }
    // The scene runs through the end until its launch (Task 15): port 1 takes all of it.
    expect(toFloat(states[states.length - 1].fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
  });

  it("are let go by a KO, which clears `trappedBy`", () => {
    const { states } = run(ready(), 12, USE);
    const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(at).toBeGreaterThan(0);
    const s = cloneState(states[at]);
    // Out of the trap's freeze (a frozen fighter is not KO'd until it ends) and past the bottom line.
    s.fighters[1].hitlag = 0;
    s.fighters[1].y = fx(-250);
    const after = step(s, [0, 0, 0], { prevInputs: [0, 0, 0], ctx: CTX }).state;
    expect(after.fighters[1].action).toBe("dead");
    expect(after.fighters[1].combat.trappedBy).toBe(-1);
  });
});

describe("a Final Smash meets a fighter who is busy (Plan 5 review)", () => {
  /** Port 2 (the bystander) is moved next to the victim and joined to it. */
  function joined(victim: Partial<GameState["fighters"][number]>, other: Partial<GameState["fighters"][number]>): GameState {
    const s = ready();
    Object.assign(s.fighters[1], victim);
    Object.assign(s.fighters[2], { x: fx(6), facing: -1 }, other);
    return s;
  }

  // The carried rides on the carrier's head (`pinHeldFighters`), above the trap box
  // the others meet, so the user's trap reaches up there for that one.
  const HIGH: SimContext = { fighter: () => defWith({ ...MOVES, finalSmash: { ...FINAL, hitboxes: [{ ...FINAL.hitboxes[0], y: fx(16) }] } }), stage: () => STAGE };
  for (const [name, victim, other, ctx] of [
    ["being grabbed", { action: "grabbed", grabbedBy: 2 }, { action: "grabHold", grabbing: 1 }, CTX],
    ["riding a carrier's shoulders", { action: "cargoHeld", grabbedBy: 2 }, { action: "cargoCarry", grabbing: 1 }, HIGH],
    ["holding a grab", { action: "grabHold", grabbing: 2 }, { action: "grabbed", grabbedBy: 1 }, CTX],
  ] as const) {
    it(`traps a fighter ${name} and lets the other one go`, () => {
      const { states } = run(joined(victim, other), 12, USE, ctx);
      const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
      expect(at).toBeGreaterThan(0);
      // Joined until the trap...
      expect([states[at - 1].fighters[1].grabbedBy, states[at - 1].fighters[1].grabbing]).not.toEqual([-1, -1]);
      // ...and let go by it.
      const [, v, o] = states[at].fighters;
      expect(v.grabbedBy).toBe(-1);
      expect(v.grabbing).toBe(-1);
      expect(o.grabbing).toBe(-1);
      expect(o.grabbedBy).toBe(-1);
    });
  }

  it("is not countered (SmashWiki \"Unblockable attack\"): the counter's victim is trapped like anybody else", () => {
    const { states, events } = run(ready(), 12, (i) => [i === 0 ? Btn.Special : 0, i === 0 ? Btn.Down | Btn.Special : 0, 0]);
    // The counter is out when the trap box reaches it.
    const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(at).toBeGreaterThan(0);
    expect(states[at - 1].fighters[1].move).toBe("downB");
    expect(events.every((e) => e.counters.length === 0)).toBe(true);
  });

  it("is the neutral special in its place: B with the shield held is a shield, and the power is kept", () => {
    const { states } = run(ready(), 2, (i) => [i === 0 ? Btn.Shield | Btn.Special : 0, 0, 0]);
    expect(states[0].fighters[0].action).toBe("shieldStart");
    expect(states[1].fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("needs a Final Smash: a fighter with none does its neutral special, and keeps the power", () => {
    const moves: Record<string, unknown> = { ...MOVES };
    delete moves.finalSmash;
    const ctx: SimContext = { fighter: () => defWith(moves), stage: () => STAGE };
    const { states } = run(ready(RULES, ctx), 2, USE, ctx);
    expect(states[0].fighters[0].move).toBe("neutralB");
    expect(states[1].fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("is a neutral special: B with a direction is that direction's special, and the power is kept", () => {
    const { states } = run(ready(), 2, (i) => [i === 0 ? Btn.Right | Btn.Special : 0, 0, 0]);
    expect(states[0].fighters[0].move).not.toBe("finalSmash");
    expect(states[1].fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("is dropped when its holder is hit: the Smash Ball roams again from where they are (SmashWiki \"Smash Ball\")", () => {
    const s = ready({ ...RULES, smashBall: true });
    // The victim jabs the one in standby before they use it.
    const { states } = run(s, 6, (i) => [0, i === 0 ? Btn.Attack : 0, 0]);
    const end = states[states.length - 1];
    expect(end.fighters[0].damage).toBeGreaterThan(0);
    expect(end.fighters[0].finalSmashReady).toBe(0);
    expect(end.smashBall.active).toBe(true);
    expect(Math.abs(end.smashBall.x - end.fighters[0].x)).toBeLessThan(fx(10));
  });

  it("is kept through somebody else's Final Smash, its launch included (SmashWiki \"Final Smash\": other players on standby \"regain it upon conclusion\")", () => {
    const s = ready({ ...RULES, smashBall: true });
    s.fighters[1].finalSmashReady = FINAL_SMASH_READY;
    const { states } = run(s, 130, USE);
    expect(states.some((st) => st.cinematic === 0)).toBe(true);
    const end = states[states.length - 1];
    // Launched by the end's hitstun, and the user's Final Smash over...
    expect(end.fighters[1].action).not.toBe("finalTrapped");
    expect(end.fighters[0].action).toBe("stand");
    // ...and the power still the victim's: no ball came out.
    for (const st of states) expect(st.fighters[1].finalSmashReady).toBe(FINAL_SMASH_READY);
    expect(states.every((st) => !st.smashBall.active)).toBe(true);
  });

  it("is not used while somebody else's Final Smash is out: B then is the neutral special, and the power is kept", () => {
    const s = ready();
    s.fighters[2].finalSmashReady = FINAL_SMASH_READY;
    // The bystander presses B while the user's start plays, before any trap.
    const { states } = run(s, 4, (i) => [i === 0 ? Btn.Special : 0, 0, i === 2 ? Btn.Special : 0]);
    expect(states[2].fighters[0].move).toBe("finalSmash");
    expect(states[2].fighters[2].move).toBe("neutralB");
    expect(states[3].fighters[2].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("is dropped by a projectile's hit too, if it deals hitstun", () => {
    const s = ready({ ...RULES, smashBall: true });
    // The bystander's shot, on the standby user's body.
    s.projectiles.push(hangingShot(fx(-2), fx(4)));
    s.nextProjectileId = 2;
    const { states } = run(s, 3, () => [0, 0, 0]);
    expect(states[0].fighters[0].hitstun).toBeGreaterThan(0);
    expect(states[0].fighters[0].finalSmashReady).toBe(0);
    expect(states[0].smashBall.active).toBe(true);
  });

  it("is kept through a hit that deals no hitstun: armour takes the damage, and the power stays", () => {
    const s = ready();
    s.fighters[1].finalSmashReady = FINAL_SMASH_READY;
    // The victim armours up (its side special), and the bystander jabs it.
    Object.assign(s.fighters[2], { x: fx(10), facing: -1 });
    const { states } = run(s, 8, (i) => [0, i === 0 ? Btn.Left | Btn.Special : 0, i === 1 ? Btn.Attack : 0]);
    const end = states[states.length - 1];
    expect(end.fighters[1].move).toBe("sideB");
    expect(end.fighters[1].damage).toBeGreaterThan(0);
    expect(end.fighters[1].hitstun).toBe(0);
    expect(end.fighters[1].finalSmashReady).toBe(FINAL_SMASH_READY);
    expect(end.smashBall.active).toBe(false);
  });

  it("is kept with no time limit, until used (SmashWiki \"Smash Ball\": \"unleashed at any time\")", () => {
    const s = ready({ ...RULES, smashBall: true });
    const { states } = run(s, 1_000, () => [0, 0, 0]);
    expect(states[states.length - 1].fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
    // ...and no Smash Ball comes out while somebody holds its power.
    expect(states.every((st) => !st.smashBall.active)).toBe(true);
  });

  it("is kept with no time limit while another Smash Ball roams, too", () => {
    const s = ready({ ...RULES, smashBall: true });
    Object.assign(s.smashBall, { active: true, x: fx(0), y: fx(200), vx: 0, vy: 0, health: fx(40), driftTimer: 1000 });
    const { states } = run(s, 1_000, () => [0, 0, 0]);
    expect(states[states.length - 1].smashBall.active).toBe(true);
    expect(states[states.length - 1].fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("is what breaking the Smash Ball gives (`FINAL_SMASH_READY`)", () => {
    const s = ready({ ...RULES, smashBall: true });
    s.fighters[0].finalSmashReady = 0;
    // A ball one jab from breaking, in front of the bystander.
    Object.assign(s.smashBall, { active: true, x: fx(72), y: fx(6), vx: 0, vy: 0, health: fx(1), driftTimer: 1000 });
    const { states, events } = run(s, 6, (i) => [0, 0, i === 0 ? Btn.Attack : 0]);
    expect(events.some((e) => e.smashBallBroken === 2)).toBe(true);
    expect(states[states.length - 1].fighters[2].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("is lost with a stock (UNVERIFIED: no source says)", () => {
    const s = ready();
    Object.assign(s.fighters[0], { y: fx(-250), grounded: false, platform: -1, action: "fall" });
    const { states } = run(s, 1, () => [0, 0, 0]);
    expect(states[0].fighters[0].action).toBe("dead");
    expect(states[0].fighters[0].finalSmashReady).toBe(0);
  });

  it("clanks with nothing at its end: a bystander's jab meets the end's box, both out on one step, and neither is stopped", () => {
    // The scene stands everybody still through the end until its launch (Task 15), and
    // the launch freezes the user, whose boxes are not out while it is frozen
    // (`gatherHitboxes`). So a bystander meets the end's box only after both: here a box
    // live on the end's frames 3-20, 100 out, on the stage, where a bystander can stand
    // (Task 15 fix round 1, the review's Important 6).
    const ctx: SimContext = { fighter: () => defWith({ ...MOVES, finalEnd: { ...END, hitboxes: [{ ...END.hitboxes[0], x: fx(100), endFrame: 20 }] } }), stage: () => STAGE };
    const straight = run(ready(RULES, ctx), 100, USE, ctx).states;
    // The first step the user, out of its launch's freeze, has the end's box out again.
    const launched = straight.findIndex((st) => st.fighters[0].move === "finalEnd" && st.fighters[1].action !== "finalTrapped");
    const both = straight.findIndex((st, i) => i > launched && straight[i - 1].fighters[0].hitlag === 0 && st.fighters[0].move === "finalEnd" && st.fighters[0].actionFrame >= 2 && st.fighters[0].actionFrame <= 19);
    expect(both).toBeGreaterThan(launched);
    // The bystander stands where its jab meets that box (the user's at -10, 100 out), and
    // jabs on the step before, so its box (the jab's frames 2-3) is out on that step.
    const s = ready(RULES, ctx);
    Object.assign(s.fighters[2], { x: fx(98), facing: -1 });
    const { states, events } = run(s, 100, (i) => [i === 0 ? Btn.Special : 0, 0, i === both - 1 ? Btn.Attack : 0], ctx);
    const [user, , bystander] = states[both].fighters;
    expect([user.move, user.hitlag, states[both - 1].fighters[0].hitlag]).toEqual(["finalEnd", 0, 0]);
    expect([bystander.move, bystander.actionFrame, states[both - 1].fighters[2].hitlag]).toEqual(["jab1", 1, 0]);
    expect(events[both].clanks).toEqual([]);
    expect(events.every((e) => e.clanks.length === 0)).toBe(true);
    expect(states.some((st) => st.fighters[2].action === "rebound")).toBe(false);
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
    expect(end.fighters[1].hitstun > 0 || end.fighters[1].vy !== 0).toBe(true);
  });

  it("does not reach anything but the trapped: a Smash Ball in the scene's boxes is untouched", () => {
    const s = ready();
    // The scene's boxes are 500 out from the user, at -10 facing right.
    Object.assign(s.smashBall, { active: true, x: fx(490), y: fx(6), vx: 0, vy: 0, health: fx(40), driftTimer: 1000 });
    const { states } = run(s, 90, USE);
    expect(states.some((st) => st.cinematic === 0)).toBe(true);
    expect(states[states.length - 1].smashBall.health).toBe(fx(40));
  });
});

describe("the scene holds the match still, its user and the stage included (Task 14 fix round 1)", () => {
  /** Both in the air at `y`, the user with the power. */
  function aloft(y: number): GameState {
    const s = ready();
    for (const f of s.fighters.slice(0, 2)) Object.assign(f, { action: "fall", grounded: false, platform: -1, y });
    return s;
  }

  it("plays an aerial Final Smash's scene out in full: its user hangs where the scene began, and the trapped is launched (ruling R-T14d)", () => {
    const ground = ready();
    const groundStates = run(ground, 140, USE).states;
    const s = aloft(fx(40));
    const { states } = run(s, 140, USE);
    // The paused steps: from the one after the scene's first to its launch's.
    const paused = pausedSteps(s, states);
    const scene = states.filter((_, i) => paused[i]);
    expect(scene.length).toBe(pausedSteps(ground, groundStates).filter(Boolean).length);
    expect(scene.length).toBeGreaterThan(40);
    // The user was still in the air when the scene began, and stays where it began.
    expect(scene[0].fighters[0].grounded).toBe(false);
    expect(new Set(scene.map((st) => `${st.fighters[0].x},${st.fighters[0].y},${st.fighters[0].vx},${st.fighters[0].vy}`)).size).toBe(1);
    // Every part played: the trap, the scene's three hits and the end's launch.
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
    expect(states.some((st, i) => i > 0 && states[i - 1].fighters[1].action === "finalTrapped" && st.fighters[1].hitstun > 0)).toBe(true);
    expect(states.some((st) => st.fighters[0].move === "finalEnd")).toBe(true);
  });

  it("does not land out of a Final Smash: a part it lands in plays on (UNVERIFIED: no source says what a landing does to one)", () => {
    // Just above the floor, with nobody in reach: it lands in the start, which plays on.
    // A start that travels down (a `momentum` window from its first frame), as one held
    // in the air never lands: a Final Smash holds its user there before its first travel
    // (Task 16 fix rounds 2 to 4, rulings R-T16j and R-T16l, amended).
    const dash: SimContext = { fighter: () => defWith({ ...MOVES, finalSmash: { ...FINAL, momentum: [{ frame: 1, x: 0, y: fx(-1), hold: 14 }] } }), stage: () => STAGE };
    const s = aloft(fx(3));
    s.fighters[1].x = fx(120);
    const { states } = run(s, 16, USE, dash);
    const landed = states.findIndex((st) => st.fighters[0].grounded);
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(12);
    for (const st of states.slice(landed, 15)) expect([st.fighters[0].action, st.fighters[0].move]).toEqual(["special", "finalSmash"]);
    const held = run(aloft(fx(3)), 16, USE).states;
    expect(held.every((st) => !st.fighters[0].grounded && st.fighters[0].y === fx(3))).toBe(true);
  });

  /**
   * Plan 5, Task 16 fix round 4 (ruling R-T16l, amended): an aerial Final Smash part holds
   * its user only before its first `momentum` window; from that window's first frame to
   * the move's end the part keeps its normal kinetics, between and after its windows too.
   * SmashWiki "Critical Hit" (https://www.ssbwiki.com/Critical_Hit): "missing with this
   * attack … in the air without any intervening terrain, usually results in a
   * self-destruct". UNVERIFIED: those kinetics (the window's speed handed on to drift,
   * and gravity). A stand-in start, 20 frames, two windows: 2 a frame on 6-8, 1 on 14.
   */
  it("holds an aerial part's user only before its first travel: from it on, the user drifts and falls, between its windows and after them", () => {
    const two: SimContext = { fighter: () => defWith({ ...MOVES, finalSmash: { ...FINAL, momentum: [{ frame: 6, x: fx(2), y: 0, hold: 2 }, { frame: 14, x: fx(1), y: 0, hold: 0 }] } }), stage: () => STAGE };
    const s = aloft(fx(40));
    s.fighters[1].x = fx(120);
    const { states } = run(s, 20, USE, two);
    const at = { x: s.fighters[0].x, y: s.fighters[0].y };
    const inStart = states.filter((st) => st.fighters[0].move === "finalSmash");
    expect(inStart).toHaveLength(20);
    for (const st of inStart.slice(0, 5)) expect([st.fighters[0].x, st.fighters[0].y]).toEqual([at.x, at.y]);
    expect(inStart[5].fighters[0].x - at.x).toBe(fx(2));
    // Between the windows (9-13) and after the last (15-20): never held again.
    for (const k of [...[8, 9, 10, 11, 12], ...[14, 15, 16, 17, 18, 19]]) {
      expect(inStart[k].fighters[0].x, `frame ${k + 1}`).toBeGreaterThan(inStart[k - 1].fighters[0].x);
      expect(inStart[k].fighters[0].y, `frame ${k + 1}`).toBeLessThan(inStart[k - 1].fighters[0].y);
    }
  });

  /**
   * Plan 5, Task 16 fix round 4 (ruling R-T16n): a part's travel is what the engine
   * applies, `moveMomentum`: a script's own `momentum` commands where it has any (it "is
   * taken at its word"), else the move's `MoveDef.momentum` (the legacy move's, which its
   * compiled script carries, or an imported script's, which publishes none). So a dash a
   * script sets is never held unseen.
   */
  it("reads a part's travel from what moveMomentum applies: its script's own momentum, else the move's", () => {
    const moved = { ...FINAL, momentum: [{ frame: 2, x: fx(3), y: 0, hold: 1 }] };
    const own = { ...defWith({ ...MOVES, finalSmash: moved }), scripts: { finalSmash: script("game_final", "final", [frame(6), momentum(2, 0, 4), frame(12), momentum(1, 0)]) } };
    expect(travelWindows(own, "finalSmash")).toEqual([
      [6, 10],
      [12, 12],
    ]);
    const imported = { ...defWith({ ...MOVES, finalSmash: moved }), scripts: { finalSmash: script("game_final", "final", [frame(3)]) } };
    expect(travelWindows(imported, "finalSmash")).toEqual([[2, 3]]);
    expect(travelWindows(defWith({ ...MOVES, finalSmash: moved }), "finalSmash")).toEqual([[2, 3]]);
    expect(travelWindows(DEF, "finalSmash")).toEqual([]);
  });

  it("lets a dash its own script sets travel in the air: held before it, moving from its first frame, never held after", () => {
    const def = { ...DEF, scripts: { finalSmash: script("game_final", "final", [frame(6), momentum(2, 0, 4)]) } };
    const ctx: SimContext = { fighter: () => def, stage: () => STAGE };
    const s = aloft(fx(40));
    s.fighters[1].x = fx(120);
    const { states } = run(s, 20, USE, ctx);
    const at = { x: s.fighters[0].x, y: s.fighters[0].y };
    const inStart = states.filter((st) => st.fighters[0].move === "finalSmash");
    expect(inStart).toHaveLength(20);
    for (const st of inStart.slice(0, 5)) expect([st.fighters[0].x, st.fighters[0].y]).toEqual([at.x, at.y]);
    for (let k = 5; k < 9; k++) expect(inStart[k].fighters[0].x - inStart[k - 1].fighters[0].x, `frame ${k + 1}`).toBe(fx(2));
    for (let k = 10; k < 20; k++) expect(inStart[k].fighters[0].y, `frame ${k + 1}`).toBeLessThan(inStart[k - 1].fighters[0].y);
  });

  it("does not trap Kirby in his Stone, which takes the hit as a stone takes any (SmashWiki \"Stone\")", () => {
    // SmashWiki "Stone" (https://www.ssbwiki.com/Stone), Trivia: "If a cinematic Final
    // Smash is used on Kirby in Stone form, it will not work." Donkey Kong's Jungle
    // Rush (its detection punch, 12%, frames 29-34) on the real Kirby, in Stone from
    // his Down+B pressed on step 10.
    const game: SimContext = { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((st) => st.id === id)! };
    let s = createInitialState("finalDestination", [{ defId: "donkeyKong" }, { defId: "kirby" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 3, game);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? 0 : 22), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    let prev: InputFrame[] = [0, 0];
    const states: GameState[] = [];
    const events: StepEvents[] = [];
    for (let i = 0; i < 60; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, i === 10 ? Btn.Down | Btn.Special : 0];
      const out = step(s, now, { prevInputs: prev, ctx: game });
      s = out.state;
      prev = now;
      states.push(s);
      events.push(out.events);
    }
    // In Stone when the punch comes out...
    expect(stoneOf(states[27].fighters[1], game.fighter("kirby"))).not.toBeNull();
    // ...it lands on the stone (a hit of no damage), and traps nobody: no scene.
    expect(events.flatMap((e) => e.hits).filter((h) => h.attacker === 0)).toEqual([expect.objectContaining({ victim: 1, damage: 0 })]);
    expect(states.every((st) => st.fighters[1].action !== "finalTrapped" && st.cinematic === -1)).toBe(true);
    expect(states[59].fighters[1].damage).toBe(0);
    expect(states[40].fighters[1].combat.stoneTaken).toBeGreaterThan(0);
  });

  it("stands the stage still too: a bystander on Smashville's moving platform rides out a 168-frame scene on it (ruling R-T14f)", () => {
    // A scene of 150 frames and three freezes: 168 paused steps and more.
    const long = defWith({ ...MOVES, finalAttack: { ...SCENE, totalFrames: 150, intangible: [1, 150] } });
    const ctx: SimContext = { fighter: () => long, stage: () => smashville };
    const s = createInitialState("smashville", [{ defId: "t" }, { defId: "t" }, { defId: "t" }], RULES, 1, ctx);
    const deck = smashville.platforms[0];
    const moving = smashville.platforms[1];
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, facing: i === 0 ? 1 : -1, intangible: 0, x: [fx(-30), fx(-20), 0][i], y: deck.y }));
    Object.assign(s.fighters[2], { platform: 1, x: platformCentreX(moving, s.stageFrame), y: moving.y });
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const { states } = run(s, 260, USE, ctx);
    const paused = pausedSteps(s, states);
    expect(paused.filter(Boolean).length).toBeGreaterThanOrEqual(168);
    const at = (st: GameState) => platformCentreX(moving, st.stageFrame);
    const scene = states.filter((_, i) => paused[i]);
    // The platform does not move while the scene plays, nor the bystander on it...
    expect(new Set(scene.map(at)).size).toBe(1);
    expect(new Set(scene.map((st) => st.fighters[2].x)).size).toBe(1);
    // ...and after it, the bystander is still standing on it, carried as it moves again.
    const after = states[paused.lastIndexOf(true) + 10];
    expect([after.fighters[2].grounded, after.fighters[2].platform]).toEqual([true, 1]);
    expect(Math.abs(after.fighters[2].x - at(after))).toBeLessThan(moving.halfWidth);
  });

  it("carries a projectile resting on the moving platform by the stage's clock, which a pause has put behind the match's", () => {
    const ctx: SimContext = { fighter: () => DEF, stage: () => smashville };
    const s = createInitialState("smashville", [{ defId: "t" }, { defId: "t" }, { defId: "t" }], RULES, 1, ctx);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, intangible: 0, x: [fx(-60), fx(-50), fx(-40)][i], y: smashville.platforms[0].y }));
    const moving = smashville.platforms[1];
    // After 200 paused steps, a still shot resting on the platform (`ProjectileState.ground`).
    Object.assign(s, { frame: 300, stageFrame: 100 });
    s.projectiles.push({ ...hangingShot(platformCentreX(moving, 100), moving.y), ground: 1 });
    s.nextProjectileId = 2;
    const { states } = run(s, 40, () => [0, 0, 0], ctx);
    for (const st of states) expect(st.projectiles[0].x - platformCentreX(moving, st.stageFrame)).toBe(0);
    expect(states[39].projectiles[0].x).not.toBe(s.projectiles[0].x);
  });

  it("stands the stage still in a KO's freeze too (UNVERIFIED: the KO freeze read as the whole match paused)", () => {
    const s = ready();
    s.freezeFrames = 5;
    const { states } = run(s, 7, () => [0, 0, 0]);
    expect(states.map((st) => st.frame - st.stageFrame)).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });

  it("keeps an airborne user in its scene beside a ledge it would take: no ledge cuts the scene short", () => {
    const straight = run(aloft(fx(40)), 60, USE).states;
    const entry = straight.findIndex((st) => st.cinematic === 0);
    expect(entry).toBeGreaterThan(0);
    // As the scene starts, the user is put where a fall takes the ledge (see "stay
    // where the trap caught them").
    const s = cloneState(straight[entry]);
    Object.assign(s.fighters[0], { x: fx(152), y: fx(-5), facing: -1 });
    const { states } = run(s, 20, () => [0, 0, 0]);
    for (const st of states) expect([st.fighters[0].action, st.fighters[0].ledge, st.cinematic]).toEqual(["special", null, 0]);
  });

  it("lands a projectile's hit on the step after the launch's, not on it: the world's freeze ends with the fighters' (ruling R-T14g)", () => {
    const straight = run(ready(), 120, USE).states;
    const entry = straight.findIndex((st) => st.cinematic === 0);
    const exit = straight.findIndex((st, i) => i > entry && st.cinematic === -1);
    expect([entry > 0, exit > entry]).toEqual([true, true]);
    // As the scene starts, the victim's shot, still, its box on the stilled bystander
    // (at 80; the box 8 ahead of the shot, facing left, and 6 up).
    const s = cloneState(straight[entry]);
    s.projectiles.push({ ...hangingShot(fx(88), fx(4)), owner: 1 });
    s.nextProjectileId += 1;
    const { events } = run(s, exit - entry + 3, () => [0, 0, 0]);
    const onBystander = events.map((e) => e.hits.filter((h) => h.victim === 2).length);
    // Steps entry+1 .. exit are paused: nothing; the step after exit lands it.
    expect(onBystander.slice(0, exit - entry)).toEqual(new Array(exit - entry).fill(0));
    expect(onBystander[exit - entry]).toBe(1);
  });

  it("takes no ledge in any part of a Final Smash: Pikachu's whiffed Volt Tackle runs past Final Destination's edges (ruling R-T14j; SmashWiki \"Volt Tackle\": \"the tackle ignores edges\")", () => {
    const game: SimContext = { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((st) => st.id === id)! };
    for (const facing of [-1, 1]) {
      let s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 3, game);
      s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : -30 - 20 * facing), y: 0, facing, intangible: 0 }));
      // Mario is behind Pikachu, out of the tackle's way: a whiff.
      s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
      let prev: InputFrame[] = [0, 0];
      let inMove = 0;
      for (let i = 0; i < 120; i++) {
        const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
        s = step(s, now, { prevInputs: prev, ctx: game }).state;
        prev = now;
        const pika = s.fighters[0];
        if (pika.action === "special" && pika.move === "finalSmash") inMove++;
        expect(pika.action, `facing ${facing}, step ${i}`).not.toBe("ledgeHang");
      }
      expect(inMove, `facing ${facing}`).toBeGreaterThan(40);
    }
  });

  it("plays an aerial Final Smash begun beside the edge out in full: its user takes no ledge before the scene (ruling R-T14j, UNVERIFIED for the scene and end parts)", () => {
    // The user falls past the right ledge (150) facing it, in reach of it, and traps a
    // victim above the stage's edge.
    const s = ready();
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(154), y: fx(2), facing: -1 });
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: fx(146), y: fx(2), facing: 1 });
    const { states } = run(s, 110, USE);
    expect(states.every((st) => st.fighters[0].action !== "ledgeHang")).toBe(true);
    expect(pausedSteps(s, states).filter(Boolean).length).toBe(pausedSteps(ready(), run(ready(), 110, USE).states).filter(Boolean).length);
    expect(toFloat(Math.max(...states.map((st) => st.fighters[1].damage)))).toBeCloseTo(21 * 1.05, 2);
    expect(states.some((st, i) => i > 0 && states[i - 1].fighters[1].action === "finalTrapped" && st.fighters[1].hitstun > 0)).toBe(true);
  });

  it("makes its user intangible from the step the power is spent (SmashWiki \"Final Smash\": \"make the user fully intangible\")", () => {
    // The victim's jab is out (its frames 2-3) on the step the user presses B.
    const s = ready();
    Object.assign(s.fighters[1], { action: "attack", move: "jab1", actionFrame: 0, x: fx(-2) });
    const { states, events } = run(s, 3, USE);
    expect(states[0].fighters[0].intangible).toBeGreaterThan(0);
    expect(events[0].hits).toEqual([]);
    expect(states[2].fighters[0].damage).toBe(0);
    expect(states[2].fighters[0].move).toBe("finalSmash");
  });

  // Plan 5 final wave 2, ruling R-FW2a (Task 14 fix round 1's carry): the step a scene
  // starts on still runs the world, so a shot or a bystander can reach the user on it.
  // The user is covered there by the scene part's own window from its first tick, not
  // only by what is left of the start's. The fixture's start ([1, 20], no `nextAt`)
  // hands over as its window ends: on the entry step only the scene's window can hold.
  it("covers its user on the step its scene starts by the scene part's own intangibility: a shot on the user then does nothing (ruling R-FW2a)", () => {
    const straight = run(ready(), 60, USE).states;
    const entry = straight.findIndex((st) => st.cinematic === 0);
    expect(entry).toBeGreaterThan(0);
    expect(straight[entry].fighters[0]).toMatchObject({ move: "finalAttack", actionFrame: 0 });
    expect(straight[entry].fighters[0].intangible).toBeGreaterThan(0);
    // Into the step before it, the bystander's shot, still, its box on the user's body.
    const s = cloneState(straight[entry - 1]);
    s.projectiles.push(hangingShot(fx(-2), fx(4)));
    s.nextProjectileId += 1;
    const { states, events } = run(s, 1, () => [0, 0, 0]);
    expect(states[0].cinematic).toBe(0);
    expect(events[0].hits.filter((h) => h.attacker === 2)).toEqual([]);
    expect(states[0].fighters[0].damage).toBe(straight[entry].fighters[0].damage);
  });

  it("holds an airborne, moving bystander, and one whose attack is out, still through the scene: no move, no hit", () => {
    const s0 = createInitialState("s", [{ defId: "t" }, { defId: "t" }, { defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    s0.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, facing: i === 0 ? 1 : -1, intangible: 0, x: [fx(-10), 0, fx(80), fx(100)][i], y: 0 }));
    s0.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const straight = run(s0, 60, (i) => [i === 0 ? Btn.Special : 0, 0, 0, 0]).states;
    const entry = straight.findIndex((st) => st.cinematic === 0);
    expect(entry).toBeGreaterThan(0);
    // As the scene starts: port 2 falls and drifts just above port 3's jab, whose box
    // (8 ahead of it, 6 up, radius 6) is out on its held frame.
    const s = cloneState(straight[entry]);
    Object.assign(s.fighters[2], { action: "fall", grounded: false, platform: -1, x: fx(92), y: fx(14) });
    kineticSet(s.fighters[2], fx(0.5), fx(-1));
    Object.assign(s.fighters[3], { action: "attack", move: "jab1", actionFrame: 1, x: fx(100), facing: -1 });
    s.fighters[3].hitThisMove.length = 0;
    const { states, events } = run(s, 60, () => [0, 0, 0, 0]);
    const paused = pausedSteps(s, states);
    expect(paused.filter(Boolean).length).toBeGreaterThan(20);
    const scene = states.filter((_, i) => paused[i]);
    for (const port of [2, 3]) {
      expect(new Set(scene.map((st) => { const f = st.fighters[port]; return `${f.x},${f.y},${f.vx},${f.vy},${f.actionFrame}`; })).size, `port ${port}`).toBe(1);
    }
    expect(scene[0].fighters[2].vy).toBeLessThan(0);
    expect(events.filter((_, i) => paused[i]).flatMap((e) => e.hits).filter((h) => h.attacker !== 0)).toEqual([]);
  });
});

/**
 * A box of a trapping start that hits rather than traps (`Hitbox.trap` false; Task 15
 * fix round 1, ruling R-T15j): Ultra Sword's 5% swing after its stun, Volt Tackle's
 * startup sparks. It hits the world as any box does, unblockable and uncountered as
 * every Final Smash box is (SmashWiki "Unblockable attack",
 * https://www.ssbwiki.com/Unblockable_attack: an unblockable attack "cannot be
 * defended against with a shield or a counterattack", and "in Ultimate, all Final
 * Smashes are unblockable"); it reaches its user's trapped wherever they are, for
 * damage only, as the scene's do; and like the scene's it keeps no hit record, so it
 * is one frame long and leaves the start's trap free to catch whom it hit.
 */
describe("a start's ordinary hit (Task 15 fix round 1)", () => {
  const STRIKE = box({ id: 1, startFrame: 3, endFrame: 3, damage: fx(4), angle: fx(45), baseKnockback: fx(60), knockbackGrowth: fx(100), trap: false });
  const withStart = (hitboxes: Hitbox[]): SimContext => ({ fighter: () => defWith({ ...MOVES, finalSmash: { ...FINAL, hitboxes } }), stage: () => STAGE });

  it("hits the world as an ordinary box: the victim reels, and is not trapped", () => {
    const ctx = withStart([STRIKE]);
    const { states } = run(ready(RULES, ctx), 40, USE, ctx);
    expect(toFloat(states[2].fighters[1].damage)).toBeCloseTo(4 * 1.05, 2);
    expect(states.some((st) => st.fighters[1].hitstun > 0)).toBe(true);
    expect(states.every((st) => st.fighters[1].action !== "finalTrapped" && st.cinematic === -1)).toBe(true);
  });

  it("is unblockable: a shield does not stop it", () => {
    const ctx = withStart([{ ...STRIKE, startFrame: 9, endFrame: 9 }]);
    const { states, events } = run(ready(RULES, ctx), 20, (i) => [i === 0 ? Btn.Special : 0, Btn.Shield, 0], ctx);
    expect(states[7].fighters[1].action).toBe("shield");
    expect(toFloat(states[8].fighters[1].damage)).toBeCloseTo(4 * 1.05, 2);
    expect(events.every((e) => e.shieldHits.length === 0)).toBe(true);
  });

  it("is not countered", () => {
    const ctx = withStart([STRIKE]);
    const { states, events } = run(ready(RULES, ctx), 20, (i) => [i === 0 ? Btn.Special : 0, i === 0 ? Btn.Down | Btn.Special : 0, 0], ctx);
    expect(states[1].fighters[1].move).toBe("downB");
    expect(events.every((e) => e.counters.length === 0)).toBe(true);
    expect(toFloat(states[2].fighters[1].damage)).toBeCloseTo(4 * 1.05, 2);
  });

  it("reaches its user's trapped wherever they are, for damage only, and the world as any box does", () => {
    // The trap on 5 catches the victim at 0; the hit on 12 is 90 out, on the bystander at 80.
    const ctx = withStart([...FINAL.hitboxes, { ...STRIKE, startFrame: 12, endFrame: 12, x: fx(90) }]);
    const { states } = run(ready(RULES, ctx), 20, USE, ctx);
    expect(states[10].fighters[1].action).toBe("finalTrapped");
    const at = states.findIndex((st) => st.fighters[2].damage > 0);
    expect(toFloat(states[at].fighters[1].damage)).toBeCloseTo((5 + 4) * 1.05, 2);
    expect(states[at].fighters[1].action).toBe("finalTrapped");
    expect(toFloat(states[at].fighters[2].damage)).toBeCloseTo(4 * 1.05, 2);
    expect(states.slice(at).some((st) => st.fighters[2].hitstun > 0)).toBe(true);
  });

  it("reads no hit record either: a fighter the trap met while invincible takes the ordinary hit after", () => {
    // The trap on 5 lands on an invincible victim and is spent (`applyInvincibleHit`,
    // which records the hit); the ordinary hit on 12, once that is over, still lands.
    const ctx = withStart([...FINAL.hitboxes, { ...STRIKE, startFrame: 12, endFrame: 12 }]);
    const s = ready(RULES, ctx);
    s.fighters[1].invincible = 8;
    const { states } = run(s, 20, USE, ctx);
    expect(states.every((st) => st.fighters[1].action !== "finalTrapped")).toBe(true);
    expect(toFloat(states[19].fighters[1].damage)).toBeCloseTo(4 * 1.05, 2);
  });

  it("keeps no hit record: the trap after it still catches the fighter it hit", () => {
    // A hit that does not move its victim, on 3, then the trap on 5.
    const ctx = withStart([{ ...STRIKE, baseKnockback: 0, knockbackGrowth: 0 }, ...FINAL.hitboxes]);
    const { states } = run(ready(RULES, ctx), 12, USE, ctx);
    expect(toFloat(states[2].fighters[1].damage)).toBeCloseTo(4 * 1.05, 2);
    expect(states.some((st) => st.fighters[1].action === "finalTrapped")).toBe(true);
    expect(toFloat(states[11].fighters[1].damage)).toBeCloseTo((4 + 5) * 1.05, 2);
  });
});

describe("Review Focus: a Final Smash under rollback", () => {
  it("replays the trap, the scene and the launch to the same state after a misprediction on either side of each", () => {
    const truth = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, i === 10 ? Btn.Attack : 0, 0];
    const straight = run(ready(), 100, truth).states;
    const trapAt = straight.findIndex((st) => st.fighters[1].action === "finalTrapped");
    const sceneAt = straight.findIndex((st) => st.cinematic === 0);
    const launchAt = straight.findIndex((st, i) => i > sceneAt && st.fighters[1].action !== "finalTrapped");
    expect([trapAt > 0, sceneAt > trapAt, launchAt > sceneAt, launchAt < 92]).toEqual([true, true, true, true]);
    // Every rollback point, from before the trap to past the launch: predict
    // "nothing pressed" for eight frames, then rewind to the snapshot and
    // re-simulate with the real inputs, as `RollbackSession` does.
    for (const at of [2, trapAt, trapAt + 1, sceneAt - 1, sceneAt, sceneAt + 12, launchAt - 1, launchAt]) {
      let s = straight[at - 1];
      const snapshot = cloneState(s);
      let prev = truth(at - 1);
      for (let i = at; i < at + 8; i++) {
        const guess: InputFrame[] = [0, Btn.Attack, Btn.Special];
        s = step(s, guess, { prevInputs: prev, ctx: CTX }).state;
        prev = guess;
      }
      s = snapshot;
      prev = truth(at - 1);
      for (let i = at; i < 100; i++) {
        s = step(s, truth(i), { prevInputs: prev, ctx: CTX }).state;
        prev = truth(i);
        expect(hashState(s), `rolled back to ${at}, frame ${i}`).toBe(hashState(straight[i]));
      }
    }
  });
});
