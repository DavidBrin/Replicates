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
  HITSTUN_CANCEL_AIR_DODGE_FRAME,
  HITSTUN_CANCEL_AIR_DODGE_SPEED,
  LAUNCH_SPEED_DECAY,
  SHIELD_MIN_HOLD,
  TECH_LOCKOUT,
  TECH_WINDOW,
} from "@/engine/constants";
import { fx, nextRandom } from "@/engine/fixed";
import { actionFrameOf } from "@/engine/hitbox";
import { kineticLaunch } from "@/engine/kinetic";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { WALL_TECH_JUMP_FRAMES } from "@/engine/wallJump";
import { Btn, held, type FighterDef, type FighterState, type GameState, type InputFrame, type MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter, makeState } from "@/render/testFixtures";
import {
  BEHAVIOURS,
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  MELEE_RANGE,
  PARRY_AIM,
  ROLL_PARRY,
  ROLL_RECOVER,
  ROLL_TECH,
  TECH_LEAD,
  THREAT_RANGE,
  escape,
  framesToFloor,
  observe,
  parry,
  recover,
  stageViewFromDef,
  swingHitFrame,
  tech,
  type BehaviourContext,
  type LevelTuning,
  type StageView,
} from "./behaviours";
import { MAX_LEVEL, cpuInput, cpuWorldFromDef, decideCpu, tuningForLevel } from "./cpu";

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
 * well away. `hitstun` to go, `actionFrame` into the reel.
 */
function tumbling(x: number, y: number, o: { stage?: string; vx?: number; vy?: number; hitstun?: number; actionFrame?: number } = {}): GameState {
  const s = createInitialState(o.stage ?? "finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 21);
  Object.assign(s.fighters[0], { action: "tumble", actionFrame: o.actionFrame ?? 0, grounded: false, platform: -1, x: fx(x), y: fx(y), hitstun: o.hitstun ?? 60, intangible: 0, invincible: 0 });
  const vx = fx(o.vx ?? 0);
  const vy = fx(o.vy ?? -0.5);
  kineticLaunch(s.fighters[0], vx, vy, Math.abs(vx) + Math.abs(vy));
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(-60), y: stageOf(o.stage ?? "finalDestination").platforms[0].y, intangible: 0 });
  return s;
}

/** Mario falling from rest after a tumble's hitstun (`tumbleFall`). */
function fallingAfter(x: number, y: number, stage = "finalDestination"): GameState {
  const s = tumbling(x, y, { stage, hitstun: 0 });
  Object.assign(s.fighters[0], { action: "tumbleFall", actionFrame: 1, hitstun: 0 });
  kineticLaunch(s.fighters[0], 0, 0, 0);
  return s;
}

const quiet = (s: GameState): GameState => step(s, [0, 0], { prevInputs: [0, 0] }).state;

/** Steps, with nothing pressed, until Mario stands on something: the engine's own answer. */
function landsIn(s: GameState): number {
  for (let k = 1; k <= 300; k++) {
    s = quiet(s);
    if (s.fighters[0].grounded) return k;
  }
  return -1;
}

/** Every frame of the approach on which `tech` presses, as the engine's frames to the floor then. */
function decisionsOver(s: GameState, ctx: (s: GameState) => BehaviourContext): number[] {
  const out: number[] = [];
  while (!s.fighters[0].grounded) {
    if (tech(ctx(s)).score > 0) out.push(landsIn(s));
    s = quiet(s);
  }
  return out;
}

/** As `decisionsOver`, with each decided press applied: what the CPU's own presses make of the approach. */
function decisionsPressing(s: GameState, ctx: (s: GameState) => BehaviourContext): number[] {
  const out: number[] = [];
  let prev: InputFrame = 0;
  while (!s.fighters[0].grounded) {
    const r = tech(ctx(s));
    if (r.score > 0 && r.input !== 0) out.push(landsIn(s));
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

  it("does not, while the floor is still far off", () => {
    expect(tech(context(atLandsIn(tumbling(20, 40), TECH_LEAD + 1), L9, undefined, FD)).score).toBe(0);
    expect(tech(context(tumbling(20, 60, { actionFrame: 5 }), L9, undefined, FD)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    expect(tech(context(s, L1, undefined, FD)).score).toBe(0);
    expect(tech(context(s, L9, rollsWith(ROLL_TECH, 0.99), FD)).score).toBe(0);
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
    expect(tech(context(s, L9, undefined, FD)).score).toBe(0);
  });

  it("does not press again into a window that is open, or locked out", () => {
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    // A press opens both, and they count down together (`updateTechInput`): 8 frames ago.
    s.fighters[0].combat = { ...s.fighters[0].combat, techWindow: TECH_WINDOW - 8, techLockout: TECH_LOCKOUT - 8 };
    expect(tech(context(s, L9, undefined, FD)).score).toBe(0);
    s.fighters[0].combat = { ...s.fighters[0].combat, techWindow: 0, techLockout: 12 };
    expect(tech(context(s, L9, undefined, FD)).score).toBe(0);
  });

  it("takes the frame outright: its roll is the chance, so no jitter or fumble undoes it", () => {
    // Level 5: noise 0.5 and a fumble of 0.11, which would cost a press about half the time.
    const L5 = tuningForLevel(5);
    const s = atLandsIn(tumbling(20, 40), TECH_LEAD);
    const world = cpuWorldFromDef(defOf("mario"), FD, [defOf("mario"), defOf("fox")]);
    let presses = 0;
    let rolledIn = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const d = decideCpu(s, 0, 5, seed, world);
      if (d.behaviour === "tech") {
        presses++;
        expect(held(d.input, Btn.Shield)).toBe(true);
      }
      if (tech(context(s, L5, rollsOf(seed), FD)).score > 0) rolledIn++;
    }
    expect(presses).toBe(rolledIn);
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

  it("decides again after a floor bounce, for the approach the bounce starts", () => {
    // Launched shallow, over a floor bounce's 0.8, with nothing pressed: the first
    // touch bounces it, low, so the next approach starts inside the reach.
    let s = tumbling(20, 3, { vx: 1, vy: -0.3 });
    while (!(s.fighters[0].vy > 0 && s.fighters[0].y === stageOf("finalDestination").platforms[0].y)) s = quiet(s);
    expect(s.fighters[0].action).toBe("tumble");
    const n = landsIn(s);
    expect(n).toBeLessThan(TECH_LEAD);
    expect(decisionsOver(s, ctx)).toEqual([n]);
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
    let s = tumbling(20, 40, { actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1 - (landsIn(tumbling(20, 40)) - TECH_LEAD) });
    s = atLandsIn(s, TECH_LEAD);
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

  it("leaves a landing within a tech's reach to tech: one roll for it", () => {
    const s = atLandsIn(tumbling(20, 40, { actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1 - 30 }), TECH_LEAD);
    const near = { ...s, fighters: s.fighters.map((f, i) => (i === 0 ? { ...f, actionFrame: HITSTUN_CANCEL_AIR_DODGE_FRAME - 1 } : f)) };
    expect(escape(context(near, L9, undefined, FD)).score).toBe(0);
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

  it("only at a swing within THREAT_RANGE", () => {
    // Marth's Dancing Blade reaches 21.5 in front of him, a shield 10 more: the range is what stops it.
    const at = firstLive("marth", "sideB") - 1 - PARRY_AIM;
    expect(parry(context(swingAt("marth", "sideB", at, {}, { action: "special", x: THREAT_RANGE }), L9)).score).toBeGreaterThan(0);
    expect(parry(context(swingAt("marth", "sideB", at, {}, { action: "special", x: THREAT_RANGE + 1 }), L9)).score).toBe(0);
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
    for (let level = 1; level <= MAX_LEVEL; level++) {
      let n = 0;
      for (let seed = 1; seed <= SEEDS; seed++) if (techs(start(), level, seed)) n++;
      expect(Math.abs(n / SEEDS - tuningForLevel(level).techSkill), `level ${level}: ${n}/${SEEDS}`).toBeLessThanOrEqual(TOLERANCE);
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
  });

  it("keeps the roll layout fixed: eight decision rolls, then one jitter per behaviour", () => {
    expect([DECISION_ROLLS, ROLL_TECH, ROLL_PARRY]).toEqual([8, 6, 7]);
    expect(BEHAVIOURS.length).toBe(12);
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
