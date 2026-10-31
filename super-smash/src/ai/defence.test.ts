/**
 * The CPU's Plan 5 defence (Task 18): tech the landing, air-dodge out of
 * hitstun when Plan 3's cancel allows it, and parry by letting go of the
 * shield as a swing's hit arrives. Pure functions of their context, gated by
 * the level's dials like every other behaviour.
 *
 * Fix round 1 (rulings R-T18d to R-T18f): each dial is the chance of one
 * decision, made on one frame (a landing, a cancel's opening, a swing), and the
 * parry is timed off the swing's own move data. So the plan's tests that put a
 * fighter anywhere in a press band, or a shield raised on frame 0, are staged on
 * the decision frame here, against the engine's own fall and the engine's own
 * shield: their claims are the plan's.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_AIR_DODGE } from "@/engine/airDodge";
import { emptyCombat } from "@/engine/combat";
import {
  AIR_DODGE_TECH_FRAMES,
  GLANCING_BLOW_DEPTH,
  TUMBLE_HITSTUN,
  HITSTUN_CANCEL_AIR_DODGE_FRAME,
  HITSTUN_CANCEL_AIR_DODGE_SPEED,
  LAUNCH_SPEED_DECAY,
  SHIELD_MIN_HOLD,
  TECH_LOCKOUT,
  TECH_WINDOW,
} from "@/engine/constants";
import { fx, nextRandom } from "@/engine/fixed";
import { actionFrameOf, capsulesOverlap, deepestReach, hitboxWorldPos, hurtboxCapsule } from "@/engine/hitbox";
import { shieldBubble } from "@/engine/shield";
import { kineticLaunch, kineticSum } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { WALL_TECH_JUMP_FRAMES } from "@/engine/wallJump";
import { platformCentreX } from "@/engine/physics";
import { Btn, held, type FighterDef, type FighterState, type GameState, type Hitbox, type InputFrame, type MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter, makeState } from "@/render/testFixtures";
import {
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  MELEE_RANGE,
  PARRY_AIM,
  ROLL_PARRY,
  ROLL_RECOVER,
  ROLL_SHIELD,
  ROLL_SPECIAL,
  ROLL_TECH,
  TECH_HOLD,
  TECH_LEAD,
  escape,
  floorBounced,
  floorHold,
  framesToFloor,
  framesToWall,
  observe,
  parry,
  recover,
  shield,
  stageViewFromDef,
  swingHitFrame,
  tech,
  type BehaviourContext,
  type LevelTuning,
  type StageView,
} from "./behaviours";
import { BEHAVIOURS, MAX_LEVEL, cpuInput, cpuWorldFromDef, decideCpu, tuningForLevel } from "./cpu";

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

const defOf = (id: string): FighterDef => FIGHTERS.find((f) => f.id === id)!;
const stageOf = (id: string) => STAGES.find((s) => s.id === id)!;
const FD = stageViewFromDef(stageOf("finalDestination"));
const BF = stageViewFromDef(stageOf("battlefield"));

function context(
  state: GameState,
  tuning: LevelTuning,
  rolls: number[] = new Array(DECISION_ROLLS).fill(0),
  stage: StageView = DEFAULT_STAGE_VIEW,
): BehaviourContext {
  const defs = state.fighters.map((f) => defOf(f.defId));
  return {
    state,
    view: observe(state, 0, tuning.reactionFrames),
    stage,
    tuning,
    jumps: 1,
    meleeReach: MELEE_RANGE,
    airBrake: 0,
    airDodge: DEFAULT_AIR_DODGE,
    recovery: null,
    fighterDef: defs[0],
    matchDefs: defs,
    rolls,
  };
}

const L9 = tuningForLevel(9);
const L1 = tuningForLevel(1);
const rollsWith = (slot: number, value: number): number[] => {
  const rolls = new Array<number>(DECISION_ROLLS).fill(0);
  rolls[slot] = value;
  return rolls;
};

/* ------------------------------------------------- real falls, as the engine runs them -- */

const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;

/**
 * Mario (port 0) tumbling on `stage` from (x, y), launched along (vx, vy) at a
 * speed under a floor bounce's 0.8, so a missed tech lies him down; Fox stands
 * well away. `hitstun` to go, `actionFrame` into the reel, its gravity as that
 * many frames of the reel built it: a tumble's gravity is zeroed only at its
 * launch (frame 0) or where it meets a floor (`floorBounced`; ruling R-T18h).
 */
function tumbling(x: number, y: number, o: { stage?: string; vx?: number; vy?: number; hitstun?: number; actionFrame?: number } = {}): GameState {
  const s = createInitialState(o.stage ?? "finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 21);
  Object.assign(s.fighters[0], { action: "tumble", actionFrame: o.actionFrame ?? 0, grounded: false, platform: -1, x: fx(x), y: fx(y), hitstun: o.hitstun ?? 60, intangible: 0, invincible: 0 });
  const vx = fx(o.vx ?? 0);
  const vy = fx(o.vy ?? -0.5);
  kineticLaunch(s.fighters[0], vx, vy, Math.abs(vx) + Math.abs(vy));
  const p = fighterParams(defOf("mario"));
  s.fighters[0].kinetic.gravityY = -Math.min(p.air_speed_y_stable, (o.actionFrame ?? 0) * p.air_accel_y);
  kineticSum(s.fighters[0]);
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(-60), y: stageOf(o.stage ?? "finalDestination").platforms[0].y, intangible: 0 });
  return s;
}

/**
 * Mario falling after a tumble's hitstun (`tumbleFall`), at his fall speed: a
 * tumble's own fall reaches it before its hitstun runs out (`floorBounced`).
 */
function fallingAfter(x: number, y: number, stage = "finalDestination"): GameState {
  const s = tumbling(x, y, { stage, hitstun: 0 });
  Object.assign(s.fighters[0], { action: "tumbleFall", actionFrame: 1, hitstun: 0 });
  kineticLaunch(s.fighters[0], 0, 0, 0);
  s.fighters[0].kinetic.gravityY = -fighterParams(defOf("mario")).air_speed_y_stable;
  kineticSum(s.fighters[0]);
  return s;
}

const quiet = (s: GameState): GameState => step(s, [0, 0], { prevInputs: [0, 0] }).state;

/** A press of `tech`'s: its decision, made (a hold is not one; ruling R-T18i). */
const presses = (r: { readonly score: number; readonly input: InputFrame }): boolean => r.score > 0 && held(r.input, Btn.Shield);

/** Steps, with nothing pressed, until Mario stands on something: the engine's own answer. */
function landsIn(s: GameState): number {
  for (let k = 1; k <= 300; k++) {
    s = quiet(s);
    if (s.fighters[0].grounded) return k;
  }
  return -1;
}

/**
 * Every frame of the approach on which `tech` presses, as the engine's frames to
 * the floor then. The stick it holds is held (ruling R-T18i); its press is not,
 * so a passing roll's decision is seen and the landing still comes.
 */
function decisionsOver(s: GameState, ctx: (s: GameState) => BehaviourContext): number[] {
  const out: number[] = [];
  let prev: InputFrame = 0;
  while (!s.fighters[0].grounded) {
    const r = tech(ctx(s));
    if (presses(r)) out.push(landsIn(s));
    const stick = r.score > 0 ? r.input & ~Btn.Shield : 0;
    s = step(s, [stick, 0], { prevInputs: [prev, 0] }).state;
    prev = stick;
  }
  return out;
}

/** As `decisionsOver`, with each decided press applied: what the CPU's own presses make of the approach. */
function decisionsPressing(s: GameState, ctx: (s: GameState) => BehaviourContext): number[] {
  const out: number[] = [];
  let prev: InputFrame = 0;
  while (!s.fighters[0].grounded) {
    const r = tech(ctx(s));
    if (presses(r)) out.push(landsIn(s));
    const input = r.score > 0 ? r.input : 0;
    s = step(s, [input, 0], { prevInputs: [prev, 0] }).state;
    prev = input;
  }
  return out;
}

/** The state of an approach on the frame the engine has Mario `n` steps from the floor. */
function atLandsIn(s: GameState, n: number): GameState {
  for (let i = 0; i < 300; i++) {
    const k = landsIn(s);
    if (k === n) return s;
    if (k < n) throw new Error(`the approach starts ${k} from the floor, inside ${n}`);
    s = quiet(s);
  }
  throw new Error("never landed");
}

/* --------------------------------------------------------------------- tech -- */

describe("tech", () => {
  // The plan's three, on the frame the decision is made (ruling R-T18e).
  it("presses shield toward the middle just before a tumble lands", () => {
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    const r = tech(context(s, L9, undefined, FD));
    expect(r.score).toBeGreaterThan(1000);
    expect(held(r.input, Btn.Shield)).toBe(true);
    expect(held(r.input, Btn.Left)).toBe(true);
    expect(r.decided).toBe(true);
  });

  it("does not, while the floor is still far off: it only holds the stick from TECH_HOLD out (ruling R-T18i)", () => {
    for (let n = TECH_LEAD + 1; n <= TECH_HOLD; n++) {
      const r = tech(context(atLandsIn(tumbling(20, 40), n), L9, undefined, FD));
      expect([presses(r), r.decided, r.input], `${n} out`).toEqual([false, true, Btn.Left]);
    }
    expect(tech(context(atLandsIn(tumbling(20, 40), TECH_HOLD + 1), L9, undefined, FD)).score).toBe(0);
    expect(tech(context(tumbling(20, 60, { actionFrame: 5 }), L9, undefined, FD)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    expect(presses(tech(context(s, L1, undefined, FD)))).toBe(false);
    expect(presses(tech(context(s, L9, rollsWith(ROLL_TECH, 0.99), FD)))).toBe(false);
  });
});

/**
 * Ruling R-T18e: `techSkill` is the chance of teching one landing. The CPU
 * decides once, on the one frame its fall, run by the engine's own rules
 * (`framesToFloor`), is `TECH_LEAD` frames from the floor: inside both the
 * window a press opens in the hitstun (11) and the dodge a press is out of it
 * (15). A failed roll there is a missed tech.
 */
describe("tech, once per landing (ruling R-T18e)", () => {
  const ctx = (tuning: LevelTuning, rolls?: number[], stage = FD) => (s: GameState) => context(s, tuning, rolls, stage);

  it("decides 9 frames out: the press's 11-frame window less a 2-frame margin (UNVERIFIED: tuning)", () => {
    expect(TECH_LEAD).toBe(Math.min(TECH_WINDOW, 15) - 2);
    expect(TECH_LEAD).toBe(9);
  });

  it("counts the frames to the floor as the engine runs every fall: rising first, a hitstun running out, a launch decaying up", () => {
    const starts: [string, () => GameState][] = [];
    for (const y of [2, 5, 8, 12, 20]) for (const vy of [0.6, 0.3, -0.2, -0.6]) starts.push([`y ${y} vy ${vy}`, () => tumbling(20, y, { vy, hitstun: 6 })]);
    starts.push(["a tumble's fall", () => fallingAfter(20, 30)]);
    for (const [name, start] of starts) {
      let s = start();
      while (!s.fighters[0].grounded && s.fighters[0].y > -fx(50)) {
        const n = landsIn(s);
        expect(framesToFloor(defOf("mario"), s.fighters[0], FD, s.frame, TECH_LEAD), `${name}, engine ${n}`).toBe(n <= TECH_LEAD ? n : null);
        s = quiet(s);
      }
    }
  });

  it("counts the frames to the floor as the engine runs the fall", () => {
    let s = tumbling(20, 40);
    let checked = 0;
    while (!s.fighters[0].grounded) {
      const n = landsIn(s);
      const model = framesToFloor(defOf("mario"), s.fighters[0], FD, s.frame, TECH_LEAD);
      expect(model, `engine ${n}`).toBe(n <= TECH_LEAD ? n : null);
      checked++;
      s = quiet(s);
    }
    expect(checked).toBeGreaterThan(TECH_LEAD);
  });

  it("decides on that one frame of the approach and no other", () => {
    expect(decisionsOver(tumbling(20, 40), ctx(L9))).toEqual([TECH_LEAD]);
  });

  it("so a failed roll is a missed tech: nothing later in the reach", () => {
    expect(decisionsOver(tumbling(20, 40), ctx(L9, rollsWith(ROLL_TECH, 0.99)))).toEqual([]);
  });

  it("a window press covers its landing: no second decision when the hitstun ends before it", () => {
    // The hitstun runs out three frames after the decision, inside the window it opened.
    let at = 0;
    for (let s = tumbling(20, 40); landsIn(s) > TECH_LEAD; s = quiet(s)) at++;
    const s = tumbling(20, 40, { hitstun: at + 4 });
    expect(decisionsPressing(s, ctx(L9))).toEqual([TECH_LEAD]);
  });

  it("a tumble that starts inside the reach decides on its first frame", () => {
    const s = tumbling(20, 4);
    const n = landsIn(s);
    expect(n).toBeLessThan(TECH_LEAD);
    expect(decisionsOver(s, ctx(L9))).toEqual([n]);
  });

  it("a tumble launched with no freeze (a throw's) decides on its first frame, whose fall has run a frame already", () => {
    const s = tumbling(20, 4);
    s.fighters[0].kinetic.gravityY = -fighterParams(defOf("mario")).air_accel_y;
    kineticSum(s.fighters[0]);
    const n = landsIn(s);
    expect(n).toBeLessThan(TECH_LEAD);
    expect(decisionsOver(s, ctx(L9))).toEqual([n]);
  });

  it("a tumble's fall decides at the same frame, with a neutral press (ruling P5-R20)", () => {
    const s = atLandsIn(fallingAfter(20, 40), TECH_LEAD);
    expect(tech(context(s, L9, undefined, FD)).input).toBe(Btn.Shield);
    expect(decisionsOver(fallingAfter(20, 40), ctx(L9))).toEqual([TECH_LEAD]);
  });

  it("in a tumble's fall, decides when a window opened before shuts inside the reach", () => {
    // Pressed 9 frames before: its window shuts two frames into the reach, before the landing.
    const s = atLandsIn(fallingAfter(20, 40), TECH_LEAD);
    s.fighters[0].combat = { ...s.fighters[0].combat, techWindow: 2, techLockout: TECH_LOCKOUT - TECH_WINDOW + 2 };
    expect(decisionsOver(s, (st) => context(st, L9, undefined, FD))).toEqual([TECH_LEAD - 2]);
  });

  it("not in a tumble's fall with its air dodge spent", () => {
    const s = atLandsIn(fallingAfter(20, 40), TECH_LEAD);
    s.fighters[0].airDodged = true;
    expect(presses(tech(context(s, L9, undefined, FD)))).toBe(false);
  });

  it("does not press again into a window that is open, or locked out", () => {
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    // A press opens both, and they count down together (`updateTechInput`): 8 frames ago.
    s.fighters[0].combat = { ...s.fighters[0].combat, techWindow: TECH_WINDOW - 8, techLockout: TECH_LOCKOUT - 8 };
    expect(presses(tech(context(s, L9, undefined, FD)))).toBe(false);
    s.fighters[0].combat = { ...s.fighters[0].combat, techWindow: 0, techLockout: 12 };
    expect(presses(tech(context(s, L9, undefined, FD)))).toBe(false);
  });

  it("takes the frame outright: its roll is the chance, so no jitter or fumble undoes it", () => {
    // Level 5: noise 0.5 and a fumble of 0.11, which would cost a press about half the time.
    const L5 = tuningForLevel(5);
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    let pressed = 0;
    let rolledIn = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const d = decideCpu(s, 0, 5, seed, world);
      expect(d.behaviour).toBe("tech");
      if (held(d.input, Btn.Shield)) pressed++;
      if (presses(tech(context(s, L5, rollsOf(seed), FD)))) rolledIn++;
    }
    expect(pressed).toBe(rolledIn);
    expect(rolledIn).toBeGreaterThan(0);
  });
});

/** The rolls `decideCpu` draws from `seed`, the decision slots only. */
function rollsOf(seed: number): number[] {
  // The same draw `decideCpu` makes, first `DECISION_ROLLS` of `ROLL_COUNT`.
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < DECISION_ROLLS; i++) {
    const r = nextRandom(s);
    s = r.seed;
    out.push(r.value);
  }
  return out;
}

describe("tech, once per landing, where the approach is not a plain fall", () => {
  const ctx = (s: GameState) => context(s, L9, undefined, FD);

  it("not again after a floor bounce (ruling R-T18h): the bounce's approach is the same tumble's", () => {
    // Launched shallow, over a floor bounce's 0.8, with nothing pressed: the first
    // touch bounces it, low, so the next approach starts inside the reach.
    let s = tumbling(20, 3, { vx: 1, vy: -0.3 });
    while (!(s.fighters[0].vy > 0 && s.fighters[0].y === stageOf("finalDestination").platforms[0].y)) s = quiet(s);
    expect(s.fighters[0].action).toBe("tumble");
    expect(landsIn(s)).toBeLessThan(TECH_LEAD);
    expect(decisionsOver(s, ctx)).toEqual([]);
  });

  it("waits for a lockout to run out: the window opens only on a press the lockout allows", () => {
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    // Pressed 37 frames ago: the lockout's last frames run through the reach.
    s.fighters[0].combat = { ...s.fighters[0].combat, techLockout: 3 };
    expect(decisionsOver(s, ctx)).toEqual([TECH_LEAD - 2]);
  });

  it("meets a moving platform where it will be (Smashville's)", () => {
    const sv = stageOf("smashville");
    const moving = sv.platforms.find((p) => p.motion !== undefined)!;
    // Six past its right end as the stage clock starts, when it sweeps right at its
    // fastest (58 over 780 frames, about 0.47 a frame): it comes under the fall.
    const s = tumbling((moving.x + moving.halfWidth) / 4096 + 6, moving.y / 4096 + 25, { stage: "smashville" });
    let end = s;
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y, "it lands on the platform").toBe(moving.y);
    expect(decisionsOver(s, (st) => context(st, L9, undefined, stageViewFromDef(sv)))).toEqual([TECH_LEAD]);
  });
});

describe("tech, over Battlefield (the floor its fall comes down on)", () => {
  const ctx = (s: GameState) => context(s, L9, undefined, BF);
  const right = stageOf("battlefield").platforms[3];

  it("decides for the soft platform it lands on, not the stage under it", () => {
    const s = tumbling(right.x / 4096, right.y / 4096 + 25, { stage: "battlefield" });
    expect(decisionsOver(s, ctx)).toEqual([TECH_LEAD]);
  });

  it("follows its drift: a fall that carries it past the platform's end decides for the stage", () => {
    // Under a floor bounce's 0.8, so the first touch is the landing.
    const s = tumbling((right.x + right.halfWidth) / 4096 - 3, right.y / 4096 + 25, { stage: "battlefield", vx: 0.6, vy: -0.15 });
    let end = s;
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y, "it lands on the stage, not the platform").toBeLessThan(right.y);
    expect(decisionsOver(s, ctx)).toEqual([TECH_LEAD]);
  });

  it("counts the platform's very end as on it, as the engine lands it there", () => {
    const s = tumbling((right.x + right.halfWidth) / 4096, right.y / 4096 + 25, { stage: "battlefield" });
    let end = s;
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y).toBe(right.y);
    expect(decisionsOver(s, ctx)).toEqual([TECH_LEAD]);
  });

  it("has no floor under the stage: between the ledges but below it", () => {
    // Final Destination's body is 60 deep.
    let s = tumbling(0, -70);
    for (let i = 0; i < 40; i++) {
      expect(tech(context(s, L9, undefined, FD)).score).toBe(0);
      s = quiet(s);
    }
  });
});

/**
 * The fall model's drift and its edges (the Task 18 fix round 1 re-review's N4):
 * what each one decides is pinned against what the engine does, so a model that
 * ran the fall at its starting x, took the stage's ledges as off it, or left a
 * sweeping platform where it was when it decided, decides elsewhere.
 */
describe("tech, the fall model's drift and its edges (the re-review's A1, A3, A5)", () => {
  it("runs the drift: from 1 inside Battlefield's right platform's end, 4 above it, at vx 0.6, it decides once, for the stage", () => {
    // A1: a fall placed at its starting x decides twice here, for the platform at
    // once (the engine 27 from the floor) and for the stage at 9 ([27, 9]).
    const right = stageOf("battlefield").platforms[3];
    const s = tumbling((right.x + right.halfWidth) / 4096 - 1, right.y / 4096 + 4, { stage: "battlefield", vx: 0.6, vy: -0.15 });
    let end = s;
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y, "it lands on the stage, past the platform").toBeLessThan(right.y);
    expect(landsIn(s)).toBe(27);
    expect(decisionsOver(s, (st) => context(st, L9, undefined, BF))).toEqual([TECH_LEAD]);
  });

  it("counts the stage's ledges as on it, as the engine lands a body there (A3)", () => {
    const at = (x: number) => tumbling(x / 4096, 30);
    let end = at(FD.rightLedge);
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y, "the engine lands it on the ledge's x").toBe(stageOf("finalDestination").platforms[0].y);
    expect(decisionsOver(at(FD.rightLedge), (st) => context(st, L9, undefined, FD))).toEqual([TECH_LEAD]);
    expect(decisionsOver(at(FD.leftLedge), (st) => context(st, L9, undefined, FD))).toEqual([TECH_LEAD]);
    // One unit of Q12 past it there is no floor, and no decision.
    const past = at(FD.rightLedge + 1);
    expect(tech(context(atLandsIn(tumbling(FD.rightLedge / 4096, 30), TECH_LEAD), L9, undefined, FD)).score).toBeGreaterThan(0);
    let s = past;
    for (let i = 0; i < 40; i++, s = quiet(s)) expect(tech(context(s, L9, undefined, FD)).score, `frame ${i}`).toBe(0);
  });

  it("runs a sweeping platform's clock through the fall: one not under it yet when it decides, but under it when it lands (A5)", () => {
    const sv = stageOf("smashville");
    const moving = sv.platforms.find((p) => p.motion !== undefined)!;
    // Nine past its right end as the stage clock starts, when it sweeps right at its
    // fastest: at the decision frame its end is still two short of the fall.
    const s = tumbling((moving.x + moving.halfWidth) / 4096 + 9, moving.y / 4096 + 25, { stage: "smashville" });
    const at = atLandsIn(s, TECH_LEAD);
    expect(Math.abs(at.fighters[0].x - platformCentreX(moving, at.stageFrame)), "not under it yet").toBeGreaterThan(moving.halfWidth);
    let end = s;
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y, "it lands on the platform").toBe(moving.y);
    expect(decisionsOver(s, (st) => context(st, L9, undefined, stageViewFromDef(sv)))).toEqual([TECH_LEAD]);
  });
});

/**
 * Ruling R-T18h: `techSkill` is the chance of teching a tumble's landing, one roll
 * a tumble for the floor, so a missed tech that bounces is not rolled again and a
 * hard landing techs at the dial, not at 1 − (1 − p)². The CPU keeps no memory;
 * what the bounce leaves on the fighter says so (`floorBounced`). UNVERIFIED
 * (engine): whether the landing after a missed tech's bounce can be teched at all.
 */
describe("tech, one roll a tumble for the floor (ruling R-T18h)", () => {
  const ctx = (s: GameState) => context(s, L9, undefined, FD);
  /** Steps until the floor bounces it (nothing pressed: the tech is missed), and the frames to its next touch. */
  function bounced(s: GameState): { s: GameState; gap: number } {
    for (let i = 0; i < 120; i++) {
      const next = quiet(s);
      if (next.fighters[0].action === "tumble" && next.fighters[0].kinetic.gravityY === 0 && s.fighters[0].kinetic.gravityY !== 0) return { s: next, gap: landsIn(next) };
      s = next;
    }
    throw new Error("no bounce");
  }

  it("a missed tech that bounces gets no second roll, past the decision's reach and the hold's", () => {
    const gaps: number[] = [];
    for (const [y, vy] of [[3, -0.8], [3, -1.2], [10, -1.2], [10, -1.6]] as const) {
      const s = tumbling(20, y, { vx: 0.5, vy, hitstun: 80 });
      expect(decisionsOver(s, ctx), `y ${y}, vy ${vy}`).toHaveLength(1);
      const { s: after, gap } = bounced(s);
      gaps.push(gap);
      expect(floorBounced(defOf("mario"), after.fighters[0]), `y ${y}, vy ${vy}: the bounce is seen`).toBe(true);
      expect(decisionsOver(after, ctx), `y ${y}, vy ${vy}: after the bounce, ${gap} from the floor`).toEqual([]);
    }
    // The next touch past the decision's reach, and past the hold's too, where only
    // what the bounce left on the fighter says it was the same tumble.
    expect(Math.min(...gaps)).toBeGreaterThan(TECH_LEAD);
    expect(Math.max(...gaps)).toBeGreaterThan(TECH_HOLD);
  });

  it("sees the bounce after the hitstun runs out, a balloon reel's too", () => {
    for (const balloon of [false, true]) {
      const s = tumbling(20, 3, { vx: 0.5, vy: -1.2, hitstun: 14 });
      s.fighters[0].balloon = balloon;
      const { s: after } = bounced(s);
      let t = after;
      while (t.fighters[0].action === "tumble") t = quiet(t);
      expect(t.fighters[0].action, `balloon ${balloon}`).toBe("tumbleFall");
      for (; !t.fighters[0].grounded; t = quiet(t)) expect(floorBounced(defOf("mario"), t.fighters[0]), `balloon ${balloon}, fall frame ${t.fighters[0].actionFrame}`).toBe(true);
    }
  });

  it("sees a tumble's own launch as no bounce, on every frame of its fall, sped up or not", () => {
    for (const s0 of [tumbling(20, 40), tumbling(20, 60, { vx: 1, vy: 1.5 }), tumbling(-20, 30, { actionFrame: 12 })]) {
      for (let s = s0; !s.fighters[0].grounded; s = quiet(s)) expect(floorBounced(defOf("mario"), s.fighters[0])).toBe(false);
    }
    // A launch with the speed-up (`speedUpFaf`), as a tumbling hit makes one.
    const sped = tumbling(20, 60);
    kineticLaunch(sped.fighters[0], fx(0.5), fx(2), fx(2.1), 40);
    for (let s = sped; !s.fighters[0].grounded; s = quiet(s)) expect(floorBounced(defOf("mario"), s.fighters[0])).toBe(false);
    // One launched by a hit with no freeze into a tumble already under way (its frame
    // count kept, its gravity one frame from zero): its speed-up says it is a launch,
    // which a bounce would have disarmed.
    const again = tumbling(20, 60, { actionFrame: 4 });
    kineticLaunch(again.fighters[0], fx(0.5), fx(2), fx(2.1), 40);
    again.fighters[0].kinetic.gravityY = -fighterParams(defOf("mario")).air_accel_y;
    kineticSum(again.fighters[0]);
    expect(floorBounced(defOf("mario"), again.fighters[0])).toBe(false);
  });

  it("reads no floor met in a tumble's own fall when its hitstun runs out, for every fighter on the roster (what tumbleFall reads)", () => {
    // The slowest a tumble's fall builds: no speed-up, from TUMBLE_HITSTUN frames of
    // hitstun up, at the fighter's own gravity, its balloon gravity, or set weight's.
    // Its gravity is at the fall speed then, or (a balloon reel that stops short of
    // it, Fox's) no whole number of the fall's own frames.
    for (const def of FIGHTERS) {
      const p = fighterParams(def);
      for (const how of ["own", "balloon", "setWeight"] as const) {
        for (let hitstun = TUMBLE_HITSTUN; hitstun <= TUMBLE_HITSTUN + 15; hitstun++) {
          const s = createInitialState("finalDestination", [{ defId: def.id }, { defId: "fox" }], RULES, 21);
          const f = s.fighters[0];
          Object.assign(f, { action: "tumble", actionFrame: 0, grounded: false, platform: -1, x: 0, y: fx(120), hitstun, intangible: 0, invincible: 0, balloon: how === "balloon" });
          kineticLaunch(f, 0, fx(0.5), fx(0.5), 0, how === "setWeight");
          Object.assign(s.fighters[1], { x: fx(-60), intangible: 0 });
          let t = s;
          while (t.fighters[0].action === "tumble") t = quiet(t);
          const at = `${def.id} ${how} ${hitstun}`;
          expect(t.fighters[0].action, at).toBe("tumbleFall");
          const g = -t.fighters[0].kinetic.gravityY;
          if (how !== "balloon") expect(g, at).toBe(p.air_speed_y_stable);
          expect(floorBounced(def, t.fighters[0]), at).toBe(false);
        }
      }
    }
  });

  it("so a hard landing techs at each level's techSkill, within 0.08, not twice the chance", () => {
    // Launched down over a floor bounce's 0.8: a missed first touch bounces.
    const hard = () => tumbling(20, 12, { vx: 1.2, vy: -1 });
    let s = hard();
    while (!s.fighters[0].grounded && !(s.fighters[0].kinetic.gravityY === 0 && s.fighters[0].actionFrame > 0)) s = quiet(s);
    expect(s.fighters[0].grounded, "the first touch bounces").toBe(false);
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    const seeds = 400;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      let n = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        let t = hard();
        let cs = seed;
        let prev: InputFrame[] = [0, 0];
        for (let i = 0; i < 160 && !t.fighters[0].grounded; i++) {
          const c = cpuInput(t, 0, level, cs, world);
          cs = c.seed;
          t = step(t, [c.input, 0], { prevInputs: prev }).state;
          prev = [c.input, 0];
          if (t.fighters[0].grounded && t.fighters[0].action !== "tech" && t.fighters[0].action !== "techRoll" && t.fighters[0].action !== "downed") t = quiet(t);
        }
        if (t.fighters[0].action === "tech" || t.fighters[0].action === "techRoll") n++;
      }
      expect(Math.abs(n / seeds - tuningForLevel(level).techSkill), `level ${level}: ${n}/${seeds}`).toBeLessThanOrEqual(0.08);
    }
  });
});

/**
 * Ruling R-T18k: R-T18h's one roll is per kind of contact. The stage's side, met in
 * the hitstun, is its own roll (`framesToWall`; Plan 5, Task 19): a wall's bounce
 * keeps the gravity energy, so it is no floor met, and a floor after it in the same
 * tumble is rolled for.
 */
describe("tech, a wall and a floor in one tumble: one roll each (ruling R-T18k)", () => {
  /** Frames on which `tech`'s answer turns on its roll: its decisions, passed or failed. */
  const rolled = (s: GameState, stage: StageView) => {
    const pass = tech(context(s, L9, rollsWith(ROLL_TECH, 0), stage));
    const fail = tech(context(s, L9, rollsWith(ROLL_TECH, 0.99), stage));
    return pass.input !== fail.input || pass.score !== fail.score;
  };

  it("a wall decision, missed, then the floor its fall comes down on: one roll for each", () => {
    // Into Final Destination's left wall under the ledge, at a tumble's least
    // hitstun: the wall's decision, its roll failed (nothing pressed), the bounce.
    let s = tumbling(-100, -25, { vx: 2.5, vy: 0.2, hitstun: TUMBLE_HITSTUN });
    let wall = 0;
    let bounced = false;
    while (s.fighters[0].action === "tumble") {
      if (rolled(s, FD)) wall++;
      const next = quiet(s);
      if (Math.sign(next.fighters[0].kinetic.damageX) < 0 && Math.sign(s.fighters[0].kinetic.damageX) > 0) bounced = true;
      s = next;
    }
    expect([wall, bounced]).toEqual([1, true]);
    expect(s.fighters[0].action).toBe("tumbleFall");
    expect(floorBounced(defOf("mario"), s.fighters[0]), "a wall's bounce is no floor met").toBe(false);
    // On these stages only the hitstun's end lets the fall drift back over the
    // stage; its fall, its gravity and launch as the wall left them, is put over it.
    const over: GameState = { ...s, fighters: [{ ...s.fighters[0], x: 0, y: fx(30) }, s.fighters[1]] };
    let floor = 0;
    for (let t = over; !t.fighters[0].grounded; t = quiet(t)) if (rolled(t, FD)) floor++;
    expect(floor).toBe(1);
    expect(decisionsOver(over, (st) => context(st, L9, undefined, FD))).toEqual([TECH_LEAD]);
  });
});

/**
 * Ruling R-T18i: from `TECH_HOLD` frames out, under any stick it could hold, `tech`
 * owns the stick, decided, until it lands, pass or fail, and its fall model runs
 * that stick. So nothing else (an approach's drift, a fast fall, a shield's air
 * dodge, the Task 19 behaviours that steer a falling fighter) carries it past its
 * decision frame or onto a floor it never decided for: the sweep's lie-downs with
 * no decision (5 / 5 / 2) were an approach drifting it onto a platform.
 */
describe("tech owns the stick before a landing (ruling R-T18i)", () => {
  const bf = stageOf("battlefield");
  const left = bf.platforms[1];
  /** Mario's tumble's fall 4 right of Battlefield's left platform's end, 20 over it; Fox on that platform, so `approach` drifts him onto it. */
  const drifting = (): GameState => {
    const s = fallingAfter((left.x + left.halfWidth) / 4096 + 4, left.y / 4096 + 20, "battlefield");
    Object.assign(s.fighters[1], { platform: 1, x: left.x - fx(10), y: left.y });
    return s;
  };

  it("takes the stick under a drift that brings the floor near, and decides that landing once", () => {
    const world = cpuWorldFromDef(defOf("mario"), BF, [defOf("mario"), defOf("fox")]);
    for (let seed = 1; seed <= 20; seed++) {
      let s = drifting();
      let prev: InputFrame[] = [0, 0];
      let decided = 0;
      let held0 = -1;
      for (let i = 0; i < 120 && !s.fighters[0].grounded && s.fighters[0].action === "tumbleFall"; i++) {
        if (presses(tech(context(s, L9, undefined, BF)))) decided++;
        const d = decideCpu(s, 0, 9, seed * 1000 + i, world);
        const hold = floorHold(defOf("mario"), s.fighters[0], BF, s.frame, s.stageFrame);
        if (hold !== null) {
          if (held0 < 0) held0 = hold.frames;
          expect(d.behaviour, `seed ${seed}, frame ${i}`).toBe("tech");
          expect(d.input & (Btn.Down | Btn.Up | Btn.Jump | Btn.Attack | Btn.Special | Btn.Grab), `seed ${seed}, frame ${i}`).toBe(0);
        }
        s = step(s, [d.input, 0], { prevInputs: prev }).state;
        prev = [d.input, 0];
      }
      expect(held0, `seed ${seed}: taken from TECH_HOLD out`).toBe(TECH_HOLD);
      expect(decided, `seed ${seed}: one decision for the landing`).toBe(1);
    }
  });

  it("holds through the swing a shield would air-dodge at, and a down aerial's fast fall", () => {
    const s = atLandsIn(fallingAfter(10, 40), TECH_LEAD + 2);
    // Fox swinging his forward smash at him, seen and in range: `shield` decides an air dodge.
    const swing: GameState = { ...s, fighters: [s.fighters[0], { ...s.fighters[1], x: fx(30), y: s.fighters[0].y, grounded: false, facing: -1, action: "attack", move: "fsmash", actionFrame: L9.reactionFrames }] };
    expect(shield(context(swing, L9)).decided, "shield would decide").toBe(true);
    // Fox right under him, in reach: `attack` asks for a down aerial, Down a fast fall.
    const under: GameState = { ...s, fighters: [s.fighters[0], { ...s.fighters[1], x: fx(10), y: 0 }] };
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    for (const [name, st] of [["swing", swing], ["under", under]] as const) {
      for (let seed = 1; seed <= 100; seed++) {
        const d = decideCpu(st, 0, 9, seed, world);
        expect([d.behaviour, d.input], `${name}, seed ${seed}`).toEqual(["tech", 0]);
      }
    }
  });

  it("holds off a fast fall that would bring the floor within its reach", () => {
    // Its fall 16 frames from Final Destination's floor at the fall speed; Fox right
    // under it, so `attack` asks for a down aerial, whose Down is a fast fall.
    const s = atLandsIn(fallingAfter(10, 60), 16);
    const under: GameState = { ...s, fighters: [s.fighters[0], { ...s.fighters[1], x: fx(10), y: 0 }] };
    expect(framesToFloor(defOf("mario"), s.fighters[0], FD, s.frame, TECH_HOLD), "no floor near at its fall").toBeNull();
    expect(framesToFloor(defOf("mario"), s.fighters[0], FD, s.frame, TECH_HOLD, 0, Btn.Down, true), "near with a fast fall").not.toBeNull();
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    for (let seed = 1; seed <= 100; seed++) {
      const d = decideCpu(under, 0, 9, seed, world);
      expect([d.behaviour, d.input], `seed ${seed}`).toEqual(["tech", 0]);
    }
  });

  it("finds a platform it rises past from under, and comes down on: the decision is not lost to its rise", () => {
    // Battlefield's left platform, 24 up: from 2 under it, rising at 1 a frame, it
    // comes down on it 11 frames on. Under it, a model that looked only below would
    // not see it until the decision frame had gone.
    const s = tumbling(left.x / 4096, left.y / 4096 - 2, { stage: "battlefield", vy: 1 });
    expect(landsIn(s)).toBe(11);
    let end = s;
    while (!end.fighters[0].grounded) end = quiet(end);
    expect(end.fighters[0].y, "it lands on the platform").toBe(left.y);
    expect(decisionsOver(s, (st) => context(st, L9, undefined, BF))).toEqual([TECH_LEAD]);
  });

  it("holds through its dodge's tech frames and no further: a floor met after the 15th is no tech", () => {
    // Its tumble's dodge one step from Final Destination's floor, at each of the dodge's frames.
    const at = (actionFrame: number): GameState => {
      const s = atLandsIn(fallingAfter(20, 40), 1);
      Object.assign(s.fighters[0], { action: "airDodge", actionFrame, airDodged: true, combat: { ...s.fighters[0].combat, tumbleDodge: true } });
      return s;
    };
    // The step that meets the floor counts the dodge one frame on: the 15th (frame 14) techs, the 16th not.
    const met = (s: GameState) => quiet(s).fighters[0].action;
    expect(met(at(AIR_DODGE_TECH_FRAMES - 2))).toBe("tech");
    expect(met(at(AIR_DODGE_TECH_FRAMES - 1))).not.toBe("tech");
    expect(tech(context(at(AIR_DODGE_TECH_FRAMES - 2), L9, undefined, FD))).toMatchObject({ input: 0, decided: true });
    expect(tech(context(at(AIR_DODGE_TECH_FRAMES - 1), L9, undefined, FD)).score).toBe(0);
  });

  it("holds its press's air dodge neutral while it waits, whatever stick it held for the landing", () => {
    // 1 past Battlefield's left platform's end, 14 over it: the hitstun runs out as it
    // decides, and only a drift left brings the platform under it, so it holds left.
    let s = tumbling((left.x + left.halfWidth) / 4096 + 1, left.y / 4096 + 14, { stage: "battlefield", hitstun: 8 });
    let prev: InputFrame = 0;
    let r = tech(context(s, L9, undefined, BF));
    for (let i = 0; i < 40 && !presses(r); i++) {
      const stick = r.score > 0 ? r.input & ~Btn.Shield : 0;
      s = step(s, [stick, 0], { prevInputs: [prev, 0] }).state;
      prev = stick;
      r = tech(context(s, L9, undefined, BF));
    }
    expect([s.fighters[0].hitstun, floorHold(defOf("mario"), s.fighters[0], BF, s.frame, s.stageFrame)?.stick, r.input]).toEqual([1, Btn.Left, Btn.Shield]);
    const next = step(s, [r.input, 0], { prevInputs: [prev, 0] }).state;
    expect([next.fighters[0].action, next.fighters[0].bufferedAction?.kind]).toEqual(["tumbleFall", "shield"]);
    const hold = tech(context(next, L9, undefined, BF));
    expect([hold.input, hold.decided]).toEqual([0, true]);
    const dodged = step(next, [hold.input, 0], { prevInputs: [r.input, 0] }).state.fighters[0];
    expect([dodged.action, dodged.charge]).toEqual(["airDodge", 0]);
  });

  it("is first in the table, so its decided hold takes the frame before any other decided behaviour", () => {
    expect(BEHAVIOURS[0].name).toBe("tech");
  });

  it("holds the stick through its own air dodge's tech frames, toward the floor it decided for", () => {
    // Over Battlefield's top platform's left end, the stage's middle to its right:
    // only a drift right brings a floor near, so it holds right, and on through the dodge.
    const top = bf.platforms[2];
    const s = fallingAfter((left.x + left.halfWidth) / 4096 + 4, left.y / 4096 + 40, "battlefield");
    Object.assign(s.fighters[1], { platform: 1, x: left.x - fx(10), y: left.y });
    const world = cpuWorldFromDef(defOf("mario"), BF, [defOf("mario"), defOf("fox")]);
    let t = s;
    let prev: InputFrame[] = [0, 0];
    const dodge: InputFrame[] = [];
    for (let i = 0; i < 120 && !t.fighters[0].grounded; i++) {
      const d = decideCpu(t, 0, 9, 7 + i, world);
      if (t.fighters[0].action === "airDodge" && t.fighters[0].actionFrame < 14) {
        expect(d.behaviour, `dodge frame ${t.fighters[0].actionFrame}`).toBe("tech");
        dodge.push(d.input);
      }
      t = step(t, [d.input, 0], { prevInputs: prev }).state;
      prev = [d.input, 0];
    }
    expect(dodge.length).toBeGreaterThan(0);
    expect(dodge.some((i) => held(i, Btn.Right))).toBe(true);
    expect(t.fighters[0].y, "on the top platform").toBe(top.y);
    expect(t.fighters[0].action).toBe("tech");
  });
});

/**
 * Ruling R-T18f: the engine counts hitstun down before the status runs
 * (`simulate.ts`), so a press read at hitstun 1 is not the cancel's: the reel
 * ends into `tumbleFall` and the press waits in the buffer, to come out on the
 * next step as an air dodge with whatever stick is held then.
 */
describe("the hitstun cancel, read in the engine's order (ruling R-T18f)", () => {
  /** A reel `hitstun` from its end, the cancel's frames open, slow enough. */
  const reel = (hitstun: number) => tumbling(20, 60, { hitstun, actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME + 4, vy: -0.5 });
  const pressed = (s: GameState, input: InputFrame) => step(s, [input, 0], { prevInputs: [0, 0] }).state.fighters[0];

  it("at hitstun 2 a press is the cancel's air dodge; at hitstun 1 the reel ends and the press waits", () => {
    expect(pressed(reel(2), Btn.Shield).action).toBe("airDodge");
    const ended = pressed(reel(1), Btn.Shield);
    expect(ended.action).toBe("tumbleFall");
    expect(ended.bufferedAction?.kind).toBe("shield");
  });

  it("escape takes the cancel at hitstun 2, and leaves hitstun 1 alone", () => {
    const opening = (hitstun: number) => tumbling(20, 80, { hitstun, actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1 });
    expect(escape(context(opening(2), L9, undefined, FD)).input).toBe(Btn.Shield);
    expect(escape(context(opening(1), L9, undefined, FD)).score).toBe(0);
  });

  it("so a tech decided at hitstun 1 presses neutral, and holds neutral while the press waits", () => {
    const base = tumbling(20, 40);
    // The reel's hitstun runs out on the step that reads the decision.
    let at = 0;
    for (let s = base; landsIn(s) > TECH_LEAD; s = quiet(s)) at++;
    const s = atLandsIn(tumbling(20, 40, { hitstun: at + 1 }), TECH_LEAD);
    expect(s.fighters[0].hitstun).toBe(1);
    const r = tech(context(s, L9, undefined, FD));
    expect(r.input).toBe(Btn.Shield);
    const next = step(s, [r.input, 0], { prevInputs: [0, 0] }).state;
    expect(next.fighters[0].action).toBe("tumbleFall");
    const hold = tech(context(next, L9, undefined, FD));
    expect([hold.input, hold.decided]).toEqual([0, true]);
    const dodged = step(next, [hold.input, 0], { prevInputs: [r.input, 0] }).state.fighters[0];
    expect([dodged.action, dodged.charge]).toEqual(["airDodge", 0]);
  });

  it("a tech press with a direction where the next step is still before the cancel is the window's", () => {
    const s = atLandsIn(tumbling(20, 40, { actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 30 }), TECH_LEAD);
    const r = tech(context(s, L9, undefined, FD));
    expect(held(r.input, Btn.Left)).toBe(true);
    expect(step(s, [r.input, 0], { prevInputs: [0, 0] }).state.fighters[0].action).toBe("tumble");
  });

  it("and a press the engine reads as the cancel's is neutral", () => {
    // The approach's decision frame falls one frame before the reel shows frame 41.
    let s = tumbling(20, 40);
    for (let a = 0; a < HITSTUN_CANCEL_AIR_DODGE_FRAME; a++) {
      s = atLandsIn(tumbling(20, 40, { actionFrame: a }), TECH_LEAD);
      if (s.fighters[0].actionFrame + 1 >= HITSTUN_CANCEL_AIR_DODGE_FRAME) break;
    }
    expect(s.fighters[0].actionFrame + 1).toBe(HITSTUN_CANCEL_AIR_DODGE_FRAME);
    const r = tech(context(s, L9, undefined, FD));
    expect(r.input).toBe(Btn.Shield);
    expect(step(s, [r.input, 0], { prevInputs: [0, 0] }).state.fighters[0]).toMatchObject({ action: "airDodge", charge: 0 });
  });
});

/* ------------------------------------------------------------------- escape -- */

/** A slow reel 80 over the floor, its cancel opening on the step that reads this frame's press. */
const opening = (over: Partial<FighterState> = {}) =>
  makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, platform: -1, y: fx(80), hitstun: 20, actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1, launchSpeed: fx(1), ...over }), makeFighter({ port: 1, x: fx(60) })] });

describe("escape", () => {
  // The plan's two; the press is on the frame the cancel opens (ruling R-T18e).
  it("air-dodges out of hitstun once the cancel is open", () => {
    const r = escape(context(opening(), L9));
    expect(r.input).toBe(Btn.Shield);
    expect(r.decided).toBe(true);
  });

  it("waits while the cancel is shut", () => {
    expect(escape(context(opening({ actionFrame: 20 }), L9)).score).toBe(0);
  });
});

describe("escape, once per opening (ruling R-T18e)", () => {
  it("not on the frames after the cancel opened", () => {
    expect(escape(context(opening({ actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME }), L9)).score).toBe(0);
    expect(escape(context(opening({ actionFrame: 45 }), L9)).score).toBe(0);
  });

  it("on the frame a slowing launch comes under the bar, and not the frame after", () => {
    const BAR = HITSTUN_CANCEL_AIR_DODGE_SPEED;
    expect(escape(context(opening({ actionFrame: 50, launchSpeed: BAR - 1 }), L9)).input).toBe(Btn.Shield);
    expect(escape(context(opening({ actionFrame: 50, launchSpeed: BAR - LAUNCH_SPEED_DECAY - 1 }), L9)).score).toBe(0);
    expect(escape(context(opening({ actionFrame: 50, launchSpeed: BAR }), L9)).score).toBe(0);
  });

  it("not with its air dodge spent, on the ground, frozen, or out of hitstun", () => {
    expect(escape(context(opening({ airDodged: true }), L9)).score).toBe(0);
    expect(escape(context(opening({ grounded: true }), L9)).score).toBe(0);
    expect(escape(context(opening({ hitlag: 3 }), L9)).score).toBe(0);
    expect(escape(context(opening({ hitstun: 0 }), L9)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    expect(escape(context(opening(), L1)).score).toBe(0);
    expect(escape(context(opening(), L9, rollsWith(ROLL_TECH, 0.99))).score).toBe(0);
  });

  it("leaves a landing within a tech's reach to tech, from where the tech holds the stick: one roll for it", () => {
    const opensAt = (n: number) => {
      const s = atLandsIn(tumbling(20, 40, { actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1 - 30 }), n);
      return { ...s, fighters: s.fighters.map((f, i) => (i === 0 ? { ...f, actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1 } : f)) };
    };
    expect(escape(context(opensAt(TECH_LEAD), L9, undefined, FD)).score).toBe(0);
    expect(escape(context(opensAt(TECH_HOLD), L9, undefined, FD)).score).toBe(0);
    expect(escape(context(opensAt(TECH_HOLD + 1), L9, undefined, FD)).input).toBe(Btn.Shield);
  });
});

/**
 * Ruling P5-R21: an air dodge keeps the fighter's drift (Plan 3, Task 20b), so
 * `escape` minds the ledge as `shield` does, over the fighter's own dodge
 * length (`dodgeCarriesOffstage`), and forgets to when its recovery roll fails.
 */
describe("escape, near the ledge (ruling P5-R21)", () => {
  // 80 up, where no floor is within a tech's reach (that landing would be the tech's).
  const reeling = (x: number, vx: number) => opening({ x: fx(x), vx: fx(vx) });

  // Mario's neutral dodge is 52 frames (`DEFAULT_AIR_DODGE`): 1.2 a frame with no
  // air friction carries 62.4, so from x -66 out past Battlefield's -80.
  it("does not air-dodge out of hitstun when the dodge's drift would carry it off the stage", () => {
    expect(escape(context(reeling(-66, -1.2), L9)).score).toBe(0);
    expect(escape(context(reeling(-66, 1.2), L9)).input).toBe(Btn.Shield);
  });

  it("forgets the ledge when its recovery roll fails, as a lower level does", () => {
    const L5 = tuningForLevel(5);
    expect(escape(context(reeling(-66, -1.2), L5)).score).toBe(0);
    expect(escape(context(reeling(-66, -1.2), L5, rollsWith(ROLL_RECOVER, L5.recoverySkill))).input).toBe(Btn.Shield);
  });
});

/* -------------------------------------------------------------------- parry -- */

/**
 * Ruling R-T18d: the parry is timed off the swing's own move data. The drop
 * parries for its first `PERFECT_SHIELD_WINDOW` frames (`isParrying`), counting
 * the step that reads the release; a CPU that can drop its shield (past
 * `SHIELD_MIN_HOLD`) lets go on the first frame the swing's first box lands
 * inside those, at drop frame `PARRY_AIM` or sooner.
 */
function swingAt(attacker: string, move: MoveSlot, actionFrame: number, self: Partial<FighterState> = {}, other: Partial<FighterState> = {}): GameState {
  return makeState({
    fighters: [
      makeFighter({ port: 0, action: "shield", actionFrame: 10, ...self }),
      makeFighter({ port: 1, defId: attacker, x: fx(14), facing: -1, action: "attack", move, actionFrame, combat: { ...emptyCombat(), smashLetGo: true }, ...other }),
    ],
  });
}
/** The `actionFrame` a move's first box goes live on, from its data. */
const firstLive = (attacker: string, move: MoveSlot) => actionFrameOf(Math.min(...defOf(attacker).moves[move]!.hitboxes.map((h) => h.startFrame)));

describe("parry (ruling R-T18d)", () => {
  it("reads a swing's first live frame off its move data", () => {
    expect(swingHitFrame(defOf("mario"), swingAt("mario", "fsmash", 6).fighters[1])).toBe(firstLive("mario", "fsmash"));
    expect(swingHitFrame(defOf("link"), swingAt("link", "jab1", 4).fighters[1])).toBe(firstLive("link", "jab1"));
  });

  it("lets go of a smash so its first box lands on drop frame PARRY_AIM", () => {
    const F = firstLive("mario", "fsmash");
    const at = F - 1 - PARRY_AIM;
    const r = parry(context(swingAt("mario", "fsmash", at), L9));
    expect([r.input, r.decided]).toEqual([0, true]);
    expect(r.score).toBeGreaterThan(600);
    // A frame sooner the hit would land past the parry's frames' middle; a frame later is not the first.
    expect(parry(context(swingAt("mario", "fsmash", at - 1), L9)).score).toBe(0);
    expect(parry(context(swingAt("mario", "fsmash", at + 1), L9)).score).toBe(0);
  });

  it("lets go of a fast swing (Link's jab) on the frame it first sees it, its hit already that close", () => {
    const F = firstLive("link", "jab1");
    expect(F - (L9.reactionFrames + 1)).toBeLessThanOrEqual(PARRY_AIM);
    expect(parry(context(swingAt("link", "jab1", L9.reactionFrames), L9)).input).toBe(0);
    expect(parry(context(swingAt("link", "jab1", L9.reactionFrames), L9)).score).toBeGreaterThan(0);
    // ...and not before it sees it.
    expect(parry(context(swingAt("link", "jab1", L9.reactionFrames - 1), L9)).score).toBe(0);
  });

  it("does not attempt it from a shield under the minimum hold, or one going up", () => {
    const at = firstLive("mario", "fsmash") - 1 - PARRY_AIM;
    // The engine drops a shield whose `actionFrame + 1` (the step that reads the release) has reached the hold.
    expect(parry(context(swingAt("mario", "fsmash", at, { actionFrame: SHIELD_MIN_HOLD - 1 }), L9)).input).toBe(0);
    expect(parry(context(swingAt("mario", "fsmash", at, { actionFrame: SHIELD_MIN_HOLD - 1 }), L9)).score).toBeGreaterThan(0);
    expect(parry(context(swingAt("mario", "fsmash", at, { actionFrame: SHIELD_MIN_HOLD - 2 }), L9)).score).toBe(0);
    expect(parry(context(swingAt("mario", "fsmash", at, { action: "shieldStart", actionFrame: 0 }), L9)).score).toBe(0);
    expect(parry(context(swingAt("mario", "fsmash", at, { action: "shieldStun", hitstun: 4 }), L9)).score).toBe(0);
  });

  it("not a swing it cannot time: a smash held at its hold, or whose charge is still to come, a move with no box of its own, no data", () => {
    // Mario's forward smash holds on its hold frame while Attack is held.
    expect(parry(context(swingAt("mario", "fsmash", 4, {}, { combat: { ...emptyCombat(), smashLetGo: false }, charge: 6 }), L9)).score).toBe(0);
    // Marth's holds on 8, where its first box is 9: before 8 whether it charges is still to come.
    expect(swingHitFrame(defOf("marth"), swingAt("marth", "fsmash", 7, {}, { combat: emptyCombat() }).fighters[1])).toBeNull();
    expect(swingHitFrame(defOf("marth"), swingAt("marth", "fsmash", 8).fighters[1])).toBe(firstLive("marth", "fsmash"));
    // Marth's, held on its hold frame (8, one before its first box): still charging.
    expect(swingHitFrame(defOf("marth"), swingAt("marth", "fsmash", 8, {}, { combat: { ...emptyCombat(), smashLetGo: false }, charge: 3 }).fighters[1])).toBeNull();
    // Kirby's Inhale catches (a command grab) and pulls: no box of it strikes a shield.
    expect(swingHitFrame(defOf("kirby"), swingAt("kirby", "neutralB", 5, {}, { action: "special" }).fighters[1])).toBeNull();
    // Samus's Charge Shot strikes with its projectile alone.
    expect(swingHitFrame(defOf("samus"), swingAt("samus", "neutralB", 10, {}, { action: "special" }).fighters[1])).toBeNull();
    expect(swingHitFrame(undefined, swingAt("mario", "fsmash", 10).fighters[1])).toBeNull();
  });

  it("times a smash let go uncharged from its hold frame on, the first frame its charge is known", () => {
    // Marth's holds on 8, its first box on 9: let go, it lands on drop frame 0, decided there.
    expect(parry(context(swingAt("marth", "fsmash", 8), L9)).input).toBe(0);
    expect(parry(context(swingAt("marth", "fsmash", 8), L9)).score).toBeGreaterThan(0);
  });

  it("decides once per swing: after a failed roll it holds its shield", () => {
    const at = firstLive("mario", "fsmash") - 1 - PARRY_AIM;
    expect(parry(context(swingAt("mario", "fsmash", at), L9, rollsWith(ROLL_PARRY, 0.99))).score).toBe(0);
    for (let a = at + 1; a <= firstLive("mario", "fsmash") - 1; a++) expect(parry(context(swingAt("mario", "fsmash", a), L9)).score, `frame ${a}`).toBe(0);
  });

  it("only at a swing seen within THREAT_RANGE", () => {
    // Marth's Dancing Blade 22 away: its box lands on the shield. Seen where it was
    // 4 frames ago (level 9's reaction), closing at 2.5 a frame, it was 32 away; at 1, 26.
    const at = firstLive("marth", "sideB") - 1 - PARRY_AIM;
    expect(parry(context(swingAt("marth", "sideB", at, {}, { action: "special", x: fx(22), vx: -fx(1) }), L9)).score).toBeGreaterThan(0);
    expect(parry(context(swingAt("marth", "sideB", at, {}, { action: "special", x: fx(22), vx: -fx(2.5) }), L9)).score).toBe(0);
    expect(parry(context(swingAt("mario", "fsmash", firstLive("mario", "fsmash") - 1 - PARRY_AIM, {}, { action: "stand", move: null }), L9)).score).toBe(0);
  });

  it("only a swing whose first live box can meet its shield, from where the attacker stands", () => {
    const at = firstLive("mario", "fsmash") - 1 - PARRY_AIM;
    // Mario's forward smash reaches about 14 in front of him; a shield 10 across meets it at 14, not at 28.
    expect(parry(context(swingAt("mario", "fsmash", at, {}, { x: fx(28) }), L9)).score).toBe(0);
    // Turned away, the attacker's box is behind it.
    expect(parry(context(swingAt("mario", "fsmash", at, {}, { facing: 1 }), L9)).score).toBe(0);
  });

  it("only one in front of it: a shield, and so a parry, covers the side it faces (shieldCovers)", () => {
    const at = firstLive("mario", "fsmash") - 1 - PARRY_AIM;
    expect(parry(context(swingAt("mario", "fsmash", at, { facing: -1 }), L9)).score).toBe(0);
  });

  it("is a read only good CPUs make, and not every time", () => {
    const at = firstLive("donkeyKong", "fsmash") - 1 - PARRY_AIM;
    expect(parry(context(swingAt("donkeyKong", "fsmash", Math.max(at, L1.reactionFrames)), L1)).score).toBe(0);
    expect(parry(context(swingAt("mario", "fsmash", firstLive("mario", "fsmash") - 1 - PARRY_AIM), L9, rollsWith(ROLL_PARRY, 0.6))).score).toBe(0);
  });
});

/**
 * Ruling R-T18j: the parry's reach is the engine's hit test (`resolveHits`). A box
 * the engine counts at all first reaches the body (`reachesBody`), and lands on a
 * shield only from the side it covers at the box's nearest point
 * (`hitReachesShield`); nothing lands on a body intangible or invincible then. The
 * swing is placed where it is now, not where the view saw it. The fix round 1
 * sweeps' wasted drops were boxes that met the bubble and never the body, a
 * defender intangible, and a Kirby dash attack that crossed the shield up.
 */
describe("parry, where the engine lands the hit on the shield (ruling R-T18j)", () => {
  const atF = (attacker: string, move: MoveSlot) => Math.max(firstLive(attacker, move) - 1 - PARRY_AIM, L9.reactionFrames);
  /** Steps the swing with the CPU's shield let go on this frame: what the engine does with its first box. */
  function dropped(s: GameState): "parried" | "hit" | "nothing" {
    let prev: InputFrame[] = [Btn.Shield, 0];
    for (let i = 0; i < 12; i++) {
      const out = step(s, [0, 0], { prevInputs: prev });
      prev = [0, 0];
      if (out.events.shieldHits.some((h) => h.victim === 0)) return out.state.fighters[0].action === "shieldRelease" ? "parried" : "hit";
      if (out.events.hits.some((h) => h.victim === 0)) return "hit";
      s = out.state;
    }
    return "nothing";
  }

  it("needs the box to reach the body first: Mario's forward smash meets the bubble out to 23, the body only to 15", () => {
    const at = atF("mario", "fsmash");
    const swing = (x: number) => swingAt("mario", "fsmash", at, { x: 0, y: 0, grounded: true, platform: 0 }, { x: fx(x), y: 0, grounded: true, platform: 0 });
    expect(parry(context(swing(15), L9)).score).toBeGreaterThan(0);
    expect(dropped(swing(15)), "the engine parries it").toBe("parried");
    for (const x of [16, 20, 23]) {
      const s = swing(x);
      const hb = defOf("mario").moves.fsmash!.hitboxes.filter((h) => h.startFrame === Math.min(...defOf("mario").moves.fsmash!.hitboxes.map((b) => b.startFrame)));
      const bubble = shieldBubble(s.fighters[0], defOf("mario"));
      const box = (h: (typeof hb)[number]) => {
        const n = hitboxWorldPos(s.fighters[1].x, s.fighters[1].y, -1, h);
        return { x1: n.x, y1: n.y, x2: n.x, y2: n.y, r: h.radius };
      };
      expect(hb.some((h) => capsulesOverlap(box(h), bubble)), `${x}: it meets the bubble`).toBe(true);
      expect(parry(context(s, L9)).score, `${x} away`).toBe(0);
      expect(dropped(s), `${x} away: the engine lands nothing`).toBe("nothing");
    }
  });

  it("reaches with a capsule box's far end: Pikachu's down tilt, 5 to 11 in front of him, from 14 away (the re-review's H3)", () => {
    const at = atF("pikachu", "dtilt");
    const s = swingAt("pikachu", "dtilt", at, {}, { x: fx(14) });
    const hb = defOf("pikachu").moves.dtilt!.hitboxes[0];
    expect([hb.x2 !== undefined, hb.y2 !== undefined]).toEqual([true, true]);
    const near = hitboxWorldPos(fx(14), 0, -1, hb);
    expect(capsulesOverlap({ x1: near.x, y1: near.y, x2: near.x, y2: near.y, r: hb.radius }, hurtboxCapsule(s.fighters[0], defOf("mario").attributes)), "its near end alone misses the body").toBe(false);
    expect(parry(context(s, L9)).score).toBeGreaterThan(0);
    expect(dropped(s)).toBe("parried");
  });

  it("judges the side from where the swing is now: a dash attack seen in front that has crossed it up is behind it", () => {
    const at = atF("kirby", "dashAttack");
    // Seen 4 frames back 5 in front, crossing at 2 a frame: 3 behind now.
    const crossed = swingAt("kirby", "dashAttack", at, {}, { x: -fx(3), vx: -fx(2) });
    expect(observe(crossed, 0, L9.reactionFrames).facingTarget, "the view has it in front").toBe(true);
    expect(parry(context(crossed, L9)).score).toBe(0);
    // Seen behind, 5 in front now.
    const ahead = swingAt("kirby", "dashAttack", at, {}, { x: fx(5), vx: fx(2) });
    expect(observe(ahead, 0, L9.reactionFrames).facingTarget, "the view has it behind").toBe(false);
    expect(parry(context(ahead, L9)).score).toBeGreaterThan(0);
  });

  it("takes the lowest-id box that reaches the body, as the engine does: Fox's forward smash's tip, past the shield's back", () => {
    // Mario faces Fox, 7.2 to his left; the smash's box 0 reaches 10.3 in front of
    // Fox, past Mario's back, and the engine picks it over box 1 in front of him.
    // Its first frame its timing is known: its hold frame, let go, the hit next.
    const at = firstLive("fox", "fsmash") - 1;
    const s = swingAt("fox", "fsmash", at, { facing: -1 }, { x: -fx(7.2), facing: 1 });
    expect(swingHitFrame(defOf("fox"), s.fighters[1])).toBe(at + 1);
    const tip = defOf("fox").moves.fsmash!.hitboxes.find((h) => h.id === 0)!;
    expect(hitboxWorldPos(-fx(7.2), 0, 1, tip).x, "box 0 is behind him").toBeGreaterThan(0);
    expect(parry(context(s, L9)).score).toBe(0);
    expect(dropped(s), "the engine lands it on his body").toBe("hit");
    // From 10 off the tip is in front of him: it parries, as the engine does.
    const off = swingAt("fox", "fsmash", at, { facing: -1 }, { x: -fx(10), facing: 1 });
    expect(parry(context(off, L9)).score).toBeGreaterThan(0);
    expect(dropped(off)).toBe("parried");
  });

  it("passes a box that only grazes the body on to the next, and lands each part's pick, as the engine does", () => {
    // Mario's forward smash, its first boxes replaced: Mario (port 0) faces it, 10 to his left.
    const at = atF("mario", "fsmash");
    const s = swingAt("mario", "fsmash", at, { facing: -1 }, { x: -fx(10), facing: 1 });
    const attrs = defOf("mario").attributes;
    const body = hurtboxCapsule(s.fighters[0], attrs);
    const m = defOf("mario").moves.fsmash!;
    const first = Math.min(...m.hitboxes.map((h) => h.startFrame));
    const mid = Math.trunc(attrs.height / 2);
    const box = (id: number, x: number, radius: number, part = 0): Hitbox => ({ ...m.hitboxes[0], id, startFrame: first, x: x + fx(10), y: mid, radius, part, x2: undefined, y2: undefined });
    const swinging = (boxes: Hitbox[]) => ({ ...context(s, L9), matchDefs: [defOf("mario"), { ...defOf("mario"), moves: { ...defOf("mario").moves, fsmash: { ...m, hitboxes: boxes } } }] });
    const front = box(1, -fx(2), fx(2));
    // Behind his back, 0.05 into the body: a graze, under GLANCING_BLOW_DEPTH.
    const graze = box(0, body.r + fx(2) - fx(0.05), fx(2));
    expect(deepestReach(graze.x - fx(10), mid, graze.x - fx(10), mid, 0, 0, graze.radius, [body]).depth).toBeLessThan(GLANCING_BLOW_DEPTH);
    expect(parry(swinging([graze, front])).score, "the graze is passed on").toBeGreaterThan(0);
    // Behind his back, deep: the pick, and a hit on his body.
    const deep = box(0, body.r, fx(2));
    expect(parry(swinging([deep, front])).score).toBe(0);
    // A box of another part lands too: one on his body behind spoils the parry of the part on his shield.
    expect(parry(swinging([{ ...front, id: 0, part: 0 }, { ...deep, id: 1, part: 1 }])).score).toBe(0);
    expect(parry(swinging([{ ...front, id: 0, part: 0 }, { ...front, id: 1, part: 1 }])).score).toBeGreaterThan(0);
  });

  it("not a Final Smash's box, which no shield takes", () => {
    const final = defOf("donkeyKong").moves.finalSmash!;
    expect(final.final).toBeDefined();
    const at = atF("donkeyKong", "finalSmash");
    expect(parry(context(swingAt("donkeyKong", "finalSmash", at, {}, { action: "special", x: fx(10) }), L9)).score).toBe(0);
  });

  it("not on a worn shield the box misses: the body is poked through it", () => {
    // Link's down tilt from 18 away: its low box reaches Mario's shins, inside a whole
    // shield and under a worn one, shrunk to 15% of it.
    const at = atF("link", "dtilt");
    const worn = swingAt("link", "dtilt", at, { shieldHealth: fx(1) }, { x: fx(18) });
    expect(parry(context(worn, L9)).score).toBe(0);
    expect(dropped(worn), "the engine pokes it").toBe("hit");
    const whole = swingAt("link", "dtilt", at, {}, { x: fx(18) });
    expect(parry(context(whole, L9)).score).toBeGreaterThan(0);
    expect(dropped(whole)).toBe("parried");
  });

  it("decides on the first frame its box would land, for a swing coming into reach: not the frame before, out of reach then", () => {
    // Mario's forward smash, its hit two frames on: 15 away now, closing at 2 a frame, so
    // 17 away the frame before, where its box reaches only the bubble.
    const at = firstLive("mario", "fsmash") - 2;
    const closing = swingAt("mario", "fsmash", at, {}, { x: fx(15), vx: -fx(2) });
    expect(parry(context(closing, L9)).score).toBeGreaterThan(0);
    expect(parry(context(swingAt("mario", "fsmash", at - 1, {}, { x: fx(17), vx: -fx(2) }), L9)).score).toBe(0);
  });

  it("counts a box only where it is live: the air's alone on a shield on the ground, and one of its owner's other footing", () => {
    const at = atF("mario", "fsmash");
    const s = swingAt("mario", "fsmash", at, {}, { x: fx(12) });
    const with_ = (patch: Partial<Hitbox>) => {
      const m = defOf("mario").moves.fsmash!;
      const def = { ...defOf("mario"), moves: { ...defOf("mario").moves, fsmash: { ...m, hitboxes: m.hitboxes.map((h) => ({ ...h, ...patch })) } } };
      return { ...context(s, L9), matchDefs: [defOf("mario"), def] };
    };
    expect(parry(with_({})).score).toBeGreaterThan(0);
    expect(parry(with_({ situation: "air" })).score).toBe(0);
    expect(parry(with_({ situation: "ground" })).score).toBeGreaterThan(0);
    expect(parry(with_({ whileGrounded: false })).score).toBe(0);
    expect(parry(with_({ whileGrounded: true })).score).toBeGreaterThan(0);
  });

  it("not while intangible or invincible when the hit lands: no shield meets it then", () => {
    const at = atF("mario", "fsmash");
    const lands = firstLive("mario", "fsmash") - (at + 1);
    // Each counts down once a step, and the hit lands `lands + 1` steps on.
    for (const key of ["intangible", "invincible"] as const) {
      expect(parry(context(swingAt("mario", "fsmash", at, { [key]: lands + 2 }, { x: fx(12) }), L9)).score, `${key} through the hit`).toBe(0);
      expect(parry(context(swingAt("mario", "fsmash", at, { [key]: lands + 1 }, { x: fx(12) }), L9)).score, `${key} running out as it lands`).toBeGreaterThan(0);
    }
  });

  it("with Task 19's shield: the shield it raised and holds through the swing is let go on the parry's frame, and parries", () => {
    // Donkey Kong's forward smash at a standing level-9 Mario 14 away, from the frame
    // the level first sees it: the shield decides once and holds (ruling R-T18g), the
    // parry drops it once (decided, before `shield` in the table).
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("donkeyKong")]);
    const F = firstLive("donkeyKong", "fsmash");
    let parried = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "donkeyKong" }], RULES, 21);
      Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x: 0, y: 0, intangible: 0, facing: 1 });
      Object.assign(s.fighters[1], { action: "attack", move: "fsmash", actionFrame: L9.reactionFrames, grounded: true, platform: 0, x: fx(14), y: 0, intangible: 0, facing: -1 });
      s.fighters[1].combat.smashLetGo = true;
      let cs = seed;
      let prev: InputFrame[] = [0, 0];
      let decided = -1;
      for (let i = 0; i < 40; i++) {
        const d = decideCpu(s, 0, 9, cs, world);
        cs = d.seed;
        if (d.behaviour === "parry") {
          expect(decided, `seed ${seed}: once a swing`).toBe(-1);
          expect(d.input, `seed ${seed}`).toBe(0);
          decided = s.fighters[1].actionFrame;
        }
        const out = step(s, [d.input, 0], { prevInputs: prev });
        prev = [d.input, 0];
        const hit = out.events.hits.some((h) => h.victim === 0);
        expect(hit && s.fighters[0].action === "shieldRelease", `seed ${seed}: hit in a drop`).toBe(false);
        if (out.events.shieldHits.some((h) => h.victim === 0)) {
          if (decided >= 0) {
            expect([out.state.fighters[0].action, out.state.fighters[1].actionFrame], `seed ${seed}`).toEqual(["shieldRelease", F]);
            parried++;
          }
          break;
        }
        if (hit) break;
        s = out.state;
      }
    }
    expect(parried).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------ the wall tech -- */

/**
 * The Task 10 review's carry: a wall tech's first `WALL_TECH_JUMP_FRAMES` frames
 * read a jump input, the button or Up held, as a wall tech jump (`wallJump.ts`),
 * which gains height and spends no jump. Below the ledge that is the recovery, so
 * the CPU holds jump there; elsewhere it holds neither jump nor Up, which another
 * behaviour's Up would otherwise turn into one.
 */
describe("a wall tech below the ledge (the Task 10 review's carry)", () => {
  /** Against Battlefield's left wall (`DEFAULT_STAGE_VIEW`: ledges at -80, floor 0). */
  const walled = (y: number, frame: number, actionFrame: number, other: Partial<FighterState> = {}) =>
    makeState({ frame, fighters: [makeFighter({ port: 0, action: "techWall", actionFrame, grounded: false, platform: -1, x: fx(-84), y, combat: { ...emptyCombat(), wallSide: 1, wallFrames: actionFrame + 1 } }), makeFighter({ port: 1, x: fx(30), ...other })] });
  const each = (fn: (frame: number, actionFrame: number) => void) => {
    // The state's `actionFrame` + 1 is the frame its press is read on (`advanceFighter`).
    for (let actionFrame = 0; actionFrame < WALL_TECH_JUMP_FRAMES; actionFrame++) for (let frame = 0; frame < 10; frame++) fn(frame, actionFrame);
  };

  it("holds jump on every frame the engine reads as a wall tech jump", () => {
    each((frame, actionFrame) => {
      const r = recover(context(walled(-fx(20), frame, actionFrame), L9));
      expect(held(r.input, Btn.Jump), `frame ${frame}, actionFrame ${actionFrame}`).toBe(true);
    });
  });

  it("holds it from just under the ledge's height, and not at it or above", () => {
    each((frame, actionFrame) => {
      expect(held(recover(context(walled(-1, frame, actionFrame), L9)).input, Btn.Jump)).toBe(true);
      const level = recover(context(walled(0, frame, actionFrame), L9));
      expect(held(level.input, Btn.Jump) || held(level.input, Btn.Up), `frame ${frame}, actionFrame ${actionFrame}`).toBe(false);
      const above = recover(context(walled(fx(2), frame, actionFrame), L9));
      expect(held(above.input, Btn.Jump) || held(above.input, Btn.Up)).toBe(false);
    });
  });

  it("and no other behaviour turns it into one there: the whole decision holds neither", () => {
    // The opponent above and close: `attack`'s up aerial (Up held) would otherwise win.
    for (let actionFrame = 0; actionFrame < WALL_TECH_JUMP_FRAMES; actionFrame++) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = walled(fx(2), seed, actionFrame, { x: fx(-80), y: fx(20), grounded: false });
        const d = decideCpu(s, 0, 9, seed, { stage: DEFAULT_STAGE_VIEW, jumps: 1 });
        expect(held(d.input, Btn.Jump) || held(d.input, Btn.Up), `seed ${seed}, actionFrame ${actionFrame}`).toBe(false);
      }
    }
  });

  it("forgets it when its recovery roll fails, as a low level does", () => {
    each((frame, actionFrame) => {
      const r = recover(context(walled(-fx(20), frame, actionFrame), L1, rollsWith(ROLL_RECOVER, 0.5)));
      expect(held(r.input, Btn.Jump) || held(r.input, Btn.Up), `frame ${frame}, actionFrame ${actionFrame}`).toBe(false);
    });
  });

  it("is done with the wall tech once its jump frames are over", () => {
    // `recover`'s ordinary drift: a full hop's pulse is off on frame 5.
    const r = recover(context(walled(-fx(20), 5, WALL_TECH_JUMP_FRAMES), L9));
    expect(held(r.input, Btn.Jump)).toBe(false);
  });
});

/* -------------------------------------------------- the dials, against what happens -- */

/**
 * Ruling R-T18e: a dial is tested against what the CPU does, not just the
 * table. Over a fixed set of seeds, a real slow tumble onto Final Destination
 * (and the fall after a tumble's hitstun) techs at each level within 0.08 of
 * `techSkill`; a droppable shield parries a swing it can time within 0.08 of
 * `parrySkill`. UNVERIFIED: the rows are tuning (`cpu.ts`).
 */
describe("the level table's defence dials", () => {
  const TOLERANCE = 0.08;
  const SEEDS = 200;

  it("never tech or parry at level 1, and rise with the level", () => {
    expect([L1.techSkill, L1.parrySkill]).toEqual([0, 0]);
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const previous = tuningForLevel(level - 1);
      const current = tuningForLevel(level);
      expect(current.techSkill, `techSkill at level ${level}`).toBeGreaterThanOrEqual(previous.techSkill);
      expect(current.parrySkill, `parrySkill at level ${level}`).toBeGreaterThanOrEqual(previous.parrySkill);
    }
  });

  /** Whether Mario techs the landing `start` comes down to, a level-`level` CPU with `seed`. */
  function techs(start: GameState, level: number, seed: number): boolean {
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    let s = start;
    let cs = seed;
    let prev: InputFrame[] = [0, 0];
    for (let i = 0; i < 120 && !s.fighters[0].grounded; i++) {
      const c = cpuInput(s, 0, level, cs, world);
      cs = c.seed;
      s = step(s, [c.input, 0], { prevInputs: prev }).state;
      prev = [c.input, 0];
    }
    return s.fighters[0].action === "tech" || s.fighters[0].action === "techRoll";
  }

  it.each([
    ["a tumble", () => tumbling(20, 40)],
    ["a tumble's fall", () => fallingAfter(20, 40)],
  ])("techs %s at each level's techSkill, within 0.08", (_name, start) => {
    // Twice the parry's seeds (Plan 5, Task 19): the decision falls deep in a fall,
    // so the seed chain to it moves with the roll layout, and 200 left a level 2.3
    // standard deviations out (level 6, 84/200) when nine behaviours joined.
    const seeds = 2 * SEEDS;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      let n = 0;
      for (let seed = 1; seed <= seeds; seed++) if (techs(start(), level, seed)) n++;
      expect(Math.abs(n / seeds - tuningForLevel(level).techSkill), `level ${level}: ${n}/${seeds}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("parries a swing it can time at each level's parrySkill, within 0.08", () => {
    // Donkey Kong's forward smash, past its hold: each level decides on the first frame it can.
    const F = firstLive("donkeyKong", "fsmash");
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const t = tuningForLevel(level);
      const s = swingAt("donkeyKong", "fsmash", Math.max(F - 1 - PARRY_AIM, t.reactionFrames));
      const world = cpuWorldFromDef(defOf("mario"), DEFAULT_STAGE_VIEW, [defOf("mario"), defOf("donkeyKong")]);
      let n = 0;
      for (let seed = 1; seed <= SEEDS; seed++) if (decideCpu(s, 0, level, seed, world).behaviour === "parry") n++;
      const can = F - (Math.max(F - 1 - PARRY_AIM, t.reactionFrames) + 1) >= 0;
      expect(Math.abs(n / SEEDS - (can ? t.parrySkill : 0)), `level ${level}: ${n}/${SEEDS}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("pins the rows themselves (UNVERIFIED: tuning), so a re-tune is a deliberate edit", () => {
    const rows = Array.from({ length: MAX_LEVEL }, (_, i) => tuningForLevel(i + 1));
    expect(rows.map((t) => t.techSkill)).toEqual([0, 0.05, 0.12, 0.22, 0.35, 0.5, 0.65, 0.8, 0.95]);
    expect(rows.map((t) => t.parrySkill)).toEqual([0, 0, 0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5]);
    // Plan 5, Task 19: the plan's specials row, climbing as `moveChoiceSkill` does.
    expect(rows.map((t) => t.specialSkill)).toEqual([0, 0.05, 0.12, 0.22, 0.35, 0.5, 0.65, 0.8, 0.95]);
  });

  it("keeps the roll layout fixed: nine decision rolls, then one jitter per behaviour", () => {
    // Plan 5, Task 19: the specials' roll is the ninth (`ROLL_SPECIAL`), and nine behaviours joined.
    expect([DECISION_ROLLS, ROLL_TECH, ROLL_PARRY, ROLL_SPECIAL]).toEqual([9, 6, 7, 8]);
    expect(BEHAVIOURS.length).toBe(22);
  });
});

/* ------------------------------------------------------------ real matches -- */

describe("a level-9 CPU in a real match", () => {
  it("techs a tumble onto Final Destination", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 21);
    // Early in its reel, so Plan 3's hitstun cancel is still shut and the press is a tech.
    Object.assign(s.fighters[0], { action: "tumble", actionFrame: 5, grounded: false, platform: -1, x: fx(10), y: fx(30), vy: fx(-2), hitstun: 40, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(60), y: 0, intangible: 0 });
    // The CPU runs its own fall by its definition (fix round 1): the world is the game's.
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    let seed = 7;
    let prev: InputFrame[] = [0, 0];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      seen.add(s.fighters[0].action);
    }
    expect(seen.has("tech") || seen.has("techRoll")).toBe(true);
    expect(seen.has("downed")).toBe(false);
  });
});

describe("a level-9 CPU in a real match, beyond the plan's text", () => {
  /** Mario (port 0, level 9) against `foe` on Final Destination; what Mario did, frame by frame. */
  function play(setup: (s: GameState) => void, frames: number, watch?: (before: GameState, after: GameState, i: number) => void, foe = "fox", foeKeys: (i: number) => InputFrame = () => 0, seed = 7): { actions: string[]; wallTechJumps: number } {
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: foe }], RULES, 21);
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(-40), y: 0, intangible: 0 });
    setup(s);
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf(foe)]);
    let cs = seed;
    let prev: InputFrame[] = [0, 0];
    const actions: string[] = [];
    let wallTechJumps = 0;
    for (let i = 1; i <= frames; i++) {
      const c = cpuInput(s, 0, 9, cs, world);
      cs = c.seed;
      const now = [c.input, foeKeys(i)];
      const out = step(s, now, { prevInputs: prev });
      for (const j of out.events.jumps) if (j.port === 0 && j.from === "wall" && s.fighters[0].action === "techWall") wallTechJumps++;
      watch?.(s, out.state, i);
      s = out.state;
      prev = now;
      actions.push(s.fighters[0].action);
    }
    return { actions, wallTechJumps };
  }

  it("techs a tumble's fall onto Final Destination with a neutral air dodge (ruling P5-R20)", () => {
    const { actions } = play((s) => {
      // Its hitstun over: the press is an air dodge, which techs the floor it meets.
      Object.assign(s.fighters[0], { action: "tumbleFall", actionFrame: 1, grounded: false, platform: -1, x: fx(10), y: fx(40), hitstun: 0, intangible: 0 });
    }, 60);
    expect(actions).toContain("airDodge");
    expect(actions.includes("tech") || actions.includes("techRoll")).toBe(true);
    expect(actions).not.toContain("downed");
  });

  it("air-dodges out of a slow reel high over the stage on the frame the engine's cancel opens", () => {
    let opened = -1;
    let dodged = -1;
    const { actions } = play((s) => {
      Object.assign(s.fighters[0], { action: "tumble", actionFrame: 20, grounded: false, platform: -1, x: fx(0), y: fx(120), hitstun: 60, intangible: 0, invincible: 0 });
      kineticLaunch(s.fighters[0], 0, fx(0.5), fx(0.5));
    }, 40, (before, after, i) => {
      if (opened < 0 && before.fighters[0].actionFrame + 1 >= HITSTUN_CANCEL_AIR_DODGE_FRAME) opened = i;
      if (dodged < 0 && after.fighters[0].action === "airDodge") dodged = i;
    });
    expect(actions).toContain("airDodge");
    expect(dodged).toBe(opened);
  });

  /**
   * Mario holds his shield up (droppable) until the swing is his to see; from
   * then on the level-9 CPU decides. Whenever it decides to parry, the engine
   * parries the swing on its first live frame; and over the seeds it does.
   */
  function parryScene(foe: string, keys: (i: number) => InputFrame, F: number): { parries: number; decisions: number } {
    let parries = 0;
    let decisions = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: foe }], RULES, 21);
      Object.assign(s.fighters[0], { x: 0, facing: 1, action: "shield", actionFrame: 10, intangible: 0, invincible: 0 });
      Object.assign(s.fighters[1], { x: fx(16), facing: -1, intangible: 0, invincible: 0 });
      const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf(foe)]);
      let cs = seed;
      let prev: InputFrame[] = [Btn.Shield, 0];
      let decided = false;
      let parriedOn = -1;
      for (let i = 1; i <= 40; i++) {
        let input: InputFrame = Btn.Shield;
        const sw = s.fighters[1];
        if ((sw.action === "attack" || sw.action === "special") && sw.actionFrame >= L9.reactionFrames) {
          const d = decideCpu(s, 0, 9, cs, world);
          cs = d.seed;
          input = d.input;
          if (d.behaviour === "parry") decided = true;
        }
        const out = step(s, [input, keys(i)], { prevInputs: prev });
        prev = [input, keys(i)];
        if (parriedOn < 0 && out.events.shieldHits.some((h) => h.victim === 0) && out.state.fighters[0].action === "shieldRelease") parriedOn = out.state.fighters[1].actionFrame;
        s = out.state;
      }
      if (decided) {
        decisions++;
        expect(parriedOn, `seed ${seed}: parried on the swing's first live frame`).toBe(F);
        parries++;
      }
    }
    return { parries, decisions };
  }

  // Donkey Kong's forward smash, flicked and let go: first live on 21, its hold on 13.
  // (Mario's and Marth's, on the test registry's boxes, do not reach a shield 16 away.)
  it("parries a slow swing (Donkey Kong's forward smash) on its first active frame", () => {
    const { parries } = parryScene("donkeyKong", (i) => (i === 8 ? Btn.Left | Btn.Attack : 0), firstLive("donkeyKong", "fsmash"));
    expect(parries).toBeGreaterThan(0);
  });

  it("parries a fast swing (Link's jab)", () => {
    const { parries } = parryScene("link", (i) => (i === 8 ? Btn.Attack : 0), firstLive("link", "jab1"));
    expect(parries).toBeGreaterThan(0);
  });

  it("never lets go of a shield it raised on sight before the engine could drop it", () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "donkeyKong" }], RULES, 21);
      Object.assign(s.fighters[0], { x: 0, facing: 1, intangible: 0, invincible: 0 });
      Object.assign(s.fighters[1], { x: fx(16), facing: -1, intangible: 0, invincible: 0 });
      const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("donkeyKong")]);
      let cs = seed;
      let prev: InputFrame[] = [0, 0];
      for (let i = 1; i <= 50; i++) {
        const keys = i === 2 ? Btn.Left | Btn.Attack : 0;
        const d = decideCpu(s, 0, 9, cs, world);
        cs = d.seed;
        const me = s.fighters[0];
        if (d.behaviour === "parry") expect(me.action === "shield" && me.actionFrame + 1 >= SHIELD_MIN_HOLD, `seed ${seed}, frame ${i}`).toBe(true);
        s = step(s, [d.input, keys], { prevInputs: prev }).state;
        prev = [d.input, keys];
      }
    }
  });

  it("wall-tech-jumps off Final Destination's side below the ledge (the Task 10 carry)", () => {
    const { actions, wallTechJumps } = play((s) => {
      // The tech lab's wall tumble (`goldenLab.ts`), its shield pressed on the way in.
      Object.assign(s.fighters[0], { action: "tumble", actionFrame: 0, grounded: false, platform: -1, x: fx(100), y: fx(-20), hitstun: 60, intangible: 0, invincible: 0 });
      kineticLaunch(s.fighters[0], -fx(4), 0, fx(4));
      Object.assign(s.fighters[0].combat, { techWindow: TECH_WINDOW, techLockout: TECH_LOCKOUT });
    }, 30);
    expect(actions).toContain("techWall");
    expect(wallTechJumps).toBe(1);
  });
});

/* ------------------------------------------- the shield, one decision a threat -- */

/**
 * Ruling R-T18g (Task 18's fix round 1 carry, Task 19's item 11): `shield` rolled its
 * dial every frame and let go of a held shield mid-swing, so against Donkey Kong's
 * smash levels 6-8 were hit in that drop 283, 294 and 107 times in 300. Now it decides
 * once a threat, on the first frame it sees the swing or grab in range, and holds a
 * shield it raised until the swing is over.
 */
describe("shield, once a threat (ruling R-T18g)", () => {
  /** Mario standing (or shielding) with Donkey Kong 20 away in his forward smash at `actionFrame`. */
  const threat = (actionFrame: number, self: Partial<FighterState> = {}) =>
    makeState({
      fighters: [
        makeFighter({ port: 0, actionFrame: 30, ...self }),
        makeFighter({ port: 1, defId: "donkeyKong", x: fx(20), facing: -1, action: "attack", move: "fsmash", actionFrame }),
      ],
    });

  it("decides on the first frame it sees the swing in range, and on no frame after", () => {
    const decidedOn: number[] = [];
    for (let a = 0; a < 40; a++) if (shield(context(threat(a), L9)).score > 0) decidedOn.push(a);
    expect(decidedOn).toEqual([L9.reactionFrames]);
  });

  it("a failed roll leaves the shield down for that swing", () => {
    for (let a = 0; a < 40; a++) expect(shield(context(threat(a), L9, rollsWith(ROLL_SHIELD, 0.99))).score, `frame ${a}`).toBe(0);
  });

  it("holds a shield it raised through the swing, whatever its roll, and lets go once the swing is over", () => {
    for (const a of [10, 20, 30]) {
      const r = shield(context(threat(a, { action: "shield", actionFrame: 6 }), L9, rollsWith(ROLL_SHIELD, 0.99)));
      expect([r.score > 0, r.input], `frame ${a}`).toEqual([true, Btn.Shield]);
    }
    const over = makeState({ fighters: [makeFighter({ port: 0, action: "shield", actionFrame: 30 }), makeFighter({ port: 1, defId: "donkeyKong", x: fx(20), facing: -1, action: "stand", actionFrame: 10 })] });
    expect(shield(context(over, L9)).score).toBe(0);
  });

  it("decides once as a swing first comes into range, for one already seen further off", () => {
    // A dash attack closing at 1.5 a frame, seen where it was 4 frames ago (the
    // level's reaction): 30 away now, 31.5 the frame before, in range for the first
    // time; a frame later, in range already.
    const at = (x: number, vx: number) =>
      makeState({
        fighters: [makeFighter({ port: 0, actionFrame: 30 }), makeFighter({ port: 1, defId: "donkeyKong", x: fx(x), vx: fx(vx), facing: -1, action: "attack", move: "dashAttack", actionFrame: 12 })],
      });
    expect(shield(context(at(24, -1.5), L9)).score).toBeGreaterThan(0);
    expect(shield(context(at(22.5, -1.5), L9)).score).toBe(0);
  });

  /**
   * Donkey Kong's forward smash at a standing Mario 14 away, as the engine runs it,
   * from the frame the level first sees it (its reaction time into the swing): a
   * level's shield is one roll a swing, held through it, so the share of swings it
   * blocks is the dial (within 0.1, a parry being a block too), and it is never hit
   * in a drop of a shield it raised (Task 18's measure: levels 6-8, 283, 294 and 107
   * times in 300).
   */
  it("against Donkey Kong's forward smash, blocks at its shieldRate and is never hit in the drop", () => {
    const SEEDS = 120;
    for (const level of [5, 6, 7, 8, 9]) {
      const t = tuningForLevel(level);
      let blocked = 0;
      let hitInDrop = 0;
      const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("donkeyKong")]);
      for (let seed = 1; seed <= SEEDS; seed++) {
        let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "donkeyKong" }], RULES, 21);
        Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x: 0, y: 0, intangible: 0, facing: 1 });
        Object.assign(s.fighters[1], { action: "attack", move: "fsmash", actionFrame: t.reactionFrames, grounded: true, platform: 0, x: fx(14), y: 0, intangible: 0, facing: -1 });
        s.fighters[1].combat.smashLetGo = true;
        let cs = seed;
        let prev: InputFrame[] = [0, 0];
        for (let i = 0; i < 70; i++) {
          const c = cpuInput(s, 0, level, cs, world);
          cs = c.seed;
          const dk = 0;
          const now = [c.input, dk];
          const out = step(s, now, { prevInputs: prev });
          prev = now;
          if (out.events.shieldHits.some((h) => h.victim === 0)) blocked++;
          if (out.events.hits.some((h) => h.victim === 0) && s.fighters[0].action === "shieldRelease") hitInDrop++;
          s = out.state;
          if (out.events.shieldHits.some((h) => h.victim === 0) || out.events.hits.some((h) => h.victim === 0)) break;
        }
      }
      expect(hitInDrop, `level ${level}: hit in a drop`).toBe(0);
      expect(Math.abs(blocked / SEEDS - t.shieldRate), `level ${level}: ${blocked}/${SEEDS} blocked`).toBeLessThanOrEqual(0.1);
    }
  });
});

/* --------------------------------------------------- a deliberate wall tech -- */

describe("a wall tech (the Task 18 review's carry, item 10)", () => {
  it("decides a tech for a tumble into the stage's wall, as for a floor", () => {
    // Mario tumbling right into Final Destination's left wall, under its ledge.
    const s = tumbling(-100, -25, { vx: 2.5, vy: 0.2 });
    const decided: number[] = [];
    let state = s;
    for (let k = 0; k < 40 && state.fighters[0].action === "tumble"; k++) {
      if (tech(context(state, L9, undefined, FD)).score > 0) decided.push(k);
      state = quiet(state);
    }
    expect(decided.length).toBe(1);
  });

  it("meets the stage's side only between its top and its bottom, from outside it", () => {
    const below = tumbling(-100, -90, { vx: 2.5, vy: 0 });
    expect(framesToWall(defOf("mario"), below.fighters[0], FD, below.frame, TECH_LEAD * 3)).toBeNull();
    const beside = tumbling(-100, -25, { vx: 2.5, vy: 0.2 });
    expect(framesToWall(defOf("mario"), beside.fighters[0], FD, beside.frame, TECH_LEAD * 3)).not.toBeNull();
  });

  it("a level-9 CPU tumbling into the wall techs it, and wall-tech-jumps below the ledge", () => {
    let s = tumbling(-100, -25, { vx: 2.5, vy: 0.2 });
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    let seed = 3;
    let prev: InputFrame[] = [0, 0];
    const seen = new Set<string>();
    let wallJumps = 0;
    for (let i = 0; i < 60; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const out = step(s, [c.input, 0], { prevInputs: prev });
      prev = [c.input, 0];
      s = out.state;
      seen.add(s.fighters[0].action);
      wallJumps += out.events.jumps.filter((j) => j.port === 0 && j.from === "wall").length;
    }
    expect(seen.has("techWall")).toBe(true);
    expect(wallJumps).toBe(1);
  });
});
