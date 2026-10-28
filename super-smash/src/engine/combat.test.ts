import { describe, expect, it } from "vitest";

import { ONE, byRatio, fx, mul } from "./fixed";
import { GROUNDED_ZERO_LAUNCH_RATIO, LAUNCH_SPEED_RATIO } from "./constants";
import { hashState } from "./hash";
import { computeHitstun, damageSpeedUpMaxMag, effectiveHitstun } from "./knockback";
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
