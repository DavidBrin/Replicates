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

import { ONE, fx, toFloat } from "./fixed";
import { FINAL_SMASH_READY } from "./final";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
import type { FighterAttributes, FighterDef, GameState, Hitbox, InputFrame, MatchRules, MoveDef, StageDef, StepEvents } from "./types";

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
    const s = ready(RULES, ctx);
    // The bystander's shot, still and clear of the floor, its box (8 ahead and 6 up of
    // it, facing left) on the user's body.
    s.projectiles.push({ instanceId: 1, defId: "shot", owner: 2, x: fx(-2), y: fx(4), vx: 0, vy: 0, facing: -1, age: 10, bouncesLeft: 0, chargeScale: ONE, hitPorts: [], returning: false, source: "t", charge: 0, reflected: 0, damageMul: ONE, mode: "fly", life: 0, ground: -1 });
    s.nextProjectileId = 2;
    // Untouchable until the start's own intangibility holds (from its second frame).
    s.fighters[0].intangible = 3;
    const { states, events } = run(s, 90, USE, ctx);
    expect(states.some((st) => st.cinematic === 0)).toBe(true);
    expect(states.every((st) => st.projectiles.length === 1)).toBe(true);
    // Nothing on the scene's frames (the end's first frame, before its own
    // intangibility holds, is open again).
    expect(events.filter((_, i) => states[i].cinematic === 0).flatMap((e) => e.hits).filter((h) => h.attacker === 2)).toEqual([]);
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
    // Port 2 is in a long Final Smash start of its own, with port 3 trapped in it,
    // when port 0 traps port 1: port 0's scene reaches port 1 and not port 3.
    const long = defWith({ ...MOVES, finalSmash: { ...FINAL, totalFrames: 300 } });
    const ctx: SimContext = { fighter: (id) => (id === "u" ? long : DEF), stage: () => STAGE };
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }, { defId: "u" }, { defId: "t" }], RULES, 1, ctx);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, facing: i === 0 ? 1 : -1, intangible: 0, x: [fx(-10), fx(0), fx(80), fx(100)][i], y: 0 }));
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    Object.assign(s.fighters[2], { action: "special", move: "finalSmash", actionFrame: 10 });
    Object.assign(s.fighters[3], { action: "finalTrapped" });
    s.fighters[3].combat.trappedBy = 2;
    const { states } = run(s, 90, (i) => [i === 0 ? Btn.Special : 0, 0, 0, 0], ctx);
    const scene = states.filter((st) => st.cinematic === 0);
    expect(scene.length).toBeGreaterThan(20);
    for (const st of scene) {
      expect(st.fighters[3].action).toBe("finalTrapped");
      expect(st.fighters[3].damage).toBe(0);
    }
    // The scene runs through the end's launch (Task 15), so its last frame has all 21%.
    expect(toFloat(scene[scene.length - 1].fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
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
    const s = ready();
    // The victim jabs the one in standby before they use it.
    const { states } = run(s, 6, (i) => [0, i === 0 ? Btn.Attack : 0, 0]);
    const end = states[states.length - 1];
    expect(end.fighters[0].damage).toBeGreaterThan(0);
    expect(end.fighters[0].finalSmashReady).toBe(0);
    expect(end.smashBall.active).toBe(true);
    expect(Math.abs(end.smashBall.x - end.fighters[0].x)).toBeLessThan(fx(10));
  });

  it("is dropped only by a hit that deals hitstun: a fighter in standby keeps it through the trap and the scene, and drops it at the launch", () => {
    const s = ready();
    s.fighters[1].finalSmashReady = FINAL_SMASH_READY;
    const { states } = run(s, 90, USE);
    // The scene up to the launch, which runs in it since Task 15.
    const scene = states.filter((st) => st.cinematic === 0 && st.fighters[1].action === "finalTrapped");
    expect(scene.length).toBeGreaterThan(0);
    for (const st of scene) expect(st.fighters[1].finalSmashReady).toBe(FINAL_SMASH_READY);
    const end = states[states.length - 1];
    expect(end.fighters[1].finalSmashReady).toBe(0);
    expect(end.smashBall.active).toBe(true);
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

  it("is kept with no time limit, until used (UNVERIFIED: SmashWiki gives the Smash Ball's none)", () => {
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

  it("clanks with nothing at its end: a bystander's jab where the end's box hangs leaves the launch alone", () => {
    // Since Task 15 the scene stands everybody still through the end until its launch,
    // so a bystander can only meet the end's box after it: here a box live on the end's
    // frames 3-8, 100 out, on the stage, where a bystander can stand.
    const ctx: SimContext = { fighter: () => defWith({ ...MOVES, finalEnd: { ...END, hitboxes: [{ ...END.hitboxes[0], x: fx(100), endFrame: 8 }] } }), stage: () => STAGE };
    const straight = run(ready(RULES, ctx), 100, USE, ctx).states;
    // The first frame the launch has ended the scene, with the end's box still to come.
    const free = straight.findIndex((st) => st.fighters[0].move === "finalEnd" && st.cinematic === -1);
    expect(free).toBeGreaterThan(0);
    // The bystander stands where its jab meets that box (the user's at -10, 100 out),
    // and jabs on its first frame out of the scene.
    const s = ready(RULES, ctx);
    Object.assign(s.fighters[2], { x: fx(98), facing: -1 });
    const { states, events } = run(s, 100, (i) => [i === 0 ? Btn.Special : 0, 0, i === free + 1 ? Btn.Attack : 0], ctx);
    // A frame on which the jab's box (its frames 2-3) and the end's (3-8) are both out.
    const met = states.findIndex((st) => {
      const [user, , bystander] = st.fighters;
      return user.move === "finalEnd" && user.actionFrame >= 2 && user.actionFrame <= 7 && bystander.move === "jab1" && bystander.actionFrame >= 1 && bystander.actionFrame <= 2;
    });
    expect(met).toBeGreaterThan(free);
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
