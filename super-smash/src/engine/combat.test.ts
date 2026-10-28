import { describe, expect, it } from "vitest";

import { ONE, byRatio, fx, mul } from "./fixed";
import {
  ASDI_DISTANCE,
  FURAFURA_END_FRAMES,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_DISTANCE,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
} from "./constants";
import { hashState } from "./hash";
import {
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  damageSpeedUpMaxMag,
  effectiveHitstun,
  shieldstunExact,
} from "./knockback";
import { attackerShieldPushback, shieldDamage, shieldPushback } from "./shield";
import { cloneState, createInitialState, step } from "./simulate";
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
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: fx(60), setKnockback: true })] }) },
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
  // leaves at 0.8 of the launch speed.
  it("slides a grounded victim along 0° at 0.8 of the launch speed", () => {
    const grounded = launchOf(false);
    const airborne = launchOf(true);
    expect(airborne.speed).toBe(mul(airborne.kb, LAUNCH_SPEED_RATIO));
    expect(grounded.speed).toBe(mul(byRatio(grounded.kb, GROUNDED_ZERO_LAUNCH_RATIO), LAUNCH_SPEED_RATIO));
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

  it("bends a tumbling launch", () => {
    const none = launchAfter(150, 0);
    const bent = launchAfter(150, Btn.Down);
    expect(bent.vy).toBeLessThan(none.vy);
  });
  // LSI is computed inside `di_able` too: a tumbling launch straight ahead keeps its speed.
  it("does not scale a tumbling launch straight ahead with LSI", () => {
    const flat: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: fx(100), setKnockback: true })] }) },
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
   */
  const setKb = hitbox({ angle: fx(5), baseKnockback: fx(150), setKnockback: true });
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

  it("holds a tumbling victim in hitstun for the sped-up time, not the base", () => {
    const c = contact(growthDef);
    expect(c.hitstun).toBe(effectiveHitstun(c.knockback, true));
    expect(c.hitstun).toBeLessThan(computeHitstun(c.knockback));
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

  // 32 reaction frames start the speed-up at 1.2× (`damageSpeedUpMaxMag`,
  // rubendal `InitDamageSpeedUp`): too little to save a real frame here, but armed.
  it("tumbles at 82.4 knockback, with the balloon speed-up applied", () => {
    const h = hitAt(82.4);
    expect(h.knockback).toBe(fx(82.4));
    expect(h.action).toBe("tumble");
    expect(h.launchFaf).toBe(32);
    expect(h.hitstun).toBe(effectiveHitstun(h.knockback, true));
    expect(h.speedUpMax).toBe(damageSpeedUpMaxMag(32));
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

  // SmashWiki "Hitstun canceling" (https://www.ssbwiki.com/Hitstun_canceling):
  // air dodge after frame 40 if launch speed is below 2.5; aerial after frame 45
  // below 2. rubendal `parameters.hitstunCancel` agrees (frames 40/45, speeds 2.5/2).
  it("air dodges out of hitstun from frame 41 when the launch is slower than 2.5", () => {
    const after = play(tumbling(40, fx(2.4)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1];
    expect(after.action).toBe("airDodge");
    expect(after.hitstun).toBe(0);
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
  function stacked(
    ratio: number,
    sameSource = false,
    hitstun = 50,
  ): { victim: GameState["fighters"][number]; untouched: number } {
    const fresh = (): GameState => {
      const s = createInitialState(
        "flat",
        [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }],
        RULES,
        12345,
        ctx,
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
    };
    const jab = (i: number): readonly InputFrame[] => [0, 0, i === 0 ? Btn.Attack : 0];
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
    // What the first launch's hitstun reads on the hit frame if nothing touched it.
    return { victim: frames[hit].state.fighters[1], untouched: 50 - (hit + 1) };
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
    const { victim } = stacked(0.7);
    const k = victim.kinetic;
    // Straight up, plus the jab's 45° to the right: now up and to the right.
    expect(k.damageX).toBeGreaterThan(0);
    expect(k.damageY).toBeGreaterThan(k.damageX);
    expect(Math.abs(Math.hypot(k.damageX, k.damageY) - victim.launchSpeed)).toBeLessThan(3);
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

  // Review Focus #4: a multi-hit move is one source, so each of its hits takes
  // over from the last, however weak — it never "stacks" with itself.
  it("never stacks a source with itself: a multi-hit's every hit takes over", () => {
    const { victim } = stacked(0.4, true);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.combat.launchSource).toBe(2);
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
      v.hitlag = 6;
      const after = released(s);
      expect(after.combat.launchSource).toBe(0);
      expect(after.launchSpeed).toBe(jabAlone);
      expect(after.kinetic.speedUpMax).toBe(0);
      expect(after.combat.launchFaf).toBe(0);
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
});

/* ------------------------------------------- Task 10: perfect shield -- */

describe("perfect shield (Plan 3, Task 10)", () => {
  /**
   * Fighter 0 attacks with `attack`; fighter 1 shields and lets go so that the
   * hit lands on frame 2 of the drop — inside the 5-frame parry window.
   */
  function parried(def: FighterDef, attack: (i: number) => InputFrame, gap: number): Frame {
    const ctx = ctxFor(def);
    const setup = (): GameState => {
      const s = standing(ctx);
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

  it("freezes a direct melee attacker 14 frames and the defender 11 beyond the hit", () => {
    const at = parried(BASE_DEF, (i) => (i === 0 ? Btn.Attack : 0), 8);
    const [attacker, defender] = at.state.fighters;
    expect(defender.action).toBe("shieldRelease");
    expect(at.events.shieldHits).toHaveLength(1);
    expect(attacker.hitlag).toBe(JAB_LAG + 14);
    expect(defender.hitlag).toBe(JAB_LAG + 11);
    // 0.15 of a normal shield's pushback, away from the attacker.
    expect(defender.vx).toBe(byRatio(shieldPushback(shieldstunExact(JAB_DMG)), PERFECT_SHIELD_PUSHBACK_RATIO));
    expect(defender.shieldHealth).toBe(SHIELD_MAX_HEALTH);
  });

  // Review Focus #2: a parried projectile freezes nobody far away and costs the
  // defender a frame, not eleven.
  it("parries a projectile without freezing its thrower, 1 frame short for the defender", () => {
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
    const at = parried(shooter, (i) => (i === 0 ? Btn.Special : 0), 40);
    const [owner, defender] = at.state.fighters;
    const pelletLag = computeHitlag(fx(6), { shielding: true });
    expect(at.events.shieldHits).toHaveLength(1);
    expect(owner.hitlag).toBe(0);
    expect(defender.hitlag).toBe(pelletLag - 1);
  });
});

/* --------------------------------------------- Task 11: SDI and ASDI -- */

describe("SDI and ASDI (Plan 3, Task 11)", () => {
  /** Fighter 1 frozen in hitlag with `hits` consecutive hits taken, pulsing SDI right. */
  function pulse(hits: number): number {
    const s = standing();
    const v = s.fighters[1];
    v.action = "hitstun";
    v.hitstun = 20;
    v.hitlag = 4;
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
