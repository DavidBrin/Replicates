/**
 * `SLOW_OPPONENT` (Plan 6, Task 11). SmashWiki "Slowdown" (https://www.ssbwiki.com/Slowdown):
 * a slowed fighter's "actions will be increased in length proportional to the degree of
 * slowdown", and its motion slowed. The arguments' meaning is unpublished; the replica
 * reads them as (rate, frames), decision D5, UNVERIFIED.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { FINAL_SMASH_READY } from "./final";
import { fx } from "./fixed";
import { hashState } from "./hash";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "./simulate";
import { slowOthers, slowedThisStep } from "./slow";
import { Btn } from "./types";
import type { GameState, InputFrame, MatchRules } from "./types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Pikachu and Mario standing on Final Destination, Mario `gap` ahead of him, facing him. */
function pair(gap = 60): GameState {
  const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "mario" }], RULES, 5);
  Object.assign(s.fighters[0], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: -fx(40), y: 0, facing: 1, intangible: 0 });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: -fx(40) + fx(gap), y: 0, facing: -1, intangible: 0 });
  return s;
}

function run(s0: GameState, inputs: (i: number) => readonly InputFrame[], n: number): GameState[] {
  let s = s0;
  let prev: readonly InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (let i = 0; i < n; i++) {
    const now = inputs(i);
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

describe("SLOW_OPPONENT (Plan 6, Task 11)", () => {
  it("Volt Tackle's start slows Mario by its script's (9, 45), and not Pikachu", () => {
    const s = pair();
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const [after] = run(s, () => [Btn.Special, 0], 1);
    expect(after.fighters[0].move).toBe("finalSmash");
    expect([after.fighters[1].combat.slowRate, after.fighters[1].combat.slowFrames]).toEqual([9, 45]);
    expect(after.fighters[0].combat.slowRate).toBe(0);
  });

  it("a slowed fighter runs one step in its rate: Mario walks a ninth as far", () => {
    const free = run(pair(), () => [0, Btn.Left | Btn.Soft], 36);
    const slowed = pair();
    slowOthers(slowed, 0, { rate: 9, frames: 45 });
    const slow = run(slowed, () => [0, Btn.Left | Btn.Soft], 36);
    const went = (st: GameState[]) => pair().fighters[1].x - st[st.length - 1].fighters[1].x;
    expect(went(slow)).toBeGreaterThan(0);
    expect(went(slow) * 9).toBeLessThanOrEqual(went(free) * 2);
  });

  it("ends after its frames: full speed again", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 8 });
    const states = run(s, () => [0, 0], 10);
    expect(states[7].fighters[1].combat.slowFrames).toBe(0);
    expect(slowedThisStep(states[9].fighters[1])).toBe(false);
  });

  it("counts a slowed fighter's hitstun on its running steps only: its reel lasts its rate times as long", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 40 });
    Object.assign(s.fighters[1], { action: "hitstun", actionFrame: 0, hitstun: 4 });
    const states = run(s, () => [0, 0], 4);
    // Step 1 runs (4 → 3); steps 2-4 stand still.
    expect(states.map((st) => st.fighters[1].hitstun)).toEqual([3, 3, 3, 3]);
  });

  it("holds a slowed spot dodge's intangible frames through its still steps, as hitlag does", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 40 });
    // Mario's spot dodge on its frame 4, inside its intangible frames (from frame 3).
    Object.assign(s.fighters[1], { action: "spotDodge", actionFrame: 4, intangible: 1 });
    const states = run(s, () => [0, 0], 4);
    // Step 1 runs it; steps 2-4 stand still on its frame 5, intangible throughout.
    expect(states.map((st) => st.fighters[1].actionFrame)).toEqual([5, 5, 5, 5]);
    for (const st of states) expect(st.fighters[1].intangible, `step ${states.indexOf(st) + 1}`).toBeGreaterThan(0);
  });

  it("Review Focus: a press on a slowed fighter's still step fires on its next running step", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 40 });
    // Steps 1 and 5 run; 2-4 stand still. A one-frame Jump on step 2 (a still step)...
    const states = run(s, (i) => [0, i === 1 ? Btn.Jump : 0], 5);
    expect(states.slice(0, 4).map((st) => st.fighters[1].action)).toEqual(["stand", "stand", "stand", "stand"]);
    // ...waits in the buffer and jumps on step 5, the next that runs (ruling R-P6-10).
    expect(states[4].fighters[1].action).toBe("jumpSquat");
  });

  it("Review Focus: a Final Smash started inside a rollback window, its Special press mispredicted, replays identically", () => {
    // Pikachu with the Smash Ball's power and Mario 4 ahead, inside the startup's sparks:
    // the slow counters (`slowRate`, `slowFrames`, `slowPhase`) and the sparks' record
    // (`sceneHits`) are both written in the windows replayed.
    const s = pair(4);
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const truth = (i: number): readonly InputFrame[] => [i === 12 ? Btn.Special : 0, i % 5 === 0 ? Btn.Left : 0];
    const live = run(s, truth, 60);
    /** From the snapshot after step `from`, `guess` for steps from + 1 to from + 6, then the rollback: the truth to the end. */
    const rollBack = (from: number, guess: (i: number) => readonly InputFrame[]): void => {
      const snapshot = cloneState(live[from]);
      let branch = cloneState(snapshot);
      let prev = truth(from);
      for (let i = from + 1; i <= from + 6; i++) {
        const now = guess(i);
        branch = step(branch, now, { prevInputs: prev }).state;
        prev = now;
      }
      expect(hashState(branch), `the guess from ${from + 1} goes wrong`).not.toBe(hashState(live[from + 6]));
      let replay = cloneState(snapshot);
      prev = truth(from);
      for (let i = from + 1; i < 60; i++) {
        const now = truth(i);
        replay = step(replay, now, { prevInputs: prev }).state;
        prev = now;
      }
      expect(hashState(replay), `replayed from ${from + 1}`).toBe(hashState(live[59]));
    };
    // A peer that has Pikachu's press late guesses no Special: rolled back across the start.
    rollBack(9, (i) => [0, truth(i)[1]]);
    // Inside the slow, after the first spark (move frame 10, step 22): a guess that has
    // Mario hold Right.
    expect(live[23].fighters[1].combat.slowFrames, "Mario slowed on step 24").toBeGreaterThan(0);
    expect(live[23].fighters[0].combat.sceneHits.length, "a spark recorded by step 24").toBeGreaterThan(0);
    rollBack(23, (i) => [truth(i)[0], Btn.Right]);
  });
});
