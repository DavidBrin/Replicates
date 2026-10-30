/**
 * Projectiles behave as published (Plan 5, Task 13c), driven through `step()`
 * with the real roster and stages: Samus's bomb settles and explodes on its
 * timer, Link's boomerang turns where its page says and steers home, every
 * projectile meets an underside the way it meets a wall, and each clanks by its
 * own script's `Clang_Rebound` and SmashWiki's projectile rules.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fx, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { insideSolidBody, platformCentreX } from "@/engine/physics";
import { findProjectileDef, projectileHitbox, projectileHitboxActive, spawnProjectile } from "@/engine/projectile";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, ProjectileDef, ProjectileState, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const FD = STAGES.find((st) => st.id === "finalDestination")!;

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

const fighterDef = (id: string) => FIGHTERS.find((f) => f.id === id)!;
const projectileDef = (fighter: string, id: string): ProjectileDef => findProjectileDef(fighterDef(fighter), id)!;

/** Two fighters standing on `stage`'s main floor at `x0` and `x1`, facing each other. */
function duel(a: string, b: string, x0: number, x1: number, stage = "finalDestination"): GameState {
  const s = createInitialState(stage, [{ defId: a }, { defId: b }], RULES, 0x13c);
  const place = (f: FighterState, x: number, facing: number) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(x), y: 0, vx: 0, vy: 0, facing, intangible: 0, invincible: 0 });
  place(s.fighters[0], x0, x1 >= x0 ? 1 : -1);
  place(s.fighters[1], x1, x1 >= x0 ? -1 : 1);
  return s;
}

/** `frames` steps of `script`, every state and every step's events. */
function run(s0: GameState, frames: number, script: (i: number) => InputFrame[]): { states: GameState[]; events: StepEvents[] } {
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  let s = s0;
  let prev = script(0).map(() => 0);
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

/**
 * From every snapshot in `at` (−1 is the start), re-simulating the same inputs
 * gives the same states, hash for hash (`inhale.test.ts`'s helper).
 */
function expectRollbackSafe(s0: GameState, frames: number, script: (i: number) => InputFrame[], at: readonly number[]): void {
  const { states } = run(s0, frames, script);
  for (const k of at) {
    let s = cloneState(k < 0 ? s0 : states[k]);
    let prev = k < 0 ? script(0).map(() => 0) : script(k);
    for (let i = k + 1; i < frames; i++) {
      const now = script(i);
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      expect(hashState(s), `snapshot ${k}, step ${i}`).toBe(hashState(states[i]));
    }
  }
}

const one = (s: GameState, id: string): ProjectileState | undefined => s.projectiles.find((p) => p.defId === id);

describe("Samus's bomb settles and explodes on its timer (SmashWiki \"Samus (SSBU)/Down special\")", () => {
  // https://www.ssbwiki.com/Samus_(SSBU)/Down_special: "Bomb generation 11",
  // "Maximum duration before exploding 72 frames", "Explosion ... 83-94, 95-97,
  // 98-100"; "Bomb Y offset 2"; the bomb's "Initial vertical speed 0.5",
  // "Gravity 0.03", "Falling speed 1.2", "Speed multiplier when bouncing off
  // ground 0.6", "Minimum speed to bounce off ground 0.2".
  const DOWN_B = Btn.Down | Btn.Special;
  const BOMB = () => projectileDef("samus", "bomb");

  it("carries the page's numbers", () => {
    expect(BOMB()).toMatchObject({ spawnFrame: 11, offsetY: fx(2), vy: fx(0.5), gravity: fx(0.03), maxFall: fx(1.2), lifetime: 90 });
    expect(BOMB().settle).toEqual({ restitution: fx(0.6), minSpeed: fx(0.2) });
    expect(BOMB().bounces).toBeUndefined();
    expect([BOMB().hitbox.startFrame, BOMB().hitbox.endFrame]).toEqual([72, 89]);
  });

  /** Samus lays a bomb standing at `x` on `stage`'s floor; the bomb's state at each age, from 0. */
  function laid(x: number, stage = "finalDestination", platform = 0, y = 0): (ProjectileState | undefined)[] {
    const s = duel("samus", "mario", x, 70, stage);
    Object.assign(s.fighters[0], { platform, y: fx(y), facing: 1 });
    const { states } = run(s, 105, (i) => [i === 0 ? DOWN_B : 0, 0]);
    const born = states.findIndex((st) => one(st, "bomb") !== undefined);
    expect(born, "laid on frame 11").toBe(10);
    const id = one(states[born], "bomb")!.instanceId;
    return states.slice(born).map((st) => st.projectiles.find((p) => p.instanceId === id));
  }

  it("on Final Destination's floor: hops, bounces at 0.6 while landing at 0.2 or more, goes off at 72 by the floor, and rests", () => {
    const floor = FD.platforms[0].y;
    const life = laid(0);
    // Alive through its whole 90 frames, never under the floor.
    expect(life.slice(0, 90).every((p) => p !== undefined)).toBe(true);
    expect(life[90]).toBeUndefined();
    expect(life.slice(0, 90).every((p) => p!.y >= floor)).toBe(true);
    // Two above Samus, rising at 0.5.
    expect([life[0]!.x, life[0]!.y, life[0]!.vy]).toEqual([fx(1), floor + fx(2), fx(0.5)]);
    // Its landings: each turns its fall round at 0.6 of it, while that fall is 0.2 or more.
    const bounces = life.slice(1, 90).flatMap((p, i) => (p!.y === floor && p!.vy > 0 ? [i + 1] : []));
    expect(bounces).toEqual([37, 61, 75]);
    for (const age of bounces) {
      const landing = fx(0.03) - life[age - 1]!.vy;
      expect(landing, `age ${age}`).toBeGreaterThanOrEqual(fx(0.2));
      expect(life[age]!.vy, `age ${age}`).toBe(Math.trunc((landing * fx(0.6)) / 4096));
    }
    // It rests from its next landing, 83 (landing under 0.2), carried by Final Destination's floor.
    const rest = life.findIndex((p) => p !== undefined && p.ground === 0);
    expect(rest).toBe(83);
    expect(fx(0.03) - life[82]!.vy).toBeLessThan(fx(0.2));
    expect(life.slice(rest, 90).map((p) => [p!.y, p!.vy, p!.mode])).toEqual(life.slice(rest, 90).map(() => [floor, 0, "fly"]));
    // It explodes from 72, on its timer, a hop of under a unit off the floor.
    expect(life.findIndex((p) => p !== undefined && projectileHitboxActive(p, BOMB()))).toBe(72);
    expect(toFloat(life[72]!.y - floor)).toBeLessThan(1);
  });

  it("on a soft platform (Battlefield's left one) it rests on the platform", () => {
    const bf = STAGES.find((st) => st.id === "battlefield")!;
    const i = bf.platforms.findIndex((p) => p.soft);
    const plat = bf.platforms[i];
    const life = laid(toFloat(plat.x), "battlefield", i, toFloat(plat.y));
    expect(life.slice(0, 90).every((p) => p !== undefined && p.y >= plat.y)).toBe(true);
    expect(life[83]).toMatchObject({ y: plat.y, vy: 0, ground: i });
  });

  it("at a platform's edge: inside the span it rests there, past it, it falls by", () => {
    // Final Destination's floor ends at ±80; the bomb leaves one ahead of Samus.
    const inside = laid(78.5);
    expect(inside[83]).toMatchObject({ x: fx(79.5), y: FD.platforms[0].y, ground: 0 });
    const past = laid(79.5);
    expect(past[0]!.x).toBe(fx(80.5));
    expect(toFloat(past[72]!.y)).toBeLessThan(-10);
    expect(past.slice(0, 90).every((p) => p === undefined || p.ground === -1)).toBe(true);
  });

  it("rides Smashville's moving platform while it rests on it (UNVERIFIED: carried, as a fighter is)", () => {
    // Laid on the platform, it hops and the platform slides from under it before it
    // can rest; one at rest on it goes where the platform goes.
    const sv = STAGES.find((st) => st.id === "smashville")!;
    const i = sv.platforms.findIndex((p) => p.motion !== undefined);
    const plat = sv.platforms[i];
    const s = duel("samus", "mario", -60, 60, "smashville");
    const bomb = spawnProjectile(BOMB(), s.fighters[0], s.nextProjectileId);
    Object.assign(bomb, { x: platformCentreX(plat, s.frame), y: plat.y, vy: 0, ground: i, age: 10 });
    s.projectiles.push(bomb);
    s.nextProjectileId += 1;
    const { states } = run(s, 40, () => [0, 0]);
    for (let k = 1; k < 40; k++) {
      const carry = platformCentreX(plat, states[k].frame) - platformCentreX(plat, states[k - 1].frame);
      expect(one(states[k], "bomb")!.x - one(states[k - 1], "bomb")!.x, `step ${k}`).toBe(carry);
      expect(one(states[k], "bomb")!.y).toBe(plat.y);
    }
    expect(one(states[39], "bomb")!.x).not.toBe(one(states[0], "bomb")!.x);
  });

  it("rolls back across its bounces, its rest and its explosion, hash for hash", () => {
    expectRollbackSafe(duel("samus", "mario", 0, 70), 100, (i) => [i === 0 ? DOWN_B : 0, 0], [20, 47, 71, 82, 85, 93]);
  });
});

describe("Link's boomerang turns where its page says, and steers home (SmashWiki \"Link (SSBU)/Side special\")", () => {
  // https://www.ssbwiki.com/Link_(SSBU)/Side_special: "Tilt input hitboxes (clean,
  // late, returning) 27-36, 37-71, 72-151"; "Initial speed 2.4 (tilt)",
  // "Deceleration 0.047", "Minimum speed 0.3", "Maximum returning speed 3", "Angle
  // deviation per frame when returning 0.75°"; the "Returning" row 3.0%, 70°, BK 50,
  // KS 40, radius 3.6; "After clashing with an attack": "Lifetime 60 frames",
  // "Horizontal speed -0.15", "Vertical speed 1.25", "Gravity 0.09", "Falling speed 1.4".
  const SIDE_B = Btn.Right | Btn.Special;
  const BOOMERANG = () => projectileDef("link", "boomerang");

  it("carries the page's numbers", () => {
    expect(BOOMERANG()).toMatchObject({ spawnFrame: 27, vx: fx(2.4), vy: 0, lifetime: 125 });
    expect(BOOMERANG().returns).toEqual({
      deceleration: fx(0.047),
      minSpeed: fx(0.3),
      maxSpeed: fx(3),
      homing: { sin: fx(0.0130896), cos: fx(0.9999143) },
      hit: { damage: fx(3.0), angle: fx(70), baseKnockback: fx(50), knockbackGrowth: fx(40), radius: fx(3.6) },
    });
    expect(BOOMERANG().clash).toEqual({ lifetime: 60, vx: fx(-0.15), vy: fx(1.25), gravity: fx(0.09), maxFall: fx(1.4) });
  });

  /** Link throws it standing at -60 on Final Destination; Mario far off. Its state at each age. */
  function thrown(link: (i: number) => InputFrame = () => 0, frames = 160) {
    const s = duel("link", "mario", -60, 70);
    const { states } = run(s, frames, (i) => [i === 0 ? SIDE_B : link(i), 0]);
    const born = states.findIndex((st) => one(st, "boomerang") !== undefined);
    expect(born, "thrown on frame 27").toBe(26);
    return { states, born, life: states.slice(born).map((st) => one(st, "boomerang")) };
  }

  it("turns on frame 45 of its flight, where its returning hit starts (72 − 27), slowing 0.047 a frame to it", () => {
    const { life } = thrown();
    for (let age = 0; age < 45; age++) {
      expect([life[age]!.returning, life[age]!.vx, life[age]!.vy], `age ${age}`).toEqual([false, fx(2.4) - age * fx(0.047), 0]);
    }
    // 2.4 − 45 × 0.047 is under 0.3: it turns back along its path at 0.3.
    expect([life[45]!.returning, life[45]!.vx, life[45]!.vy]).toEqual([true, -fx(0.3), 0]);
    // Its hit from then is the returning row's.
    expect(projectileHitbox(life[44]!, BOOMERANG()).damage).toBe(fx(8));
    expect(projectileHitbox(life[45]!, BOOMERANG())).toMatchObject({ damage: fx(3), angle: fx(70), baseKnockback: fx(50), knockbackGrowth: fx(40), radius: fx(3.6) });
  });

  it("comes back gaining 0.047 a frame, never past 3, and Link catches it before its life is out", () => {
    const { life } = thrown();
    // Its speed, along its path (it bends a little, down to Link's chest), within a
    // rounding a frame: each frame's speed is the last one's length, truncated.
    const back = life.slice(46).filter((p) => p !== undefined).map((p) => Math.hypot(p!.vx, p!.vy));
    back.slice(0, 5).forEach((v, k) => expect(Math.abs(v - (fx(0.3) + (k + 1) * fx(0.047))), `age ${46 + k}`).toBeLessThanOrEqual(k + 2));
    // Never past 3 (a standing Link catches it at about 2.4: the 3 caps a longer way back).
    expect(Math.max(...back)).toBeLessThanOrEqual(fx(3) + 2);
    // Caught: gone before age 124, its last place within the catch of Link's chest.
    const gone = life.findIndex((p) => p === undefined);
    expect(gone).toBeGreaterThan(46);
    expect(gone).toBeLessThan(124);
    expect(Math.abs(toFloat(life[gone - 1]!.x) + 60)).toBeLessThan(12);
  });

  it("on the way back turns towards Link by at most 0.75° a frame, the shorter way: up after him when he jumps", () => {
    // Link jumps as it turns: it bends up towards him, never more than the page's 0.75°.
    const { life } = thrown((i) => (i === 26 + 46 ? Btn.Jump : 0));
    const sin = 0.0130896 + 2e-3;
    let up = 0;
    for (let age = 47; age < life.length && life[age] !== undefined; age++) {
      const a = life[age - 1]!;
      const b = life[age]!;
      const turn = (a.vx * b.vy - a.vy * b.vx) / (Math.hypot(a.vx, a.vy) * Math.hypot(b.vx, b.vy));
      expect(Math.abs(turn), `age ${age}`).toBeLessThanOrEqual(sin);
      if (b.vy > 0) up += 1;
    }
    expect(up).toBeGreaterThan(0);
  });

  it("rolls back across its turn, hash for hash", () => {
    expectRollbackSafe(duel("link", "mario", -60, 70), 120, (i) => [i === 0 ? SIDE_B : 0, 0], [60, 70, 71, 72, 73, 90]);
  });
});

describe("an underside stops a projectile the way a wall does (SmashWiki \"Wall\": \"All walls will stop projectile attacks\")", () => {
  // Final Destination's underside is 60 below its floor; each projectile rises into it.
  const bottom = FD.platforms[0].y - fx(60);

  /** `def` launched by `fighter` at (x, y), facing right; its states until it is gone or `frames` pass. */
  function fly(fighter: string, id: string, x: number, y: number, vy?: number, frames = 30): ProjectileState[] {
    const def = projectileDef(fighter, id);
    const s = duel(fighter, "kirby", -40, 40);
    Object.assign(s.fighters[0], { grounded: false, platform: -1, action: "fall", x: fx(x), y, facing: 1 });
    const p = spawnProjectile(def, s.fighters[0], s.nextProjectileId);
    if (vy !== undefined) p.vy = vy;
    s.projectiles.push(p);
    s.nextProjectileId += 1;
    const seen: ProjectileState[] = [];
    let state = s;
    for (let i = 0; i < frames; i++) {
      // Hovered, so the owner's own fall is no part of it.
      Object.assign(state.fighters[0], { x: fx(x), y, vx: 0, vy: 0 });
      state = step(state, [0, 0], { prevInputs: [0, 0] }).state;
      const q = state.projectiles.find((r) => r.instanceId === p.instanceId);
      if (q === undefined) break;
      seen.push({ ...q });
    }
    return seen;
  }

  it("F.L.U.D.D.'s water is gone there, as at a wall: it never flies up into the stage", () => {
    // Its spawn (9.7 up) one under the underside, rising at 0.894.
    const seen = fly("mario", "water", -20, bottom - fx(10.7));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => !insideSolidBody(FD, 0, p.x, p.y))).toBe(true);
    expect(seen.length).toBeLessThan(projectileDef("mario", "water").lifetime - 1);
    expect(seen[seen.length - 1].y).toBeLessThan(bottom);
  });

  it("Mario's Fireball and the Thunder Jolt bounce back down off it, as off a wall", () => {
    for (const [fighter, id] of [["mario", "fireball"], ["pikachu", "thunderJolt"]] as const) {
      const def = projectileDef(fighter, id);
      const seen = fly(fighter, id, -20, bottom - def.offsetY - fx(0.1), fx(1));
      const met = seen.findIndex((p) => p.y === bottom);
      expect(met, `${id} meets the underside`).toBeGreaterThanOrEqual(0);
      expect(seen[met].vy, id).toBeLessThan(0);
      expect(seen[met].bouncesLeft, id).toBe((def.bounces ?? 0) - 1);
      expect(seen.every((p) => !insideSolidBody(FD, 0, p.x, p.y)), id).toBe(true);
    }
  });

  it("Samus's bomb stops rising there and falls (UNVERIFIED: stopped, as at a wall)", () => {
    const seen = fly("samus", "bomb", -20, bottom - fx(2.1), undefined, 40);
    const met = seen.findIndex((p) => p.y === bottom);
    expect(met).toBeGreaterThanOrEqual(0);
    expect(seen[met].vy).toBe(0);
    expect(seen[met + 5].y).toBeLessThan(bottom);
    expect(seen.every((p) => !insideSolidBody(FD, 0, p.x, p.y))).toBe(true);
  });

  it("rolls back across an underside stop, hash for hash", () => {
    // A pump and a Fireball rising into it: the pump is gone there on its second
    // frame, the Fireball bounces back down on its first.
    const s = duel("mario", "kirby", -40, 40);
    Object.assign(s.fighters[0], { grounded: false, platform: -1, action: "fall", x: fx(-20), y: bottom - fx(10.7), facing: 1 });
    for (const [id, x, vy] of [["water", -20, undefined], ["fireball", 0, fx(1)]] as const) {
      const p = spawnProjectile(projectileDef("mario", id), s.fighters[0], s.nextProjectileId);
      Object.assign(p, { x: fx(x), y: id === "water" ? bottom - fx(1) : bottom - fx(0.1) }, vy === undefined ? {} : { vy });
      s.projectiles.push(p);
      s.nextProjectileId += 1;
    }
    const { states } = run(s, 12, () => [0, 0]);
    expect(states[1].projectiles.map((p) => p.defId)).toEqual(["fireball"]);
    expect(states[0].projectiles.find((p) => p.defId === "fireball")).toMatchObject({ y: bottom });
    expectRollbackSafe(s, 12, () => [0, 0], [-1, 0, 1, 2, 5]);
  });
});

describe("Link's arrow lodges in the surface it meets (SmashWiki \"Link (SSBU)/Neutral special\")", () => {
  // https://www.ssbwiki.com/Link_(SSBU)/Neutral_special: "Lifetime stuck on a surface (single) 180 frames".
  it("lodges in the floor, harmless, for 180 frames, then is gone", () => {
    expect(projectileDef("link", "arrow").lodge).toBe(180);
    const { states, events } = run(duel("link", "mario", -60, 70), 260, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const arrows = states.map((st) => one(st, "arrow"));
    const lodged = arrows.findIndex((p) => p?.mode === "lodged");
    expect(lodged).toBeGreaterThan(0);
    const at = arrows[lodged]!;
    expect([at.y, at.ground]).toEqual([FD.platforms[0].y, 0]);
    // Lodged on 180 frames, the one it struck the floor on included, and still.
    expect(arrows.slice(lodged, lodged + 180).every((p) => p !== undefined && p.mode === "lodged" && p.x === at.x && p.y === at.y)).toBe(true);
    expect(arrows[lodged + 180]).toBeUndefined();
    expect(arrows.slice(lodged, lodged + 180).every((p) => !projectileHitboxActive(p!, projectileDef("link", "arrow")))).toBe(true);
    expect(events.flatMap((e) => e.hits)).toEqual([]);
  });

  it("lodges in a wall: fired at Final Destination's side from beside it", () => {
    const s = duel("link", "mario", -60, 70);
    Object.assign(s.fighters[0], { grounded: false, platform: -1, action: "fall", x: fx(-100), y: fx(-20), facing: 1 });
    const { states } = run(s, 40, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const lodged = states.map((st) => one(st, "arrow")).find((p) => p?.mode === "lodged");
    expect(lodged).toMatchObject({ x: fx(-80), ground: 0 });
    expect(states.every((st) => st.projectiles.every((p) => !insideSolidBody(FD, st.frame, p.x, p.y)))).toBe(true);
  });
});

describe("projectiles clank by their own script and SmashWiki's rules (\"Priority\", Plan 5 Task 13c)", () => {
  /**
   * Each roster projectile's clang, from its article's script (rubendal SSBU Data
   * Viewer 13.0.1, https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json,
   * `Clang_Rebound`): ON clanks, OFF is transcendent, THRU clanks and goes on.
   */
  const CLANG: readonly [fighter: string, id: string, script: string, clang: "ON" | "OFF" | "THRU"][] = [
    ["mario", "fireball", "mario_fireball Regular", "ON"],
    ["mario", "water", "mario_pumpwater Regular", "OFF"],
    ["fox", "blaster", "fox_blaster_bullet Fly", "OFF"],
    ["samus", "chargeShot", "samus_cshot Shoot", "ON"],
    ["samus", "missile", "samus_missile Homing", "ON"],
    ["samus", "bomb", "samus_bomb Fall, BurstAttack", "ON"],
    ["link", "arrow", "link_bowarrow Fly", "ON"],
    ["link", "boomerang", "link_boomerang Fly, Turn", "ON"],
    ["pikachu", "thunderJolt", "pikachu_dengekidama, pikachu_dengeki Regular", "THRU"],
    ["kirby", "star", "kirby_starmissile Fly", "ON"],
    // No article script: an item (ITEM_KIND_LINKBOMB), with its own HP and "Hit by
    // attack", which this replica does not model. UNVERIFIED: transcendent, so an
    // attack does not end it.
    ["link", "remoteBomb", "(none: an item)", "OFF"],
  ];

  it("lists every roster projectile", () => {
    const launched = FIGHTERS.flatMap((f) => Object.values(f.moves).flatMap((m) => (m?.projectiles ?? []).map((p) => `${f.id} ${p.id}`)));
    expect(new Set(CLANG.map(([f, id]) => `${f} ${id}`))).toEqual(new Set(launched));
  });

  it.each(CLANG)("%s's %s clanks as %s says: %s", (fighter, id, _script, clang) => {
    const hb = projectileDef(fighter, id).hitbox;
    expect([hb.transcendent === true, hb.noRebound === true]).toEqual([clang === "OFF", clang === "THRU"]);
    const back = projectileDef(fighter, id).returns?.hit;
    if (back !== undefined) expect(Object.keys(back)).not.toContain("transcendent");
  });

  /** Put a projectile of `fighter`'s `id`, owned by port `owner`, at (x, y) moving (vx, vy). */
  function launch(s: GameState, owner: number, fighter: string, id: string, x: number, y: number, vx: number, vy = 0, charge = 0): ProjectileState {
    const p = spawnProjectile(projectileDef(fighter, id), { ...s.fighters[owner], charge } as FighterState, s.nextProjectileId, fighter, id === "chargeShot" ? 112 : undefined);
    Object.assign(p, { x: fx(x), y: FD.platforms[0].y + fx(y), vx: fx(vx), vy: fx(vy), facing: vx < 0 ? -1 : 1 });
    s.projectiles.push(p);
    s.nextProjectileId += 1;
    return p;
  }

  /**
   * The first timing of `fighter`'s press (step 0 to 30) whose attack clanks with the
   * projectile `place` puts in the state: that run, from the press on.
   */
  function clankWith(setup: () => GameState, press: InputFrame, frames = 40) {
    for (let k = 0; k <= 30; k++) {
      const { states, events } = run(setup(), frames, (i) => [0, i === k ? press : 0]);
      const at = events.findIndex((e) => e.clanks.length > 0);
      if (at >= 0) return { k, at, states, events };
    }
    throw new Error("no timing clanked");
  }

  /** Samus (port 0, far left, the owner) and `defender` (port 1) standing at 0 facing left. */
  const field = (defender: string) => duel("samus", defender, -70, 0);

  it("within 9%: a Fireball (5%) and Fox's jab (1.8%) both lose: the Fireball is gone, Fox rebounds", () => {
    const { at, states } = clankWith(() => {
      const s = field("fox");
      launch(s, 0, "mario", "fireball", -16, 9.3, 1.9);
      return s;
    }, Btn.Attack);
    expect(states[at].projectiles).toEqual([]);
    expect([states[at].fighters[1].action, states[at].fighters[1].move]).toEqual(["stand", null]);
  });

  it("more than 9% stronger: Marth's forward smash (18%) beats a Fireball: the Fireball is gone, Marth swings on", () => {
    const { at, states } = clankWith(() => {
      const s = field("marth");
      launch(s, 0, "mario", "fireball", -50, 7.5, 1.9);
      return s;
    }, Btn.Left | Btn.Attack);
    expect(states[at].projectiles).toEqual([]);
    expect([states[at].fighters[1].action, states[at].fighters[1].move]).toEqual(["attack", "fsmash"]);
  });

  it("a projectile more than 9% stronger: a full Charge Shot (28%) beats Fox's jab: Fox rebounds, the shot flies on and hits him", () => {
    const { at, states, events } = clankWith(() => {
      const s = field("fox");
      launch(s, 0, "samus", "chargeShot", -60, 9.3, 3.3, 0, 112);
      return s;
    }, Btn.Attack);
    expect(states[at].projectiles.map((p) => p.defId)).toEqual(["chargeShot"]);
    expect([states[at].fighters[1].action, states[at].fighters[1].move]).toEqual(["stand", null]);
    const hit = events.findIndex((e) => e.hits.some((h) => h.attacker === 0 && h.victim === 1));
    expect(hit).toBeGreaterThan(at);
  });

  it("projectile against projectile: a Fireball and Link's arrow (5% and 4%) are both gone; a full Charge Shot (28%) flies on through a Fireball", () => {
    const s = duel("mario", "link", -70, 70);
    launch(s, 0, "mario", "fireball", -4, 9, 1.9);
    launch(s, 1, "link", "arrow", 4, 9, -2.6);
    const a = run(s, 3, () => [0, 0]);
    expect(a.events.some((e) => e.clanks.length > 0)).toBe(true);
    expect(a.states[2].projectiles).toEqual([]);

    const t = duel("mario", "samus", -70, 70);
    launch(t, 0, "mario", "fireball", -4, 9, 1.9);
    launch(t, 1, "samus", "chargeShot", 6, 9, -3.3, 0, 112);
    const b = run(t, 3, () => [0, 0]);
    expect(b.events.some((e) => e.clanks.length > 0)).toBe(true);
    expect(b.states[2].projectiles.map((p) => p.defId)).toEqual(["chargeShot"]);
  });

  it("an aerial goes on through a projectile it clanks with: Fox's neutral air takes a Fireball out, and is not cancelled", () => {
    // Fox jumps, and neutral-airs at the Fireball coming at him: the first timing that clanks.
    let found: { at: number; states: GameState[] } | null = null;
    for (let k = 4; k <= 30 && found === null; k++) {
      const s = field("fox");
      launch(s, 0, "mario", "fireball", -30, 20, 1.9);
      const { states, events } = run(s, 40, (i) => [0, i === 0 ? Btn.Jump : i === k ? Btn.Attack : 0]);
      const at = events.findIndex((e) => e.clanks.length > 0);
      if (at >= 0) found = { at, states };
    }
    expect(found).not.toBeNull();
    const { at, states } = found!;
    expect(states[at].fighters[1].grounded).toBe(false);
    expect(states[at].projectiles).toEqual([]);
    expect([states[at].fighters[1].action, states[at].fighters[1].move]).toEqual(["attack", "nair"]);
  });

  it("the Thunder Jolt (THRU) clanks and goes on: Fox's jab rebounds, and the Jolt never hits him after", () => {
    const { at, states, events } = clankWith(() => {
      const s = duel("pikachu", "fox", -70, 0);
      launch(s, 0, "pikachu", "thunderJolt", -16, 9.3, 1.6);
      return s;
    }, Btn.Attack);
    expect(states[at].projectiles.map((p) => [p.defId, p.hitPorts])).toEqual([["thunderJolt", [1]]]);
    expect([states[at].fighters[1].action, states[at].fighters[1].move]).toEqual(["stand", null]);
    expect(events.slice(at).flatMap((e) => e.hits).filter((h) => h.attacker === 0)).toEqual([]);
  });

  it("Link's boomerang that loses a clank is knocked away: up at 1.25, back at 0.15, harmless, gone after 60 frames", () => {
    const { at, states, events } = clankWith(() => {
      const s = duel("link", "fox", -70, 0);
      launch(s, 0, "link", "boomerang", -40, 9.3, 2.4);
      return s;
    }, Btn.Attack, 90);
    const p = one(states[at], "boomerang")!;
    expect([p.mode, p.life, p.vx, p.vy]).toEqual(["knocked", 60, fx(-0.15), fx(1.25)]);
    // It falls under 0.09 and is gone on the 60th frame, or on the floor first.
    const gone = states.findIndex((st, i) => i > at && one(st, "boomerang") === undefined);
    expect(gone - at).toBeLessThanOrEqual(60);
    expect(one(states[at + 1], "boomerang")!.vy).toBe(fx(1.25) - fx(0.09));
    expect(events.slice(at).flatMap((e) => e.hits).filter((h) => h.attacker === 0)).toEqual([]);
  });

  it("Fox's Blaster and F.L.U.D.D.'s water (OFF) never clank: through a jab, at any timing", () => {
    for (const [fighter, id, vx] of [["fox", "blaster", 5.5], ["mario", "water", 4.2]] as const) {
      for (let k = 0; k <= 20; k++) {
        const s = duel(fighter, "marth", -70, 0);
        launch(s, 0, fighter, id, -30, 8, vx);
        const { events } = run(s, 25, (i) => [0, i === k ? Btn.Attack : 0]);
        expect(events.flatMap((e) => e.clanks), `${id}, jab on ${k}`).toEqual([]);
      }
    }
  });

  it("rolls back across a clank, hash for hash: a Fireball against a jab, and a boomerang knocked away", () => {
    const fireball = clankWith(() => {
      const s = field("fox");
      launch(s, 0, "mario", "fireball", -16, 9.3, 1.9);
      return s;
    }, Btn.Attack);
    const s1 = field("fox");
    launch(s1, 0, "mario", "fireball", -16, 9.3, 1.9);
    expectRollbackSafe(s1, 40, (i) => [0, i === fireball.k ? Btn.Attack : 0], [-1, fireball.at - 1, fireball.at, fireball.at + 1]);
    const boomerang = clankWith(() => {
      const s = duel("link", "fox", -70, 0);
      launch(s, 0, "link", "boomerang", -40, 9.3, 2.4);
      return s;
    }, Btn.Attack, 90);
    const s2 = duel("link", "fox", -70, 0);
    launch(s2, 0, "link", "boomerang", -40, 9.3, 2.4);
    expectRollbackSafe(s2, 90, (i) => [0, i === boomerang.k ? Btn.Attack : 0], [-1, boomerang.at - 1, boomerang.at, boomerang.at + 5]);
  });
});
