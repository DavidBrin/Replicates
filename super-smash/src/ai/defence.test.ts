/**
 * The CPU's Plan 5 defence (Task 18): tech the landing, air-dodge out of
 * hitstun when Plan 3's cancel allows it, and parry by letting go of the
 * shield as a swing starts. Pure functions of their context, gated by the
 * level's dials like every other behaviour.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_AIR_DODGE } from "@/engine/airDodge";
import { emptyCombat } from "@/engine/combat";
import { AIR_DODGE_TECH_FRAMES, HITSTUN_CANCEL_AIR_DODGE_FRAME, HITSTUN_CANCEL_AIR_DODGE_SPEED, TECH_LOCKOUT, TECH_WINDOW } from "@/engine/constants";
import { fx } from "@/engine/fixed";
import { kineticLaunch } from "@/engine/kinetic";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { WALL_TECH_JUMP_FRAMES } from "@/engine/wallJump";
import { Btn, held, type FighterState, type GameState, type InputFrame } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter, makeState } from "@/render/testFixtures";
import {
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  MELEE_RANGE,
  PARRY_LEAD,
  THREAT_RANGE,
  ROLL_PARRY,
  ROLL_RECOVER,
  ROLL_TECH,
  escape,
  observe,
  parry,
  recover,
  stageViewFromDef,
  tech,
  type BehaviourContext,
  type LevelTuning,
} from "./behaviours";
import { MAX_LEVEL, cpuInput, cpuWorldFromDef, decideCpu, tuningForLevel } from "./cpu";

function context(state: GameState, tuning: LevelTuning, rolls: number[] = new Array(DECISION_ROLLS).fill(0)): BehaviourContext {
  return {
    state,
    view: observe(state, 0, tuning.reactionFrames),
    stage: DEFAULT_STAGE_VIEW,
    tuning,
    jumps: 1,
    meleeReach: MELEE_RANGE,
    airBrake: 0,
    airDodge: DEFAULT_AIR_DODGE,
    recovery: null,
    rolls,
  };
}

const L9 = tuningForLevel(9);
const L1 = tuningForLevel(1);

describe("tech", () => {
  const falling = () => makeState({ fighters: [makeFighter({ port: 0, action: "tumble", actionFrame: 10, grounded: false, x: fx(20), y: fx(6), vy: fx(-1.5), hitstun: 10 }), makeFighter({ port: 1, x: fx(60) })] });

  it("presses shield toward the middle just before a tumble lands", () => {
    const r = tech(context(falling(), L9));
    expect(r.score).toBeGreaterThan(1000);
    expect(held(r.input, Btn.Shield)).toBe(true);
    expect(held(r.input, Btn.Left)).toBe(true);
  });

  it("does not, while the floor is still far off", () => {
    const s = falling();
    s.fighters[0].y = fx(60);
    expect(tech(context(s, L9)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    expect(tech(context(falling(), L1)).score).toBe(0);
    const rolls = new Array(DECISION_ROLLS).fill(0);
    rolls[ROLL_TECH] = 0.99;
    expect(tech(context(falling(), L9, rolls)).score).toBe(0);
  });
});

describe("escape", () => {
  it("air-dodges out of hitstun once the cancel is open", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, y: fx(80), hitstun: 20, actionFrame: 45, launchSpeed: fx(1) }), makeFighter({ port: 1, x: fx(60) })] });
    const frames = Array.from({ length: 4 }, (_, i) => escape(context({ ...s, frame: i }, L9)).input);
    expect(frames.some((i) => held(i, Btn.Shield))).toBe(true);
  });

  it("waits while the cancel is shut", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, y: fx(80), hitstun: 20, actionFrame: 20, launchSpeed: fx(1) }), makeFighter({ port: 1, x: fx(60) })] });
    expect(escape(context(s, L9)).score).toBe(0);
  });
});

describe("escape, beyond the plan's text", () => {
  const reeling = (over: Partial<FighterState> = {}) =>
    makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, platform: -1, y: fx(80), hitstun: 20, actionFrame: 45, launchSpeed: fx(1), ...over }), makeFighter({ port: 1, x: fx(60) })] });

  it("waits while the launch is still as fast as the cancel's bar", () => {
    expect(escape(context(reeling({ launchSpeed: HITSTUN_CANCEL_AIR_DODGE_SPEED }), L9)).score).toBe(0);
    expect(escape(context(reeling({ launchSpeed: HITSTUN_CANCEL_AIR_DODGE_SPEED - 1 }), L9)).score).toBeGreaterThan(0);
  });

  it("not with its air dodge spent, on the ground, or out of hitstun", () => {
    expect(escape(context(reeling({ airDodged: true }), L9)).score).toBe(0);
    expect(escape(context(reeling({ grounded: true }), L9)).score).toBe(0);
    expect(escape(context(reeling({ hitstun: 0 }), L9)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    expect(escape(context(reeling(), L1)).score).toBe(0);
    expect(escape(context(reeling(), L9, rollsWith(ROLL_TECH, 0.99))).score).toBe(0);
  });

  it("outscores survive's DI, which would otherwise hold the stick through the cancel", () => {
    expect(escape(context(reeling(), L9)).score).toBeGreaterThan(1000);
  });
});

describe("parry, beyond the plan's text", () => {
  const swing = (self: Partial<FighterState>, other: Partial<FighterState> = {}) =>
    makeState({ fighters: [makeFighter({ port: 0, action: "shield", ...self }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L9.reactionFrames + PARRY_LEAD, ...other })] });

  it("only from a shield it holds, out of shieldstun, at a swing in reach", () => {
    expect(parry(context(swing({}), L9)).score).toBeGreaterThan(0);
    expect(parry(context(swing({ action: "stand" }), L9)).score).toBe(0);
    expect(parry(context(swing({ action: "shieldStun", hitstun: 4 }), L9)).score).toBe(0);
    expect(parry(context(swing({}, { x: THREAT_RANGE + fx(1) }), L9)).score).toBe(0);
    expect(parry(context(swing({}, { action: "stand", move: null }), L9)).score).toBe(0);
  });

  it("only on the frame PARRY_LEAD after the swing is seen", () => {
    expect(parry(context(swing({}, { actionFrame: L9.reactionFrames + PARRY_LEAD + 1 }), L9)).score).toBe(0);
    expect(parry(context(swing({}, { actionFrame: L9.reactionFrames + PARRY_LEAD - 1 }), L9)).score).toBe(0);
  });
});

describe("parry", () => {
  it("lets go of the shield the frame after it sees a swing start", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "shield" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L9.reactionFrames + 1 })] });
    const r = parry(context(s, L9));
    expect(r.score).toBeGreaterThan(600);
    expect(r.input).toBe(0);
  });

  it("is a read only good CPUs make, and not every time", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "shield" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L1.reactionFrames + 1 })] });
    expect(parry(context(s, L1)).score).toBe(0);
    const rolls = new Array(DECISION_ROLLS).fill(0);
    rolls[ROLL_PARRY] = 0.6;
    const nine = makeState({ fighters: [makeFighter({ port: 0, action: "shield" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L9.reactionFrames + 1 })] });
    expect(parry(context(nine, L9, rolls)).score).toBe(0);
  });
});

describe("a level-9 CPU in a real match", () => {
  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  it("techs a tumble onto Final Destination", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 21);
    // Early in its reel, so Plan 3's hitstun cancel is still shut and the press is a tech.
    Object.assign(s.fighters[0], { action: "tumble", actionFrame: 5, grounded: false, platform: -1, x: fx(10), y: fx(30), vy: fx(-2), hitstun: 40, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(60), y: 0, intangible: 0 });
    const world = { stage: stageViewFromDef(STAGES.find((x) => x.id === "finalDestination")!), jumps: 2 };
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

/* --------------------------------------------- beyond the plan's text (Task 18) -- */

const rollsWith = (slot: number, value: number): number[] => {
  const rolls = new Array<number>(DECISION_ROLLS).fill(0);
  rolls[slot] = value;
  return rolls;
};

describe("tech, at the edge of the window", () => {
  const VY = fx(-1.5);
  const at = (height: number) => makeState({ fighters: [makeFighter({ port: 0, action: "tumble", actionFrame: 10, grounded: false, platform: -1, x: fx(20), y: height, vy: VY, hitstun: 10 }), makeFighter({ port: 1, x: fx(60) })] });

  // Pressed now, the window is open for the press's step and the ten after it
  // (`updateTechInput`); two of them are the CPU's margin (UNVERIFIED: tuning).
  it("presses once the floor is TECH_WINDOW - 2 frames off at this speed, and not a unit further", () => {
    const reach = (TECH_WINDOW - 2) * -VY;
    expect(tech(context(at(reach), L9)).score).toBeGreaterThan(1000);
    expect(tech(context(at(reach + 1), L9)).score).toBe(0);
  });

  it("does not press again while a window it opened is still open, or locked out", () => {
    const s = at(fx(6));
    s.fighters[0].combat = { ...emptyCombat(), techWindow: 3 };
    expect(tech(context(s, L9)).score).toBe(0);
    s.fighters[0].combat = { ...emptyCombat(), techLockout: 12 };
    expect(tech(context(s, L9)).score).toBe(0);
  });
});

/**
 * Ruling P5-R20: after the hitstun a tumble is `tumbleFall` (Plan 3, Task 12),
 * where a shield press is an air dodge, and a dodge out of a tumble techs a floor
 * it meets in its first `AIR_DODGE_TECH_FRAMES` frames. A neutral one keeps the
 * fall and comes down into it; one with a direction held is the directional dodge,
 * which can miss the floor (Task 20c). So the press there is a neutral one.
 */
describe("tech, in a tumble's fall (ruling P5-R20)", () => {
  const VY = fx(-1.5);
  const after = (height: number, over: Partial<FighterState> = {}) =>
    makeState({ fighters: [makeFighter({ port: 0, action: "tumbleFall", actionFrame: 3, grounded: false, platform: -1, x: fx(20), y: height, vy: VY, ...over }), makeFighter({ port: 1, x: fx(60) })] });
  const reach = (AIR_DODGE_TECH_FRAMES - 2) * -VY;

  it("presses a neutral shield once the floor is within the dodge's tech frames", () => {
    const r = tech(context(after(reach), L9));
    expect(r.score).toBeGreaterThan(1000);
    expect(r.input).toBe(Btn.Shield);
  });

  it("not while the floor is further off than that", () => {
    expect(tech(context(after(reach + 1), L9)).score).toBe(0);
  });

  it("not with its air dodge spent, while rising, or with no stage under it", () => {
    expect(tech(context(after(fx(6), { airDodged: true }), L9)).score).toBe(0);
    expect(tech(context(after(fx(6), { vy: fx(1) }), L9)).score).toBe(0);
    expect(tech(context(after(fx(6), { x: fx(-100) }), L9)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    expect(tech(context(after(fx(6)), L1)).score).toBe(0);
    expect(tech(context(after(fx(6)), L9, rollsWith(ROLL_TECH, 0.99))).score).toBe(0);
  });
});

/**
 * The floor a tumble comes down on is whatever is under it: Battlefield's soft
 * platforms (`DEFAULT_STAGE_VIEW`: two at 27.2 up, 38.2 either side, 19.4 wide
 * each way; one at 54.5 over the middle) as well as the stage. In the 56-match
 * sweep every lie-down left after the plan's `tech` was on a soft platform.
 */
describe("tech, over a soft platform", () => {
  const VY = fx(-1.5);
  const over = (action: "tumble" | "tumbleFall", x: number, height: number) =>
    makeState({ fighters: [makeFighter({ port: 0, action, actionFrame: 10, grounded: false, platform: -1, x: fx(x), y: fx(27.2) + height, vy: VY, hitstun: action === "tumble" ? 10 : 0 }), makeFighter({ port: 1, x: fx(-60) })] });

  it("presses for the platform under it, not the stage further down", () => {
    expect(tech(context(over("tumbleFall", 38.2, (AIR_DODGE_TECH_FRAMES - 2) * -VY), L9)).input).toBe(Btn.Shield);
    expect(tech(context(over("tumbleFall", 38.2, (AIR_DODGE_TECH_FRAMES - 2) * -VY + 1), L9)).score).toBe(0);
    expect(held(tech(context(over("tumble", 38.2, (TECH_WINDOW - 2) * -VY), L9)).input, Btn.Shield)).toBe(true);
  });

  it("measures to the stage once it is past the platform's end", () => {
    // 19.4 either side of 38.2: at 60 it is clear of the platform, 27.2 + 19.5 up.
    expect(tech(context(over("tumbleFall", 60, (AIR_DODGE_TECH_FRAMES - 2) * -VY), L9)).score).toBe(0);
  });

  it("does not take a platform above it for its floor", () => {
    // Just under the platform, 25 over the stage: too far off the stage for the dodge.
    expect(tech(context(over("tumbleFall", 38.2, -fx(2.2)), L9)).score).toBe(0);
  });

  it("has no floor under the stage: between the ledges but below the stage's surface", () => {
    // Pressed there, the dodge would only spend the frames it needs to recover.
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "tumbleFall", actionFrame: 10, grounded: false, platform: -1, x: 0, y: -fx(20), vy: VY }), makeFighter({ port: 1, x: fx(-60) })] });
    expect(tech(context(s, L9)).score).toBe(0);
  });

  it("comes down on the higher of two platforms it is over", () => {
    // At 19 it is over the right platform (18.8 on) and the top one (to 19.5): the top one, at 54.5, is first.
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "tumbleFall", actionFrame: 10, grounded: false, platform: -1, x: fx(19), y: fx(54.5) + (AIR_DODGE_TECH_FRAMES - 2) * -VY, vy: VY }), makeFighter({ port: 1, x: fx(-60) })] });
    expect(tech(context(s, L9)).input).toBe(Btn.Shield);
  });
});

/**
 * Ruling P5-R21: an air dodge keeps the fighter's drift (Plan 3, Task 20b), so
 * `escape` minds the ledge as `shield` does, over the fighter's own dodge
 * length (`dodgeCarriesOffstage`), and forgets to when its recovery roll fails.
 */
describe("escape, near the ledge (ruling P5-R21)", () => {
  const reeling = (x: number, vx: number) =>
    makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, platform: -1, x: fx(x), y: fx(30), vx: fx(vx), hitstun: 20, actionFrame: 45, launchSpeed: fx(1) }), makeFighter({ port: 1, x: fx(60) })] });
  const presses = (s: GameState, tuning: LevelTuning, rolls?: number[]) =>
    Array.from({ length: 4 }, (_, i) => escape(context({ ...s, frame: i }, tuning, rolls))).some((r) => r.score > 0 && held(r.input, Btn.Shield));

  // Mario's neutral dodge is 52 frames (`DEFAULT_AIR_DODGE`): 1.2 a frame with no
  // air friction carries 62.4, so from x -66 out past Battlefield's -80.
  it("does not air-dodge out of hitstun when the dodge's drift would carry it off the stage", () => {
    expect(escape(context(reeling(-66, -1.2), L9)).score).toBe(0);
    expect(presses(reeling(-66, 1.2), L9)).toBe(true);
  });

  it("forgets the ledge when its recovery roll fails, as a lower level does", () => {
    const L5 = tuningForLevel(5);
    expect(escape(context(reeling(-66, -1.2), L5)).score).toBe(0);
    expect(presses(reeling(-66, -1.2), L5, rollsWith(ROLL_RECOVER, L5.recoverySkill))).toBe(true);
  });
});

/**
 * The CPU's input for a state is read on the next step, one frame further into
 * the reel (`advanceFighter` counts the frame before the status runs). So the
 * hitstun cancel is "open" for the CPU one frame before the state shows frame 41:
 * there a tech's press, with its direction, would already be the cancel's
 * directional air dodge (Plan 3, Task 20c), and is `escape`'s neutral one instead.
 */
describe("the hitstun cancel, as the engine reads the CPU's press", () => {
  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
  /** Mario reeling 6 over Final Destination's floor, `actionFrame` into his reel. */
  const reeling = (actionFrame: number): GameState => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 21);
    Object.assign(s.fighters[0], { action: "tumble", actionFrame, grounded: false, platform: -1, x: fx(20), y: fx(6), hitstun: 10, intangible: 0 });
    kineticLaunch(s.fighters[0], 0, -fx(1.5), fx(1.5));
    Object.assign(s.fighters[1], { x: fx(60), intangible: 0 });
    return s;
  };
  const pressed = (s: GameState, input: InputFrame) => step(s, [input, 0], { prevInputs: [0, 0] }).state.fighters[0];

  it("techs with a direction while the next step is still before the cancel", () => {
    const s = reeling(HITSTUN_CANCEL_AIR_DODGE_FRAME - 2);
    const r = tech(context(s, L9));
    expect(r.score).toBeGreaterThan(1000);
    // The engine reads that press as a tech's, not the cancel's dodge.
    expect(pressed(s, r.input).action).toBe("tumble");
  });

  it("leaves it to escape's neutral press once the next step opens the cancel", () => {
    const s = reeling(HITSTUN_CANCEL_AIR_DODGE_FRAME - 1);
    expect(tech(context(s, L9)).score).toBe(0);
    // A tech's directional press there is the cancel's directional air dodge...
    const dodge = pressed(s, Btn.Shield | Btn.Left);
    expect(dodge.action).toBe("airDodge");
    expect(dodge.charge).not.toBe(0);
    // ...and escape presses on one frame in four, with no direction.
    const r = Array.from({ length: 4 }, (_, i) => escape(context({ ...s, frame: i }, L9))).find((x) => held(x.input, Btn.Shield));
    expect(r?.input).toBe(Btn.Shield);
  });
});

/**
 * The Task 10 review's carry: a wall tech's first `WALL_TECH_JUMP_FRAMES` frames
 * read a jump input, the button or Up held, as a wall tech jump (`wallJump.ts`),
 * which gains height and spends no jump. Below the ledge that is the recovery, so
 * the CPU holds jump there; elsewhere it holds neither jump nor Up, which another
 * behaviour's Up would otherwise turn into one.
 */
describe("a wall tech below the ledge (the Task 10 review's carry)", () => {
  /** Against Battlefield's left wall (`DEFAULT_STAGE_VIEW`: ledges at -80, floor 0). */
  const walled = (y: number, frame: number, actionFrame: number) =>
    makeState({ frame, fighters: [makeFighter({ port: 0, action: "techWall", actionFrame, grounded: false, platform: -1, x: fx(-84), y: fx(y), combat: { ...emptyCombat(), wallSide: 1, wallFrames: actionFrame + 1 } }), makeFighter({ port: 1, x: fx(30) })] });
  const each = (fn: (frame: number, actionFrame: number) => void) => {
    // The state's `actionFrame` + 1 is the frame its press is read on (`advanceFighter`).
    for (let actionFrame = 0; actionFrame < WALL_TECH_JUMP_FRAMES; actionFrame++) for (let frame = 0; frame < 10; frame++) fn(frame, actionFrame);
  };

  it("holds jump on every frame the engine reads as a wall tech jump", () => {
    each((frame, actionFrame) => {
      const r = recover(context(walled(-20, frame, actionFrame), L9));
      expect(held(r.input, Btn.Jump), `frame ${frame}, actionFrame ${actionFrame}`).toBe(true);
    });
  });

  it("holds neither jump nor up where the jump does not help it back: at the ledge's height or above", () => {
    each((frame, actionFrame) => {
      const r = recover(context(walled(2, frame, actionFrame), L9));
      expect(held(r.input, Btn.Jump) || held(r.input, Btn.Up), `frame ${frame}, actionFrame ${actionFrame}`).toBe(false);
    });
  });

  it("forgets it when its recovery roll fails, as a low level does", () => {
    each((frame, actionFrame) => {
      const r = recover(context(walled(-20, frame, actionFrame), L1, rollsWith(ROLL_RECOVER, 0.5)));
      expect(held(r.input, Btn.Jump) || held(r.input, Btn.Up), `frame ${frame}, actionFrame ${actionFrame}`).toBe(false);
    });
  });

  it("is done with the wall tech once its jump frames are over", () => {
    // `recover`'s ordinary drift: a full hop's pulse is off on frame 5.
    const r = recover(context(walled(-20, 5, WALL_TECH_JUMP_FRAMES), L9));
    expect(held(r.input, Btn.Jump)).toBe(false);
  });
});

describe("the level table's defence dials", () => {
  it("never tech or parry at level 1, and rise with the level", () => {
    expect([L1.techSkill, L1.parrySkill]).toEqual([0, 0]);
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const previous = tuningForLevel(level - 1);
      const current = tuningForLevel(level);
      expect(current.techSkill, `techSkill at level ${level}`).toBeGreaterThanOrEqual(previous.techSkill);
      expect(current.parrySkill, `parrySkill at level ${level}`).toBeGreaterThanOrEqual(previous.parrySkill);
    }
  });
});

describe("a level-9 CPU in a real match, beyond the plan's text", () => {
  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
  const FD = STAGES.find((x) => x.id === "finalDestination")!;

  /** Mario (port 0, level 9) against a Fox who presses nothing; what Mario did, frame by frame. */
  function play(setup: (s: GameState) => void, frames: number, watch?: (before: GameState, after: GameState, i: number) => void): { actions: string[]; wallTechJumps: number } {
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 21);
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(-40), y: 0, intangible: 0 });
    setup(s);
    const world = cpuWorldFromDef(FIGHTERS.find((f) => f.id === "mario")!, stageViewFromDef(FD));
    let seed = 7;
    let prev: InputFrame[] = [0, 0];
    const actions: string[] = [];
    let wallTechJumps = 0;
    for (let i = 0; i < frames; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
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

  it("air-dodges out of a slow reel high over the stage once the engine's cancel opens, and not before", () => {
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
    // The press lands on one frame in four from the first the cancel reads open.
    expect(dodged).toBeGreaterThanOrEqual(opened);
    expect(dodged - opened).toBeLessThan(4);
  });

  // The drop parries for its first frames (`isParrying`): seen at the level's
  // reaction plus `PARRY_LEAD`, Marth's forward tilt (its first hit on frame 7 of
  // the swing, on these test boxes) comes out inside them.
  it("lets go of a shield it has up as a swing starts, and the engine parries the swing", () => {
    const mario = cpuWorldFromDef(FIGHTERS.find((f) => f.id === "mario")!, stageViewFromDef(FD));
    let parries = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "marth" }], rules, 21);
      Object.assign(s.fighters[0], { x: 0, facing: 1, action: "shield", actionFrame: 10, intangible: 0, invincible: 0 });
      Object.assign(s.fighters[1], { x: fx(16), facing: -1, intangible: 0, invincible: 0 });
      let cpuSeed = seed;
      let prev: InputFrame[] = [Btn.Shield, 0];
      let decided = "";
      let perfect = false;
      for (let i = 1; i <= 30; i++) {
        // Marth holds his stick soft toward Mario and attacks on 8: a forward tilt.
        const marth = (i <= 9 ? Btn.Left | Btn.Soft : 0) | (i === 8 ? Btn.Attack : 0);
        // Mario holds his shield up until the swing is his to see; from then on, he decides.
        let input: InputFrame = Btn.Shield;
        const swing = s.fighters[1];
        if (swing.action === "attack" && swing.actionFrame >= L9.reactionFrames) {
          const d = decideCpu(s, 0, 9, cpuSeed, mario);
          cpuSeed = d.seed;
          input = d.input;
          if (swing.actionFrame === L9.reactionFrames + PARRY_LEAD) decided = d.behaviour;
        }
        const out = step(s, [input, marth], { prevInputs: prev });
        prev = [input, marth];
        for (const h of out.events.shieldHits) if (h.victim === 0 && out.state.fighters[0].action === "shieldRelease") perfect = true;
        s = out.state;
      }
      if (decided === "parry") {
        expect(perfect, `seed ${seed}`).toBe(true);
        parries++;
      }
    }
    expect(parries).toBeGreaterThan(0);
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
