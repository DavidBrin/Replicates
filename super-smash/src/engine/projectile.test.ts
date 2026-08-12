import { describe, expect, it } from "vitest";

import { ONE, fx } from "./fixed";
import { SMASH_CHARGE_MAX } from "./constants";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import {
  advanceProjectile,
  cloneProjectile,
  findProjectileDef,
  markProjectileHit,
  projectileAlreadyHit,
  projectileChargeScale,
  projectileHitboxActive,
  projectilesDueOnFrame,
  spawnProjectile,
} from "./projectile";
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

/** A boomerang: turns around halfway and comes home. */
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
  returns: true,
  visual: "boomerang",
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
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
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
  it("expires exactly at its lifetime", () => {
    const p = spawnProjectile(ARROW, fighter(), 1);
    for (let i = 0; i < ARROW.lifetime; i++) {
      expect(advanceProjectile(p, ARROW, STAGE, null, i).alive).toBe(true);
    }
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

describe("returning", () => {
  it("turns around at the halfway point of its life", () => {
    const p = spawnProjectile(BOOMERANG, fighter(), 1);
    for (let i = 0; i < BOOMERANG.lifetime / 2 - 1; i++) {
      advanceProjectile(p, BOOMERANG, STAGE, null, i);
      expect(p.returning).toBe(false);
    }
    advanceProjectile(p, BOOMERANG, STAGE, null, 0);
    expect(p.returning).toBe(true);
    expect(p.vx).toBeLessThan(0);
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

describe("def lookup", () => {
  it("finds a projectile by id across the whole moveset", () => {
    expect(findProjectileDef(DEF, "arrow")).toBe(ARROW);
    expect(findProjectileDef(DEF, "bomb")).toBe(BOMB);
    expect(findProjectileDef(DEF, "nothing")).toBeUndefined();
  });
});
