import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "./acmd/bones";
import { ATTACK, CATCH, catchClearAll, clearAll, frame } from "./acmd/dsl";
import { scriptHitboxes } from "./acmd/hitboxes";
import { runScript } from "./acmd/interpreter";
import { attackFromHitbox } from "./acmd/legacy";
import type { AcmdCommand, AttackParams } from "./acmd/types";
import {
  AIR_DODGE_SLIDE_BRAKE,
  AIR_DODGE_SLIDE_FRAMES,
  DEFAULT_AIR_DODGE,
  airDodgeCharge,
  airDodgeFrames,
} from "./airDodge";
import { DIAGONAL, ONE, byRatio, cosDeg, fx, mul, sinDeg, toFloat } from "./fixed";
import {
  AIR_DODGE_LANDING_SLIDE_MAX,
  AIR_DODGE_LEDGE_FRAMES,
  AIR_DODGE_SLIDE_DISTANCE,
  AIR_DODGE_SLIDE_END_SPEED,
  AIR_DODGE_SLIDE_SPEED,
  AIR_DODGE_SLINGSHOT_DISTANCE,
  AIR_DODGE_TECH_FRAMES,
  ASDI_DISTANCE,
  BOUNCE_FLOOR_LAUNCH_RATIO,
  DIRECTIONAL_AIR_DODGE_LANDING_LAG_MAX,
  DIRECTIONAL_AIR_DODGE_LANDING_LAG_MIN,
  FURAFURA_END_FRAMES,
  GLANCING_BLOW_DEPTH,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_DECAY,
  LAUNCH_SPEED_RATIO,
  LEDGE_REGRAB_LOCKOUT_FRAMES,
  LEDGE_TRUMPED_FRAMES,
  SDI_DISTANCE,
  SET_WEIGHT_FALL_SPEED,
  SET_WEIGHT_GRAVITY,
  SET_WEIGHT_LAUNCH_FRAMES,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
  SHIELD_RELEASE_FRAMES,
  TECH_FRAMES,
  TECH_LOCKOUT,
  TECH_WALL_FRAMES,
  TECH_WALL_HOLD,
  TECH_WINDOW,
} from "./constants";
import { hashState } from "./hash";
import { sweptHitboxOverlaps, sweptHitboxPenetration } from "./hitbox";
import {
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  computeKnockback,
  computeStaleness,
  damageSpeedUpMaxMag,
  effectiveHitstun,
  shieldstunExact,
} from "./knockback";
import { attackerShieldPushback, shieldBubble, shieldDamage, shieldPushback } from "./shield";
import { kineticClear, kineticSetX, kineticSumX, kineticSumY } from "./kinetic";
import { findLedgeGrab, resolveCollision } from "./physics";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import {
  GRAB_MASH_BUTTON,
  GRAB_MIN_FRAMES,
  GRAB_RELEASE_IMMUNITY,
  LEDGE_ATTACK_FRAMES,
  LEDGE_GETUP_FRAMES,
  LEDGE_JUMP_FRAMES,
  LEDGE_ROLL_FRAMES,
  PUMMEL_FRAMES,
  grabHoldFrames,
} from "./states";
import { Btn } from "./types";
import type {
  ActionState,
  FighterAttributes,
  FighterDef,
  FighterState,
  GameState,
  Hitbox,
  InputFrame,
  MatchRules,
  MoveDef,
  StageDef,
  StepEvents,
} from "./types";

/**
 * Plan 3 (combat fidelity), through `step()`: each describe block is one task's
 * behaviour, on a two-fighter flat stage with a hand-built tester whose moves
 * each tests sets up. Formula-level checks live in `knockback.test.ts`.
 */

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

const BASE_DEF: FighterDef = {
  id: "tester",
  name: "Tester",
  series: "test",
  number: 1,
  attributes: ATTRS,
  moves: {
    jab1: move("jab1"),
    ftilt: move("ftilt"),
    nair: move("nair", { landingLag: 8 }),
    // Armoured on frames 1–30, like Kirby's Stone or Donkey Kong's Giant Punch.
    downB: move("downB", { totalFrames: 40, hitboxes: [], superArmourFrames: [1, 30] }),
    grab: move("grab", { totalFrames: 30, hitboxes: [hitbox({ grabbing: true })] }),
  },
  palette: { primary: "#f00", secondary: "#00f", accent: "#ff0", skin: "#fca", outline: "#000", alts: [] },
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

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

function ctxFor(def: FighterDef = BASE_DEF, stage: StageDef = STAGE): SimContext {
  return { fighter: () => def, stage: () => stage };
}

/** Both fighters standing 8 units apart, facing each other, free to act. */
function standing(ctx: SimContext = ctxFor()): GameState {
  const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
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
  s.fighters[1].x = fx(8);
  s.fighters[1].facing = -1;
  return s;
}

interface Frame {
  readonly state: GameState;
  readonly events: StepEvents;
}

/** Step `n` frames; `inputs(i)` gives frame i's inputs. Returns every frame. */
function play(
  s: GameState,
  n: number,
  inputs: (i: number) => readonly InputFrame[],
  ctx: SimContext = ctxFor(),
): Frame[] {
  const out: Frame[] = [];
  let state = s;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < n; i++) {
    const now = inputs(i);
    const r = step(state, now, { prevInputs: prev, ctx });
    out.push(r);
    state = r.state;
    prev = now;
  }
  return out;
}

/** Fighter 0 presses attack once (a jab) and nothing else happens. */
const JAB = (i: number): readonly InputFrame[] => (i === 0 ? [Btn.Attack, 0] : [0, 0]);

/** A fighter whose neutral B throws one 6% pellet (4 units a frame, spent on a hit), on `spawnFrame`. */
function pelletShooter(spawnFrame = 6): FighterDef {
  const pellet = hitbox({ startFrame: 1, endFrame: 90, x: 0, y: 0, damage: fx(6) });
  return {
    ...BASE_DEF,
    moves: {
      ...BASE_DEF.moves,
      neutralB: move("neutralB", {
        totalFrames: 30,
        hitboxes: [],
        projectiles: [
          { id: "pellet", spawnFrame, offsetX: fx(6), offsetY: fx(6), vx: fx(4), vy: 0, gravity: 0, lifetime: 90, hitbox: pellet, destroyOnHit: true, visual: "energy" },
        ],
      }),
    },
  };
}
const SHOOT = (i: number): readonly InputFrame[] => (i === 0 ? [Btn.Special, 0] : [0, 0]);

/* --------------------------------------------- Task 1: super armour -- */

describe("super armour counts the damage once (Plan 3, Task 1)", () => {
  it("adds exactly the damage the hit reports, not twice that", () => {
    const s = standing();
    const v = s.fighters[1];
    v.action = "special";
    v.move = "downB";
    v.actionFrame = 5;
    const frames = play(s, 8, JAB);
    const hit = frames.flatMap((f) => f.events.hits).find((h) => h.victim === 1);
    expect(hit, "the jab should land on the armoured fighter").toBeDefined();
    const after = frames[frames.length - 1].state.fighters[1];
    expect(after.damage).toBe(hit!.damage);
    // Armour: no launch, no hitstun, still in the move.
    expect(after.hitstun).toBe(0);
    expect(after.action).toBe("special");
  });

  // Final wave, part 4 (the Task 1 review's minor): the same jab on a victim who
  // is NOT armoured. Without it the test above would pass for a world in which
  // nothing is ever launched, so this is the arm that says the armour is what
  // stopped the launch: the damage still counts once, and the victim flinches.
  it("control: the same jab on an unarmoured victim counts the damage once and launches", () => {
    const frames = play(standing(), 8, JAB);
    const hit = frames.flatMap((f) => f.events.hits).find((h) => h.victim === 1);
    expect(hit, "the jab should land on the unarmoured fighter").toBeDefined();
    const after = frames[frames.length - 1].state.fighters[1];
    expect(after.damage).toBe(hit!.damage);
    expect(hit!.knockback).toBeGreaterThan(0);
    expect(after.hitstun).toBeGreaterThan(0);
    expect(after.action).not.toBe("stand");
  });

  // Armour has no say in who threw the hit: a projectile meets the same branch.
  // The damage lands once, the victim stays in its move, and, as for any
  // projectile, nobody freezes (the owner is not at the hit).
  it("a projectile on an armoured victim adds the damage once, launches nothing and freezes nobody", () => {
    const ctx = ctxFor(pelletShooter());
    const s = standing(ctx);
    const v = s.fighters[1];
    v.action = "special";
    v.move = "downB";
    v.actionFrame = 5;
    const frames = play(s, 16, SHOOT, ctx);
    const hits = frames.flatMap((f) => f.events.hits).filter((h) => h.victim === 1);
    expect(hits, "the pellet lands once and is spent").toHaveLength(1);
    const after = frames[frames.length - 1].state;
    expect(after.fighters[1].damage).toBe(hits[0].damage);
    expect(hits[0].knockback).toBe(0);
    expect(after.fighters[1].hitstun).toBe(0);
    expect(after.fighters[1].action).toBe("special");
    // On the frame the pellet lands (a hitlag would run out well before the end).
    const landed = frames[frames.findIndex((f) => f.events.hits.length > 0)].state;
    expect(landed.fighters[0].hitlag).toBe(0);
    expect(landed.fighters[1].hitlag).toBe(0);
  });

  it("control: the same pellet on an unarmoured victim launches it", () => {
    const ctx = ctxFor(pelletShooter());
    const frames = play(standing(ctx), 16, SHOOT, ctx);
    const hits = frames.flatMap((f) => f.events.hits).filter((h) => h.victim === 1);
    expect(hits).toHaveLength(1);
    const after = frames[frames.length - 1].state.fighters[1];
    expect(after.damage).toBe(hits[0].damage);
    expect(hits[0].knockback).toBeGreaterThan(0);
    expect(after.action).not.toBe("stand");
  });
});

/* ------------------------------------------------- Task 2: staling -- */

/** Fighter 0 jabs once; fighter 1 holds shield the whole time. */
const JAB_INTO_SHIELD = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Attack : 0, Btn.Shield];

describe("the stale queue remembers shield hits (Plan 3, Task 2)", () => {
  it("queues a move that hits a shield, marked as a shield hit", () => {
    const after = play(standing(), 10, JAB_INTO_SHIELD).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toEqual(["jab1"]);
    expect(after.combat.staleShield).toEqual([true]);
  });

  it("queues an ordinary hit unmarked, in front of the shield hit", () => {
    const shielded = play(standing(), 40, JAB_INTO_SHIELD).at(-1)!.state;
    shielded.fighters[1].action = "stand";
    shielded.fighters[1].hitstun = 0;
    shielded.fighters[1].x = fx(8);
    shielded.fighters[0].x = 0;
    const after = play(shielded, 10, JAB).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toEqual(["jab1", "jab1"]);
    expect(after.combat.staleShield).toEqual([false, true]);
  });

  it("trims the marks with the queue at nine", () => {
    const s = standing();
    s.fighters[0].staleQueue = new Array(9).fill("ftilt");
    s.fighters[0].combat.staleShield = new Array(9).fill(true);
    const after = play(s, 10, JAB).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toHaveLength(9);
    expect(after.combat.staleShield).toEqual([false, true, true, true, true, true, true, true, true]);
  });

  it("deals the shield-staled damage: 1 − 0.09 × 0.85 of fresh/1.05", () => {
    const s = standing();
    s.fighters[0].staleQueue = ["jab1"];
    s.fighters[0].combat.staleShield = [true];
    const hit = play(s, 8, JAB).flatMap((f) => f.events.hits)[0];
    // Fresh is 10 × 1.05; one shield-marked slot is 10 × (1 − 0.0765).
    expect(hit.damage / 4096).toBeCloseTo(10 * (1 - 0.09 * 0.85), 2);
  });

  // Review Focus #3: the stale queue across a rollback.
  it("rolls back with the queue: a re-simulation from a snapshot lands on the same hash", () => {
    const frames = play(standing(), 30, JAB_INTO_SHIELD);
    const snapshot = cloneState(frames[4].state);
    let replay = snapshot;
    let prev: readonly InputFrame[] = JAB_INTO_SHIELD(4);
    for (let i = 5; i < 30; i++) {
      const now = JAB_INTO_SHIELD(i);
      replay = step(replay, now, { prevInputs: prev, ctx: ctxFor() }).state;
      prev = now;
    }
    expect(hashState(replay)).toBe(hashState(frames[29].state));
    // The copy shares nothing with the snapshot it came from.
    const copy = cloneState(frames[29].state);
    copy.fighters[0].combat.staleShield[0] = false;
    expect(frames[29].state.fighters[0].combat.staleShield[0]).toBe(true);
    expect(hashState(copy)).not.toBe(hashState(frames[29].state));
  });

  it("empties the queue and its marks on a KO", () => {
    const s = standing();
    s.fighters[1].staleQueue = ["jab1"];
    s.fighters[1].combat.staleShield = [true];
    s.fighters[1].x = fx(300);
    s.fighters[1].grounded = false;
    const after = play(s, 1, () => [0, 0]).at(-1)!.state.fighters[1];
    expect(after.action).toBe("dead");
    expect(after.staleQueue).toEqual([]);
    expect(after.combat.staleShield).toEqual([]);
  });
});

/* ------------------------------------------- Task 3: Sakurai angle -- */

describe("the Sakurai angle through a real hit (Plan 3, Task 3)", () => {
  const sakuraiDef: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: fx(361), baseKnockback: fx(10) })] }) },
  };
  const ctx = ctxFor(sakuraiDef);

  function angleAgainst(percent: number, airborne: boolean): number {
    const s = standing(ctx);
    s.fighters[1].damage = fx(percent);
    if (airborne) {
      s.fighters[1].grounded = false;
      s.fighters[1].platform = -1;
      s.fighters[1].y = fx(1);
      s.fighters[1].action = "fall";
    }
    const hit = play(s, 8, JAB, ctx).flatMap((f) => f.events.hits)[0];
    return hit.angle;
  }

  it("slides a lightly hit grounded victim along the floor", () => {
    expect(angleAgainst(0, false)).toBe(0);
  });

  it("lifts a heavily hit grounded victim at 38 degrees", () => {
    expect(angleAgainst(150, false)).toBe(fx(38));
  });

  it("sends an airborne victim at 38 degrees even from a light hit", () => {
    expect(angleAgainst(0, true)).toBe(fx(38));
  });
});

describe("flat launches (Plan 3, Task 3)", () => {
  /** The launch speed fighter 1 leaves the freeze with, after a 0° jab of `bkb` set knockback. */
  function launchOf(airborne: boolean): { speed: number; kb: number } {
    const flat: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: 0, fixedKnockback: fx(60) })] }) },
    };
    const ctx = ctxFor(flat);
    const s = standing(ctx);
    if (airborne) Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(1), action: "fall" });
    const frames = play(s, 30, JAB, ctx);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    const released = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
    return { speed: frames[released].state.fighters[1].launchSpeed, kb: frames[hit].events.hits[0].knockback };
  }

  // rubendal `js/knockback.js`: a grounded victim launched at 0° (`groundedZeroAngle`)
  // leaves at 0.8 of the launch speed. The 0.8 is written out here, not read from
  // `GROUNDED_ZERO_LAUNCH_RATIO`, so a changed constant fails this test instead of
  // moving it along (the Task 3 review: the first version was circular).
  it("slides a grounded victim along 0° at 0.8 of the launch speed", () => {
    expect(GROUNDED_ZERO_LAUNCH_RATIO).toEqual([4, 5]);
    const grounded = launchOf(false);
    const airborne = launchOf(true);
    expect(airborne.speed).toBe(mul(airborne.kb, LAUNCH_SPEED_RATIO));
    expect(grounded.speed).toBe(mul(byRatio(grounded.kb, [4, 5]), LAUNCH_SPEED_RATIO));
    expect(grounded.speed / airborne.speed).toBeCloseTo(0.8, 3);
  });
});

// The launch angle a hit resolves to, through `step()`, at the knockbacks the
// angle rules turn on (Plan 3, Task 3 review; final wave, part 4). `knockbackGrowth`
// 0 leaves the formula only its base, so a box's `baseKnockback` IS the knockback
// the hit reports, to the Q12 unit: the edges of the 60, 88 and 120 rules are
// reachable exactly, which the percent-driven tests above cannot do.
describe("the resolved launch angle through a real hit, at an exact knockback (Plan 3, Task 3 review)", () => {
  function hitAt(angle: number, kb: number, grounded: boolean): { angle: number; knockback: number } {
    const def: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle, baseKnockback: kb, knockbackGrowth: 0 })] }) },
    };
    const ctx = ctxFor(def);
    const s = standing(ctx);
    if (!grounded) Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(1), action: "fall" });
    const hit = play(s, 8, JAB, ctx).flatMap((f) => f.events.hits)[0];
    expect(hit, "the jab lands").toBeDefined();
    expect(hit.knockback, "the box fixes the knockback").toBe(kb);
    return hit;
  }
  const SAKURAI = fx(361);

  // SmashWiki "Sakurai angle" (https://www.ssbwiki.com/Sakurai_angle): a grounded
  // victim goes at 0° below 60 knockback and up a ramp from there; rubendal's
  // `SakuraiAngle` is min((kb − 60)/28 × 38 + 1, 38), so 60 itself is 1°, not 0°.
  it("sends a grounded Sakurai hit of exactly 60 knockback at 1°, and one unit less flat", () => {
    expect(hitAt(SAKURAI, fx(60), true).angle).toBe(fx(1));
    expect(hitAt(SAKURAI, fx(60) - 1, true).angle).toBe(0);
  });

  it("ramps a grounded Sakurai hit between 60 and 88: halfway up, at 74, it is 20°", () => {
    expect(hitAt(SAKURAI, fx(74), true).angle).toBe(fx(20));
    // The ramp's own 1° offset would reach past 38° just below 88; the cap holds it.
    expect(hitAt(SAKURAI, fx(87.9), true).angle).toBe(fx(38));
    expect(hitAt(SAKURAI, fx(88), true).angle).toBe(fx(38));
  });

  // SmashWiki "Sakurai angle": "moves with a launch angle of 0 have been given the
  // Sakurai angle-like property of changing to 32 degrees if they deal 120 units
  // of knockback or more"; rubendal `js/knockback.js` applies it to 0 and 180.
  it("lifts a flat 0° hit to 32° from exactly 120 knockback, grounded or in the air", () => {
    for (const grounded of [true, false]) {
      expect(hitAt(0, fx(120), grounded).angle, `grounded ${grounded}`).toBe(fx(32));
      expect(hitAt(0, fx(120) - 1, grounded).angle, `grounded ${grounded}`).toBe(0);
    }
  });

  // UNVERIFIED: the 148° mirror (`resolveAngle`; D56 lists it).
  it("lifts a straight-back 180° hit to 148° from exactly 120 knockback, and not before", () => {
    expect(hitAt(fx(180), fx(120), true).angle).toBe(fx(148));
    expect(hitAt(fx(180), fx(120), false).angle).toBe(fx(148));
    expect(hitAt(fx(180), fx(120) - 1, true).angle).toBe(fx(180));
  });
});

/* ------------------------------------------------------ Task 4: DI -- */

describe("DI needs a tumbling launch (Plan 3, Task 4)", () => {
  /** Fighter 1's launch velocity after fighter 0's jab, holding `held` once it is frozen in hitlag. */
  function launchAfter(percent: number, held: InputFrame): { vx: number; vy: number } {
    let s = standing();
    s.fighters[1].damage = fx(percent);
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const now = [i === 0 ? Btn.Attack : 0, s.fighters[1].hitlag > 0 ? held : 0];
      s = step(s, now, { prevInputs: prev, ctx: ctxFor() }).state;
      prev = now;
      if (s.fighters[1].launchSpeed > 0) break;
    }
    return { vx: s.fighters[1].kinetic.damageX, vy: s.fighters[1].kinetic.damageY };
  }

  // rubendal SSBU-Calculator `js/knockback.js`: `di_able = tumble && |angle| ≥ 0.17`.
  it("ignores the stick on a hit too weak to tumble", () => {
    expect(launchAfter(0, Btn.Down)).toEqual(launchAfter(0, 0));
  });

  // A held Down is also LSI (0.92x the speed), which lowers `vy` all by itself, so
  // a test that holds Down and sees `vy` fall cannot tell DI from LSI: it passes
  // with `applyDI` removed (the Task 4 review). A stick along the x axis is no LSI
  // (LSI reads only the vertical), so what it does to a 45° launch is DI's alone:
  // the angle turns toward the stick by 9.74° × sin 45° (the stick's component
  // perpendicular to the launch), and the speed does not move.
  it("bends a tumbling launch's angle toward the stick and leaves its speed alone, with a stick LSI ignores", () => {
    const none = launchAfter(150, 0);
    const bent = launchAfter(150, Btn.Right);
    const speed = (v: { vx: number; vy: number }): number => Math.hypot(v.vx, v.vy);
    // Directions through the engine's own lookup trig (the layering test bans the float
    // kind here): the launch's unit vector against the cos and sin of the angle it should
    // have. 45° untouched; DI turns it toward the stick (down, for a stick on the right,
    // of a launch up and to the right) by 9.74° × sin 45° = 6.887°: to 38.113°.
    const unit = (v: { vx: number; vy: number }): [number, number] => [v.vx / speed(v), v.vy / speed(v)];
    const direction = (deg: number): [number, number] => [toFloat(cosDeg(fx(deg))), toFloat(sinDeg(fx(deg)))];
    for (const [got, want] of [
      [unit(none), direction(45)],
      [unit(bent), direction(45 - 9.74 * Math.SQRT1_2)],
    ] as const) {
      expect(got[0]).toBeCloseTo(want[0], 3);
      expect(got[1]).toBeCloseTo(want[1], 3);
    }
    expect(speed(bent) / speed(none)).toBeCloseTo(1, 3);
  });

  // The other half: Down is LSI, and a launch LSI acts on is made slower by it.
  it("scales a tumbling launch's speed by LSI, for a stick with a vertical part", () => {
    const none = launchAfter(150, 0);
    const down = launchAfter(150, Btn.Down);
    const speed = (v: { vx: number; vy: number }): number => Math.hypot(v.vx, v.vy);
    expect(speed(down) / speed(none)).toBeCloseTo(0.92, 2);
  });
  // LSI is computed inside `di_able` too: a tumbling launch straight ahead keeps its speed.
  it("does not scale a tumbling launch straight ahead with LSI", () => {
    const flat: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: 0, fixedKnockback: fx(100) })] }) },
    };
    const speedHolding = (held: InputFrame): number => {
      let s = standing(ctxFor(flat));
      Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(1), action: "fall" });
      let prev: readonly InputFrame[] = [0, 0];
      for (let i = 0; i < 30; i++) {
        const now = [i === 0 ? Btn.Attack : 0, s.fighters[1].hitlag > 0 ? held : 0];
        s = step(s, now, { prevInputs: prev, ctx: ctxFor(flat) }).state;
        prev = now;
        if (s.fighters[1].launchSpeed > 0) break;
      }
      return s.fighters[1].launchSpeed;
    };
    expect(speedHolding(Btn.Up)).toBe(speedHolding(0));
  });
});

/* ----------------------------------------- Task 6: balloon speed-up -- */

describe("the balloon speed-up through a real hit (Plan 3, Task 6)", () => {
  /**
   * A jab (and neutral air) with fixed (set) knockback: Ultimate never speeds
   * those up. 5°, not 0°: a flat launch of 120 or more is lifted to 32° (Task 3).
   * Exactly 150, as the growth box below: set knockback is weight-based (Task
   * 16b), and with no growth its formula is its own `bkb` and nothing else. The
   * `fixedKnockback` must still be above 0, or it is not set knockback.
   */
  const setKb = hitbox({ angle: fx(5), baseKnockback: fx(150), knockbackGrowth: 0, fixedKnockback: fx(1) });
  const setKbDef: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [setKb] }), nair: move("nair", { hitboxes: [setKb] }) },
  };
  /** The same launch, 150 knockback nearly straight ahead, from growth instead. */
  const growth = hitbox({ angle: fx(5), baseKnockback: fx(150), knockbackGrowth: 0 });
  const growthDef: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [growth] }), nair: move("nair", { hitboxes: [growth] }) },
  };

  function contact(def: FighterDef): { hitstun: number; knockback: number } {
    const frames = play(standing(ctxFor(def)), 8, JAB, ctxFor(def));
    const i = frames.findIndex((f) => f.events.hits.length > 0);
    return { hitstun: frames[i].state.fighters[1].hitstun, knockback: frames[i].events.hits[0].knockback };
  }

  // The numbers are written out, not read back from `effectiveHitstun` (the Task 6
  // review: the first version compared the sim with the function it calls, so it
  // would have followed a wrong schedule). 150 knockback is a base hitstun of
  // floor(150 × 0.4) − 1 = 59 and 42 real frames sped up (rubendal SSBU-Calculator
  // `ReactionFrameMulSpeedUp`, https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js#L1117).
  it("holds a tumbling victim in hitstun for the sped-up time, not the base", () => {
    const c = contact(growthDef);
    expect(c.knockback).toBe(fx(150));
    expect(c.hitstun).toBe(42);
    expect(c.hitstun).toBeLessThan(59);
  });

  // SmashWiki "Hitstun" (https://www.ssbwiki.com/Hitstun): 90 and 145 knockback
  // give 33 and 41 frames in Ultimate. Counted through `step()`: the frames the
  // victim is out of its freeze and still tumbling, not a field read back.
  it.each([
    [90, 33],
    [145, 41],
  ])("keeps a victim of %i knockback tumbling for %i real frames once its freeze ends", (kb, frames) => {
    const def: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ baseKnockback: fx(kb), knockbackGrowth: 0 })] }) },
    };
    const run = play(standing(ctxFor(def)), 90, JAB, ctxFor(def));
    const hit = run.findIndex((f) => f.events.hits.length > 0);
    expect(hit, "the jab lands").toBeGreaterThanOrEqual(0);
    expect(run[hit].events.hits[0].knockback).toBe(fx(kb));
    const tumbling = run.slice(hit).filter((f) => f.state.fighters[1].action === "tumble" && f.state.fighters[1].hitlag === 0);
    expect(tumbling).toHaveLength(frames);
  });

  // rubendal SSBU-Calculator `js/knockback.js`: the speed-up runs only `if (tumble && !isFKB)`.
  it("leaves a set-knockback launch at its base hitstun", () => {
    const c = contact(setKbDef);
    expect(c.hitstun).toBe(computeHitstun(c.knockback));
  });

  // Review Focus #5: the speed-up against the blast-zone check, which runs once
  // per real frame. A sped-up frame jumps several reaction frames; the KO must
  // come on the first real frame whose end lies past the line, once.
  it("KOs on the first sped-up frame past the blast zone, and only once", () => {
    function koFrame(def: FighterDef): { frame: number; kos: number; lastInside: number } {
      const s = standing(ctxFor(def));
      s.fighters[0].x = fx(60);
      s.fighters[1].x = fx(68);
      s.fighters[1].grounded = false;
      s.fighters[1].platform = -1;
      s.fighters[1].y = fx(30);
      s.fighters[0].y = fx(30);
      s.fighters[0].grounded = false;
      s.fighters[0].platform = -1;
      s.fighters[0].action = "fall";
      s.fighters[1].action = "fall";
      const frames = play(s, 120, JAB, ctxFor(def));
      const at = frames.findIndex((f) => f.events.kos.some((k) => k.port === 1));
      // Before it is used as an index: -1 would read frames[-2] and throw a TypeError
      // that says nothing about the launch that never reached the line.
      expect(at, "fighter 1 is KO'd within the 120 frames played").toBeGreaterThan(0);
      const kos = frames.flatMap((f) => f.events.kos).filter((k) => k.port === 1).length;
      return { frame: at, kos, lastInside: frames[at - 1].state.fighters[1].x };
    }
    const sped = koFrame(growthDef);
    const plain = koFrame(setKbDef);
    expect(sped.frame).toBeGreaterThan(0);
    expect(sped.kos).toBe(1);
    expect(sped.lastInside).toBeLessThanOrEqual(STAGE.blastZone.right);
    // Same 150 knockback and angle: the sped-up launch reaches the line sooner.
    expect(sped.frame).toBeLessThan(plain.frame);
  });
});

/* ------------------------------ Task 6 addendum: the tumble threshold -- */

describe("tumble starts at 80 knockback (Plan 3, Task 6 addendum)", () => {
  // ssbu_ref.mjs `isTumble`: `floor(kb × 0.4) − 1 + 1 ≥ 32`, i.e. knockback 80 —
  // tumble is the reaction frames (hitstun + 1) reaching 32, as in rubendal
  // SSBU-Calculator (https://github.com/rubendal/SSBU-Calculator), whose
  // `Hitstun` is `floor(kb × 0.4) − 1`.

  /** Fighter 1 jabbed with exactly `kb` knockback (no growth): at contact, and once the launch fires. */
  function hitAt(kb: number): { knockback: number; action: string; hitstun: number; launchFaf: number; speedUpMax: number } {
    const def: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ baseKnockback: fx(kb), knockbackGrowth: 0 })] }) },
    };
    const frames = play(standing(ctxFor(def)), 30, JAB, ctxFor(def));
    const i = frames.findIndex((f) => f.events.hits.length > 0);
    const launched = frames.find((f) => f.state.fighters[1].launchSpeed > 0);
    const victim = frames[i].state.fighters[1];
    return {
      knockback: frames[i].events.hits[0].knockback,
      action: victim.action,
      hitstun: victim.hitstun,
      launchFaf: victim.combat.launchFaf,
      speedUpMax: launched === undefined ? -1 : launched.state.fighters[1].kinetic.speedUpMax,
    };
  }

  it("does not tumble at 79.9 knockback", () => {
    const h = hitAt(79.9);
    expect(h.knockback).toBe(fx(79.9));
    expect(h.action).toBe("hitstun");
    expect(h.hitstun).toBe(computeHitstun(h.knockback));
    expect(h.launchFaf).toBe(0);
  });

  it("tumbles at 80 knockback", () => {
    const h = hitAt(80);
    expect(h.knockback).toBe(fx(80));
    expect(h.action).toBe("tumble");
  });

  // 32 reaction frames start the speed-up at 1.2× (rubendal `InitDamageSpeedUp`,
  // 1 + 5 × (32 − 30)/50 = 1.2, https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js#L1047):
  // too little to save a real frame here, so the hitstun is the base's floor(82.4 × 0.4) − 1
  // = 31, but the speed-up is armed. Written out, not read back from the functions the sim calls.
  it("tumbles at 82.4 knockback, with the balloon speed-up applied", () => {
    const h = hitAt(82.4);
    expect(h.knockback).toBe(fx(82.4));
    expect(h.action).toBe("tumble");
    expect(h.launchFaf).toBe(32);
    expect(h.hitstun).toBe(31);
    expect(toFloat(h.speedUpMax)).toBeCloseTo(1.2, 2);
    expect(h.speedUpMax).toBeGreaterThan(ONE);
  });
});

/* ------------------------------------------- Task 7: hitstun cancel -- */

describe("hitstun cancel (Plan 3, Task 7)", () => {
  /** Fighter 1 tumbling in the air, `frame` frames into a long hitstun, launch speed `speed`. */
  function tumbling(frame: number, speed: number): GameState {
    const s = standing();
    const v = s.fighters[1];
    v.action = "tumble";
    v.actionFrame = frame;
    v.hitstun = 60;
    v.grounded = false;
    v.platform = -1;
    v.y = fx(60);
    v.kinetic.damageX = speed;
    v.launchSpeed = speed;
    v.vx = speed;
    return s;
  }
  const press = (b: InputFrame) => (i: number): readonly InputFrame[] => [0, i === 0 ? b : 0];

  // SmashWiki "Hitstun canceling" (https://www.ssbwiki.com/Hitstun_canceling), In
  // Smash 4, which Ultimate keeps: "A player can now only cancel hitstun with an
  // airdodge or aerial after 40 and 45 frames respectively, and only if the current
  // launch speed ... is below 2.5 and 2 respectively." rubendal SSBU-Calculator
  // `parameters.hitstunCancel` agrees (frames 40/45, launch speeds 2.5/2,
  // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js#L26).
  it("air dodges out of hitstun from frame 41 when the launch is slower than 2.5", () => {
    const after = play(tumbling(40, fx(2.4)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1];
    expect(after.action).toBe("airDodge");
    expect(after.hitstun).toBe(0);
  });

  // Final wave, part 4 (the Task 7 review's test gaps).

  // The cancel is for a fighter in the air: `hitstunCancel` returns at once for a
  // grounded one, which neither air dodges (a shield press is a tech's, Task 12)
  // nor attacks out of the tumble, even with both windows open.
  it("does not cancel a tumble that is on the ground, with both windows open", () => {
    const s = tumbling(50, fx(1.9));
    Object.assign(s.fighters[1], { grounded: true, platform: 0, y: 0 });
    for (const b of [Btn.Shield, Btn.Attack]) {
      const after = play(s, 3, press(b)).map((f) => f.state.fighters[1]);
      expect(after.map((v) => v.action), `button ${b}`).toEqual(["tumble", "tumble", "tumble"]);
      expect(after.at(-1)!.hitstun, `button ${b}`).toBe(57);
    }
  });

  it("takes an attack pressed before frame 46 once the window opens, and spends the buffer on it", () => {
    // Pressed at 43 (frame 42 + the step), the aerial window opens at 46: three
    // steps of waiting in hitstun, an aerial on the fourth.
    const frames = play(tumbling(42, fx(1.9)), 5, press(Btn.Attack)).map((f) => f.state.fighters[1]);
    expect(frames.map((v) => v.action)).toEqual(["tumble", "tumble", "tumble", "attack", "attack"]);
    expect(frames[3].move).toBe("nair");
    expect(frames[2].bufferedAction, "held until the window opens").toEqual({ kind: "attack", frame: 1 });
    expect(frames[3].bufferedAction, "spent by the cancel it fired").toBeNull();
  });

  it("spends a buffered shield on the air dodge it fires", () => {
    const frames = play(tumbling(37, fx(2)), 4, (i) => [0, i === 0 ? Btn.Shield : 0]).map((f) => f.state.fighters[1]);
    expect(frames[2].bufferedAction).toEqual({ kind: "shield", frame: 1 });
    expect(frames[3].action).toBe("airDodge");
    expect(frames[3].bufferedAction).toBeNull();
  });

  // "A buffered press is spent only by the cancel it fires" (`hitstunCancel`): an
  // air dodge already spent leaves the shield press buffered, and the aerial a
  // fresh attack then fires is not that press's cancel, so it stays.
  it("leaves a buffered shield alone when a fresh attack fires the aerial instead", () => {
    const s = tumbling(43, fx(1.9));
    s.fighters[1].airDodged = true;
    const frames = play(s, 6, (i) => [0, i === 0 ? Btn.Shield : i === 3 ? Btn.Attack : 0]).map((f) => f.state.fighters[1]);
    expect(frames[2].action).toBe("tumble");
    expect(frames[3].action).toBe("attack");
    expect(frames[3].bufferedAction).toEqual({ kind: "shield", frame: 1 });
  });

  // What becomes of the launch's DAMAGE energy. The cancel clears the hitstun and
  // nothing else: the launch decays by 0.051 a frame (SmashWiki "Knockback", launch
  // speed "decays by 0.051 every frame") through the aerial and through a neutral air
  // dodge, which keeps the tumble's momentum (SmashWiki "Air dodge", Task 20b); a
  // directional dodge keeps it through its slingshot and clears it as the slide
  // starts (WuBor `escape_air.rs`, Task 20c). The Task 7 review asked for "zero after
  // the air dodge", which was the rule at that commit; Tasks 20b and 20c replaced it.
  it("keeps decaying the launch after the aerial and after a neutral air dodge", () => {
    for (const [name, b, from, speed] of [
      ["aerial", Btn.Attack, 45, fx(1.9)],
      ["neutral air dodge", Btn.Shield, 40, fx(2.4)],
    ] as const) {
      const frames = play(tumbling(from, speed), 6, press(b)).map((f) => f.state.fighters[1]);
      expect(frames[0].action, name).not.toBe("tumble");
      let expected = speed;
      for (const [k, v] of frames.entries()) {
        expected -= LAUNCH_SPEED_DECAY;
        expect(v.kinetic.damageX, `${name}, frame ${k}`).toBe(expected);
        expect(v.launchSpeed, `${name}, frame ${k}`).toBe(expected);
      }
    }
  });

  it("carries the launch through a directional air dodge's slingshot and clears it at the slide", () => {
    const frames = play(tumbling(40, fx(2.4)), 7, (i) => [0, i === 0 ? Btn.Shield | Btn.Right : Btn.Right]).map(
      (f) => f.state.fighters[1],
    );
    expect(frames.every((v) => v.action === "airDodge")).toBe(true);
    const cleared = frames.findIndex((v) => v.kinetic.damageX === 0);
    expect(cleared, "the slide starts within the window").toBeGreaterThan(0);
    for (const v of frames.slice(0, cleared)) expect(v.kinetic.damageX).toBeGreaterThan(0);
    for (const v of frames.slice(cleared)) {
      expect(v.kinetic.damageX).toBe(0);
      expect(v.launchSpeed).toBe(0);
    }
  });

  it("does not air dodge on frame 40", () => {
    expect(play(tumbling(39, fx(2.4)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1].action).toBe("tumble");
  });

  it("does not air dodge while the launch is still 2.5 or faster", () => {
    expect(play(tumbling(40, fx(2.5)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1].action).toBe("tumble");
  });

  it("attacks out of hitstun from frame 46 when the launch is slower than 2", () => {
    const after = play(tumbling(45, fx(1.9)), 1, press(Btn.Attack)).at(-1)!.state.fighters[1];
    expect(after.action).toBe("attack");
    expect(after.move).toBe("nair");
    expect(after.hitstun).toBe(0);
  });

  it("does not attack on frame 45, or at a launch of 2", () => {
    expect(play(tumbling(44, fx(1.9)), 1, press(Btn.Attack)).at(-1)!.state.fighters[1].action).toBe("tumble");
    expect(play(tumbling(45, fx(2)), 1, press(Btn.Attack)).at(-1)!.state.fighters[1].action).toBe("tumble");
  });

  it("stays in hitstun when the air dodge is already spent", () => {
    const s = tumbling(40, fx(2.2));
    s.fighters[1].airDodged = true;
    const frames = play(s, 3, press(Btn.Shield));
    expect(frames.map((f) => f.state.fighters[1].action)).toEqual(["tumble", "tumble", "tumble"]);
    expect(frames.at(-1)!.state.fighters[1].hitstun).toBe(57);
  });

  // SmashWiki "Air dodge": "Characters can only air dodge once until they land,
  // get hit, or grab a ledge."
  it("gets the air dodge back from being hit", () => {
    const s = standing();
    s.fighters[1].airDodged = true;
    const hit = play(s, 8, JAB).find((f) => f.events.hits.length > 0)!;
    expect(hit.state.fighters[1].airDodged).toBe(false);
  });

  // A shield held since before the hit — for a ground tech (Task 12) — is not a press.
  it("does not air dodge on a shield that is only held, not pressed", () => {
    let s = tumbling(40, fx(2.2));
    for (let i = 0; i < 3; i++) {
      s = step(s, [0, Btn.Shield], { prevInputs: [0, Btn.Shield], ctx: ctxFor() }).state;
    }
    expect(s.fighters[1].action).toBe("tumble");
  });

  it("takes a press buffered a few frames early, when the window opens", () => {
    const after = play(tumbling(37, fx(2)), 4, (i) => [0, i === 0 ? Btn.Shield : 0]).at(-1)!.state.fighters[1];
    expect(after.action).toBe("airDodge");
  });
});

/* --------------------------------------- Task 8: knockback stacking -- */

describe("knockback stacking (Plan 3, Task 8)", () => {
  /** A jab live from its first frame with a wide box, so it reaches a victim already flying. */
  const quick: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ startFrame: 1, radius: fx(10) })] }) },
  };
  const ctx = ctxFor(quick);
  /**
   * Three fighters: 0 far away, 2 jabs 1, and 1 is already flying from a launch
   * that fighter 0 (or 2 itself, `sameSource`) gave it, `ratio` times as fast as
   * the jab's own launch would be.
   */
  /** Fighter 0 far away, fighter 1 the victim 8 units from fighter 2, who jabs it. */
  function threeFighters(over: FighterDef = quick): GameState {
    const c = ctxFor(over);
    const s = createInitialState(
      "flat",
      [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }],
      RULES,
      12345,
      c,
    );
    const place = [
      { x: fx(-60), facing: 1 },
      { x: fx(8), facing: -1 },
      { x: 0, facing: 1 },
    ];
    s.fighters.forEach((f, i) => {
      Object.assign(f, place[i], { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0 });
    });
    return s;
  }
  const jabFrom2 = (i: number): readonly InputFrame[] => [0, 0, i === 0 ? Btn.Attack : 0];

  function stacked(
    ratio: number,
    sameSource = false,
    hitstun = 50,
  ): {
    victim: GameState["fighters"][number];
    untouched: number;
    hit: StepEvents["hits"][number];
    /** The first launch's speed, as it stood when the second hit connected. */
    before: number;
    jabSpeed: number;
  } {
    const fresh = (): GameState => threeFighters();
    const jab = jabFrom2;
    // The jab's own launch speed, against a victim standing still.
    const dry = play(fresh(), 8, jab, ctx).find((f) => f.events.hits.length > 0)!;
    const jabSpeed = Math.trunc((dry.events.hits[0].knockback * 3) / 100); // knockback × 0.03

    const s = fresh();
    const v = s.fighters[1];
    v.grounded = false;
    v.platform = -1;
    v.y = fx(1);
    v.action = hitstun > 0 ? "tumble" : "fall";
    v.hitstun = hitstun;
    const current = Math.trunc(jabSpeed / ratio);
    // Straight up, so the victim stays in front of the jab while it flies.
    v.kinetic.damageY = current;
    v.launchSpeed = current;
    v.vy = current;
    v.combat.launchSource = sameSource ? 2 : 0;
    const frames = play(s, 8, jab, ctx);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    const victim = frames[hit].state.fighters[1];
    // What the first launch's hitstun reads on the hit frame if nothing touched it.
    // A kept launch keeps its speed, so what it has now is what it had on contact.
    return { victim, untouched: 50 - (hit + 1), hit: frames[hit].events.hits[0], before: victim.launchSpeed, jabSpeed };
  }

  it("keeps the first launch when the new one is 0.5x to 0.9x of it", () => {
    const { victim, untouched } = stacked(0.7);
    expect(victim.hitstun).toBe(untouched);
    expect(victim.pendingFacing).toBe(0);
    expect(victim.damage).toBeGreaterThan(0);
  });

  // SmashWiki "Knockback", stacking: "The resulting angle … is determined by the
  // inverse tangent of both hits' added knockback vectors"; the first hit's launch
  // speed is retained, and the resulting angle cannot be DI'd.
  it("turns a kept launch toward the sum of both launches, at its own speed", () => {
    const { victim, hit, before, jabSpeed } = stacked(0.7);
    const k = victim.kinetic;
    // Straight up, plus the jab's 45° to the right: now up and to the right.
    expect(k.damageX).toBeGreaterThan(0);
    expect(k.damageY).toBeGreaterThan(k.damageX);
    expect(Math.abs(Math.hypot(k.damageX, k.damageY) - victim.launchSpeed)).toBeLessThan(3);
    // Exactly where: the sum of (0, the first launch's speed) and the jab's own 45°
    // launch, whose speed is its knockback × 0.03 (`jabSpeed`), by arctangent (SmashWiki
    // "Knockback", stacking). The jab's angle is 45° on an airborne victim, from
    // fighter 2, who faces right. Float arithmetic here, to a hundredth of a degree.
    // Done as vectors, as the engine's own trig is the only kind allowed here: the kept
    // launch (damageX, damageY) must be along (fromJab, first + fromJab), the sum, which
    // is `sin` of the angle between them under 0.0005 (0.03°) by their cross product, and
    // the same way round (dot > 0).
    const fromJab = (jabSpeed / ONE) * Math.SQRT1_2;
    const [sumX, sumY] = [fromJab, before / ONE + fromJab];
    const [kx, ky] = [k.damageX / ONE, k.damageY / ONE];
    const length = Math.hypot(kx, ky) * Math.hypot(sumX, sumY);
    expect(Math.abs(kx * sumY - ky * sumX) / length, "along the sum").toBeLessThan(0.0005);
    expect(kx * sumX + ky * sumY, "the same way round").toBeGreaterThan(0);
    // The hit's own report says the same (the spark follows the launch it turned).
    expect(toFloat(cosDeg(hit.angle))).toBeCloseTo(kx / Math.hypot(kx, ky), 2);
    expect(toFloat(sinDeg(hit.angle))).toBeCloseTo(ky / Math.hypot(kx, ky), 2);
  });

  it("replaces a launch whose hitstun is over, however fast it still drifts", () => {
    const { victim } = stacked(0.4, false, 0);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.combat.launchSource).toBe(2);
  });

  it("armours through a hit under 0.5x of the live launch", () => {
    const { victim, untouched } = stacked(0.4);
    expect(victim.hitstun).toBe(untouched);
    expect(victim.pendingFacing).toBe(0);
    expect(victim.damage).toBeGreaterThan(0);
  });

  it("lets a stronger hit take over", () => {
    const { victim, untouched } = stacked(0.95);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.hitstun).not.toBe(untouched);
  });

  // A launch parked in the freeze is compared by its knockback's speed, as a flying
  // one is by its vector's (`pendingKnockback`, then `launchSpeed`). The victim is
  // frozen in hitlag with the launch waiting, from a different source, when the jab
  // lands; `ratio` is the jab's speed over the parked launch's. UNVERIFIED reading:
  // the page does not say a launch not yet fired is "live" (see `applyHit`).
  describe("a launch still parked in the freeze", () => {
    function parked(ratio: number): { victim: GameState["fighters"][number]; jabKb: number; parkedKb: number } {
      const dry = play(threeFighters(), 8, jabFrom2, ctx).find((f) => f.events.hits.length > 0)!;
      const jabKb = dry.events.hits[0].knockback;
      const parkedKb = Math.trunc(jabKb / ratio);
      const s = threeFighters();
      const v = s.fighters[1];
      v.grounded = false;
      v.platform = -1;
      v.y = fx(1);
      v.action = "tumble";
      v.hitstun = 50;
      v.hitlag = 20;
      v.pendingKnockback = parkedKb;
      v.pendingAngle = fx(90);
      v.pendingFacing = 1;
      v.combat.launchSource = 0;
      // The launch this one replaced is still on the DAMAGE energy until the freeze
      // ends. A kept hit must turn neither: the parked launch has no vector, and
      // the one beside it is not the launch being kept.
      v.kinetic.damageY = fx(0.5);
      v.launchSpeed = fx(0.5);
      v.vy = fx(0.5);
      const frames = play(s, 8, jabFrom2, ctx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      return { victim: frames[hit].state.fighters[1], jabKb, parkedKb };
    }

    it("keeps it against a hit 0.5x to 0.9x as fast: still parked, untouched, and not turned", () => {
      const { victim, parkedKb } = parked(0.7);
      expect(victim.pendingFacing).toBe(1);
      expect(victim.pendingKnockback).toBe(parkedKb);
      expect(victim.pendingAngle).toBe(fx(90));
      expect(victim.combat.launchSource).toBe(0);
      expect(victim.kinetic.damageX).toBe(0);
      expect(victim.kinetic.damageY).toBe(fx(0.5));
      expect(victim.damage).toBeGreaterThan(0);
      expect(victim.combat.comboHits).toBe(1);
    });

    it("armours through a hit under 0.5x as fast, the same way", () => {
      const { victim, parkedKb } = parked(0.4);
      expect(victim.pendingFacing).toBe(1);
      expect(victim.pendingKnockback).toBe(parkedKb);
      expect(victim.pendingAngle).toBe(fx(90));
      expect(victim.combat.launchSource).toBe(0);
      expect(victim.damage).toBeGreaterThan(0);
    });

    it("lets a hit faster than 0.9x take over, source and knockback", () => {
      const { victim, jabKb } = parked(0.95);
      expect(victim.combat.launchSource).toBe(2);
      expect(victim.pendingKnockback).toBe(jabKb);
    });

    it("holds the freeze at the longer of the two", () => {
      const { victim } = parked(0.7);
      // 20 frames parked, minus the frames before the jab lands, against the jab's own hitlag.
      expect(victim.hitlag).toBeGreaterThan(computeHitlag(fx(10)));
    });
  });

  // SmashWiki "Knockback", stacking: "hitboxes belonging to articles coded separately
  // from a character, such as ... all projectiles, are considered separate sources, and
  // can thus be subjected to knockback stacking with physical moves from the character
  // that produced them." The owner's jab first, then its own pellet: a different source
  // (`candidateKey`: the port against 1000 + the instance), so a weaker pellet keeps the
  // jab's launch instead of taking over from it, as a second jab would.
  describe("a projectile and its owner", () => {
    // The pellet leaves on the first frame so it meets a victim still close to where
    // the owner's launch found it, before that victim has flown out of its way.
    const shooter = pelletShooter(1);
    const sctx = ctxFor(shooter);
    /** Fighter 1 flying straight up from the owner's jab at `ratio` x the pellet's speed; the owner shoots. */
    function pelletOnFlyer(ratio: number, from: number): { victim: GameState["fighters"][number]; untouched: number } {
      const base = (): GameState => {
        const s = standing(sctx);
        return s;
      };
      const dry = play(base(), 16, SHOOT, sctx).find((f) => f.events.hits.length > 0)!;
      const pelletSpeed = Math.trunc((dry.events.hits[0].knockback * 3) / 100);
      const s = base();
      const v = s.fighters[1];
      v.grounded = false;
      v.platform = -1;
      v.y = fx(1);
      v.action = "tumble";
      v.hitstun = 50;
      const current = Math.trunc(pelletSpeed / ratio);
      v.kinetic.damageY = current;
      v.launchSpeed = current;
      v.vy = current;
      v.combat.launchSource = from;
      const frames = play(s, 16, SHOOT, sctx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      return { victim: frames[hit].state.fighters[1], untouched: 50 - (hit + 1) };
    }

    it("stack: a weaker pellet is kept against, not taken over by, the owner's own launch", () => {
      const { victim, untouched } = pelletOnFlyer(0.7, 0);
      expect(victim.hitstun).toBe(untouched);
      expect(victim.pendingFacing).toBe(0);
      expect(victim.combat.launchSource).toBe(0);
      expect(victim.damage).toBeGreaterThan(0);
    });

    it("armours through a pellet under 0.5x of it", () => {
      const { victim, untouched } = pelletOnFlyer(0.4, 0);
      expect(victim.hitstun).toBe(untouched);
      expect(victim.pendingFacing).toBe(0);
    });

    it("control: a launch from that same pellet is the same source, and is replaced", () => {
      // The instance id of the first pellet a match throws is 1 (`candidateKey`: 1000 + id).
      const { victim } = pelletOnFlyer(0.4, 1001);
      expect(victim.pendingFacing).not.toBe(0);
      expect(victim.combat.launchSource).toBe(1001);
    });
  });

  // Review Focus #4: a multi-hit move is one source, so each of its hits takes
  // over from the last, however weak — it never "stacks" with itself.
  it("never stacks a source with itself: a multi-hit's every hit takes over", () => {
    const { victim } = stacked(0.4, true);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.combat.launchSource).toBe(2);
  });

  // Task 11: SDI counts every hit taken in a string, a kept or armoured-through
  // one included (the fighter is hit either way and freezes).
  it("counts a kept hit, and an armoured-through one, in the string", () => {
    expect(stacked(0.7).victim.combat.comboHits).toBe(1);
    expect(stacked(0.4).victim.combat.comboHits).toBe(1);
  });

  // A launch that is replaced leaves nothing of itself behind: not its DAMAGE
  // direction, not its speed-up, not its parked reaction frames.
  describe("a replaced launch leaves no residue", () => {
    /** Fighter 1 is flying straight up from source 1005 with its balloon speed-up armed; 0 jabs it. */
    function flying(): GameState {
      const s = standing(ctx);
      const v = s.fighters[1];
      v.grounded = false;
      v.platform = -1;
      v.y = fx(1);
      v.action = "tumble";
      v.hitstun = 50;
      v.kinetic.damageY = fx(0.5);
      v.launchSpeed = fx(0.5);
      v.vy = fx(0.5);
      v.kinetic.speedUpFaf = 70;
      v.kinetic.speedUpFrame = 70 * ONE;
      v.kinetic.speedUpMax = damageSpeedUpMaxMag(70);
      // ...and set weight's fall too (Task 16b).
      v.kinetic.setWeightFrames = 7;
      v.balloon = true;
      v.combat.launchSource = 1005;
      return s;
    }
    /** The first frame at which the jab's launch has been released. */
    function released(s: GameState): GameState["fighters"][number] {
      const frames = play(s, 20, JAB, ctx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      return frames.slice(hit).find((f) => f.state.fighters[1].hitlag === 0)!.state.fighters[1];
    }
    /** What the jab alone does to a victim standing still. */
    const jabAlone = (() => {
      const hit = play(standing(ctx), 8, JAB, ctx).find((f) => f.events.hits.length > 0)!;
      return mul(hit.events.hits[0].knockback, LAUNCH_SPEED_RATIO);
    })();

    it("when it was flying: the new launch is the whole DAMAGE energy, with no speed-up", () => {
      const v = released(flying());
      expect(v.combat.launchSource).toBe(0);
      expect(v.launchSpeed).toBe(jabAlone);
      expect(v.kinetic.damageX).toBeGreaterThan(0);
      expect(Math.abs(Math.hypot(v.kinetic.damageX, v.kinetic.damageY) - jabAlone)).toBeLessThan(3);
      expect(v.kinetic.speedUpMax).toBe(0);
      expect(v.kinetic.speedUpFaf).toBe(0);
      expect(v.combat.launchFaf).toBe(0);
      expect(v.kinetic.setWeightFrames).toBe(0);
    });

    it("when it was still parked in hitlag: its reaction frames do not survive either", () => {
      const s = flying();
      const v = s.fighters[1];
      v.kinetic.damageY = 0;
      v.launchSpeed = 0;
      v.vy = 0;
      v.kinetic.speedUpMax = 0;
      v.kinetic.speedUpFaf = 0;
      v.kinetic.speedUpFrame = 0;
      v.pendingKnockback = fx(10);
      v.pendingAngle = fx(90);
      v.pendingFacing = 1;
      v.combat.launchFaf = 70;
      v.combat.launchSetWeight = true;
      v.hitlag = 6;
      const after = released(s);
      expect(after.combat.launchSource).toBe(0);
      expect(after.launchSpeed).toBe(jabAlone);
      expect(after.kinetic.speedUpMax).toBe(0);
      expect(after.combat.launchFaf).toBe(0);
      expect(after.kinetic.setWeightFrames).toBe(0);
      expect(after.combat.launchSetWeight).toBe(false);
    });
  });
});

/* --------------------------------------------------- Task 9: shield -- */

describe("shields (Plan 3, Task 9)", () => {
  /** The frame fighter 1's shield took fighter 0's jab, and the frame before. */
  function shieldHit(prepare: (s: GameState) => void = () => {}): { before: Frame; at: Frame } {
    const s = standing();
    prepare(s);
    const frames = play(s, 12, JAB_INTO_SHIELD);
    const i = frames.findIndex((f) => f.events.shieldHits.length > 0);
    return { before: frames[i - 1], at: frames[i] };
  }
  const JAB_DAMAGE = mul(fx(10), STALE_FRESH_BONUS);

  it("takes 1.19x the hit's damage off the shield", () => {
    const { before, at } = shieldHit();
    const lost = before.state.fighters[1].shieldHealth - at.state.fighters[1].shieldHealth;
    expect(lost).toBe(shieldDamage(JAB_DAMAGE) + SHIELD_DECAY_PER_FRAME);
  });

  it("slides the defender (shieldstun + 1) x 0.09 and a grounded attacker 0.04 x damage + 0.025", () => {
    const { at } = shieldHit();
    const [attacker, defender] = at.state.fighters;
    // Shieldstun *not* rounded down (SmashWiki "Shield", pushback table).
    expect(defender.vx).toBe(shieldPushback(shieldstunExact(JAB_DAMAGE)));
    expect(attacker.vx).toBe(-attackerShieldPushback(JAB_DAMAGE));
  });

  it("lets a hit past a worn-down shield: a shield poke", () => {
    const s = standing();
    s.fighters[1].shieldHealth = fx(2);
    // A jab aimed at the feet, outside a shield shrunk to 15% of its radius.
    const low: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ y: fx(0.5), radius: fx(1.5) })] }) },
    };
    const frames = play(s, 10, JAB_INTO_SHIELD, ctxFor(low));
    expect(frames.flatMap((f) => f.events.shieldHits)).toEqual([]);
    expect(frames.at(-1)!.state.fighters[1].damage).toBeGreaterThan(0);
  });

  it("breaks into 400 - percent frames of stun", () => {
    const { at } = shieldHit((s) => {
      s.fighters[1].shieldHealth = fx(1);
      s.fighters[1].damage = fx(120);
    });
    const v = at.state.fighters[1];
    expect(v.action).toBe("shieldBroken");
    expect(v.hitstun).toBe(280);
  });

  // SmashWiki "Stun": after the stun, every character plays FuraFuraEnd, "33 frames
  // from Smash 4 onward", before it can act; the shield comes back at 37.5.
  it("regains consciousness for 33 frames, then stands with 37.5 HP of shield", () => {
    const s = standing();
    const v = s.fighters[1];
    v.action = "shieldBroken";
    v.hitstun = 1;
    v.shieldHealth = 0;
    // Frame 0 ends the stun and starts FuraFuraEnd; mashing no longer shortens it.
    const frames = play(s, FURAFURA_END_FRAMES + 1, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]);
    expect(frames[FURAFURA_END_FRAMES - 1].state.fighters[1].action).toBe("shieldBroken");
    const after = frames[FURAFURA_END_FRAMES].state.fighters[1];
    expect(after.action).toBe("stand");
    expect(after.shieldHealth).toBe(SHIELD_BREAK_RESET + SHIELD_REGEN_PER_FRAME);
  });

  it("does not regenerate while broken", () => {
    const s = standing();
    s.fighters[1].action = "shieldBroken";
    s.fighters[1].hitstun = 100;
    s.fighters[1].shieldHealth = 0;
    expect(play(s, 10, () => [0, 0]).at(-1)!.state.fighters[1].shieldHealth).toBe(0);
  });

  it("mashes out 5.4 frames a button press faster", () => {
    const s = standing();
    s.fighters[1].action = "shieldBroken";
    s.fighters[1].hitstun = 100;
    const still = play(cloneState(s), 10, () => [0, 0]).at(-1)!.state.fighters[1].hitstun;
    const mashed = play(s, 10, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]).at(-1)!.state.fighters[1].hitstun;
    // Five presses: 27 frames earned.
    expect(still - mashed).toBe(27);
  });

  // Final wave, part 4: the Task 9 review's test gaps, each the rule through `step()`.

  /** Fighter 1 broken with `stun` frames left, mashing `inputs`; its stun after `n` frames. */
  const brokenAfter = (n: number, inputs: (i: number) => InputFrame, stun = 100): number => {
    const s = standing();
    Object.assign(s.fighters[1], { action: "shieldBroken", hitstun: stun, shieldHealth: 0 });
    return play(s, n, (i) => [0, inputs(i)]).at(-1)!.state.fighters[1].hitstun;
  };

  // SmashWiki "Stun" (https://www.ssbwiki.com/Stun): a stick input takes 3 frames off a
  // shield break in Ultimate. A direction pressed fresh each time (a held one counts
  // once: the Task 9 review's held-Up minor, above), so the stick alternates.
  it("takes 3 frames off the stun for each fresh stick input", () => {
    const still = brokenAfter(10, () => 0);
    // Left on frames 0, 2, 4, 6, 8: five fresh presses.
    expect(still - brokenAfter(10, (i) => (i % 2 === 0 ? Btn.Left : 0))).toBe(15);
  });

  // UNVERIFIED (`buttonPresses`): buttons pressed on one frame each count. Pinned so a
  // change of that reading is a decision: two buttons are 10.8 frames (10 whole), three
  // 16.2 (16), and a button with a fresh stick direction 8.4 (8), in one frame.
  it("counts every button pressed on one frame, and a stick input with them", () => {
    const still = brokenAfter(1, () => 0);
    expect(still - brokenAfter(1, () => Btn.Attack | Btn.Special)).toBe(10);
    expect(still - brokenAfter(1, () => Btn.Attack | Btn.Special | Btn.Jump)).toBe(16);
    expect(still - brokenAfter(1, () => Btn.Attack | Btn.Left)).toBe(8);
  });

  // The fractional carry: 5.4 a press, so five presses are 27 and the tenths stay for
  // the sixth (`mashFrames`); the carry is the whole struggle's, not each frame's.
  it("keeps the tenths of a frame between presses", () => {
    const still = brokenAfter(12, () => 0);
    expect(still - brokenAfter(12, (i) => (i % 2 === 0 ? Btn.Attack : 0))).toBe(32);
  });

  // The break stun is `400 - percent` whole frames on every route to the break, and a
  // fraction of a percent is ignored (UNVERIFIED rounding, `shieldBreakStun`). Through
  // the hit, above, at 120%; here the other route, a shield held until it decays to
  // nothing, at 99.5% (400 - 99.5 = 300.5, 300 whole frames).
  it("breaks a held shield that decays away into 400 - percent frames too, a fraction of a percent ignored", () => {
    const s = standing();
    Object.assign(s.fighters[1], { action: "shield", shieldHealth: SHIELD_DECAY_PER_FRAME * 3, damage: fx(99.5) });
    const frames = play(s, 12, () => [0, Btn.Shield]);
    const broke = frames.findIndex((f) => f.state.fighters[1].action === "shieldBroken");
    expect(broke, "the held shield wears away within a dozen frames").toBeGreaterThan(0);
    const v = frames[broke].state.fighters[1];
    expect(v.shieldHealth).toBe(0);
    expect(v.hitstun).toBe(300);
    expect(frames[broke].events.shieldBreaks).toEqual([1]);
  });

  // A melee attacker slides off the shield only from the ground (UNVERIFIED: rubendal's
  // formula has no situation, and the replica pushes only a grounded one; `applyHit`).
  it("pushes a grounded melee attacker off the shield and leaves an airborne one where it was", () => {
    const air = standing();
    Object.assign(air.fighters[0], { grounded: false, platform: -1, y: fx(2), action: "fall" });
    const at = play(air, 12, (i) => [i === 0 ? Btn.Attack : 0, Btn.Shield]);
    const hitFrame = at.findIndex((f) => f.events.shieldHits.length > 0);
    expect(hitFrame, "the aerial lands on the shield").toBeGreaterThan(0);
    const airborne = at[hitFrame].state.fighters[0];
    expect(airborne.grounded).toBe(false);
    expect(airborne.kinetic.controlX).toBe(0);
    expect(airborne.kinetic.stopX).toBe(0);
    // The control: the same jab from the ground does push.
    const ground = shieldHit().at.state.fighters[0];
    expect(ground.vx).toBeLessThan(0);
  });

  it("does not push a projectile's owner at all, the pellet hitting the shield from afar", () => {
    const sctx = ctxFor(pelletShooter());
    const s = standing(sctx);
    // Shield already up, and not a parry (a shield held 10 frames is past its window).
    Object.assign(s.fighters[1], { action: "shield", actionFrame: 10, x: fx(40) });
    const frames = play(s, 40, (i) => [i === 0 ? Btn.Special : 0, Btn.Shield], sctx);
    const hit = frames.findIndex((f) => f.events.shieldHits.length > 0);
    expect(hit).toBeGreaterThan(0);
    expect(frames[hit].state.fighters[0].vx).toBe(0);
    expect(frames[hit].state.fighters[0].hitlag).toBe(0);
    expect(frames[hit].state.fighters[1].vx).not.toBe(0);
  });

  // The 1.3 cap (SmashWiki "Shield", pushback table: "no more than 1.3"), through a hit
  // hard enough to overflow it: a 40% smash is (40 × 0.8 × 0.725 + 3) × 0.09 = 2.358
  // before the cap. The unit test pins the function; this pins that the hit uses it.
  it("caps the defender's pushback at 1.3 for a hit that would push further", () => {
    const hard: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ damage: fx(40) })] }) },
    };
    const hctx = ctxFor(hard);
    const frames = play(standing(hctx), 12, JAB_INTO_SHIELD, hctx);
    const hit = frames.find((f) => f.events.shieldHits.length > 0)!;
    expect(hit.state.fighters[1].vx).toBe(fx(1.3));
  });
});

/* ------------------------------------------- Task 10: perfect shield -- */

describe("perfect shield (Plan 3, Task 10)", () => {
  /**
   * Fighter 0 attacks with `attack`; fighter 1 shields and lets go so that the
   * hit lands on frame 2 of the drop — inside the 5-frame parry window.
   */
  function parried(
    def: FighterDef,
    attack: (i: number) => InputFrame,
    gap: number,
    prepare: (s: GameState) => void = () => {},
  ): Frame {
    const ctx = ctxFor(def);
    const setup = (): GameState => {
      const s = standing(ctx);
      prepare(s);
      s.fighters[1].x = fx(gap);
      // Shield already up long enough to be dropped (SHIELD_MIN_HOLD).
      s.fighters[1].action = "shield";
      s.fighters[1].actionFrame = 10;
      return s;
    };
    // Where a held shield takes the hit…
    const held = play(setup(), 40, (i) => [attack(i), Btn.Shield], ctx);
    const k = held.findIndex((f) => f.events.shieldHits.length > 0);
    // …and the same exchange with the shield dropped two frames before it.
    return play(setup(), k + 1, (i) => [attack(i), i < k - 2 ? Btn.Shield : 0], ctx)[k];
  }
  // The extra hitlag rides on the *shield* hitlag (×0.67).
  const JAB_DMG = mul(fx(10), STALE_FRESH_BONUS);
  const JAB_LAG = computeHitlag(JAB_DMG, { shielding: true });

  // The cap order (Task 10 fix round 1), through `step()`: the 0.15 goes inside the
  // formula and the 1.3 cap comes last (SmashWiki "Shield", https://www.ssbwiki.com/Shield,
  // pushback table; rubendal `ShieldPushback`). A 30% smash (31.5 fresh) is
  // (31.5 × 0.8 × 0.725 + 3) × 0.09 = 1.91 before either: capped first (1.3) and then
  // × 0.15 it would slide the defender 0.195; the right order gives 1.91 × 0.15 = 0.287.
  // The cap is not reached after the 0.15, so this pins the order and not the cap
  // itself (`shield.test.ts` pins that).
  it("pushes a parried 30% smash (stun + 1) x 0.09 x 0.15, not 1.3 x 0.15, the old order's cap", () => {
    const smash: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, fsmash: move("fsmash", { totalFrames: 40, hitboxes: [hitbox({ damage: fx(30) })] }) },
    };
    const at = parried(smash, () => 0, 8, (s) => Object.assign(s.fighters[0], { action: "attack", move: "fsmash", actionFrame: 0 }));
    const d = mul(fx(30), STALE_FRESH_BONUS);
    const defender = at.state.fighters[1];
    expect(at.events.shieldHits).toHaveLength(1);
    expect(defender.action).toBe("shieldRelease");
    expect(defender.vx).toBe(shieldPushback(shieldstunExact(d, { smash: true }), true));
    // Written out: (30 × 1.05 × 0.8 × 0.725 + 3) × 0.09 × 0.15.
    expect(toFloat(defender.vx)).toBeCloseTo((31.5 * 0.8 * 0.725 + 3) * 0.09 * 0.15, 3);
    expect(defender.vx).not.toBe(byRatio(fx(1.3), [3, 20]));
  });

  it("freezes a direct melee attacker 14 frames and the defender 11 beyond the hit", () => {
    const at = parried(BASE_DEF, (i) => (i === 0 ? Btn.Attack : 0), 8);
    const [attacker, defender] = at.state.fighters;
    expect(defender.action).toBe("shieldRelease");
    expect(at.events.shieldHits).toHaveLength(1);
    expect(attacker.hitlag).toBe(JAB_LAG + 14);
    expect(defender.hitlag).toBe(JAB_LAG + 11);
    // 0.15 inside the pushback formula, away from the attacker.
    expect(defender.vx).toBe(shieldPushback(shieldstunExact(JAB_DMG), true));
    // No shield damage and no shieldstun.
    expect(defender.shieldHealth).toBe(SHIELD_MAX_HEALTH);
    expect(defender.hitstun).toBe(0);
  });

  /** A fighter whose neutral B throws one 6% pellet; `over` sets the pellet hitbox's own fields. */
  function shooterOf(over: Partial<Hitbox> = {}): FighterDef {
    const pellet = hitbox({ startFrame: 1, endFrame: 90, x: 0, y: 0, damage: fx(6), ...over });
    return {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        neutralB: move("neutralB", {
          totalFrames: 30,
          hitboxes: [],
          projectiles: [
            { id: "pellet", spawnFrame: 6, offsetX: fx(6), offsetY: fx(6), vx: fx(4), vy: 0, gravity: 0, lifetime: 90, hitbox: pellet, destroyOnHit: true, visual: "energy" },
          ],
        }),
      },
    };
  }
  const PELLET_LAG = computeHitlag(fx(6), { shielding: true });

  // Review Focus #2: a parried projectile freezes nobody far away and costs the
  // defender a frame, not eleven.
  it("parries a projectile without freezing its thrower, 1 frame short for the defender", () => {
    const at = parried(shooterOf(), (i) => (i === 0 ? Btn.Special : 0), 40);
    const [owner, defender] = at.state.fighters;
    expect(at.events.shieldHits).toHaveLength(1);
    expect(owner.hitlag).toBe(0);
    expect(defender.hitlag).toBe(PELLET_LAG - 1);
    expect(defender.hitstun).toBe(0);
  });

  // The direct/indirect split through `step()`. A fighter's own move is direct
  // and a projectile indirect unless `Hitbox.direct` says otherwise (the melee
  // test above and the pellet above are the two defaults); a projectile marked
  // direct takes the +8 branch, one marked `direct: false` is the default. A
  // *melee* hit says it through a script's `ATTACK(... direct ...)`: `attackHitbox`
  // carries it into the hitbox (Plan 3, Task 16), pinned below.
  it("reads Hitbox.direct over its default: a direct projectile is +8, an explicit indirect one the default", () => {
    const direct = parried(shooterOf({ direct: true }), (i) => (i === 0 ? Btn.Special : 0), 40);
    expect(direct.events.shieldHits).toHaveLength(1);
    expect(direct.state.fighters[0].hitlag).toBe(0);
    expect(direct.state.fighters[1].hitlag).toBe(PELLET_LAG + 8);
    expect(direct.state.fighters[1].hitstun).toBe(0);

    const indirect = parried(shooterOf({ direct: false }), (i) => (i === 0 ? Btn.Special : 0), 40);
    expect(indirect.state.fighters[0].hitlag).toBe(0);
    expect(indirect.state.fighters[1].hitlag).toBe(PELLET_LAG - 1);
    expect(indirect.state.fighters[1].hitstun).toBe(0);
  });

  // Task 16 wires `direct` through for melee: a script's `ATTACK(... direct=false ...)`
  // reaches the parry branch, where the indirect melee row is +14 / +2 and the direct
  // one +14 / +11 (`PARRY_MELEE_*`, UNVERIFIED against the game: rubendal's
  // `ParryHitlag` and SmashWiki "Perfect shield" disagree on them, see constants.ts).
  it("reads a script's direct flag for a melee box: indirect is +14 / +2, direct +14 / +11", () => {
    const jabOf = (direct: boolean): FighterDef => ({
      ...BASE_DEF,
      scripts: {
        jab1: {
          name: "game_attack11",
          motion: "attack_11",
          commands: [
            frame(4),
            ATTACK({ id: 0, bone: "top", damage: 10, angle: 45, kbg: 100, bkb: 40, size: 5, x: 0, y: 6, z: 8, direct }),
            frame(7),
            clearAll(),
          ],
        },
      },
    });
    const attack = (i: number): InputFrame => (i === 0 ? Btn.Attack : 0);

    const indirect = parried(jabOf(false), attack, 8);
    expect(indirect.events.shieldHits).toHaveLength(1);
    expect(indirect.state.fighters[0].hitlag).toBe(JAB_LAG + 14);
    expect(indirect.state.fighters[1].hitlag).toBe(JAB_LAG + 2);

    const direct = parried(jabOf(true), attack, 8);
    expect(direct.state.fighters[0].hitlag).toBe(JAB_LAG + 14);
    expect(direct.state.fighters[1].hitlag).toBe(JAB_LAG + 11);
  });

  // A hit with no hitlag of its own (0× multiplier) freezes neither fighter, so
  // the parry adds nothing to either: no table constants on top of zero.
  it("freezes nobody when a melee hit has no hitlag of its own", () => {
    const noLag: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ hitlagMultiplier: 0 })] }) },
    };
    const at = parried(noLag, (i) => (i === 0 ? Btn.Attack : 0), 8);
    expect(at.events.shieldHits).toHaveLength(1);
    expect(at.state.fighters[0].hitlag).toBe(0);
    expect(at.state.fighters[1].hitlag).toBe(0);
  });
});

/* --------------------------------------------- Task 11: SDI and ASDI -- */

describe("SDI and ASDI (Plan 3, Task 11)", () => {
  /** Fighter 1 frozen in a hit's hitlag with `hits` consecutive hits taken, pulsing SDI right. */
  function pulse(hits: number): number {
    const s = standing();
    const v = s.fighters[1];
    v.action = "hitstun";
    v.hitstun = 20;
    v.hitlag = 4;
    v.combat.victimFreeze = true;
    v.combat.comboHits = hits;
    const x0 = v.x;
    return play(s, 1, () => [0, Btn.Right]).at(-1)!.state.fighters[1].x - x0;
  }

  // SmashWiki "Smash directional influence" (https://www.ssbwiki.com/Smash_directional_influence):
  // 2 units a pulse in Ultimate, and "for every five consecutive hits a character
  // takes, the SDI distance for the next five hits is increased by 1.15×".
  it("moves 2 units a pulse for the first five hits of a string", () => {
    expect(pulse(5)).toBe(SDI_DISTANCE);
  });

  it("moves 1.15 times as far from the sixth consecutive hit", () => {
    expect(pulse(6)).toBe(Math.trunc((SDI_DISTANCE * 23) / 20));
  });

  it("counts each hit taken, and forgets the string once hitstun is over", () => {
    const hit = play(standing(), 8, JAB);
    const i = hit.findIndex((f) => f.events.hits.length > 0);
    expect(hit[i].state.fighters[1].combat.comboHits).toBe(1);
    const s = standing();
    s.fighters[1].combat.comboHits = 7;
    expect(play(s, 1, () => [0, 0]).at(-1)!.state.fighters[1].combat.comboHits).toBe(0);
  });

  // The count is what the *next* hit reads, so it has to survive the frames
  // between hits and go only when the hitstun does.
  it("keeps the count through hitstun, and drops it when the hitstun runs out", () => {
    const s = standing();
    const v = s.fighters[1];
    v.action = "hitstun";
    v.hitstun = 10;
    v.hitlag = 0;
    v.combat.comboHits = 7;
    const path = play(s, 14, () => [0, 0]).map((f) => f.state.fighters[1]);
    const over = path.findIndex((f) => f.hitstun === 0);
    expect(over).toBeGreaterThan(0);
    expect(path[0].combat.comboHits).toBe(7);
    for (const f of path.slice(0, over)) expect(f.combat.comboHits).toBe(7);
    expect(path[over].combat.comboHits).toBe(0);
  });

  // A string through step(): the same fast jab thrown again and again, each a
  // separate swing (a swing hits a target once), with the victim still in hitstun
  // when each next one lands. The sixth hit's freeze is where the x1.15 shows:
  // 2 units is 8192 in Q12, 9420 with the 1.15.
  it("counts a real string of six hits, and the next SDI pulse is 1.15 times as long", () => {
    const quickJab: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        jab1: move("jab1", {
          totalFrames: 8,
          hitboxes: [hitbox({ startFrame: 4, endFrame: 5, radius: fx(40), damage: fx(2), baseKnockback: fx(45), knockbackGrowth: 0, angle: 0 })],
        }),
      },
    };
    const ctx = ctxFor(quickJab);
    let s = standing(ctx);
    let prev: readonly InputFrame[] = [0, 0];
    let hits = 0;
    let pulse: number | undefined;
    let countAtSixth: number | undefined;
    for (let i = 0; i < 200; i++) {
      const v = s.fighters[1];
      // Mash only on the sixth hit's freeze, on a frame that can pulse, so the
      // victim stays where the next swings reach it until then.
      const mashing = v.combat.comboHits >= 6 && v.hitlag > 0 && v.hitlag % 4 === 0;
      const now = [i % 2 === 0 && hits < 6 ? Btn.Attack : 0, mashing ? Btn.Right : 0];
      const x0 = v.x;
      const r = step(s, now, { prevInputs: prev, ctx });
      hits += r.events.hits.length;
      if (hits === 6 && countAtSixth === undefined) countAtSixth = r.state.fighters[1].combat.comboHits;
      if (mashing && pulse === undefined) pulse = r.state.fighters[1].x - x0;
      s = r.state;
      prev = now;
    }
    expect(hits).toBe(6);
    expect(countAtSixth).toBe(6);
    expect(pulse).toBe(9420);
    expect(pulse).toBe(byRatio(SDI_DISTANCE, [23, 20]));
  });

  /** Fighter 1's position change on the frame its hitlag from `hb` ends, holding `stick` (up by default). */
  function asdi(hb: Hitbox, axis: "x" | "y" = "y", stick: number = Btn.Up): number {
    const def: FighterDef = { ...BASE_DEF, moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hb] }) } };
    let s = standing(ctxFor(def));
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const v = s.fighters[1];
      const now = [i === 0 ? Btn.Attack : 0, v.hitlag > 0 ? stick : 0];
      const before = v[axis];
      const wasFrozen = v.hitlag === 1;
      s = step(s, now, { prevInputs: prev, ctx: ctxFor(def) }).state;
      prev = now;
      if (wasFrozen) return s.fighters[1][axis] - before;
    }
    throw new Error("never released");
  }

  // SmashWiki "Smash directional influence": in Ultimate ASDI is "only applicable
  // on moves with an electric, paralyze, crumple, or autoshift effect", and not on
  // a launch between 70° and just under 110°.
  it("shifts the victim of an electric hit as the freeze ends", () => {
    expect(asdi(hitbox({ effect: "electric", angle: fx(45) }))).toBe(ASDI_DISTANCE);
  });

  it("does not shift the victim of an ordinary hit", () => {
    expect(asdi(hitbox({ angle: fx(45) }))).toBe(0);
  });

  it("does not shift the victim of a vertical electric hit", () => {
    expect(asdi(hitbox({ effect: "electric", angle: fx(90) }))).toBe(0);
  });

  // "Any angle between 70° and just under 110°" is vertical: 70 is in, 110 is out.
  for (const [degrees, shifts] of [
    [69, true],
    [70, false],
    [109, false],
    [110, true],
  ] as const) {
    it(`${shifts ? "shifts" : "does not shift"} the victim of an electric hit launched at ${degrees} degrees`, () => {
      expect(asdi(hitbox({ effect: "electric", angle: fx(degrees) }))).toBe(shifts ? ASDI_DISTANCE : 0);
    });
  }

  it("shifts the victim of an electric hit toward a sideways stick, by the same distance", () => {
    expect(asdi(hitbox({ effect: "electric", angle: fx(45) }), "x", Btn.Left)).toBe(-ASDI_DISTANCE);
  });

  it("shifts a paralyzing hit's victim too", () => {
    expect(asdi(hitbox({ effect: "paralyze", angle: fx(45) }))).toBe(ASDI_DISTANCE);
  });

  // A diagonal stick shifts 1/sqrt(2) of the distance along each axis, so the
  // shift is as long as a straight one: 4096 * 0.7071 = 2896 per axis.
  it("shortens each axis of a diagonal shift to 1/sqrt(2)", () => {
    const hb = hitbox({ effect: "electric", angle: fx(45) });
    const diagonal = Math.trunc((ASDI_DISTANCE * 2896) / ONE);
    expect(asdi(hb, "x", Btn.Left | Btn.Up)).toBe(-diagonal);
    expect(asdi(hb, "y", Btn.Left | Btn.Up)).toBe(diagonal);
  });

  // The victim stands on the stage, so a shift straight down would sink it a
  // unit into the floor: the shift is kept out of the stage like SDI is (below).
  it("keeps the automatic shift out of the floor", () => {
    expect(asdi(hitbox({ effect: "electric", angle: fx(45) }), "y", Btn.Down)).toBe(0);
  });
});

/*
 * SDI and ASDI move a fighter who is frozen, and a frozen fighter skips the
 * collision phase, so the shift must be kept out of the stage's solid bodies
 * on its own (`clampShiftToStage`). Plan 2's final review noted the gap:
 * "SDI during hitlag can leave a fighter inside a stage body".
 */
describe("SDI cannot push a fighter into the stage (Plan 3, Task 11)", () => {
  /**
   * Fighter 1, in hitstun and frozen for 20 frames at (`x`, `y`) with no launch
   * parked, mashes `stick` on every other frame: five pulses (hitlag 20, 16, 12,
   * 8, 4), 2 units each, ten in all. Returns where it is after the freeze and
   * after `after` frames of play on top of that.
   */
  function mashed(x: number, y: number, stick: number, after = 0, ctx: SimContext = ctxFor()) {
    const s = standing(ctx);
    const v = s.fighters[1];
    v.x = x;
    v.y = y;
    v.grounded = false;
    v.platform = -1;
    v.action = "hitstun";
    v.hitstun = 20 + after;
    v.hitlag = 20;
    v.combat.victimFreeze = true;
    const frames = play(s, 20 + after, (i) => [0, i < 20 && i % 2 === 0 ? stick : 0], ctx);
    return {
      frozen: frames[19].state.fighters[1],
      path: frames.map((f) => f.state.fighters[1]),
    };
  }

  it("holds a fighter above the floor on the surface", () => {
    const { frozen, path } = mashed(0, fx(3), Btn.Down, 40);
    expect(frozen.y).toBe(0);
    // ...and it is still on the stage afterwards, rather than falling through.
    expect(Math.min(...path.map((f) => f.y))).toBe(0);
  });

  it("holds a fighter above a soft platform on top of it", () => {
    const soft: StageDef = {
      ...STAGE,
      platforms: [...STAGE.platforms, { x: 0, y: fx(40), halfWidth: fx(20), soft: true, ledges: false }],
    };
    const { frozen, path } = mashed(0, fx(43), Btn.Down, 40, ctxFor(BASE_DEF, soft));
    expect(frozen.y).toBe(fx(40));
    expect(Math.min(...path.map((f) => f.y))).toBe(fx(40));
  });

  it("stops a fighter beside the stage at the wall instead of letting it in", () => {
    // The stage reaches x = 80; the fighter's body is 4 wide, so it stops at 84.
    const { frozen, path } = mashed(fx(87), fx(-10), Btn.Left, 40);
    expect(frozen.x).toBe(fx(84));
    expect(Math.min(...path.map((f) => f.x))).toBe(fx(84));
  });

  it("stops a fighter under the stage at its underside", () => {
    // The body is 60 deep and the fighter 12 tall: it stops with its head at -60.
    const { frozen, path } = mashed(0, fx(-73), Btn.Up, 40);
    expect(frozen.y).toBe(fx(-72));
    expect(Math.max(...path.map((f) => f.y))).toBeLessThanOrEqual(fx(-72));
  });

  it("leaves a fighter in open air to SDI as far as it likes", () => {
    const { frozen } = mashed(fx(120), fx(60), Btn.Left);
    expect(frozen.x).toBe(fx(110));
  });
});

/* -------------------------------------------- Task 12: tech and bounce -- */

describe("tech and bounce (Plan 3, Task 12)", () => {
  /**
   * Fighter 1 tumbling at (x, y) along (vx, vy) — a launch of that speed — with
   * 60 frames of hitstun left. Fighter 0 is parked out of the way. A launch
   * under 0.8 lands; 0.8 or more bounces unless teched.
   */
  function flying(x: number, y: number, vx: number, vy: number): GameState {
    const s = standing();
    s.fighters[0].x = fx(-70);
    const v = s.fighters[1];
    Object.assign(v, { x: fx(x), y: fx(y), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60 });
    v.kinetic.damageX = fx(vx);
    v.kinetic.damageY = fx(vy);
    v.launchSpeed = Math.abs(fx(vx)) + Math.abs(fx(vy)); // every launch here is along one axis
    v.vx = fx(vx);
    v.vy = fx(vy);
    return s;
  }
  /** Run until fighter 1 touches something; `input(i)` is fighter 1's input. */
  function until(s: GameState, input: (i: number) => InputFrame, n = 40): Frame[] {
    return play(s, n, (i) => [0, input(i)]);
  }
  const landing = (frames: Frame[]) => frames.findIndex((f) => f.state.fighters[1].action !== "tumble");

  // SmashWiki "Tech" (https://www.ssbwiki.com/Tech): an 11-frame window, and no
  // second try for 40 frames after an input.
  it("opens an 11-frame window on a shield press, and locks out presses for 40", () => {
    const s = standing();
    const after = play(s, 1, () => [0, Btn.Shield]).at(-1)!.state.fighters[1].combat;
    expect([after.techWindow, after.techLockout]).toEqual([TECH_WINDOW, TECH_LOCKOUT]);
    const again = play(s, 6, (i) => [0, i === 0 || i === 5 ? Btn.Shield : 0]).at(-1)!.state.fighters[1].combat;
    expect(again.techWindow).toBe(TECH_WINDOW - 5);
  });

  it("techs in place when shield was pressed within 11 frames of landing", () => {
    const frames = until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield : 0));
    const v = frames[landing(frames)].state.fighters[1];
    expect(v.action).toBe("tech");
    expect(v.hitstun).toBe(0);
    expect(v.launchSpeed).toBe(0);
  });

  // Review Focus #1: the press on the very frame the fighter lands.
  it("techs on a press made on the frame of landing itself", () => {
    const dry = until(flying(0, 6, 0, -2), () => 0);
    const k = landing(dry);

    const frames = until(flying(0, 6, 0, -2), (i) => (i === k ? Btn.Shield : 0));
    expect(frames[k].state.fighters[1].action).toBe("tech");
  });

  // The press at k - 11 is the 12th frame back from the landing: its window ran
  // out on the frame before. UNVERIFIED boundary: SmashWiki "Lucario (SSBU)/Techs"
  // says 12 (see `TECH_WINDOW`).
  it("misses the tech when its window had run out a frame before landing (the press 11 frames back), and lies down", () => {
    const dry = until(flying(0, 20, 0, -0.6), () => 0);
    const k = landing(dry);
    const frames = until(flying(0, 20, 0, -0.6), (i) => (i === k - TECH_WINDOW ? Btn.Shield : 0));
    expect(frames[k].state.fighters[1].action).toBe("downed");
  });

  it("misses the tech when a press 30 frames early locked the second one out", () => {
    const dry = until(flying(0, 45, 0, -0.6), () => 0, 60);
    const k = landing(dry);
    expect(k).toBeGreaterThan(30);
    const frames = until(flying(0, 45, 0, -0.6), (i) => (i === k - 30 || i === k - 2 ? Btn.Shield : 0), 60);
    expect(frames[k].state.fighters[1].action).toBe("downed");
  });

  it("rolls when the stick is held as it techs", () => {
    const frames = until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield | Btn.Right : Btn.Right));
    const k = landing(frames);
    expect(frames[k].state.fighters[1].action).toBe("techRoll");
    expect(frames[k + 3].state.fighters[1].x).toBeGreaterThan(frames[k].state.fighters[1].x);
  });

  it("is intangible from the first frame of the tech", () => {
    const frames = until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield : 0));
    const k = landing(frames);
    expect(frames[k + 1].state.fighters[1].intangible).toBeGreaterThan(0);
  });

  // rubendal SSBU-Calculator `js/knockback.js`: the floor is techable at a launch
  // of 3 or less; a tumbling fighter bounces off at 0.8 or more, keeping 0.9 of
  // the launch off a floor (`damage_fly_reflect_d_speed_mul`; the wall and the
  // ceiling keep 0.95, below). SmashWiki "Hitstun": hitstun after a bounce is
  // 0.8× (the Smash 4 value Ultimate keeps).
  it("bounces off the floor when too fast to tech, keeping 0.9 of the launch and 0.8 of the hitstun", () => {
    const frames = until(flying(0, 6, 0, -3.5), (i) => (i === 0 ? Btn.Shield : 0));
    const k = frames.findIndex((f) => f.state.fighters[1].vy > 0);
    const before = frames[k - 1].state.fighters[1];
    const v = frames[k].state.fighters[1];
    expect(v.action).toBe("tumble");
    expect(v.grounded).toBe(false);
    expect(v.hitstun).toBe(Math.floor(((before.hitstun - 1) * 4) / 5));
    // The launch the body met the floor with is the last frame's, less this
    // frame's decay; the floor keeps 0.9 of it (`damage_fly_reflect_d_speed_mul`,
    // rubendal `applyDecaySpeedUp`).
    const met = before.launchSpeed - LAUNCH_SPEED_DECAY;
    const metY = Math.abs(Math.trunc((before.kinetic.damageY * met) / before.launchSpeed));
    expect(v.launchSpeed).toBe(Math.trunc((met * 9) / 10));
    expect(v.kinetic.damageY).toBe(Math.trunc((metY * 9) / 10)); // up, away from the floor
  });

  it("lies down after a slow tumbling landing with no tech", () => {
    const frames = until(flying(0, 2, 0, -0.5), () => 0);
    expect(frames[landing(frames)].state.fighters[1].action).toBe("downed");
  });

  // The stage's side is a wall: a hard platform 60 units deep.
  it("techs off a wall at up to 6, and bounces off it otherwise", () => {
    const tech = until(flying(92, -20, -4, 0), (i) => (i === 0 ? Btn.Shield : 0));
    expect(tech[landing(tech)].state.fighters[1].action).toBe("techWall");
    const bounce = until(flying(92, -20, -4, 0), () => 0);
    const k = bounce.findIndex((f) => f.state.fighters[1].vx > 0);
    expect(k).toBeGreaterThan(0);
    expect(bounce[k].state.fighters[1].action).toBe("tumble");
  });

  // rubendal `js/knockback.js`: techable at a launch speed of 3 or less on the
  // floor and 6 or less on a wall or ceiling. The launch decays 0.051 before it
  // meets the surface, so each case starts 0.051 faster.
  it.each([
    [3, "tech"],
    [3.1, "tumble"],
  ])("techs the floor at a launch of %f, or not", (speed, action) => {
    const frames = until(flying(0, 1, 0, -(speed + 0.051)), (i) => (i === 0 ? Btn.Shield : 0), 3);
    expect(frames[0].state.fighters[1].action).toBe(action);
  });

  it.each([
    [6, "techWall"],
    [6.1, "tumble"],
  ])("techs a wall at a launch of %f, or not", (speed, action) => {
    const frames = until(flying(85, -20, -(speed + 0.051), 0), (i) => (i === 0 ? Btn.Shield : 0), 3);
    expect(frames[0].state.fighters[1].action).toBe(action);
    if (action === "tumble") expect(frames[0].state.fighters[1].vx).toBeGreaterThan(0);
  });

  // A tumbling body that meets the floor while its launch still points up a
  // little (gravity carried it down) bounces *up* and leaves the floor — it may
  // skip again later, but never bounces back into the floor frame after frame.
  it("bounces up off the floor even when its launch still pointed upward", () => {
    const s = flying(0, 1, 2, 0.3);
    s.fighters[1].kinetic.gravityY = -fx(1.5);
    s.fighters[1].vy = fx(0.3) - fx(1.5);
    const frames = until(s, () => 0, 12);
    const bounced = frames
      .map((f, i) => (i > 0 && f.state.fighters[1].hitstun < frames[i - 1].state.fighters[1].hitstun - 1 ? i : -1))
      .filter((i) => i >= 0);
    expect(bounced.length).toBeGreaterThan(0);
    for (const i of bounced) {
      expect(frames[i].state.fighters[1].kinetic.damageY).toBeGreaterThan(0);
      expect(frames[i + 1].state.fighters[1].y).toBeGreaterThan(0);
      expect(bounced).not.toContain(i + 1);
    }
  });

  // SmashWiki "Tech" (Ultimate): "the shield button can be held for much longer
  // than the 11 frame window and a tech can still be performed on the ground."
  it("techs the ground with a shield held long past the window", () => {
    const dry = until(flying(0, 20, 0, -0.6), () => 0);
    const k = landing(dry);
    expect(k).toBeGreaterThan(TECH_WINDOW + 5);
    const frames = until(flying(0, 20, 0, -0.6), () => Btn.Shield);
    expect(frames[k].state.fighters[1].action).toBe("tech");
  });

  // …and the held shield is not a press: it does not spend the air dodge through
  // hitstun cancel on the way down (Task 7), so the landing is still a tech.
  it("holds shield through the hitstun-cancel window without air dodging, then techs", () => {
    let s = flying(0, 30, 0, -0.6);
    s.fighters[1].actionFrame = 38;
    let prev: readonly InputFrame[] = [0, Btn.Shield];
    const actions: string[] = [];
    for (let i = 0; i < 60; i++) {
      s = step(s, [0, Btn.Shield], { prevInputs: prev, ctx: ctxFor() }).state;
      prev = [0, Btn.Shield];
      actions.push(s.fighters[1].action);
      if (s.fighters[1].action !== "tumble") break;
    }
    expect(actions).not.toContain("airDodge");
    expect(actions.at(-1)).toBe("tech");
  });

  // SmashWiki "Tech" (Ultimate): "Teching while reeling works on the ground once
  // more." Reeling is a kind of tumble; the replica's `tumble` covers it.
  it("techs a reeling landing (a tumble at 100% or more, along a low angle)", () => {
    const s = flying(0, 3, 1.5, -1.5);
    s.fighters[1].damage = fx(120);
    const frames = until(s, (i) => (i === 0 ? Btn.Shield : 0));
    expect(frames[landing(frames)].state.fighters[1].action).toBe("tech");
  });

  it("techs off the stage's underside", () => {
    const frames = until(flying(0, -78, 0, 4), (i) => (i === 0 ? Btn.Shield : 0));
    expect(frames[landing(frames)].state.fighters[1].action).toBe("techCeiling");
  });

  /* -- the seam: what `resolveCollision` reports, and what a bounce is not -- */

  // Plan 2's ECB rules: a body inside the wall is pushed clear, but only motion
  // *into* the wall is stopped. Only a wall that stopped something is a wall to
  // tech or bounce off; a launch sliding along its face is not.
  it("reports the wall that stopped the fighter, and no wall when it only pushed it clear", () => {
    const into = standing();
    Object.assign(into.fighters[1], { x: fx(83.5), y: fx(-20), grounded: false, platform: -1 });
    into.fighters[1].kinetic.damageX = -fx(2);
    into.fighters[1].vx = -fx(2);
    const hit = resolveCollision(into.fighters[1], fx(86.5), fx(-20), STAGE, ATTRS, 1);
    expect([hit.wall, hit.ceiling, hit.landed]).toEqual([-1, false, false]);

    const along = standing();
    Object.assign(along.fighters[1], { x: fx(83), y: fx(-20), grounded: false, platform: -1 });
    along.fighters[1].kinetic.damageY = fx(2);
    along.fighters[1].vy = fx(2);
    const slid = resolveCollision(along.fighters[1], fx(83), fx(-22), STAGE, ATTRS, 1);
    expect([slid.blocked, slid.wall, slid.ceiling]).toEqual([true, 0, false]);
    expect(along.fighters[1].x).toBe(fx(84));
  });

  it("does not bounce a tumbling fighter that slides up the wall without moving into it", () => {
    // Inside the wall's reach and rising fast: pushed out, never stopped.
    const frames = until(flying(83.5, -30, 0, 3), () => 0, 2);
    const v = frames[0].state.fighters[1];
    expect(v.hitstun).toBe(59);
    expect(v.kinetic.damageX).toBe(0);
  });

  // SmashWiki "Double jump" (https://www.ssbwiki.com/Double_jump): double jumps
  // come back on landing and are "not given back ... upon being put into
  // hitstun". A bounce off the floor is not a landing; a tech is.
  it("keeps the jumps spent through a bounce, and spends the ground jump of a fighter that had not", () => {
    for (const [used, want] of [
      [2, 2],
      [0, 1],
    ] as const) {
      const s = flying(0, 6, 0, -3.5);
      s.fighters[1].jumpsUsed = used;
      const frames = until(s, () => 0);
      const k = frames.findIndex((f) => f.state.fighters[1].vy > 0);
      expect(frames[k].state.fighters[1].jumpsUsed, `jumpsUsed ${used}`).toBe(want);
    }
  });

  it("gives the jumps back on a floor tech, which is a landing", () => {
    const s = flying(0, 6, 0, -2);
    s.fighters[1].jumpsUsed = 2;
    const frames = until(s, (i) => (i === 0 ? Btn.Shield : 0));
    expect(frames[landing(frames)].state.fighters[1].jumpsUsed).toBe(0);
  });

  /* -- fix round 1: the bounce ratios, gravity, the wall hold -- */

  // The vanilla params (`damage_fly_reflect_d_speed_mul` 0.9, `damage_fly_reflect_speed_mul`
  // 0.95) and rubendal `applyDecaySpeedUp`: see `BOUNCE_FLOOR_LAUNCH_RATIO`. The launch the
  // body meets a surface with is the last frame's, less this frame's decay.
  /** The launch of `before` after one frame's decay, as a (speed, x, y) it would meet a surface with. */
  const met = (before: FighterState) => {
    const speed = before.launchSpeed - LAUNCH_SPEED_DECAY;
    const along = (c: number) => Math.abs(Math.trunc((c * speed) / before.launchSpeed));
    return { speed, x: along(before.kinetic.damageX), y: along(before.kinetic.damageY) };
  };

  it("bounces off a wall keeping 0.95 of the launch and 0.8 of the hitstun, and keeps falling", () => {
    const frames = until(flying(92, -20, -4, 0), () => 0);
    const k = frames.findIndex((f) => f.state.fighters[1].vx > 0);
    const before = frames[k - 1].state.fighters[1];
    const v = frames[k].state.fighters[1];
    const m = met(before);
    expect(v.launchSpeed).toBe(Math.trunc((m.speed * 19) / 20));
    expect(v.kinetic.damageX).toBe(Math.trunc((m.x * 19) / 20)); // back, away from the wall
    expect(v.hitstun).toBe(Math.floor(((before.hitstun - 1) * 4) / 5));
    // A wall bounce keeps gravity (rubendal `resetGravity` is false there): the
    // fighter does not hang where it struck, and `vy` is still the energy sum.
    expect(v.kinetic.gravityY).toBeLessThan(0);
    expect(v.vy).toBe(v.kinetic.gravityY);
  });

  it("bounces off the stage's underside sent downward, keeping 0.95 and 0.8", () => {
    const frames = until(flying(0, -78, 0, 4), () => 0);
    const k = frames.findIndex((f) => f.state.fighters[1].kinetic.damageY < 0);
    expect(k).toBeGreaterThan(0);
    const before = frames[k - 1].state.fighters[1];
    const v = frames[k].state.fighters[1];
    const m = met(before);
    expect(v.action).toBe("tumble");
    expect(v.launchSpeed).toBe(Math.trunc((m.speed * 19) / 20));
    expect(v.kinetic.damageY).toBe(-Math.trunc((m.y * 19) / 20));
    expect(v.hitstun).toBe(Math.floor(((before.hitstun - 1) * 4) / 5));
  });

  it("resets gravity on a floor bounce", () => {
    const s = flying(0, 6, 0, -3.5);
    const frames = until(s, () => 0);
    const k = frames.findIndex((f) => f.state.fighters[1].vy > 0);
    expect(frames[k].state.fighters[1].kinetic.gravityY).toBe(0);
  });

  // `passive_wall_stop_frame` is 5 (see `TECH_WALL_HOLD`): UNVERIFIED as a hold.
  it("holds on the wall for 5 frames after a wall tech, then falls", () => {
    const frames = until(flying(92, -20, -4, 0), (i) => (i === 0 ? Btn.Shield : 0));
    const t = frames.findIndex((f) => f.state.fighters[1].action === "techWall");
    expect(t).toBeGreaterThan(0);
    const y = frames[t].state.fighters[1].y;
    for (let i = 1; i <= TECH_WALL_HOLD; i++) expect(frames[t + i].state.fighters[1].y, `frame +${i}`).toBe(y);
    expect(frames[t + TECH_WALL_HOLD + 1].state.fighters[1].y).toBeLessThan(y);
  });

  /* -- fix round 1: tumbling after the hitstun (SSBU DAMAGE_FALL) -- */

  /** `flying`, once the hitstun is over: tumbling in the air with the launch still going. */
  function falling(x: number, y: number, vx: number, vy: number): GameState {
    const s = flying(x, y, vx, vy);
    Object.assign(s.fighters[1], { action: "tumbleFall", hitstun: 0 });
    return s;
  }
  const touched = (frames: Frame[]) => frames.findIndex((f) => f.state.fighters[1].action !== "tumbleFall");

  // SmashWiki "Tumbling" (https://www.ssbwiki.com/Tumbling): "Tumbling (or
  // DamageFall internally ...)", "After hitstun ends, tumbling characters can
  // carry out most normal airborne actions".
  it("keeps tumbling when its hitstun ends in the air: tumbleFall, not fall", () => {
    const s = flying(0, 40, 0, -0.6);
    s.fighters[1].hitstun = 4;
    const frames = until(s, () => 0, 8);
    const k = frames.findIndex((f) => f.state.fighters[1].action !== "tumble");
    expect(frames[k].state.fighters[1]).toMatchObject({ action: "tumbleFall", hitstun: 0, grounded: false });
    expect(frames.at(-1)!.state.fighters[1].action).toBe("tumbleFall");
  });

  it("ends a reel that never tumbled as a plain fall", () => {
    const s = flying(0, 40, 0, -0.6);
    Object.assign(s.fighters[1], { action: "hitstun", hitstun: 4 });
    const frames = until(s, () => 0, 8);
    expect(frames.at(-1)!.state.fighters[1].action).toBe("fall");
  });

  // "If tumbling characters hit the ground without teching, they will land into a
  // lying position" — DamageFall has no reflect check (HewDraw Remix
  // `damagefall.rs`, WuBor Patch `damage_fall.rs`), so no speed bounces it.
  it("lands lying down at a launch that bounces it in hitstun, and never bounces", () => {
    const hitstun = until(flying(0, 6, 0, -2), () => 0);
    expect(hitstun.some((f) => f.state.fighters[1].vy > 0)).toBe(true);

    const frames = until(falling(0, 6, 0, -2), () => 0);
    const v = frames[touched(frames)].state.fighters[1];
    expect(v).toMatchObject({ action: "downed", grounded: true, hitstun: 0, launchSpeed: 0 });
    expect(frames.every((f) => f.state.fighters[1].vy <= 0)).toBe(true);
    expect(frames.at(-1)!.state.fighters[1].grounded).toBe(true);
  });

  it("gets up from the knockdown and stands", () => {
    const frames = until(falling(0, 6, 0, -2), () => 0, 100);
    const actions = frames.map((f) => f.state.fighters[1].action);
    expect(actions).toContain("downed");
    expect(actions).toContain("getUp");
    expect(actions.at(-1)).toBe("stand");
  });

  it("techs a landing when shield is pressed on the frame of landing itself", () => {
    const dry = until(falling(0, 6, 0, -2), () => 0);
    const k = touched(dry);
    const frames = until(falling(0, 6, 0, -2), (i) => (i === k ? Btn.Shield : 0));
    expect(frames[k].state.fighters[1].action).toBe("tech");
    // A press a few frames earlier is an air dodge, which falls on with the
    // tumble's momentum (Task 20b) and techs the floor it meets.
    const early = until(falling(0, 6, 0, -2), (i) => (i === k - 2 ? Btn.Shield : 0));
    expect(early[k - 2].state.fighters[1].action).toBe("airDodge");
    expect(early[k].state.fighters[1].action).toBe("tech");
  });

  // Re-pointed in Task 20c to a press made in the hitstun, which needs no
  // reading: there it only opens the tech window (the hitstun cancel is shut),
  // and the hitstun runs out on the landing frame, so the floor is met in
  // tumbleFall. A press with the stick held *after* the hitstun is the
  // directional air dodge (below).
  it("rolls out of a landing when the stick is held as it techs", () => {
    // The frame the body first meets the floor: where the press techs it in hitstun.
    const k = landing(until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield : 0)));
    const s = flying(0, 6, 0, -2);
    s.fighters[1].hitstun = k + 1; // runs out on frame k, the landing frame
    const frames = until(s, (i) => (i === 0 ? Btn.Shield | Btn.Right : Btn.Right));
    expect(frames[k - 1].state.fighters[1].action).toBe("tumble");
    expect(frames[k].state.fighters[1].action).toBe("techRoll");
    expect(frames.some((f) => f.state.fighters[1].action === "airDodge")).toBe(false);
  });

  it("techs a landing on a held shield once the air dodge is spent", () => {
    const s = falling(0, 20, 0, -0.6);
    s.fighters[1].airDodged = true;
    const dry = until(falling(0, 20, 0, -0.6), () => 0);
    expect(touched(dry)).toBeGreaterThan(TECH_WINDOW + 5);
    const frames = until(s, () => Btn.Shield);
    expect(frames[touched(dry)].state.fighters[1].action).toBe("tech");
  });

  // Keeping the floor's cap of 3 after the hitstun is UNVERIFIED (`TECH_FLOOR_MAX_SPEED`).
  it("lies down rather than techs a landing faster than 3 (with the air dodge spent)", () => {
    const s = falling(0, 6, 0, -3.5);
    s.fighters[1].airDodged = true;
    const frames = until(s, (i) => (i === 0 ? Btn.Shield : 0));
    expect(frames[touched(frames)].state.fighters[1].action).toBe("downed");
  });

  // A press with the dodge to spend is the air dodge, and the dodge, which keeps
  // the launch (Task 20b), techs the floor in its first 15 frames at any speed:
  // the reimplementations of the vanilla air-dodge tech read no speed (`techOrBounce`).
  it("air-dodges a press whose landing is faster than 3, and the dodge techs it", () => {
    const frames = until(falling(0, 6, 0, -3.5), (i) => (i === 0 ? Btn.Shield : 0), 6);
    expect(frames[0].state.fighters[1].action).toBe("airDodge");
    const k = frames.findIndex((f) => f.state.fighters[1].action !== "airDodge");
    expect(k).toBeGreaterThan(0);
    expect(frames[k].state.fighters[1].action).toBe("tech");
  });

  // SmashWiki "Tech": the character "must be in hitstun" to tech a wall or ceiling.
  it("neither techs nor bounces off a wall or the underside after its hitstun", () => {
    // The air dodge is spent, so the press can only open the tech window.
    const spent = (s: GameState) => {
      s.fighters[1].airDodged = true;
      return s;
    };
    const wall = until(spent(falling(92, -20, -4, 0)), (i) => (i === 0 ? Btn.Shield : 0), 8);
    expect(wall.every((f) => f.state.fighters[1].action === "tumbleFall")).toBe(true);
    expect(wall.at(-1)!.state.fighters[1].vx).toBe(0);
    const ceiling = until(spent(falling(0, -78, 0, 4)), (i) => (i === 0 ? Btn.Shield : 0), 8);
    expect(ceiling.every((f) => f.state.fighters[1].action === "tumbleFall")).toBe(true);
    expect(ceiling.at(-1)!.state.fighters[1].vy).toBeLessThanOrEqual(0);
  });

  it("is free to act: a jump, an aerial or an air dodge each end the tumble", () => {
    const acts: [InputFrame, string][] = [
      [Btn.Jump, "jump"],
      [Btn.Attack, "attack"],
      [Btn.Shield, "airDodge"],
    ];
    for (const [input, action] of acts) {
      const frames = until(falling(0, 60, 0, -0.6), (i) => (i === 0 ? input : 0), 3);
      expect(frames[0].state.fighters[1].action, action).toBe(action);
    }
  });

  it("grabs a ledge as it falls past one", () => {
    const s = falling(86, -3, 0, -0.5);
    s.fighters[1].facing = -1;
    const frames = until(s, () => 0, 6);
    expect(frames.some((f) => f.state.fighters[1].action === "ledgeHang")).toBe(true);
  });

  /* -- fix round 1: an air dodge out of a tumble techs in its first 15 frames -- */

  // SmashWiki "Lucario (SSBU)/Techs": "neutral and directional air dodges can be
  // used for every form of teching during the first 15 frames"; "After 16 frames
  // ... no longer able to tech against surfaces". Vanilla `air_escape_passive_trigger_frame` 15.
  /**
   * Fighter 1, tumbling at height `y` late in its hitstun, cancels it with a
   * directional air dodge straight down (shield and down on the first frame).
   * Returns the frames, and the air-dodge frame on which it met the floor.
   */
  function cancelDown(y: number) {
    const s = flying(0, y, 0, -0.6);
    s.fighters[1].actionFrame = 40; // the cancel opens on 41 (Task 7)
    const frames = until(s, (i) => (i === 0 ? Btn.Shield | Btn.Down : 0), 40);
    expect(frames[0].state.fighters[1].action).toBe("airDodge");
    return { frames, met: frames.findIndex((f) => f.state.fighters[1].action !== "airDodge") };
  }
  /** The first height, on a half-unit grid, whose dodge down meets the floor on `actionFrame` `at`. */
  const metAt = (at: number) => [...Array(120).keys()].map((n) => 1 + n * 0.5).find((y) => cancelDown(y).met === at)!;

  // The dodge's starting frame, `actionFrame` 0, is its frame 1, as it already moves
  // (`airDodge.ts`): a floor met on `actionFrame` 14 is the 15th frame, 15 the 16th. (The dodge down
  // slings up, slides 20 down and then falls: Task 20c.)
  it("techs a floor met on the 15th frame of the air dodge it cancelled hitstun with", () => {
    const { frames, met } = cancelDown(metAt(AIR_DODGE_TECH_FRAMES - 1));
    expect(met).toBe(AIR_DODGE_TECH_FRAMES - 1);
    expect(frames[met].state.fighters[1].action).toBe("tech");
  });

  it("lands with landing lag on the 16th frame of it", () => {
    const { frames, met } = cancelDown(metAt(AIR_DODGE_TECH_FRAMES));
    expect(met).toBe(AIR_DODGE_TECH_FRAMES);
    expect(frames[met].state.fighters[1].action).toBe("landingLag");
  });

  it("techs after an air dodge out of tumbleFall too, and rolls with the stick held", () => {
    const frames = until(falling(0, 12, 0, -0.6), (i) => (i === 0 ? Btn.Shield | Btn.Down : 0), 30);
    const k = frames.findIndex((f) => f.state.fighters[1].action !== "airDodge");
    expect(frames[k].state.fighters[1].action).toBe("tech");
    expect(k).toBeLessThan(AIR_DODGE_TECH_FRAMES);
    // The same dodge with the stick across rolls (the floor tech's roll).
    const roll = until(falling(0, 12, 0, -0.6), (i) => (i === 0 ? Btn.Shield | Btn.Down | Btn.Right : Btn.Right), 30);
    const r = roll.findIndex((f) => f.state.fighters[1].action !== "airDodge");
    expect(roll[r].state.fighters[1].action).toBe("techRoll");
  });

  it("techs a wall met inside it too", () => {
    const s = flying(100, -20, -0.6, 0);
    s.fighters[1].actionFrame = 40;
    const frames = until(s, (i) => (i === 0 ? Btn.Shield | Btn.Left : 0), 20);
    const k = frames.findIndex((f) => f.state.fighters[1].action !== "airDodge");
    expect(frames[k].state.fighters[1].action).toBe("techWall");
  });

  // A normal air dodge keeps its landing lag, as wavelanding does (SmashWiki "Air
  // dodge"); "only from a tumble" is UNVERIFIED (`AIR_DODGE_TECH_FRAMES`).
  it("does not tech an ordinary air dodge: it lands with landing lag, and a wall just stops it", () => {
    const fall = (x: number, y: number) => {
      const s = standing();
      s.fighters[0].x = fx(-70);
      Object.assign(s.fighters[1], { x: fx(x), y: fx(y), grounded: false, platform: -1, action: "fall" });
      s.fighters[1].kinetic.gravityY = -fx(0.6);
      s.fighters[1].vy = -fx(0.6);
      return s;
    };
    const floor = until(fall(0, 12), (i) => (i === 0 ? Btn.Shield | Btn.Down : 0), 30);
    const k = floor.findIndex((f) => f.state.fighters[1].action !== "airDodge");
    expect(k).toBeLessThan(AIR_DODGE_TECH_FRAMES);
    expect(floor[k].state.fighters[1].action).toBe("landingLag");
    const wall = until(fall(100, -20), (i) => (i === 0 ? Btn.Shield | Btn.Left : 0), 12);
    expect(wall.every((f) => f.state.fighters[1].action === "airDodge")).toBe(true);
  });

  it("clears the trigger when the air dodge ends", () => {
    const { frames } = cancelDown(47.9);
    expect(frames[0].state.fighters[1].combat.tumbleDodge).toBe(true);
    expect(frames.at(-1)!.state.fighters[1].combat.tumbleDodge).toBe(false);
  });

  /* -- Task 20b: the neutral air dodge keeps momentum, so a press near the floor is a dodge that techs -- */

  // Task 12 read a press this close to the floor as the tech alone, because the
  // replica's air dodge stopped dead and could not reach the floor; for a neutral
  // press Task 20b retired that reading (`techInputNearFloor`), and Task 20c the
  // rest of it, for a press with a direction held (further down). Ultimate's
  // neutral dodge keeps the fighter's momentum (SmashWiki "Air dodge",
  // https://www.ssbwiki.com/Air_dodge: "preserving their momentum"), and one out
  // of a tumble techs a surface it meets in its first 15 frames (SmashWiki
  // "Lucario (SSBU)/Techs": "a neutral airdodge option within 15 frames of
  // landing will also activate a tech option"; `AIR_DODGE_TECH_FRAMES`). These
  // are the cases the reading was built for, on the real mechanism.

  /** `until`, on a stage of the caller's choosing. */
  const onStage = (s: GameState, stage: StageDef, input: (i: number) => InputFrame, n: number) =>
    play(s, n, (i) => [0, input(i)], ctxFor(BASE_DEF, stage));
  const actionAt = (frames: Frame[], i: number) => frames[i].state.fighters[1].action;
  /** The first frame fighter 1 has left the air dodge it is in. */
  const dodgeEnds = (frames: Frame[]) => frames.findIndex((f, i) => i > 0 && f.state.fighters[1].action !== "airDodge");

  it("techs a press made 1 to 11 frames above the floor after the hitstun: the press air-dodges, and the dodge falls into a tech", () => {
    const dry = until(falling(0, 20, 0, -0.6), () => 0);
    const k = touched(dry);
    expect(k).toBeGreaterThan(TECH_WINDOW);
    for (let early = 1; early <= TECH_WINDOW; early++) {
      const frames = until(falling(0, 20, 0, -0.6), (i) => (i === k - early ? Btn.Shield : 0));
      expect(actionAt(frames, k - early), `${early} before`).toBe("airDodge");
      expect(actionAt(frames, k - 1), `${early} before`).toBe("airDodge");
      expect(actionAt(frames, k), `${early} before: it lands when the tumble would`).toBe("tech");
    }
  });

  it("techs a hitstun-cancel press made 1 to 11 frames above the floor the same way", () => {
    const late = () => {
      const s = flying(0, 20, 0, -0.6);
      s.fighters[1].actionFrame = 40; // the cancel is open from the first frame (Task 7)
      return s;
    };
    const dry = until(late(), () => 0);
    const k = landing(dry);
    expect(k).toBeGreaterThan(TECH_WINDOW);
    for (let early = 1; early <= TECH_WINDOW; early++) {
      const frames = until(late(), (i) => (i === k - early ? Btn.Shield : 0));
      expect(actionAt(frames, k - early), `${early} before`).toBe("airDodge");
      expect(actionAt(frames, k), `${early} before`).toBe("tech");
    }
  });

  // `updateTechInput` opens no window inside the 40-frame lockout, so a second
  // press there is no tech input of its own: it air-dodges. The dodge out of the
  // tumble then techs the floor it meets in its first 15 frames, as any dodge out
  // of a tumble does, lockout or not: SmashWiki "Tech" (https://www.ssbwiki.com/Tech),
  // of Smash 4's: "This air dodge cancel additionally ignores the 30-frame tech
  // penalty"; SmashWiki "Lucario (SSBU)/Techs" has Ultimate keep the dodge tech
  // ("neutral and directional air dodges can be used for every form of teching
  // during the first 15 frames"). The reimplementations of the vanilla check read
  // the dodge's frame and (WuBor Patch) the button's last press, and no lockout
  // (`techOrBounce`).
  it("air-dodges a press made inside the tech lockout, 2, 5 or 9 frames before landing, and the dodge techs the landing", () => {
    const hitstunOver = () => {
      // Its hitstun ends on frame 14, after the first press has left the 9-frame buffer.
      const s = flying(0, 45, 0, -0.6);
      s.fighters[1].hitstun = 14;
      return s;
    };
    const dry = until(hitstunOver(), (i) => (i === 0 ? Btn.Shield : 0), 60);
    const k = dry.findIndex((f) => f.state.fighters[1].action === "downed");
    expect(k).toBeGreaterThan(TECH_WINDOW + 9);
    for (const early of [2, 5, 9]) {
      const frames = until(hitstunOver(), (i) => (i === 0 || i === k - early ? Btn.Shield : 0), 60);
      expect(actionAt(frames, k - early - 1), `${early} before`).toBe("tumbleFall");
      expect(actionAt(frames, k - early), `${early} before`).toBe("airDodge");
      expect(frames[k - early].state.fighters[1].combat.techWindow, `${early} before`).toBe(0);
      expect(actionAt(frames, k), `${early} before`).toBe("tech");
    }
  });

  // A press made before the hitstun cancel opens waits in the buffer and
  // air-dodges when it opens (Task 7). The dodge techs a landing anywhere in its
  // first 15 frames, further out than the press's own 11-frame window reached.
  // UNVERIFIED, the 13-frame case: WuBor Patch's air-dodge tech also asks for a
  // shield press within `passive_trigger_frame` (12) (`escape_air.rs` L158-167,
  // `sub_check_passive_button_for_damage`), and this press is 13 frames old when
  // the dodge meets the floor; the replica does not model that gate (`techOrBounce`).
  it("techs a landing 9 or 13 frames out after a press buffered into the hitstun cancel", () => {
    const run = (y: number) => {
      const s = flying(0, y, 0, -0.6);
      s.fighters[1].actionFrame = 38; // the cancel opens on 41, two frames in
      return until(s, (i) => (i === 0 ? Btn.Shield : 0), 30);
    };
    const landsAt = (y: number) => landing(until(flying(0, y, 0, -0.6), () => 0, 30));
    for (const at of [9, 13]) {
      const y = [...Array(40).keys()].map((n) => 4 + n * 0.5).find((h) => landsAt(h) === at)!;
      const frames = run(y);
      const dodge = frames.findIndex((f) => f.state.fighters[1].action === "airDodge");
      expect(dodge, `lands at ${at}`).toBe(2);
      expect(actionAt(frames, at - 1), `lands at ${at}`).toBe("airDodge");
      expect(actionAt(frames, at), `lands at ${at}`).toBe("tech");
    }
  });

  // The dodge drifts on with the launch as the tumble would: off a soft platform's
  // span it misses the platform and lands on the floor below after its first 15
  // frames, with the air dodge's landing lag; over the middle it techs the platform.
  it("drifts off a soft platform in the dodge as the tumble would, and over its middle techs it", () => {
    const soft: StageDef = {
      ...STAGE,
      platforms: [...STAGE.platforms, { x: 0, y: fx(30), halfWidth: fx(20), soft: true, ledges: false }],
    };
    for (const x of [15, 18]) {
      const frames = onStage(falling(x, 33, 1.5, -0.4), soft, (i) => (i === 0 ? Btn.Shield : 0), 60);
      expect(actionAt(frames, 0), `x ${x}`).toBe("airDodge");
      const end = dodgeEnds(frames);
      expect(end, `x ${x}`).toBeGreaterThanOrEqual(AIR_DODGE_TECH_FRAMES);
      expect(frames[end].state.fighters[1], `x ${x}`).toMatchObject({ action: "landingLag", y: 0 });
    }
    const over = onStage(falling(0, 33, 0, -0.4), soft, (i) => (i === 0 ? Btn.Shield : 0), 40);
    expect(actionAt(over, 0)).toBe("airDodge");
    expect(over[dodgeEnds(over)].state.fighters[1]).toMatchObject({ action: "tech", y: fx(30) });
  });

  // Smashville's platform moves: the dodge meets it where it is, frame by frame.
  it("misses a soft platform that moves out from under the dodge, as the tumble would", () => {
    const moving: StageDef = {
      ...STAGE,
      platforms: [
        ...STAGE.platforms,
        { x: 0, y: fx(30), halfWidth: fx(4), soft: true, ledges: false, motion: { kind: "sweep", amplitude: fx(40), periodFrames: 120 } },
      ],
    };
    const dry = onStage(falling(0, 33, 0, -1), moving, () => 0, 60);
    expect(dry[touched(dry)].state.fighters[1]).toMatchObject({ action: "downed", y: 0 });
    const frames = onStage(falling(0, 33, 0, -1), moving, (i) => (i === 0 ? Btn.Shield : 0), 60);
    expect(actionAt(frames, 0)).toBe("airDodge");
    expect(frames[dodgeEnds(frames)].state.fighters[1]).toMatchObject({ action: "landingLag", y: 0 });
  });

  // A launch still slowing while gravity holds the fall at its terminal speed: the
  // fall is 2.5 a frame, less 0.051 more each frame, so 11 frames cover 24.13 and
  // 15 cover 31.38. The dodge falls on as the tumble would, so a press that far
  // out techs too, not only one whose own 11-frame window reaches the floor.
  it("techs a press above the floor by more than its slowing fall covers in the tech window, inside the dodge's 15 frames", () => {
    const slowing = (y: number) => {
      const s = falling(0, y, 0, -1);
      s.fighters[1].kinetic.gravityY = -fx(1.5);
      s.fighters[1].vy = -fx(2.5);
      return s;
    };
    const press = (y: number) => until(slowing(y), (i) => (i === 0 ? Btn.Shield : 0), 40);
    for (const y of [24, 24.3, 25, 27, 30]) {
      const frames = press(y);
      expect(actionAt(frames, 0), `drop ${y}`).toBe("airDodge");
      const end = dodgeEnds(frames);
      expect(end, `drop ${y}`).toBeLessThan(AIR_DODGE_TECH_FRAMES);
      expect(actionAt(frames, end), `drop ${y}`).toBe("tech");
    }
    // Past the dodge's first 15 frames the landing is the dodge's own, with its lag.
    const far = press(40);
    expect(dodgeEnds(far)).toBeGreaterThanOrEqual(AIR_DODGE_TECH_FRAMES);
    expect(actionAt(far, dodgeEnds(far))).toBe("landingLag");
  });

  // SmashWiki "Tech" (Ultimate): "the shield button can be held for much longer
  // than the 11 frame window and a tech can still be performed on the ground."
  // Held as the hitstun runs out, the shield is an air dodge in `tumbleFall` (a
  // fall's rule: a held input is buffered, SmashWiki "Buffer"), and the dodge techs
  // the landing; with the dodge spent, the hold itself techs it.
  it("techs a landing on a shield held from the hitstun into tumbleFall: through the dodge, or with it spent by the hold", () => {
    const dry = until(flying(0, 30, 0, -0.6), () => 0, 60);
    const k = landing(dry);
    expect(k).toBeGreaterThan(TECH_WINDOW + 9);
    const heldThrough = (spent: boolean) => {
      const s = flying(0, 30, 0, -0.6);
      s.fighters[1].hitstun = k - 3; // runs out on frame k - 4: `tumbleFall` from 4 frames before landing
      s.fighters[1].airDodged = spent;
      return until(s, () => Btn.Shield, 60);
    };
    const dodging = heldThrough(false);
    expect(actionAt(dodging, k - 4)).toBe("tumbleFall");
    expect(actionAt(dodging, k - 3)).toBe("airDodge");
    expect(actionAt(dodging, k)).toBe("tech");
    const spent = heldThrough(true);
    expect(spent.slice(k - 4, k).every((f) => f.state.fighters[1].action === "tumbleFall")).toBe(true);
    expect(actionAt(spent, k)).toBe("tech");
  });

  /* -- Task 20c: a press with a direction held is the directional dodge it asks for -- */

  // SmashWiki "Lucario (SSBU)/Techs" (https://www.ssbwiki.com/Lucario_(SSBU)/Techs):
  // "when not in enough hitstun, holding the analog stick in a direction while
  // pressing shield/grab can turn into a directional air dodge buffer, which can
  // be a misinput when done improperly." Task 12 read such a press near the floor
  // as the tech alone (`techInputNearFloor`, `landsWithin`), because the replica's
  // directional dodge held its height; Task 20c retired that reading. The press
  // is the directional dodge, and whether it techs is decided by the dodge's own
  // movement: one out of a tumble techs a surface it meets in its first 15 frames
  // (`AIR_DODGE_TECH_FRAMES`). Sideways it slings back and slides level, gravity
  // off, so it hangs over the floor and lands late with its landing lag: the
  // misinput. Down it slings up and slides onto the floor in time, and techs it.
  const pressing = (dir: InputFrame) => (i: number) => (i === 0 ? Btn.Shield | dir : 0);

  it("makes a press with the stick held sideways after the hitstun a directional dodge that hangs, and lands late with its lag", () => {
    const frames = until(falling(0, 4, 0, -0.6), pressing(Btn.Right));
    expect(frames[0].state.fighters[1]).toMatchObject({ action: "airDodge", charge: airDodgeCharge(1, 0) });
    const end = dodgeEnds(frames);
    expect(end).toBeGreaterThanOrEqual(AIR_DODGE_TECH_FRAMES);
    expect(frames[end].state.fighters[1]).toMatchObject({ action: "landingLag", y: 0 });
    // The neutral press from the same place falls on with the tumble and techs.
    const neutral = until(falling(0, 4, 0, -0.6), pressing(0));
    expect(actionAt(neutral, dodgeEnds(neutral))).toBe("tech");
  });

  it("makes a press with the stick held down a directional dodge that slings up, slides onto the floor and techs it", () => {
    const frames = until(falling(0, 4, 0, -0.6), pressing(Btn.Down));
    expect(frames[3].state.fighters[1].y, "the slingshot carried it up").toBeGreaterThan(fx(4));
    const end = dodgeEnds(frames);
    expect(end).toBeLessThan(AIR_DODGE_TECH_FRAMES);
    expect(actionAt(frames, end)).toBe("tech");
  });

  // SmashWiki "Lucario (SSBU)/Techs": "even a directional downward air dodge can
  // tech a ceiling during the first five frames before slingshotting downward".
  it("techs the stage's underside with the slingshot of a dodge aimed down", () => {
    const frames = until(falling(0, -74, 0, 0), pressing(Btn.Down), 6);
    expect(frames[0].state.fighters[1].action).toBe("techCeiling");
  });

  // The slingshot of a dodge out of a tumble meeting the floor is its tech: the
  // mods keep the tech (PASSIVE) on while landing is off (`airDodgeKeepsAir`).
  it("techs the floor with the slingshot of a dodge aimed up", () => {
    const frames = until(falling(0, 2, 0, 0), pressing(Btn.Up), 6);
    expect(frames[0].state.fighters[1].action).toBe("tech");
  });

  it("does the same with a hitstun-cancel press", () => {
    const late = () => {
      const s = flying(0, 4, 0, -0.6);
      s.fighters[1].actionFrame = 40; // the cancel is open from the first frame (Task 7)
      return s;
    };
    const across = until(late(), pressing(Btn.Right));
    expect(actionAt(across, 0)).toBe("airDodge");
    expect(across[dodgeEnds(across)].state.fighters[1].action).toBe("landingLag");
    expect(dodgeEnds(across)).toBeGreaterThanOrEqual(AIR_DODGE_TECH_FRAMES);
    const down = until(late(), pressing(Btn.Down));
    expect(actionAt(down, dodgeEnds(down))).toBe("tech");
  });

  // `updateTechInput` opens no window inside the 40-frame lockout, so a second
  // press there is no tech input: it is the directional dodge it asked for.
  it("air-dodges a press with the stick held made inside the tech lockout", () => {
    const hitstunOver = () => {
      const s = flying(0, 45, 0, -0.6);
      s.fighters[1].hitstun = 14;
      return s;
    };
    const k = until(hitstunOver(), (i) => (i === 0 ? Btn.Shield : 0), 60).findIndex((f) => f.state.fighters[1].action === "downed");
    for (const early of [2, 5, 9]) {
      const frames = until(hitstunOver(), (i) => (i === 0 ? Btn.Shield : i === k - early ? Btn.Shield | Btn.Right : 0), 60);
      expect(actionAt(frames, k - early - 1), `${early} before`).toBe("tumbleFall");
      expect(actionAt(frames, k - early), `${early} before`).toBe("airDodge");
      expect(frames[k - early].state.fighters[1].charge, `${early} before: directional`).toBe(airDodgeCharge(1, 0));
      expect(frames[k - early].state.fighters[1].combat.techWindow, `${early} before`).toBe(0);
    }
  });

  // SmashWiki "Tech": a held shield techs the ground. Held with the stick into
  // `tumbleFall` it is the directional dodge (a held input is buffered); with the
  // dodge spent, the hold techs the floor, and the stick makes it a roll.
  it("techs a landing on a shield held with the stick held into tumbleFall once the dodge is spent: a roll", () => {
    const k = landing(until(flying(0, 30, 0, -0.6), () => 0, 60));
    const held = (spent: boolean) => {
      const s = flying(0, 30, 0, -0.6);
      s.fighters[1].hitstun = k - 3;
      s.fighters[1].airDodged = spent;
      return until(s, () => Btn.Shield | Btn.Right, 60);
    };
    const dodging = held(false);
    expect(actionAt(dodging, k - 4)).toBe("tumbleFall");
    expect(dodging[k - 3].state.fighters[1]).toMatchObject({ action: "airDodge", charge: airDodgeCharge(1, 0) });
    const spent = held(true);
    expect(spent.slice(k - 4, k).every((f) => f.state.fighters[1].action === "tumbleFall")).toBe(true);
    expect(actionAt(spent, k)).toBe("techRoll");
  });
});

/* ------------------------- Task 20c: the directional air dodge's movement -- */

describe("a directional air dodge follows the published params (Plan 3, Task 20c)", () => {
  // P: fudgepop01/amiibo_research `fighter_param_motion.xml` @523374aa (Mario's
  // entry, L33-43); W: SmashWiki "Air dodge" (https://www.ssbwiki.com/Air_dodge).
  // The tester has no air-dodge params of its own, so it dodges as Mario
  // (`DEFAULT_AIR_DODGE`): 86 frames sideways, 115 up, 71 down.

  /** Fighter 1 still in the air at (x, y), free to act; fighter 0 parked out of the way. */
  function aloft(x: number, y: number, over: Partial<FighterState> = {}): GameState {
    const s = standing();
    s.fighters[0].x = fx(-70);
    Object.assign(s.fighters[1], { x: fx(x), y: fx(y), grounded: false, platform: -1, action: "fall", actionFrame: 0, ...over });
    return s;
  }
  /** Fighter 1 presses shield with `dir` on frame 0, then `after(i)`. */
  const dodge = (s: GameState, dir: InputFrame, n: number, after: (i: number) => InputFrame = () => 0) =>
    play(s, n, (i) => [0, i === 0 ? Btn.Shield | dir : after(i)]);
  const at = (frames: Frame[], i: number) => frames[i].state.fighters[1];
  /** Each frame's movement of fighter 1 along an axis, from where it started. */
  const steps = (frames: Frame[], from: number, axis: "x" | "y") =>
    frames.map((f, i) => f.state.fighters[1][axis] - (i === 0 ? from : frames[i - 1].state.fighters[1][axis]));
  const diag = (d: number) => Math.trunc((d * DIAGONAL) / ONE);
  const G = fx(0.087); // the tester's gravity

  // The cubic Bezier through 0.5, 0.8, 0.9, 1.0 at 0, 1/3, 2/3, 1 is 1/2, 20/27,
  // 241/270 and 1 of the way: WuBor Patch `escape_air.rs` L343-366 (UNVERIFIED shape).
  const SLINGSHOT = [
    [1, 2],
    [20, 27],
    [241, 270],
    [1, 1],
  ].map(([n, d]) => Math.trunc((AIR_DODGE_SLINGSHOT_DISTANCE * n) / d));

  it("slings back 7 units over its first 4 frames, on the Bezier, with nothing else moving it", () => {
    const frames = dodge(aloft(0, 100), Btn.Right, 12, (i) => (i < 12 ? Btn.Left : 0));
    expect([0, 1, 2, 3].map((i) => -at(frames, i).x)).toEqual(SLINGSHOT);
    expect(-at(frames, 3).x).toBe(AIR_DODGE_SLINGSHOT_DISTANCE);
    expect(steps(frames, fx(100), "y").slice(0, 11).every((dy) => dy === 0), "gravity off").toBe(true);
    // Straight up it slings down; on a diagonal each axis takes 1/√2 of each step.
    const up = dodge(aloft(0, 100), Btn.Up, 4);
    expect([0, 1, 2, 3].map((i) => fx(100) - at(up, i).y)).toEqual(SLINGSHOT);
    expect(up.every((f) => f.state.fighters[1].x === 0)).toBe(true);
    const across = dodge(aloft(0, 100), Btn.Right | Btn.Down, 4);
    const back = SLINGSHOT.map((c, i) => c - (i > 0 ? SLINGSHOT[i - 1] : 0));
    expect(steps(across, 0, "x").slice(0, 4)).toEqual(back.map((b) => -diag(b)));
    expect(steps(across, fx(100), "y").slice(0, 4)).toEqual(back.map((b) => diag(b)));
  });

  it("slides 20 units from 4.2 down past 1.3 by a constant brake, exact in Q12, with drift and gravity off", () => {
    // Solved from P's three numbers alone: n frames at v0, v0 − b, … cover D, the
    // last no slower than 1.3: n = floor(2D / (v0 + v1)), b = (n·v0 − D) / (n(n−1)/2).
    const v0 = AIR_DODGE_SLIDE_SPEED;
    const n = Math.trunc((2 * AIR_DODGE_SLIDE_DISTANCE) / (v0 + AIR_DODGE_SLIDE_END_SPEED));
    const tri = (m: number) => (m * (m - 1)) / 2;
    const brake = [n * v0 - AIR_DODGE_SLIDE_DISTANCE, tri(n)] as const;
    expect([n, ...brake]).toEqual([7, 38501, 21]);
    expect([AIR_DODGE_SLIDE_FRAMES, ...AIR_DODGE_SLIDE_BRAKE]).toEqual([n, ...brake]);
    const covered = (m: number) => m * v0 - Math.trunc((brake[0] * tri(m)) / brake[1]);
    const want = [...Array(n).keys()].map((k) => covered(k + 1) - covered(k));

    const frames = dodge(aloft(0, 100), Btn.Right, 12, (i) => (i <= 10 ? Btn.Left : 0));
    const slide = steps(frames, 0, "x").slice(4, 4 + n);
    expect(slide).toEqual(want);
    expect(slide.reduce((a, b) => a + b, 0)).toBe(AIR_DODGE_SLIDE_DISTANCE);
    expect(slide[0]).toBe(v0);
    expect(slide.at(-1)!).toBeGreaterThanOrEqual(AIR_DODGE_SLIDE_END_SPEED);
    expect(v0 - (brake[0] * n) / brake[1], "one more brake would pass 1.3").toBeLessThan(AIR_DODGE_SLIDE_END_SPEED);
    for (let k = 1; k < n; k++) expect(Math.abs(slide[k - 1] - slide[k] - brake[0] / brake[1])).toBeLessThan(1);
    expect(at(frames, 10).x).toBe(AIR_DODGE_SLIDE_DISTANCE - AIR_DODGE_SLINGSHOT_DISTANCE);
    expect(at(frames, 10).y, "gravity off").toBe(fx(100));
    // The energies' sum is the velocity on every frame (the kinetic seam).
    for (const f of frames) expect([f.state.fighters[1].vx, f.state.fighters[1].vy]).toEqual([kineticSumX(f.state.fighters[1]), kineticSumY(f.state.fighters[1])]);
  });

  it("hands 1.3 along its direction to drift and gravity when the slide ends, and falls by the fall's rules from there", () => {
    const side = dodge(aloft(0, 100), Btn.Right, 13);
    expect(at(side, 11)).toMatchObject({ action: "airDodge", vx: AIR_DODGE_SLIDE_END_SPEED, vy: -G });
    expect(at(side, 11).kinetic).toMatchObject({ controlX: AIR_DODGE_SLIDE_END_SPEED, motionX: 0, motionY: 0 });
    expect(at(side, 12).vy).toBe(-2 * G);
    const up = dodge(aloft(0, 100), Btn.Up, 12);
    expect([at(up, 11).vx, at(up, 11).vy]).toEqual([0, AIR_DODGE_SLIDE_END_SPEED - G]);
    const across = dodge(aloft(0, 100), Btn.Right | Btn.Down, 12);
    const d = diag(AIR_DODGE_SLIDE_END_SPEED);
    expect([at(across, 11).vx, at(across, 11).vy]).toEqual([d, -d - G]);
  });

  it("keeps a launch through the slingshot, still decaying, and clears it when the slide starts", () => {
    const s = aloft(0, 100, { action: "tumbleFall" });
    const v = s.fighters[1];
    v.kinetic.damageX = fx(1.2);
    v.launchSpeed = fx(1.2);
    v.vx = fx(1.2);
    const frames = dodge(s, Btn.Up, 6);
    for (let i = 0; i < 4; i++) {
      expect(at(frames, i).launchSpeed, `slingshot frame ${i}`).toBe(fx(1.2) - (i + 1) * LAUNCH_SPEED_DECAY);
      expect(at(frames, i).x, `slingshot frame ${i}: the launch moves it`).toBeGreaterThan(i === 0 ? 0 : at(frames, i - 1).x);
    }
    expect(at(frames, 4)).toMatchObject({ launchSpeed: 0, kinetic: { damageX: 0, damageY: 0 } });
    expect(at(frames, 5).x).toBe(at(frames, 3).x);
  });

  // P L42-43 give 20 and 10, W "11 to 19"; SmashWiki "Lucario (SSBU)/Air dodge"
  // gives both ends the replica uses: "maximum 19 frames ... as little as 10".
  it("lands with 19 frames of lag at its earliest landing and 10 at its latest", () => {
    // A wavedash: down from just over the floor, it slings up and lands in its slide.
    const early = dodge(aloft(0, 0.5), Btn.Down, 12);
    const e = early.findIndex((f) => f.state.fighters[1].action !== "airDodge");
    expect(e).toBeGreaterThan(3);
    expect(at(early, e)).toMatchObject({ action: "landingLag", charge: DIRECTIONAL_AIR_DODGE_LANDING_LAG_MAX });
    // Sideways from the height whose fall lands on the dodge's very last frame
    // (from the stage's left side, so its drift keeps it over the stage).
    const total = airDodgeFrames(DEFAULT_AIR_DODGE, airDodgeCharge(1, 0));
    const landsOn = (y: number) => dodge(aloft(-60, y), Btn.Right, total + 2).findIndex((f, i) => i > 0 && f.state.fighters[1].action !== "airDodge");
    const y = [...Array(200).keys()].map((k) => 80 + k * 0.25).find((h) => landsOn(h) === total - 1);
    expect(y, "a height that lands on the last frame").toBeDefined();
    const late = dodge(aloft(-60, y!), Btn.Right, total);
    expect(at(late, total - 2).action).toBe("airDodge");
    expect(at(late, total - 1)).toMatchObject({ action: "landingLag", charge: DIRECTIONAL_AIR_DODGE_LANDING_LAG_MIN });
  });

  // An up or up-diagonal dodge near the floor: its slingshot meets the floor, and is
  // held on it, still in the air and in the dodge, until the slide lifts it off.
  // UNVERIFIED, the mods' reading: WuBor Patch `escape_air.rs` L37 and L364-374,
  // HewDraw Remix `airdodge.rs` L173 and L573-574 turn landing off until the slide;
  // SmashWiki "Air dodge": "their new slingshot properties, which prevent characters
  // from landing with them immediately after leaving the ground" (`airDodgeKeepsAir`).
  it.each([1, 3, 5, 6.9])("does not land in its slingshot: up from %f units over the floor", (y) => {
    const frames = dodge(aloft(0, y), Btn.Up, 12);
    expect(frames.every((f) => f.state.fighters[1].action === "airDodge"), "never lands").toBe(true);
    expect(frames.every((f) => f.state.fighters[1].y >= 0 && !f.state.fighters[1].grounded)).toBe(true);
    // Held on the floor, it is not moving down: MOTION's y is zeroed (`kineticAirDodgeHold`),
    // and `vy` is still the energies' sum.
    const held = frames.slice(0, 4).filter((f) => f.state.fighters[1].y === 0);
    expect(held.length, "the slingshot meets the floor").toBeGreaterThan(0);
    for (const f of held) {
      const v = f.state.fighters[1];
      expect([v.vy, v.kinetic.motionY]).toEqual([0, 0]);
    }
    for (const f of frames) expect(f.state.fighters[1].vy).toBe(kineticSumY(f.state.fighters[1]));
    const low = Math.max(0, fx(y) - AIR_DODGE_SLINGSHOT_DISTANCE);
    expect(at(frames, 3).y, "held on the floor, no lower").toBe(low);
    expect(at(frames, 10).y, "the slide lifts it the full 20").toBe(low + AIR_DODGE_SLIDE_DISTANCE);
  });

  // A launch the dodge carries through a slingshot *held on the floor*: the hold stops
  // only MOTION's step into it (`kineticAirDodgeHold`), so the launch lives on, still
  // decaying, and clears when the slide starts. `kineticSetY(f, 0)` would do it too, for
  // `vy`, and end the launch with it (it zeroes DAMAGE's y and re-bases the speed on the
  // x), which is why this launch has a vertical part: the first one, 0.6 across and
  // 0.8 *down*, is meeting the floor the slingshot is held on. UNVERIFIED, like the
  // rest of the hold (WuBor `escape_air.rs` keeps the launch through the slingshot).
  it("keeps a launch with a vertical part through a slingshot held on the floor, still decaying", () => {
    // From a plain fall: a dodge out of a tumble near the floor is its tech, not a slingshot.
    const s = aloft(0, 3, { action: "fall" });
    const v = s.fighters[1];
    v.kinetic.damageX = fx(0.6);
    v.kinetic.damageY = -fx(0.8);
    v.launchSpeed = fx(1);
    v.vx = fx(0.6);
    v.vy = -fx(0.8);
    const frames = dodge(s, Btn.Up, 8);
    const held = frames.slice(0, 4).filter((f) => f.state.fighters[1].y === 0);
    expect(held.length, "the slingshot is held on the floor").toBeGreaterThan(0);
    for (const [i, f] of frames.slice(0, 4).entries()) {
      const k = f.state.fighters[1];
      expect(k.launchSpeed, `slingshot frame ${i}`).toBe(fx(1) - (i + 1) * LAUNCH_SPEED_DECAY);
      expect(k.kinetic.damageY, `slingshot frame ${i}: still heading down`).toBeLessThan(0);
      expect(k.kinetic.damageX, `slingshot frame ${i}`).toBeGreaterThan(0);
    }
    // And it goes when the slide starts, as for any launch (`kineticAirDodge`).
    expect(at(frames, 4)).toMatchObject({ launchSpeed: 0, kinetic: { damageX: 0, damageY: 0 } });
  });

  it("does not land in its slingshot up and across either, and never slides backwards", () => {
    const frames = dodge(aloft(0, 1), Btn.Up | Btn.Right, 12);
    expect(frames.every((f) => f.state.fighters[1].action === "airDodge"), "never lands").toBe(true);
    expect(at(frames, 3).y).toBe(0);
    // The slingshot takes it back 7 along the diagonal; from there it only goes forward.
    for (let i = 4; i < 12; i++) expect(at(frames, i).x, `frame ${i}`).toBeGreaterThan(at(frames, i - 1).x);
    expect(at(frames, 10).x).toBeGreaterThan(0);
    expect(at(frames, 10).y).toBeGreaterThan(fx(13));
  });

  // A full hop and an up dodge on the first frame it is accepted: the case the
  // ordinary game reaches (on BASE of fix round 1 it landed with 19 frames of lag).
  it("does not land in its slingshot out of a full hop's first airborne frames", () => {
    let s = standing();
    s.fighters[0].x = fx(-70);
    s = play(s, 1, () => [0, Btn.Jump]).at(-1)!.state;
    const frames = play(s, 30, () => [0, Btn.Jump | Btn.Shield | Btn.Up]);
    const start = frames.findIndex((f) => f.state.fighters[1].action === "airDodge");
    expect(start).toBeGreaterThanOrEqual(0);
    const dodging = frames.slice(start, start + 11);
    expect(Math.min(...dodging.map((f) => f.state.fighters[1].y)), "the slingshot meets the floor").toBe(0);
    expect(dodging.every((f) => f.state.fighters[1].action === "airDodge"), "never lands").toBe(true);
    expect(dodging.at(-1)!.state.fighters[1].y).toBeGreaterThanOrEqual(fx(13));
  });

  // C L119 `escape_air_slide_landing_speed_max` 2.
  it("lands its slide no faster than 2", () => {
    const frames = dodge(aloft(0, 0.5), Btn.Right | Btn.Down, 12);
    const k = frames.findIndex((f) => f.state.fighters[1].action === "landingLag");
    expect(k).toBeGreaterThan(3);
    expect(at(frames, k - 1).vx, "the slide was faster").toBeGreaterThan(AIR_DODGE_LANDING_SLIDE_MAX);
    expect(at(frames, k).vx).toBe(AIR_DODGE_LANDING_SLIDE_MAX);
    expect(at(frames, k + 1).vx).toBeLessThan(AIR_DODGE_LANDING_SLIDE_MAX);
  });

  // W: "all characters can grab edges after the first 24 frames of their
  // directional air dodge". `actionFrame` N is the dodge's frame N + 1 (`airDodge.ts`),
  // so the first 24 frames are `actionFrame` 0-23.
  describe("the ledge", () => {
    /** Just outboard of the right ledge and a unit below it, facing it: in grab range. */
    const atLedge = () => aloft(84, -1, { facing: -1 });

    it("is not grabbed in the first 24 frames, though the slingshot carries the fighter down past it", () => {
      const frames = dodge(atLedge(), Btn.Up, 80);
      expect(at(frames, 0).vy).toBeLessThan(0);
      const grab = frames.findIndex((f) => f.state.fighters[1].action === "ledgeHang");
      expect(grab).toBeGreaterThanOrEqual(AIR_DODGE_LEDGE_FRAMES);
      expect(at(frames, grab - 1).action).toBe("airDodge");
    });

    // `actionFrame` N is the dodge's frame N + 1 (`airDodge.ts`): frames 1-24 are the
    // first 24, and the first grab is on frame 25 (SmashWiki "Lucario (SSBU)/Air dodge":
    // "all directional air dodges grab ledge on frame 25").
    it("is refused on frame 24 of a directional dodge (actionFrame 23) and taken on frame 25 (actionFrame 24)", () => {
      const v = atLedge().fighters[1];
      Object.assign(v, { action: "airDodge", charge: airDodgeCharge(0, 1), vy: -fx(1) });
      expect(findLedgeGrab({ ...v, actionFrame: 0 }, STAGE, 0, fx(4))).toBeNull();
      expect(findLedgeGrab({ ...v, actionFrame: 23 }, STAGE, 0, fx(4))).toBeNull();
      expect(findLedgeGrab({ ...v, actionFrame: 24 }, STAGE, 0, fx(4))).toEqual({ platform: 0, side: 1 });
    });

    // UNVERIFIED: SmashWiki "Lucario (SSBU)/Air dodge" has "neutral air dodge grabs
    // ledge on frame 60+", past the end of Lucario's 48-frame dodge; the mods disagree
    // on the mechanism, and the replica does not model it (D56, Open questions). This
    // pins the replica's reading, not the game's.
    it("lets a neutral dodge take it at once (UNVERIFIED)", () => {
      const v = atLedge().fighters[1];
      Object.assign(v, { action: "airDodge", charge: 0, actionFrame: 0, vy: -fx(1) });
      expect(findLedgeGrab(v, STAGE, 0, fx(4))).toEqual({ platform: 0, side: 1 });
    });
  });
});

/* ------------------------------------------- Task 13: glancing blows -- */

describe("glancing blows (Plan 3, Task 13)", () => {
  /** Fighter 1 placed so the jab's box (reach 5 + 4) overlaps its body by `overlap`. */
  function jabWithOverlap(overlap: number): Frame[] {
    const s = standing();
    s.fighters[1].x = fx(8 + 5 + 4 - overlap);
    return play(s, 8, JAB);
  }

  // SmashWiki "Glancing blow" (https://www.ssbwiki.com/Glancing_blow): a hitbox
  // that connects "less than 0.1 units through a hurtbox" is a glancing blow —
  // "the attack not hitting" — unchanged from Brawl into Ultimate.
  it("does not hit when the box only grazes the body", () => {
    const frames = jabWithOverlap(0.05);
    expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
    expect(frames.at(-1)!.state.fighters[1].damage).toBe(0);
    // Not spent: the swing may still land if the bodies close in.
    expect(frames.at(-1)!.state.fighters[0].hitThisMove).toEqual([]);
  });

  it("hits once the box is more than 0.1 into the body", () => {
    expect(jabWithOverlap(0.2).flatMap((f) => f.events.hits)).toHaveLength(1);
  });

  it("puts the line at 0.1: 0.09 deep is a graze, 0.11 deep is a hit", () => {
    expect(jabWithOverlap(0.09).flatMap((f) => f.events.hits)).toEqual([]);
    expect(jabWithOverlap(0.11).flatMap((f) => f.events.hits)).toHaveLength(1);
  });

  // The exact line (final wave, part 4; the Task 13 review). 0.1 is 410 Q12 units
  // (fx(0.1) is 409.6, rounded). A box *exactly* that deep is a hit ("less than 0.1
  // units through a hurtbox" is the graze); one unit less is a graze. The 0.09 / 0.11
  // pair above is 0.01 either side, so it passes for `<=` and for a line moved by 40
  // units (0.0098): these three depths do not.
  it("puts the line at exactly 410 Q12 deep: 410 is a hit, 409 is a graze", () => {
    expect(GLANCING_BLOW_DEPTH).toBe(410);
    // Depth is the radii's sum less the spine distance, and the distance is an integer
    // square root, exact only when the squared distance divides by 4096. So the victim
    // stands a multiple of 64 away (19200 = 4.6875, so 300 × 64), and the box's radius
    // is what is set to reach the depth: depth = r + 4 (the body) − 4.6875 (all in Q12).
    const BODY = 4 * 4096;
    const DIST = 19200;
    const at = (depth: number): Frame[] => {
      const def: FighterDef = {
        ...BASE_DEF,
        moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ radius: depth + DIST - BODY })] }) },
      };
      const ctx = ctxFor(def);
      const s = standing(ctx);
      s.fighters[1].x = fx(8) + DIST;
      return play(s, 8, JAB, ctx);
    };
    expect(at(GLANCING_BLOW_DEPTH - 1).flatMap((f) => f.events.hits)).toEqual([]);
    expect(at(GLANCING_BLOW_DEPTH).flatMap((f) => f.events.hits)).toHaveLength(1);
    expect(at(GLANCING_BLOW_DEPTH + 1).flatMap((f) => f.events.hits)).toHaveLength(1);
  });

  // A graze is skipped before intangibility and invincibility are looked at, so a
  // victim in either is grazed like any other: the box simply is not there.
  describe("against a victim who is invincible or intangible", () => {
    const grazed = (over: Partial<FighterState>, depth: number): Frame[] => {
      const s = standing();
      Object.assign(s.fighters[1], over, { x: fx(17) - depth });
      return play(s, 8, JAB);
    };

    // Invincible is not intangible: a *hit* connects, is spent, freezes the attacker
    // and is reported with nothing transferred (the clang, `applyInvincibleHit`). A
    // graze is not a hit, so it gets none of that and the swing stays live.
    it("gives an invincible victim no clang from a graze, and leaves the swing unspent", () => {
      const frames = grazed({ invincible: 30 }, 205);
      expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
      expect(frames.at(-1)!.state.fighters[0].hitlag).toBe(0);
      expect(frames.at(-1)!.state.fighters[0].hitThisMove).toEqual([]);
      // The control: a box 0.2 in is the clang, zero damage, and the attacker frozen.
      const deep = grazed({ invincible: 30 }, 819);
      const hit = deep.flatMap((f) => f.events.hits);
      expect(hit).toHaveLength(1);
      expect(hit[0].damage).toBe(0);
      expect(deep.some((f) => f.state.fighters[0].hitlag > 0)).toBe(true);
      expect(deep.at(-1)!.state.fighters[0].hitThisMove).toEqual([1]);
    });

    // No mutant tells this from a deep box: an intangible victim is skipped whatever
    // the depth, and the swing is never spent on them (see `resolveHits`). It pins that
    // the graze does not change that.
    it("hits an intangible victim neither deep nor shallow, and spends nothing", () => {
      for (const depth of [205, 819]) {
        const frames = grazed({ intangible: 30 }, depth);
        expect(frames.flatMap((f) => f.events.hits), `depth ${depth}`).toEqual([]);
        expect(frames.at(-1)!.state.fighters[0].hitThisMove, `depth ${depth}`).toEqual([]);
        expect(frames.at(-1)!.state.fighters[1].damage, `depth ${depth}`).toBe(0);
      }
    });
  });

  it("does not spend the swing: the same jab lands once the bodies close in", () => {
    // A box that stays out for nine frames, so there is time to step into it.
    const long: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ startFrame: 4, endFrame: 12 })] }) },
    };
    const ctx = ctxFor(long);
    const s = standing(ctx);
    s.fighters[1].x = fx(8 + 5 + 4 - 0.05);
    const grazing = play(s, 8, JAB, ctx);
    expect(grazing.flatMap((f) => f.events.hits)).toEqual([]);
    expect(grazing.at(-1)!.state.fighters[0].action).toBe("attack");

    // The victim is carried a unit in; the same swing, still live, connects.
    const closer = cloneState(grazing.at(-1)!.state);
    closer.fighters[1].x -= fx(1);
    const after = play(closer, 3, () => [0, 0], ctx);
    expect(after.flatMap((f) => f.events.hits)).toHaveLength(1);
    expect(after.at(-1)!.state.fighters[0].hitThisMove).toEqual([1]);
  });

  describe("among one source's boxes", () => {
    /** A jab of two boxes on the same frames: id 0 reaches to 8, id 1 to 10 (both radius 5). */
    const TWO: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        jab1: move("jab1", { hitboxes: [hitbox({ id: 0, x: fx(8) }), hitbox({ id: 1, x: fx(10) })] }),
      },
    };
    function twoBoxes(victimX: number): Frame[] {
      const ctx = ctxFor(TWO);
      const s = standing(ctx);
      s.fighters[1].x = victimX;
      return play(s, 8, JAB, ctx);
    }

    // The glancing box is "the attack not hitting", so it is no incumbent: a
    // deeper box of the same swing that connects on the same frame still lands.
    it("lets a deeper box land when the lower-id box only grazes", () => {
      // Box 0 is 0.05 deep; box 1, two units further in, is 2.05 deep.
      const hits = twoBoxes(fx(8 + 5 + 4 - 0.05)).flatMap((f) => f.events.hits);
      expect(hits).toHaveLength(1);
      expect(hits[0].hitboxId).toBe(1);
    });

    it("still takes the lowest id when both reach in", () => {
      const hits = twoBoxes(fx(14)).flatMap((f) => f.events.hits);
      expect(hits).toHaveLength(1);
      expect(hits[0].hitboxId).toBe(0);
    });

    it("does not hit when every box only grazes", () => {
      // Box 1 grazes at 0.05 from a victim 2 further out; box 0 is out of reach.
      expect(twoBoxes(fx(10 + 5 + 4 - 0.05)).flatMap((f) => f.events.hits)).toEqual([]);
    });
  });

  // A projectile's box meets a hurtbox through the same candidate list as a fist.
  it("gives a projectile the same graze: no hit, not destroyed, and it lands a frame later", () => {
    const pellet = hitbox({ startFrame: 1, endFrame: 90, x: 0, y: 0, damage: fx(6) });
    const shooter: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        neutralB: move("neutralB", {
          totalFrames: 30,
          hitboxes: [],
          projectiles: [
            { id: "pellet", spawnFrame: 6, offsetX: fx(6), offsetY: fx(6), vx: fx(4), vy: 0, gravity: 0, lifetime: 90, hitbox: pellet, destroyOnHit: true, visual: "energy" },
          ],
        }),
      },
    };
    const ctx = ctxFor(shooter);
    const shoot = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Special : 0, 0];
    const field = standing(ctx);
    field.fighters[1].x = fx(75);
    // Where the pellet is on its third frame in the air, with nobody in its way.
    const free = play(field, 20, shoot, ctx);
    const born = free.findIndex((f) => f.state.projectiles.length > 0);
    const k = born + 2;
    const pelletX = free[k].state.projectiles[0].x;

    // The victim stands so that frame k's pellet reaches 0.05 into the body.
    const s = standing(ctx);
    s.fighters[1].x = pelletX + fx(5 + 4 - 0.05);
    const frames = play(s, k + 3, shoot, ctx);
    expect(frames.slice(0, k + 1).flatMap((f) => f.events.hits)).toEqual([]);
    expect(frames[k].state.projectiles).toHaveLength(1);
    // The next frame it is 4 units closer and 4.05 deep.
    expect(frames.findIndex((f) => f.events.hits.length > 0)).toBe(k + 1);
  });

  // SmashWiki's glancing blow is a hitbox meeting a hurtbox. Grabs and a raised
  // shield are not decided by the depth of the hit, so both keep the plain test.
  it("leaves a grab box that only grazes the body able to grab", () => {
    const s = standing();
    s.fighters[1].x = fx(8 + 5 + 4 - 0.05);
    const frames = play(s, 10, (i) => [i === 0 ? Btn.Grab : 0, 0]);
    expect(frames.at(-1)!.state.fighters[1].action).toBe("grabbed");
    expect(frames.at(-1)!.state.fighters[0].grabbing).toBe(1);
  });

  it("leaves a hit that reaches a raised shield a shield hit however shallow the body graze", () => {
    const s = standing();
    s.fighters[1].x = fx(8 + 5 + 4 - 0.05);
    const frames = play(s, 12, JAB_INTO_SHIELD);
    expect(frames.flatMap((f) => f.events.shieldHits)).toHaveLength(1);
    expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
  });

  it("still skips a graze that misses the shield and would land on the body", () => {
    // A shield worn to 15% of its radius (the Task 9 poke), and a low box that
    // reaches only 0.05 into the body, nowhere near the shield.
    const low: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ y: fx(0.5), radius: fx(1.5) })] }) },
    };
    const ctx = ctxFor(low);
    const s = standing(ctx);
    s.fighters[1].shieldHealth = fx(2);
    // 4.177 across and 3.5 up from the box: 5.45 from the spine's lower end, 5.5 reach.
    s.fighters[1].x = fx(8 + 4.177);
    const frames = play(s, 10, JAB_INTO_SHIELD, ctx);
    expect(frames.flatMap((f) => f.events.shieldHits)).toEqual([]);
    expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
    expect(frames.at(-1)!.state.fighters[1].damage).toBe(0);
  });

  describe("sweptHitboxPenetration", () => {
    /** A fighter-shaped hurtbox on `x`: spine 4 to 8 up, radius 4. */
    const body = (x: number) => ({ x1: x, y1: fx(4), x2: x, y2: fx(8), r: fx(4) });

    it("is the sum of the radii less the spine distance", () => {
      // Box (0, 6) radius 5 and a body whose spine is 36416 Q12 away: 9 - 8.890625.
      // The distance is a multiple of 64, so the integer square root is exact.
      expect(sweptHitboxPenetration(0, fx(6), 0, fx(6), fx(5), body(36416))).toBe(fx(9) - 36416);
      expect(sweptHitboxPenetration(0, fx(6), 0, fx(6), fx(5), body(fx(20)))).toBe(-fx(11));
    });

    it("puts 0.109375 on the hitting side of 0.1 and 0.09375 on the glancing one", () => {
      expect(sweptHitboxPenetration(0, fx(6), 0, fx(6), fx(5), body(fx(9) - 448))).toBeGreaterThanOrEqual(GLANCING_BLOW_DEPTH);
      expect(sweptHitboxPenetration(0, fx(6), 0, fx(6), fx(5), body(fx(9) - 384))).toBeLessThan(GLANCING_BLOW_DEPTH);
    });

    it("is the full sum of radii for a box swept through the spine", () => {
      expect(sweptHitboxPenetration(0, fx(6), fx(40), fx(6), fx(5), body(fx(20)))).toBe(fx(9));
    });

    it("is measured to the nearest point of the sweep, not to where the box ends", () => {
      // Swept from 8 back to 0, away from a body 36416 Q12 (8.890625) past the
      // start: the end is far out of reach, the start is 0.109375 inside it.
      expect(sweptHitboxPenetration(fx(8), fx(6), 0, fx(6), fx(5), body(fx(8) + 36416))).toBe(fx(9) - 36416);
    });

    it("agrees with sweptHitboxOverlaps: touching is not negative, and 0.1 deep is touching", () => {
      let seen = 0;
      for (const prevX of [0, fx(3), fx(-6)]) {
        for (const x of [0, fx(2.5), fx(7)]) {
          for (let bx = fx(-14); bx <= fx(14); bx += fx(0.25)) {
            for (const y of [fx(-2), fx(0.5), fx(6), fx(11)]) {
              const depth = sweptHitboxPenetration(prevX, y, x, y, fx(3), body(bx));
              const overlaps = sweptHitboxOverlaps(prevX, y, x, y, fx(3), body(bx));
              if (overlaps) expect(depth).toBeGreaterThanOrEqual(0);
              if (depth >= GLANCING_BLOW_DEPTH) expect(overlaps).toBe(true);
              if (!overlaps) expect(depth).toBeLessThan(GLANCING_BLOW_DEPTH);
              if (overlaps) seen += 1;
            }
          }
        }
      }
      expect(seen).toBeGreaterThan(100);
    });
  });
});

/* ------------------------------------------------------ Task 14: grabs -- */

describe("grab hold, mash and release (Plan 3, Task 14)", () => {
  /** Fighter 0 holding fighter 1, whose escape timer reads `timer`, `held` frames into the hold. */
  function holding(timer: number, held: number): GameState {
    const s = standing();
    const [a, v] = s.fighters;
    a.action = "grabHold";
    a.grabbing = 1;
    v.action = "grabbed";
    v.actionFrame = held;
    v.grabbedBy = 0;
    v.grabTimer = timer;
    return s;
  }

  // SmashWiki "Grab" (https://www.ssbwiki.com/Grab): from Brawl on a grab holds
  // for floor(90 + 1.7p) frames, fixed when it connects.
  it("holds a victim for floor(90 + 1.7 x percent) frames", () => {
    const s = standing();
    s.fighters[1].damage = fx(50);
    const frames = play(s, 8, (i) => [i === 0 ? Btn.Grab : 0, 0]);
    const i = frames.findIndex((f) => f.state.fighters[1].grabbedBy === 0);
    expect(frames[i].state.fighters[1].grabTimer).toBe(175);
    expect(grabHoldFrames(fx(50))).toBe(175);
    expect(grabHoldFrames(fx(33.3))).toBe(146);
  });

  it("lets the victim go when the timer runs out, with 60 frames of grab immunity", () => {
    const frames = play(holding(3, 30), 4, () => [0, 0]);
    const at = frames.findIndex((f) => f.state.fighters[1].grabbedBy < 0);
    expect(at).toBe(2);
    const v = frames[at].state.fighters[1];
    expect(v.action).toBe("stand");
    expect(v.combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY);
    expect(frames.at(-1)!.state.fighters[0].action).toBe("stand");
  });

  // "The grab time from Brawl onward cannot be lower than 19 frames."
  it("never lets go before the 19th frame of the hold", () => {
    const frames = play(holding(0, 5), 20, () => [0, 0]);
    const at = frames.findIndex((f) => f.state.fighters[1].grabbedBy < 0);
    expect(frames[at].state.fighters[1].actionFrame).toBe(0);
    expect(frames[at - 1].state.fighters[1].actionFrame).toBe(GRAB_MIN_FRAMES - 1);
  });

  // SmashWiki "Grab": a button press takes 14.4 frames off in Ultimate, a stick input 8.
  it("mashes 14.4 frames off a button press and 8 off a stick input", () => {
    const buttons = play(holding(200, 30), 10, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]).at(-1)!.state.fighters[1];
    expect(buttons.grabTimer).toBe(200 - 10 - 72);
    const sticks = play(holding(200, 30), 10, (i) => [0, i % 2 === 0 ? Btn.Left : 0]).at(-1)!.state.fighters[1];
    expect(sticks.grabTimer).toBe(200 - 10 - 40);
  });

  it("whiffs a grab on a fighter who just escaped one, without spending it", () => {
    const s = standing();
    s.fighters[1].combat.grabImmune = 30;
    const after = play(s, 8, (i) => [i === 0 ? Btn.Grab : 0, 0]).at(-1)!.state;
    expect(after.fighters[1].grabbedBy).toBe(-1);
    expect(after.fighters[0].hitThisMove).toEqual([]);
  });
});

describe("being grabbed ends what the grab replaces (Plan 3, Task 14)", () => {
  const GRAB = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Grab : 0, 0];

  /** The state the frame before fighter 1 is caught, and the frame it is. */
  function caught(s: GameState, ctx: SimContext = ctxFor()): { before: GameState; at: GameState } {
    const frames = play(s, 12, GRAB, ctx);
    const i = frames.findIndex((f) => f.state.fighters[1].grabbedBy === 0);
    expect(i, "the grab should connect").toBeGreaterThan(0);
    return { before: frames[i - 1].state, at: frames[i].state };
  }

  /** Fighter 1 four units up, in the air, with `jumpsUsed` jumps spent. */
  function airborne(jumpsUsed: number): GameState {
    const s = standing();
    const v = s.fighters[1];
    v.grounded = false;
    v.platform = -1;
    v.y = fx(4);
    v.action = "fall";
    v.jumpsUsed = jumpsUsed;
    return s;
  }

  // SmashWiki "Double jump" (https://www.ssbwiki.com/Double_jump): "A character's
  // double jump(s) are restored upon landing, grabbing a ledge, being KO'd and
  // respawning, or being grabbed by an opposing character".
  it.each([
    [2, 1],
    [3, 1],
    [1, 1],
  ])("gives a fighter caught in the air its midair jumps back, not the ground jump (%i spent -> %i)", (spent, left) => {
    const { before, at } = caught(airborne(spent));
    expect(before.fighters[1].jumpsUsed).toBe(spent);
    expect(at.fighters[1].grounded).toBe(false);
    expect(at.fighters[1].jumpsUsed).toBe(left);
  });

  // SmashWiki "Air dodge" (https://www.ssbwiki.com/Air_dodge): "Characters can only
  // air dodge once until they land, get hit, or grab a ledge." A grab is not a hit
  // and the list does not name it. UNVERIFIED: that this is the whole list.
  it("does not give the air dodge back: being grabbed is not being hit", () => {
    const s = airborne(2);
    s.fighters[1].airDodged = true;
    expect(caught(s).at.fighters[1].airDodged).toBe(true);
  });

  /** Fighter 1 hanging from the right-hand ledge, past the end of its intangibility, fighter 0 on the stage beside it. */
  function hanging(): GameState {
    const s = standing();
    const v = s.fighters[1];
    v.x = fx(80);
    v.y = 0;
    v.grounded = false;
    v.platform = -1;
    v.facing = -1;
    v.action = "ledgeHang";
    v.ledge = { platform: 0, side: 1 };
    v.ledgeRegrabs = 3;
    s.fighters[0].x = fx(72);
    return s;
  }

  // SmashWiki "Grab" (https://www.ssbwiki.com/Grab): "In Melee, characters hanging
  // on ledges cannot be grabbed, but in every other game they can". A hanger is
  // intangible for a while (SmashWiki "Ledge"); once that has passed the grab
  // connects, and the ledge must not outlive it. The lockout is UNVERIFIED.
  it("pulls a hanging fighter off the ledge, locks the ledge out and keeps the regrab count", () => {
    const { before, at } = caught(hanging());
    expect(before.fighters[1].ledge).toEqual({ platform: 0, side: 1 });
    const v = at.fighters[1];
    expect(v.action).toBe("grabbed");
    expect(v.ledge).toBeNull();
    expect(v.ledgeLockout).toBe(LEDGE_REGRAB_LOCKOUT_FRAMES);
    expect(v.ledgeRegrabs).toBe(3);
  });

  describe("ends the victim's hitstun and what rides on it", () => {
    it.each([
      ["hitstun", 50],
      ["shieldStun", 20],
      ["shieldBroken", 300],
    ] as const)("%s", (action, stun) => {
      const s = standing();
      const v = s.fighters[1];
      v.action = action;
      v.hitstun = stun;
      v.combat.mash = 7;
      const { before, at } = caught(s);
      expect(before.fighters[1].hitstun).toBeGreaterThan(0);
      expect(at.fighters[1].action).toBe("grabbed");
      expect(at.fighters[1].hitstun).toBe(0);
      // The mash carry is the shield-break one's, not the struggle's (`mashFrames`).
      expect(at.fighters[1].combat.mash).toBe(0);
    });

    it("disarms the balloon speed-up and drops the balloon fall", () => {
      const s = standing();
      const v = s.fighters[1];
      v.action = "hitstun";
      v.hitstun = 50;
      v.balloon = true;
      v.kinetic.speedUpFaf = 70;
      v.kinetic.speedUpFrame = 70 * ONE;
      v.kinetic.speedUpMax = damageSpeedUpMaxMag(70);
      const { before, at } = caught(s);
      expect(before.fighters[1].kinetic.speedUpMax).toBeGreaterThan(0);
      expect(before.fighters[1].balloon).toBe(true);
      expect(at.fighters[1].kinetic).toMatchObject({ speedUpMax: 0, speedUpFaf: 0, speedUpFrame: 0 });
      expect(at.fighters[1].balloon).toBe(false);
    });

    // Plan 3, Task 16b: the same for a set-weight launch's own fall.
    it("disarms set weight's fall", () => {
      const s = standing();
      const v = s.fighters[1];
      v.action = "hitstun";
      v.hitstun = 50;
      v.kinetic.setWeightFrames = SET_WEIGHT_LAUNCH_FRAMES;
      const { before, at } = caught(s);
      expect(before.fighters[1].kinetic.setWeightFrames).toBeGreaterThan(0);
      expect(at.fighters[1].kinetic.setWeightFrames).toBe(0);
    });

    it("leaves the released fighter free to act, not still stunned", () => {
      const s = standing();
      const v = s.fighters[1];
      v.action = "shieldBroken";
      v.hitstun = 300;
      const held = caught(s).at;
      // Skip to the end of the struggle, which the stun is not part of.
      held.fighters[1].grabTimer = 1;
      held.fighters[1].actionFrame = 30;
      const after = play(held, 3, () => [0, 0]).at(-1)!.state.fighters[1];
      expect(after.grabbedBy).toBe(-1);
      expect(after.action).toBe("stand");
      expect(after.hitstun).toBe(0);
    });
  });

  /** Three fighters, as `standing()` places two: fighter 2 is 12 units behind fighter 0, facing it. */
  function standing3(ctx: SimContext = ctxFor()): GameState {
    const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
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
    s.fighters[1].x = fx(8);
    s.fighters[1].facing = -1;
    s.fighters[2].x = fx(-12);
    s.fighters[2].facing = 1;
    return s;
  }

  /** Fighter 0 already holding fighter 1, whose escape timer reads `timer`, 30 frames into the hold. */
  function holdingPair(s: GameState, timer: number): GameState {
    const [a, v] = s.fighters;
    a.action = "grabHold";
    a.grabbing = 1;
    v.action = "grabbed";
    v.actionFrame = 30;
    v.grabbedBy = 0;
    v.grabTimer = timer;
    return s;
  }

  // The two bodies touching: both are 4 wide in these fixtures (UNVERIFIED, see `holdAtCaptor`).
  const REACH = fx(8);

  describe("a held fighter stays at its captor (fix round 1)", () => {
    function heldFrames(s: GameState, n: number): { at: number; frames: Frame[] } {
      const frames = play(s, n, GRAB);
      const at = frames.findIndex((f) => f.state.fighters[1].grabbedBy === 0);
      expect(at, "the grab should connect").toBeGreaterThan(0);
      return { at, frames };
    }

    it("holds a fighter caught in the air at the captor's side, standing, for the whole hold", () => {
      const { at, frames } = heldFrames(airborne(2), 110);
      expect(frames[at].state.fighters[1].grounded).toBe(false);
      for (const f of frames.slice(at + 1, at + 90)) {
        const [a, v] = f.state.fighters;
        expect(v).toMatchObject({ action: "grabbed", grabbedBy: 0, grounded: true, y: a.y, facing: -a.facing });
        expect(v.x).toBe(a.x + a.facing * REACH);
        // Standing where the captor stands is touching the ground: the jumps and the air dodge are back.
        expect(v).toMatchObject({ jumpsUsed: 0, airDodged: false });
      }
      // The whole 90 frames, as a fighter caught on the ground gets, and then it lets go.
      expect(frames[at + 89].state.fighters[1].grabbedBy).toBe(0);
      expect(frames[at + 90].state.fighters[1].grabbedBy).toBe(-1);
    });

    it("lets the captor pummel and then throw a fighter caught in the air", () => {
      const def: FighterDef = {
        ...BASE_DEF,
        moves: {
          ...BASE_DEF.moves,
          pummel: move("pummel", { totalFrames: 10, hitboxes: [hitbox({ startFrame: 1, endFrame: 1, x: fx(40), damage: fx(2) })] }),
          fthrow: move("fthrow", { totalFrames: 20, hitboxes: [hitbox({ startFrame: 4, endFrame: 4, x: fx(4), damage: fx(6), baseKnockback: fx(60), knockbackGrowth: fx(70) })] }),
        },
      };
      const ctx = ctxFor(def);
      const at = play(airborne(2), 12, GRAB, ctx).findIndex((f) => f.state.fighters[1].grabbedBy === 0);
      const inputs = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Grab : i === at + 4 ? Btn.Attack : i === at + 30 ? Btn.Right : 0, 0];
      const frames = play(airborne(2), at + 80, inputs, ctx);
      const hits = frames.flatMap((f) => f.events.hits);
      // The pummel first (knockback 0), then the throw (it launches).
      expect(hits).toHaveLength(2);
      expect(hits[0].knockback).toBe(0);
      expect(hits[1].knockback).toBeGreaterThan(0);
      const v = frames.at(-1)!.state.fighters[1];
      expect(v.grabbedBy).toBe(-1);
      expect(v.damage).toBeGreaterThan(hits[0].damage);
    });

    it("holds a ledge hanger at the captor rather than dropping it off the stage, and does not KO it", () => {
      const { at, frames } = heldFrames(hanging(), 100);
      for (const f of frames.slice(at + 1, at + 89)) {
        const [a, v] = f.state.fighters;
        expect(v).toMatchObject({ action: "grabbed", ledge: null, grounded: true, y: 0 });
        expect(v.x).toBe(a.x + REACH);
      }
      expect(frames.flatMap((f) => f.events.kos)).toEqual([]);
      expect(frames.at(-1)!.state.fighters[1].stocks).toBe(3);
    });

    it("follows a captor that slides, frame for frame", () => {
      const held = caught(standing()).at;
      kineticSetX(held.fighters[0], fx(1.5));
      const frames = play(held, 10, () => [0, 0]);
      for (const f of frames) {
        const [a, v] = f.state.fighters;
        expect(v.x).toBe(a.x + a.facing * REACH);
        expect(v.vx).toBe(0);
      }
      expect(frames.at(-1)!.state.fighters[0].x).toBeGreaterThan(held.fighters[0].x + fx(3));
    });

    // The backstop: nothing leaves `grabbed` on its own now, but a hold must not depend on it.
    it("still ends a hold whose victim has left `grabbed`, and that victim is immune to grabs", () => {
      const s = standing();
      const [a, v] = s.fighters;
      a.action = "grabHold";
      a.grabbing = 1;
      v.grabbedBy = 0;
      v.grabTimer = 50;
      const [first] = play(s, 1, () => [0, 0]);
      expect(first.state.fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
      // The escape timer is the victim's and goes with the link.
      expect(first.state.fighters[1]).toMatchObject({ grabbedBy: -1, grabTimer: 0 });
      // It may already have ticked once in the frame it was granted.
      expect(first.state.fighters[1].combat.grabImmune).toBeGreaterThan(GRAB_RELEASE_IMMUNITY - 3);
    });
  });

  describe("a captor that stops holding lets go (fix round 2)", () => {
    // Anything but CATCH, CATCH_WAIT, CATCH_ATTACK and THROW with `grabbing` still set:
    // a clank cancelled the pummel, a slide took the captor off the stage.
    it.each(["stand", "fall", "ledgeHang", "attack", "shield"] as const)(
      "frees the victim of a captor in %s, in place and unhurt, rather than carrying it",
      (action) => {
        const s = holdingPair(standing(), 100);
        s.fighters[0].action = action;
        s.fighters[0].x = fx(30);
        const v = play(s, 1, () => [0, 0])[0].state.fighters[1];
        expect(v.grabbedBy).toBe(-1);
        expect(v.x).toBe(fx(8));
        expect(v.combat.grabImmune).toBeGreaterThan(GRAB_RELEASE_IMMUNITY - 3);
      },
    );

    it("does not clank a pummel with an opposing hitbox: the pummel lands and the hold stays", () => {
      const clanking: FighterDef = {
        ...BASE_DEF,
        moves: {
          ...BASE_DEF.moves,
          // The pummel's box is 40 units out; fighter 2's jab (a box 8 out) meets it there.
          pummel: move("pummel", { totalFrames: 10, hitboxes: [hitbox({ startFrame: 1, endFrame: 1, x: fx(40), damage: fx(2) })] }),
        },
      };
      const ctx = ctxFor(clanking);
      const s = holdingPair(standing3(ctx), 100);
      s.fighters[2].x = fx(32);
      s.fighters[2].facing = 1;
      // Fighter 2 jabs on frame 1 (live 4-6); fighter 0 pummels on frame 5 (live 6).
      const frames = play(s, 14, (i) => [i === 5 ? Btn.Attack : 0, 0, i === 1 ? Btn.Attack : 0], ctx);
      expect(frames.flatMap((f) => f.events.clanks)).toEqual([]);
      expect(frames.flatMap((f) => f.events.hits).filter((h) => h.victim === 1)).toHaveLength(1);
      expect(frames.at(-1)!.state.fighters[0].grabbing).toBe(1);
    });

    // Plan 3, Task 17: the same with a capsule pummel box, which spans 38 to 42 units
    // out: a capsule is geometry only for what has geometry, and a catch-only box has none.
    it("does not clank a capsule pummel with an opposing hitbox either", () => {
      const clanking: FighterDef = {
        ...BASE_DEF,
        moves: { ...BASE_DEF.moves, pummel: move("pummel", { totalFrames: 10, hitboxes: [] }) },
        scripts: {
          pummel: {
            name: "game_catchattack",
            motion: "catch_attack",
            commands: [
              frame(1),
              ATTACK({ id: 0, bone: "top", damage: 2, angle: 361, kbg: 0, bkb: 0, size: 5, x: 0, y: 6, z: 38, z2: 42 }),
              frame(2),
              clearAll(),
            ],
          },
        },
      };
      const ctx = ctxFor(clanking);
      const s = holdingPair(standing3(ctx), 100);
      s.fighters[2].x = fx(32);
      s.fighters[2].facing = 1;
      const frames = play(s, 14, (i) => [i === 5 ? Btn.Attack : 0, 0, i === 1 ? Btn.Attack : 0], ctx);
      expect(frames.flatMap((f) => f.events.clanks)).toEqual([]);
      expect(frames.flatMap((f) => f.events.hits).filter((h) => h.victim === 1)).toHaveLength(1);
      expect(frames.at(-1)!.state.fighters[0].grabbing).toBe(1);
    });

    // The catch statuses use GROUND_CLIFF_STOP in the game (UNVERIFIED that this is the
    // param; the replica passes `cliffStop` to the collision).
    it.each(["grab", "grabHold", "pummel", "throw"] as const)("%s stops at the platform's edge instead of walking off it", (action) => {
      // Holding someone, as all four are (a hold with nobody in it ends).
      const s = holdingPair(standing(), 200);
      const a = s.fighters[0];
      a.action = action;
      a.x = fx(79);
      kineticSetX(a, fx(2));
      const frames = play(s, 3, () => [0, 0]);
      for (const f of frames) expect(f.state.fighters[0]).toMatchObject({ grounded: true, platform: 0, x: fx(80), grabbing: 1 });
      // The stop is of the velocity too (`resolveCollision`'s `kineticSetX(f, 0)`), not only
      // of the position: held against the lip it is going nowhere, so nothing is left to
      // push it at the edge again each frame, or to carry it on once the hold ends.
      for (const [k, f] of frames.entries()) {
        const a = f.state.fighters[0];
        expect([a.vx, kineticSumX(a)], `frame ${k}`).toEqual([0, 0]);
      }
    });

    it("never carries a victim past the edge: a holder pushed at the lip stops there, still holding", () => {
      const s = holdingPair(standing(), 200);
      s.fighters[0].x = fx(77);
      s.fighters[1].x = fx(85);
      kineticSetX(s.fighters[0], fx(2));
      const frames = play(s, 40, () => [0, 0]);
      for (const f of frames) {
        const [a, v] = f.state.fighters;
        expect(a).toMatchObject({ grounded: true, grabbing: 1 });
        expect(a.x).toBeLessThanOrEqual(fx(80));
        expect(v.y).toBe(a.y);
        expect(f.events.kos).toEqual([]);
      }
    });
  });

  describe("a victim held past the edge is held in the air (fix round 2)", () => {
    function atTheLip(x: number): GameState {
      const s = holdingPair(standing(), 100);
      s.fighters[0].x = fx(x);
      s.fighters[1].jumpsUsed = 2;
      s.fighters[1].airDodged = true;
      return s;
    }

    it("marks a victim over the platform grounded on it, with its jumps and air dodge back", () => {
      const v = play(atTheLip(70), 1, () => [0, 0])[0].state.fighters[1];
      expect(v).toMatchObject({ x: fx(78), grounded: true, platform: 0, jumpsUsed: 0, airDodged: false });
    });

    it("marks a victim held past the edge airborne: no ground, no restore, and it falls when released", () => {
      const s = atTheLip(76);
      s.fighters[1].grabTimer = 3;
      const frames = play(s, 5, () => [0, 0]);
      const held = frames[0].state.fighters[1];
      expect(held).toMatchObject({ x: fx(84), y: 0, grounded: false, platform: -1, jumpsUsed: 2, airDodged: true, airTime: 0 });
      // Airtime stays 0 for as long as it is held, frame after frame: a fighter that is placed
      // is not falling, so the ledge's airtime bonus does not run (UNVERIFIED: no source says
      // what being held does to it; `holdAtCaptor`). Once it is let go the count starts again.
      const heldFrames = frames.filter((f) => f.state.fighters[1].grabbedBy >= 0);
      expect(heldFrames.length).toBeGreaterThan(1);
      for (const f of heldFrames) expect(f.state.fighters[1].airTime).toBe(0);
      // Let go at the lip: the victim is in the air rather than standing on nothing (and, being
      // right at the ledge, may take it).
      const freed = frames.find((f) => f.state.fighters[1].grabbedBy < 0)!.state.fighters[1];
      expect(freed.grounded).toBe(false);
      expect(["fall", "ledgeHang"]).toContain(freed.action);
    });
  });

  describe("which releases leave 60 frames of grab immunity (UNVERIFIED which kinds count)", () => {
    const THROWS: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        // A throw with no box to land (the backstop), and one whose box lands.
        fthrow: move("fthrow", { totalFrames: 5, hitboxes: [] }),
        bthrow: move("bthrow", { totalFrames: 20, hitboxes: [hitbox({ startFrame: 4, endFrame: 4, x: fx(2) })] }),
      },
    };

    it("is given when the thrower's animation ends without a hit (the throw backstop)", () => {
      const ctx = ctxFor(THROWS);
      const s = standing(ctx);
      const [a, v] = s.fighters;
      a.action = "throw";
      a.move = "fthrow";
      a.grabbing = 1;
      v.action = "thrown";
      v.grabbedBy = 0;
      const after = play(s, 8, () => [0, 0], ctx).at(-1)!.state;
      expect(after.fighters[1].grabbedBy).toBe(-1);
      expect(after.fighters[1].combat.grabImmune).toBeGreaterThan(40);
    });

    it("is not given by a throw that hits: the victim is launched, and may be chain-grabbed", () => {
      const ctx = ctxFor(THROWS);
      const s = holdingPair(standing(ctx), 100);
      const frames = play(s, 30, (i) => [i === 2 ? Btn.Left : 0, 0], ctx);
      expect(frames.flatMap((f) => f.events.hits)).toHaveLength(1);
      const v = frames.at(-1)!.state.fighters[1];
      expect(v.grabbedBy).toBe(-1);
      expect(v.combat.grabImmune).toBe(0);
    });

    it("is not given when the captor is hit: the victim is freed, not released", () => {
      const s = holdingPair(standing3(), 100);
      // Fighter 2 jabs fighter 0 from behind; the box reaches no one else.
      const frames = play(s, 12, (i) => [0, 0, i === 0 ? Btn.Attack : 0]);
      const last = frames.at(-1)!.state;
      expect(last.fighters[0].hitstun).toBeGreaterThan(0);
      expect(last.fighters[1]).toMatchObject({ grabbedBy: -1 });
      expect(last.fighters[1].combat.grabImmune).toBe(0);
    });
  });

  // SmashWiki "Grab" (https://www.ssbwiki.com/Grab): "From Brawl onward, the formula is
  // changed to 90 + 1.7p rounded down", and the grab time is "not affected by pummeling".
  it("lets a held fighter at 0% go exactly 90 frames after the catch, with 60 frames of immunity", () => {
    const frames = play(standing(), 120, GRAB);
    const at = frames.findIndex((f) => f.state.fighters[1].grabbedBy === 0);
    expect(frames[at + 89].state.fighters[1]).toMatchObject({ grabbedBy: 0, action: "grabbed" });
    const freed = frames[at + 90].state.fighters[1];
    expect(freed).toMatchObject({ grabbedBy: -1, action: "stand" });
    expect(freed.combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY);
    expect(frames[at + 91].state.fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
  });

  describe("pummelling (SmashWiki \"Pummel\", https://www.ssbwiki.com/Pummel)", () => {
    // The box is 40 units out: it can only land by being catch-only.
    const PUMMEL: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        pummel: move("pummel", {
          totalFrames: 10,
          hitboxes: [hitbox({ startFrame: 1, endFrame: 1, x: fx(40), damage: fx(8), angle: fx(361), baseKnockback: 0, fixedKnockback: fx(40) })],
        }),
      },
    };
    const pummelCtx = ctxFor(PUMMEL);
    /** Fighter 0 pummels on frame 2 (it lands on 3); fighter 1 presses attack on the frames `mash` names. */
    const PUMMEL_INPUT = (mash: (i: number) => boolean) => (i: number) =>
      [i === 2 ? Btn.Attack : 0, mash(i) ? Btn.Attack : 0] as const;
    const NO_MASH = () => false;

    function pummelled(timer: number, mash: (i: number) => boolean = NO_MASH, n = 30): { hit: number; frames: Frame[] } {
      const frames = play(holdingPair(standing(pummelCtx), timer), n, PUMMEL_INPUT(mash), pummelCtx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      expect(hit, "the pummel should land").toBeGreaterThan(0);
      return { hit, frames };
    }

    it("damages the held fighter and keeps it held: no knockback, no hitstun, no release", () => {
      const { hit, frames } = pummelled(100);
      expect(frames[hit].events.hits).toEqual([
        expect.objectContaining({ attacker: 0, victim: 1, knockback: 0, angle: 0, hitboxId: 0 }),
      ]);
      const [a, v] = frames[hit].state.fighters;
      expect(v.damage).toBe(frames[hit].events.hits[0].damage);
      expect(v.damage).toBeGreaterThan(0);
      expect(v).toMatchObject({ action: "grabbed", grabbedBy: 0, hitstun: 0 });
      expect(a).toMatchObject({ action: "pummel", grabbing: 1 });
      // "Like other attacks, pummels inflict hitlag": a shared freeze.
      expect(v.hitlag).toBeGreaterThan(0);
      expect(a.hitlag).toBe(v.hitlag);
      // Nothing was launched, now or when the freeze ends.
      const end = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
      expect(frames[end].state.fighters[1]).toMatchObject({ vx: 0, vy: 0, grounded: true, grabbedBy: 0 });
    });

    // SmashWiki "Grab": the grab time is "not affected by pummeling". The hit leaves
    // the timer as the clock had it; the freeze, like everything in one, holds it.
    it("leaves the escape timer to the clock: the hit does not touch it, and the freeze holds it", () => {
      const { hit, frames } = pummelled(100);
      const timer = (i: number): number => frames[i].state.fighters[1].grabTimer;
      expect(timer(hit)).toBe(timer(hit - 1) - 1);
      const lag = frames[hit].state.fighters[1].hitlag;
      for (let i = hit + 1; i <= hit + lag; i++) expect(timer(i)).toBe(timer(hit));
      expect(timer(hit + lag + 1)).toBe(timer(hit) - 1);
    });

    // SmashWiki "Pummel": "opponents can still mash out of the attacker's grab during hitlag".
    it("counts a mash made during the freeze, and only the mash", () => {
      const quiet = pummelled(100).frames;
      const hit = quiet.findIndex((f) => f.events.hits.length > 0);
      const lag = quiet[hit].state.fighters[1].hitlag;
      // Presses on the freeze's even frames (a press needs a frame without it before).
      const mashing = (i: number): boolean => i > hit && i <= hit + lag && i % 2 === 0;
      const { frames } = pummelled(100, mashing, hit + lag + 2);
      const presses = Array.from({ length: lag }, (_, k) => hit + 1 + k).filter(mashing).length;
      expect(presses).toBeGreaterThan(0);
      expect(frames[hit + lag].state.fighters[1].grabTimer).toBe(
        quiet[hit].state.fighters[1].grabTimer - Math.floor((presses * GRAB_MASH_BUTTON) / 10),
      );
    });

    it("joins the staleness queue, and the second pummel is staled", () => {
      const s = holdingPair(standing(pummelCtx), 300);
      const frames = play(s, 50, (i) => [i === 2 || i === 30 ? Btn.Attack : 0, 0], pummelCtx);
      const hits = frames.flatMap((f) => f.events.hits);
      expect(hits).toHaveLength(2);
      expect(hits[1].damage).toBeLessThan(hits[0].damage);
      expect(frames.at(-1)!.state.fighters[0].staleQueue).toEqual(["pummel", "pummel"]);
    });

    it("hits the fighter held and nobody standing in the box", () => {
      const s = holdingPair(standing3(pummelCtx), 100);
      // Fighter 2 stands where the box is (fighter 0 + 40), well clear of fighter 0.
      s.fighters[2].x = fx(40);
      s.fighters[2].facing = -1;
      const frames = play(s, 8, (i) => [i === 2 ? Btn.Attack : 0, 0, 0], pummelCtx);
      const hits = frames.flatMap((f) => f.events.hits);
      expect(hits.map((h) => h.victim)).toEqual([1]);
      expect(frames.at(-1)!.state.fighters[2].damage).toBe(0);
    });
  });

  describe("throws land on the held fighter (SSBU throws are `ATTACK_ABS`: no collision)", () => {
    const throwing = (slot: "fthrow" | "bthrow", angle: number, x: number): FighterDef => ({
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        [slot]: move(slot, { totalFrames: 20, hitboxes: [hitbox({ startFrame: 4, endFrame: 4, x, angle, damage: fx(6), baseKnockback: fx(60), knockbackGrowth: fx(70) })] }),
      },
    });

    /** Fighter 0, facing right, throws fighter 1 with `button`; the launch's horizontal speed once the freeze ends. */
    function launch(def: FighterDef, button: Btn): { hits: number; vx: number } {
      const ctx = ctxFor(def);
      const frames = play(holdingPair(standing(ctx), 100), 30, (i) => [i === 2 ? button : 0, 0], ctx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      expect(hit, "the throw should land").toBeGreaterThan(0);
      const out = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
      return { hits: frames.flatMap((f) => f.events.hits).length, vx: frames[out].state.fighters[1].vx };
    }

    it("lands wherever its box is, once, and launches along the box's angle", () => {
      const out = launch(throwing("fthrow", fx(45), fx(40)), Btn.Right);
      expect(out.hits).toBe(1);
      expect(out.vx).toBeGreaterThan(0);
    });

    // Plan 5, Task 7 replaces this with the game's `REVERSE_LR`; the roster's own
    // back-throw angles are mixed (Mario's 45° points forward, Marth's 140° behind).
    it.each([
      ["a box authored pointing forward (45°)", 45],
      ["a box authored pointing behind (135°)", 135],
    ])("sends a back throw behind the thrower: %s", (_name, angle) => {
      const out = launch(throwing("bthrow", fx(angle), fx(-4)), Btn.Left);
      expect(out.hits).toBe(1);
      expect(out.vx).toBeLessThan(0);
    });

    it("leaves a forward throw's direction alone when its box points forward", () => {
      expect(launch(throwing("fthrow", fx(135), fx(4)), Btn.Right).vx).toBeLessThan(0);
    });
  });
});

/* ------------------------------------------------ Task 15: ledge trump -- */

describe("ledge trump (Plan 3, Task 15)", () => {
  const HANG_X = fx(80);

  /** Put `f` on a ledge of the stage (the right-hand one unless told), hanging, past its grab's intangibility. */
  function hang(f: FighterState, side: 1 | -1 = 1, intangible = 50): void {
    Object.assign(f, { x: side * HANG_X, y: 0, grounded: false, platform: -1, action: "ledgeHang", actionFrame: 5, intangible });
    f.ledge = { platform: 0, side };
    f.facing = -side;
  }

  /** `f` drops onto the right-hand ledge (or the left, for `side` -1) from `above` units over it, beside the stage and facing it. */
  function dropOnto(f: FighterState, above = 0, side: 1 | -1 = 1): void {
    Object.assign(f, { x: side * fx(84), y: fx(-2) + fx(above), grounded: false, platform: -1, action: "fall", actionFrame: 3, facing: -side });
    f.kinetic.gravityY = -fx(1);
    f.vy = -fx(1);
  }

  /** Three fighters, all standing on the stage. */
  function three(): GameState {
    const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }], RULES, 12345, ctxFor());
    for (const f of s.fighters) Object.assign(f, { grounded: true, platform: 0, y: 0, action: "stand", intangible: 0 });
    return s;
  }

  // SmashWiki "Ledge trump" (https://www.ssbwiki.com/Ledge_trump): grabbing an
  // occupied ledge removes the fighter on it, who "cannot take any action for a
  // moment" — and loses the ledge's intangibility. The port order decides which of
  // the two the step loop reaches first, and the trump must not care.
  describe.each([1, 0] as const)("fighter %i hangs on the right ledge, the other drops onto it", (hanger) => {
    const trumper = 1 - hanger;

    /** `n` frames of it; `inputs(i)` gives frame i's keys. `at` is the frame the ledge is taken. */
    function trump(
      n = LEDGE_TRUMPED_FRAMES + 2,
      inputs: (i: number) => readonly InputFrame[] = () => [0, 0],
    ): { frames: Frame[]; at: number } {
      const s = standing();
      hang(s.fighters[hanger]);
      dropOnto(s.fighters[trumper]);
      const frames = play(s, n, inputs);
      const at = frames.findIndex((f) => f.state.fighters[trumper].ledge !== null);
      expect(at, "the ledge should be taken").toBeGreaterThanOrEqual(0);
      return { frames, at };
    }

    it("takes the ledge from the fighter on it, who drops off without intangibility", () => {
      const { frames, at } = trump();
      const after = frames[at].state.fighters;
      expect(after[trumper].ledge).toEqual({ platform: 0, side: 1 });
      expect(after[hanger]).toMatchObject({ ledge: null, action: "ledgeTrumped", actionFrame: 0, intangible: 0 });
    });

    it("gives control back after the trump's lag", () => {
      expect(trump().frames.at(-1)!.state.fighters[hanger].action).toBe("fall");
    });

    // "No frame count is published" (UNVERIFIED): exactly `LEDGE_TRUMPED_FRAMES` frames, the one it
    // starts on included, and then a fall.
    it("lasts exactly LEDGE_TRUMPED_FRAMES frames", () => {
      const { frames, at } = trump();
      const lag = frames.filter((f) => f.state.fighters[hanger].action === "ledgeTrumped");
      expect(lag).toHaveLength(LEDGE_TRUMPED_FRAMES);
      expect(frames[at + LEDGE_TRUMPED_FRAMES - 1].state.fighters[hanger].action).toBe("ledgeTrumped");
      expect(frames[at + LEDGE_TRUMPED_FRAMES].state.fighters[hanger].action).toBe("fall");
    });

    it("cannot take the ledge back while it cannot act, and the fighter who took it keeps it", () => {
      const { frames, at } = trump();
      for (const f of frames.slice(at, at + LEDGE_TRUMPED_FRAMES)) {
        expect(f.state.fighters[hanger].ledge, `frame ${f.state.frame}`).toBeNull();
        expect(f.state.fighters[trumper].ledge).toEqual({ platform: 0, side: 1 });
      }
    });

    // The final review's Minor 2: the lockout ran out on the lag's last frame (`actionFrame`
    // 30, one it "cannot take any action" in), a frame before the fighter could act. Asked at
    // the ledge, as below: refused on that frame, and free on the next, the first it acts on.
    it("is kept off the ledge on the lag's last frame too, and not after it", () => {
      const { frames, at } = trump(LEDGE_TRUMPED_FRAMES + 3);
      const atLedge = (i: number): FighterState => ({ ...frames[i].state.fighters[hanger], x: fx(84), y: fx(-2), vy: -fx(1), grounded: false });
      const last = at + LEDGE_TRUMPED_FRAMES;
      expect(frames[last].state.fighters[hanger].actionFrame).toBe(0);
      expect(frames[last - 1].state.fighters[hanger]).toMatchObject({ action: "ledgeTrumped", actionFrame: LEDGE_TRUMPED_FRAMES - 1 });
      expect(findLedgeGrab(atLedge(last), STAGE, frames[last].state.frame, ATTRS.width)).toBeNull();
      expect(findLedgeGrab(atLedge(last + 1), STAGE, frames[last + 1].state.frame, ATTRS.width)).not.toBeNull();
    });

    // The fall takes the fighter out of the grab box within a dozen frames, so a lockout
    // that ran short would not show above: ask `findLedgeGrab` at the ledge instead.
    it("is kept off every ledge for the whole lag, wherever it is", () => {
      const { frames, at } = trump();
      for (const f of frames.slice(at, at + LEDGE_TRUMPED_FRAMES)) {
        const h: FighterState = { ...f.state.fighters[hanger], x: fx(84), y: fx(-2), vy: -fx(1), grounded: false };
        expect(h.action).toBe("ledgeTrumped");
        expect(findLedgeGrab(h, STAGE, f.state.frame, ATTRS.width), `frame ${f.state.frame}`).toBeNull();
      }
    });

    it("cannot act: no key does anything, and the stick does not steer the fall", () => {
      const quiet = trump();
      const everyKey = Btn.Left | Btn.Attack | Btn.Special | Btn.Shield | Btn.Jump | Btn.Grab;
      // Pressed afresh on every other frame, so each is a press, not a hold, and only AFTER the
      // trump: a press before it would start a ledge option, which is not trumped.
      const key = (i: number): InputFrame => (i > quiet.at && i % 2 === 0 ? everyKey : 0);
      const mashing = trump(LEDGE_TRUMPED_FRAMES + 2, (i) => (hanger === 0 ? [key(i), 0] : [0, key(i)]));
      expect(mashing.at).toBe(quiet.at);
      for (let i = quiet.at; i < quiet.at + LEDGE_TRUMPED_FRAMES; i++) {
        const h = mashing.frames[i].state.fighters[hanger];
        // No action starts, and the lag runs its length untouched.
        expect(h, `frame ${i}`).toMatchObject({ action: "ledgeTrumped", actionFrame: i - quiet.at, ledge: null });
        expect(h.x).toBe(quiet.frames[i].state.fighters[hanger].x);
      }
      expect(mashing.frames[quiet.at + LEDGE_TRUMPED_FRAMES].state.fighters[hanger].action).toBe("fall");
    });

    // The trumped fighter stands on the ledge point while it hangs, so it is set
    // outboard by its body's reach (UNVERIFIED placement until Plan 4's ECB) and
    // then falls.
    it("is set clear of the stage and falls", () => {
      const { frames, at } = trump();
      const h = frames[at].state.fighters[hanger];
      expect(h.x).toBe(HANG_X + ATTRS.width + ONE);
      expect(h.y).toBe(0);
      expect(h.vx).toBe(0);
      expect(h.grounded).toBe(false);
      const ys = frames.slice(at, at + LEDGE_TRUMPED_FRAMES).map((f) => f.state.fighters[hanger].y);
      for (let i = 1; i < ys.length; i++) expect(ys[i], `frame ${at + i}`).toBeLessThan(ys[i - 1]);
      // Outboard of the stage the whole way down: it neither lands nor is pushed.
      expect(frames[at + LEDGE_TRUMPED_FRAMES - 1].state.fighters[hanger].x).toBeGreaterThan(HANG_X);
    });
  });

  // SmashWiki "Ledge trump" (https://www.ssbwiki.com/Ledge_trump): "To avoid getting ledge trumped,
  // one can simply buffer an attack, a jump, or a roll from the ledge the moment it is grabbed".
  // UNVERIFIED: that this means a fighter in an option cannot be trumped at all, and that its
  // ledge is then closed to the newcomer for the whole option (`findLedgeGrab`).
  describe.each([1, 0] as const)("fighter %i begins a ledge option as the other drops onto its ledge", (hanger) => {
    const taker = 1 - hanger;
    const OPTIONS = [
      ["jump", Btn.Jump, "ledgeJump", LEDGE_JUMP_FRAMES],
      ["attack", Btn.Attack, "ledgeAttack", LEDGE_ATTACK_FRAMES],
      ["roll", Btn.Shield, "ledgeRoll", LEDGE_ROLL_FRAMES],
      ["getup", Btn.Up, "ledgeGetUp", LEDGE_GETUP_FRAMES],
    ] as const;

    it.each(OPTIONS)("%s: is not trumped, and the ledge stays shut to the newcomer until the option has left it", (_name, key, action, length) => {
      const s = standing();
      // Past `LEDGE_HANG_MIN`, so the press on the first frame starts the option in phase 3, before
      // the newcomer's grab in phase 5.
      hang(s.fighters[hanger]);
      dropOnto(s.fighters[taker]);
      const frames = play(s, length + 10, (i) => (hanger === 0 ? [i === 0 ? key : 0, 0] : [0, i === 0 ? key : 0]));

      // The option holds the ledge for exactly its length, with the intangibility it had.
      const end = frames.findIndex((f) => f.state.fighters[hanger].ledge === null);
      expect(end).toBe(length);
      expect(frames[0].state.fighters[hanger]).toMatchObject({ action, ledge: { platform: 0, side: 1 }, intangible: 49 });
      for (const f of frames.slice(0, end)) {
        expect(f.state.fighters[hanger], `frame ${f.state.frame}`).toMatchObject({ action, ledge: { platform: 0, side: 1 } });
        // The newcomer is neither hanging on it nor trumped: it falls past.
        expect(f.state.fighters[taker], `frame ${f.state.frame}`).toMatchObject({ ledge: null, action: "fall" });
      }

      // Ask `findLedgeGrab` at the ledge on every frame (the fall would take the newcomer out of
      // reach): shut while the option holds it, open the frame the option lets go.
      for (const [i, f] of frames.slice(0, end + 2).entries()) {
        const n: FighterState = { ...f.state.fighters[taker], x: fx(84), y: fx(-2), vy: -fx(1), grounded: false, facing: -1 };
        const grab = findLedgeGrab(n, STAGE, f.state.frame, ATTRS.width, f.state.fighters);
        if (i < end) expect(grab, `frame ${f.state.frame}`).toBeNull();
        else expect(grab, `frame ${f.state.frame}`).toEqual({ platform: 0, side: 1 });
      }
    });
  });

  // Mirrored: the left ledge is side -1, so a sign error in the placement would show here only.
  it("trumps on the left ledge too, and sets the fighter outboard of it", () => {
    const s = standing();
    hang(s.fighters[1], -1);
    dropOnto(s.fighters[0], 0, -1);
    const frames = play(s, LEDGE_TRUMPED_FRAMES + 2, () => [0, 0]);
    const at = frames.findIndex((f) => f.state.fighters[0].ledge !== null);
    expect(at, "the ledge should be taken").toBeGreaterThanOrEqual(0);
    const [a, h] = frames[at].state.fighters;
    expect(a.ledge).toEqual({ platform: 0, side: -1 });
    expect(h).toMatchObject({ ledge: null, action: "ledgeTrumped", intangible: 0, x: -(HANG_X + ATTRS.width + ONE), y: 0 });
    const lag = frames.filter((f) => f.state.fighters[1].action === "ledgeTrumped");
    expect(lag).toHaveLength(LEDGE_TRUMPED_FRAMES);
    for (const f of lag) expect(f.state.fighters[1].x, `frame ${f.state.frame}`).toBeLessThan(-HANG_X);
    expect(frames.at(-1)!.state.fighters[1].action).toBe("fall");
  });

  // UNVERIFIED: nothing published says how the game breaks a tie. Phase 5 handles the fighters in
  // port order, so the later port takes the ledge from the earlier one, which hung for no frames.
  describe("two fighters taking one free ledge on the same frame", () => {
    it("leaves it to the later port, which trumps the earlier", () => {
      const s = standing();
      dropOnto(s.fighters[0]);
      dropOnto(s.fighters[1]);
      const frames = play(s, LEDGE_TRUMPED_FRAMES + 2, () => [0, 0]);
      const [loser, winner] = frames[0].state.fighters;
      expect(winner).toMatchObject({ ledge: { platform: 0, side: 1 }, action: "ledgeHang" });
      expect(loser).toMatchObject({ ledge: null, action: "ledgeTrumped", intangible: 0 });
      // The loser did grab the ledge before it lost it, and a trump never touches the regrab count
      // (a fighter trumped after hanging for 40 frames keeps it too): one rule, no special case.
      expect(loser.ledgeRegrabs).toBe(1);
      expect(winner.ledgeRegrabs).toBe(1);
      for (const f of frames.slice(0, LEDGE_TRUMPED_FRAMES)) {
        expect(f.state.fighters[1].ledge).toEqual({ platform: 0, side: 1 });
        expect(f.state.fighters[0].action).toBe("ledgeTrumped");
      }
    });

    it("chains through three: the highest port keeps it", () => {
      const s = three();
      for (const f of s.fighters) dropOnto(f);
      const [a, b, c] = play(s, 1, () => [0, 0, 0])[0].state.fighters;
      expect(c).toMatchObject({ ledge: { platform: 0, side: 1 }, action: "ledgeHang" });
      expect([a.action, a.ledge, b.action, b.ledge]).toEqual(["ledgeTrumped", null, "ledgeTrumped", null]);
    });
  });

  it("takes the ledge from the fighter on that side only", () => {
    const s = three();
    dropOnto(s.fighters[0]);
    hang(s.fighters[1]);
    hang(s.fighters[2], -1, 100);
    const frames = play(s, LEDGE_TRUMPED_FRAMES + 2, () => [0, 0, 0]);
    expect(frames.at(-1)!.state.fighters[1].action).toBe("fall");
    // The one on the far ledge is where it was, intangibility counting down as usual.
    for (const f of frames) {
      expect(f.state.fighters[2], `frame ${f.state.frame}`).toMatchObject({
        action: "ledgeHang",
        ledge: { platform: 0, side: -1 },
        intangible: 100 - f.state.frame,
      });
    }
  });

  describe("and a grab (Task 14), on the one frame", () => {
    /**
     * Fighter 0 stands on the stage and has its grab out on the ledge (the grab's
     * first live frame is the first step); fighter 1 hangs there; fighter 2 drops
     * onto the ledge from `above` units over it: none, and it is there on that
     * frame; enough to be out of the grab's reach, and it arrives later.
     */
    function grabAndTrump(above: number): Frame[] {
      const s = three();
      const [a, h, t] = s.fighters;
      Object.assign(a, { x: fx(72), facing: 1, action: "grab", move: "grab", actionFrame: 3 });
      // Past its ledge intangibility, which a grab cannot touch: it is the trump
      // that ends it, in the first case.
      hang(h, 1, above === 0 ? 50 : 0);
      dropOnto(t, above);
      return play(s, 40, () => [0, 0, 0]);
    }

    // Phase 5 (the trump) runs before phase 6 (hits), so the hanger is trumped
    // off the ledge and then, if the grab still reaches it, grabbed: the grab
    // wins, and a held fighter is placed at its captor.
    it("trumps first and then grabs: the fighter ends up held, and the ledge is the trumper's", () => {
      const frames = grabAndTrump(0);
      const first = frames[0].state.fighters;
      expect(first[2].ledge).toEqual({ platform: 0, side: 1 });
      expect(first[1]).toMatchObject({ action: "grabbed", grabbedBy: 0, ledge: null });
      expect(frames[1].state.fighters[1]).toMatchObject({ action: "grabbed", ledge: null, grounded: true, y: 0 });
    });

    // A grabbed hanger has already left the ledge, so a fighter taking it later
    // trumps nobody.
    it("grabs first: a fighter taking the ledge a frame later finds it free", () => {
      const frames = grabAndTrump(16);
      expect(frames[0].state.fighters[1]).toMatchObject({ action: "grabbed", ledge: null });
      expect(frames[0].state.fighters[2].ledge).toBeNull();
      const at = frames.findIndex((f) => f.state.fighters[2].ledge !== null);
      expect(at).toBeGreaterThan(0);
      for (const f of frames.slice(at)) {
        expect(f.state.fighters[1].action).toBe("grabbed");
        expect(f.state.fighters[2].action).toBe("ledgeHang");
      }
    });
  });
});

/* ------------------------------------ Task 16: what a script hitbox says -- */

describe("script hitboxes carry the game's own flags (Plan 3, Task 16)", () => {
  /** The tester with its jab replaced by `commands` (a `game_attack11` script). */
  function scripted(commands: readonly AcmdCommand[]): SimContext {
    const def: FighterDef = { ...BASE_DEF, scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands } } };
    return ctxFor(def);
  }
  const box = (over: Partial<Parameters<typeof ATTACK>[0]> = {}) =>
    ATTACK({ id: 0, bone: "top", damage: 10, angle: 45, kbg: 100, bkb: 40, size: 5, x: 0, y: 6, z: 8, ...over });
  function hits(ctx: SimContext, prepare: (s: GameState) => void = () => {}, n = 12): StepEvents["hits"] {
    const s = standing(ctx);
    prepare(s);
    return play(s, n, JAB, ctx).flatMap((f) => f.events.hits);
  }
  /** A box that does no knockback, so its victim stays where it is, inside it. */
  const still = (over: Partial<Parameters<typeof ATTACK>[0]> = {}) => box({ bkb: 0, kbg: 0, ...over });
  const airborne = (s: GameState): void => {
    Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(3), action: "fall" });
  };

  // SmashWiki "Knockback", https://www.ssbwiki.com/Knockback: in the formula, "w ...
  // is set to 100 if the attack is weight independent"; rubendal SSBU-Calculator passes
  // `set_weight ? 100 : target.Attributes.Weight` to `VSKB` (js/worker/multiworker.js#L206,
  // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/worker/multiworker.js#L206).
  it("weighs every victim as 100 for a set-weight hitbox", () => {
    const heavy = (s: GameState) => {
      s.fighters[1].damage = fx(60);
    };
    const set = hits(scripted([frame(4), box({ setWeight: true }), frame(7), clearAll()]), heavy)[0];
    const plain = hits(scripted([frame(4), box(), frame(7), clearAll()]), heavy)[0];
    // The tester weighs 98: set weight treats it as 100, so a little less knockback.
    expect(set.knockback).toBe(
      computeKnockback({
        percent: fx(60) + set.damage,
        damage: mul(fx(10), computeStaleness([], "jab1").knockback),
        weight: 100,
        baseKnockback: fx(40),
        knockbackGrowth: fx(100),
      }),
    );
    expect(set.knockback).toBeLessThan(plain.knockback);
  });

  // `COLLISION_SITUATION_MASK_G` / `_A` (smash-script `ATTACK`'s `ground_air`).
  it("misses a grounded victim with an air-only hitbox, and an airborne one with a ground-only hitbox", () => {
    const air = scripted([frame(4), box({ situation: "COLLISION_SITUATION_MASK_A" }), frame(7), clearAll()]);
    expect(hits(air)).toEqual([]);
    expect(hits(air, airborne)).toHaveLength(1);
    const ground = scripted([frame(4), box({ situation: "COLLISION_SITUATION_MASK_G" }), frame(7), clearAll()]);
    expect(hits(ground)).toHaveLength(1);
    expect(hits(ground, airborne)).toEqual([]);
  });

  it("hits grounded and airborne victims alike when the mask is GA, and the legacy default is GA", () => {
    const both = scripted([frame(4), box({ situation: "COLLISION_SITUATION_MASK_GA" }), frame(7), clearAll()]);
    expect(hits(both)).toHaveLength(1);
    expect(hits(both, airborne)).toHaveLength(1);
    expect(hits(ctxFor())).toHaveLength(1);
    expect(hits(ctxFor(), airborne)).toHaveLength(1);
  });

  it("launches away from the attacker with ATTACK_LR_CHECK_POS, even from behind", () => {
    const behind = (s: GameState) => {
      s.fighters[1].x = fx(-8);
    };
    const pos = hits(scripted([frame(4), box({ z: -8, facing: "ATTACK_LR_CHECK_POS" }), frame(7), clearAll()]), behind)[0];
    // World angle: a 45° launch to the left is 135°.
    expect(pos.angle).toBe(fx(135));
    const ahead = hits(scripted([frame(4), box({ z: -8 }), frame(7), clearAll()]), behind)[0];
    expect(ahead.angle).toBe(fx(45));
  });

  it("launches backwards with ATTACK_LR_CHECK_B", () => {
    const back = hits(scripted([frame(4), box({ facing: "ATTACK_LR_CHECK_B" }), frame(7), clearAll()]))[0];
    expect(back.angle).toBe(fx(135));
  });

  // UNVERIFIED (`launchSourceFacing`): origin to origin, and a victim level with the
  // attacker launches the way the attacker faces (Task 16 review, Minor 9).
  it("launches a victim level with the attacker the way the attacker faces, under ATTACK_LR_CHECK_POS", () => {
    const level = (facing: number) => (s: GameState) => {
      s.fighters[0].facing = facing;
      s.fighters[1].x = s.fighters[0].x;
    };
    const pos = scripted([frame(4), box({ z: 0, facing: "ATTACK_LR_CHECK_POS" }), frame(7), clearAll()]);
    expect(hits(pos, level(1))[0].angle).toBe(fx(45));
    expect(hits(pos, level(-1))[0].angle).toBe(fx(135));
  });

  it("re-arms a hitbox the script clears with clear_all, as a multi-hit does", () => {
    // Weightless hits (no knockback), so the victim stays inside the box.
    const pinned = (): void => {};
    const twice = hits(scripted([frame(4), still(), frame(5), clearAll(), frame(9), still(), frame(10), clearAll()]), pinned, 40);
    expect(twice).toHaveLength(2);
    // One swing stales once, and its second hit is no staler than its first.
    expect(twice[1].damage).toBe(twice[0].damage);
    // The control: the first box is live on frame 4 and lands, then a clear *by id*
    // on frame 5, which does not re-arm, so the second box finds the victim already hit.
    const once = hits(scripted([frame(4), still(), frame(5), { op: "clear", id: 0 }, frame(9), still(), frame(10), clearAll()]), pinned, 40);
    expect(once).toHaveLength(1);
  });

  // SmashWiki "Stale Moves": from Brawl on, later hitboxes of a multi-hit move are
  // not staled by its earlier ones while the move is in progress.
  it("queues a multi-hit swing once, however many times it re-arms", () => {
    const ctx = scripted([frame(4), still(), frame(5), clearAll(), frame(9), still(), frame(10), clearAll()]);
    const after = play(standing(ctx), 40, JAB, ctx).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toEqual(["jab1"]);
    expect(after.combat.staleShield).toEqual([false]);
    expect(after.combat.swingQueued).toBe(true);
  });

  it("queues a swing once for a second victim too, and queues the next swing again", () => {
    const ctx = scripted([frame(4), still(), frame(7), clearAll()]);
    const s = standing(ctx);
    // A third fighter in the box as well: one swing, two victims, one queue entry.
    const three = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
    for (const [i, f] of three.fighters.entries()) {
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0, x: s.fighters[Math.min(i, 1)].x, facing: s.fighters[Math.min(i, 1)].facing });
    }
    const frames = play(three, 12, (i) => [i === 0 ? Btn.Attack : 0, 0, 0], ctx);
    const swing = frames.flatMap((f) => f.events.hits);
    expect(swing.map((h) => h.victim).sort()).toEqual([1, 2]);
    expect(swing[1].damage).toBe(swing[0].damage);
    const a = frames.at(-1)!.state.fighters[0];
    expect(a.staleQueue).toEqual(["jab1"]);
    // The next press is a new swing: it queues again, and is staled by the first.
    const next = play(frames.at(-1)!.state, 40, (i) => [i === 20 ? Btn.Attack : 0, 0, 0], ctx);
    const second = next.flatMap((f) => f.events.hits);
    expect(next.at(-1)!.state.fighters[0].staleQueue).toEqual(["jab1", "jab1"]);
    expect(second[0].damage).toBeLessThan(swing[0].damage);
  });

  // Glancing blows (Task 13) are no hit: a re-armed box that only grazes does not
  // spend the swing or join the queue, and the same swing lands once the box is deeper.
  describe("with a re-armed box that grazes", () => {
    const ctx = scripted([frame(4), still(), frame(5), clearAll(), frame(6), still(), frame(7), clearAll()]);
    /** Fighter 1 placed so the jab's box (reach 8 + 5, and the body's 4) overlaps its body by `overlap`. */
    const jabWithOverlap = (overlap: number): Frame[] => {
      const s = standing(ctx);
      s.fighters[1].x = fx(8 + 5 + 4 - overlap);
      return play(s, 40, JAB, ctx);
    };

    it("is no hit, spends nothing and queues nothing", () => {
      const grazing = jabWithOverlap(0.05);
      expect(grazing.flatMap((f) => f.events.hits)).toEqual([]);
      const a = grazing.at(-1)!.state.fighters[0];
      expect(a.hitThisMove).toEqual([]);
      expect(a.staleQueue).toEqual([]);
      expect(a.combat.swingQueued).toBe(false);
    });

    it("hits twice, and queues once, when the box is deeper", () => {
      const deep = jabWithOverlap(0.2);
      expect(deep.flatMap((f) => f.events.hits)).toHaveLength(2);
      expect(deep.at(-1)!.state.fighters[0].staleQueue).toEqual(["jab1"]);
    });
  });

  // Knockback stacking keys on the source (Task 8): every hit of one multi-hit move
  // is the same source, the attacker's port.
  it("keeps every hit of a re-armed move on one knockback source", () => {
    const ctx = scripted([frame(4), still(), frame(5), clearAll(), frame(9), still(), frame(10), clearAll()]);
    const frames = play(standing(ctx), 40, JAB, ctx);
    expect(frames.flatMap((f) => f.events.hits)).toHaveLength(2);
    expect(frames.at(-1)!.state.fighters[1].combat.launchSource).toBe(0);
  });

  describe("with a catch-only box (a pummel, a throw: Task 14)", () => {
    /** Fighter 0 already holding fighter 1, 100 frames from letting go. */
    function holding(ctx: SimContext, prepare: (s: GameState) => void = () => {}): GameState {
      const s = standing(ctx);
      const [a, v] = s.fighters;
      Object.assign(a, { action: "grabHold", grabbing: 1 });
      Object.assign(v, { action: "grabbed", actionFrame: 30, grabbedBy: 0, grabTimer: 100 });
      prepare(s);
      return s;
    }
    /** The tester with `slot` scripted by `commands`; its legacy move is empty, so only the script's boxes exist. */
    function slotScripted(slot: "fthrow" | "bthrow" | "pummel", commands: readonly AcmdCommand[]): SimContext {
      const motion = { fthrow: "throw_f", bthrow: "throw_b", pummel: "catch_attack" }[slot];
      return ctxFor({
        ...BASE_DEF,
        moves: { ...BASE_DEF.moves, [slot]: move(slot, { totalFrames: 20, hitboxes: [] }) },
        scripts: { [slot]: { name: `game_${motion.replace(/_/g, "")}`, motion, commands } },
      });
    }
    /** A throw box with 60 base knockback; where it sits does not matter, a catch-only box has no geometry. */
    const throwBox = (over: Partial<Parameters<typeof ATTACK>[0]> = {}) => box({ angle: 45, damage: 6, bkb: 60, kbg: 70, z: 40, ...over });
    /** Fighter 0 (facing right) presses `button` on frame 2; the throw hits, if it does, and this is the launch's horizontal speed once the freeze ends. */
    function thrown(ctx: SimContext, button: Btn, prepare?: (s: GameState) => void): { hits: number; vx: number } {
      const frames = play(holding(ctx, prepare), 40, (i) => [i === 2 ? button : 0, 0], ctx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      if (hit < 0) return { hits: 0, vx: 0 };
      const out = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
      return { hits: frames.flatMap((f) => f.events.hits).length, vx: frames[out].state.fighters[1].vx };
    }
    const throwWith = (slot: "fthrow" | "bthrow", over: Partial<Parameters<typeof ATTACK>[0]> = {}) =>
      slotScripted(slot, [frame(4), throwBox(over), frame(5), clearAll()]);

    it("leaves a throw's launch direction alone unless its script says otherwise", () => {
      expect(thrown(throwWith("fthrow"), Btn.Right)).toMatchObject({ hits: 1, vx: expect.toSatisfy((v: number) => v > 0) });
      // The legacy stand-in for REVERSE_LR still turns a back throw round.
      expect(thrown(throwWith("bthrow"), Btn.Left)).toMatchObject({ hits: 1, vx: expect.toSatisfy((v: number) => v < 0) });
    });

    it("launches a throw backwards when its script says ATTACK_LR_CHECK_B, and a back throw only once", () => {
      const back = (slot: "fthrow" | "bthrow", button: Btn) =>
        thrown(throwWith(slot, { facing: "ATTACK_LR_CHECK_B" }), button);
      expect(back("fthrow", Btn.Right)).toMatchObject({ hits: 1, vx: expect.toSatisfy((v: number) => v < 0) });
      // Not turned by the stand-in as well: a second turn would send it forwards again.
      expect(back("bthrow", Btn.Left)).toMatchObject({ hits: 1, vx: expect.toSatisfy((v: number) => v < 0) });
    });

    // Plan 3, Task 17: a capsule changes nothing here. A throw box is still not
    // geometry-tested against the fighter held, whatever its two ends say.
    it("lands a capsule throw box on the fighter held, wherever its ends are", () => {
      expect(thrown(throwWith("fthrow", { z: 40, z2: 60 }), Btn.Right).hits).toBe(1);
      expect(thrown(throwWith("fthrow", { z: -30, z2: -45 }), Btn.Right).hits).toBe(1);
    });

    // A held victim is grounded only over its captor's platform (`holdAtCaptor`); the
    // captor at the lip, facing out, holds it in the air.
    describe("and the situation mask", () => {
      const atLip = (s: GameState) => {
        s.fighters[0].x = fx(78);
      };
      const mask = (situation: "COLLISION_SITUATION_MASK_G" | "COLLISION_SITUATION_MASK_A") => throwWith("fthrow", { situation });

      it("lands a ground-only throw on a victim held over the stage, not past its edge", () => {
        expect(thrown(mask("COLLISION_SITUATION_MASK_G"), Btn.Right).hits).toBe(1);
        expect(thrown(mask("COLLISION_SITUATION_MASK_G"), Btn.Right, atLip).hits).toBe(0);
      });

      it("lands an air-only throw on a victim held past the stage's edge, not over it", () => {
        expect(thrown(mask("COLLISION_SITUATION_MASK_A"), Btn.Right).hits).toBe(0);
        expect(thrown(mask("COLLISION_SITUATION_MASK_A"), Btn.Right, atLip).hits).toBe(1);
      });
    });

    describe("and a pummel that re-arms", () => {
      // Two 2% hits a press, the second a `clear_all` re-arm of the first.
      const hit = (over: Partial<Parameters<typeof ATTACK>[0]> = {}) => box({ damage: 2, angle: 361, bkb: 0, kbg: 0, z: 40, ...over });
      const ctx = slotScripted("pummel", [frame(1), hit(), frame(2), clearAll(), frame(3), hit(), frame(4), clearAll()]);

      it("stales once a press, not once a hit; the next press is staled by the first", () => {
        const frames = play(holding(ctx), 80, (i) => [i === 2 || i === 40 ? Btn.Attack : 0, 0], ctx);
        const hits = frames.flatMap((f) => f.events.hits);
        expect(hits).toHaveLength(4);
        expect(hits[1].damage).toBe(hits[0].damage);
        expect(hits[3].damage).toBe(hits[2].damage);
        expect(hits[2].damage).toBeLessThan(hits[0].damage);
        expect(frames.at(-1)!.state.fighters[0].staleQueue).toEqual(["pummel", "pummel"]);
        // The held fighter is still held: a pummel is damage and a freeze, nothing more.
        expect(frames.at(-1)!.state.fighters[1]).toMatchObject({ action: "grabbed", grabbedBy: 0 });
      });
    });
  });

  describe("a downward angle (rubendal SSBU-Calculator `js/knockback.js`: `spike = angle >= 230 && angle <= 310`)", () => {
    /**
     * The jab's contact, then fighter 1 from the frame its launch fires: the hit's
     * knockback and the hitstun it set, and the victim on each frame from the release.
     */
    function spiked(
      commands: readonly AcmdCommand[],
      prepare: (s: GameState) => void = () => {},
    ): { knockback: number; hitstun: number; after: FighterState[] } {
      const ctx = scripted(commands);
      const s = standing(ctx);
      prepare(s);
      const frames = play(s, 40, JAB, ctx);
      const hit = frames.findIndex((f) => f.events.hits.length > 0);
      const fired = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
      return {
        knockback: frames[hit].events.hits[0].knockback,
        hitstun: frames[hit].state.fighters[1].hitstun,
        after: frames.slice(fired).map((f) => f.state.fighters[1]),
      };
    }
    /** Each frame's hitstun has gone down by exactly one: no bounce cut it, over `n` frames. */
    const countsDownByOne = (v: FighterState[], n: number): boolean =>
      v.slice(1, n + 1).every((f, i) => f.hitstun === v[i].hitstun - 1);

    // A grounded meteor that tumbles is one floor bounce, at release (Task 16b fix round
    // 1): SmashWiki "Meteor smash" (https://www.ssbwiki.com/Meteor_smash, revision
    // 2047089), grounded targets "immediately bounce off the ground they're standing on
    // (as long as they deal enough knockback to put the opponent into tumble)", and "the
    // amount of hitstun delivered by a meteor smash is not affected by the knockback
    // reduction". The bounce keeps Task 12's floor 0.9 (`BOUNCE_FLOOR_LAUNCH_RATIO`).
    it("bounces a grounded victim off the floor at release when it tumbles: 0.9 of the launch, the hit's full hitstun, once", () => {
      const spike = spiked([frame(4), box({ angle: 270, bkb: 100, kbg: 0 }), frame(7), clearAll()]);
      expect(spike.knockback).toBe(fx(100));
      expect(spike.hitstun).toBe(effectiveHitstun(fx(100), true));
      const [fired] = spike.after;
      expect(fired.launchSpeed).toBe(byRatio(mul(fx(100), LAUNCH_SPEED_RATIO), BOUNCE_FLOOR_LAUNCH_RATIO));
      expect(fired.kinetic.damageY).toBeGreaterThan(0);
      expect(fired.grounded).toBe(false);
      // On the release frame itself the hitstun is still the hit's: the bounce that
      // fires there takes nothing off it. (`countsDownByOne` below starts from this
      // frame, so a cut made at release would not show in it.)
      expect(fired.hitstun, "at release").toBe(spike.hitstun);
      // Up and away for the next 12 frames: no second bounce, so no 0.8 cut of the hitstun.
      expect(spike.after.slice(1, 13).every((f) => !f.grounded && f.y > 0)).toBe(true);
      expect(countsDownByOne(spike.after, 12)).toBe(true);
    });

    // The bounce turns the whole launch about, both components at 0.9, not only the
    // vertical one: a straight-down 270° has no horizontal part to show it. At 250°
    // (inside the 230-310 spike range; SmashWiki "Meteor smash", rubendal `spike`) the
    // launch of 100 knockback, 3.0 a frame, goes 3.0 × cos 250° = -1.026 across and
    // -2.819 down; bounced, -0.923 across and +2.537 up, at 2.7.
    it("scales the horizontal part of a launch that is not straight down by 0.9 as well", () => {
      const spike = spiked([frame(4), box({ angle: 250, bkb: 100, kbg: 0 }), frame(7), clearAll()]);
      expect(spike.knockback).toBe(fx(100));
      const [fired] = spike.after;
      expect(fired.grounded).toBe(false);
      expect(fired.kinetic.damageX / ONE).toBeCloseTo(3 * toFloat(cosDeg(fx(250))) * 0.9, 2);
      expect(fired.kinetic.damageY / ONE).toBeCloseTo(-3 * toFloat(sinDeg(fx(250))) * 0.9, 2);
      expect(fired.launchSpeed / ONE).toBeCloseTo(2.7, 2);
      expect(fired.hitstun, "at release").toBe(spike.hitstun);
    });

    // Set knockback bounces as well: the bounce is the launch meeting the floor, not
    // one of the modifiers Ultimate took off set knockback (SmashWiki "Knockback",
    // revision 2063895, Set knockback: launch rates, rage, crouch cancelling, smash charge).
    it("bounces a grounded set-knockback meteor up off the floor, rather than leaving it tumbling in place", () => {
      const spike = spiked([frame(4), box({ angle: 270, fkb: 100, bkb: 0, kbg: 100 }), frame(7), clearAll()]);
      expect(spike.hitstun).toBe(computeHitstun(spike.knockback));
      const [fired] = spike.after;
      expect(fired.launchSpeed).toBe(byRatio(mul(spike.knockback, LAUNCH_SPEED_RATIO), BOUNCE_FLOOR_LAUNCH_RATIO));
      expect(fired.kinetic.damageY).toBeGreaterThan(0);
      expect(spike.after.slice(1, 13).every((f) => !f.grounded && f.y > 0)).toBe(true);
      expect(countsDownByOne(spike.after, 12)).toBe(true);
    });

    it("leaves a grounded victim of a meteor too weak to tumble on the ground: a flinch, not a bounce", () => {
      const spike = spiked([frame(4), box({ angle: 270, bkb: 40, kbg: 0 }), frame(7), clearAll()]);
      expect(spike.hitstun).toBe(computeHitstun(fx(40)));
      expect(spike.after[0].launchSpeed).toBe(mul(fx(40), LAUNCH_SPEED_RATIO));
      const reeling = spike.after.slice(0, spike.hitstun);
      expect(reeling.every((f) => f.grounded && f.y === 0 && f.action === "hitstun")).toBe(true);
    });

    it("sends an airborne victim down at the whole launch", () => {
      const airborne = (s: GameState) => {
        Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(3), action: "fall" });
      };
      const spike = spiked([frame(4), box({ angle: 270, bkb: 100, kbg: 0 }), frame(7), clearAll()], airborne);
      const [fired] = spike.after;
      expect(fired.launchSpeed).toBe(mul(fx(100), LAUNCH_SPEED_RATIO));
      expect(fired.kinetic.damageY).toBeLessThan(0);
    });

    /** `meteor` of the hitbox a script makes of `params` at game frame 1. */
    const meteorOf = (params: AttackParams): boolean | undefined => {
      const script = { name: "game_attack11", motion: "attack_11", commands: [frame(1), { op: "attack", params } as AcmdCommand] };
      return scriptHitboxes(runScript(script, 1), "tester", "attack_11", 1, LEGACY_BONE_TABLE)[0].meteor;
    };
    const scriptAt = (angle: number): AttackParams => (box({ angle }) as { params: AttackParams }).params;

    it("takes 230 and 310 inclusive, and nothing outside", () => {
      expect([229, 229.9, 311, 361].map((a) => meteorOf(scriptAt(a)))).toEqual([undefined, undefined, undefined, undefined]);
      expect([230, 270, 310].map((a) => meteorOf(scriptAt(a)))).toEqual([true, true, true]);
    });

    // The DSL can say it either way (Task 16 report, concern 2; Plan 3, Task 16b).
    it("is not a meteor when a hand-written script says `meteor: false`", () => {
      const plain = (box({ angle: 270, meteor: false }) as { params: AttackParams }).params;
      expect(plain.meteor).toBe(false);
      expect(meteorOf(plain)).toBeUndefined();
    });

    // A legacy move says outright, either way (`attackFromHitbox`), so the pipeline
    // never classifies its angle: a downward legacy hitbox that is not marked stays plain.
    it("is never applied to a legacy compilation, which states meteor either way", () => {
      const plain = attackFromHitbox(hitbox({ angle: fx(270) }));
      expect(plain.meteor).toBe(false);
      expect(meteorOf(plain)).toBeUndefined();
      const marked = attackFromHitbox(hitbox({ angle: fx(270), meteor: true }));
      expect(marked.meteor).toBe(true);
      expect(meteorOf(marked)).toBe(true);
    });
  });
});

/* -------------------- Task 16b: set knockback by weight; set weight's launch -- */

describe("set knockback is weight-based, and set weight launches as the game does (Plan 3, Task 16b)", () => {
  /** `def` with its jab replaced by `commands` (a `game_attack11` script). */
  function scripted(commands: readonly AcmdCommand[], def: FighterDef = BASE_DEF): SimContext {
    return ctxFor({ ...def, scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands } } });
  }
  const box = (over: Partial<Parameters<typeof ATTACK>[0]> = {}) =>
    ATTACK({ id: 0, bone: "top", damage: 10, angle: 45, kbg: 100, bkb: 0, fkb: 60, size: 5, x: 0, y: 6, z: 8, ...over });
  function firstHit(ctx: SimContext, prepare: (s: GameState) => void = () => {}): StepEvents["hits"][number] {
    const s = standing(ctx);
    prepare(s);
    return play(s, 12, JAB, ctx).flatMap((f) => f.events.hits)[0];
  }

  // rubendal SSBU-Calculator `WeightBasedKB` (pinned in `knockback.test.ts`): fkb 60,
  // kbg 100 against the tester's 98 is 61.838, not a flat 60.
  it("launches a script's set-knockback box by the weight-based formula", () => {
    const hit = firstHit(scripted([frame(4), box(), frame(7), clearAll()]));
    expect(hit.knockback).toBe(
      computeKnockback({ percent: 0, damage: 0, weight: 98, baseKnockback: 0, knockbackGrowth: fx(100), fixedKnockback: fx(60) }),
    );
    expect(toFloat(hit.knockback)).toBeCloseTo(61.83838, 1);
  });

  // A legacy set-knockback box holds the script's `fkb` in `fixedKnockback`, its `bkb` in
  // `baseKnockback` and its `kbg` in `knockbackGrowth` (`fighters/index.ts`), which
  // `attackFromHitbox` compiles field for field.
  it("launches a legacy set-knockback box by the same formula", () => {
    const legacy = ctxFor({
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ baseKnockback: 0, fixedKnockback: fx(60) })] }) },
    });
    expect(firstHit(legacy).knockback).toBe(firstHit(scripted([frame(4), box(), frame(7), clearAll()])).knockback);
  });

  it("does not move with the victim's percent or the attacker's rage", () => {
    const ctx = scripted([frame(4), box(), frame(7), clearAll()]);
    const fresh = firstHit(ctx).knockback;
    expect(firstHit(ctx, (s) => {
      s.fighters[1].damage = fx(150);
      s.fighters[0].damage = fx(150);
    }).knockback).toBe(fresh);
  });

  // Pikachu's neutral air (`generated/pikachu.ts` `game_attackairn`): fkb 45 with bkb 15,
  // kbg 80, set weight. rubendal `WeightBasedKB(100, 15, 45, 80)` = 55.72.
  it("adds a set-knockback box's own bkb, and weighs the victim as 100 under set weight", () => {
    const hit = firstHit(scripted([frame(4), box({ fkb: 45, bkb: 15, kbg: 80, setWeight: true }), frame(7), clearAll()]));
    expect(toFloat(hit.knockback)).toBeCloseTo(55.72, 1);
  });

  describe("set weight's launch", () => {
    /**
     * A tester that falls by other numbers than set weight's: gravity 0.12 and
     * fall speed 2, so its balloon fall (`damage_fly_top`, from `paramsFromAttributes`)
     * is gravity 0.12 toward 1.8.
     */
    const floaty: FighterDef = { ...BASE_DEF, attributes: { ...ATTRS, gravity: fx(0.12), fallSpeed: fx(2) } };
    /**
     * Fighter 1 from the frame a straight-up set-knockback jab's launch fires, for 14
     * frames: 13 steps of gravity, short of any fall-speed cap (13 × 0.12 < 1.8).
     */
    function launched(setWeight: boolean): FighterState[] {
      const ctx = scripted([frame(4), box({ angle: 90, fkb: 100, setWeight }), frame(7), clearAll()], floaty);
      const frames = play(standing(ctx), 40, JAB, ctx);
      const fired = frames.findIndex((f) => f.state.fighters[1].launchSpeed > 0);
      return frames.slice(fired, fired + 14).map((f) => f.state.fighters[1]);
    }
    /** Each frame's change in the GRAVITY energy, from the frame after the launch fires. */
    const gravitySteps = (v: FighterState[]): number[] => v.slice(1).map((f, i) => f.kinetic.gravityY - v[i].kinetic.gravityY);

    // SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback, revision 2063895),
    // Weight-independent knockback: in Ultimate, a set-weight hit gives "a fall speed of
    // 1.5 and gravity of 0.087 for the first 10 frames of the launch, before reverting
    // back to a fighter's regular fall speed and gravity. Notably, this effect overrides
    // the homogenised fall speed and gravity used by attacks which have an angle between
    // 70˚ and 110˚."
    it("falls by gravity 0.087 for the first 10 frames, then by the fighter's own, and is never balloon fall", () => {
      const v = launched(true);
      expect(v[0].kinetic.gravityY).toBe(0);
      expect(v.every((f) => f.hitstun > 0 && !f.grounded)).toBe(true);
      expect(gravitySteps(v)).toEqual([
        ...Array<number>(SET_WEIGHT_LAUNCH_FRAMES).fill(-SET_WEIGHT_GRAVITY),
        ...Array<number>(13 - SET_WEIGHT_LAUNCH_FRAMES).fill(-fx(0.12)),
      ]);
      expect(v.map((f) => f.balloon)).toEqual(Array<boolean>(14).fill(false));
    });

    it("leaves a launch without set weight to the balloon fall at the same angle", () => {
      const v = launched(false);
      expect(gravitySteps(v)).toEqual(Array<number>(13).fill(-fx(0.12)));
      expect(v.map((f) => f.balloon)).toEqual(Array<boolean>(14).fill(true));
    });

    it("is pinned to SmashWiki's figures", () => {
      expect([SET_WEIGHT_GRAVITY, SET_WEIGHT_FALL_SPEED, SET_WEIGHT_LAUNCH_FRAMES]).toEqual([fx(0.087), fx(1.5), 10]);
    });
  });

  // `COLLISION_SITUATION_MASK_G`/`_A` on a CATCH (Task 16 review, Minor 1). Mario's
  // generated grab has `CATCH id0 ... MASK_G` and `CATCH id1 ... MASK_A` live together
  // (`fighters/acmd/generated/mario.ts`, `game_catch`).
  describe("a grab whose two boxes are ground-only and air-only", () => {
    const ctx = ctxFor({
      ...BASE_DEF,
      scripts: {
        grab: {
          name: "game_catch",
          motion: "catch",
          commands: [
            frame(4),
            CATCH({ id: 0, bone: "top", size: 3, x: 0, y: 6, z: 8, situation: "COLLISION_SITUATION_MASK_G" }),
            CATCH({ id: 1, bone: "top", size: 3, x: 0, y: 6, z: 30, situation: "COLLISION_SITUATION_MASK_A" }),
            frame(7),
            catchClearAll(),
          ],
        },
      },
    });
    /** Does fighter 0's grab catch fighter 1, standing at `x` (or 3 units up and falling)? */
    function caught(x: number, airborne: boolean): boolean {
      const s = standing(ctx);
      s.fighters[1].x = fx(x);
      if (airborne) Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(3), action: "fall" });
      return play(s, 10, (i) => [i === 0 ? Btn.Grab : 0, 0], ctx).some((f) => f.state.fighters[1].grabbedBy === 0);
    }

    it("catches a grounded victim with the ground box only", () => {
      expect(caught(8, false)).toBe(true);
      expect(caught(30, false)).toBe(false);
    });

    it("catches an airborne victim with the air box only", () => {
      expect(caught(30, true)).toBe(true);
      expect(caught(8, true)).toBe(false);
    });
  });
});

/* ------------------------------------------ Task 17: capsule hitboxes -- */

describe("capsule hitboxes through a real hit (Plan 3, Task 17)", () => {
  function hitsWith(attack: ReturnType<typeof ATTACK>): StepEvents["hits"] {
    const def: FighterDef = {
      ...BASE_DEF,
      scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands: [frame(4), attack, frame(7), clearAll()] } },
    };
    const s = standing(ctxFor(def));
    s.fighters[1].x = fx(20);
    return play(s, 8, JAB, ctxFor(def)).flatMap((f) => f.events.hits);
  }

  // smash-script `ATTACK(…, X, Y, Z, X2, Y2, Z2, …)`: an extended hitbox is the
  // capsule between the two points, not a sphere at the first.
  it("hits with the far end of an extended hitbox", () => {
    expect(hitsWith(ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 6, z: 2, z2: 15 }))).toHaveLength(1);
  });

  it("misses with the same box as a sphere at its first point", () => {
    expect(hitsWith(ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 6, z: 2 }))).toEqual([]);
  });

  /** A jab that is the capsule from 2 to 15 units out at 6 up, 2 wide, in a two-fighter match `prepare` arranges. */
  const reaching = (extra: Partial<Parameters<typeof ATTACK>[0]> = {}) =>
    ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 6, z: 2, z2: 15, ...extra });
  const jabScript = (attack: ReturnType<typeof ATTACK>): SimContext =>
    ctxFor({
      ...BASE_DEF,
      scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands: [frame(4), attack, frame(7), clearAll()] } },
    });

  // A far end flips with its fighter, as the near end does: the box reaches the
  // side the fighter is facing and not the other.
  describe("mirrors its far end with the fighter's facing", () => {
    const facingLeft = (victimX: number): Frame[] => {
      const ctx = jabScript(reaching());
      const s = standing(ctx);
      Object.assign(s.fighters[0], { x: fx(40), facing: -1 });
      Object.assign(s.fighters[1], { x: fx(victimX), facing: 1 });
      return play(s, 8, JAB, ctx);
    };

    it("hits a victim on the side it faces, by the far end", () => {
      // Facing left from 40, the box runs from 38 to 25: its far end is 5 from a body at 20.
      expect(facingLeft(20).flatMap((f) => f.events.hits)).toHaveLength(1);
    });

    it("misses one on the side it does not", () => {
      expect(facingLeft(60).flatMap((f) => f.events.hits)).toEqual([]);
    });
  });

  // A hit less than 0.1 deep is a glancing blow (Task 13), and how deep a capsule
  // reaches is measured to its whole length, from whichever end touches.
  describe("is a glancing blow by its own depth", () => {
    /** The body 4 wide and the box 2: the far end, 15 out, touches at 21; `deep` is how far inside it. */
    const withDepth = (deep: number): Frame[] => {
      const ctx = jabScript(reaching());
      const s = standing(ctx);
      s.fighters[1].x = fx(15 + 2 + 4 - deep);
      return play(s, 8, JAB, ctx);
    };

    it("is no hit, and spends nothing, when the far end only grazes", () => {
      const frames = withDepth(0.05);
      expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
      expect(frames.at(-1)!.state.fighters[0].hitThisMove).toEqual([]);
    });

    it("hits when the far end is deeper than 0.1", () => {
      expect(withDepth(0.2).flatMap((f) => f.events.hits)).toHaveLength(1);
    });

    it("is not rescued by a near end that is nowhere near", () => {
      // The same graze against a body the near end could never reach: still no hit.
      const ctx = jabScript(reaching({ z: -20 }));
      const s = standing(ctx);
      s.fighters[1].x = fx(15 + 2 + 4 - 0.05);
      expect(play(s, 8, JAB, ctx).flatMap((f) => f.events.hits)).toEqual([]);
    });
  });

  describe("clanks by its whole length", () => {
    /** Both fighters jab the same capsule at once, `victimX` units apart; the clanks of eight frames. */
    const clanksAt = (apartX: number): number => {
      const ctx = jabScript(reaching({ damage: 5 }));
      const s = standing(ctx);
      s.fighters[1].x = fx(apartX);
      return play(s, 8, () => [Btn.Attack, Btn.Attack], ctx).flatMap((f) => f.events.clanks).length;
    };

    // Fighter 0's box runs from 2 to 15; fighter 1's, facing left from x, from x - 2 to x - 15.
    it("clanks when the tips of two capsules meet, with the near ends 29 units apart", () => {
      // From 33: 31 to 18. The tips are 3 apart, inside 2 + 2.
      expect(clanksAt(33)).toBeGreaterThan(0);
    });

    it("does not clank when the tips are 5 apart", () => {
      // From 35: 33 to 20. Neither body is reached either (15 + 2 + 4 = 21 < 35 - 4).
      expect(clanksAt(35)).toBe(0);
    });
  });

  describe("against a worn shield", () => {
    // A shield worn to 2 of 50 is 18% of its radius: the bubble sits in the body, and a
    // box that reaches the body but not the bubble is a poke that lands on the body.
    const wornShield = (gap: number): { shieldHits: number; hits: number } => {
      const ctx = jabScript(reaching());
      const s = standing(ctx);
      s.fighters[1].shieldHealth = fx(2);
      // The far end is 15 out, `gap` units from the victim's centre line, at the bubble's height.
      s.fighters[1].x = fx(15 + gap);
      const frames = play(s, 12, JAB_INTO_SHIELD, ctx);
      return { shieldHits: frames.flatMap((f) => f.events.shieldHits).length, hits: frames.flatMap((f) => f.events.hits).length };
    };

    it("sets the bubble where the test below assumes", () => {
      const r = shieldBubble({ x: 0, y: 0, shieldHealth: fx(2) }, BASE_DEF).r;
      expect(r).toBeGreaterThan(fx(1.5));
      expect(r).toBeLessThan(fx(2));
    });

    it("lands on the shield when the far end reaches the bubble (3 away: 2 + 1.84 is reach)", () => {
      expect(wornShield(3.5)).toEqual({ shieldHits: 1, hits: 0 });
    });

    it("pokes through to the body when the far end reaches the body but not the bubble", () => {
      expect(wornShield(5)).toEqual({ shieldHits: 0, hits: 1 });
    });
  });

  // A capsule's side, for a shield, is the point of its spine nearest the victim, so
  // the order the script writes its two ends in changes nothing (Plan 3, Task 17
  // fix round 1). The shield covers the side it faces; a hit spanning the centre
  // is covered. UNVERIFIED: which way a shield hit pushes (SmashWiki "Shield"
  // gives how far, not which way).
  describe("on a raised shield, from whichever end is written first", () => {
    interface Outcome {
      shieldHits: number;
      hits: number;
      damage: number;
      /** The victim's speed away from the attacker once the shield hit lands, +: away. */
      away: number;
    }
    /**
     * Fighter 0 jabs `attack` at fighter 1, shielding and facing it, `victimX` units from
     * it; `mirrored` stands the pair on the other side, fighter 0 facing left.
     */
    const shielded = (attack: ReturnType<typeof ATTACK>, victimX: number, mirrored = false): Outcome => {
      const ctx = jabScript(attack);
      const s = standing(ctx);
      Object.assign(s.fighters[0], mirrored ? { x: fx(40), facing: -1 } : { x: 0, facing: 1 });
      Object.assign(s.fighters[1], mirrored ? { x: fx(40 - victimX), facing: 1 } : { x: fx(victimX), facing: -1 });
      const frames = play(s, 12, JAB_INTO_SHIELD, ctx);
      const at = frames.findIndex((f) => f.events.shieldHits.length > 0);
      return {
        shieldHits: frames.flatMap((f) => f.events.shieldHits).length,
        hits: frames.flatMap((f) => f.events.hits).length,
        damage: frames.at(-1)!.state.fighters[1].damage,
        away: at < 0 ? 0 : frames[at].state.fighters[1].vx * (mirrored ? -1 : 1),
      };
    };
    const nearFirst = (): ReturnType<typeof ATTACK> => reaching();
    const tipFirst = (): ReturnType<typeof ATTACK> => reaching({ z: 15, z2: 2 });

    // 8 and 12 put the centre inside the spine's 2 to 15; 10 is the middle; 20 is past the tip.
    it.each([8, 10, 12, 20])("is the same capsule at a victim %i units out, near-first or tip-first, from either side", (victimX) => {
      for (const mirrored of [false, true]) {
        const near = shielded(nearFirst(), victimX, mirrored);
        expect(near).toMatchObject({ shieldHits: 1, hits: 0, damage: 0 });
        expect(near.away).toBeGreaterThan(0);
        expect(shielded(tipFirst(), victimX, mirrored)).toEqual(near);
      }
    });

    it("takes a capsule spanning the shielder's centre on the shield, pushing it away from the attacker", () => {
      for (const [mirrored, name] of [[false, "from the left"], [true, "from the right"]] as const) {
        const hit = shielded(tipFirst(), 10, mirrored);
        expect(hit, name).toMatchObject({ shieldHits: 1, hits: 0 });
        expect(hit.away, name).toBeGreaterThan(0);
      }
    });

    // Attacker and victim on one spot, the spine across both: no side to take, so the way
    // the attacker faces decides (as `launchSourceFacing` breaks its own tie).
    it("breaks a tie, a spine spanning a victim standing where the attacker stands, by the way the attacker faces", () => {
      const across = reaching({ z: -5, z2: 15 });
      const right = shielded(across, 0, false);
      expect(right).toMatchObject({ shieldHits: 1, hits: 0 });
      expect(right.away).toBeGreaterThan(0);
      const left = shielded(across, 0, true);
      expect(left).toMatchObject({ shieldHits: 1, hits: 0 });
      expect(left.away).toBeGreaterThan(0);
    });

    // A vertical capsule (`dx` 0, `dy` not: a far end straight above or below the near
    // one, 8 of the 127 generated far-end ATTACKs; the Task 17 re-review's M1). It has
    // one x, so it is the sphere's rule while that x is to one side of the victim, and the
    // spanning rule when the victim stands on it (`shieldPushDirection`: `dx` or `dy`).
    // UNVERIFIED, like the rest of which way a shield is pushed. Each both ways round:
    // the attacker on the left facing right, and on the right facing left. A sphere
    // level with the victim goes +x whichever side the attacker is on, so only the
    // mirrored half tells the two rules apart.
    describe("a vertical capsule", () => {
      /** At `z` out, from 2 up to 12 up, 2 wide: the shield bubble's height is 6. */
      const vertical = (z: number): ReturnType<typeof ATTACK> =>
        ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 2, z, y2: 12 });

      it.each([false, true])("pushes a victim it stands beside away from the box (mirrored %s)", (mirrored) => {
        // The box is at 10 and the victim at 14, on the shield's facing side of it.
        const hit = shielded(vertical(10), 14, mirrored);
        expect(hit).toMatchObject({ shieldHits: 1, hits: 0 });
        expect(hit.away).toBeGreaterThan(0);
      });

      it.each([false, true])("pushes a victim it stands on away from the attacker's body (mirrored %s)", (mirrored) => {
        // The victim is at x = the box's x: no side to be nearest on, so the attacker's.
        const hit = shielded(vertical(10), 10, mirrored);
        expect(hit).toMatchObject({ shieldHits: 1, hits: 0 });
        expect(hit.away).toBeGreaterThan(0);
      });

      it.each([false, true])("pushes a victim on the attacker's own spot the way the attacker faces (mirrored %s)", (mirrored) => {
        // The box through the attacker too: the tie, `attacker.facing`, which is -x mirrored.
        const hit = shielded(vertical(0), 0, mirrored);
        expect(hit).toMatchObject({ shieldHits: 1, hits: 0 });
        expect(hit.away).toBeGreaterThan(0);
      });
    });

    // A sphere is its own nearest point: today's rule, tie and all (a sphere level with
    // the victim pushes it +x whichever side the attacker is on).
    it("leaves a sphere's rule alone", () => {
      const sphere = ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 6, z: 10 });
      expect(shielded(sphere, 10)).toMatchObject({ shieldHits: 1, hits: 0 });
      expect(shielded(sphere, 10).away).toBeGreaterThan(0);
      // Mirrored, the victim stands at x = 30 and the box at 30: level, so +x, toward the attacker.
      expect(shielded(sphere, 10, true).away).toBeLessThan(0);
    });
  });

  describe("on a grab", () => {
    const grabScript = (far: number): SimContext =>
      ctxFor({
        ...BASE_DEF,
        scripts: {
          grab: {
            name: "game_catch",
            motion: "catch",
            commands: [frame(4), CATCH({ id: 0, bone: "top", size: 2, x: 0, y: 6, z: 2, z2: far }), frame(7), { op: "catchClear", id: 0 }],
          },
        },
      });
    const grabs = (ctx: SimContext, victimX: number): boolean => {
      const s = standing(ctx);
      s.fighters[1].x = fx(victimX);
      return play(s, 12, (i) => [i === 0 ? Btn.Grab : 0, 0], ctx).at(-1)!.state.fighters[0].grabbing === 1;
    };

    it("reaches a victim with the far end, and not a sphere at the near end", () => {
      expect(grabs(grabScript(15), 20)).toBe(true);
      expect(grabs(grabScript(2), 20)).toBe(false);
    });

    it("grabs by plain overlap, not depth: a far end that only grazes still grabs", () => {
      expect(grabs(grabScript(15), 15 + 2 + 4 - 0.05)).toBe(true);
    });

    it("misses a victim past the far end", () => {
      expect(grabs(grabScript(15), 25)).toBe(false);
    });
  });

  describe("on the Smash Ball", () => {
    /** The ball `gap` units past the far end, still; the damage it has taken after a jab. */
    const ballDamage = (gap: number): number => {
      const ctx = jabScript(reaching());
      const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], { ...RULES, smashBall: true }, 12345, ctx);
      for (const f of s.fighters) Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0 });
      Object.assign(s.fighters[0], { x: 0, facing: 1 });
      Object.assign(s.fighters[1], { x: fx(100), facing: -1 });
      Object.assign(s.smashBall, { active: true, health: fx(40), x: fx(15 + gap), y: fx(6), vx: 0, vy: 0, driftTimer: 1000 });
      const after = play(s, 8, JAB, ctx).at(-1)!.state;
      return fx(40) - after.smashBall.health;
    };

    // `SMASH_BALL_RADIUS` (6) and the box (2): the far end at 15 reaches a ball 8 past it.
    it("is hit by the far end", () => {
      expect(ballDamage(7.5)).toBeGreaterThanOrEqual(fx(5));
      expect(ballDamage(9)).toBeLessThan(fx(5));
    });

    // Overlap is the verdict, not depth: one Q12 unit out of reach reads 0 deep (the
    // integer square root floors) but is a miss. Box 8 out, 5 wide, 6 up; the ball
    // (radius 6) at its height, so reach is 11 and the centres are 11 units + 1 raw apart.
    // `sweptCapsulePenetration(...) < 0` as the Smash Ball's test would call it a hit.
    it("is not hit by a sphere one Q12 unit out of reach, though that reads 0 deep", () => {
      const sphere = ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 5, x: 0, y: 6, z: 8 });
      const damageAt = (ballX: number): number => {
        const ctx = jabScript(sphere);
        const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], { ...RULES, smashBall: true }, 12345, ctx);
        for (const f of s.fighters) Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0 });
        Object.assign(s.fighters[0], { x: 0, facing: 1 });
        Object.assign(s.fighters[1], { x: fx(100), facing: -1 });
        Object.assign(s.smashBall, { active: true, health: fx(40), x: ballX, y: fx(6), vx: 0, vy: 0, driftTimer: 1000 });
        return fx(40) - play(s, 8, JAB, ctx).at(-1)!.state.smashBall.health;
      };
      expect(damageAt(fx(8 + 11))).toBeGreaterThanOrEqual(fx(5));
      expect(damageAt(fx(8 + 11) + 1)).toBeLessThan(fx(5));
    });

    // The Smash Ball is outside the glancing gate (Task 13 left it out): a graze still counts.
    it("is hit by a far end that only grazes it", () => {
      expect(ballDamage(8 - 0.05)).toBeGreaterThanOrEqual(fx(5));
    });
  });
});

/* --------------------------------------------- Task 19: autolink angles -- */

describe("autolink angles (Plan 3, Task 19)", () => {
  /**
   * Fighter 0 jabs with `angle` (`over` sets more of the box's own fields; `inputs` is the
   * pair's inputs per frame); returns the hit frame and the frame its freeze releases
   * fighter 1.
   */
  function autolinked(
    angle: number,
    prepare: (s: GameState) => void,
    over: Partial<Hitbox> = {},
    inputs: (i: number) => readonly InputFrame[] = JAB,
  ): { hit: Frame; released: Frame; frames: Frame[] } {
    const def: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        jab1: move("jab1", { hitboxes: [hitbox({ angle: fx(angle), damage: fx(2), ...over })] }),
        nair: move("nair", { hitboxes: [hitbox({ angle: fx(angle), damage: fx(2), ...over })] }),
      },
    };
    const ctx = ctxFor(def);
    const s = standing(ctx);
    prepare(s);
    const frames = play(s, 30, inputs, ctx);
    const h = frames.findIndex((f) => f.events.hits.length > 0);
    const r = frames.findIndex((f, i) => i > h && f.state.fighters[1].hitlag === 0);
    return { hit: frames[h], released: frames[r], frames };
  }
  const airborne = (s: GameState): void => {
    Object.assign(s.fighters[1], { x: fx(12), y: fx(2), grounded: false, platform: -1, action: "fall" });
  };
  /** Airborne, and thrashing at 200%: the jab tumbles her. */
  const airborneAt200 = (s: GameState): void => {
    airborne(s);
    s.fighters[1].damage = fx(200);
  };
  /**
   * Both in the air at height `y`, the victim at x = 12 and the attacker at `x` moving at
   * (`vx`, `vy`): the momentum its hit carries (it arrives a few frames later).
   */
  const attackerAt = (x: number, y: number, vx: number, vy: number) => (s: GameState): void => {
    airborne(s);
    s.fighters[1].y = fx(y);
    Object.assign(s.fighters[0], { x: fx(x), y: fx(y), grounded: false, platform: -1, action: "fall" });
    s.fighters[0].kinetic.controlX = vx;
    s.fighters[0].kinetic.gravityY = vy;
    s.fighters[0].vx = vx;
    s.fighters[0].vy = vy;
  };
  /** A moving attacker and a victim at 200%: the jab tumbles her and the launch has a speed. */
  const movingAt200 = (s: GameState): void => {
    attackerAt(-6, 2, fx(2), 0)(s);
    s.fighters[1].damage = fx(200);
  };

  // SmashWiki "Autolink angle": 367° sets "the opponent's launch speed to the
  // attacker's momentum, plus 20% of the difference" between the hitbox and the
  // opponent's position — pulling them into the hit.
  it("pulls an airborne victim 20% of the way toward the hitbox (367)", () => {
    const { hit, released } = autolinked(367, airborne);
    const [a, at] = hit.state.fighters;
    const v = released.state.fighters[1];
    const hb = hit.events.hits[0];
    expect(v.kinetic.damageX).toBe(a.vx + Math.trunc((hb.x - at.x) / 5));
    expect(v.kinetic.damageY).toBe(a.vy + Math.trunc((hb.y - at.y) / 5));
    expect(v.kinetic.damageX).toBeLessThan(0);
  });

  // "Against grounded opponents, it always uses an angle of 80°."
  it("launches a grounded victim at 80 degrees instead (367)", () => {
    const { hit } = autolinked(367, () => {});
    expect(hit.events.hits[0].angle).toBe(fx(80));
  });

  // 365°: launch speed is "50% of the attacker's momentum", whatever the knockback.
  it("carries the victim at half the attacker's momentum (365)", () => {
    const { hit, released } = autolinked(365, (s) => {
      airborne(s);
      Object.assign(s.fighters[0], { grounded: false, platform: -1, action: "fall", y: fx(2) });
      s.fighters[0].kinetic.controlX = fx(1);
      s.fighters[0].vx = fx(1);
    });
    const a = hit.state.fighters[0];
    expect(released.state.fighters[1].kinetic.damageX).toBe(Math.trunc(a.vx / 2));
    expect(released.state.fighters[1].kinetic.damageY).toBe(Math.trunc(a.vy / 2));
  });

  // 365° "regardless of the knockback": a grounded victim is not sent at 80°, and the
  // hit's own knockback does not size the launch (here, none: the attacker stands still).
  it("launches a grounded victim of a standing attacker nowhere, whatever the knockback (365)", () => {
    const { hit, released } = autolinked(365, () => {}, { baseKnockback: fx(90) });
    expect(hit.events.hits[0].knockback).toBeGreaterThan(fx(90));
    expect(released.state.fighters[1].kinetic.damageX).toBe(0);
    expect(released.state.fighters[1].kinetic.damageY).toBe(0);
    expect(released.state.fighters[1].launchSpeed).toBe(0);
  });

  // 366° and 368° are not modelled and `registerFighters` refuses them (`AUTOLINK_UNMODELLED`, below).
  // A hand-built context that skips it gets 367°'s rules here (UNVERIFIED, known not to be the page's),
  // rather than a launch at 6 or 8 degrees.
  describe.each([366, 368])("%i, which a context that skips the load refusal gets as 367", (angle) => {
    it("pulls an airborne victim exactly as 367 does", () => {
      const same = autolinked(367, airborne).released.state.fighters[1].kinetic;
      const k = autolinked(angle, airborne).released.state.fighters[1].kinetic;
      expect([k.damageX, k.damageY]).toEqual([same.damageX, same.damageY]);
      expect(k.damageX).toBeLessThan(0);
    });

    it("launches a grounded victim at 80 degrees", () => {
      expect(autolinked(angle, () => {}).hit.events.hits[0].angle).toBe(fx(80));
    });
  });

  // 367° is not 7°: its hit's spark goes the way the victim is pulled.
  it("reports the direction the victim is pulled, not the angle read as degrees (367)", () => {
    const { hit, released } = autolinked(367, airborne);
    const { damageX: x, damageY: y } = released.state.fighters[1].kinetic;
    const angle = hit.events.hits[0].angle;
    // The pull is up and back toward the box: nowhere near 7 degrees.
    expect(Math.abs(angle - fx(7))).toBeGreaterThan(fx(90));
    // Along the vector, to a tenth of a degree: its cross product with the angle's unit vector is 0.
    const cross = x * sinDeg(angle) - y * cosDeg(angle);
    expect(Math.abs(cross) / Math.hypot(x, y)).toBeLessThan(0.0025 * ONE);
    expect(x * cosDeg(angle) + y * sinDeg(angle)).toBeGreaterThan(0);
  });

  // A hit with no freeze fires the launch (and clears the parked autolink) inside the hit itself;
  // its event still reports where the launch goes.
  it("reports the direction of a launch fired on contact, with no freeze (367)", () => {
    const { hit } = autolinked(367, airborne, { hitlagMultiplier: 0 });
    const v = hit.state.fighters[1];
    expect(v.hitlag).toBe(0);
    expect(v.combat.autolink).toBe(false);
    const { damageX: x, damageY: y } = v.kinetic;
    expect(x).toBeLessThan(0);
    const angle = hit.events.hits[0].angle;
    expect(Math.abs(x * sinDeg(angle) - y * cosDeg(angle)) / Math.hypot(x, y)).toBeLessThan(0.0025 * ONE);
    expect(x * cosDeg(angle) + y * sinDeg(angle)).toBeGreaterThan(0);
  });

  // The vector is in world space, so facing left changes where the box is and nothing else:
  // the victim, in front of a box that faces left, is pulled toward +x.
  it("reports the direction of a pull to the right of a box that faces left (367)", () => {
    const mirrored = (s: GameState): void => {
      airborne(s);
      Object.assign(s.fighters[0], { x: fx(24), facing: -1 });
      Object.assign(s.fighters[1], { x: fx(12), facing: 1 });
    };
    const { hit, released } = autolinked(367, mirrored);
    const { damageX: x, damageY: y } = released.state.fighters[1].kinetic;
    const angle = hit.events.hits[0].angle;
    expect(x).toBeGreaterThan(0);
    expect(Math.abs(x * sinDeg(angle) - y * cosDeg(angle)) / Math.hypot(x, y)).toBeLessThan(0.0025 * ONE);
    expect(x * cosDeg(angle) + y * sinDeg(angle)).toBeGreaterThan(0);
  });

  // "its launch speed is capped at 3"; "vertical launch speed has a lower cap of -1".
  describe("caps (367)", () => {
    it("caps the launch speed at 3, keeping the direction", () => {
      const { released } = autolinked(367, attackerAt(-8, 2, fx(5), 0));
      const { damageX: x, damageY: y } = released.state.fighters[1].kinetic;
      expect(released.state.fighters[1].launchSpeed).toBeLessThanOrEqual(fx(3));
      expect(Math.abs(Math.hypot(x, y) - fx(3))).toBeLessThan(2);
      expect(x).toBeGreaterThan(0);
    });

    it("floors the vertical speed at -1, before the speed cap", () => {
      const { released } = autolinked(367, attackerAt(4, 40, 0, fx(-2.5)));
      const v = released.state.fighters[1];
      expect(v.kinetic.damageY).toBe(fx(-1));
      expect(v.launchSpeed).toBeLessThan(fx(3));
    });

    it("does not cap 365, whose launch is half the momentum", () => {
      const { hit, released } = autolinked(365, attackerAt(-24, 2, fx(7), 0));
      expect(released.state.fighters[1].kinetic.damageX).toBe(Math.trunc(hit.state.fighters[0].vx / 2));
      expect(released.state.fighters[1].kinetic.damageX).toBeGreaterThan(fx(3));
    });
  });

  // The vector is fixed on contact and fires when the freeze ends, whole: no DI, no LSI.
  // UNVERIFIED: the page names only SDI, which 365° "can be easily escaped with".
  describe("DI and LSI", () => {
    // The stick is held from the frame after the hit on, through the freeze: it can bend the
    // launch and nothing before it (a stick held in the air lands her first).
    const launched = (angle: number, btn: number) => {
      const after = autolinked(angle, movingAt200).hit.state.frame;
      const held = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Attack : 0, i >= after ? btn : 0];
      const r = autolinked(angle, movingAt200, {}, held).released.state.fighters[1];
      return [r.kinetic.damageX, r.kinetic.damageY, r.launchSpeed];
    };

    it("bends a tumbling ordinary launch, which is the control", () => {
      expect(launched(45, Btn.Up)).not.toEqual(launched(45, 0));
      expect(launched(45, Btn.Left)).not.toEqual(launched(45, 0));
    });

    it.each([365, 367])("leaves a tumbling %i launch as it was fixed, whatever the stick says", (angle) => {
      const neutral = launched(angle, 0);
      expect(neutral[2]).toBeGreaterThan(0);
      for (const btn of [Btn.Up, Btn.Down, Btn.Left, Btn.Right]) expect(launched(angle, btn)).toEqual(neutral);
    });
  });

  // What the hit decides, an autolink does not take from the angle: its hitstun is the
  // knockback's ("hitstun is still determined by the numerical result of knockback").
  it("has the hitstun and knockback of the same hit at an ordinary angle", () => {
    const plain = autolinked(45, airborneAt200);
    const link = autolinked(367, airborneAt200);
    expect(link.hit.events.hits[0].knockback).toBe(plain.hit.events.hits[0].knockback);
    expect(link.hit.state.fighters[1].hitstun).toBe(plain.hit.state.fighters[1].hitstun);
    expect(link.hit.state.fighters[1].action).toBe("tumble");
  });

  // SmashWiki: "the knockback speed-up effect still applies to moves that use autolink
  // angles if they do not have set knockback" — and its hitstun was shortened for it.
  describe("the balloon speed-up", () => {
    const speedUp = (angle: number, over: Partial<Hitbox>, at: (s: GameState) => void) => {
      const k = autolinked(angle, at, over).released.state.fighters[1].kinetic;
      return { faf: k.speedUpFaf, max: k.speedUpMax };
    };

    it.each([365, 367])("plays a tumbling %i launch sped up, as the plain hit does", (angle) => {
      const plain = speedUp(45, {}, movingAt200);
      expect(plain.max).toBeGreaterThan(ONE);
      expect(speedUp(angle, {}, movingAt200)).toEqual(plain);
    });

    it("does not speed up a launch that does not tumble", () => {
      expect(speedUp(367, {}, attackerAt(-6, 2, fx(2), 0))).toEqual({ faf: 0, max: 0 });
    });

    it("does not speed up set knockback", () => {
      expect(speedUp(367, { fixedKnockback: fx(30) }, movingAt200)).toEqual({ faf: 0, max: 0 });
    });
  });

  // `set_weight` falls by its own gravity "whatever the angle" (`reelOnce`); Kirby's and Link's
  // forward airs and Pikachu's neutral air are set weight on an autolink angle.
  it("gives a set-weight autolink set weight's fall", () => {
    const set = autolinked(367, airborne, { setWeight: true }).released.state.fighters[1];
    expect(set.kinetic.setWeightFrames).toBe(SET_WEIGHT_LAUNCH_FRAMES);
    expect(autolinked(367, airborne).released.state.fighters[1].kinetic.setWeightFrames).toBe(0);
  });

  it("is never a balloon launch", () => {
    expect(autolinked(367, airborneAt200).released.state.fighters[1].balloon).toBe(false);
  });

  // 365° on a grounded victim carries nothing; with momentum it can lift her off the floor.
  it("takes a grounded victim off the floor when the launch rises (365)", () => {
    const { released } = autolinked(365, (s) => {
      Object.assign(s.fighters[0], { grounded: false, platform: -1, action: "fall", y: fx(3) });
      s.fighters[0].kinetic.gravityY = fx(1);
      s.fighters[0].vy = fx(1);
    });
    const v = released.state.fighters[1];
    expect(v.kinetic.damageY).toBeGreaterThan(0);
    expect(v.grounded).toBe(false);
    expect(v.jumpsUsed).toBe(1);
  });

  describe("the parked vector", () => {
    const NOT_PARKED = {
      autolink: false,
      autolinkPull: false,
      autolinkMomentumX: 0,
      autolinkMomentumY: 0,
      autolinkPointX: 0,
      autolinkPointY: 0,
    };

    // What the vector needs, not the vector: it is computed when the freeze ends (I2).
    it("parks the momentum and the hit point for the freeze, then fires and clears them (367)", () => {
      const { hit, released } = autolinked(367, airborne);
      const [a] = hit.state.fighters;
      const hb = hit.events.hits[0];
      expect(hit.state.fighters[1].combat).toMatchObject({
        autolink: true,
        autolinkPull: true,
        autolinkMomentumX: a.vx,
        autolinkMomentumY: a.vy,
        autolinkPointX: hb.x,
        autolinkPointY: hb.y,
      });
      expect(released.state.fighters[1].combat).toMatchObject(NOT_PARKED);
    });

    it("parks only the momentum for 365, which ignores where the victim is", () => {
      const { hit, released } = autolinked(365, attackerAt(-6, 2, fx(2), 0));
      expect(hit.state.fighters[1].combat).toMatchObject({
        autolink: true,
        autolinkPull: false,
        autolinkMomentumX: hit.state.fighters[0].vx,
        autolinkMomentumY: hit.state.fighters[0].vy,
        autolinkPointX: 0,
        autolinkPointY: 0,
      });
      expect(released.state.fighters[1].combat).toMatchObject(NOT_PARKED);
    });

    it.each([45, 361, 360, 364])("is not parked for an ordinary angle (%i)", (angle) => {
      const { hit, released } = autolinked(angle, airborne);
      expect(hit.state.fighters[1].combat).toMatchObject(NOT_PARKED);
      expect(released.state.fighters[1].combat.autolink).toBe(false);
    });

    it("is not parked against a grounded victim, who is launched at 80 degrees (367)", () => {
      expect(autolinked(367, () => {}).hit.state.fighters[1].combat.autolink).toBe(false);
    });

    it("is a state a rollback reproduces: cloned, and in the hash", () => {
      const { hit } = autolinked(367, airborne);
      const copy = cloneState(hit.state);
      expect(copy.fighters[1].combat).toEqual(hit.state.fighters[1].combat);
      expect(hashState(copy)).toBe(hashState(hit.state));
      // Every parked field is in the hash.
      const numbers = ["autolinkMomentumX", "autolinkMomentumY", "autolinkPointX", "autolinkPointY"] as const;
      for (const key of numbers) {
        const changed = cloneState(hit.state);
        changed.fighters[1].combat[key] += 1;
        expect(hashState(changed), key).not.toBe(hashState(hit.state));
      }
      for (const key of ["autolink", "autolinkPull"] as const) {
        const changed = cloneState(hit.state);
        changed.fighters[1].combat[key] = !changed.fighters[1].combat[key];
        expect(hashState(changed), key).not.toBe(hashState(hit.state));
      }
      // ...and the copy shares nothing with the original.
      copy.fighters[1].combat.autolinkPointX += 1;
      expect(hit.state.fighters[1].combat.autolinkPointX).not.toBe(copy.fighters[1].combat.autolinkPointX);
    });
  });

  // SmashWiki "Autolink angle": the pull is "toward the center of the hitbox". A capsule's centre is
  // its midpoint, whichever end the script writes first (Plan 3, Task 19 fix round 1).
  describe("aims at the centre of the hitbox (367)", () => {
    /** Fighter 0 jabs a 367 capsule from (`y`, `z`) to (`y2`, `z2`); fighter 1 hangs in the air at x = 12. */
    const capsule = (y: number, z: number, y2: number, z2: number) => {
      const ctx = ctxFor({
        ...BASE_DEF,
        scripts: {
          jab1: {
            name: "game_attack11",
            motion: "attack_11",
            commands: [frame(4), ATTACK({ id: 0, bone: "top", damage: 2, angle: 367, kbg: 100, bkb: 40, size: 5, x: 0, y, z, y2, z2, x2: 0 }), frame(7), clearAll()],
          },
        },
      });
      const s = standing(ctx);
      airborne(s);
      const frames = play(s, 30, JAB, ctx);
      const h = frames.findIndex((f) => f.events.hits.length > 0);
      const r = frames.findIndex((f, i) => i > h && f.state.fighters[1].hitlag === 0);
      return { hit: frames[h], v: frames[r].state.fighters[1].kinetic };
    };
    // From (y 2, z 2) to (y 10, z 14): the centre is 8 out and 6 up.
    const nearFirst = capsule(2, 2, 10, 14);
    const farFirst = capsule(10, 14, 2, 2);

    it("pulls toward the midpoint of the capsule", () => {
      const [a, victim] = nearFirst.hit.state.fighters;
      expect(nearFirst.v.damageX).toBe(a.vx + byRatio(a.x + fx(8) - victim.x, [1, 5]));
      expect(nearFirst.v.damageY).toBe(a.vy + byRatio(a.y + fx(6) - victim.y, [1, 5]));
      // The victim is 4 units past the centre and 4 below it: pulled back and up.
      expect(nearFirst.v.damageX).toBeLessThan(0);
      expect(nearFirst.v.damageY).toBeGreaterThan(0);
    });

    it("is the same launch whichever end the script writes first", () => {
      expect([farFirst.v.damageX, farFirst.v.damageY]).toEqual([nearFirst.v.damageX, nearFirst.v.damageY]);
    });
  });

  // SmashWiki: "this is calculated after hitlag is over", which with "the weakening of SDI" is why 367
  // is "impossible to escape", where 365 "can be easily escaped with SDI". So the vector reads the
  // victim where SDI left her (Plan 3, Task 19 fix round 1).
  describe("is computed when the freeze ends, after SDI", () => {
    /**
     * The pair's launch with fighter 1 pressing `stick` once, on the first frozen frame an SDI pulse
     * can fire on (a fresh press while her freeze count is a multiple of 4), and where she ended up.
     */
    const launched = (angle: number, prepare: (s: GameState) => void, stick: number) => {
      const dry = autolinked(angle, prepare);
      const h = dry.frames.indexOf(dry.hit);
      const pulse = dry.frames.findIndex((_, i) => i > h && dry.frames[i - 1].state.fighters[1].hitlag % 4 === 0 && dry.frames[i - 1].state.fighters[1].hitlag > 0);
      expect(pulse, "a freeze long enough to pulse in").toBeGreaterThan(h);
      const held = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Attack : 0, i === pulse ? stick : 0];
      const { hit, released } = autolinked(angle, prepare, {}, held);
      const v = released.state.fighters[1];
      return { hit, x: v.x, contactX: hit.state.fighters[1].x, damageX: v.kinetic.damageX, damageY: v.kinetic.damageY };
    };

    it("pulls a victim who SDIs away from the box harder, by 20% of the shift (367)", () => {
      const still = launched(367, airborne, 0);
      const away = launched(367, airborne, Btn.Right);
      // She did SDI: the box is behind her, and she moved forward of it.
      expect(away.x).toBeGreaterThan(away.contactX);
      expect(still.x).toBe(still.contactX);
      // The pull is 20% of the distance from the box centre at the end of the freeze, not at contact.
      const [a] = away.hit.state.fighters;
      const hb = away.hit.events.hits[0];
      expect(away.damageX).toBe(a.vx + byRatio(hb.x - away.x, [1, 5]));
      // One pulse is 2 units, so the pull is 0.4 stronger (to the unit the truncation can move).
      expect(away.x - away.contactX).toBe(SDI_DISTANCE);
      expect(Math.abs(still.damageX - away.damageX - byRatio(SDI_DISTANCE, [1, 5]))).toBeLessThanOrEqual(1);
      expect(away.damageX).toBeLessThan(still.damageX);
    });

    it("does not follow it for 365, which ignores where the victim is", () => {
      const prepare = attackerAt(-6, 2, fx(2), 0);
      const still = launched(365, prepare, 0);
      const away = launched(365, prepare, Btn.Right);
      expect(away.x).toBeGreaterThan(away.contactX);
      expect([away.damageX, away.damageY]).toEqual([still.damageX, still.damageY]);
    });
  });

  // A projectile launches with its own momentum, as a fist does with the fighter's.
  it("carries a victim of a projectile at half the projectile's momentum (365)", () => {
    const pellet = hitbox({ startFrame: 1, endFrame: 90, x: 0, y: 0, damage: fx(2), angle: fx(365) });
    const shooter: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        neutralB: move("neutralB", {
          totalFrames: 30,
          hitboxes: [],
          projectiles: [
            { id: "pellet", spawnFrame: 6, offsetX: fx(6), offsetY: fx(6), vx: fx(4), vy: 0, gravity: 0, lifetime: 90, hitbox: pellet, destroyOnHit: true, visual: "energy" },
          ],
        }),
      },
    };
    const ctx = ctxFor(shooter);
    const s = standing(ctx);
    s.fighters[1].x = fx(40);
    const frames = play(s, 40, (i) => [i === 0 ? Btn.Special : 0, 0], ctx);
    const h = frames.findIndex((f) => f.events.hits.length > 0);
    const r = frames.findIndex((f, i) => i > h && f.state.fighters[1].hitlag === 0);
    expect(h).toBeGreaterThan(0);
    // The shooter is not frozen by its own pellet, and stands still: half of 4 is the pellet's.
    expect(frames[r].state.fighters[1].kinetic.damageX).toBe(fx(2));
    expect(frames[r].state.fighters[1].kinetic.damageY).toBe(0);
  });

  // A launch that is kept (Task 8) turns toward the sum of both vectors: an autolink adds the
  // vector it would launch with, not a launch at its angle read as degrees (7°).
  it("adds its own pull to a kept launch, not a launch at 7 degrees (367)", () => {
    const quick: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        jab1: move("jab1", { hitboxes: [hitbox({ startFrame: 1, radius: fx(10), angle: fx(367) })] }),
      },
    };
    const ctx = ctxFor(quick);
    const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
    [{ x: fx(-60), facing: 1 }, { x: fx(12), facing: -1 }, { x: 0, facing: 1 }].forEach((place, i) => {
      Object.assign(s.fighters[i], place, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0 });
    });
    // Fighter 1 is flying straight up, from fighter 0, and the jab is far weaker than that.
    const v = s.fighters[1];
    Object.assign(v, { grounded: false, platform: -1, y: fx(1), action: "tumble", hitstun: 50 });
    v.kinetic.damageY = fx(3);
    v.launchSpeed = fx(3);
    v.vy = fx(3);
    v.combat.launchSource = 0;
    const frames = play(s, 8, (i) => [0, 0, i === 0 ? Btn.Attack : 0], ctx);
    const kept = frames[frames.findIndex((f) => f.events.hits.length > 0)].state.fighters[1];
    expect(kept.pendingFacing).toBe(0);
    expect(kept.hitstun).toBeGreaterThan(30);
    // Up, and pulled back toward the box (it is 4 units behind the victim): not up and forward.
    expect(kept.kinetic.damageX).toBeLessThan(0);
    expect(kept.kinetic.damageY).toBeGreaterThan(0);
    expect(Math.abs(Math.hypot(kept.kinetic.damageX, kept.kinetic.damageY) - kept.launchSpeed)).toBeLessThan(3);
  });
});

/* ------------------------- final wave: the first actionable frame -- */

/**
 * Plan 3's final review, Important 4, ruled Option A. A timed status the fighter
 * enters itself, in phase 3, counts its entry frame as its frame 1 (`actionFrame`
 * 0), so its length T, UFD's "Total frames" (first actionable frame T + 1), ends
 * it on `actionFrame` T, frame T + 1, and the next status's `main` reads input on
 * that same frame (`handOff`, `states.ts`), the way `jumpSquat` leaves on its last
 * frame. A status entered on contact (a landing in phase 5, a hit in phase 6)
 * counts its entry frame as frame 0, and was already right; those are pinned as
 * they were.
 *
 * "Acts on frame N" is pinned two ways: a fresh press made on frame N is taken on
 * frame N while frame N − 1 is still the old status, and a press buffered earlier
 * (Ultimate's 9-frame buffer) fires on frame N and not before.
 */
describe("a timed status ends on its first actionable frame (Plan 3 final wave)", () => {
  /** Fighter 0 standing at x 0, fighter 1 parked at x -60, out of every reach. */
  function apart(): GameState {
    const s = standing();
    s.fighters[1].x = fx(-60);
    s.fighters[1].facing = 1;
    return s;
  }
  /** Fighter `port`'s action after each frame; index i is the frame the i-th step played. */
  const actions = (frames: Frame[], port = 0): ActionState[] => frames.map((f) => f.state.fighters[port].action);
  /** Fighter 0 hanging on the right ledge (x 80), past `LEDGE_HANG_MIN`. */
  function hanging(): GameState {
    const s = apart();
    const f = s.fighters[0];
    Object.assign(f, { x: fx(80), y: 0, grounded: false, platform: -1, action: "ledgeHang", actionFrame: 5, intangible: 0, facing: -1 });
    f.ledge = { platform: 0, side: 1 };
    return s;
  }
  /** Fighter 0 high over the stage, falling, free to act. */
  function aloft(): GameState {
    const s = apart();
    Object.assign(s.fighters[0], { y: fx(150), grounded: false, platform: -1, action: "fall", actionFrame: 0, jumpsUsed: 1 });
    return s;
  }

  // The tester's jab is 24 frames (`move`): UFD's "Total frames" 24, first actionable 25.
  it("acts out of a 24-frame jab on frame 25, a fresh press or a buffered one", () => {
    const fresh = actions(play(apart(), 26, (i) => [i === 0 ? Btn.Attack : i === 24 ? Btn.Jump : 0, 0]));
    expect(fresh.slice(0, 24).every((a) => a === "attack"), "frames 1-24 are the jab").toBe(true);
    expect(fresh[24], "frame 25").toBe("jumpSquat");
    const buffered = actions(play(apart(), 26, (i) => [i === 0 ? Btn.Attack : i === 19 ? Btn.Jump : 0, 0]));
    expect(buffered.indexOf("jumpSquat") + 1).toBe(25);
  });

  // The tester air dodges as Mario does (`DEFAULT_AIR_DODGE`): P's
  // `escape_air_stiff_frame` 52 (fudgepop01/amiibo_research `fighter_param_motion.xml`
  // @523374aa L26), first actionable 53. The roster's own are pinned in
  // `fighters/movement.test.ts`.
  it("acts out of Mario's 52-frame neutral air dodge on frame 53", () => {
    expect(DEFAULT_AIR_DODGE.neutralFrames).toBe(52);
    const a = actions(play(aloft(), 54, (i) => [i === 0 ? Btn.Shield : i === 52 ? Btn.Attack : 0, 0]));
    expect(a[51], "frame 52").toBe("airDodge");
    expect(a[52], "frame 53: the neutral air").toBe("attack");
    const buffered = actions(play(aloft(), 54, (i) => [i === 0 ? Btn.Shield : i === 46 ? Btn.Attack : 0, 0]));
    expect(buffered.indexOf("attack") + 1).toBe(53);
  });

  // UFD (https://ultimateframedata.com/mario, "Shield Drop — 11 frames (universal)"):
  // the drop's frames 1-11, first actionable 12.
  it("acts out of the 11-frame shield drop on frame 12", () => {
    expect(SHIELD_RELEASE_FRAMES).toBe(11);
    // Shield held for 6 frames, let go on the 7th (index 6): the drop's frame 1.
    const drop = (press: number) => actions(play(apart(), 20, (i) => [i < 6 ? Btn.Shield : i === press ? Btn.Jump : 0, 0]));
    const fresh = drop(6 + 11);
    expect(fresh[6], "the drop's frame 1").toBe("shieldRelease");
    expect(fresh[6 + 10], "its frame 11").toBe("shieldRelease");
    expect(fresh[6 + 11], "its frame 12").toBe("jumpSquat");
    expect(drop(6 + 5).indexOf("jumpSquat") - 6 + 1).toBe(12);
  });

  // UNVERIFIED: `LEDGE_GETUP_FRAMES` 26 is pre-existing and unsourced (D56's open
  // questions). Whatever its length, the getup acts on the frame after it.
  it("acts out of a ledge getup on its length + 1", () => {
    const n = LEDGE_GETUP_FRAMES;
    const getup = (press: number) => actions(play(hanging(), n + 3, (i) => [i === 0 ? Btn.Up : i === press ? Btn.Jump : 0, 0]));
    const fresh = getup(n);
    expect(fresh[0]).toBe("ledgeGetUp");
    expect(fresh[n - 1], `frame ${n}`).toBe("ledgeGetUp");
    expect(fresh[n], `frame ${n + 1}: on the stage, and jumping`).toBe("jumpSquat");
    expect(getup(n - 6).indexOf("jumpSquat") + 1).toBe(n + 1);
  });

  // The other three ledge options and every other timed status the fighter starts
  // itself hand off the same way: a fresh press on the frame after the length is
  // taken on it. UNVERIFIED: the lengths, pre-existing and unsourced (the ledge
  // options' 13/55/34, `SHIELD_START_FRAMES` 1, `CROUCH_START_FRAMES` and
  // `CROUCH_END_FRAMES` 5, `TURNAROUND_FRAMES` 11, `PUMMEL_FRAMES` 10) or the
  // tester's own (its 30-frame grab); what is pinned is the frame after each.
  it.each([
    ["ledgeJump", LEDGE_JUMP_FRAMES],
    ["ledgeAttack", LEDGE_ATTACK_FRAMES],
    ["ledgeRoll", LEDGE_ROLL_FRAMES],
  ] as const)("acts out of a %s on its length + 1", (action, n) => {
    const key = action === "ledgeJump" ? Btn.Jump : action === "ledgeAttack" ? Btn.Attack : Btn.Shield;
    // A ledge jump ends in the air: the press there is the air dodge.
    const press = action === "ledgeJump" ? Btn.Shield : Btn.Jump;
    const a = actions(play(hanging(), n + 2, (i) => [i === 0 ? key : i === n ? press : 0, 0]));
    expect(a[0]).toBe(action);
    expect(a[n - 1]).toBe(action);
    expect(a[n]).toBe(action === "ledgeJump" ? "airDodge" : "jumpSquat");
  });

  it("acts out of a whiffed 30-frame grab on frame 31", () => {
    const a = actions(play(apart(), 32, (i) => [i === 0 ? Btn.Grab : i === 30 ? Btn.Jump : 0, 0]));
    expect(a[29]).toBe("grab");
    expect(a[30]).toBe("jumpSquat");
  });

  it("acts out of the one-frame shield start on frame 2: a jump out of shield", () => {
    const a = actions(play(apart(), 3, (i) => [i === 0 ? Btn.Shield : i === 1 ? Btn.Shield | Btn.Jump : Btn.Shield, 0]));
    expect(a[0]).toBe("shieldStart");
    expect(a[1]).toBe("jumpSquat");
  });

  it("acts out of a crouch's start and its end on their length + 1", () => {
    // Down held: crouchStart on frame 1, crouch on frame 6, where the press is a down tilt (the jab, for the tester).
    const down = actions(play(apart(), 7, (i) => [i === 5 ? Btn.Down | Btn.Attack : Btn.Down, 0]));
    expect(down[4]).toBe("crouchStart");
    expect(down[5]).toBe("attack");
    // Let go after 7 crouching frames: crouchEnd from frame 8, its frames 1-5, then a jump on its frame 6.
    const up = actions(play(apart(), 15, (i) => [i < 7 ? Btn.Down : i === 12 ? Btn.Jump : 0, 0]));
    expect(up[7]).toBe("crouchEnd");
    expect(up[11]).toBe("crouchEnd");
    expect(up[12]).toBe("jumpSquat");
  });

  it("acts out of a run's 11-frame turnaround on frame 12", () => {
    const s = apart();
    Object.assign(s.fighters[0], { action: "run", actionFrame: 20 });
    const a = actions(play(s, 13, (i) => [i === 0 ? Btn.Left : i === 11 ? Btn.Jump : 0, 0]));
    expect(a[0]).toBe("turnaround");
    expect(a[10]).toBe("turnaround");
    expect(a[11]).toBe("jumpSquat");
  });

  it("acts out of a pummel on its length + 1: a second pummel starts there", () => {
    const pummeller: FighterDef = { ...BASE_DEF, moves: { ...BASE_DEF.moves, pummel: move("pummel", { totalFrames: 10, hitboxes: [] }) } };
    const ctx = ctxFor(pummeller);
    const s = standing(ctx);
    // Fighter 0 grabs fighter 1 (8 units off) and pummels; nothing lands, so nothing freezes.
    const frames = play(s, 60, (i) => [i === 0 ? Btn.Grab : i === 40 || i === 40 + PUMMEL_FRAMES ? Btn.Attack : 0, 0], ctx);
    const a = actions(frames);
    expect(a[39], "held").toBe("grabHold");
    expect(a[40]).toBe("pummel");
    expect(a[40 + PUMMEL_FRAMES - 1]).toBe("pummel");
    expect(frames[40 + PUMMEL_FRAMES].state.fighters[0]).toMatchObject({ action: "pummel", actionFrame: 0 });
  });

  /* ---- statuses entered on contact: unchanged ---- */

  // A landing is entered in phase 5, on the frame of landing: lag L is frames 1..L
  // after it, and the fighter acts on L + 1 (SmashWiki "Lag", https://www.ssbwiki.com/Lag).
  it("still acts out of 8 frames of landing lag on the 9th frame after the landing", () => {
    const fallingNair = () => {
      const s = apart();
      Object.assign(s.fighters[0], { y: fx(3), grounded: false, platform: -1, action: "fall", jumpsUsed: 1 });
      return s;
    };
    const dry = actions(play(fallingNair(), 20, (i) => [i === 0 ? Btn.Attack : 0, 0]));
    const landed = dry.indexOf("landingLag");
    expect(dry[landed + 7], "lag frame 7").toBe("landingLag");
    // A press buffered in the lag fires on the 9th frame after the landing, not on the 8th.
    const a = actions(play(fallingNair(), landed + 10, (i) => [i === 0 ? Btn.Attack : i === landed + 4 ? Btn.Jump : 0, 0]));
    expect(a.indexOf("jumpSquat") - landed).toBe(9);
  });

  // A tech is entered on the frame of landing too: in place it is 26 frames, first
  // actionable 27 (SmashWiki "Lucario (SSBU)/Techs", `TECH_FRAMES`).
  it("still acts out of a tech in place on the 27th frame after the landing", () => {
    const flying = () => {
      const s = apart();
      const v = s.fighters[1];
      Object.assign(v, { x: 0, y: fx(6), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60 });
      s.fighters[0].x = fx(60);
      v.kinetic.damageY = fx(-2);
      v.launchSpeed = fx(2);
      v.vy = fx(-2);
      return s;
    };
    const dry = actions(play(flying(), 10, (i) => [0, i === 0 ? Btn.Shield : 0]), 1);
    const teched = dry.indexOf("tech");
    expect(teched).toBeGreaterThan(0);
    const a = actions(play(flying(), teched + 30, (i) => [0, i === 0 ? Btn.Shield : i === teched + 20 ? Btn.Jump : 0]), 1);
    expect(a[teched + TECH_FRAMES - 1]).toBe("tech");
    expect(a.indexOf("jumpSquat") - teched).toBe(TECH_FRAMES + 1);
  });

  /** The tick of the hit, the victim's first frame after the freeze, and the stun it was dealt. */
  function afterFreeze(frames: Frame[], shield: boolean): { first: number; stun: number } {
    const hit = frames.findIndex((f) => (shield ? f.events.shieldHits : f.events.hits).length > 0);
    expect(hit, "the jab connects").toBeGreaterThanOrEqual(0);
    const stun = frames[hit].state.fighters[1].hitstun;
    const first = frames.findIndex((f, i) => i > hit && f.state.fighters[1].actionFrame === 1);
    return { first, stun };
  }

  // Hitstun H: rubendal SSBU-Calculator's FAF is H + 1, counted from the first frame
  // after the freeze (https://github.com/rubendal/SSBU-Calculator). A weak flat hit
  // keeps the victim on the ground, so the act is a jab.
  it("still acts out of hitstun H on the (H + 1)th frame after the freeze", () => {
    const flat: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: fx(20), knockbackGrowth: 0 })] }) },
    };
    const ctx = ctxFor(flat);
    const dry = play(standing(ctx), 40, JAB, ctx);
    const { first, stun } = afterFreeze(dry, false);
    expect(stun).toBeGreaterThan(3);
    const frames = play(standing(ctx), first + stun + 2, (i) => [i === 0 ? Btn.Attack : 0, i === first + stun - 3 ? Btn.Attack : 0], ctx);
    expect(frames[first + stun - 1].state.fighters[1].grounded).toBe(true);
    expect(actions(frames, 1).indexOf("attack") - first + 1).toBe(stun + 1);
  });

  // Shieldstun S: acts on S + 1 after the freeze, as hitstun does (rubendal SSBU-Calculator).
  it("still acts out of shieldstun S on the (S + 1)th frame after the freeze", () => {
    const dry = play(standing(), 40, JAB_INTO_SHIELD);
    const { first, stun } = afterFreeze(dry, true);
    expect(stun).toBeGreaterThan(1);
    const frames = play(standing(), first + stun + 2, (i) => [i === 0 ? Btn.Attack : 0, i === first + stun - 2 ? Btn.Shield | Btn.Jump : Btn.Shield]);
    expect(actions(frames, 1).indexOf("jumpSquat") - first + 1).toBe(stun + 1);
  });
});

/* -------------------------------- final wave, part 2: the engine fixes -- */

/**
 * Plan 3 final wave, part 2. Each describe is one numbered fix of the brief
 * (`final-wave-2-brief.md`), through `step()` on the flat test stage (its edge
 * at x = 80).
 */

/** The tester with `jab1`'s one box replaced by `hb`. */
function jabbing(hb: Hitbox): SimContext {
  return ctxFor({ ...BASE_DEF, moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hb] }) } });
}

/**
 * Fighter 0 jabs once, on the first step; `stick(v)` is fighter 1's input on a
 * frame, from its state before the frame. Returns every frame, the hit's index
 * and the index of the frame fighter 1's freeze ends on.
 */
function jabbedWhile(
  s: GameState,
  ctx: SimContext,
  stick: (v: FighterState, i: number) => InputFrame,
  n = 40,
): { frames: Frame[]; hit: number; fired: number } {
  const frames: Frame[] = [];
  let state = s;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < n; i++) {
    const now = [i === 0 ? Btn.Attack : 0, stick(state.fighters[1], i)];
    const r = step(state, now, { prevInputs: prev, ctx });
    frames.push(r);
    state = r.state;
    prev = now;
  }
  const hit = frames.findIndex((f) => f.events.hits.length > 0);
  const fired = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
  return { frames, hit, fired };
}

/** Fighter 1 mashes `dir` on every frame of its freeze an SDI pulse can fire on (`SDI_INPUT_INTERVAL`). */
const mashing = (dir: number) => (v: FighterState): InputFrame => (v.hitlag > 0 && v.hitlag % 4 === 0 ? dir : 0);

describe("the freeze ends in order: ASDI, the clamp, a ground re-check, then the launch (final wave, part 2, item 1)", () => {
  // A tumbling meteor (270°, 120 knockback, 12 frames of freeze) from fighter 0 at
  // x 70 onto fighter 1 standing at x 78, 2 units from the stage's edge at 80.
  const meteor = jabbing(hitbox({ angle: fx(270), meteor: true, baseKnockback: fx(120), knockbackGrowth: 0 }));
  const atTheLip = (): GameState => {
    const s = standing(meteor);
    s.fighters[0].x = fx(70);
    s.fighters[1].x = fx(78);
    return s;
  };

  it("bounces a grounded victim of a tumbling meteor that stays on the stage (the control)", () => {
    const { frames, fired } = jabbedWhile(atTheLip(), meteor, () => 0);
    const v = frames[fired].state.fighters[1];
    expect(v.x).toBe(fx(78));
    expect(v.kinetic.damageY).toBeGreaterThan(0);
  });

  // The final review's Important 1: the victim SDIs off the lip during the freeze,
  // so at release it stands over nothing, and the meteor spikes it.
  it("spikes a grounded meteor's victim who SDIs past the edge, rather than bouncing it off thin air", () => {
    const { frames, hit, fired } = jabbedWhile(atTheLip(), meteor, mashing(Btn.Right));
    expect(frames[hit].state.fighters[1].x).toBe(fx(78));
    const v = frames[fired].state.fighters[1];
    // Three pulses of 2 (freeze 12, 8, 4): past the edge at 80.
    expect(v.x).toBe(fx(84));
    expect(v.grounded).toBe(false);
    expect(v.kinetic.damageY).toBeLessThan(0);
    // The whole launch, not the bounce's 0.9 of it.
    expect(v.launchSpeed).toBe(mul(fx(120), LAUNCH_SPEED_RATIO));
    // ...and down it goes.
    expect(frames[fired + 5].state.fighters[1].y).toBeLessThan(0);
  });

  // Task 19 re-review N2: the 367 vector was read before the clamp, from a victim
  // the ASDI shift had put inside the floor (vy 1.374 in the reviewer's probe; 1.200
  // from where the clamp leaves it). An electric 367 box, live on the jab's first
  // frame, catches fighter 1 just above the floor; she holds down through the freeze.
  it("aims a 367 pull from where the clamp leaves the victim, not from inside the floor", () => {
    const ctx = jabbing(hitbox({ startFrame: 1, endFrame: 3, angle: fx(367), effect: "electric", damage: fx(2) }));
    const s = standing(ctx);
    Object.assign(s.fighters[1], { x: fx(12), y: fx(0.13), grounded: false, platform: -1, action: "fall" });
    const { frames, hit, fired } = jabbedWhile(s, ctx, (_v, i) => (i >= 1 ? Btn.Down : 0));
    const contact = frames[hit].state.fighters[1];
    expect(contact.grounded).toBe(false);
    expect(contact.y).toBeGreaterThan(0);
    expect(contact.y).toBeLessThan(ASDI_DISTANCE);
    const a = frames[hit].state.fighters[0];
    const box = frames[hit].events.hits[0];
    const v = frames[fired].state.fighters[1];
    // The shift down went into the floor, and the clamp put her back on its surface.
    expect(v.y).toBe(0);
    expect(v.kinetic.damageY).toBe(a.vy + byRatio(box.y - v.y, [1, 5]));
    expect(v.kinetic.damageY).not.toBe(a.vy + byRatio(box.y - (contact.y - ASDI_DISTANCE), [1, 5]));
  });

  // Task 19 re-review N3: the pull reads the victim where ASDI left her, as it does for SDI.
  it("aims a 367 pull from where ASDI moved the victim", () => {
    const ctx = jabbing(hitbox({ angle: fx(367), effect: "electric", damage: fx(2) }));
    const s = standing(ctx);
    Object.assign(s.fighters[1], { x: fx(12), y: fx(2), grounded: false, platform: -1, action: "fall" });
    const { frames, hit, fired } = jabbedWhile(s, ctx, (v) => (v.hitlag > 0 ? Btn.Right : 0));
    const contact = frames[hit].state.fighters[1];
    const a = frames[hit].state.fighters[0];
    const box = frames[hit].events.hits[0];
    const v = frames[fired].state.fighters[1];
    expect(v.x - contact.x).toBe(ASDI_DISTANCE);
    expect(v.kinetic.damageX).toBe(a.vx + byRatio(box.x - v.x, [1, 5]));
  });
});

describe("a tumbling launch into the floor bounces a grounded victim once, as it fires (final wave, part 2, item 2)", () => {
  /** A jab at 270° with 100 knockback (it tumbles) onto fighter 1 standing; her hitstun and every frame from the release. */
  const spiked = (over: Partial<Hitbox>) => {
    const ctx = jabbing(hitbox({ angle: fx(270), baseKnockback: fx(100), knockbackGrowth: 0, ...over }));
    const { frames, hit, fired } = jabbedWhile(standing(ctx), ctx, () => 0);
    return { hitstun: frames[hit].state.fighters[1].hitstun, after: frames.slice(fired).map((f) => f.state.fighters[1]) };
  };

  // The final review's Important 2: a downward box not marked a meteor (Donkey Kong's
  // legacy Headbutt) lifted the victim for a few frames and then bounced it, cutting
  // its hitstun by the mid-flight bounce's 0.8. The release bounce is floor physics,
  // Task 12's rule at release: 0.9 of the launch (`BOUNCE_FLOOR_LAUNCH_RATIO`) and the
  // hit's whole hitstun, whatever the box calls itself.
  it("bounces the victim of a 270° box that is not a meteor: 0.9 of the launch, the whole hitstun, once", () => {
    const { hitstun, after } = spiked({});
    expect(hitstun).toBe(effectiveHitstun(fx(100), true));
    const [fired] = after;
    expect(fired.launchSpeed).toBe(byRatio(mul(fx(100), LAUNCH_SPEED_RATIO), BOUNCE_FLOOR_LAUNCH_RATIO));
    expect(fired.kinetic.damageY).toBeGreaterThan(0);
    expect(fired.grounded).toBe(false);
    // Up and away from the release on: no lift along the floor first, no second bounce.
    expect(after.slice(1, 13).every((f) => !f.grounded && f.y > 0)).toBe(true);
    expect(after.slice(1, 13).every((f, i) => f.hitstun === after[i].hitstun - 1)).toBe(true);
  });

  it("is the very bounce a meteor takes", () => {
    const plain = spiked({}).after.slice(0, 13).map((f) => [f.x, f.y, f.vx, f.vy, f.hitstun]);
    const meteor = spiked({ meteor: true }).after.slice(0, 13).map((f) => [f.x, f.y, f.vx, f.vy, f.hitstun]);
    expect(plain).toEqual(meteor);
  });

  it("leaves the victim of a 270° box too weak to tumble on the ground: a flinch, not a bounce", () => {
    const { hitstun, after } = spiked({ baseKnockback: fx(40) });
    expect(after.slice(0, hitstun).every((f) => f.grounded && f.y === 0 && f.action === "hitstun")).toBe(true);
  });
});

describe("SDI and ASDI are the hit fighter's alone (final wave, part 2, item 3)", () => {
  /**
   * Fighter 0 jabs fighter 1 (who holds `shield`, if asked); `stick(f0, f1)` is the pair's direction
   * input on a frame. Returns every frame and the contact frame's index.
   */
  function exchange(
    stick: (attacker: FighterState, victim: FighterState) => readonly [InputFrame, InputFrame],
    shield: (i: number) => boolean = () => false,
    prepare: (s: GameState) => void = () => {},
  ): { frames: Frame[]; hit: number } {
    let s = standing();
    prepare(s);
    let prev: readonly InputFrame[] = [0, 0];
    const frames: Frame[] = [];
    for (let i = 0; i < 50; i++) {
      const [a, v] = stick(s.fighters[0], s.fighters[1]);
      const now = [(i === 0 ? Btn.Attack : 0) | a, (shield(i) ? Btn.Shield : 0) | v];
      const r = step(s, now, { prevInputs: prev, ctx: ctxFor() });
      frames.push(r);
      s = r.state;
      prev = now;
    }
    const hit = frames.findIndex((f) => f.events.hits.length + f.events.shieldHits.length > 0);
    expect(hit, "the jab connects").toBeGreaterThanOrEqual(0);
    return { frames, hit };
  }
  /** Fighter `port`'s x on every frame of its freeze from the contact frame on, the contact frame first. */
  const frozenX = (frames: Frame[], hit: number, port: number): number[] =>
    frames.slice(hit).filter((f, i) => i === 0 || frames[hit + i - 1].state.fighters[port].hitlag > 0).map((f) => f.state.fighters[port].x);
  /** Mash `dir` on every frame of `f`'s freeze an SDI pulse could fire on. */
  const pulseFrame = (f: FighterState): boolean => f.hitlag > 0 && f.hitlag % 4 === 0;

  // The final review's Important 3: SmashWiki "Smash directional influence"
  // (https://www.ssbwiki.com/Smash_directional_influence) lets players "slightly alter
  // their position during hitlag from being hit by an attack". An attacker's own freeze
  // is not that: it slid 6 units over a 12-frame jab freeze.
  it("does not move an attacker under the stick during its own hitlag", () => {
    const { frames, hit } = exchange((a) => [pulseFrame(a) ? Btn.Left : 0, 0]);
    expect(frames[hit].state.fighters[0].hitlag).toBeGreaterThan(4);
    const xs = frozenX(frames, hit, 0);
    expect(xs.length).toBeGreaterThan(4);
    expect(new Set(xs).size).toBe(1);
  });

  // A parry freezes the attacker 14 frames beyond the hit (Task 10): pulsing away through
  // it was about 6 more units out of the punish.
  it("does not move a parried attacker under the stick", () => {
    const parrySetup = (s: GameState): void => {
      s.fighters[1].action = "shield";
      s.fighters[1].actionFrame = 10;
    };
    const held = exchange(() => [0, 0], () => true, parrySetup);
    const k = held.hit;
    // Shield held to two frames before the hit, then let go: the jab lands in the parry window.
    const { frames, hit } = exchange((a) => [pulseFrame(a) ? Btn.Left : 0, 0], (i) => i < k - 2, parrySetup);
    expect(hit).toBe(k);
    expect(frames[hit].state.fighters[1].action).toBe("shieldRelease");
    expect(frames[hit].state.fighters[0].hitlag).toBeGreaterThan(14);
    const xs = frozenX(frames, hit, 0);
    expect(xs.length).toBeGreaterThan(14);
    expect(new Set(xs).size).toBe(1);
  });

  // The part-1/2 re-review's one test gap: `victimFreeze` is cleared when the freeze ends
  // (`step`, phase 3). Without that line a fighter hit earlier keeps the flag, and is
  // an SDI-er in its own *later* hitlag, as an attacker: drifting 8.11 -> 10.11 -> 12.11
  // over its jab's freeze (the re-review's probe), which this test would see as a move.
  it("does not let a fighter that was hit earlier SDI in its own later hitlag", () => {
    // Fighter 0 jabs fighter 1; run to the frame its launch has been released.
    const first = play(standing(), 30, JAB);
    const hit = first.findIndex((f) => f.events.hits.length > 0);
    const released = first.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
    expect(released, "the first freeze ends").toBeGreaterThan(hit);
    expect(first[released].state.fighters[1].combat.victimFreeze, "cleared with the freeze").toBe(false);
    // Stand them up again, fighter 1 now facing fighter 0 to jab it back, everything
    // else of fighter 1 as the sim left it.
    let s = cloneState(first[released].state);
    for (const f of s.fighters) {
      Object.assign(f, { action: "stand", actionFrame: 0, move: null, hitstun: 0, hitlag: 0, grounded: true, platform: 0, y: 0, intangible: 0, bufferedAction: null, hitThisMove: [], pendingFacing: 0 });
      kineticClear(f);
    }
    Object.assign(s.fighters[1], { x: 0, facing: 1 });
    Object.assign(s.fighters[0], { x: fx(8), facing: -1 });
    let prev: readonly InputFrame[] = [0, 0];
    const xs: number[] = [];
    let seenHitlag = 0;
    for (let i = 0; i < 40; i++) {
      const me = s.fighters[1];
      const now = [0, (i === 0 ? Btn.Attack : 0) | (me.hitlag > 0 && me.hitlag % 4 === 0 ? Btn.Left : 0)];
      const r = step(s, now, { prevInputs: prev, ctx: ctxFor() });
      s = r.state;
      prev = now;
      if (s.fighters[1].hitlag > 0) {
        seenHitlag += 1;
        xs.push(s.fighters[1].x);
      }
    }
    expect(seenHitlag, "its own jab freezes it").toBeGreaterThan(4);
    expect(new Set(xs).size).toBe(1);
  });

  it("still moves the fighter hit: one pulse of 2 units at a time", () => {
    let pulses = 0;
    const { frames, hit } = exchange((_a, v) => {
      if (!pulseFrame(v)) return [0, 0];
      pulses += 1;
      return [0, Btn.Right];
    });
    const xs = frozenX(frames, hit, 1);
    expect(pulses).toBeGreaterThan(1);
    expect(xs.at(-1)! - xs[0]).toBe(pulses * SDI_DISTANCE);
  });

  // "Shield SDI is a mechanic that allows players to move slightly when their shield is hit" (same page).
  it("still moves a shielding fighter whose shield was hit", () => {
    let pulses = 0;
    const { frames, hit } = exchange(
      (_a, v) => {
        if (!pulseFrame(v)) return [0, 0];
        pulses += 1;
        return [0, Btn.Right];
      },
      () => true,
    );
    expect(frames[hit].events.shieldHits).toHaveLength(1);
    const xs = frozenX(frames, hit, 1);
    expect(pulses).toBeGreaterThan(0);
    expect(xs.at(-1)! - xs[0]).toBe(pulses * SDI_DISTANCE);
  });
});

describe("a KO, a new shield break and a grab release leave nothing behind (final wave, part 2, item 4)", () => {
  // Codex P2-1 and the final review's Minor 6: a KO kept `mash` (it shortened the next
  // shield-break stun by a frame after the respawn), `launchSource` and `swingQueued`.
  it("clears the mash credit, the launch source and the queued swing on a KO", () => {
    const s = standing();
    const v = s.fighters[1];
    Object.assign(v, { action: "shieldBroken", hitstun: 100, shieldHealth: 0, y: fx(-200), grounded: false, platform: -1 });
    v.combat.mash = 8;
    v.combat.launchSource = 0;
    v.combat.swingQueued = true;
    const [ko] = play(s, 1, () => [0, 0]);
    expect(ko.events.kos.map((k) => k.port)).toEqual([1]);
    expect(ko.state.fighters[1].combat).toMatchObject({ mash: 0, launchSource: -1, swingQueued: false });
  });

  /** One button press's worth of shield-break stun, for a fighter whose shield breaks with `mash` tenths left over. */
  const firstPressAfterBreak = (mash: number): { mash: number; earned: number } => {
    const s = standing();
    const v = s.fighters[1];
    Object.assign(v, { action: "shield", actionFrame: 10, shieldHealth: 1 });
    v.combat.mash = mash;
    const frames = play(s, 3, (i) => [0, i === 0 ? Btn.Shield : i === 2 ? Btn.Attack : 0]);
    const broken = frames[0].state.fighters[1];
    expect(broken.action).toBe("shieldBroken");
    return { mash: broken.combat.mash, earned: frames[1].state.fighters[1].hitstun - 1 - frames[2].state.fighters[1].hitstun };
  };

  // Task 9's minor: a new break starts its mash at zero, whatever an earlier struggle left.
  it("starts a new shield break's mash at zero", () => {
    expect(firstPressAfterBreak(8)).toEqual({ mash: 0, earned: 5 });
    expect(firstPressAfterBreak(0)).toEqual({ mash: 0, earned: 5 });
  });

  // ...and a grab's mash goes with the grab, however it ends: here a throw's hit.
  it("clears the held fighter's mash credit when the grab is let go", () => {
    const thrower: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, fthrow: move("fthrow", { totalFrames: 20, hitboxes: [hitbox({ startFrame: 2, endFrame: 3 })] }) },
    };
    const ctx = ctxFor(thrower);
    const s = standing(ctx);
    const [a, v] = s.fighters;
    Object.assign(a, { action: "grabHold", grabbing: 1 });
    Object.assign(v, { action: "grabbed", actionFrame: 30, grabbedBy: 0, grabTimer: 400 });
    v.combat.mash = 7;
    const frames = play(s, 8, (i) => [i === 0 ? Btn.Right : 0, 0], ctx);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    expect(hit).toBeGreaterThan(0);
    expect(frames[hit - 1].state.fighters[1].combat.mash).toBe(7);
    expect(frames[hit].state.fighters[1]).toMatchObject({ grabbedBy: -1, combat: expect.objectContaining({ mash: 0 }) });
  });
});

describe("mashing out of a shield break (final wave, part 2, item 5)", () => {
  /** Fighter 1 broken with 100 frames of stun, playing `inputs`; its stun after `n` frames. */
  const stunAfter = (n: number, inputs: (i: number) => InputFrame): number => {
    const s = standing();
    Object.assign(s.fighters[1], { action: "shieldBroken", hitstun: 100, shieldHealth: 0 });
    return play(s, n, (i) => [0, inputs(i)]).at(-1)!.state.fighters[1].hitstun;
  };

  // The Task 9 review's minor: a held Up counted as a stick input, then again as a
  // jump press when tap jump fired, `TAP_JUMP_FRAMES` later: 3 + 5.4 frames. It is one
  // stick input, 3 frames (SmashWiki "Stun"); only the jump button counts as a button.
  it("counts a held Up once, as the stick input it is, not again through tap jump", () => {
    const still = stunAfter(10, () => 0);
    expect(still - stunAfter(10, () => Btn.Up)).toBe(3);
    // A real jump press is a button: 5.4 frames.
    expect(still - stunAfter(10, (i) => (i === 0 ? Btn.Jump : 0))).toBe(5);
  });

  // SmashWiki "Shield break" (https://www.ssbwiki.com/Shield_break): "Any attack that
  // causes a stunned fighter to flinch ends the stunned state", and after it "the
  // shield is reset to ... 75% in Ultimate". UNVERIFIED: that a stun ended early by a
  // hit resets the shield too (the page does not say); the replica resets it whenever
  // the stunned state ends.
  it("brings the shield back at 37.5 when a hit ends the stun early", () => {
    const s = standing();
    Object.assign(s.fighters[1], { action: "shieldBroken", hitstun: 200, shieldHealth: 0 });
    const frames = play(s, 8, JAB);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    expect(hit).toBeGreaterThan(0);
    const v = frames[hit].state.fighters[1];
    expect(v.action).not.toBe("shieldBroken");
    expect(v.shieldHealth).toBe(SHIELD_BREAK_RESET + SHIELD_REGEN_PER_FRAME);
  });
});

describe("a hitlag multiplier below 1x counts as 1x on a shield (final wave, part 2, item 6)", () => {
  // SmashWiki "Hitlag" (https://www.ssbwiki.com/Hitlag): "Hitlag multipliers less than 1×
  // are ignored if shielding", as with Cloud's Limit Cross Slash (0.3×), whose "hits
  // transition considerably slower if it hits a shield". The Task 10 review's carry.
  const quick = jabbing(hitbox({ hitlagMultiplier: fx(0.3) }));
  const JAB_DAMAGE = mul(fx(10), STALE_FRESH_BONUS);
  const freezes = (inputs: (i: number) => readonly InputFrame[]): [number, number] => {
    const frames = play(standing(quick), 10, inputs, quick);
    const at = frames.find((f) => f.events.hits.length + f.events.shieldHits.length > 0)!;
    return [at.state.fighters[0].hitlag, at.state.fighters[1].hitlag];
  };

  it("freezes both fighters a shield hit's whole hitlag", () => {
    const lag = computeHitlag(JAB_DAMAGE, { shielding: true });
    expect(freezes(JAB_INTO_SHIELD)).toEqual([lag, lag]);
  });

  it("keeps the 0.3x on a hit to the body", () => {
    const lag = computeHitlag(JAB_DAMAGE, { moveMultiplier: fx(0.3) });
    expect(lag).toBeLessThan(computeHitlag(JAB_DAMAGE, { shielding: true }));
    expect(freezes(JAB)).toEqual([lag, lag]);
  });
});

describe("the smaller engine items (final wave, part 2, item 7)", () => {
  // SmashWiki "Smash directional influence" (https://www.ssbwiki.com/Smash_directional_influence):
  // Smash 4's ASDI is "1.33 units with ASDI (down from 3)", and Ultimate's "SDI retains its
  // shorter distance from Smash 4". UNVERIFIED: Ultimate's exact ASDI distance (Task 11 ruling).
  it("shifts 1.33 units on an automatic SDI", () => {
    expect(ASDI_DISTANCE).toBe(fx(1.33));
    expect(ASDI_DISTANCE).toBe(5448);
  });

  // The Task 7 review's minor. SmashWiki "Air dodge": once "until they land, get hit, or grab a
  // ledge". UNVERIFIED: that a hit armour takes is not "get hit": it does not take the launch.
  it("gives the air dodge back for a hit that launches, not for one armour takes", () => {
    const aloftIn = (action: ActionState, slot: MoveDef["slot"] | null) => {
      const s = standing();
      Object.assign(s.fighters[1], { action, move: slot, actionFrame: 2, y: fx(2), grounded: false, platform: -1, airDodged: true, jumpsUsed: 1 });
      const hit = play(s, 8, JAB).find((f) => f.events.hits.length > 0)!;
      return { knockback: hit.events.hits[0].knockback, airDodged: hit.state.fighters[1].airDodged };
    };
    // Down special is armoured on its frames 1-30 (`BASE_DEF`).
    expect(aloftIn("special", "downB")).toEqual({ knockback: 0, airDodged: true });
    const launched = aloftIn("fall", null);
    expect(launched.knockback).toBeGreaterThan(0);
    expect(launched.airDodged).toBe(false);
  });

  /** The hit event's direction is along `x`, `y`: their cross product with its unit vector is ~0, the dot positive. */
  const along = (angle: number, x: number, y: number): void => {
    expect(Math.abs(x * sinDeg(angle) - y * cosDeg(angle)) / Math.hypot(x, y)).toBeLessThan(0.0025 * ONE);
    expect(x * cosDeg(angle) + y * sinDeg(angle)).toBeGreaterThan(0);
  };

  // The Task 8 review's minor: a hit that keeps the launch it meets reported angle 0.
  describe("a kept launch's hit reports the way the kept launch goes", () => {
    /**
     * Three fighters: 0 far away, 1 the victim, 2 jabs it from x 0 on its first frame with a
     * set 60 knockback (a launch of 1.8): between 0.5 and 0.9 of the victim's own, so it keeps it.
     */
    const three = (prepare: (v: FighterState) => void) => {
      const quick: FighterDef = {
        ...BASE_DEF,
        moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ startFrame: 1, radius: fx(10), baseKnockback: fx(60), knockbackGrowth: 0 })] }) },
      };
      const ctx = ctxFor(quick);
      const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
      [{ x: fx(-60), facing: 1 }, { x: fx(8), facing: -1 }, { x: 0, facing: 1 }].forEach((place, i) => {
        Object.assign(s.fighters[i], place, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0 });
      });
      const v = s.fighters[1];
      v.combat.launchSource = 0;
      prepare(v);
      const frames = play(s, 4, (i) => [0, 0, i === 0 ? Btn.Attack : 0], ctx);
      return frames[frames.findIndex((f) => f.events.hits.length > 0)];
    };

    it("for a launch in flight: along its vector, turned by the hit", () => {
      const hit = three((v) => {
        Object.assign(v, { grounded: false, platform: -1, y: fx(1), action: "tumble", hitstun: 50 });
        v.kinetic.damageX = -fx(1.5);
        v.kinetic.damageY = fx(2.6);
        v.launchSpeed = fx(3);
        v.vx = -fx(1.5);
        v.vy = fx(2.6);
      });
      expect(hit.events.hits[0].knockback).toBeGreaterThan(0);
      const k = hit.state.fighters[1].kinetic;
      along(hit.events.hits[0].angle, k.damageX, k.damageY);
    });

    it("for a launch still parked in the freeze: its own angle, as its hit reported it", () => {
      const hit = three((v) => {
        Object.assign(v, { action: "tumble", hitstun: 50, hitlag: 6, pendingKnockback: fx(70), pendingAngle: fx(80), pendingFacing: -1 });
      });
      expect(hit.events.hits[0].knockback).toBeGreaterThan(0);
      expect(hit.state.fighters[1].pendingAngle).toBe(fx(80));
      expect(hit.events.hits[0].angle).toBe(fx(100));
    });
  });

  // Task 19 re-review N1: the midpoint of a capsule whose extent is an odd number of Q12
  // units was 1 unit apart for its two orders (`c.x + trunc(dx / 2)`).
  it("pulls a 367 victim toward the same capsule centre whichever end comes first, for an odd extent", () => {
    const capsule = (y: number, z: number, y2: number, z2: number) => {
      const ctx = ctxFor({
        ...BASE_DEF,
        scripts: {
          jab1: {
            name: "game_attack11",
            motion: "attack_11",
            commands: [frame(4), ATTACK({ id: 0, bone: "top", damage: 2, angle: 367, kbg: 100, bkb: 40, size: 5, x: 0, y, z, y2, z2, x2: 0 }), frame(7), clearAll()],
          },
        },
      });
      const s = standing(ctx);
      Object.assign(s.fighters[1], { x: fx(12), y: fx(2), grounded: false, platform: -1, action: "fall" });
      const frames = play(s, 30, JAB, ctx);
      return frames[frames.findIndex((f) => f.events.hits.length > 0)];
    };
    // One Q12 unit past 14 forward (script Z is forward), so the horizontal extent is odd.
    const odd = 14 + 1 / ONE;
    const near = capsule(2, 2, 10, odd);
    const far = capsule(10, odd, 2, 2);
    expect((far.events.hits[0].x - near.events.hits[0].x) % 2).not.toBe(0);
    const at = (h: Frame) => [h.state.fighters[1].combat.autolinkPointX, h.state.fighters[1].combat.autolinkPointY];
    expect(at(far)).toEqual(at(near));
  });

  // The final review's Minor 3: a hit that launches a short hop's fighter ends the hop,
  // so an aerial out of the hitstun (Task 7) deals 1x, not the short hop's 0.85x. The
  // hop ends as the launch fires: on the contact frame it is still the hop, so an aerial
  // of the victim's own that trades with the hit keeps its 0.85x whatever the port order.
  it("ends a short hop when the launch fires, as the hit ends a fast fall", () => {
    const s = standing();
    Object.assign(s.fighters[1], { action: "fall", y: fx(2), grounded: false, platform: -1, shortHop: true, fastFalling: true, jumpsUsed: 1 });
    const frames = play(s, 30, JAB);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    const fired = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
    expect(frames[hit].state.fighters[1]).toMatchObject({ shortHop: true, fastFalling: false });
    expect(frames[fired].state.fighters[1].shortHop).toBe(false);
  });
});

/**
 * Plan 3 final wave, part 2, item 8 (part 1's report, concern 5). A press made on
 * any frame of a status, its last included, either acts on the first actionable
 * frame or waits in the buffer (Ultimate's 9 frames). Earlier presses always did;
 * one made on the very last frame of a status entered on contact (a landing, a
 * hit, a tech) was lost: that frame changes status without buffering, and on the
 * next the key is held, not pressed.
 */
describe("a press on a status's last frame is not lost (final wave, part 2, item 8)", () => {
  /** Fighter 0 standing at x 0, fighter 1 parked at x -60, out of every reach. */
  const apart = (): GameState => {
    const s = standing();
    s.fighters[1].x = fx(-60);
    s.fighters[1].facing = 1;
    return s;
  };
  const actionsOf = (frames: Frame[], port = 0): ActionState[] => frames.map((f) => f.state.fighters[port].action);

  // Landing lag 8 (the tester's nair) is frames 1-8 after the landing, and the fighter
  // acts on the 9th (SmashWiki "Lag", https://www.ssbwiki.com/Lag).
  it("takes a jump pressed on the last frame of landing lag on the first frame after it", () => {
    const fallingNair = () => {
      const s = apart();
      Object.assign(s.fighters[0], { y: fx(3), grounded: false, platform: -1, action: "fall", jumpsUsed: 1 });
      return s;
    };
    const dry = actionsOf(play(fallingNair(), 20, (i) => [i === 0 ? Btn.Attack : 0, 0]));
    const landed = dry.indexOf("landingLag");
    const a = actionsOf(play(fallingNair(), landed + 11, (i) => [i === 0 ? Btn.Attack : i === landed + 8 ? Btn.Jump : 0, 0]));
    expect(a[landed + 7], "lag frame 7").toBe("landingLag");
    expect(a[landed + 9], "the 9th frame after the landing").toBe("jumpSquat");
  });

  // Hitstun H is the H frames after the freeze; the fighter acts on the (H + 1)th
  // (rubendal SSBU-Calculator, https://github.com/rubendal/SSBU-Calculator).
  it("takes an attack pressed on the last frame of hitstun on the first frame after it", () => {
    const flat = jabbing(hitbox({ angle: 0, baseKnockback: fx(20), knockbackGrowth: 0 }));
    const dry = play(standing(flat), 40, JAB, flat);
    const hit = dry.findIndex((f) => f.events.hits.length > 0);
    const stun = dry[hit].state.fighters[1].hitstun;
    const first = dry.findIndex((f, i) => i > hit && f.state.fighters[1].actionFrame === 1);
    const last = first + stun - 1;
    const frames = play(standing(flat), last + 3, (i) => [i === 0 ? Btn.Attack : 0, i === last ? Btn.Attack : 0], flat);
    const a = actionsOf(frames, 1);
    expect(a[last - 1]).toBe("hitstun");
    expect(a[last + 1], "the (H + 1)th frame after the freeze").toBe("attack");
  });

  // Shieldstun S, the same way (rubendal SSBU-Calculator).
  it("takes a jump out of shield pressed on the last frame of shieldstun on the first frame after it", () => {
    const dry = play(standing(), 40, JAB_INTO_SHIELD);
    const hit = dry.findIndex((f) => f.events.shieldHits.length > 0);
    const stun = dry[hit].state.fighters[1].hitstun;
    const first = dry.findIndex((f, i) => i > hit && f.state.fighters[1].actionFrame === 1);
    const last = first + stun - 1;
    const frames = play(standing(), last + 3, (i) => [i === 0 ? Btn.Attack : 0, i === last ? Btn.Shield | Btn.Jump : Btn.Shield]);
    const a = actionsOf(frames, 1);
    expect(a[last - 1]).toBe("shieldStun");
    expect(a[last + 1]).toBe("jumpSquat");
  });

  // A tech in place is 26 frames after the landing, first actionable 27 (SmashWiki
  // "Lucario (SSBU)/Techs", `TECH_FRAMES`).
  it("takes a jump pressed on the last frame of a tech in place on the first frame after it", () => {
    const flying = () => {
      const s = apart();
      const v = s.fighters[1];
      Object.assign(v, { x: 0, y: fx(6), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60 });
      s.fighters[0].x = fx(60);
      v.kinetic.damageY = fx(-2);
      v.launchSpeed = fx(2);
      v.vy = fx(-2);
      return s;
    };
    const teched = actionsOf(play(flying(), 10, (i) => [0, i === 0 ? Btn.Shield : 0]), 1).indexOf("tech");
    const last = teched + TECH_FRAMES;
    const a = actionsOf(play(flying(), last + 3, (i) => [0, i === 0 ? Btn.Shield : i === last ? Btn.Jump : 0]), 1);
    expect(a[last - 1]).toBe("tech");
    expect(a[last + 1]).toBe("jumpSquat");
  });

  // A wall tech is free to act from `TECH_WALL_INTERRUPT` (6) on, its last frame (26)
  // included, so a press there acts at once: here the air jump.
  it("takes a jump pressed on the last frame of a wall tech, on that frame", () => {
    const flying = () => {
      const s = apart();
      const v = s.fighters[1];
      Object.assign(v, { x: fx(92), y: fx(-20), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60, jumpsUsed: 1 });
      s.fighters[0].x = fx(-70);
      v.kinetic.damageX = fx(-4);
      v.launchSpeed = fx(4);
      v.vx = fx(-4);
      return s;
    };
    const teched = actionsOf(play(flying(), 10, (i) => [0, i === 0 ? Btn.Shield : 0]), 1).indexOf("techWall");
    expect(teched).toBeGreaterThan(0);
    const last = teched + TECH_WALL_FRAMES;
    const a = actionsOf(play(flying(), last + 2, (i) => [0, i === 0 ? Btn.Shield : i === last ? Btn.Jump : 0]), 1);
    expect(a[last - 1]).toBe("techWall");
    expect(a[last]).toBe("jump");
  });

  // A status the fighter enters itself already took it: its last frame buffers, and the
  // hand-off frame reads input (part 1). Pinned, with the 24-frame jab and the 11-frame
  // shield drop (UFD, https://ultimateframedata.com/mario, "Shield Drop — 11 frames").
  it("takes a jump pressed on a jab's last frame on the frame after it", () => {
    const a = actionsOf(play(apart(), 26, (i) => [i === 0 ? Btn.Attack : i === 23 ? Btn.Jump : 0, 0]));
    expect(a[23], "the jab's frame 24").toBe("attack");
    expect(a[24], "frame 25").toBe("jumpSquat");
  });

  it("takes a jump pressed on the shield drop's last frame on the frame after it", () => {
    // Shield held for 6 frames, let go on the 7th (index 6): the drop's frames 1-11 are indices 6-16.
    const a = actionsOf(play(apart(), 20, (i) => [i < 6 ? Btn.Shield : i === 16 ? Btn.Jump : 0, 0]));
    expect(a[16], "the drop's frame 11").toBe("shieldRelease");
    expect(a[17], "its frame 12").toBe("jumpSquat");
  });
});
