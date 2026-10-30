import { describe, expect, it } from "vitest";

import { ONE, fx, mul } from "./fixed";
import { SMASH_CHARGE_MAX } from "./constants";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import {
  advanceProjectile,
  cloneProjectile,
  findProjectileDef,
  knockProjectile,
  markProjectileHit,
  projectileAlreadyHit,
  projectileChargeScale,
  projectileHitbox,
  projectileHitboxActive,
  projectilesDueOnFrame,
  spawnProjectile,
} from "./projectile";
import { platformCentreX } from "./physics";
import { emptyCombat } from "./combat";
import { emptyKinetic } from "./kinetic";
import { Btn } from "./types";
import type {
  FighterAttributes,
  FighterDef,
  FighterState,
  GameState,
  Hitbox,
  InputFrame,
  MatchRules,
  MoveDef,
  ProjectileDef,
  StageDef,
} from "./types";

/* ------------------------------------------------------------- fixtures -- */

const ATTRS: FighterAttributes = {
  weight: 98,
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
  canWallJump: true,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

function hitbox(over: Partial<Hitbox> = {}): Hitbox {
  return {
    id: 0,
    startFrame: 1,
    endFrame: 200,
    x: 0,
    y: 0,
    radius: fx(4),
    damage: fx(6),
    angle: fx(45),
    baseKnockback: fx(30),
    knockbackGrowth: fx(100),
    transcendent: true,
    ...over,
  };
}

/** A straight-flying pellet: no gravity, dies on its first hit. */
const ARROW: ProjectileDef = {
  id: "arrow",
  spawnFrame: 4,
  offsetX: fx(6),
  offsetY: fx(6),
  vx: fx(4),
  vy: 0,
  gravity: 0,
  lifetime: 40,
  hitbox: hitbox(),
  destroyOnHit: true,
  visual: "arrow",
};

/** A bomb: falls, bounces twice, and lingers through its hits. */
const BOMB: ProjectileDef = {
  id: "bomb",
  spawnFrame: 4,
  offsetX: fx(4),
  offsetY: fx(20),
  vx: fx(2),
  vy: fx(1),
  gravity: fx(0.15),
  lifetime: 300,
  hitbox: hitbox({ damage: fx(9) }),
  bounces: 2,
  visual: "bomb",
};

/**
 * A boomerang: slows by 0.25 a frame from 3, turns once it would be slower than
 * 0.5 (age 11), and comes home up to 3 a frame, turning at most 1° a frame.
 */
const BOOMERANG: ProjectileDef = {
  id: "boomerang",
  spawnFrame: 4,
  offsetX: fx(4),
  offsetY: fx(10),
  vx: fx(3),
  vy: 0,
  gravity: 0,
  lifetime: 60,
  hitbox: hitbox({ damage: fx(7) }),
  returns: {
    deceleration: fx(0.25),
    minSpeed: fx(0.5),
    maxSpeed: fx(3),
    // sin 1°, cos 1°.
    homing: { sin: fx(0.0174524), cos: fx(0.9998477) },
    hit: { damage: fx(2), radius: fx(3) },
  },
  clash: { lifetime: 20, vx: fx(-0.5), vy: fx(1), gravity: fx(0.1), maxFall: fx(1.5) },
  visual: "boomerang",
};

/** An arrow that sticks: it lodges in the first surface it meets, for 30 frames. */
const DART: ProjectileDef = { ...ARROW, id: "dart", gravity: fx(0.5), lodge: 30 };

/** A pebble that bounces at half its landing speed until it lands slower than 0.3, and rests. */
const PEBBLE: ProjectileDef = {
  ...ARROW,
  id: "pebble",
  vx: 0,
  gravity: fx(0.1),
  maxFall: fx(1),
  lifetime: 300,
  settle: { restitution: fx(0.5), minSpeed: fx(0.3) },
  visual: "bomb",
};

/**
 * A skimmer: a floor met at under 30° bounces it off, at least 16° up, its speed
 * kept; a soft one met more steeply it goes through (Task 13c fix round 1).
 */
const SKIMMER: ProjectileDef = { ...ARROW, id: "skimmer", lifetime: 300, skim: { minAngle: fx(16), throughAngle: fx(30) }, visual: "boomerang" };

/** A hopper: a floor bounces it up at its speed ×0.9, at 1 to 1.2 up, three times (Task 13c fix round 1). */
const HOPPER: ProjectileDef = {
  ...ARROW,
  id: "hopper",
  vx: fx(0.5),
  gravity: fx(0.1),
  lifetime: 500,
  bounces: 3,
  hop: { speed: fx(0.9), minVy: fx(1), maxVy: fx(1.2) },
  visual: "fire",
};

/** A charge shot: scales with how long the button was held. */
const CHARGE_SHOT: ProjectileDef = {
  id: "shot",
  spawnFrame: 4,
  offsetX: fx(6),
  offsetY: fx(8),
  vx: fx(3),
  vy: 0,
  gravity: 0,
  lifetime: 60,
  hitbox: hitbox({ damage: fx(5) }),
  destroyOnHit: true,
  chargeScaling: fx(2.5),
  visual: "energy",
};

function move(slot: MoveDef["slot"], over: Partial<MoveDef> = {}): MoveDef {
  return { slot, name: slot, totalFrames: 24, hitboxes: [], ...over };
}

const DEF: FighterDef = {
  id: "zoner",
  name: "Zoner",
  series: "test",
  number: 1,
  attributes: ATTRS,
  moves: {
    jab1: move("jab1", {
      hitboxes: [
        { ...hitbox({ transcendent: false }), startFrame: 4, endFrame: 6, x: fx(8), y: fx(6) },
      ],
    }),
    // Fires an arrow on frame 5 of a 12-frame move: the arrow outlives it.
    neutralB: move("neutralB", { totalFrames: 12, projectiles: [ARROW] }),
    sideB: move("sideB", { totalFrames: 20, projectiles: [BOOMERANG] }),
    downB: move("downB", { totalFrames: 20, projectiles: [BOMB] }),
    upB: move("upB", { totalFrames: 20, chargeable: true, projectiles: [CHARGE_SHOT] }),
  },
  palette: {
    primary: "#f00",
    secondary: "#00f",
    accent: "#ff0",
    skin: "#fca",
    outline: "#000",
    alts: [],
  },
  blurb: "test",
};

const STAGE: StageDef = {
  id: "flat",
  name: "Flat",
  series: "test",
  platforms: [{ x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true }],
  blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
  spawns: [
    { x: fx(-40), y: fx(20) },
    { x: fx(40), y: fx(20) },
  ],
  theme: "test",
};

const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };

const RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 0,
  smashBall: false,
  oneOnOne: false,
};

function standing(gap = fx(40)): GameState {
  const s = createInitialState("flat", [{ defId: "zoner" }, { defId: "zoner" }], RULES, 7, CTX);
  for (const f of s.fighters) {
    f.action = "stand";
    f.actionFrame = 0;
    f.grounded = true;
    f.platform = 0;
    f.y = 0;
    f.intangible = 0;
  }
  s.fighters[0].x = 0;
  s.fighters[0].facing = 1;
  s.fighters[1].x = gap;
  s.fighters[1].facing = -1;
  return s;
}

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "zoner",
    costume: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    platform: 0,
    action: "stand",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: fx(50),
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    ledgeLockout: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
}

/** Advance `n` frames, pressing `first` on frame one and nothing after. */
function fire(s: GameState, first: readonly InputFrame[], n: number): GameState {
  let state = s;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < n; i++) {
    const inputs = i === 0 ? first : [0, 0];
    state = step(state, inputs, { prevInputs: prev, ctx: CTX }).state;
    prev = inputs;
  }
  return state;
}

/* --------------------------------------------------------------- units -- */

describe("spawning", () => {
  it("mirrors the offset and the velocity by the owner's facing", () => {
    const right = spawnProjectile(ARROW, fighter({ x: fx(10), facing: 1 }), 1);
    expect(right.x).toBe(fx(16));
    expect(right.vx).toBe(fx(4));
    expect(right.facing).toBe(1);

    const left = spawnProjectile(ARROW, fighter({ x: fx(10), facing: -1 }), 2);
    expect(left.x).toBe(fx(4));
    expect(left.vx).toBe(-fx(4));
    expect(left.facing).toBe(-1);
  });

  it("leaves the vertical offset absolute", () => {
    const p = spawnProjectile(ARROW, fighter({ y: fx(5), facing: -1 }), 1);
    expect(p.y).toBe(fx(11));
  });

  it("only spawns on the move frame it names", () => {
    const m = DEF.moves.neutralB as MoveDef;
    expect(projectilesDueOnFrame(m, 3)).toHaveLength(0);
    expect(projectilesDueOnFrame(m, 4)).toHaveLength(1);
    expect(projectilesDueOnFrame(m, 5)).toHaveLength(0);
  });
});

describe("charge scaling", () => {
  it("is 1x uncharged and the full multiplier at maximum charge", () => {
    expect(projectileChargeScale(CHARGE_SHOT, 0)).toBe(ONE);
    expect(projectileChargeScale(CHARGE_SHOT, SMASH_CHARGE_MAX)).toBe(fx(2.5));
    expect(projectileChargeScale(CHARGE_SHOT, SMASH_CHARGE_MAX * 2)).toBe(fx(2.5));
  });

  it("is 1x for a projectile that does not scale", () => {
    expect(projectileChargeScale(ARROW, 60)).toBe(ONE);
  });

  it("speeds the projectile up as well as strengthening it", () => {
    const slow = spawnProjectile(CHARGE_SHOT, fighter({ charge: 0 }), 1);
    const fast = spawnProjectile(CHARGE_SHOT, fighter({ charge: SMASH_CHARGE_MAX }), 2);
    expect(fast.vx).toBeGreaterThan(slow.vx);
    expect(fast.chargeScale).toBe(fx(2.5));
  });
});

describe("flight", () => {
  it("lives exactly its lifetime, the frame it spawns on included", () => {
    // Ages 0 (the spawn frame) to lifetime − 1, so `lifetime` frames in all:
    // SmashWiki's counts include the spawn frame (Plan 5, Task 6 fix round 1).
    const p = spawnProjectile(ARROW, fighter(), 1);
    for (let age = 1; age < ARROW.lifetime; age++) {
      expect(advanceProjectile(p, ARROW, STAGE, null, age).alive).toBe(true);
    }
    expect(p.age).toBe(ARROW.lifetime - 1);
    expect(advanceProjectile(p, ARROW, STAGE, null, ARROW.lifetime).alive).toBe(false);
  });

  it("travels at its own speed regardless of its owner", () => {
    const p = spawnProjectile(ARROW, fighter(), 1);
    const start = p.x;
    advanceProjectile(p, ARROW, STAGE, null, 0);
    expect(p.x - start).toBe(fx(4));
  });

  it("falls under its own gravity", () => {
    const p = spawnProjectile(BOMB, fighter({ y: fx(60) }), 1);
    const first = p.vy;
    advanceProjectile(p, BOMB, STAGE, null, 0);
    expect(p.vy).toBe(first - BOMB.gravity);
  });

  it("has a live hitbox only inside its own frame window", () => {
    const def: ProjectileDef = { ...ARROW, hitbox: hitbox({ startFrame: 3, endFrame: 5 }) };
    const p = spawnProjectile(def, fighter(), 1);
    p.age = 2;
    expect(projectileHitboxActive(p, def)).toBe(false);
    p.age = 4;
    expect(projectileHitboxActive(p, def)).toBe(true);
    p.age = 6;
    expect(projectileHitboxActive(p, def)).toBe(false);
  });

  it("dies against the blast zone", () => {
    const p = spawnProjectile(ARROW, fighter({ x: fx(238) }), 1);
    let alive = true;
    for (let i = 0; i < 5 && alive; i++) alive = advanceProjectile(p, ARROW, STAGE, null, i).alive;
    expect(alive).toBe(false);
  });
});

describe("bouncing", () => {
  it("spends a bounce and inverts the vertical component on the floor", () => {
    const p = spawnProjectile(BOMB, fighter({ y: fx(2) }), 1);
    p.vy = -fx(4);
    p.y = fx(1);
    const before = p.bouncesLeft;
    advanceProjectile(p, BOMB, STAGE, null, 0);
    expect(p.bouncesLeft).toBe(before - 1);
    expect(p.vy).toBeGreaterThan(0);
    expect(p.y).toBe(0);
  });

  it("dies on the surface once its bounces are gone", () => {
    const p = spawnProjectile(BOMB, fighter({ y: fx(2) }), 1);
    p.bouncesLeft = 0;
    p.vy = -fx(4);
    p.y = fx(1);
    expect(advanceProjectile(p, BOMB, STAGE, null, 0).alive).toBe(false);
  });

  it("dies immediately against the ground when it never bounced at all", () => {
    const p = spawnProjectile(ARROW, fighter({ y: fx(1) }), 1);
    p.vy = -fx(4);
    p.y = fx(1);
    expect(advanceProjectile(p, ARROW, STAGE, null, 0).alive).toBe(false);
  });
});

describe("returning (Plan 5, Task 13c)", () => {
  it("slows by its deceleration and turns once it would be slower than its minimum speed", () => {
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    // 3 − 0.25 a frame: 0.5 at age 10, under it at 11, where it turns.
    for (let age = 1; age <= 10; age++) {
      advanceProjectile(p, BOOMERANG, STAGE, null, age);
      expect([p.returning, p.vx, p.vy], `age ${age}`).toEqual([false, fx(3) - age * fx(0.25), 0]);
    }
    advanceProjectile(p, BOOMERANG, STAGE, null, 11);
    expect([p.returning, p.vx, p.vy]).toEqual([true, -fx(0.5), 0]);
  });

  it("gains its deceleration back each frame on the way home, up to its maximum speed", () => {
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    for (let age = 1; age <= 11; age++) advanceProjectile(p, BOOMERANG, STAGE, null, age);
    const speeds: number[] = [];
    for (let age = 12; age <= 25; age++) {
      advanceProjectile(p, BOOMERANG, STAGE, null, age);
      speeds.push(Math.abs(p.vx));
    }
    expect(speeds).toEqual(speeds.map((_, i) => Math.min(fx(0.5) + (i + 1) * fx(0.25), fx(3))));
  });

  it("comes back to its owner and is caught", () => {
    const owner = fighter();
    const p = spawnProjectile(BOOMERANG, owner, 1);
    let alive = true;
    let frames = 0;
    while (alive && frames < BOOMERANG.lifetime) {
      alive = advanceProjectile(p, BOOMERANG, STAGE, owner, frames).alive;
      frames += 1;
    }
    // Caught rather than timed out: it ended before its life ran down.
    expect(frames).toBeLessThan(BOOMERANG.lifetime);
    expect(p.returning).toBe(true);
  });

  it("turns towards its owner by at most its homing angle a frame, the shorter way, and straight at him once within it", () => {
    // Its owner well above where it turns: the way back bends up towards him.
    const owner = fighter({ y: fx(60) });
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    // sin 1°, and a little for rounding.
    const sin1 = 0.0174524 + 1e-3;
    let alive = true;
    let turned = 0;
    for (let age = 1; alive && age < BOOMERANG.lifetime; age++) {
      const [vx, vy] = [p.vx, p.vy];
      alive = advanceProjectile(p, BOOMERANG, STAGE, owner, age).alive;
      if (!alive || age <= 11) continue;
      // The sine of the turn this frame, from the cross product of the two velocities.
      const turn = (vx * p.vy - vy * p.vx) / (Math.hypot(vx, vy) * Math.hypot(p.vx, p.vy));
      expect(Math.abs(turn), `age ${age}`).toBeLessThanOrEqual(sin1);
      // Up towards him: counter-clockwise, flying back to the left.
      expect(turn, `age ${age}`).toBeLessThanOrEqual(1e-9);
      if (turn < -1e-9) turned += 1;
    }
    expect(turned).toBeGreaterThan(5);
    expect(p.vy).toBeGreaterThan(0);
  });

  it("turns by its homing angle, not at once, from flying straight away from its owner", () => {
    // Returning, but its owner right behind it: it turns 1° this frame, it does not
    // snap round 180° (the guard that it is ahead before it aims straight at him).
    const owner = fighter({ x: 0, y: fx(4) });
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    Object.assign(p, { x: fx(20), y: fx(10), vx: fx(2), vy: 0, returning: true });
    advanceProjectile(p, BOOMERANG, STAGE, owner, 1);
    expect(p.vx).toBeGreaterThan(0);
    // sin 0.9° = 0.015707, sin 1.1° = 0.019197: its new heading's sine lies between.
    const sine = Math.abs(p.vy) / Math.hypot(p.vx, p.vy);
    expect(sine).toBeGreaterThan(0.015707);
    expect(sine).toBeLessThan(0.019197);
  });

  it("hits with its way-back box once it has turned", () => {
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    expect(projectileHitbox(p, BOOMERANG)).toBe(BOOMERANG.hitbox);
    p.returning = true;
    expect(projectileHitbox(p, BOOMERANG)).toEqual({ ...BOOMERANG.hitbox, damage: fx(2), radius: fx(3) });
  });
});

describe("surfaces (Plan 5, Task 13c)", () => {
  /** Put `p` at (x, y) moving (vx, vy), and advance it one frame. */
  function at(def: ProjectileDef, x: number, y: number, vx: number, vy: number): { p: ReturnType<typeof spawnProjectile>; alive: boolean } {
    const p = spawnProjectile(def, fighter(), 1);
    Object.assign(p, { x, y, vx, vy });
    return { p, alive: advanceProjectile(p, def, STAGE, null, 1).alive };
  }

  it("stops a projectile at an underside, by its own wall rule: gone, bounced, or lodged", () => {
    // The stage's underside is 60 below its floor; each rises into it from 1 below.
    expect(at(ARROW, fx(10), fx(-61), 0, fx(2)).alive).toBe(false);
    const bounced = at(BOMB, fx(10), fx(-61), 0, fx(2));
    expect([bounced.alive, bounced.p.y, bounced.p.vy, bounced.p.bouncesLeft]).toEqual([true, fx(-60), -(fx(2) - BOMB.gravity), 1]);
    const lodged = at(DART, fx(10), fx(-61), 0, fx(2));
    expect([lodged.alive, lodged.p.mode, lodged.p.y, lodged.p.life, lodged.p.ground]).toEqual([true, "lodged", fx(-60), 30, 0]);
  });

  it("leaves a projectile rising past the stage's side alone", () => {
    expect(at(ARROW, fx(90), fx(-61), 0, fx(2)).alive).toBe(true);
  });

  it("lodges a sticking projectile in the floor or a wall, harmless, for its lodge frames, carried nowhere", () => {
    const floor = at(DART, fx(10), fx(1), fx(4), -fx(2));
    expect([floor.p.mode, floor.p.x, floor.p.y, floor.p.ground]).toEqual(["lodged", fx(14), 0, 0]);
    const wall = at(DART, fx(-82), fx(-10), fx(4), 0);
    expect([wall.p.mode, wall.p.x, wall.p.y]).toEqual(["lodged", fx(-80), fx(-10.5)]);
    const p = floor.p;
    expect(projectileHitboxActive(p, DART)).toBe(false);
    // Its 30 frames count the one it lodged on: it is gone on the 31st.
    for (let i = 2; i <= 31; i++) expect(advanceProjectile(p, DART, STAGE, null, i).alive, `lodged frame ${i}`).toBe(i <= 30);
    expect([p.x, p.y]).toEqual([fx(14), 0]);
  });

  it("bounces a settling projectile at its restitution until it lands slower than its minimum, then rests on the floor", () => {
    const p = spawnProjectile(PEBBLE, fighter({ y: fx(20) }), 1);
    const landings: number[] = [];
    let age = 0;
    while (p.ground < 0 && age < 300) {
      const before = p.vy;
      advanceProjectile(p, PEBBLE, STAGE, null, ++age);
      if (p.y === 0) landings.push(before - PEBBLE.gravity < -PEBBLE.maxFall! ? -PEBBLE.maxFall! : before - PEBBLE.gravity);
    }
    // It lands at its 1-a-frame fall cap, then at half of each bounce's speed, until under 0.3.
    expect(landings[0]).toBe(-fx(1));
    expect(landings.slice(0, -1).every((v) => -v >= fx(0.3))).toBe(true);
    expect(-landings[landings.length - 1]).toBeLessThan(fx(0.3));
    expect([p.y, p.vx, p.vy, p.ground, p.mode]).toEqual([0, 0, 0, 0, "fly"]);
    // At rest it stays, its hitbox live as ever.
    for (let i = 0; i < 20; i++) advanceProjectile(p, PEBBLE, STAGE, null, ++age);
    expect([p.y, p.vy]).toEqual([0, 0]);
    expect(projectileHitboxActive(p, PEBBLE)).toBe(true);
  });

  it("stops a settling projectile at a wall or an underside, alive", () => {
    const wall = at(PEBBLE, fx(-82), fx(-10), fx(4), 0);
    expect([wall.alive, wall.p.x, wall.p.vx]).toEqual([true, fx(-80), 0]);
    const under = at(PEBBLE, fx(10), fx(-61), 0, fx(2));
    expect([under.alive, under.p.y, under.p.vy]).toEqual([true, fx(-60), 0]);
  });

  it("carries a resting projectile with its moving platform", () => {
    const moving: StageDef = {
      ...STAGE,
      platforms: [...STAGE.platforms, { x: 0, y: fx(30), halfWidth: fx(20), soft: true, ledges: false, motion: { kind: "sweep", amplitude: fx(40), periodFrames: 400 } }],
    };
    const p = spawnProjectile(PEBBLE, fighter({ y: fx(30) }), 1);
    Object.assign(p, { x: 0, y: fx(30), vy: 0, ground: 1 });
    advanceProjectile(p, PEBBLE, moving, null, 100);
    expect(p.x).toBe(platformCentreX(moving.platforms[1], 100) - platformCentreX(moving.platforms[1], 99));
    expect(p.y).toBe(fx(30));
  });

  it("caps a projectile's fall at its falling speed", () => {
    const p = spawnProjectile(PEBBLE, fighter({ y: fx(100) }), 1);
    for (let age = 1; age <= 30; age++) advanceProjectile(p, PEBBLE, STAGE, null, age);
    expect(p.vy).toBe(-fx(1));
  });
});

describe("a floor's own rule (Task 13c fix round 1)", () => {
  /** `def` at (x, y) moving (vx, vy) over the stage plus a soft platform at 40, advanced one frame. */
  function meet(def: ProjectileDef, x: number, y: number, vx: number, vy: number) {
    const stage: StageDef = { ...STAGE, platforms: [...STAGE.platforms, { x: fx(100), y: fx(40), halfWidth: fx(20), soft: true, ledges: false }] };
    const p = spawnProjectile(def, fighter(), 1);
    Object.assign(p, { x, y, vx, vy });
    const alive = advanceProjectile(p, def, stage, null, 1).alive;
    return { p, alive };
  }

  it("skims a floor met shallower than its through angle: up off it at its own angle, at least the minimum, at the same speed", () => {
    // 20° below the flat (3, −1.0919: tan 20° = 0.364), onto the floor: it leaves at 20°, up.
    const steep = meet(SKIMMER, fx(10), fx(0.5), fx(3), -fx(1.0919));
    expect(steep.alive).toBe(true);
    expect(steep.p.y).toBe(STAGE.platforms[0].y);
    expect([steep.p.vx, steep.p.vy]).toEqual([fx(3), fx(1.0919)]);
    // 5° below the flat: it leaves at 16°, the page's minimum, its speed kept.
    const flat = meet(SKIMMER, fx(10), fx(0.2), fx(3), -fx(0.26247));
    const speed = Math.hypot(fx(3), fx(0.26247));
    expect(flat.alive).toBe(true);
    // sin 15.9° = 0.273959, sin 16.1° = 0.277315: it leaves up at 16° ± 0.1°.
    expect(flat.p.vx).toBeGreaterThan(0);
    expect(flat.p.vy / Math.hypot(flat.p.vx, flat.p.vy)).toBeGreaterThan(0.273959);
    expect(flat.p.vy / Math.hypot(flat.p.vx, flat.p.vy)).toBeLessThan(0.277315);
    expect(Math.abs(Math.hypot(flat.p.vx, flat.p.vy) - speed)).toBeLessThan(3);
  });

  it("goes through a soft platform met steeper than its through angle, and bounces off a solid floor met so (UNVERIFIED)", () => {
    // 45° down onto the soft platform at 40: through it, untouched.
    const through = meet(SKIMMER, fx(100), fx(41), fx(2), -fx(2));
    expect([through.alive, through.p.vx, through.p.vy, through.p.y]).toEqual([true, fx(2), -fx(2), fx(39)]);
    // 20° down onto the same soft platform, shallower than 30°: off it, not through.
    const shallow = meet(SKIMMER, fx(100), fx(40.5), fx(3), -fx(1.0919));
    expect([shallow.alive, shallow.p.vx, shallow.p.vy, shallow.p.y]).toEqual([true, fx(3), fx(1.0919), fx(40)]);
    // 45° onto the solid floor: off it, up at 45°.
    const off = meet(SKIMMER, fx(10), fx(1), fx(2), -fx(2));
    expect([off.alive, off.p.vx, off.p.vy, off.p.y]).toEqual([true, fx(2), fx(2), STAGE.platforms[0].y]);
  });

  it("hops off a floor at its speed multiplier, its rise held between its least and most, and is gone when its bounces are", () => {
    const p = spawnProjectile(HOPPER, fighter({ y: fx(20) }), 1);
    const hops: [number, number][] = [];
    let alive = true;
    for (let age = 1; alive && age < 500; age++) {
      const vx = p.vx;
      alive = advanceProjectile(p, HOPPER, STAGE, null, age).alive;
      if (alive && p.y === STAGE.platforms[0].y && p.vy > 0) hops.push([vx, p.vy]);
    }
    expect(hops).toHaveLength(3);
    for (const [vx, vy] of hops) {
      expect(vy).toBeGreaterThanOrEqual(fx(1));
      expect(vy).toBeLessThanOrEqual(fx(1.2));
      expect(vx).toBeGreaterThan(0);
    }
    // The first lands from 26 up (gravity 0.1), faster than 1.2 ÷ 0.9: held at 1.2.
    expect(hops[0][1]).toBe(fx(1.2));
    // Its horizontal speed ×0.9 at each.
    expect(p.vx).toBe(mul(mul(mul(fx(0.5), fx(0.9)), fx(0.9)), fx(0.9)));
    // Its fourth landing ends it.
    expect(alive).toBe(false);
  });
});

describe("a clank it loses (Plan 5, Task 13c)", () => {
  it("knocks a projectile with a clash rule away: no hitbox, the clash's flight, gone after its lifetime", () => {
    const p = spawnProjectile(BOOMERANG, fighter({ y: fx(40) }), 1);
    expect(knockProjectile(p, BOOMERANG)).toBe(true);
    expect([p.mode, p.life, p.vx, p.vy]).toEqual(["knocked", 20, -fx(0.5), fx(1)]);
    expect(projectileHitboxActive(p, BOOMERANG)).toBe(false);
    advanceProjectile(p, BOOMERANG, STAGE, null, 1);
    expect(p.vy).toBe(fx(1) - fx(0.1));
    // Its 20 frames count the clank's: the 19 after it, gone on the 20th.
    for (let i = 2; i <= 20; i++) expect(advanceProjectile(p, BOOMERANG, STAGE, null, i).alive, `knocked frame ${i}`).toBe(i < 20);
  });

  it("flies off backwards for its facing and falls no faster than its falling speed (fix round 1)", () => {
    // Facing left, the clash's −0.5 is +0.5: away from where it was going.
    const LONG: ProjectileDef = { ...BOOMERANG, clash: { ...BOOMERANG.clash!, lifetime: 60 } };
    const p = spawnProjectile(LONG, fighter({ y: fx(100), facing: -1 }), 1);
    knockProjectile(p, LONG);
    expect([p.facing, p.vx]).toEqual([-1, fx(0.5)]);
    const vys: number[] = [];
    for (let i = 1; i < 40; i++) {
      advanceProjectile(p, LONG, STAGE, null, i);
      vys.push(p.vy);
    }
    // 1 − 0.1 a frame, down to the clash's 1.5 and held there.
    expect(Math.min(...vys)).toBe(-fx(1.5));
    expect(vys.filter((v) => v === -fx(1.5)).length).toBeGreaterThan(1);
  });

  it("is gone on the stage it meets while knocked away", () => {
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    knockProjectile(p, BOOMERANG);
    Object.assign(p, { y: fx(1), vy: -fx(2) });
    expect(advanceProjectile(p, BOOMERANG, STAGE, null, 1).alive).toBe(false);
  });

  it("knocks nothing without a clash rule: the clank ends it", () => {
    const p = spawnProjectile(ARROW, fighter(), 1);
    expect(knockProjectile(p, ARROW)).toBe(false);
    expect(p.mode).toBe("fly");
  });
});

describe("hit records", () => {
  it("records a port once", () => {
    const p = spawnProjectile(ARROW, fighter(), 1);
    expect(projectileAlreadyHit(p, 1)).toBe(false);
    markProjectileHit(p, 1);
    markProjectileHit(p, 1);
    expect(p.hitPorts).toEqual([1]);
  });
});

/* ----------------------------------------------- through the simulation -- */

describe("projectiles in step()", () => {
  it("spawns on the named frame of its move", () => {
    const s = fire(standing(), [Btn.Special, 0], 4);
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0].defId).toBe("arrow");
    expect(s.projectiles[0].owner).toBe(0);
    expect(s.nextProjectileId).toBe(2);
  });

  it("outlives the move that fired it", () => {
    const s = fire(standing(fx(200)), [Btn.Special, 0], 14);
    // The 12-frame move is long over.
    expect(s.fighters[0].action).not.toBe("special");
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0].age).toBeGreaterThan(0);
  });

  it("cannot hit the fighter that fired it", () => {
    const s = standing(fx(200));
    // Point the owner at nothing and let the arrow fly its whole life.
    const after = fire(s, [Btn.Special, 0], 60);
    expect(after.fighters[0].damage).toBe(0);
  });

  it("damages an opponent it reaches, through the ordinary hit pipeline", () => {
    let s = standing(fx(30));
    let prev: readonly InputFrame[] = [0, 0];
    let hits = 0;
    for (let i = 0; i < 20; i++) {
      const inputs = i === 0 ? [Btn.Special, 0] : [0, 0];
      const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      s = out.state;
      hits += out.events.hits.length;
    }
    expect(hits).toBe(1);
    expect(s.fighters[1].damage).toBeGreaterThan(0);
    expect(s.fighters[1].hitstun).toBeGreaterThanOrEqual(0);
  });

  it("disappears on its hit when destroyOnHit is set", () => {
    const s = fire(standing(fx(30)), [Btn.Special, 0], 20);
    expect(s.projectiles).toHaveLength(0);
  });

  it("hits a given fighter at most once", () => {
    // A boomerang lingers through its hit, passes the victim, turns around and
    // comes back through them — and still only lands once.
    let s = standing(fx(24));
    let prev: readonly InputFrame[] = [0, 0];
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const inputs = i === 0 ? [Btn.Right | Btn.Special, 0] : [0, 0];
      const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      s = out.state;
      hits += out.events.hits.filter((h) => h.attacker === 0).length;
    }
    expect(hits).toBe(1);
  });

  it("does not freeze its thrower in hitlag when it connects", () => {
    let s = standing(fx(30));
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 20; i++) {
      const inputs = i === 0 ? [Btn.Special, 0] : [0, 0];
      const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      s = out.state;
      if (out.events.hits.length > 0) {
        expect(s.fighters[0].hitlag).toBe(0);
        expect(s.fighters[1].hitlag).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error("the projectile never connected");
  });

  it("takes the reduced projectile shieldstun on a raised shield", () => {
    let s = standing(fx(30));
    let prev: readonly InputFrame[] = [0, 0];
    let shieldHits = 0;
    for (let i = 0; i < 20; i++) {
      const inputs = [i === 0 ? Btn.Special : 0, Btn.Shield];
      const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      s = out.state;
      shieldHits += out.events.shieldHits.length;
    }
    expect(shieldHits).toBe(1);
    expect(s.fighters[1].damage).toBe(0);
    expect(s.fighters[1].shieldHealth).toBeLessThan(fx(50));
  });

  it("launches only once from a charging move, not once per charge frame", () => {
    let s = standing(fx(200));
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const inputs: InputFrame[] = [Btn.Up | Btn.Special | Btn.Attack, 0];
      s = step(s, inputs, { prevInputs: prev, ctx: CTX }).state;
      prev = inputs;
    }
    expect(s.projectiles.length).toBeLessThanOrEqual(1);
  });
});

describe("projectiles and rollback", () => {
  it("clones without sharing the hit record", () => {
    const s = fire(standing(fx(200)), [Btn.Special, 0], 6);
    expect(s.projectiles).toHaveLength(1);
    s.projectiles[0].hitPorts.push(1);

    const c = cloneState(s);
    c.projectiles[0].hitPorts.push(0);
    c.projectiles[0].x = fx(999);
    expect(s.projectiles[0].hitPorts).toEqual([1]);
    expect(s.projectiles[0].x).not.toBe(fx(999));
  });

  it("copies one projectile without aliasing its array", () => {
    const p = spawnProjectile(ARROW, fighter(), 1);
    markProjectileHit(p, 2);
    const c = cloneProjectile(p);
    c.hitPorts.push(3);
    expect(p.hitPorts).toEqual([2]);
  });

  it("round-trips through the state hash", () => {
    const s = fire(standing(fx(200)), [Btn.Special, 0], 6);
    expect(hashState(cloneState(s))).toBe(hashState(s));
  });

  it("changes the hash when a projectile moves", () => {
    const s = fire(standing(fx(200)), [Btn.Special, 0], 6);
    const before = hashState(s);
    const moved = cloneState(s);
    moved.projectiles[0].x += 1;
    expect(hashState(moved)).not.toBe(before);
  });

  it("re-simulates identically across a rollback", () => {
    const inputsAt = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, 0];
    let live = standing(fx(200));
    let prev: readonly InputFrame[] = [0, 0];
    let snapshot: GameState | null = null;
    let prevAtSnapshot: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 20; i++) {
      if (i === 10) {
        snapshot = cloneState(live);
        prevAtSnapshot = prev;
      }
      const inputs = inputsAt(i);
      live = step(live, inputs, { prevInputs: prev, ctx: CTX }).state;
      prev = inputs;
    }
    let replay = snapshot as GameState;
    let replayPrev = prevAtSnapshot;
    for (let i = 10; i < 20; i++) {
      const inputs = inputsAt(i);
      replay = step(replay, inputs, { prevInputs: replayPrev, ctx: CTX }).state;
      replayPrev = inputs;
    }
    expect(replay.projectiles).toHaveLength(1);
    expect(hashState(replay)).toBe(hashState(live));
  });
});

describe("where a projectile comes from (Plan 5)", () => {
  it("names the fighter whose moveset defines it, so a new owner can still find it", () => {
    const p = spawnProjectile(ARROW, fighter({ defId: "zoner" }), 1);
    expect(p.source).toBe("zoner");
    expect(p.reflected).toBe(0);
    expect(p.charge).toBe(0);
  });

  it("can be told a different source, for a move borrowed from another fighter", () => {
    expect(spawnProjectile(ARROW, fighter({ defId: "zoner" }), 1, "mario").source).toBe("mario");
  });

  it("records the fraction of a full charge it was launched with", () => {
    expect(spawnProjectile(CHARGE_SHOT, fighter({ charge: SMASH_CHARGE_MAX }), 1).charge).toBe(ONE);
    expect(spawnProjectile(CHARGE_SHOT, fighter({ charge: SMASH_CHARGE_MAX / 2 }), 1).charge).toBe(ONE / 2);
  });

  it("copies every field of a projectile, and hashes every one of them", () => {
    const p = spawnProjectile(ARROW, fighter(), 1);
    const c = cloneProjectile(p);
    expect(Object.keys(c).sort()).toEqual(Object.keys(p).sort());
    // Launched in flight, resting on nothing, with no count of its own (Task 13c).
    expect([p.mode, p.life, p.ground]).toEqual(["fly", 0, -1]);
    const s = fire(standing(fx(200)), [Btn.Special, 0], 6);
    for (const [name, mutate] of [
      ["source", (q: GameState) => (q.projectiles[0].source = "other")],
      ["charge", (q: GameState) => (q.projectiles[0].charge += 1)],
      ["reflected", (q: GameState) => (q.projectiles[0].reflected += 1)],
      ["mode", (q: GameState) => (q.projectiles[0].mode = "lodged")],
      ["life", (q: GameState) => (q.projectiles[0].life += 1)],
      ["ground", (q: GameState) => (q.projectiles[0].ground += 1)],
    ] as const) {
      const q = cloneState(s);
      mutate(q);
      expect(hashState(q), `hash ignored projectile.${name}`).not.toBe(hashState(s));
      expect(cloneState(q).projectiles[0], `clone dropped projectile.${name}`).toEqual(q.projectiles[0]);
    }
  });

  // `step()` finds a projectile's def by `source`, never by its owner (the
  // Plan 5 Task 1 review: nothing pinned it, as every source was its owner).
  // A fighter with no projectiles of its own, and a context that knows only
  // the ids it is given, as the game's roster context does.
  const PLAIN: FighterDef = { ...DEF, id: "plain", moves: { jab1: DEF.moves.jab1 as MoveDef } };
  const TWO: SimContext = { fighter: (id) => (id === "plain" ? PLAIN : DEF), stage: () => STAGE };
  const STRICT: SimContext = {
    fighter(id) {
      if (id !== "zoner" && id !== "plain") throw new Error(`unregistered fighter: ${id}`);
      return id === "plain" ? PLAIN : DEF;
    },
    stage: () => STAGE,
  };

  it("keeps flying when its owner's moveset has no such projectile (looked up by source)", () => {
    const s = standing(fx(200));
    s.fighters[1].defId = "plain";
    const p = spawnProjectile(ARROW, fighter({ port: 1, defId: "plain", facing: -1, x: fx(100) }), 1, "zoner");
    s.projectiles.push(p);
    s.nextProjectileId = 2;
    const next = step(s, [0, 0], { prevInputs: [0, 0], ctx: TWO }).state;
    expect(next.projectiles).toHaveLength(1);
    expect(next.projectiles[0].x).toBeLessThan(p.x);
  });

  it("throws, naming the id, for a source the context does not know (pins today's contract)", () => {
    const s = standing(fx(200));
    s.projectiles.push(spawnProjectile(ARROW, fighter({ port: 0 }), 1, "ghost"));
    s.nextProjectileId = 2;
    expect(() => step(s, [0, 0], { prevInputs: [0, 0], ctx: STRICT })).toThrow(/unregistered fighter: ghost/);
  });
});

describe("def lookup", () => {
  it("finds a projectile by id across the whole moveset", () => {
    expect(findProjectileDef(DEF, "arrow")).toBe(ARROW);
    expect(findProjectileDef(DEF, "bomb")).toBe(BOMB);
    expect(findProjectileDef(DEF, "nothing")).toBeUndefined();
  });
});
