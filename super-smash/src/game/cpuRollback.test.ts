// @vitest-environment node
/**
 * The CPU under rollback (Plan 5 final wave; the final review's recommendation 4, from its
 * probes 9-11): the cheapest whole-branch determinism net there is.
 *
 * Every ordered pair of the eight fighters (56), round the six stages, a level-9 CPU on
 * port 0 against a level-7 one on port 1, the Smash Ball on (so the CPU's Final Smash,
 * the Smash Ball and the cinematic are in it), up to `FRAMES` frames, stepped on the
 * game's baked context. On every `REWIND_EVERY`th frame the last `REWIND` frames are
 * played again from a `cloneState` snapshot, as a rollback session re-simulates them,
 * each CPU deciding afresh from the restored state and its restored seed: every input
 * and every state's hash (`hashState`) must come out as the first time. And on every
 * `PURE_EVERY`th frame each CPU is asked twice: the same answer, and the state's hash
 * unmoved by the asking (no decision may write to the state it reads).
 *
 * Step and check only, no trace. A few seconds on its own, longer beside the rest of
 * the suite, hence its own timeout. It runs in `pnpm test` like any other.
 */

import { describe, expect, it } from "vitest";

import { cpuWorldFromDef, decideCpu, type CpuWorld } from "@/ai/cpu";
import { stageViewFromDef } from "@/ai/behaviours";
import { hashState } from "@/engine/hash";
import { cloneState, createInitialState, step } from "@/engine/simulate";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const CTX = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGE_BY_ID.get(id)! }, readBakeFromDisk());
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: true, oneOnOne: true };
const LEVELS = [9, 7] as const;

/** UNVERIFIED (test judgement): a match's length here, the rewind's depth and spacing, and how often purity is asked. */
const FRAMES = 1_800;
const REWIND = 8;
const REWIND_EVERY = 10;
const PURE_EVERY = 7;

/** One frame as it was played: the state it started from, the CPU seed and the inputs before it, and what came of it. */
interface Played {
  readonly before: GameState;
  readonly seed: number;
  readonly prevInputs: readonly InputFrame[];
  readonly inputs: readonly InputFrame[];
  readonly hash: number;
}

/** Both CPUs' inputs for `state`, from `seed`, and the seed after. */
function decide(state: GameState, seed: number, worlds: readonly CpuWorld[]): { inputs: InputFrame[]; seed: number } {
  let s = seed;
  const inputs = LEVELS.map((level, port) => {
    const d = decideCpu(state, port, level, s, worlds[port]);
    s = d.seed;
    return d.input;
  });
  return { inputs, seed: s };
}

/** One CPU match, and every rollback mismatch and impure decision found in it. */
function match(a: string, b: string, stageId: string, seed: number): { frames: number; problems: string[] } {
  let state = createInitialState(stageId, [{ defId: a }, { defId: b }], RULES, seed, CTX);
  const view = stageViewFromDef(CTX.stage(stageId));
  const defs = [a, b].map((id) => CTX.fighter(id));
  const worlds = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => CTX.fighter(id), CTX.bake));
  let cpuSeed = seed ^ 0x1f2e3d4c;
  let prev: readonly InputFrame[] = [0, 0];
  const history: Played[] = [];
  const problems: string[] = [];
  let frame = 0;
  while (frame < FRAMES && state.outcome === null && problems.length < 3) {
    frame++;
    if (frame % PURE_EVERY === 0) {
      const h = hashState(state);
      for (let port = 0; port < 2; port++) {
        const first = decideCpu(state, port, LEVELS[port], cpuSeed, worlds[port]);
        const again = decideCpu(state, port, LEVELS[port], cpuSeed, worlds[port]);
        if (first.input !== again.input || first.seed !== again.seed) problems.push(`f${frame} p${port}: asked twice, ${first.input} then ${again.input}`);
      }
      if (hashState(state) !== h) problems.push(`f${frame}: the state's hash moved under the CPU's decision`);
    }
    const before = cloneState(state);
    const { inputs, seed: next } = decide(state, cpuSeed, worlds);
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    history.push({ before, seed: cpuSeed, prevInputs: prev, inputs, hash: hashState(out.state) });
    if (history.length > REWIND) history.shift();
    cpuSeed = next;
    prev = inputs;
    state = out.state;
    if (frame % REWIND_EVERY === 0 && history.length === REWIND) {
      // Back to the oldest snapshot kept, and on again, deciding afresh.
      let s = cloneState(history[0].before);
      let sd = history[0].seed;
      let pv = history[0].prevInputs;
      for (let i = 0; i < REWIND; i++) {
        const r = decide(s, sd, worlds);
        if (r.inputs.some((v, port) => v !== history[i].inputs[port])) problems.push(`f${frame - REWIND + i + 1}: re-decided ${r.inputs} for ${history[i].inputs}`);
        const o = step(s, history[i].inputs, { prevInputs: pv, ctx: CTX });
        if (hashState(o.state) !== history[i].hash) problems.push(`f${frame - REWIND + i + 1}: re-simulated hash differs`);
        s = o.state;
        sd = r.seed;
        pv = history[i].inputs;
      }
    }
  }
  return { frames: frame, problems };
}

describe("the CPU under rollback (Plan 5 final wave; the final review's recommendation 4)", () => {
  it("re-simulates every rolled-back frame of 56 CPU matches to the same inputs and hashes, and never moves the state it decides on", () => {
    const ids = FIGHTERS.map((f) => f.id);
    const found: Record<string, string[]> = {};
    let n = 0;
    let stepped = 0;
    for (const a of ids)
      for (const b of ids) {
        if (a === b) continue;
        const stageId = STAGES[n % STAGES.length].id;
        const { frames, problems } = match(a, b, stageId, 2000 + n);
        stepped += frames;
        if (problems.length > 0) found[`${a}-${b}@${stageId}`] = problems;
        n++;
      }
    expect(n).toBe(56);
    expect(stepped).toBeGreaterThan(56 * 1_000);
    expect(found).toEqual({});
  }, 120_000);
});
