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
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, StageDef } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { finalDestination } from "@/stages/finalDestination";
import { townAndCity } from "@/stages/townAndCity";
import { cpuWorldFromDef } from "./cpu";
import { recoveryFromDef, stageViewFromDef, upBInReach, upBNowOrNever, upBPath, upBPlan, upBSticks, type UpBStick } from "./behaviours";

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

/** Up special on the first frame, holding `plan` as the move runs; every frame's state. */
function upB(start: GameState, plan: UpBStick, frames: number, ctx?: SimContext): GameState[] {
  const out: GameState[] = [];
  let state = start;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < frames; i++) {
    // The press is move frame 1; frame i + 1 of the move is step i.
    const dir = plan.switchAt > 0 && i + 1 >= plan.switchAt ? plan.then : plan.first;
    const now = [dir | (i === 0 ? Btn.Up | Btn.Special : 0), 0];
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
    for (const def of FIGHTERS) {
      const r = recoveryFromDef(def)!;
      for (const facing of [1, -1])
        for (const x of [-100, -130, -160])
          for (const y of [-40, 0, 40]) {
            const at = { x: fx(x), y: fx(y), vx: 0, vy: 0, facing };
            const self = airborne("finalDestination", def.id, at).fighters[0];
            const plan = upBPlan(self, fd.leftLedge, fd, r);
            if (plan === null) continue;
            const engine = upB(airborne("finalDestination", def.id, at, fx(40)), plan, 260).map((s) => s.fighters[0]);
            expect(engine.some(recovered), `${def.id} facing ${facing} at ${x}, ${y}`).toBe(true);
          }
    }
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
    // It first judges the up special worth it after 30 frames of drifting in (measured).
    expect(firstPress).toBeGreaterThan(0);
    expect(back).toBe(true);
  });
});
