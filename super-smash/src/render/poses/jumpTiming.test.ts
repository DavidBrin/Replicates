import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { LEDGE_HANG_MIN } from "@/engine/states";
import { Btn, type FighterState, type GameState, type InputFrame, type MatchRules } from "@/engine/types";
import { FIGHTERS, getFighter } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter } from "../testFixtures";
import { actionDurationFor, jumpTimingFor } from "./timing";

describe("the jump clip's length comes from the engine's jump rule", () => {
  const fox = getFighter("fox")!;
  const kirby = getFighter("kirby")!;

  it("is the number of rising frames, for each kind of jump", () => {
    const p = fighterParams(fox);
    const t = jumpTimingFor(fox);
    expect(t.full).toBe(jumpRiseSpeeds(p, "full").length);
    expect(t.short).toBe(jumpRiseSpeeds(p, "short").length);
    expect(t.air[0]).toBe(jumpRiseSpeeds(p, "air", 0).length);
    expect(t.ledgeSpeeds).toEqual(jumpRiseSpeeds(p, "ledge"));
    const jump = (over: object) => makeFighter({ action: "jump", actionFrame: 0, ...over });
    expect(actionDurationFor(jump({ jumpsUsed: 1, shortHop: false }), t)).toBe(t.full);
    expect(actionDurationFor(jump({ jumpsUsed: 1, shortHop: true }), t)).toBe(t.short);
    expect(actionDurationFor(jump({ jumpsUsed: 2 }), t)).toBe(t.air[0]);
  });

  it("gives each of Kirby's midair jumps its own, shorter rise", () => {
    const t = jumpTimingFor(kirby);
    expect(t.air).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(t.air[i]).toBeLessThan(t.air[i - 1]);
    const fifth = makeFighter({ action: "jump", actionFrame: 0, jumpsUsed: 6 });
    expect(actionDurationFor(fifth, t)).toBe(t.air[4]);
  });

  it("times Kirby's nth jump by the (n − 2)th entry of his midair list", () => {
    // `jumpsUsed` counts the ground jump, so the first midair jump is the one that makes it 2.
    const p = fighterParams(kirby);
    const t = jumpTimingFor(kirby);
    for (let n = 2; n <= 6; n++) {
      const f = makeFighter({ action: "jump", actionFrame: 0, jumpsUsed: n });
      expect(actionDurationFor(f, t), `jump ${n}`).toBe(jumpRiseSpeeds(p, "air", n - 2).length);
    }
  });

  it("is cached per fighter definition", () => {
    expect(jumpTimingFor(fox)).toBe(jumpTimingFor(fox));
  });
});

describe("through step(), every frame of a jump is timed as the jump it is", () => {
  // A ledge jump enters `jump` with `jumpsUsed` 1 and no short hop, exactly as a full hop does;
  // only its speed on each frame tells them apart. Both are run through the real simulation, so
  // a full hop that happened to match the ledge jump's speed on some frame would show up here.
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  const idle = (s: GameState): GameState => step(s, [0], { prevInputs: [0] }).state;

  function standing(id: string): GameState {
    let s = createInitialState("finalDestination", [{ defId: id }], RULES, 7);
    for (let i = 0; i < 80; i++) s = idle(s);
    return s;
  }

  /** Hanging from Final Destination's left ledge (x −80), facing the stage, past the hang's locked first frames. */
  function hanging(id: string): GameState {
    let s = standing(id);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(-82), y: fx(-5), facing: 1 });
    for (let i = 0; i < 60 && s.fighters[0].ledge === null; i++) s = idle(s);
    expect(s.fighters[0].action, "never caught the ledge").toBe("ledgeHang");
    for (let i = 0; i < LEDGE_HANG_MIN; i++) s = idle(s);
    return s;
  }

  /** The fighter on each frame of its first `jump` action from `inputs` that starts on or after `from`. */
  function jumpFrames(s0: GameState, inputs: readonly InputFrame[], from = (f: FighterState) => f.action === "jump") {
    let s = s0;
    let prev: InputFrame = 0;
    const all: FighterState[] = [];
    for (const input of inputs) {
      s = step(s, [input], { prevInputs: [prev] }).state;
      prev = input;
      all.push(s.fighters[0]);
    }
    const start = all.findIndex(from);
    const end = all.findIndex((f, i) => i > start && f.action !== "jump");
    return all.slice(start, end);
  }

  const hold = (input: InputFrame, n: number): InputFrame[] => Array.from({ length: n }, () => input);

  it.each(FIGHTERS.map((d) => d.id))("%s: full hop, short hop, first air jump and a jump off the ledge", (id) => {
    const def = getFighter(id)!;
    const p = fighterParams(def);
    const t = jumpTimingFor(def);
    const runs = [
      ["full hop", jumpRiseSpeeds(p, "full"), jumpFrames(standing(id), hold(Btn.Jump, 120))],
      ["short hop", jumpRiseSpeeds(p, "short"), jumpFrames(standing(id), [Btn.Jump, ...hold(0, 120)])],
      [
        "first air jump",
        jumpRiseSpeeds(p, "air", 0),
        jumpFrames(standing(id), [Btn.Jump, ...hold(0, 8), Btn.Jump, ...hold(0, 90)], (f) => f.jumpsUsed === 2),
      ],
      ["ledge jump", jumpRiseSpeeds(p, "ledge"), jumpFrames(hanging(id), [Btn.Jump, ...hold(0, 120)])],
    ] as const;
    for (const [kind, rise, frames] of runs) {
      expect(frames.length, `${kind}: the jump lasted`).toBe(rise.length);
      for (const f of frames) expect(actionDurationFor(f, t), `${kind}, frame ${f.actionFrame}`).toBe(rise.length);
    }
  });
});
