import { beforeAll, describe, expect, it } from "vitest";

import { airDodgeFrames, airDodgeOf } from "../airDodge";
import { TECH_CEILING_FRAMES, TECH_FRAMES, TECH_ROLL_FRAMES, TECH_WALL_FRAMES } from "../constants";
import { fx } from "../fixed";
import { groundDodgeOf, ROLL_BACK, ROLL_FORWARD, rollOf } from "../groundDodge";
import { jumpRiseSpeeds } from "../kinetic";
import { fighterParams, type FighterParams } from "../params";
import { createInitialState, registerFighters, registerStages, step } from "../simulate";
import { LANDING_ANIMATION_FRAMES } from "../states";
import { STATUS_KIND_OF_ACTION } from "../status/kind";
import { Btn } from "../types";
import type { ActionState, FighterDef, FighterState, GameState, InputFrame, MatchRules } from "../types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { SLOT_MOTION } from "./legacy";
import {
  OPEN_ENDED_FRAMES,
  SCALED_FRAMES,
  STRIDE_UNITS,
  VARIABLE_LENGTH_ACTIONS,
  poseIndexOf,
  statusDuration,
  statusMotion,
  type MotionClock,
} from "./poseClock";
import { moveScriptFrame } from "./run";

const PARAMS = { jump_initial_y: 0, jump_y: fx(20), mini_jump_y: fx(9.8), jump_aerial_y: fx(16.2), air_accel_y: fx(0.1) } as unknown as FighterParams;
const DEF = { id: "test", params: PARAMS, moves: {}, attributes: {} } as unknown as FighterDef;

const fighter = (over: Partial<FighterState>): FighterState =>
  ({ defId: "test", action: "stand", actionFrame: 0, move: null, port: 0, charge: 0, hitstun: 0, jumpsUsed: 1, fastFalling: false, vx: 0, vy: 0, shortHop: false, ...over }) as FighterState;

const clocks = (table: Record<string, MotionClock>) => (_id: string, motion: string) => table[motion];

const ACTIONS = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];

/** An air dodge's `charge` for each stick direction (`airDodgeCharge`): 0 neutral, then 1 + (x + 1) + 3 (y + 1). */
const AIR_DODGE_MOTION_OF_CHARGE: Readonly<Record<number, string>> = {
  0: "status_airDodge",
  1: "status_airDodge_diagDown",
  2: "status_airDodge_down",
  3: "status_airDodge_diagDown",
  4: "status_airDodge_side",
  // 5 is no direction (`airDodgeCharge` never makes it); `airDodgeDirection` reads it as neutral.
  5: "status_airDodge",
  6: "status_airDodge_side",
  7: "status_airDodge_diagUp",
  8: "status_airDodge_up",
  9: "status_airDodge_diagUp",
};

/**
 * A sweep of fighter states, wide enough to reach every branch `statusDuration`
 * has: the air dodge's ten charges and the roll's two, landing lags, hitstun,
 * every kind of jump (a ledge jump by its own rise speed) and the fast fall.
 */
function sweep(def: FighterDef, action: ActionState): FighterState[] {
  const ledge = jumpRiseSpeeds(fighterParams(def), "ledge");
  const out: FighterState[] = [];
  for (const actionFrame of [0, 5])
    for (const charge of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15])
      for (const hitstun of [0, 13])
        for (const jumpsUsed of [1, 2, 6])
          for (const shortHop of [false, true])
            for (const vy of [0, ledge[actionFrame]])
              for (const fastFalling of [false, true])
                out.push(fighter({ defId: def.id, action, actionFrame, charge, hitstun, jumpsUsed, shortHop, vy, fastFalling }));
  return out;
}

describe("the pose clock (which baked frame a fighter's bones are on)", () => {
  it("names a status motion per action, with the second jump and the fast fall apart", () => {
    expect(statusMotion({ action: "stand", jumpsUsed: 1, fastFalling: false, charge: 0 })).toBe("status_stand");
    expect(statusMotion({ action: "jump", jumpsUsed: 2, fastFalling: false, charge: 0 })).toBe("status_jump_aerial");
    expect(statusMotion({ action: "fall", jumpsUsed: 1, fastFalling: true, charge: 0 })).toBe("status_fall_fast");
    const all = ACTIONS.map((action) => statusMotion({ action, jumpsUsed: 1, fastFalling: false, charge: 0 }));
    expect(new Set(all).size).toBe(all.length);
  });

  it("runs a fixed-length state once, frame for frame, and holds its last frame", () => {
    const c = clocks({ status_crouchStart: { kind: "once", frames: 5 } });
    expect(poseIndexOf(DEF, fighter({ action: "crouchStart", actionFrame: 0 }), 0, c)).toEqual({ motion: "status_crouchStart", frame: 1 });
    expect(poseIndexOf(DEF, fighter({ action: "crouchStart", actionFrame: 4 }), 0, c)?.frame).toBe(5);
    expect(poseIndexOf(DEF, fighter({ action: "crouchStart", actionFrame: 40 }), 0, c)?.frame).toBe(5);
  });

  it("stretches a variable-length state across its baked samples by its own length", () => {
    const c = clocks({ status_landingLag: { kind: "scaled", frames: SCALED_FRAMES } });
    // A 15-frame landing lag: frame 5 is a third of the way through.
    expect(poseIndexOf(DEF, fighter({ action: "landingLag", charge: 15, actionFrame: 5 }), 0, c)?.frame).toBe(SCALED_FRAMES / 3 + 1);
    expect(poseIndexOf(DEF, fighter({ action: "landingLag", charge: 0, actionFrame: 2 }), 0, c)?.frame).toBe((2 * SCALED_FRAMES) / LANDING_ANIMATION_FRAMES + 1);
  });

  it("stretches a state with no length of its own across OPEN_ENDED_FRAMES", () => {
    const c = clocks({ status_tumbleFall: { kind: "scaled", frames: SCALED_FRAMES } });
    expect(statusDuration(fighter({ action: "tumbleFall" }), DEF)).toBeUndefined();
    expect(poseIndexOf(DEF, fighter({ action: "tumbleFall", actionFrame: 15 }), 0, c)?.frame).toBe((15 * SCALED_FRAMES) / OPEN_ENDED_FRAMES + 1);
  });

  it("loops idle on the match clock, offset per port, so four fighters do not breathe in step", () => {
    const c = clocks({ status_stand: { kind: "idle", frames: 30 } });
    expect(poseIndexOf(DEF, fighter({ port: 0 }), 31, c)?.frame).toBe(2);
    expect(poseIndexOf(DEF, fighter({ port: 1 }), 31, c)?.frame).toBe(((31 + 27) % 30) + 1);
  });

  it("loops any other cycle on the state's own frame", () => {
    const c = clocks({ status_shield: { kind: "loop", frames: 12 } });
    expect(poseIndexOf(DEF, fighter({ action: "shield", actionFrame: 0 }), 99, c)?.frame).toBe(1);
    expect(poseIndexOf(DEF, fighter({ action: "shield", actionFrame: 25 }), 99, c)?.frame).toBe(2);
  });

  it("paces walking by ground covered, in integers", () => {
    const c = clocks({ status_walk: { kind: "paced", frames: 32 } });
    // 1 unit/frame for 18 frames is half a 36-unit stride: half the cycle.
    expect(poseIndexOf(DEF, fighter({ action: "walk", actionFrame: 18, vx: fx(1) }), 0, c)?.frame).toBe(17);
    expect(poseIndexOf(DEF, fighter({ action: "walk", actionFrame: 18, vx: fx(-1) }), 0, c)?.frame).toBe(17);
    expect(STRIDE_UNITS).toBe(36);
  });

  it("knows nothing without a clock, so callers keep Plan 2's single capsule", () => {
    expect(poseIndexOf(DEF, fighter({}), 0, () => undefined)).toBeNull();
  });

  it("times a jump by the engine's own rise, as the 2D renderer's jumpTimingFor does", () => {
    const full = statusDuration(fighter({ action: "jump", jumpsUsed: 1 }), DEF)!;
    const short = statusDuration(fighter({ action: "jump", jumpsUsed: 1, shortHop: true }), DEF)!;
    const air = statusDuration(fighter({ action: "jump", jumpsUsed: 2 }), DEF)!;
    expect(full).toBe(jumpRiseSpeeds(PARAMS, "full").length);
    expect(short).toBe(jumpRiseSpeeds(PARAMS, "short").length);
    expect(air).toBe(jumpRiseSpeeds(PARAMS, "air", 0).length);
    expect(short).toBeLessThan(air);
    expect(air).toBeLessThan(full);
    expect(statusDuration(fighter({ action: "hitstun", actionFrame: 7, hitstun: 13 }), DEF)).toBe(20);
  });

  it("tells a ledge jump from a full hop by its rise speed on this frame, as isLedgeJump does", () => {
    const ledge = jumpRiseSpeeds(PARAMS, "ledge");
    const full = jumpRiseSpeeds(PARAMS, "full").length;
    expect(ledge.length).not.toBe(full);
    expect(statusDuration(fighter({ action: "jump", jumpsUsed: 1, actionFrame: 3, vy: ledge[3] }), DEF)).toBe(ledge.length);
    expect(statusDuration(fighter({ action: "jump", jumpsUsed: 1, actionFrame: 3, vy: ledge[3] + 1 }), DEF)).toBe(full);
    // A ledge jump is a first jump: a midair jump or a short hop at that speed is still what it is.
    expect(statusDuration(fighter({ action: "jump", jumpsUsed: 1, shortHop: true, actionFrame: 3, vy: ledge[3] }), DEF)).toBe(jumpRiseSpeeds(PARAMS, "short").length);
  });
});

describe("the pose clock plays a move at its script's motion frame", () => {
  const mario = FIGHTERS.find((d) => d.id === "mario")!;

  it("indexes the move's own motion by the interpreter's motionFrame, clamped to the bake", () => {
    for (const actionFrame of [0, 4, 14, 30]) {
      const f = fighter({ defId: "mario", action: "attack", move: "fsmash", actionFrame });
      const run = moveScriptFrame(mario, f)!;
      const wide = clocks({ [run.script.motion]: { kind: "script", frames: 1000 } });
      expect(poseIndexOf(mario, f, 0, wide)).toEqual({ motion: run.script.motion, frame: Math.max(1, run.state.motionFrame) });
      const short = clocks({ [run.script.motion]: { kind: "script", frames: 3 } });
      expect(poseIndexOf(mario, f, 0, short)?.frame).toBe(Math.min(3, Math.max(1, run.state.motionFrame)));
    }
  });

  it("knows nothing for a move the bake has no motion for", () => {
    expect(poseIndexOf(mario, fighter({ defId: "mario", action: "attack", move: "fsmash" }), 0, () => undefined)).toBeNull();
  });

  it("never names a status motion a move could also play", () => {
    for (const motion of Object.values(SLOT_MOTION)) expect(motion.startsWith("status_")).toBe(false);
    for (const def of FIGHTERS)
      for (const script of Object.values(def.scripts ?? {})) expect(script.motion.startsWith("status_"), `${def.id} ${script.name}`).toBe(false);
  });
});

/* ------------------------------------------- per-fighter dodges (R4) -- */

describe("each fighter's dodges are motions of their own, per direction (ruling R4)", () => {
  it("names one air-dodge motion per direction class, chosen by the direction charge remembers", () => {
    for (let charge = 0; charge <= 9; charge++) {
      expect(statusMotion({ action: "airDodge", jumpsUsed: 1, fastFalling: false, charge }), `charge ${charge}`).toBe(AIR_DODGE_MOTION_OF_CHARGE[charge]);
    }
  });

  it("names the forward and back roll apart, and nothing else by its charge", () => {
    expect(statusMotion({ action: "roll", jumpsUsed: 1, fastFalling: false, charge: ROLL_FORWARD })).toBe("status_roll");
    expect(statusMotion({ action: "roll", jumpsUsed: 1, fastFalling: false, charge: ROLL_BACK })).toBe("status_roll_back");
    for (const action of ACTIONS.filter((a) => a !== "airDodge" && a !== "roll")) {
      for (const charge of [0, 1, 2, 9, 15]) {
        expect(statusMotion({ action, jumpsUsed: 1, fastFalling: false, charge }), `${action} charge ${charge}`).toBe(
          statusMotion({ action, jumpsUsed: 1, fastFalling: false, charge: 0 }),
        );
      }
    }
  });

  it("gives every motion a name of its own", () => {
    const names = new Set<string>();
    for (const action of ACTIONS)
      for (const charge of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        for (const jumpsUsed of [1, 2])
          for (const fastFalling of [false, true]) names.add(statusMotion({ action, jumpsUsed, fastFalling, charge }));
    // 48 actions, the second jump, two fast falls, five directional air dodges and the back roll.
    expect(names.size).toBe(ACTIONS.length + 1 + 2 + 5 + 1);
    expect(ACTIONS.length).toBe(48);
  });

  it.each(FIGHTERS.map((d) => [d.id, d] as const))("%s: spot dodge, rolls, air dodges and techs last the engine's own lengths", (_id, def) => {
    const g = groundDodgeOf(def.attributes);
    const a = airDodgeOf(def.attributes);
    expect(statusDuration(fighter({ action: "spotDodge" }), def)).toBe(g.spotDodge.frames);
    expect(statusDuration(fighter({ action: "roll", charge: ROLL_FORWARD }), def)).toBe(rollOf(g, ROLL_FORWARD).frames);
    expect(statusDuration(fighter({ action: "roll", charge: ROLL_BACK }), def)).toBe(rollOf(g, ROLL_BACK).frames);
    for (let charge = 0; charge <= 9; charge++) {
      expect(statusDuration(fighter({ action: "airDodge", charge }), def), `charge ${charge}`).toBe(airDodgeFrames(a, charge));
    }
    expect(statusDuration(fighter({ action: "tech" }), def)).toBe(TECH_FRAMES);
    expect(statusDuration(fighter({ action: "techRoll" }), def)).toBe(TECH_ROLL_FRAMES);
    expect(statusDuration(fighter({ action: "techWall" }), def)).toBe(TECH_WALL_FRAMES);
    expect(statusDuration(fighter({ action: "techCeiling" }), def)).toBe(TECH_CEILING_FRAMES);
    expect(statusDuration(fighter({ action: "tumbleFall" }), def)).toBeUndefined();
    expect(statusDuration(fighter({ action: "ledgeTrumped" }), def)).toBeUndefined();
  });

  it.each(FIGHTERS.map((d) => [d.id, d] as const))(
    "%s: a motion's length is fixed unless its action is variable-length, and only then",
    (_id, def) => {
      const varies = new Set<ActionState>();
      for (const action of ACTIONS) {
        const lengths = new Map<string, Set<number | undefined>>();
        for (const f of sweep(def, action)) {
          const motion = statusMotion(f);
          const seen = lengths.get(motion) ?? new Set();
          seen.add(statusDuration(f, def));
          lengths.set(motion, seen);
        }
        for (const seen of lengths.values()) if (seen.size > 1) varies.add(action);
      }
      expect([...varies].sort()).toEqual([...VARIABLE_LENGTH_ACTIONS].sort());
    },
  );
});

/* ----------------------------------------------- the T + 1 hand-off -- */

describe("through step(), a dodge's once clock covers frames 1 to T exactly (the T + 1 hand-off)", () => {
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
  /** Well clear of the floor and of every blast zone. */
  const HIGH = fx(60);

  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  const hold = (input: InputFrame, n: number): InputFrame[] => Array.from({ length: n }, () => input);

  function standing(id: string): GameState {
    let s = createInitialState("finalDestination", [{ defId: id }], RULES, 7);
    for (let i = 0; i < 80; i++) s = step(s, [0], { prevInputs: [0] }).state;
    return s;
  }

  /** The fighter after each frame of `inputs`; `airborne` keeps it high in the air throughout. */
  function play(s: GameState, inputs: readonly InputFrame[], airborne: boolean): FighterState[] {
    let prev: InputFrame = 0;
    const out: FighterState[] = [];
    for (const input of inputs) {
      s = step(s, [input], { prevInputs: [prev] }).state;
      prev = input;
      if (airborne) s.fighters[0].y = HIGH;
      out.push(s.fighters[0]);
    }
    return out;
  }

  /** What the bake's once clock, at the fighter's own length, shows on every frame the dodge is drawn. */
  function onceFrames(def: FighterDef, played: readonly FighterState[], action: ActionState): { T: number; frames: number[] } {
    const start = played.findIndex((f) => f.action === action);
    expect(start, `${def.id} ${action}: the dodge started`).toBeGreaterThanOrEqual(0);
    const first = played[start];
    const T = statusDuration(first, def)!;
    const motion = statusMotion(first);
    const c = clocks({ [motion]: { kind: "once", frames: T } });
    const frames: number[] = [];
    for (const f of played.slice(start)) {
      if (f.action !== action) break;
      expect(statusMotion(f), `${def.id} ${action}: one motion throughout`).toBe(motion);
      frames.push(poseIndexOf(def, f, 0, c)!.frame);
    }
    return { T, frames };
  }

  const oneToT = (T: number): number[] => Array.from({ length: T }, (_, i) => i + 1);

  it.each(FIGHTERS.map((d) => [d.id, d] as const))("%s: spot dodge and both rolls", (id, def) => {
    for (const [action, key] of [
      ["spotDodge", Btn.Down],
      ["roll", Btn.Right],
      ["roll", Btn.Left],
    ] as const) {
      const played = play(standing(id), [...hold(Btn.Shield, 4), Btn.Shield | key, ...hold(0, 60)], false);
      const { T, frames } = onceFrames(def, played, action);
      expect(frames, `${id} ${action} ${key}`).toEqual(oneToT(T));
    }
  });

  it.each(FIGHTERS.map((d) => [d.id, d] as const))("%s: the air dodge, neutral and in every direction", (id, def) => {
    const directions = [0, Btn.Right, Btn.Left, Btn.Up, Btn.Down, Btn.Right | Btn.Up, Btn.Left | Btn.Down];
    const motions = new Set<string>();
    for (const dir of directions) {
      const s = standing(id);
      const f = s.fighters[0];
      f.grounded = false;
      f.platform = -1;
      f.y = HIGH;
      f.action = "fall";
      f.jumpsUsed = 1;
      const played = play(s, [...hold(0, 2), Btn.Shield | dir, ...hold(0, 160)], true);
      const { T, frames } = onceFrames(def, played, "airDodge");
      motions.add(statusMotion(played.find((p) => p.action === "airDodge")!));
      expect(frames, `${id} air dodge ${dir}`).toEqual(oneToT(T));
    }
    expect(motions.size).toBe(6);
  });
});
