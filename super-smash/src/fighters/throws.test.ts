/**
 * Throws and pummels the way SSBU runs them (Plan 5, Task 7): a throw's
 * launch is an `ATTACK_ABS` laid on the held fighter by `ATK_HIT_ABS`, not a
 * hitbox that has to find them, and a pummel (`set_catch_only_all`) hurts the
 * held fighter without letting them go.
 *
 * Frame numbers are rubendal's SSBU Data Viewer scripts (patch 13.0.1,
 * https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json,
 * imported into `acmd/generated/`) and UltimateFrameData's throw rows
 * (https://ultimateframedata.com/<fighter>).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { gameScriptFor } from "@/engine/acmd/legacy";
import { gameFrameOfMotion, runScript } from "@/engine/acmd/interpreter";
import { fx, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { moveFrameOf } from "@/engine/hitbox";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, MoveSlot, StepEvents } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `thrower` holding Fox, as a landed grab leaves them. */
function holding(thrower: string, ctx?: SimContext): GameState {
  const s = createInitialState("finalDestination", [{ defId: thrower }, { defId: "fox" }], RULES, 5, ctx);
  const [a, v] = s.fighters;
  Object.assign(a, { action: "grabHold", actionFrame: 0, grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
  Object.assign(v, { action: "grabbed", actionFrame: 0, grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, grabbedBy: 0, grabTimer: 500 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[], ctx?: SimContext): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = s0.fighters.map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = s0.fighters.map((_, port) => (port === 0 ? i : 0));
    const out = step(s, now, { prevInputs: prev, ...(ctx ? { ctx } : {}) });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

/** The steps on which port 0 landed a hit, with the move frame it landed on. */
function hitsBy0(states: readonly GameState[], events: readonly StepEvents[]) {
  return events.flatMap((e, i) =>
    e.hits.filter((h) => h.attacker === 0).map((h) => ({ step: i, frame: moveFrameOf(states[i].fighters[0].actionFrame), ...h })),
  );
}

describe("throws", () => {
  it("land Mario's forward throw on frame 13, wherever Fox is (ATTACK_ABS 8%, angle 45)", () => {
    const s = holding("mario");
    // Even held well away from the hand, the throw lands: no hitbox has to reach.
    s.fighters[1].x = fx(30);
    const { states, events } = run(s, [Btn.Right, ...Array<InputFrame>(30).fill(0)]);
    // Frame 13 of the throw: the twelfth step after the one that started it.
    const at = events.findIndex((e) => e.hits.length > 0);
    expect(at).toBe(12);
    expect(toFloat(events[at].hits[0].damage)).toBeCloseTo(8 * 1.05 * 1.2, 2);
    expect(states[at].fighters[1].grabbedBy).toBe(-1);
    expect(states[states.length - 1].fighters[1].vx).toBeGreaterThan(0);
  });

  it("turns the thrower round for a back throw that reverses (REVERSE_LR)", () => {
    const { states } = run(holding("samus"), [Btn.Left, ...Array<InputFrame>(40).fill(0)]);
    expect(states.some((s) => s.fighters[0].facing === -1)).toBe(true);
    // Launched behind her: to the left of where she was held.
    expect(states[states.length - 1].fighters[1].x).toBeLessThan(fx(-10));
  });

  // Samus's `game_throwb`: `frame(12) REVERSE_LR() ATK_HIT_ABS(...)`, 10% at 40°
  // (UFD "Backward Throw 12 49"): she turns on frame 12, and the throw lands the
  // same frame, the way she now faces.
  it("turns Samus round on frame 12 and no earlier, and leaves her facing the way she threw", () => {
    const { states } = run(holding("samus"), [Btn.Left, ...Array<InputFrame>(60).fill(0)]);
    const turned = states.findIndex((s) => s.fighters[0].facing === -1);
    expect(moveFrameOf(states[turned].fighters[0].actionFrame)).toBe(12);
    expect(states[turned].fighters[1].grabbedBy).toBe(-1);
    // Turned once: she stands facing left after the throw.
    const end = states.at(-1)!.fighters[0];
    expect(end).toMatchObject({ action: "stand", facing: -1, grabbing: -1 });
    expect(states.every((s, i) => i < turned || s.fighters[0].facing === -1)).toBe(true);
  });

  // The carry (Plan 3 Task 14 re-review): Kirby's down throw landed only its first
  // box and freed the victim on frame ~24 while Kirby played out an 87-frame throw.
  // `game_throwlw`: nine 1% `set_catch_only_all` stomps four frames apart from frame
  // 9, a tenth on 56, and `ATK_HIT_ABS` on 58 with the 2% ATTACK_ABS (63°, BKB 60,
  // KBG 180). UFD "Down Throw 9 87, Throw releases on 58. Active: 9—10/13—14/17—18/
  // 21—22/25—26/29—30/33—34/37—38/41—42/56—57. 1.0/2.0".
  it("lands Kirby's down throw whole: ten stomps on the fighter held, then the launch on frame 58", () => {
    const { states, events } = run(holding("kirby"), [Btn.Down, ...Array<InputFrame>(100).fill(0)]);
    const hits = hitsBy0(states, events);
    expect(hits.map((h) => h.frame)).toEqual([9, 13, 17, 21, 25, 29, 33, 37, 41, 56, 58]);
    // The ten stomps hurt and hold: no launch, the link whole.
    for (const h of hits.slice(0, 10)) {
      expect(h.knockback, `stomp on frame ${h.frame}`).toBe(0);
      expect(states[h.step].fighters[1], `stomp on frame ${h.frame}`).toMatchObject({ action: "thrown", grabbedBy: 0 });
    }
    // The release: the 2% ATTACK_ABS at 63°, launching Fox.
    const launch = hits[10];
    expect(launch.knockback).toBeGreaterThan(0);
    expect(launch.angle).toBe(fx(63));
    expect(toFloat(launch.damage)).toBeCloseTo(2 * 1.05 * 1.2, 2);
    expect(states[launch.step].fighters[1].grabbedBy).toBe(-1);
    expect(toFloat(states.at(-1)!.fighters[1].damage)).toBeCloseTo(12 * 1.05 * 1.2, 1);
    // Never free before the release.
    expect(states.slice(0, launch.step).every((s) => s.fighters[1].grabbedBy === 0)).toBe(true);
  });

  // Ruling P5-R7: a legacy back throw authored pointing forward turns its thrower
  // round on `MoveDef.turnAt`, the game's `REVERSE_LR`. Donkey Kong's back throw
  // stays on its legacy move (its script runs `HitModule::set_status_all`). Since
  // Plan 5 Task 8 it is his own back throw, `game_throwb` (rubendal Data Viewer
  // 13.0.1): 11% at 40°, `REVERSE_LR()` and `ATK_HIT_ABS` both on frame 15. (It
  // held the cargo back throw's numbers, 13% at 72° on 16, which are
  // `cargoBthrow`'s now: `fighters/cargo.test.ts`.)
  it("turns a legacy back throw that points forward (Donkey Kong's, 40°) and launches behind", () => {
    const { states, events } = run(holding("donkeyKong"), [Btn.Left, ...Array<InputFrame>(80).fill(0)]);
    const hits = hitsBy0(states, events);
    expect(hits).toHaveLength(1);
    const turned = states.findIndex((s) => s.fighters[0].facing === -1);
    expect(moveFrameOf(states[turned].fighters[0].actionFrame)).toBe(15);
    expect(hits[0].frame).toBe(15);
    expect(toFloat(hits[0].damage)).toBeCloseTo(11 * 1.05 * 1.2, 2);
    const out = states.findIndex((s, i) => i > hits[0].step && s.fighters[1].hitlag === 0);
    expect(states[out].fighters[1].vx).toBeLessThan(0);
    expect(states.at(-1)!.fighters[0]).toMatchObject({ action: "stand", facing: -1 });
  });

  // Every back throw the roster runs, legacy or scripted, plain or the game's:
  // it either turns its thrower once before the launch (`REVERSE_LR`: a script's,
  // or a legacy one's `turnAt`) or is authored behind (over 90°), never both.
  it("sends every roster back throw behind: one turn before a forward launch, or a launch authored behind", () => {
    const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
    const game = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());
    for (const def of [...FIGHTERS, ...FIGHTERS.map((f) => game.fighter(f.id))]) {
      const script = gameScriptFor(def, "bthrow")!;
      let turns = 0;
      let angle = -1;
      for (let g = 1; g <= def.moves.bthrow!.totalFrames && angle < 0; g++) {
        const st = runScript(script, g);
        turns += st.fired.filter((c) => c.op === "reverseLr").length;
        if (st.fired.some((c) => c.op === "hitAbs")) angle = toFloat(st.throwAbs!.angle);
      }
      const behind = angle > 90 && angle < 270;
      expect([turns, behind], `${def.id} ${script.name} at ${angle}°`).toEqual(behind ? [0, true] : [1, false]);
      // A legacy one turns by `turnAt`, and only one that points forward has it.
      if (def.scripts?.bthrow === undefined) expect(def.moves.bthrow!.turnAt !== undefined, def.id).toBe(!behind);
    }
  });
});

describe("throws in the baked world (the game's)", () => {
  const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
  const CTX = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());

  // Mario's `game_throwb` hangs an 8% `hip` box on frame 13 with no
  // `set_catch_only_all`, then turns on 40 (`REVERSE_LR`) and lands the 11%
  // ATTACK_ABS (45°) on 44: UFD "Backward Throw 44 59 11.0". Ruling P5-R8: a
  // captor's box that is not catch-only skips the fighter it holds, so the hip
  // box leaves Fox to the throw. SmashWiki "Throw" (https://www.ssbwiki.com/Throw):
  // "a few throws such as Mario's back throw have collateral hitboxes, which can
  // only hit bystanders and not the thrown opponent".
  it("Mario's back throw: the hip box leaves the fighter held alone, the throw lands on 44 behind him", () => {
    const { states, events } = run(holding("mario", CTX), [Btn.Left, ...Array<InputFrame>(70).fill(0)], CTX);
    expect(CTX.fighter("mario").scripts?.bthrow, "the baked game runs the script").toBeDefined();
    const hits = hitsBy0(states, events);
    expect(hits.map((h) => h.frame)).toEqual([44]);
    expect(toFloat(hits[0].damage)).toBeCloseTo(11 * 1.05 * 1.2, 2);
    const turned = states.findIndex((s) => s.fighters[0].facing === -1);
    expect(moveFrameOf(states[turned].fighters[0].actionFrame)).toBe(40);
    expect(states[hits[0].step + 1].fighters[1].vx).toBeLessThan(0);
    expect(states.at(-1)!.fighters[1].x).toBeLessThan(states.at(-1)!.fighters[0].x);
  });

  it("Kirby's down throw lands the same way in the game's world", () => {
    const { states, events } = run(holding("kirby", CTX), [Btn.Down, ...Array<InputFrame>(100).fill(0)], CTX);
    expect(hitsBy0(states, events).map((h) => [h.frame, h.knockback > 0])).toEqual([
      ...[9, 13, 17, 21, 25, 29, 33, 37, 41, 56].map((f) => [f, false]),
      [58, true],
    ]);
  });
});

describe("pummels", () => {
  it("hurt the fighter held and keep holding them", () => {
    const { states, events } = run(holding("mario"), [Btn.Attack, ...Array<InputFrame>(12).fill(0)]);
    expect(events.some((e) => e.hits.length > 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBeGreaterThan(0);
    expect(end.fighters[1].action).toBe("grabbed");
    expect(end.fighters[0].grabbing).toBe(1);
  });

  it("never hit a bystander", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }, { defId: "kirby" }], { ...RULES, oneOnOne: false }, 5);
    const [a, v, by] = s.fighters;
    Object.assign(a, { action: "grabHold", grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
    // Kirby stands right where the pummel lands, inside Fox.
    Object.assign(v, { action: "grabbed", grounded: true, platform: 0, x: fx(4), y: 0, intangible: 0, grabbedBy: 0, grabTimer: 500 });
    Object.assign(by, { action: "stand", grounded: true, platform: 0, x: fx(5), y: 0, intangible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    for (const i of [Btn.Attack, 0, 0, 0, 0, 0]) {
      const now = [i, 0, 0];
      st = step(st, now, { prevInputs: prev }).state;
      prev = now;
    }
    expect(st.fighters[2].damage).toBe(0);
    expect(st.fighters[1].damage).toBeGreaterThan(0);
  });

  // Ruling P5-R10: a pummel lasts its move's `totalFrames`, the script's first
  // actionable frame − 1 (Mario's `game_catchattack`, CancelFrame 7), after its
  // freeze — not a flat 10.
  it("last their move's length, not a flat ten frames", () => {
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    expect(mario.moves.pummel!.totalFrames).toBe(6);
    const { states } = run(holding("mario"), [Btn.Attack, ...Array<InputFrame>(40).fill(0)]);
    const lag = states[0].fighters[0].hitlag;
    expect(lag).toBeGreaterThan(0);
    const back = states.findIndex((s) => s.fighters[0].action === "grabHold");
    expect(back).toBe(lag + 6);
  });
});

describe("a throw's exit paths and rollback", () => {
  it("re-simulates hash-equal from a snapshot taken mid-throw, between the stomps and the release", () => {
    const inputs = [Btn.Down, ...Array<InputFrame>(90).fill(0)];
    const { states } = run(holding("kirby"), inputs);
    // Step 30 is mid-throw: stomps landed, the release to come.
    const snap = cloneState(states[30]);
    expect(snap.fighters[0].action).toBe("throw");
    const again = run(snap, inputs.slice(31)).states;
    again.forEach((s, k) => expect(hashState(s), `step ${31 + k}`).toBe(hashState(states[31 + k])));
    expect(again.at(-1)!.fighters[1].grabbedBy).toBe(-1);
  });

  // SmashWiki "Throw" (https://www.ssbwiki.com/Throw): in Ultimate "the thrower is
  // now invincible until the opponent has been thrown" (fix round 1). So a hit on
  // the thrower mid-throw, which used to free the fighter held, changes nothing.
  it("lets a hit on the thrower change nothing before the release: Kirby is invincible to frame 58", () => {
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "fox" }, { defId: "mario" }], { ...RULES, oneOnOne: false }, 5);
    const [a, v, m] = s.fighters;
    Object.assign(a, { action: "grabHold", grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
    Object.assign(v, { action: "grabbed", grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, grabbedBy: 0, grabTimer: 500 });
    // Mario behind Kirby, facing him, jabs on steps 20 and 40: far enough back that
    // the jab reaches Kirby's back and not Fox beyond him (a hit on the fighter held
    // frees them: that is not a hit on the thrower).
    Object.assign(m, { action: "stand", grounded: true, platform: 0, x: fx(-17), y: 0, facing: 1, intangible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    const onKirby: number[] = [];
    let launch = -1;
    for (let i = 0; i < 90; i++) {
      const now = [i === 0 ? Btn.Down : 0, 0, i === 20 || i === 40 ? Btn.Attack : 0];
      const out = step(st, now, { prevInputs: prev });
      st = out.state;
      prev = now;
      for (const h of out.events.hits) {
        if (h.victim === 0) onKirby.push(h.damage);
        if (h.attacker === 0 && h.knockback > 0) launch = moveFrameOf(st.fighters[0].actionFrame);
      }
    }
    // The jabs connect, and transfer nothing (an invincible hit).
    expect(onKirby.length).toBeGreaterThan(0);
    expect(onKirby.every((d) => d === 0)).toBe(true);
    expect(st.fighters[0].damage).toBe(0);
    expect(st.fighters[1].damage, "Fox: the stomps and the launch, nothing of Mario's").toBeGreaterThan(0);
    // The throw goes on: the release on 58, as without them.
    expect(launch).toBe(58);
  });

  it("is invincible to the release frame and no further (SmashWiki: Pikachu's down throw, invincibility 1-21)", () => {
    // A respawn invincibility counter is the other source; the throw's needs none.
    const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
    const game = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((x) => x.id === id)! }, readBakeFromDisk());
    const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "fox" }, { defId: "mario" }], { ...RULES, oneOnOne: false }, 5, game);
    const [a, v, m] = s.fighters;
    Object.assign(a, { action: "grabHold", grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
    Object.assign(v, { action: "grabbed", grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, grabbedBy: 0, grabTimer: 500 });
    Object.assign(m, { action: "stand", grounded: true, platform: 0, x: fx(-12), y: 0, facing: 1, intangible: 0 });
    // Mario jabs over and over; what lands on Pikachu, by Pikachu's move frame.
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    const hurt: [number, number][] = [];
    for (let i = 0; i < 70; i++) {
      const now = [i === 0 ? Btn.Down : 0, 0, i % 4 === 1 ? Btn.Attack : 0];
      const before = st.fighters[0];
      const out = step(st, now, { prevInputs: prev, ctx: game });
      st = out.state;
      prev = now;
      // The throw's frame when the hit landed: a hit that lands ends the throw and
      // restarts the frame count, so read it from before the step then.
      const after = st.fighters[0];
      const frame = after.action === "throw" ? moveFrameOf(after.actionFrame) : moveFrameOf(before.actionFrame) + 1;
      for (const h of out.events.hits) if (h.victim === 0 && before.action === "throw") hurt.push([frame, h.damage]);
    }
    const free = hurt.filter(([, d]) => d > 0).map(([f]) => f);
    expect(hurt.filter(([, d]) => d === 0).length, "jabs met the invincible throw").toBeGreaterThan(0);
    expect(free.length, "and one hurt once it was over").toBeGreaterThan(0);
    expect(Math.min(...free), "the first hit that hurts").toBeGreaterThan(21);
    expect(hurt.filter(([f]) => f <= 21).every(([, d]) => d === 0)).toBe(true);
  });

  // Every path that ends a grab clears both ends (`releaseGrab`), which also
  // guards a stale index; so does the throw. Forged here: Fox is held by Kirby
  // (port 2) while Mario's `grabbing` still names him.
  it("lands a throw only on the fighter its thrower still holds, both ends of the link", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }, { defId: "kirby" }], { ...RULES, oneOnOne: false }, 5);
    const [a, v, k] = s.fighters;
    Object.assign(a, { action: "grabHold", grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
    Object.assign(v, { action: "grabbed", grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, grabbedBy: 0, grabTimer: 500 });
    Object.assign(k, { action: "stand", grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    const hits: number[] = [];
    for (let i = 0; i < 30; i++) {
      if (i === 3) {
        st = cloneState(st);
        Object.assign(st.fighters[1], { grabbedBy: 2 });
        Object.assign(st.fighters[2], { action: "grabHold", grabbing: 1 });
      }
      const now = [i === 0 ? Btn.Right : 0, 0, 0];
      const out = step(st, now, { prevInputs: prev });
      st = out.state;
      prev = now;
      for (const h of out.events.hits) if (h.attacker === 0) hits.push(h.victim);
    }
    expect(hits).toEqual([]);
  });

  it("launches nobody once the thrower is KO'd mid-throw", () => {
    const { states } = run(holding("kirby"), [Btn.Down, ...Array<InputFrame>(20).fill(0)]);
    const s = cloneState(states.at(-1)!);
    expect(s.fighters[0].action).toBe("throw");
    // Past the bottom blast zone (Final Destination's is at -140), off the floor:
    // both go, the link with them.
    Object.assign(s.fighters[0], { y: fx(-400), grounded: false, platform: -1 });
    const after = run(s, Array<InputFrame>(80).fill(0));
    const hits = after.events.flatMap((e) => e.hits.filter((h) => h.attacker === 0));
    expect(hits).toEqual([]);
    expect(after.states.at(-1)!.fighters[0].grabbing).toBe(-1);
    expect(after.states.at(-1)!.fighters[1].grabbedBy).toBe(-1);
  });
});

describe("what each roster throw runs", () => {
  const SLOTS: readonly MoveSlot[] = ["fthrow", "bthrow", "uthrow", "dthrow", "cargoFthrow", "cargoBthrow", "cargoUthrow", "cargoDthrow"];

  // Every throw the plain roster runs lands exactly one launch, by `ATK_HIT_ABS`,
  // on the frame its script says, carrying the script's own ATTACK_ABS; Donkey
  // Kong's forward throw lands none (it lifts: Plan 5, Task 8), and only he has
  // the four cargo throws.
  const RUN = FIGHTERS.flatMap((d) => SLOTS.filter((slot) => d.moves[slot] !== undefined).map((slot) => [d.id, slot] as const));
  it("covers the four throws of everyone, and Donkey Kong's four cargo throws", () => {
    expect(RUN).toHaveLength(FIGHTERS.length * 4 + 4);
  });

  it.each(RUN)("%s %s fires one ATK_HIT_ABS, with its launch live", (id, slot) => {
    const def = FIGHTERS.find((f) => f.id === id)!;
    const script = gameScriptFor(def, slot)!;
    const total = def.moves[slot]!.totalFrames;
    const at: number[] = [];
    for (let g = 1; g <= total; g++) {
      const st = runScript(script, g);
      if (st.fired.some((c) => c.op === "hitAbs")) {
        at.push(g);
        expect(st.throwAbs, `${id} ${slot} frame ${g}`).not.toBeNull();
      }
    }
    expect(at, `${id} ${slot}`).toHaveLength(def.moves[slot]!.cargo === true ? 0 : 1);
  });
});

/*
 * Task 7 fix round 1. Frame numbers: SmashWiki's per-move pages (timing without
 * hitlag), UltimateFrameData's rows (game time, freezes before the release
 * included), rubendal's scripts (motion frames).
 */
describe("throw timing as published (fix round 1)", () => {
  const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
  const GAME = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());
  /** The steps (from 0, the press) the thrower spends in the throw. */
  const inThrow = (states: readonly GameState[]): number => states.findIndex((s) => s.fighters[0].action !== "throw");

  // SmashWiki "Pikachu (SSBU)/Down throw" (https://www.ssbwiki.com/Pikachu_(SSBU)/Down_throw):
  // "Throw Release 21", "Interruptible 44", the frame-14 box "set to both appear and be
  // deleted on frame 14", "only partially registered on the thrown opponent, causing
  // hitlag but not any damage", and the release "inflicts hitlag to the opponent,
  // causing their knockback to start on frame 30". UFD's 29/51
  // (https://ultimateframedata.com/pikachu) add the frame-14 freeze to both.
  it("Pikachu's down throw: a partial hit freezes both on 14, the release freezes Fox alone, Pikachu acts on 44", () => {
    const { states, events } = run(holding("pikachu", GAME), [Btn.Down, ...Array<InputFrame>(80).fill(0)], GAME);
    // Frame 14: both freeze; no damage, no hit reported.
    const partial = states.findIndex((s) => moveFrameOf(s.fighters[0].actionFrame) === 14);
    const lag14 = states[partial].fighters[0].hitlag;
    expect(lag14).toBeGreaterThan(0);
    expect(states[partial].fighters[1].hitlag).toBe(lag14);
    expect(states[partial].fighters[1].damage).toBe(0);
    expect(events[partial].hits).toEqual([]);
    // The release, on 21: Fox freezes, Pikachu does not.
    const hits = hitsBy0(states, events);
    expect(hits.map((h) => h.frame)).toEqual([21]);
    const release = hits[0].step;
    expect(release).toBe(20 + lag14);
    expect(states[release].fighters[0].hitlag).toBe(0);
    const lagR = states[release].fighters[1].hitlag;
    expect(lagR).toBeGreaterThan(0);
    // Pikachu acts on his move frame 44: 43 frames of throw and the one freeze he took.
    expect(inThrow(states)).toBe(43 + lag14);
    // Fox's launch fires when his own freeze ends.
    const launched = states.findIndex((s, i) => i > release && s.fighters[1].pendingFacing === 0);
    expect(launched).toBe(release + lagR);
  });

  // UFD (https://ultimateframedata.com/fox): "Backward Throw 10/16/19/22 49", "Up
  // Throw 7/18/21/24 49" — legacy-run throws, whose release freezes nobody.
  it.each([
    ["bthrow", Btn.Left],
    ["uthrow", Btn.Up],
  ] as const)("Fox's legacy %s ends on UFD's 49: the release freezes nobody", (slot, button) => {
    const { states } = run(holding("fox"), [button, ...Array<InputFrame>(70).fill(0)]);
    expect(FIGHTERS.find((f) => f.id === "fox")!.scripts?.[slot], "legacy").toBeUndefined();
    expect(inThrow(states)).toBe(49);
    expect(states.every((s) => s.fighters[0].hitlag === 0)).toBe(true);
  });

  // `FT_CATCH_STOP(n, 1)`: SmashWiki "Marth (SSBU)/Forward throw"
  // (https://www.ssbwiki.com/Marth_(SSBU)/Forward_throw), "During frame 14, the move
  // inflicts 4 frames of hitlag to both Marth and the opponent, during which the
  // opponent is invincible". UFD (https://ultimateframedata.com/marth): forward 18 /
  // 34, back 19 / 44, down 20 / 46 — the scripts' 15, 16 and 16 plus 3, 3 and 4. The
  // back throw's 44 leaves its stop out, as UFD's startup does not.
  it.each([
    ["fthrow", Btn.Right, 18, 34],
    ["bthrow", Btn.Left, 19, 47],
    ["dthrow", Btn.Down, 20, 46],
  ] as const)("Marth's %s stops both before the release, Fox invincible, and lands on UFD's %i", (slot, button, release, total) => {
    const { states, events } = run(holding("marth"), [button, ...Array<InputFrame>(70).fill(0)]);
    const hits = events.flatMap((e, i) => e.hits.map(() => i));
    expect(hits.map((i) => i + 1), "the release, in game frames").toEqual([release]);
    expect(inThrow(states)).toBe(total);
    // The stop: both frozen, Fox invincible, on the frames between.
    const stop = states.findIndex((s) => s.fighters[0].hitlag > 0);
    expect(states[stop].fighters[1].hitlag).toBe(states[stop].fighters[0].hitlag);
    for (let i = stop + 1; i < hits[0]; i++) expect(states[i].fighters[1].invincible, `step ${i}`).toBeGreaterThan(0);
  });

  // rubendal's CancelFrame is a motion frame; `FT_MOTION_RATE` decides the game frame.
  // Samus's `game_throwlw`: `FT_MOTION_RATE(FSM=0.85)` from frame 25, CancelFrame 40
  // -> game frame 38; UFD (https://ultimateframedata.com/samus) "Down Throw 21 37".
  // Link's jab 1, down tilt and forward air: UFD (https://ultimateframedata.com/link)
  // totals 23, 30 and 51.
  it("takes a script's first actionable frame in game frames: Samus's down throw is UFD's 37", () => {
    const samus = FIGHTERS.find((f) => f.id === "samus")!;
    expect(gameFrameOfMotion(samus.scripts!.dthrow!, 40)).toBe(38);
    expect(samus.moves.dthrow!.totalFrames).toBe(37);
    const link = FIGHTERS.find((f) => f.id === "link")!;
    expect([link.moves.jab1!.totalFrames, link.moves.dtilt!.totalFrames, link.moves.fair!.totalFrames]).toEqual([23, 30, 51]);
    const { states } = run(holding("samus"), [Btn.Down, ...Array<InputFrame>(60).fill(0)]);
    expect(inThrow(states)).toBe(37);
  });

  // Fox's grab and dash grab: `FT_MOTION_RATE` 0.8 and 0.9 from frame 1, then
  // `FT_START_ADJUST_MOTION_FRAME_arg1(1)` on the catch frame, read as the rate back
  // to 1 (`lift.ts`). UFD (https://ultimateframedata.com/fox): "Grab 6 36", "Dash
  // Grab 10 44".
  it("times Fox's grabs as UFD does: the catch on 6 and 10, 36 and 44 frames in all", () => {
    const fox = FIGHTERS.find((f) => f.id === "fox")!;
    expect([fox.moves.grab!.totalFrames, fox.moves.dashGrab!.totalFrames]).toEqual([36, 44]);
    expect(fox.moves.grab!.hitboxes.map((h) => h.startFrame)).toEqual([6, 6]);
    expect(fox.moves.dashGrab!.hitboxes.map((h) => h.startFrame)).toEqual([10, 10]);
  });
});

describe("rollback through the new freezes (fix round 1)", () => {
  const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
  const GAME = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());
  // Nothing new is kept: the stop and the partial hit write `hitlag` and
  // `invincible`, and throw invincibility is read off the script. A snapshot on
  // any frame around them re-simulates hash-equal.
  it.each([
    ["Marth's forward throw (FT_CATCH_STOP)", "marth", Btn.Right, undefined],
    ["Pikachu's down throw in the game (the partial hit, the release freeze)", "pikachu", Btn.Down, GAME],
  ] as const)("%s", (_name, id, button, ctx) => {
    const inputs = [button, ...Array<InputFrame>(60).fill(0)];
    const { states } = run(holding(id, ctx), inputs, ctx);
    for (let at = 8; at <= 34; at++) {
      const again = run(cloneState(states[at]), inputs.slice(at + 1), ctx).states;
      again.forEach((st, k) => expect(hashState(st), `snapshot ${at}, step ${at + 1 + k}`).toBe(hashState(states[at + 1 + k])));
    }
  });
});

describe("the grab timer through pummels (fix round 1)", () => {
  // SmashWiki "Grab" (https://www.ssbwiki.com/Grab): `90 + 1.7p` frames, set when the
  // grab lands, "so it is not affected by pummeling". Pummelled from the start and
  // never mashing, a 0% Fox is let go on the 90th frame of the hold.
  it("lets a 0% fighter go on frame 90 of the hold, however hard he is pummelled", () => {
    const s = holding("mario");
    s.fighters[1].grabTimer = 90;
    const { states, events } = run(s, Array.from({ length: 120 }, (_, i) => (i % 3 === 0 ? Btn.Attack : 0)));
    const pummels = events.filter((e) => e.hits.length > 0).length;
    expect(pummels).toBeGreaterThan(3);
    expect(states.findIndex((st) => st.fighters[1].grabbedBy < 0)).toBe(89);
  });
});

describe("a captor's projectile (ruling P5-R8)", () => {
  // The rule is a captor's own boxes; a projectile has left its owner's move, and
  // hits the fighter held like anyone (UNVERIFIED: no source names a case).
  it("hits the fighter its owner holds", () => {
    const s = holding("mario");
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    const fireball = findProjectileDef(mario, "fireball")!;
    s.projectiles.push(spawnProjectile(fireball, s.fighters[0], s.nextProjectileId));
    s.nextProjectileId += 1;
    const { events, states } = run(s, Array<InputFrame>(20).fill(0));
    const hits = events.flatMap((e) => e.hits);
    expect(hits.map((h) => [h.attacker, h.victim])).toEqual([[0, 1]]);
    expect(states.at(-1)!.fighters[1].grabbedBy).toBe(-1);
  });
});
