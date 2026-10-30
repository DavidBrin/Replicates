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
import { runScript } from "@/engine/acmd/interpreter";
import { fx, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { moveFrameOf } from "@/engine/hitbox";
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
  // stays on its legacy move (its script runs `HitModule::set_status_all`).
  it("turns a legacy back throw that points forward (Donkey Kong's, 72°) and launches behind", () => {
    const { states, events } = run(holding("donkeyKong"), [Btn.Left, ...Array<InputFrame>(80).fill(0)]);
    const hits = hitsBy0(states, events);
    expect(hits).toHaveLength(1);
    const turned = states.findIndex((s) => s.fighters[0].facing === -1);
    expect(moveFrameOf(states[turned].fighters[0].actionFrame)).toBe(15);
    expect(hits[0].frame).toBe(16);
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
  // ATTACK_ABS (45°) on 44: UFD "Backward Throw 44 59 11.0". Ruling P5-R8
  // (UNVERIFIED stand-in): a captor's box that is not catch-only skips the
  // fighter it holds, so the hip box leaves Fox to the throw.
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

  it("launches nobody once the thrower is hit mid-throw: the hit frees the fighter held", () => {
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "fox" }, { defId: "mario" }], { ...RULES, oneOnOne: false }, 5);
    const [a, v, m] = s.fighters;
    Object.assign(a, { action: "grabHold", grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
    Object.assign(v, { action: "grabbed", grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, grabbedBy: 0, grabTimer: 500 });
    // Mario behind Kirby, facing him, jabs on step 20.
    Object.assign(m, { action: "stand", grounded: true, platform: 0, x: fx(-12), y: 0, facing: 1, intangible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    const kirbyHits: number[] = [];
    let freed = -1;
    for (let i = 0; i < 90; i++) {
      const now = [i === 0 ? Btn.Down : 0, 0, i === 20 ? Btn.Attack : 0];
      const out = step(st, now, { prevInputs: prev });
      st = out.state;
      prev = now;
      for (const h of out.events.hits) if (h.attacker === 0) kirbyHits.push(h.knockback);
      if (freed < 0 && st.fighters[1].grabbedBy < 0) freed = i;
    }
    expect(freed, "Mario's jab frees Fox").toBeGreaterThan(20);
    expect(st.fighters[0].action).not.toBe("throw");
    // Stomps before the jab, and no launch after it.
    expect(kirbyHits.length).toBeGreaterThan(0);
    expect(kirbyHits.every((kb) => kb === 0)).toBe(true);
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
  const SLOTS: readonly MoveSlot[] = ["fthrow", "bthrow", "uthrow", "dthrow"];

  // Every throw the plain roster runs lands exactly one launch, by `ATK_HIT_ABS`,
  // on the frame its script says, carrying the script's own ATTACK_ABS.
  it.each(FIGHTERS.flatMap((d) => SLOTS.map((slot) => [d.id, slot] as const)))("%s %s fires one ATK_HIT_ABS, with its launch live", (id, slot) => {
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
    expect(at, `${id} ${slot}`).toHaveLength(1);
  });
});
