// @vitest-environment node
/**
 * A level-9 CPU against a player who stands still (Plan 5 final wave, ruling R-FW1c;
 * the final review's I1).
 *
 * The final review found a level-9 CPU next to a standing opponent turning every
 * frame and never attacking: a full press toward a target just behind it started a
 * dash that carried it past, so next frame the target was behind it again (31 of the
 * 64 matchups danced for 30 s or more against an idle human). Nothing the CPU sweeps
 * measured caught it, because two CPUs rarely stand still. This is the probe that
 * would have: every ordered pair of the eight fighters (64, mirrors included), round
 * the six stages, the Smash Ball off, the CPU on port 0 and nobody pressing anything
 * on port 1, stepped on the game's baked context.
 *
 * Each must land a hit within 10 s of game time (600 frames), and never turn in
 * place beside the player standing there: no stretch of `TURN_WINDOW` frames with more
 * than `MAX_TURNS` turns while it stands (a dash dance turns every frame). Step and check only, 64 matches of at most 1,800 frames:
 * a few seconds, longer beside the rest of the suite, hence its own timeout. It runs
 * in `pnpm test` like any other.
 */

import { describe, expect, it } from "vitest";

import { cpuWorldFromDef, decideCpu, type CpuWorld } from "@/ai/cpu";
import { stageViewFromDef } from "@/ai/behaviours";
import { fx } from "@/engine/fixed";
import { createInitialState, step } from "@/engine/simulate";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const CTX = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGE_BY_ID.get(id)! }, readBakeFromDisk());
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

/** The ruling's bound: a hit within 10 s of game time. */
const FIRST_HIT_BY = 600;
/** How long each match runs: long enough for a dance to begin after the first hit. */
const FRAMES = 1_800;
/** UNVERIFIED (test judgement): a stretch this long with more turns than `MAX_TURNS` in it is turning in place. */
const TURN_WINDOW = 30;
const MAX_TURNS = 10;

interface Played {
  /** The frame the first hit landed on, or -1. */
  readonly firstHit: number;
  /** The most turns port 0 made in any `TURN_WINDOW` frames. */
  readonly turns: number;
}

/**
 * Step `state` for up to `frames` frames, the ports in `cpus` played by level-9 CPUs and
 * the rest by nobody. With `standing`, port 0's turns count only while port 1 stands on the
 * ground (I1's situation: a CPU next to a player who stands still); without, every turn.
 */
function play(start: GameState, cpus: readonly number[], frames: number, standing = false): Played {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const worlds: CpuWorld[] = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => CTX.fighter(id), CTX.bake));
  let seed = state.rngSeed ^ 0x1f2e3d4c;
  let prev: readonly InputFrame[] = state.fighters.map(() => 0);
  let firstHit = -1;
  const turnedAt: number[] = [];
  let turns = 0;
  for (let frame = 1; frame <= frames && state.outcome === null; frame++) {
    const inputs = state.fighters.map((_, port) => {
      if (!cpus.includes(port)) return 0;
      const d = decideCpu(state, port, 9, seed, worlds[port]);
      seed = d.seed;
      return d.input;
    });
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    const still = !standing || (out.state.fighters[1].action === "stand" && out.state.fighters[1].grounded);
    if (still && out.state.fighters[0].facing !== state.fighters[0].facing) turnedAt.push(frame);
    while (turnedAt.length > 0 && turnedAt[0] <= frame - TURN_WINDOW) turnedAt.shift();
    turns = Math.max(turns, turnedAt.length);
    if (firstHit < 0 && out.events.hits.length > 0) firstHit = frame;
    state = out.state;
    prev = inputs;
  }
  return { firstHit, turns };
}

/** `id` on `stage` as the scene has it: grounded, out of the entry's intangibility. */
function placed(f: FighterState, over: Partial<FighterState>): void {
  Object.assign(f, { actionFrame: 0, intangible: 0, invincible: 0, grounded: true, ...over });
}

describe("a level-9 CPU against a player who stands still (ruling R-FW1c; the final review's I1)", () => {
  it("lands a hit within 10 s in every one of the 64 matchups, the Smash Ball off, and never turns in place", () => {
    const ids = FIGHTERS.map((f) => f.id);
    const late: string[] = [];
    const dancing: string[] = [];
    let n = 0;
    for (const a of ids)
      for (const b of ids) {
        const stageId = STAGES[n % STAGES.length].id;
        const { firstHit, turns } = play(createInitialState(stageId, [{ defId: a }, { defId: b }], RULES, 1000 + n, CTX), [0], FRAMES, true);
        if (firstHit < 0 || firstHit > FIRST_HIT_BY) late.push(`${a}-${b}@${stageId}: ${firstHit}`);
        if (turns > MAX_TURNS) dancing.push(`${a}-${b}@${stageId}: ${turns} turns in ${TURN_WINDOW} frames`);
        n++;
      }
    expect(n).toBe(64);
    expect(late, "no hit within 10 s").toEqual([]);
    expect(dancing, "turning in place").toEqual([]);
  }, 60_000);

  it("turns to an idle Fox at point blank and hits it, from a dash or a standstill (I1's Pikachu trace, reduced)", () => {
    // The review's trace: Pikachu at 28.1 and 30.0 in turn, every frame, around an idle
    // Fox at 28.7, for 5,386 frames. Here Pikachu at 28.1 facing away, Fox 0.6 behind it.
    for (const action of ["dashStart", "stand"] as const) {
      const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "fox" }], RULES, 5, CTX);
      placed(s.fighters[0], { x: fx(28.1), action, facing: -1, framesSinceDirPress: 30 });
      placed(s.fighters[1], { x: fx(28.7), action: "stand", facing: -1 });
      const { firstHit, turns } = play(s, [0], 300);
      expect([firstHit > 0 && firstHit <= 60, turns <= MAX_TURNS], `from ${action}: first hit ${firstHit}, ${turns} turns`).toEqual([true, true]);
    }
  });

  it("breaks the lock of two level-9 CPUs dashing at point blank: Pikachu and Marth on Small Battlefield (I1's trace, reduced)", () => {
    // Seed 1008's lock, Pikachu on port 0 and Marth on port 1, both at level 9: from
    // frame 1419, both in a dash at 45.05 and 43.86 facing left, they turned in step,
    // every frame, to the end of the match (9,441 frames).
    const s = createInitialState("smallBattlefield", [{ defId: "pikachu" }, { defId: "marth" }], RULES, 5, CTX);
    placed(s.fighters[0], { x: fx(45.05), action: "dashStart", facing: -1, framesSinceDirPress: 30 });
    placed(s.fighters[1], { x: fx(43.86), action: "dashStart", facing: -1, framesSinceDirPress: 30 });
    const { firstHit, turns } = play(s, [0, 1], 300);
    expect([firstHit > 0 && firstHit <= 60, turns <= MAX_TURNS], `first hit ${firstHit}, ${turns} turns`).toEqual([true, true]);
  });
});
