/**
 * The CPU's model of its own up special (Plan 5, Task 4b fix round 1; Task 13b)
 * is the engine's: `upBPath` runs the engine's own per-frame rules on a copy of
 * the fighter, so where it says the move takes the fighter is where `step()`
 * takes it, frame for frame, through the move and on into its helpless fall,
 * for whatever the stick does (the up specials' aims, turns and drift, Task
 * 13b). A model that only agrees with itself misjudged a fighter facing away
 * from the stage by 85-95 units (the Task 4b review: Fox 93.6, Donkey Kong
 * 84.2), and the CPU waited until no up special could save it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { decideCpu, type CpuWorld } from "@/ai/cpu";
import { flatten } from "@/engine/acmd/interpreter";
import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn, CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, StageDef } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { controlsOf } from "@/lib/matchConfig";
import { STAGES } from "@/stages";
import { battlefield } from "@/stages/battlefield";
import { finalDestination } from "@/stages/finalDestination";
import { townAndCity } from "@/stages/townAndCity";
import { cpuWorldFromDef } from "./cpu";
import { floorContact, recoveryFromDef, stageViewFromDef, upBHold, upBInReach, upBNowOrNever, upBPath, upBPlan, upBPress, upBReach, upBStickNow, upBSticks, type UpBStick } from "./behaviours";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

/** Nowhere to land and nothing to grab: the up special's path, and nothing else. */
const VOID: StageDef = {
  ...finalDestination,
  id: "void",
  platforms: [{ x: 0, y: fx(-4000), halfWidth: fx(10), soft: false, ledges: false }],
  blastZone: { left: fx(-4000), right: fx(4000), top: fx(4000), bottom: fx(-8000) },
  spawns: [{ x: 0, y: 0 }, { x: fx(2000), y: 0 }],
};

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages([...STAGES, VOID]);
});

const one = (stick: InputFrame): UpBStick => ({ first: stick, then: stick, switchAt: 0 });

/** `id` in the air at `at` on `stage`, out of jumps; Mario standing far off. */
function airborne(stage: string, id: string, at: Partial<FighterState>, marioX = fx(2000), ctx?: SimContext): GameState {
  const s = createInitialState(stage, [{ defId: id }, { defId: "mario" }], RULES, 5, ctx);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0, invincible: 0, jumpsUsed: 2, ...at });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, intangible: 0, invincible: 0, x: marioX });
  return s;
}

/**
 * The press that starts the up special, as the CPU makes it (ruling R-T13b-c): Up
 * and Special with the stick's side, never Down, which would cancel Up and make it
 * a side special.
 */
const PRESS = (dir: InputFrame): InputFrame => (dir & ~Btn.Down) | Btn.Up | Btn.Special;

/** Up special on the first frame, holding `plan` as the move runs; every frame's state. */
function upB(start: GameState, plan: UpBStick, frames: number, ctx?: SimContext): GameState[] {
  const out: GameState[] = [];
  let state = start;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < frames; i++) {
    // The press is move frame 1; frame i + 1 of the move is step i.
    const dir = plan.switchAt > 0 && i + 1 >= plan.switchAt ? plan.then : plan.first;
    const now = [i === 0 ? PRESS(dir) : dir, 0];
    state = step(state, now, { prevInputs: prev, ...(ctx !== undefined ? { ctx } : {}) }).state;
    prev = now;
    out.push(state);
  }
  return out;
}

/** The fighter reached the stage: standing on it, landing on it, or hanging from its ledge. */
const recovered = (f: FighterState): boolean => f.ledge !== null || (f.grounded && f.action !== "dead");

/** Run the level-9 CPU on port 0 for up to `frames` frames, the other port idle; every frame's fighter. */
function cpuRun(state: GameState, world: CpuWorld, frames: number, ctx?: SimContext): FighterState[] {
  let s = state;
  let prev: readonly InputFrame[] = [0, 0];
  let seed = 7;
  const out: FighterState[] = [];
  for (let i = 0; i < frames; i++) {
    const d = decideCpu(s, 0, 9, seed, world);
    seed = d.seed;
    const now = [d.input, 0];
    s = step(s, now, { prevInputs: prev, ...(ctx !== undefined ? { ctx } : {}) }).state;
    prev = now;
    out.push(s.fighters[0]);
    if (recovered(s.fighters[0]) || s.fighters[0].action === "dead") break;
  }
  return out;
}

/**
 * The level-9 CPU on `port` played through the aerial it is in, the other ports
 * idle, until the aerial's first free frame (or 80 frames on): the state then,
 * whether it pressed Special in the aerial, and whether a held Up's tap jump took
 * its buffer there (a buffered jump with no Jump pressed, which only Stick Jump
 * makes: Plan 5, Task 20 fix round 1's M1).
 */
function throughTheAerial(start: GameState, port: number, world: CpuWorld): { state: GameState; pressed: boolean; tapJumped: boolean } {
  let s = start;
  let prev: readonly InputFrame[] = start.fighters.map(() => 0);
  let seed = 7;
  let pressed = false;
  let jumpPressed = false;
  let tapJumped = false;
  for (let i = 0; i < 80 && s.fighters[port].action === "attack"; i++) {
    const d = decideCpu(s, port, 9, seed, world);
    seed = d.seed;
    if ((d.input & Btn.Special) !== 0) pressed = true;
    if ((d.input & Btn.Jump) !== 0) jumpPressed = true;
    const now = start.fighters.map((_, p) => (p === port ? d.input : 0));
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    if (s.fighters[port].bufferedAction?.kind === "jump" && !jumpPressed) tapJumped = true;
  }
  return { state: s, pressed, tapJumped };
}

describe("the CPU's up special model", () => {
  it("exists for every fighter on the roster, and is the up special it uses in the air", () => {
    // A move whose movement left its momentum list (Task 13, Task 13b) still has a
    // model: the model runs the move, it does not read a list (the Task 4b review's
    // carry: never fire blind).
    for (const def of FIGHTERS) {
      const r = recoveryFromDef(def);
      expect(r, def.id).not.toBeNull();
      expect(r!.slot, def.id).toBe(def.moves.upBAir !== undefined ? "upBAir" : "upB");
    }
  });

  // Exact, frame for frame: the model runs the engine's own rules.
  const HELPLESS_FRAMES = 30;
  for (const def of FIGHTERS) {
    it(`puts ${def.id} where step() does, every frame, facing either way, for every stick it would hold`, () => {
      const r = recoveryFromDef(def)!;
      const frames = Math.min(r.totalFrames + HELPLESS_FRAMES, 150);
      for (const facing of [1, -1])
        for (const plan of [...upBSticks(r, 1), ...upBSticks(r, -1)])
          for (const vx of [-fx(1), fx(0.5)])
            for (const [vy, fastFalling] of [[-fx(1.5), false], [fx(1), false], [-fx(1), true]] as const) {
              // A fast fall the up special began in keeps its terminal speed.
              const start = airborne("void", def.id, { x: 0, y: 0, vx, vy, facing, fastFalling });
              const engine = upB(start, plan, frames).map((s) => s.fighters[0]);
              const model = upBPath(r, start.fighters[0], plan, frames, start.frame);
              const at = `facing ${facing}, plan ${plan.first}/${plan.then}, vx ${vx}, vy ${vy}, fast fall ${fastFalling}`;
              expect(model.map((p) => [p.x, p.y, p.facing, p.helpless]), at).toEqual(
                engine.map((f) => [f.x - start.fighters[0].x, f.y - start.fighters[0].y, f.facing, f.action === "specialFall"]),
              );
            }
    });
  }

  it("goes on from the middle of the move: the rest of the path from any frame of it is the engine's", () => {
    // Fox, 35 frames into his Fire Fox (aimed on 30), and Pikachu between his legs.
    for (const [id, cut] of [
      ["fox", 35],
      ["pikachu", 24],
    ] as const) {
      const r = recoveryFromDef(FIGHTERS.find((d) => d.id === id)!)!;
      const plan: UpBStick = { first: Btn.Up | Btn.Right, then: Btn.Left, switchAt: r.secondAim };
      const all = upB(airborne("void", id, { x: 0, y: 0 }), plan, cut + 60);
      const mid = all[cut - 1];
      const model = upBPath(r, mid.fighters[0], plan, 60, mid.frame);
      expect(model.map((p) => [p.x, p.y]), id).toEqual(all.slice(cut).map((s) => [s.fighters[0].x - mid.fighters[0].x, s.fighters[0].y - mid.fighters[0].y]));
    }
  });
});

describe("the CPU's up special press is always the up special (ruling R-T13b-c)", () => {
  const fd = stageViewFromDef(finalDestination);

  it("starts the up special with every stick it would hold, pressed as it presses it", () => {
    for (const def of FIGHTERS) {
      const r = recoveryFromDef(def)!;
      for (const plan of [...upBSticks(r, 1), ...upBSticks(r, -1)]) {
        const start = airborne("void", def.id, { x: 0, y: 0 });
        const [first] = upB(start, plan, 1);
        expect([first.fighters[0].action, first.fighters[0].move], `${def.id} plan ${plan.first}`).toEqual(["special", r.slot]);
      }
    }
  });

  it("leads Fox toward the stage through every octant that does, down-toward included", () => {
    const r = recoveryFromDef(FIGHTERS.find((d) => d.id === "fox")!)!;
    expect(upBSticks(r, 1).map((p) => p.first)).toEqual([Btn.Right | Btn.Up, Btn.Right, Btn.Up, Btn.Right | Btn.Down, 0]);
    expect(upBSticks(r, -1).map((p) => p.first)).toEqual([Btn.Left | Btn.Up, Btn.Left, Btn.Up, Btn.Left | Btn.Down, 0]);
  });

  it("starts Fire Fox on Fox's downward plan, and aims it down on frame 30 (Frame to decide dash angle 30)", () => {
    const fs = upB(airborne("void", "fox", { x: 0, y: 0 }), one(Btn.Right | Btn.Down), 50).map((s) => s.fighters[0]);
    expect([fs[0].action, fs[0].move]).toEqual(["special", "upB"]);
    expect([fs[30].combat.aimX, fs[30].combat.aimY]).toEqual([fx(1), fx(-1)]);
    expect(fs[45].vy).toBeLessThan(0);
  });

  it("an up special pressed during an offstage aerial comes out as the up special, whatever frame the aerial ends on", () => {
    // Mario out of jumps 25 off the ledge and 30 under it, in a neutral air: the CPU
    // presses for the up special while he cannot act, and the buffered press fires
    // on the aerial's first actionable frame. On every phase of its press pulse.
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    for (let phase = 0; phase < 6; phase++) {
      const s = airborne("finalDestination", "mario", { x: fx(-105), y: fx(-30), action: "attack", move: "nair", actionFrame: 0, facing: 1 }, fx(40));
      s.frame = phase;
      const run = cpuRun(s, cpuWorldFromDef(mario, fd), 120);
      const special = run.find((f) => f.action === "special");
      expect(special?.move, `phase ${phase}`).toBe("upB");
    }
  });

  it("does not wall jump while it is still rising, and does once it falls", () => {
    // Against Final Destination's wall under its left ledge (the wall to his right).
    const at = (vy: number) => {
      const s = airborne("finalDestination", "mario", { x: fx(-84), y: fx(-30), vy, facing: 1 }, fx(40));
      s.fighters[0].combat.wallSide = 1;
      s.fighters[0].combat.wallFrames = 0;
      return decideCpu(s, 0, 9, 7, cpuWorldFromDef(FIGHTERS.find((f) => f.id === "mario")!, fd)).input;
    };
    expect(at(fx(1)) & Btn.Left).toBe(0);
    expect(at(-fx(1)) & Btn.Left).not.toBe(0);
  });

  it("holds Up and never Down on every frame once it has decided, and presses Special on its pulse", () => {
    // Fox out of jumps, 30 off Final Destination's left ledge: in reach, so decided.
    // Every phase of the six-frame pulse: the frames between presses hold Up too, so
    // whichever one the special comes out on reads as the up special.
    const world = cpuWorldFromDef(FIGHTERS.find((d) => d.id === "fox")!, fd);
    let presses = 0;
    for (let phase = 0; phase < 6; phase++) {
      const s = airborne("finalDestination", "fox", { x: fx(-110), y: fx(10), facing: 1 }, fx(40));
      s.frame = phase;
      const d = decideCpu(s, 0, 9, 7, world);
      expect(d.behaviour, `phase ${phase}`).toBe("recover");
      expect(d.input & Btn.Up, `phase ${phase}`).not.toBe(0);
      expect(d.input & Btn.Down, `phase ${phase}`).toBe(0);
      if ((d.input & Btn.Special) !== 0) presses += 1;
    }
    expect(presses).toBe(3);
    // The press and the hold strip a plan's Down (Fox's `T | Down`) and add Up.
    expect(upBPress(Btn.Right | Btn.Down)).toBe(Btn.Right | Btn.Up | Btn.Special);
    expect(upBHold(Btn.Left | Btn.Down)).toBe(Btn.Left | Btn.Up);
  });

  it("in its own up special, holds the stick and presses nothing: no second press, no Up added", () => {
    // Fox 20 frames into a Fire Fox off Final Destination's left ledge, every phase of
    // the pulse: the stick its plan holds, and never Special.
    const fox = FIGHTERS.find((d) => d.id === "fox")!;
    const r = recoveryFromDef(fox)!;
    const mid = upB(airborne("finalDestination", "fox", { x: fx(-110), y: fx(10), facing: 1 }, fx(40)), one(Btn.Right), 20)[19];
    expect([mid.fighters[0].action, mid.fighters[0].move]).toEqual(["special", "upB"]);
    const plan = upBPlan(mid.fighters[0], fd.leftLedge, fd, r) ?? upBSticks(r, 1)[0];
    for (let phase = 0; phase < 6; phase++) {
      mid.frame = 100 + phase;
      const d = decideCpu(mid, 0, 9, 7, cpuWorldFromDef(fox, fd));
      expect(d.behaviour, `phase ${phase}`).toBe("recover");
      expect(d.input, `phase ${phase}`).toBe(upBStickNow(plan, mid.fighters[0], r));
    }
  });

  it("in its own up special over the stage, holds nothing: the move flies as authored", () => {
    // Pikachu between Quick Attack's legs over Battlefield's main platform.
    const bf = stageViewFromDef(battlefield);
    const pikachu = FIGHTERS.find((d) => d.id === "pikachu")!;
    const mid = upB(airborne("battlefield", "pikachu", { x: fx(10), y: fx(10), facing: 1 }, fx(-60)), one(Btn.Up), 22)[21];
    expect([mid.fighters[0].action, mid.fighters[0].move]).toEqual(["special", "upB"]);
    for (let phase = 0; phase < 6; phase++) {
      mid.frame = 100 + phase;
      const d = decideCpu(mid, 0, 9, 7, cpuWorldFromDef(pikachu, bf));
      expect([d.behaviour, d.input], `phase ${phase}`).toEqual(["recover", 0]);
    }
  });

  it("holds Up, never Down, while a Special press waits in the buffer, whatever wins the frame", () => {
    // Mario in a neutral air over the middle of the stage, where recovering is not
    // what wins: a Special press still in his buffer fires as the up special.
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    const world = cpuWorldFromDef(mario, fd);
    const at = (age: number) => {
      const s = airborne("finalDestination", "mario", { x: 0, y: fx(30), action: "attack", move: "nair", actionFrame: 5, facing: 1 }, fx(40));
      s.frame = 100;
      s.fighters[0].bufferedAction = { kind: "special", frame: 100 - age };
      return decideCpu(s, 0, 9, 7, world);
    };
    for (const age of [0, 8]) {
      const d = at(age);
      expect(d.behaviour, `age ${age}`).not.toBe("recover");
      expect(d.input & Btn.Up, `age ${age}`).not.toBe(0);
      expect(d.input & Btn.Down, `age ${age}`).toBe(0);
    }
    // Past the buffer's nine frames on the next step, it no longer holds anything.
    expect(at(9).input & Btn.Up).toBe(0);
  });
});

describe("when the CPU spends its up special", () => {
  const fd = stageViewFromDef(finalDestination);

  it("judges Fox in reach facing away from the stage, where the engine's up special does reach it", () => {
    // Fox facing away (left), 30 off Final Destination's left ledge (x -80).
    const at = { x: fx(-110), y: fx(10), vx: 0, vy: 0, facing: -1 };
    const self = airborne("finalDestination", "fox", at).fighters[0];
    const r = recoveryFromDef(FIGHTERS.find((d) => d.id === "fox")!)!;
    const plan = upBPlan(self, fd.leftLedge, fd, r);
    expect(plan).not.toBeNull();
    const engine = upB(airborne("finalDestination", "fox", at, fx(40)), plan!, 200).map((s) => s.fighters[0]);
    expect(engine.some(recovered), "the engine's up special reaches the stage").toBe(true);
  });

  it("is sound: wherever it finds a stick that gets back, the engine's up special with that stick reaches the stage", () => {
    // Plan 5 final wave (ruling R-FW1f; the Task 4b re-review's carry): a column at the
    // stage's wall under the ledge, 4 and 15 out, where a path through the stage's body
    // was once judged a way back (28 of 1,888 at Task 4b).
    for (const def of FIGHTERS) {
      const r = recoveryFromDef(def)!;
      for (const facing of [1, -1])
        for (const x of [-84, -95, -100, -130, -160])
          for (const y of [-50, -40, -30, 0, 40]) {
            const at = { x: fx(x), y: fx(y), vx: 0, vy: 0, facing };
            const self = airborne("finalDestination", def.id, at).fighters[0];
            const plan = upBPlan(self, fd.leftLedge, fd, r);
            if (plan === null) continue;
            const engine = upB(airborne("finalDestination", def.id, at, fx(40)), plan, 260).map((s) => s.fighters[0]);
            expect(engine.some(recovered), `${def.id} facing ${facing} at ${x}, ${y}`).toBe(true);
          }
    }
  });

  it("judges no way back a path that passes through the stage's solid body under the ledge (ruling R-FW1f)", () => {
    // Mario 4 out from Final Destination's left ledge, 30 under its top, out of jumps:
    // Super Jump Punch straight up from here runs, in the model, through the stage's body,
    // where the engine's stage would stop him. The model cannot vouch for that line.
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    const r = recoveryFromDef(mario)!;
    const self = airborne("finalDestination", "mario", { x: fd.leftLedge - fx(4), y: fx(-30), vx: 0, vy: 0, facing: 1 }).fighters[0];
    expect(upBReach(self, fd.leftLedge, fd, r, Btn.Right)).toEqual({ reached: false, throughWall: true });
    // And no plan the CPU makes runs through it: each it returns is clear of the body.
    for (const def of FIGHTERS)
      for (const x of [-82, -84, -88, -95])
        for (const y of [-70, -50, -30, -10]) {
          const at = airborne("finalDestination", def.id, { x: fx(x), y: fx(y), vx: 0, vy: 0, facing: 1 }).fighters[0];
          const rr = recoveryFromDef(def)!;
          const plan = upBPlan(at, fd.leftLedge, fd, rr);
          if (plan !== null) expect(upBReach(at, fd.leftLedge, fd, rr, plan).throughWall, `${def.id} at ${x}, ${y}`).toBe(false);
        }
  });

  it("reaches a ledge from behind 40% less far than facing it, as findLedgeGrab does (LEDGE_GRAB_BACK_PENALTY)", () => {
    // Helpless, falling 2.5 outside Final Destination's left ledge and 3 under its top:
    // inside the grab's 3.2 facing the ledge, outside its 1.92 from behind.
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    const r = recoveryFromDef(mario)!;
    const falling = (facing: number) => airborne("finalDestination", "mario", { action: "specialFall", x: fd.leftLedge - fx(2.5), y: fx(-3), vx: 0, vy: -fx(1), facing }).fighters[0];
    expect(upBReach(falling(1), fd.leftLedge, fd, r).reached, "facing the ledge").toBe(true);
    expect(upBReach(falling(-1), fd.leftLedge, fd, r).reached, "its back to the ledge").toBe(false);
  });

  it("gets Fox back from the Task 4b review's mario-fox case: out of jumps, facing away, rising", () => {
    // The review's Town & City trace (mario-fox, the CPU sweep at f312780): Fox
    // just out of jumps on frame 1281, facing away, rising from x -135.3 to a
    // peak of 31.6. His state on frame 1281, Q12, as the sweep had it:
    const state = airborne("townAndCity", "fox", { action: "jump", actionFrame: 3, x: -554216, y: 38183, vx: -1351, vy: 13600, facing: -1 }, fx(40));
    const world: CpuWorld = cpuWorldFromDef(FIGHTERS.find((d) => d.id === "fox")!, stageViewFromDef(townAndCity));
    const run = cpuRun(state, world, 300);
    expect(run.every((f) => f.action !== "dead")).toBe(true);
    expect(recovered(run[run.length - 1])).toBe(true);
  });
});

/*
 * Plan 5, Task 13b: the CPU recovers with the up specials as published, aiming
 * them, turning them round and wall jumping first where that helps.
 */
describe("the CPU recovers with its up special's angles (Plan 5, Task 13b)", () => {
  const fd = stageViewFromDef(finalDestination);

  it("aims Fox's Fire Fox at the ledge from below it, where straight up would not get him back", () => {
    // 70 off Final Destination's left ledge and 30 under it, facing away, out of jumps.
    const at = { x: fx(-150), y: fx(-30), vx: 0, vy: 0, facing: -1 };
    const fox = FIGHTERS.find((d) => d.id === "fox")!;
    const straight = upB(airborne("finalDestination", "fox", at, fx(40)), one(0), 200).map((s) => s.fighters[0]);
    expect(straight.some(recovered), "straight up does not get him back").toBe(false);
    const run = cpuRun(airborne("finalDestination", "fox", at, fx(40)), cpuWorldFromDef(fox, fd), 300);
    expect(recovered(run[run.length - 1]), "the CPU gets him back").toBe(true);
    // ...by aiming the dash: toward the stage, not straight up.
    const aimed = run.find((f) => f.action === "special" && f.actionFrame === 40)!;
    expect(aimed.combat.aimX).toBeGreaterThan(0);
  });

  it("takes Pikachu's second leg the other way, from deep below the ledge", () => {
    // 50 off and 60 under: the model finds no stick held through both legs that
    // gets him back (the second leg refused, one leg of 55), and up, then up and
    // in, that does. (Its "no" errs short: it leaves the body's half-width out.)
    const at = { x: fx(-130), y: fx(-60), vx: 0, vy: 0, facing: 1 };
    const pikachu = FIGHTERS.find((d) => d.id === "pikachu")!;
    const r = recoveryFromDef(pikachu)!;
    const self = airborne("finalDestination", "pikachu", at, fx(40)).fighters[0];
    for (const stick of [Btn.Up | Btn.Right, Btn.Up, Btn.Right]) expect(upBInReach(self, fd.leftLedge, fd, r, stick), `one leg (${stick})`).toBe(false);
    expect(upBPlan(self, fd.leftLedge, fd, r)).toEqual({ first: Btn.Up, then: Btn.Up | Btn.Right, switchAt: 20 });
    expect(r.secondAim).toBe(20);
    const run = cpuRun(airborne("finalDestination", "pikachu", at, fx(40)), cpuWorldFromDef(pikachu, fd), 300);
    expect(recovered(run[run.length - 1]), "the CPU gets him back").toBe(true);
    const second = run.find((f) => f.action === "special" && f.actionFrame === 30)!;
    expect(second.combat.aimX !== 0 || second.combat.aimY !== 0, "the second leg came out").toBe(true);
  });

  it("turns Mario round with his up special when he faces away (Optional reverse 3)", () => {
    const at = { x: fx(-105), y: fx(-15), vx: 0, vy: 0, facing: -1 };
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    const run = cpuRun(airborne("finalDestination", "mario", at, fx(40)), cpuWorldFromDef(mario, fd), 300);
    const inMove = run.filter((f) => f.action === "special" && f.move === "upB");
    expect(inMove.length).toBeGreaterThan(0);
    expect(inMove[inMove.length - 1].facing, "facing the stage by the end of it").toBe(1);
    expect(recovered(run[run.length - 1])).toBe(true);
  });

  it("judges a ledge grab by the way the move has turned it (Mario facing away turns on frame 3)", () => {
    // 21 off and 50 under, facing away: only a fighter facing the ledge grabs it from
    // here (from behind its reach is 0.6 of it), and his up special turns him to it.
    const at = { x: fx(-101), y: fx(-50), vx: 0, vy: 0, facing: -1 };
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    const r = recoveryFromDef(mario)!;
    const self = airborne("finalDestination", "mario", at).fighters[0];
    expect(upBInReach(self, fd.leftLedge, fd, r, Btn.Right)).toBe(true);
    const engine = upB(airborne("finalDestination", "mario", at, fx(40)), one(Btn.Right), 120).map((s) => s.fighters[0]);
    expect(engine.some((f) => f.ledge !== null)).toBe(true);
  });

  it("drifts into the stage's wall under the ledge to kick off it, rather than spend the up special there", () => {
    // Mario 8 off the wall and 25 under the ledge, out of jumps: the up special
    // would reach, but he drifts in, touches the wall and wall jumps first.
    const at = { x: fx(-88), y: fx(-25), vx: 0, vy: 0, facing: 1 };
    const mario = FIGHTERS.find((d) => d.id === "mario")!;
    const self = airborne("finalDestination", "mario", at, fx(40)).fighters[0];
    expect(upBPlan(self, fd.leftLedge, fd, recoveryFromDef(mario)!)).not.toBeNull();
    const run = cpuRun(airborne("finalDestination", "mario", at, fx(40)), cpuWorldFromDef(mario, fd), 300);
    const kicked = run.findIndex((f) => f.combat.wallJumps > 0);
    const upB = run.findIndex((f) => f.action === "special");
    expect(kicked).toBeGreaterThanOrEqual(0);
    expect(upB < 0 || upB > kicked, "no up special before the wall jump").toBe(true);
  });

  it("wall jumps off the stage's side before it spends the up special (Mario, Samus, Fox and Pikachu can)", () => {
    // Mario against Final Destination's left wall (x -80), under the ledge, falling,
    // out of jumps, the wall just touched: he presses away and kicks off it.
    const s = airborne("finalDestination", "mario", { x: fx(-84), y: fx(-30), vy: -fx(1), facing: 1 }, fx(40));
    s.fighters[0].combat.wallSide = 1;
    s.fighters[0].combat.wallFrames = 0;
    const world = cpuWorldFromDef(FIGHTERS.find((d) => d.id === "mario")!, fd);
    const d = decideCpu(s, 0, 9, 7, world);
    expect(d.input & (Btn.Left | Btn.Special)).toBe(Btn.Left);
    const after = step(s, [d.input, 0], { prevInputs: [Btn.Right, 0] }).state.fighters[0];
    expect(after.combat.wallJumps).toBe(1);
    expect(after.action).toBe("jump");
  });

  it("does not wall jump with a fighter that cannot (Donkey Kong)", () => {
    const s = airborne("finalDestination", "donkeyKong", { x: fx(-86), y: fx(-30), vy: -fx(1), facing: 1 }, fx(40));
    s.fighters[0].combat.wallSide = 1;
    s.fighters[0].combat.wallFrames = 0;
    const d = decideCpu(s, 0, 9, 7, cpuWorldFromDef(FIGHTERS.find((f) => f.id === "donkeyKong")!, fd));
    expect(d.input & Btn.Left).toBe(0);
  });
});

/*
 * Plan 5, Task 13: an up special that runs its imported script publishes no
 * momentum (SSBU moves a fighter by its animation, which no source publishes).
 * In the game, Link's aerial Spin Attack runs its imported `game_specialairhi`
 * (Task 13b), a limb-bone script the bake places, and moves by its published
 * launch and phases. The model runs the move, so it needs neither.
 */
describe("the CPU's up special model in the game's form of each fighter (Plan 5, Task 13)", () => {
  const GAME: SimContext = bakedContext(
    { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => [...STAGES, VOID].find((s) => s.id === id)! },
    readBakeFromDisk(),
  );
  const fd = stageViewFromDef(finalDestination);

  it("runs Link's aerial up special from its imported script, which sets no momentum of its own", () => {
    const link = GAME.fighter("link");
    const script = link.scripts?.upBAir;
    expect(script?.name).toBe("game_specialairhi");
    expect(flatten(script!).some((c) => c.op === "momentum")).toBe(false);
  });

  it("exists for every fighter in the game's form", () => {
    for (const def of FIGHTERS) expect(recoveryFromDef(GAME.fighter(def.id)), def.id).not.toBeNull();
  });

  it("puts Link where the game's step() does, every frame, facing either way and steering either way", () => {
    const r = recoveryFromDef(GAME.fighter("link"))!;
    const frames = r.totalFrames + 30;
    for (const facing of [1, -1])
      for (const stick of [Btn.Right, Btn.Left]) {
        const start = airborne("void", "link", { x: 0, y: 0, vx: fx(0.5), vy: -fx(1.5), facing }, fx(2000), GAME);
        const engine = upB(start, one(stick), frames, GAME).map((s) => s.fighters[0]);
        const model = upBPath(r, start.fighters[0], stick, frames, start.frame);
        expect(engine[r.totalFrames - 1].action).toBe("special");
        expect(engine[r.totalFrames].action).toBe("specialFall");
        expect(model.map((p) => [p.x, p.y]), `facing ${facing}, stick ${stick}`).toEqual(engine.map((f) => [f.x - start.fighters[0].x, f.y - start.fighters[0].y]));
      }
  });

  it("does not spend Link's up special at once out of its reach, and still gets him back", () => {
    // Link out of jumps, 120 off Final Destination's left ledge (x -80) and 80 up.
    const state = airborne("finalDestination", "link", { x: fx(-200), y: fx(80), vx: 0, vy: 0, facing: 1 }, fx(2000), GAME);
    const world: CpuWorld = cpuWorldFromDef(GAME.fighter("link"), fd);
    const r = world.recovery!;
    const judged = (f: FighterState): boolean => upBPlan(f, fd.leftLedge, fd, r) !== null || upBNowOrNever(f, fd, r);
    expect(judged(state.fighters[0]), "out of reach where it starts").toBe(false);
    expect(upBInReach(state.fighters[0], fd.leftLedge, fd, r, Btn.Right)).toBe(false);
    let s = state;
    let prev: readonly InputFrame[] = [0, 0];
    let seed = 7;
    let firstPress = -1;
    let back = false;
    for (let i = 0; i < 400 && !back; i++) {
      const self = s.fighters[0];
      const d = decideCpu(s, 0, 9, seed, world);
      seed = d.seed;
      if (firstPress < 0 && (d.input & Btn.Special) !== 0) {
        firstPress = i;
        expect(judged(self), `pressed on frame ${i} out of reach`).toBe(true);
      }
      const now = [d.input, 0];
      s = step(s, now, { prevInputs: prev, ctx: GAME }).state;
      prev = now;
      expect(s.fighters[0].action, `frame ${i}`).not.toBe("dead");
      back = recovered(s.fighters[0]);
    }
    // It first judges the up special worth it after 30 frames of drifting in
    // (measured; pinned, the Task 13b review's M-3).
    expect(firstPress).toBe(30);
    expect(back).toBe(true);
  });
});

/* ------------------------------------------- recovery strategy (Plan 5, Task 19) -- */

describe("recovery strategy (Plan 5, Task 19: the Task 13b carries)", () => {
  const fd = stageViewFromDef(finalDestination);
  const def = (id: string) => FIGHTERS.find((d) => d.id === id)!;

  it("spends its midair jump before an up special that would not get it back (M-11)", () => {
    // Mario 20 off the ledge and 50 under it, a jump left: no stick gets the up
    // special back from here, and waiting longer is no better (now or never).
    const mario = def("mario");
    const r = recoveryFromDef(mario)!;
    const start = () => airborne("finalDestination", "mario", { x: fx(-100), y: fx(-50), vy: -fx(1), jumpsUsed: 1, facing: 1 }, fx(40));
    expect([upBPlan(start().fighters[0], fd.leftLedge, fd, r), upBNowOrNever(start().fighters[0], fd, r)]).toEqual([null, true]);
    const world = cpuWorldFromDef(mario, fd);
    const inputs = [0, 1, 2, 3, 4, 5].map((phase) => {
      const s = start();
      s.frame = phase;
      return decideCpu(s, 0, 9, 7, world).input;
    });
    expect(inputs.some((i) => (i & Btn.Special) !== 0)).toBe(false);
    expect(inputs.some((i) => (i & Btn.Jump) !== 0)).toBe(true);
    // And the jump, then the up special, gets him back.
    const run = cpuRun(start(), world, 300);
    expect(recovered(run[run.length - 1])).toBe(true);
  });

  it("does not plan its up special into a grab of a ledge somebody holds in a ledge option", () => {
    // A ledge held by a fighter in a ledge option is refused (`findLedgeGrab`), so
    // a path that ends there only gets back where it comes down on the stage.
    const mario = def("mario");
    const r = recoveryFromDef(mario)!;
    let found = 0;
    for (let x = -84; x >= -110; x -= 2)
      for (let y = -60; y <= 0; y += 3) {
        const f = airborne("finalDestination", "mario", { x: fx(x), y: fx(y), facing: 1 }).fighters[0];
        const grabOnly = upBPlan(f, fd.leftLedge, fd, r) !== null && upBPlan(f, fd.leftLedge, fd, r, 0, false) === null;
        if (grabOnly) found++;
      }
    expect(found).toBeGreaterThan(0);
  });

  it("waits for a ledge held in a ledge option rather than spending its up special into it, where waiting is safe", () => {
    const mario = def("mario");
    const r = recoveryFromDef(mario)!;
    const world = cpuWorldFromDef(mario, fd, [mario, def("fox")]);
    // The first place off the left ledge where only a grab gets Mario back and he can still wait.
    let at: { x: number; y: number } | null = null;
    for (let x = -84; x >= -110 && at === null; x -= 2)
      for (let y = -45; y <= 0 && at === null; y += 3) {
        const f = airborne("finalDestination", "mario", { x: fx(x), y: fx(y), facing: 1 }).fighters[0];
        if (upBPlan(f, fd.leftLedge, fd, r) !== null && upBPlan(f, fd.leftLedge, fd, r, 0, false) === null && !upBNowOrNever(f, fd, r)) at = { x, y };
      }
    expect(at).not.toBeNull();
    const held = (option: "ledgeGetUp" | null) => {
      const s = airborne("finalDestination", "mario", { x: fx(at!.x), y: fx(at!.y), facing: 1 }, fd.leftLedge);
      if (option !== null) Object.assign(s.fighters[1], { action: option, actionFrame: 10, ledge: { platform: 0, side: -1 }, x: fd.leftLedge, y: 0 });
      return [0, 1, 2, 3, 4, 5].some((phase) => {
        s.frame = phase;
        return (decideCpu(s, 0, 9, 7, world).input & Btn.Special) !== 0;
      });
    };
    expect(held(null)).toBe(true);
    expect(held("ledgeGetUp")).toBe(false);
    // One merely hanging there is trumped off by the grab: no hold.
    expect(held("ledgeHang" as "ledgeGetUp")).toBe(true);
  });

  it("prefers a line the stage's wall does not block, in its plan and in its up special (the Task 13b re-review's walls)", () => {
    // Fox under Final Destination's left ledge: up gets him back, and up-toward runs
    // into the stage's wall on the way. A line into the wall is the one the engine stops
    // (Fox at f2681 re-planned into one); since the final wave (ruling R-FW1f) it is no
    // way back at all, where Task 19 had taken it when no other line got back.
    const fox = def("fox");
    const r = recoveryFromDef(fox)!;
    let checked = 0;
    for (let x = -80.5; x >= -84; x -= 0.5)
      for (let y = -50; y <= -10; y += 5) {
        const f = airborne("finalDestination", "fox", { x: fx(x), y: fx(y), facing: 1 }).fighters[0];
        const up = upBReach(f, fd.leftLedge, fd, r, Btn.Up);
        const toward = upBReach(f, fd.leftLedge, fd, r, Btn.Up | Btn.Right);
        if (!up.reached || !toward.throughWall || up.throughWall) continue;
        expect(toward.reached, `${x}, ${y}: a line into the wall`).toBe(false);
        checked++;
        expect(upBPlan(f, fd.leftLedge, fd, r)?.first, `${x}, ${y}`).toBe(Btn.Up);
      }
    expect(checked).toBeGreaterThan(0);
  });

  it("does not spend its up special on the way up from its last jump, but at the jump's top", () => {
    // Mario out of jumps 20 off the ledge and 60 under it, no stick in reach rising
    // or falling: rising from the jump just spent, he drifts; falling, it is now or never.
    const mario = def("mario");
    const r = recoveryFromDef(mario)!;
    const world = cpuWorldFromDef(mario, fd);
    const at = (vy: number) => {
      const s = airborne("finalDestination", "mario", { x: fx(-100), y: fx(-60), vy: fx(vy), jumpsUsed: 2, facing: 1, action: vy > 0 ? "jump" : "fall" }, fx(40));
      expect(upBPlan(s.fighters[0], fd.leftLedge, fd, r), `vy ${vy}`).toBeNull();
      return [0, 1, 2, 3, 4, 5].some((phase) => {
        s.frame = phase;
        return (decideCpu(s, 0, 9, 7, world).input & Btn.Special) !== 0;
      });
    };
    const falling = airborne("finalDestination", "mario", { x: fx(-100), y: fx(-60), vy: -fx(1), jumpsUsed: 2, facing: 1 }).fighters[0];
    expect(upBNowOrNever(falling, fd, r)).toBe(true);
    expect(at(2)).toBe(false);
    expect(at(-1)).toBe(true);
  });

  it("re-presses its up special the frame after a tap jump takes the buffer, and only once Special is up", () => {
    // Mario in a forward air 25 off the ledge, decided on his up special: a held Up
    // turned into a tap jump, which took the buffer from the up special.
    const mario = def("mario");
    const world = cpuWorldFromDef(mario, fd);
    for (let frame = 10; frame < 22; frame++) {
      const s = airborne("finalDestination", "mario", { x: fx(-105), y: fx(-20), action: "attack", move: "fair", actionFrame: 20, facing: 1 }, fx(40));
      s.frame = frame;
      s.fighters[0].bufferedAction = { kind: "jump", frame };
      const d = decideCpu(s, 0, 9, 7, world);
      const heldBefore = ((frame - 1) % 6 + 6) % 6 < 3;
      expect((d.input & Btn.Special) !== 0, `frame ${frame}`).toBe(!heldBefore);
    }
  });

  it("an up special pressed during an offstage aerial comes out on the aerial's first free frame", () => {
    // Mario in a neutral air under Final Destination's left ledge, out of jumps, from
    // every frame of the aerial and every phase of the press pulse: once the CPU has
    // pressed for its up special in the aerial, it keeps pressing, so the up special
    // comes out on the first frame the aerial lets it. Two things held the press off:
    // a press away from the wall it touched, for a wall jump the engine only tries
    // from a jump or a fall (`airMain`), which let the buffered press run out; and the
    // held Up's tap jump, five frames on, taking the buffer (re-pressed at once now).
    const mario = def("mario");
    const world = cpuWorldFromDef(mario, fd);
    let checked = 0;
    for (let into = 0; into <= 40; into += 2)
      for (let phase = 0; phase < 6; phase++) {
        const start = airborne("finalDestination", "mario", { x: fx(-100), y: fx(-12), action: "attack", move: "nair", actionFrame: into, facing: 1 }, fx(40));
        start.frame = phase;
        // Run the CPU through the aerial, noting whether it pressed Special in it.
        const { state: s, pressed } = throughTheAerial(start, 0, world);
        if (!pressed) continue;
        checked++;
        expect([s.fighters[0].action, s.fighters[0].move], `${into} frames in, phase ${phase}`).toEqual(["special", "upB"]);
      }
    expect(checked).toBeGreaterThan(0);
  });

  it("gets an up special pressed in an offstage aerial out on the aerial's first free frame, its press never on the step a held Up tap-jumps (ruling R-FW1g)", () => {
    // Task 20 fix round 1's probe 3: Mario on port 2 (Stick Jump on, the CPU's default),
    // out of jumps, in three aerials off Final Destination's left ledge, from every other
    // frame of the aerial and every phase of the press pulse. A Special pressed on the very
    // step a held Up's tap jump fired lost the buffer to the jump (a jump ranks above a
    // special, `bufferPress`), and the up special came out 3 to 22 frames late.
    const mario = def("mario");
    const world = cpuWorldFromDef(mario, fd);
    const late: string[] = [];
    let checked = 0;
    for (const [move, x, y] of [["nair", -110, 5], ["nair", -100, 10], ["fair", -110, 10]] as const)
      for (let into = 0; into <= 40; into += 2)
        for (let phase = 0; phase < 6; phase++) {
          const start = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "mario" }], RULES, 5);
          Object.assign(start.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(40), y: 0, intangible: 0, invincible: 0 });
          Object.assign(start.fighters[1], { action: "attack", move, actionFrame: into, grounded: false, platform: -1, x: fx(x), y: fx(y), facing: 1, jumpsUsed: 2, intangible: 0, invincible: 0 });
          start.frame = phase;
          const { state: s, pressed } = throughTheAerial(start, 1, world);
          if (!pressed) continue;
          checked++;
          const f = s.fighters[1];
          if (f.action !== "special" || f.move !== "upB") late.push(`${move} ${x} ${y}, ${into} frames in, phase ${phase}: ${f.action}`);
        }
    expect(checked).toBeGreaterThan(300);
    expect(late).toEqual([]);
  }, 30_000);

  it("holds its Special off the one step a held Up tap-jumps on, and only with its own Stick Jump on (ruling R-FW1g)", () => {
    // Mario out of jumps 20 off Final Destination's left ledge, Up pressed four frames ago
    // and held: the next step tap-jumps. On a frame its press pulse is on, it holds Up and
    // presses Special a step later; with its own Stick Jump off there is no tap jump, and
    // it presses at once.
    const mario = def("mario");
    const world = cpuWorldFromDef(mario, fd);
    const pressed = (controls: number) => {
      const s = airborne("finalDestination", "mario", { x: fx(-100), y: fx(-20), vy: -fx(1), facing: 1, jumpsUsed: 2, lastDirPressed: Btn.Up, framesSinceDirPress: 4 }, fx(40));
      s.fighters[0].combat.controls = controls;
      s.frame = 0;
      expect(upBPlan(s.fighters[0], fd.leftLedge, fd, recoveryFromDef(mario)!)).not.toBeNull();
      return (decideCpu(s, 0, 9, 7, world).input & Btn.Special) !== 0;
    };
    expect([pressed(0), pressed(CONTROL_STICK_JUMP_OFF)]).toEqual([false, true]);
  });

  it("steers its up special on every frame at every level: no fumble drops the plan's stick (the level-7 SD on an aim frame)", () => {
    const fox = def("fox");
    const r = recoveryFromDef(fox)!;
    const mid = upB(airborne("finalDestination", "fox", { x: fx(-110), y: fx(10), facing: 1 }, fx(40)), one(Btn.Right), 20)[19];
    const plan = upBPlan(mid.fighters[0], fd.leftLedge, fd, r) ?? upBSticks(r, 1)[0];
    const want = upBStickNow(plan, mid.fighters[0], r);
    expect(want).not.toBe(0);
    for (let seed = 1; seed <= 200; seed++) expect(decideCpu(mid, 0, 1, seed, cpuWorldFromDef(fox, fd)).input, `seed ${seed}`).toBe(want);
  });

  it("does not start an aerial off the stage that would leave it no way back, and lives (the Task 13b re-review's edge aerials)", () => {
    // Mario in the air at Final Destination's left edge, his midair jump spent,
    // edgeguarding an opponent tumbling off the stage beside him: the forward air he
    // chased with ran on and left him deeper than his up special reaches (the
    // re-review: 15 of its 19 such self-destructs were `edgeguard`'s). Played out, at
    // every phase of the swing's pulse: he swings nothing off the stage and lives. With
    // the guard off he swings and dies at every phase (the Task 19 review's M5:
    // re-staged with the jump spent, where the guard is what saves him).
    const mario = def("mario");
    const world = cpuWorldFromDef(mario, fd, [mario, def("fox")]);
    for (let phase = 0; phase < 6; phase++) {
      let s = airborne("finalDestination", "mario", { x: fx(-76), y: fx(18), vy: 0, facing: -1, jumpsUsed: 2 }, fx(-96));
      Object.assign(s.fighters[1], { action: "tumble", grounded: false, platform: -1, y: fx(10), hitstun: 30, damage: fx(60) });
      s.frame = phase;
      let prev: readonly InputFrame[] = [0, 0];
      let seed = 7 + phase;
      let swung = false;
      let died = false;
      for (let i = 0; i < 400; i++) {
        const d = decideCpu(s, 0, 9, seed, world);
        seed = d.seed;
        if (!s.fighters[0].grounded && s.fighters[0].action !== "attack" && (d.input & Btn.Attack) !== 0) swung = true;
        const out = step(s, [d.input, 0], { prevInputs: prev });
        prev = [d.input, 0];
        s = out.state;
        if (out.events.kos.some((k) => k.port === 0)) died = true;
        if (died || s.fighters[0].grounded || s.fighters[0].ledge !== null) break;
      }
      expect([swung, died], `phase ${phase}`).toEqual([false, false]);
    }
    // Over the stage, high up, the same swing is safe and comes out.
    const over = airborne("finalDestination", "mario", { x: 0, y: fx(40), vy: 0, facing: 1, jumpsUsed: 2 }, fx(-6));
    Object.assign(over.fighters[1], { action: "tumble", grounded: false, y: fx(33), hitstun: 30, damage: fx(120) });
    const swings = Array.from({ length: 10 }, (_, phase) => {
      over.frame = phase;
      return decideCpu(over, 0, 9, 7, world).input & Btn.Attack;
    });
    expect(swings.some((a) => a !== 0)).toBe(true);
  });

  it("a stranding aerial held off sends the stick home, Up and Down let go with the swing (the Task 19 review's M4)", () => {
    // Link just past Final Destination's left ledge, out of jumps, a tumbling opponent
    // right under him (a down air) or over him (an up air): either would strand him,
    // and a Down left held fast-falls him (`air.ts`).
    const link = def("link");
    const world = cpuWorldFromDef(link, fd, [link, def("fox")]);
    for (const [oy, vx] of [[-13.2, 0], [13.2, -0.8]] as const) {
      const s = airborne("finalDestination", "link", { x: fd.leftLedge - fx(0.5), y: fx(24), vx: fx(vx), vy: 0, facing: -1, jumpsUsed: 2 }, fd.leftLedge - fx(0.5));
      Object.assign(s.fighters[1], { action: "tumble", grounded: false, platform: -1, y: fx(24 + oy), hitstun: 30, damage: fx(60) });
      for (let phase = 0; phase < 3; phase++) {
        s.frame = phase;
        const d = decideCpu(s, 0, 9, 7, world);
        expect([d.behaviour, d.input], `${oy} phase ${phase}`).toEqual(["attack", Btn.Right]);
      }
    }
  });
});

/**
 * Plan 5, Task 20: a CPU plays the default control options, Stick Jump on, whatever
 * the local player's (`controlsOf`). Its recovery counts on it: a held Up's tap
 * jump takes the buffer from the up special, and it presses again (Task 19). And
 * its model runs (`ghostStep`) step copies of its own fighter, so they read its own
 * options, never the other player's.
 */
describe("a CPU on the default control options (Plan 5, Task 20)", () => {
  const fd = stageViewFromDef(finalDestination);
  const def = (id: string) => FIGHTERS.find((d) => d.id === id)!;
  /** P1, the local player, with Stick Jump off, standing on the stage; P2 a CPU, its slot as the menus left it. */
  const localOffCpu = (cpu: Partial<FighterState>): GameState => {
    const s = createInitialState(
      "finalDestination",
      [
        { defId: "mario", controls: controlsOf({ kind: "human", stickJump: false }) },
        { defId: "mario", controls: controlsOf({ kind: "cpu", stickJump: false }) },
      ],
      RULES,
      5,
    );
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(40), y: 0, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[1], { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0, invincible: 0, ...cpu });
    return s;
  };

  it("gets its up special out of an offstage aerial with the local player's Stick Jump off, through its own tap jump", () => {
    // The CPU, on port 2 beside a local player with Stick Jump off, in a forward air 25
    // left of Final Destination's ledge, out of jumps, from every other frame of the
    // aerial (Task 19's grid) and every phase of the press pulse. Decided on its up
    // special, it holds Up, which tap-jumps five frames on and takes the buffer from the
    // Special; it presses again (Task 19), and the up special comes out on the aerial's
    // first free frame. That path is Stick Jump's: with the CPU's own option forced off
    // there is no tap jump to take the buffer, and this fails (Task 20 fix round 1's M1).
    // Each run is two (the option on, then forced off), hence its own timeout.
    const world = cpuWorldFromDef(def("mario"), fd);
    const runs = (own?: number) => {
      const out: { at: string; state: GameState; pressed: boolean; tapJumped: boolean }[] = [];
      for (let into = 0; into <= 40; into += 2)
        for (let phase = 0; phase < 6; phase++) {
          const start = localOffCpu({ x: fx(-110), y: fx(5), action: "attack", move: "fair", actionFrame: into, facing: 1, jumpsUsed: 2 });
          expect(start.fighters.map((f) => f.combat.controls)).toEqual([CONTROL_STICK_JUMP_OFF, 0]);
          if (own !== undefined) start.fighters[1].combat.controls = own;
          start.frame = phase;
          out.push({ at: `${into} frames in, phase ${phase}`, ...throughTheAerial(start, 1, world) });
        }
      return out.filter((r) => r.pressed);
    };
    const played = runs();
    expect(played.length).toBeGreaterThan(0);
    for (const r of played) {
      expect(r.tapJumped, `${r.at}: a tap jump took the buffer`).toBe(true);
      expect([r.state.fighters[1].action, r.state.fighters[1].move], r.at).toEqual(["special", "upB"]);
    }
    // The CPU's own option forced off: the same aerials never tap-jump.
    expect(runs(CONTROL_STICK_JUMP_OFF).filter((r) => r.tapJumped)).toEqual([]);
  }, 30_000);

  it("models its own fall on its own Stick Jump: a held Up jumps in its model as it does in step()", () => {
    // Mario falling over the middle of the stage, his midair jump left, Up pressed and
    // held: on the default options its tap jump spends the jump five frames on, and
    // the floor is further off; with Stick Jump off it only falls.
    const mario = def("mario");
    /** Port 2 holds Up from now until it lands: the steps that takes, and whether it spent its jump on the way. */
    const run = (s0: GameState): { frames: number; jumped: boolean } => {
      let s = s0;
      let prev: readonly InputFrame[] = [0, 0];
      let frames = 0;
      let jumped = false;
      while (!s.fighters[1].grounded && frames < 200) {
        const now = [0, Btn.Up];
        s = step(s, now, { prevInputs: prev }).state;
        prev = now;
        frames++;
        if (s.fighters[1].jumpsUsed === 2) jumped = true;
      }
      return { frames, jumped };
    };
    const over = { x: fx(-10), y: fx(30), vx: 0, vy: 0, jumpsUsed: 1, facing: 1 } as const;
    // The CPU, on port 2, beside a local player with Stick Jump off.
    const cpu = localOffCpu(over);
    const model = floorContact(mario, cpu.fighters[1], fd, cpu.frame, 200, 0, Btn.Up, true);
    const engine = run(cpu);
    expect(engine.jumped).toBe(true);
    expect(model?.frames).toBe(engine.frames);
    // The same fall with Stick Jump off: no jump, in the model as in step().
    const off = localOffCpu(over);
    off.fighters[1].combat.controls = CONTROL_STICK_JUMP_OFF;
    const offModel = floorContact(mario, off.fighters[1], fd, off.frame, 200, 0, Btn.Up, true);
    const offEngine = run(off);
    expect(offEngine.jumped).toBe(false);
    expect(offModel?.frames).toBe(offEngine.frames);
    expect(engine.frames).toBeGreaterThan(offEngine.frames);
  });
});
