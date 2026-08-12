import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ONE, fx, toFloat } from "./fixed";
import { SHIELD_MAX_HEALTH } from "./constants";
import { hashState } from "./hash";
import {
  DEFAULT_SEED,
  cloneState,
  createInitialState,
  registryContext,
  registerFighters,
  registerStages,
  clearRegistry,
  resolveOutcome,
  step,
} from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
import type {
  FighterAttributes,
  FighterDef,
  GameState,
  Hitbox,
  InputFrame,
  MatchRules,
  MoveDef,
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
    startFrame: 4,
    endFrame: 6,
    x: fx(8),
    y: fx(6),
    radius: fx(5),
    damage: fx(10),
    angle: fx(45),
    baseKnockback: fx(40),
    knockbackGrowth: fx(100),
    ...over,
  };
}

function move(slot: MoveDef["slot"], over: Partial<MoveDef> = {}): MoveDef {
  return { slot, name: slot, totalFrames: 24, hitboxes: [hitbox()], ...over };
}

const DEF: FighterDef = {
  id: "tester",
  name: "Tester",
  series: "test",
  number: 1,
  attributes: ATTRS,
  moves: {
    jab1: move("jab1"),
    ftilt: move("ftilt"),
    utilt: move("utilt"),
    dtilt: move("dtilt"),
    fsmash: move("fsmash", { hitboxes: [hitbox({ damage: fx(18) })], totalFrames: 40 }),
    usmash: move("usmash", { totalFrames: 40 }),
    dsmash: move("dsmash", { totalFrames: 40 }),
    dashAttack: move("dashAttack"),
    nair: move("nair", { landingLag: 8 }),
    fair: move("fair", { landingLag: 12 }),
    bair: move("bair", { landingLag: 10 }),
    uair: move("uair", { landingLag: 9 }),
    dair: move("dair", { landingLag: 16 }),
    neutralB: move("neutralB", {
      totalFrames: 30,
      hitboxes: [],
      projectiles: [
        {
          id: "pellet",
          spawnFrame: 6,
          offsetX: fx(6),
          offsetY: fx(6),
          vx: fx(4),
          vy: 0,
          gravity: 0,
          lifetime: 90,
          hitbox: hitbox({ startFrame: 1, endFrame: 90, x: 0, y: 0, damage: fx(6) }),
          destroyOnHit: true,
          visual: "energy",
        },
      ],
    }),
    upB: move("upB"),
    grab: move("grab", { totalFrames: 30, hitboxes: [hitbox({ grabbing: true })] }),
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

const CTX: SimContext = {
  fighter: () => DEF,
  stage: () => STAGE,
};

const RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 0,
  smashBall: false,
  oneOnOne: false,
};

function newState(rules: MatchRules = RULES): GameState {
  return createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], rules, 12345, CTX);
}

/** A state with both fighters standing on the ground, ready to act. */
function standing(rules: MatchRules = RULES): GameState {
  const s = newState(rules);
  for (const f of s.fighters) {
    f.action = "stand";
    f.actionFrame = 0;
    f.grounded = true;
    f.platform = 0;
    f.y = 0;
    f.intangible = 0;
    f.vx = 0;
    f.vy = 0;
  }
  s.fighters[0].x = 0;
  s.fighters[0].facing = 1;
  s.fighters[1].x = fx(8);
  s.fighters[1].facing = -1;
  return s;
}

/** Advance `n` frames, holding `inputs` throughout. */
function run(s: GameState, inputs: readonly InputFrame[], n: number): GameState {
  let state = s;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < n; i++) {
    state = step(state, inputs, { prevInputs: prev, ctx: CTX }).state;
    prev = inputs;
  }
  return state;
}

/* ------------------------------------------------------------ the basics -- */

describe("createInitialState", () => {
  it("puts every fighter on a spawn with a full shield and full stocks", () => {
    const s = newState();
    expect(s.fighters).toHaveLength(2);
    expect(s.fighters[0].x).toBe(fx(-40));
    expect(s.fighters[1].x).toBe(fx(40));
    expect(s.fighters[0].stocks).toBe(3);
    expect(s.fighters[0].shieldHealth).toBe(SHIELD_MAX_HEALTH);
    expect(s.frame).toBe(0);
    expect(s.outcome).toBeNull();
    expect(s.projectiles).toEqual([]);
    expect(s.nextProjectileId).toBe(1);
  });

  it("faces every fighter toward the centre of the stage", () => {
    const s = newState();
    expect(s.fighters[0].facing).toBe(1);
    expect(s.fighters[1].facing).toBe(-1);
  });

  it("starts a timed match with its clock full", () => {
    const s = newState({ ...RULES, mode: "time", timeLimit: 60 * 60 });
    expect(s.timeRemaining).toBe(60 * 60);
  });
});

describe("cloneState", () => {
  it("round-trips to an identical hash", () => {
    const s = run(standing(), [Btn.Right, Btn.Attack], 12);
    expect(hashState(cloneState(s))).toBe(hashState(s));
  });

  it("shares no arrays with the original", () => {
    const s = standing();
    s.fighters[0].staleQueue.push("jab1");
    s.fighters[0].hitThisMove.push(1);
    const c = cloneState(s);
    c.fighters[0].staleQueue.push("fair");
    c.fighters[0].hitThisMove.push(0);
    c.fighters[0].ledge = { platform: 0, side: 1 };
    expect(s.fighters[0].staleQueue).toEqual(["jab1"]);
    expect(s.fighters[0].hitThisMove).toEqual([1]);
    expect(s.fighters[0].ledge).toBeNull();
  });

  it("copies the rules and the Smash Ball rather than aliasing them", () => {
    const s = standing();
    const c = cloneState(s);
    c.smashBall.x = fx(99);
    expect(s.smashBall.x).not.toBe(fx(99));
    expect(c.rules).not.toBe(s.rules);
  });
});

/* --------------------------------------------------------------- purity -- */

describe("step purity", () => {
  it("never mutates the state it was given", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 511 }), { minLength: 1, maxLength: 12 }),
        (script) => {
          let state = standing();
          let prev: readonly InputFrame[] = [0, 0];
          for (const raw of script) {
            const inputs: InputFrame[] = [raw, (raw >> 2) & 0x1ff];
            const before = hashState(state);
            const next = step(state, inputs, { prevInputs: prev, ctx: CTX });
            if (hashState(state) !== before) return false;
            state = next.state;
            prev = inputs;
          }
          return true;
        },
      ),
      { numRuns: 40 },
    );
  });

  it("returns a new object, not the one it was handed", () => {
    const s = standing();
    const out = step(s, [0, 0], { ctx: CTX });
    expect(out.state).not.toBe(s);
    expect(out.state.fighters[0]).not.toBe(s.fighters[0]);
  });

  it("advances the frame counter by exactly one", () => {
    const s = standing();
    expect(step(s, [0, 0], { ctx: CTX }).state.frame).toBe(s.frame + 1);
  });
});

/* --------------------------------------------------------- determinism -- */

/** A scripted "player": deterministic, busy, and different in each port. */
function scriptedInput(port: number, frame: number): InputFrame {
  const t = (frame + port * 17) % 60;
  let v = 0;
  if (t < 12) v |= Btn.Right;
  else if (t < 22) v |= Btn.Left;
  if (t === 15 || t === 40) v |= Btn.Jump;
  if (t === 23 || t === 47) v |= Btn.Attack;
  if (t >= 31 && t <= 35) v |= Btn.Shield;
  if (t === 51) v |= Btn.Special;
  if (t === 55) v |= Btn.Down;
  return v;
}

function simulate(frames: number, seed = DEFAULT_SEED): GameState {
  let state = createInitialState(
    "flat",
    [{ defId: "tester" }, { defId: "tester" }],
    RULES,
    seed,
    CTX,
  );
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < frames; i++) {
    const inputs = [scriptedInput(0, i), scriptedInput(1, i)];
    state = step(state, inputs, { prevInputs: prev, ctx: CTX }).state;
    prev = inputs;
  }
  return state;
}

describe("determinism", () => {
  it("produces the same hash twice from the same seed and inputs", () => {
    const a = simulate(600);
    const b = simulate(600);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.frame).toBe(600);
  });

  it("produces a different hash from a different seed once randomness is used", () => {
    // With no Smash Ball there is nothing random to diverge on, so the seed
    // itself is the only difference — which the hash must still see.
    expect(hashState(simulate(60, 1))).not.toBe(hashState(simulate(60, 2)));
  });
});

describe("rollback", () => {
  it("re-simulating from a snapshot reproduces the state that was never rolled back", () => {
    const inputsAt = (i: number) => [scriptedInput(0, i), scriptedInput(1, i)];

    let live = standing();
    let snapshot: GameState | null = null;
    let prev: readonly InputFrame[] = [0, 0];
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

    expect(snapshot).not.toBeNull();
    let replay = snapshot as GameState;
    let replayPrev = prevAtSnapshot;
    for (let i = 10; i < 20; i++) {
      const inputs = inputsAt(i);
      replay = step(replay, inputs, { prevInputs: replayPrev, ctx: CTX }).state;
      replayPrev = inputs;
    }

    expect(hashState(replay)).toBe(hashState(live));
  });
});

/* ------------------------------------------------------------- combat -- */

describe("hits", () => {
  it("damages, launches and freezes both fighters", () => {
    let s = standing();
    const inputs = [Btn.Attack, 0];
    let prev: readonly InputFrame[] = [0, 0];
    let hit = false;
    for (let i = 0; i < 10; i++) {
      const out = step(s, i === 0 ? inputs : [0, 0], { prevInputs: prev, ctx: CTX });
      prev = i === 0 ? inputs : [0, 0];
      s = out.state;
      if (out.events.hits.length > 0) hit = true;
    }
    expect(hit).toBe(true);
    expect(s.fighters[1].damage).toBeGreaterThan(0);
    expect(s.fighters[1].hitlag).toBeGreaterThan(0);
    expect(s.fighters[0].hitlag).toBeGreaterThan(0);
  });

  it("hits a given target only once per swing", () => {
    let s = standing();
    // Stretch the hitbox over the whole move so it would connect every frame.
    let prev: readonly InputFrame[] = [0, 0];
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      const inputs = i === 0 ? [Btn.Attack, 0] : [0, 0];
      const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      s = out.state;
      hits += out.events.hits.length;
    }
    expect(hits).toBe(1);
  });

  it("applies staleness to the second use of a move", () => {
    const s = standing();
    s.fighters[0].staleQueue = ["jab1", "jab1", "jab1"];
    const fresh = standing();

    const staled = run(s, [Btn.Attack, 0], 6).fighters[1].damage;
    const unstaled = run(fresh, [Btn.Attack, 0], 6).fighters[1].damage;
    expect(staled).toBeLessThan(unstaled);
  });

  it("puts a hard enough hit into tumble rather than plain hitstun", () => {
    const s = standing();
    s.fighters[1].damage = fx(150);
    const after = run(s, [Btn.Attack, 0], 6);
    expect(["tumble", "hitstun"]).toContain(after.fighters[1].action);
    expect(after.fighters[1].hitstun).toBeGreaterThan(0);
  });

  it("does not hit a fighter who is intangible", () => {
    const s = standing();
    s.fighters[1].intangible = 60;
    const after = run(s, [Btn.Attack, 0], 8);
    expect(after.fighters[1].damage).toBe(0);
  });

  it("captures rather than damages with a grabbing hitbox", () => {
    let s = standing();
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 8; i++) {
      const inputs = i === 0 ? [Btn.Grab, 0] : [0, 0];
      s = step(s, inputs, { prevInputs: prev, ctx: CTX }).state;
      prev = inputs;
    }
    expect(s.fighters[0].grabbing).toBe(1);
    expect(s.fighters[1].grabbedBy).toBe(0);
    expect(s.fighters[1].damage).toBe(0);
  });
});

/* ------------------------------------------------------------ short hop -- */

/**
 * Fighter 0 throws a neutral air at fighter 1 from just above the floor, and the
 * hit it lands is reported. The only difference between the two calls is the
 * flag, so any difference in the numbers is the short-hop penalty and nothing
 * else — same move, same staleness, same percent, same weight.
 */
function aerialHit(shortHop: boolean): { damage: number; knockback: number } {
  const s = standing();
  const a = s.fighters[0];
  a.action = "fall";
  a.grounded = false;
  a.platform = -1;
  a.y = fx(6);
  a.jumpsUsed = 1;
  a.shortHop = shortHop;

  let state = s;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < 12; i++) {
    const inputs = [i === 0 ? Btn.Attack : 0, 0];
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    prev = inputs;
    state = out.state;
    if (out.events.hits.length > 0) return out.events.hits[0];
  }
  throw new Error("the aerial never connected");
}

describe("short-hop aerials", () => {
  it("deal 0.85x damage, and therefore less knockback", () => {
    const full = aerialHit(false);
    const short = aerialHit(true);
    expect(toFloat(short.damage) / toFloat(full.damage)).toBeCloseTo(0.85, 3);
    // Knockback is not scaled directly anywhere: it falls because the formula
    // takes the reduced damage as an input, and because the victim's percent
    // after the hit is lower too.
    expect(short.knockback).toBeLessThan(full.knockback);
  });

  it("leave a grounded attack alone", () => {
    const marked = standing();
    marked.fighters[0].shortHop = true;
    const plain = standing();
    const withFlag = run(marked, [Btn.Attack, 0], 6).fighters[1].damage;
    const without = run(plain, [Btn.Attack, 0], 6).fighters[1].damage;
    expect(withFlag).toBe(without);
    expect(withFlag).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------- DI -- */

/**
 * Take a hit with one direction held on the contact frame and another held for
 * the rest of the freeze, and report the victim on the frame the freeze ends.
 *
 * That frame is the whole point: Ultimate samples DI on the last frame of
 * hitlag, so what the victim was holding when the hit landed is not what bends
 * the angle — what they are holding when the freeze breaks is.
 */
function launched(atContact: InputFrame, afterContact: InputFrame) {
  let s = standing();
  let prev: readonly InputFrame[] = [0, 0];
  let hitAt = -1;
  let velocityDuringFreeze: number[] = [];
  for (let i = 0; i < 40; i++) {
    const inputs = [i === 0 ? Btn.Attack : 0, hitAt < 0 ? atContact : afterContact];
    const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
    prev = inputs;
    s = out.state;
    if (out.events.hits.length > 0) hitAt = i;
    if (hitAt >= 0) {
      if (s.fighters[1].hitlag === 0) break;
      velocityDuringFreeze = [s.fighters[1].vx, s.fighters[1].vy];
    }
  }
  expect(hitAt).toBeGreaterThanOrEqual(0);
  return { victim: s.fighters[1], velocityDuringFreeze };
}

describe("DI on the last frame of hitlag", () => {
  it("holds the launch back until the freeze ends", () => {
    const { victim, velocityDuringFreeze } = launched(0, 0);
    // Frozen fighters have not been launched yet — they are still standing
    // exactly where the hit found them.
    expect(velocityDuringFreeze).toEqual([0, 0]);
    expect(victim.vx).not.toBe(0);
    expect(victim.vy).not.toBe(0);
  });

  it("takes the direction held when the freeze breaks, not on contact", () => {
    const none = launched(0, 0).victim;
    const reacted = launched(0, Btn.Up).victim;
    // The victim held nothing when the hit landed and reacted during the freeze,
    // which is the case that does not exist at all if DI is sampled on contact.
    expect(reacted.vy).toBeGreaterThan(none.vy);
    expect(reacted.vy / reacted.vx).toBeGreaterThan(none.vy / none.vx);
  });

  it("ignores a direction let go of before the freeze ends", () => {
    const none = launched(0, 0).victim;
    const flinched = launched(Btn.Up, 0).victim;
    expect(flinched.vx).toBe(none.vx);
    expect(flinched.vy).toBe(none.vy);
    expect(flinched.launchSpeed).toBe(none.launchSpeed);
  });

  it("still answers a direction held throughout, exactly as it always did", () => {
    const heldAllAlong = launched(Btn.Up, Btn.Up).victim;
    const reacted = launched(0, Btn.Up).victim;
    expect(heldAllAlong.vx).toBe(reacted.vx);
    expect(heldAllAlong.vy).toBe(reacted.vy);
  });
});

describe("shields", () => {
  it("absorbs a hit into shield health and shieldstun", () => {
    let s = standing();
    let prev: readonly InputFrame[] = [0, 0];
    let shieldHits = 0;
    for (let i = 0; i < 10; i++) {
      const inputs = [i === 0 ? Btn.Attack : 0, Btn.Shield];
      const out = step(s, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      s = out.state;
      shieldHits += out.events.shieldHits.length;
    }
    expect(shieldHits).toBe(1);
    expect(s.fighters[1].damage).toBe(0);
    expect(s.fighters[1].shieldHealth).toBeLessThan(SHIELD_MAX_HEALTH);
  });

  it("decays a held shield and regenerates a dropped one", () => {
    const held = run(standing(), [0, Btn.Shield], 60);
    expect(held.fighters[1].shieldHealth).toBeLessThan(SHIELD_MAX_HEALTH);

    const recovering = cloneState(held);
    const back = run(recovering, [0, 0], 240);
    expect(back.fighters[1].shieldHealth).toBe(SHIELD_MAX_HEALTH);
  });

  it("breaks a shield that runs out and stuns the fighter", () => {
    const s = standing();
    s.fighters[1].shieldHealth = fx(0.1);
    let state = s;
    let prev: readonly InputFrame[] = [0, 0];
    let broke = false;
    for (let i = 0; i < 6; i++) {
      const inputs = [0, Btn.Shield];
      const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
      prev = inputs;
      state = out.state;
      if (out.events.shieldBreaks.length > 0) broke = true;
    }
    expect(broke).toBe(true);
    expect(state.fighters[1].action).toBe("shieldBroken");
  });
});

/* ---------------------------------------------------------------- KOs -- */

describe("KOs and stocks", () => {
  it("takes a stock and blanks the fighter when it leaves the blast zone", () => {
    const s = standing();
    s.fighters[1].x = fx(300);
    const out = step(s, [0, 0], { ctx: CTX });
    expect(out.events.kos).toHaveLength(1);
    expect(out.state.fighters[1].stocks).toBe(2);
    expect(out.state.fighters[1].damage).toBe(0);
    expect(out.state.fighters[1].action).toBe("dead");
    expect(out.state.freezeFrames).toBeGreaterThan(0);
  });

  it("freezes the whole game for the KO, then resumes", () => {
    const s = standing();
    s.fighters[1].y = fx(-200);
    s.fighters[1].grounded = false;
    s.fighters[1].platform = -1;
    s.fighters[1].action = "fall";
    let state = step(s, [0, 0], { ctx: CTX }).state;
    const frozenAt = state.frame;
    state = step(state, [0, 0], { ctx: CTX }).state;
    // The freeze frame still advances the counter but nothing else moves.
    expect(state.frame).toBe(frozenAt + 1);
    expect(state.freezeFrames).toBeGreaterThan(0);
  });

  it("respawns a fighter with stocks left and ends the match for one without", () => {
    const s = standing();
    s.fighters[1].stocks = 1;
    s.fighters[1].x = fx(300);
    const out = step(s, [0, 0], { ctx: CTX });
    expect(out.state.fighters[1].stocks).toBe(0);
    expect(out.state.outcome?.kind).toBe("stockOut");
    expect(out.state.outcome?.placings[0]).toBe(0);
  });

  it("ranks by stocks first and damage second", () => {
    const s = standing();
    s.fighters[0].stocks = 1;
    s.fighters[0].damage = fx(80);
    s.fighters[1].stocks = 1;
    s.fighters[1].damage = fx(20);
    // Nobody is out yet, so no outcome.
    expect(resolveOutcome(s)).toBeNull();
    s.fighters[0].stocks = 0;
    expect(resolveOutcome(s)?.placings).toEqual([1, 0]);
  });
});

/* ------------------------------------------------------------ registry -- */

describe("registry", () => {
  it("resolves ids through the registered roster and stage list", () => {
    clearRegistry();
    registerFighters([DEF]);
    registerStages([STAGE]);
    expect(registryContext.fighter("tester")).toBe(DEF);
    expect(registryContext.stage("flat")).toBe(STAGE);
    expect(() => registryContext.fighter("nobody")).toThrow();
    clearRegistry();
  });
});

/* ---------------------------------------------------------- smash ball -- */

describe("smash ball", () => {
  it("stays absent when the rules say so", () => {
    const s = run(standing(), [0, 0], 30);
    expect(s.smashBall.active).toBe(false);
  });

  it("decays 2 HP a second once it is out", () => {
    const s = standing({ ...RULES, smashBall: true });
    s.smashBall.active = true;
    s.smashBall.health = fx(40);
    s.smashBall.x = fx(120);
    s.smashBall.y = fx(120);
    const after = run(s, [0, 0], 120);
    expect(toFloat(after.smashBall.health)).toBeLessThanOrEqual(36);
    expect(toFloat(after.smashBall.health)).toBeGreaterThan(30);
  });
});

/* ----------------------------------------------------------- movement -- */

describe("movement through step", () => {
  it("walks a fighter along the ground", () => {
    const s = standing();
    const before = s.fighters[0].x;
    const after = run(s, [Btn.Right, 0], 10);
    expect(after.fighters[0].x).toBeGreaterThan(before);
    expect(after.fighters[0].grounded).toBe(true);
  });

  it("catches a fighter who walks off the edge on the ledge", () => {
    const s = standing();
    s.fighters[0].x = fx(79);
    const after = run(s, [Btn.Right, 0], 12);
    expect(after.fighters[0].ledgeRegrabs).toBeGreaterThan(0);
    expect(after.fighters[0].stocks).toBe(3);
  });

  it("KOs a fighter falling well clear of any ledge", () => {
    const s = standing();
    Object.assign(s.fighters[0], {
      x: fx(150),
      y: fx(40),
      grounded: false,
      platform: -1,
      action: "fall",
    });
    const after = run(s, [0, 0], 400);
    expect(after.fighters[0].stocks).toBeLessThan(3);
  });

  it("keeps a fighter at rest exactly where it was", () => {
    const s = standing();
    const after = run(s, [0, 0], 30);
    expect(after.fighters[0].x).toBe(s.fighters[0].x);
    expect(after.fighters[0].y).toBe(0);
    expect(after.fighters[0].grounded).toBe(true);
  });
});

describe("fixed-point sanity", () => {
  it("keeps every simulated quantity integral", () => {
    const s = simulate(120);
    for (const f of s.fighters) {
      for (const v of [f.x, f.y, f.vx, f.vy, f.damage, f.shieldHealth, f.launchSpeed]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
    expect(ONE).toBe(4096);
  });
});

describe("intangibility does not consume the swing", () => {
  /*
   * Found by review, not by play. A hitbox that met an intangible fighter used
   * to be marked as spent on them, so a lingering move that was dodged on its
   * first active frame could never connect on its last — even though the dodge
   * had ended in between. Spot dodge is intangible frames 3-20 and plenty of
   * moves stay active past frame 20, so this made dodging strictly better than
   * the real game's.
   */
  function attackWithLongHitbox(): GameState {
    const s = standing();
    const a = s.fighters[0];
    a.action = "attack";
    a.move = "ftilt";
    a.actionFrame = 0;
    return s;
  }

  it("lets a lingering hitbox connect once intangibility ends", () => {
    const s = attackWithLongHitbox();
    // The fixture hitbox is live on frames 4-6. Four frames of intangibility
    // therefore covers its FIRST active frame and expires before its last —
    // which is the whole point. Set this to 1 and the hitbox is not even live
    // yet when intangibility ends, so the test passes either way and proves
    // nothing. It did, until a mutation check caught it.
    s.fighters[1].intangible = 4;
    const after = run(s, [0, 0], 8);
    expect(after.fighters[1].damage).toBeGreaterThan(0);
  });

  it("still deals nothing on the frame the victim is intangible", () => {
    const s = attackWithLongHitbox();
    s.fighters[1].intangible = 60;
    const after = run(s, [0, 0], 8);
    expect(after.fighters[1].damage).toBe(0);
  });
});

describe("an attacker's freeze does not depend on the victim's invincibility", () => {
  /*
   * A fighter who has just left the respawn platform is invincible and can
   * perfectly well be crouching. Crouch cancel shortens hitlag for *both*
   * fighters, so if the invincible path forgets it, the attacker's freeze
   * changes depending on something they cannot see and did not cause.
   */
  function freezeAgainst(opts: { invincible: boolean; crouching: boolean }): number {
    const s = standing();
    const a = s.fighters[0];
    const v = s.fighters[1];
    a.action = "attack";
    a.move = "ftilt";
    a.actionFrame = 0;
    v.invincible = opts.invincible ? 60 : 0;
    if (opts.crouching) v.action = "crouch";
    // Down must be *held*. Setting the action alone is not enough: the state
    // machine returns the victim to standing on the next frame, well before the
    // hitbox goes live, and crouch cancel then never engages — which made an
    // earlier version of this test compare 9 against 9 and prove nothing.
    const victimInput = opts.crouching ? Btn.Down : 0;
    return run(s, [0, victimInput], 6).fighters[0].hitlag;
  }

  it("freezes the same whether the crouching victim is invincible or not", () => {
    expect(freezeAgainst({ invincible: true, crouching: true })).toBe(
      freezeAgainst({ invincible: false, crouching: true }),
    );
  });

  it("still shortens the freeze when the victim crouches", () => {
    expect(freezeAgainst({ invincible: true, crouching: true })).toBeLessThan(
      freezeAgainst({ invincible: true, crouching: false }),
    );
  });
});
