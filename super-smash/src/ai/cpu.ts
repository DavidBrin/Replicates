/**
 * The CPU player: nine levels of opponent, expressed as nine sets of weights
 * over the behaviours in `behaviours.ts`.
 *
 * `cpuInput` is a **pure function**. Same state, same port, same level, same
 * seed, same answer, every time, on every machine — which is the only way a CPU
 * match can roll back. A rollback re-simulates the last N frames from a
 * snapshot; if the CPU consulted anything outside `(state, port, level, seed)`
 * — a wall clock, an unseeded generator, a remembered decision from last frame
 * — the re-simulation would produce different inputs from the ones already
 * sent, and the two peers would quietly diverge. So there is no hidden state
 * here at all: every random number comes from `nextRandom` on the seed threaded
 * through `GameState`, and every "remember what I was doing" is recovered from
 * the frame counter instead (see `pulse`).
 *
 * The CPU produces an `InputFrame` and nothing else. It presses the same nine
 * buttons a human presses and the simulation cannot tell the two apart: there
 * is no "CPU may act" branch anywhere in the engine, no extra reach, no
 * knowledge of frame data. Its advantages over a human are exactly two —
 * reaction time and consistency — and both are dials on the table below.
 *
 * What it must never look like is a CPU reading inputs. It only sees the
 * opponent through `observe()`, which hands back a view rewound by the level's
 * reaction delay and refuses to report a new action until it has been visible
 * that long. At level 1 that is half a second of blindness; at level 9 it is
 * four frames, which is roughly a very good human.
 */

import { nextRandom } from "@/engine/fixed";
import type { GameState, InputFrame } from "@/engine/types";
import {
  BEHAVIOURS,
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  ROLL_FUMBLE,
  type BehaviourContext,
  type BehaviourName,
  type LevelTuning,
  type StageView,
  observe,
} from "./behaviours";

/** Ultimate's CPU levels. Anything outside is clamped. */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 9;

/** Air jumps the CPU assumes it has when the caller does not say. */
export const DEFAULT_AIR_JUMPS = 1;

export interface CpuWorld {
  /** Stage geometry. Defaults to Battlefield's — see `DEFAULT_STAGE_VIEW`. */
  readonly stage?: StageView;
  /** Air jumps this fighter actually has. Kirby has five. */
  readonly jumps?: number;
}

/**
 * The nine opponents.
 *
 * `reactionFrames` is the spine. It runs 30 → 4, and because the observation
 * layer withholds a *new* action until it has been visible that long, it is
 * simultaneously "how late this CPU reacts" and "how far behind its picture of
 * you is". At 30 frames almost nothing with less than half a second of startup
 * is ever seen, so a level-1 CPU never shields anything; at 4 frames nearly
 * every move in the game is visible during its startup, so a level-9 CPU
 * shields on reaction. The rates below then decide what it does with what it
 * saw.
 *
 * The dials are deliberately not one curve: `recoverySkill` climbs fastest,
 * because a CPU that keeps killing itself is not a lower difficulty, it is a
 * broken one; `edgeguardSkill` climbs slowest, because leaving the stage is the
 * highest-risk thing in the game and a CPU that does it badly hands over
 * stocks; and `noise` falls from 0.9 to 0.1, which is what turns visible
 * dithering into visible intent.
 */
const TUNING: readonly LevelTuning[] = [
  { level: 1, reactionFrames: 30, aggression: 0.15, shieldRate: 0.02, dodgeRate: 0.0, diSkill: 0.0, sdiSkill: 0.0, recoverySkill: 0.15, edgeguardSkill: 0.0, moveChoiceSkill: 0.15, noise: 0.9, fumbleChance: 0.3 },
  { level: 2, reactionFrames: 27, aggression: 0.22, shieldRate: 0.06, dodgeRate: 0.02, diSkill: 0.05, sdiSkill: 0.0, recoverySkill: 0.3, edgeguardSkill: 0.0, moveChoiceSkill: 0.25, noise: 0.8, fumbleChance: 0.24 },
  { level: 3, reactionFrames: 23, aggression: 0.3, shieldRate: 0.12, dodgeRate: 0.05, diSkill: 0.15, sdiSkill: 0.0, recoverySkill: 0.45, edgeguardSkill: 0.05, moveChoiceSkill: 0.35, noise: 0.7, fumbleChance: 0.19 },
  { level: 4, reactionFrames: 20, aggression: 0.38, shieldRate: 0.2, dodgeRate: 0.1, diSkill: 0.28, sdiSkill: 0.05, recoverySkill: 0.58, edgeguardSkill: 0.12, moveChoiceSkill: 0.45, noise: 0.6, fumbleChance: 0.15 },
  { level: 5, reactionFrames: 16, aggression: 0.47, shieldRate: 0.3, dodgeRate: 0.18, diSkill: 0.42, sdiSkill: 0.15, recoverySkill: 0.7, edgeguardSkill: 0.22, moveChoiceSkill: 0.55, noise: 0.5, fumbleChance: 0.11 },
  { level: 6, reactionFrames: 13, aggression: 0.56, shieldRate: 0.42, dodgeRate: 0.28, diSkill: 0.56, sdiSkill: 0.3, recoverySkill: 0.8, edgeguardSkill: 0.36, moveChoiceSkill: 0.66, noise: 0.4, fumbleChance: 0.08 },
  { level: 7, reactionFrames: 10, aggression: 0.66, shieldRate: 0.56, dodgeRate: 0.4, diSkill: 0.7, sdiSkill: 0.48, recoverySkill: 0.88, edgeguardSkill: 0.52, moveChoiceSkill: 0.77, noise: 0.3, fumbleChance: 0.05 },
  { level: 8, reactionFrames: 7, aggression: 0.78, shieldRate: 0.72, dodgeRate: 0.55, diSkill: 0.85, sdiSkill: 0.7, recoverySkill: 0.95, edgeguardSkill: 0.72, moveChoiceSkill: 0.88, noise: 0.2, fumbleChance: 0.02 },
  { level: 9, reactionFrames: 4, aggression: 0.9, shieldRate: 0.9, dodgeRate: 0.72, diSkill: 1.0, sdiSkill: 0.95, recoverySkill: 1.0, edgeguardSkill: 0.92, moveChoiceSkill: 1.0, noise: 0.1, fumbleChance: 0.0 },
];

export function tuningForLevel(level: number): LevelTuning {
  const clamped = Math.min(Math.max(Math.round(level), MIN_LEVEL), MAX_LEVEL);
  return TUNING[clamped - 1];
}

/** Rolls drawn per frame: the shared decision rolls plus one jitter each. */
const ROLL_COUNT = DECISION_ROLLS + BEHAVIOURS.length;

export interface CpuDecision {
  readonly input: InputFrame;
  readonly seed: number;
  /** Which behaviour won. Debug overlay and tests only. */
  readonly behaviour: BehaviourName;
  readonly scores: Readonly<Record<string, number>>;
}

/**
 * Score every behaviour, jitter each by the level's noise, and press whatever
 * the winner asks for.
 *
 * Jitter is multiplicative and symmetric — `score * (1 ± noise)` — so at level 1
 * a behaviour worth 200 can land anywhere in 20…380 and routinely loses to one
 * worth 100. That is what indecision looks like from the outside: the CPU
 * starts to approach, thinks better of it, shields nothing in particular. At
 * level 9 the same jitter is ±10% and the ordering almost never changes, so the
 * same code reads as intent.
 */
export function decideCpu(
  state: GameState,
  port: number,
  level: number,
  rngSeed: number,
  world: CpuWorld = {},
): CpuDecision {
  const self = state.fighters[port];
  if (!self || self.stocks <= 0 || self.action === "dead" || self.action === "entering") {
    return { input: 0, seed: rngSeed, behaviour: "idle", scores: {} };
  }

  const tuning = tuningForLevel(level);

  // Every roll is drawn up front, always the same number of them, before any
  // branch. A draw count that depended on the situation would advance the seed
  // differently on a rolled-back frame than on the original one, which is the
  // subtlest way to break determinism and the hardest to notice.
  let seed = rngSeed;
  const rolls = new Array<number>(ROLL_COUNT);
  for (let i = 0; i < ROLL_COUNT; i++) {
    const r = nextRandom(seed);
    seed = r.seed;
    rolls[i] = r.value;
  }

  const ctx: BehaviourContext = {
    state,
    view: observe(state, port, tuning.reactionFrames),
    stage: world.stage ?? DEFAULT_STAGE_VIEW,
    tuning,
    jumps: world.jumps ?? DEFAULT_AIR_JUMPS,
    rolls,
  };

  let bestScore = -1;
  let bestInput: InputFrame = 0;
  let bestName: BehaviourName = "idle";
  const scores: Record<string, number> = {};

  for (let i = 0; i < BEHAVIOURS.length; i++) {
    const { name, run } = BEHAVIOURS[i];
    const result = run(ctx);
    if (result.score <= 0) continue;

    const jitter = 1 + (rolls[DECISION_ROLLS + i] - 0.5) * 2 * tuning.noise;
    const score = result.score * jitter;
    scores[name] = score;

    // Strictly-greater keeps the earlier behaviour on a tie, and `BEHAVIOURS`
    // is ordered so that the survival ones come first.
    if (score > bestScore) {
      bestScore = score;
      bestInput = result.input;
      bestName = name;
    }
  }

  // The fumble: a dropped frame of input. It is what a low-level CPU's hands
  // look like — a jab that does not come out, a direction let go halfway across
  // the stage — and it is cheaper and more honest than deliberately aiming
  // badly. Level 9 never fumbles.
  if (rolls[ROLL_FUMBLE] < tuning.fumbleChance) {
    return { input: 0, seed, behaviour: bestName, scores };
  }

  return { input: bestInput, seed, behaviour: bestName, scores };
}

/**
 * The contract the match loop calls, once per CPU per frame.
 *
 * The returned seed must be written back into `GameState.rngSeed` (or into
 * whatever seed the caller threaded in), because that is what makes the CPU's
 * randomness part of the rolled-back state rather than beside it.
 */
export function cpuInput(
  state: GameState,
  port: number,
  level: number,
  rngSeed: number,
  world: CpuWorld = {},
): { input: InputFrame; seed: number } {
  const decision = decideCpu(state, port, level, rngSeed, world);
  return { input: decision.input, seed: decision.seed };
}
