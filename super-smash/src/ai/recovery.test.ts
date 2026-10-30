/**
 * The CPU's model of its own up special (Plan 5, Task 4b fix round 1) is the
 * engine's: where `upBPath` says the move takes the fighter is where `step()`
 * takes it, frame for frame, with the stick held toward the stage, through the
 * move and on into its helpless fall. A model that only agrees with itself
 * misjudged a fighter facing away from the stage by 85-95 units (the Task 4b
 * review: Fox 93.6, Donkey Kong 84.2), and the CPU waited until no up special
 * could save it.
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
import { recoveryFromDef, stageViewFromDef, upBInReach, upBNowOrNever, upBPath } from "./behaviours";

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

const dir = (toward: number): InputFrame => (toward > 0 ? Btn.Right : Btn.Left);

/** `id` in the air at `at` on `stage`, out of jumps; Mario standing far off. */
function airborne(stage: string, id: string, at: Partial<FighterState>, marioX = fx(2000)): GameState {
  const s = createInitialState(stage, [{ defId: id }, { defId: "mario" }], RULES, 5);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0, invincible: 0, jumpsUsed: 2, ...at });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, intangible: 0, invincible: 0, x: marioX });
  return s;
}

/** Up special on the first frame, the stick toward `toward` on every frame; every frame's state. */
function upB(start: GameState, toward: number, frames: number): GameState[] {
  const out: GameState[] = [];
  let state = start;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < frames; i++) {
    const now = [dir(toward) | (i === 0 ? Btn.Up | Btn.Special : 0), 0];
    state = step(state, now, { prevInputs: prev }).state;
    prev = now;
    out.push(state);
  }
  return out;
}

/** The fighter reached the stage: standing on it, landing on it, or hanging from its ledge. */
const recovered = (f: FighterState): boolean => f.ledge !== null || (f.grounded && f.action !== "dead");

describe("the CPU's up special model", () => {
  it("exists for every fighter on the roster, read off the move the engine runs", () => {
    // A move that lost its momentum (Task 13 moves it into scripts) would leave
    // the CPU firing blind: this fails first.
    for (const def of FIGHTERS) expect(recoveryFromDef(def), def.id).not.toBeNull();
  });

  // Exact, frame for frame: the model runs the engine's own rules (the
  // script's momentum windows, `airControlX`, `gravityStep`, the helpless cap).
  const HELPLESS_FRAMES = 30;
  for (const def of FIGHTERS) {
    it(`puts ${def.id} where step() does, every frame, facing either way and steering either way`, () => {
      const r = recoveryFromDef(def)!;
      const frames = r.totalFrames + HELPLESS_FRAMES;
      for (const facing of [1, -1])
        for (const toward of [1, -1])
          for (const vx of [-fx(1), fx(0.5)])
            for (const [vy, fastFalling] of [[-fx(1.5), false], [fx(1), false], [-fx(1), true]] as const) {
              // A fast fall the up special began in keeps its terminal speed.
              const start = airborne("void", def.id, { x: 0, y: 0, vx, vy, facing, fastFalling });
              const engine = upB(start, toward, frames).map((s) => s.fighters[0]);
              const model = upBPath(r, { vx, vy, facing, fastFalling }, toward, frames);
              const at = `facing ${facing}, toward ${toward}, vx ${vx}, vy ${vy}, fast fall ${fastFalling}`;
              expect(engine[r.totalFrames - 1].action, at).toBe("special");
              expect(engine[r.totalFrames].action, at).toBe("specialFall");
              expect(
                model.map((p) => [p.x, p.y]),
                at,
              ).toEqual(engine.map((f) => [f.x - start.fighters[0].x, f.y - start.fighters[0].y]));
            }
    });
  }
});

describe("when the CPU spends its up special", () => {
  const fd = stageViewFromDef(finalDestination);

  it("judges Fox in reach facing away from the stage, where the engine's up special does reach it", () => {
    // Fox facing away (left), 30 off Final Destination's left ledge (x -80).
    // The engine, steering right through the move, lands him on the stage; the
    // old model put him 93.6 further off and waited.
    const at = { x: fx(-110), y: fx(10), vx: 0, vy: 0, facing: -1 };
    const engine = upB(airborne("finalDestination", "fox", at, fx(40)), 1, 200).map((s) => s.fighters[0]);
    expect(engine.some(recovered), "the engine's up special reaches the stage").toBe(true);
    const self = airborne("finalDestination", "fox", at).fighters[0];
    expect(upBInReach(self, fd.leftLedge, fd, recoveryFromDef(FIGHTERS.find((d) => d.id === "fox")!)!)).toBe(true);
  });

  it("is sound: wherever it judges the up special in reach, the engine's up special reaches the stage", () => {
    for (const def of FIGHTERS) {
      const r = recoveryFromDef(def)!;
      for (const facing of [1, -1])
        for (const x of [-100, -130, -160])
          for (const y of [-40, 0, 40]) {
            const at = { x: fx(x), y: fx(y), vx: 0, vy: 0, facing };
            const self = airborne("finalDestination", def.id, at).fighters[0];
            if (!upBInReach(self, fd.leftLedge, fd, r)) continue;
            const engine = upB(airborne("finalDestination", def.id, at, fx(40)), 1, 260).map((s) => s.fighters[0]);
            expect(engine.some(recovered), `${def.id} facing ${facing} at ${x}, ${y}`).toBe(true);
          }
    }
  });

  it("gets Fox back from the Task 4b review's mario-fox case: out of jumps, facing away, rising", () => {
    // The review's Town & City trace (mario-fox, the CPU sweep at f312780): Fox
    // just out of jumps on frame 1281, facing away, rising from x -135.3 to a
    // peak of 31.6. That model waited until frame 1347 (y -66, under the
    // ledge) and he died; an up special on frame 1290 or 1320 would have landed
    // him. His state on frame 1281, Q12, as the sweep had it:
    let state = airborne("townAndCity", "fox", { action: "jump", actionFrame: 3, x: -554216, y: 38183, vx: -1351, vy: 13600, facing: -1 }, fx(40));
    const world: CpuWorld = cpuWorldFromDef(FIGHTERS.find((d) => d.id === "fox")!, stageViewFromDef(townAndCity));
    let prev: readonly InputFrame[] = [0, 0];
    let seed = 7;
    let back = false;
    for (let i = 0; i < 300 && !back; i++) {
      const d = decideCpu(state, 0, 9, seed, world);
      seed = d.seed;
      const now = [d.input, 0];
      state = step(state, now, { prevInputs: prev }).state;
      prev = now;
      expect(state.fighters[0].action, `frame ${i}`).not.toBe("dead");
      back = recovered(state.fighters[0]);
    }
    expect(back).toBe(true);
  });
});

/*
 * Plan 5, Task 13 (the Task 4b review's carry): an up special that runs its
 * imported script publishes no momentum (SSBU moves a fighter by its
 * animation, which no source publishes). The engine keeps the legacy move's
 * (`moveMomentum`), and so must the CPU's model, or it would read "no up special
 * worth judging" and spend it as soon as it is needed. In the game, Link's Spin
 * Attack is such a move: a limb-bone script the bake places.
 */
describe("the CPU's up special model in the game's form of each fighter (Plan 5, Task 13)", () => {
  const GAME: SimContext = bakedContext(
    { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => [...STAGES, VOID].find((s) => s.id === id)! },
    readBakeFromDisk(),
  );
  const fd = stageViewFromDef(finalDestination);

  /** `id` in the air at `at` on `stage`, out of jumps, in the game's context; Mario standing far off. */
  function airborneInGame(stage: string, id: string, at: Partial<FighterState>): GameState {
    const s = createInitialState(stage, [{ defId: id }, { defId: "mario" }], RULES, 5, GAME);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0, invincible: 0, jumpsUsed: 2, ...at });
    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, intangible: 0, invincible: 0, x: fx(2000) });
    return s;
  }

  it("runs Link's up special from its imported script, which sets no momentum of its own", () => {
    const link = GAME.fighter("link");
    const script = link.scripts?.upB;
    expect(script).toBeDefined();
    expect(flatten(script!).some((c) => c.op === "momentum")).toBe(false);
  });

  it("exists for every fighter in the game's form, read off the move the engine runs", () => {
    for (const def of FIGHTERS) expect(recoveryFromDef(GAME.fighter(def.id)), def.id).not.toBeNull();
  });

  it("puts Link where the game's step() does, every frame, facing either way and steering either way", () => {
    const r = recoveryFromDef(GAME.fighter("link"))!;
    const frames = r.totalFrames + 30;
    for (const facing of [1, -1])
      for (const toward of [1, -1]) {
        const start = airborneInGame("void", "link", { x: 0, y: 0, vx: fx(0.5), vy: -fx(1.5), facing });
        let state = start;
        let prev: readonly InputFrame[] = [0, 0];
        const engine: FighterState[] = [];
        for (let i = 0; i < frames; i++) {
          const now = [dir(toward) | (i === 0 ? Btn.Up | Btn.Special : 0), 0];
          state = step(state, now, { prevInputs: prev, ctx: GAME }).state;
          prev = now;
          engine.push(state.fighters[0]);
        }
        const model = upBPath(r, { vx: fx(0.5), vy: -fx(1.5), facing, fastFalling: false }, toward, frames);
        expect(engine[r.totalFrames - 1].action).toBe("special");
        expect(engine[r.totalFrames].action).toBe("specialFall");
        expect(model.map((p) => [p.x, p.y]), `facing ${facing}, toward ${toward}`).toEqual(engine.map((f) => [f.x - start.fighters[0].x, f.y - start.fighters[0].y]));
      }
  });

  it("does not spend Link's up special at once out of its reach, and still gets him back", () => {
    // Link out of jumps, 120 off Final Destination's left ledge (x -80) and 80 up:
    // the up special first reaches from 73 frames of drifting in (measured), and
    // without the model the CPU spent it on the first frame it could.
    let state = airborneInGame("finalDestination", "link", { x: fx(-200), y: fx(80), vx: 0, vy: 0, facing: 1 });
    const world: CpuWorld = cpuWorldFromDef(GAME.fighter("link"), fd);
    expect(world.recovery).not.toBeNull();
    const r = world.recovery!;
    const judged = (f: FighterState): boolean => upBInReach(f, fd.leftLedge, fd, r) || upBNowOrNever(f, fd, r);
    expect(judged(state.fighters[0]), "out of reach where it starts").toBe(false);
    let prev: readonly InputFrame[] = [0, 0];
    let seed = 7;
    let firstPress = -1;
    let back = false;
    for (let i = 0; i < 400 && !back; i++) {
      const self = state.fighters[0];
      const d = decideCpu(state, 0, 9, seed, world);
      seed = d.seed;
      if (firstPress < 0 && (d.input & Btn.Special) !== 0) {
        firstPress = i;
        expect(judged(self), `pressed on frame ${i} out of reach`).toBe(true);
      }
      const now = [d.input, 0];
      state = step(state, now, { prevInputs: prev, ctx: GAME }).state;
      prev = now;
      expect(state.fighters[0].action, `frame ${i}`).not.toBe("dead");
      back = recovered(state.fighters[0]);
    }
    expect(firstPress).toBeGreaterThan(30);
    expect(back).toBe(true);
  });
});
