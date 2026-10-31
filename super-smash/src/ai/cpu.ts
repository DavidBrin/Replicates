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

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { DEFAULT_AIR_DODGE } from "@/engine/airDodge";
import { BUFFER_FRAMES } from "@/engine/constants";
import { nextRandom } from "@/engine/fixed";
import { withCopyAbility } from "@/engine/inhale";
import { Btn, type AirDodgeAttributes, type FighterDef, type FighterState, type GameState, type InputFrame } from "@/engine/types";
import {
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  MELEE_RANGE,
  ROLL_FUMBLE,
  aerialStrands,
  airBrakeFromDef,
  airDodgeFromDef,
  approach,
  attack,
  centre,
  edgeguard,
  escape,
  idle,
  meleeReachFromDef,
  parry,
  platformMove,
  recover,
  recoveryFromDef,
  retreat,
  shield,
  survive,
  tech,
  type Behaviour,
  type BehaviourContext,
  type BehaviourName,
  type LevelTuning,
  type RecoveryMove,
  type StageView,
  observe,
  towardX,
  upBHold,
} from "./behaviours";
import { counter, finalSmash, holding, mash, reflect, sideRecover, smashBall, smashSpecial, storeCharge } from "./specials";

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
  /**
   * How far this fighter's pokes reach, from `meleeReachFromDef`. Defaults to
   * `MELEE_RANGE`, which is right for nobody in particular — supply it.
   */
  readonly meleeReach?: number;
  /**
   * This fighter's air friction, from `airBrakeFromDef`, for how far a neutral
   * air dodge drifts it. Defaults to 0, which carries the drift on unslowed.
   */
  readonly airBrake?: number;
  /**
   * This fighter's air-dodge lengths, from `airDodgeFromDef`, for how long a
   * dodge drifts it (Plan 3, Task 20c). Defaults to Mario's (`DEFAULT_AIR_DODGE`).
   */
  readonly airDodge?: AirDodgeAttributes;
  /**
   * Where this fighter's up special goes, from `recoveryFromDef`, for when to
   * spend it now that it leaves the fighter helpless (Plan 5, Task 4b).
   * Defaults to none: the CPU spends it as soon as it is needed.
   */
  readonly recovery?: RecoveryMove | null;
  /**
   * This fighter's own definition, to run its own fall when it techs (Plan 5,
   * ruling R-T18e). Defaults to none: it does not tech.
   */
  readonly fighterDef?: FighterDef;
  /**
   * Every port's definition, as the match runs it, to time a parry off the
   * swing's move data (ruling R-T18d). Defaults to none: it does not parry.
   */
  readonly matchDefs?: readonly (FighterDef | undefined)[];
  /**
   * Any fighter by id, as the match runs them (Plan 5, Task 19), so a Kirby CPU
   * knows the neutral special its Copy Ability gives it (`cpuDef`). Defaults to
   * the match's own definitions (`matchDefs`), where every copy comes from.
   */
  readonly fighter?: (defId: string) => FighterDef | undefined;
  /**
   * The bake the match steps with (Plan 4), for the hurt capsules a swing must
   * reach before it lands on the CPU's shield (`parry`; ruling R-T18j). Defaults to
   * none: Plan 2's single capsule, as the engine runs without one.
   */
  readonly bake?: BakeTables;
}

/**
 * The moveset this CPU fights with now (Plan 5, Task 19): its own, or for a
 * Kirby with a Copy Ability the one the simulation runs, through the same
 * `withCopyAbility` (`simulate.ts`, `defOf`), the copied fighter looked up as
 * the match looks it up (`CpuWorld.fighter`, else the match's definitions).
 */
export function cpuDef(self: FighterState, world: CpuWorld): FighterDef | undefined {
  const own = world.fighterDef;
  if (own === undefined || self.combat.copy === "") return own;
  const copy = world.fighter !== undefined ? world.fighter(self.combat.copy) : world.matchDefs?.find((d) => d?.id === self.combat.copy);
  return copy === undefined ? own : withCopyAbility(own, copy);
}

/**
 * Everything a CPU knows about its own fighter, the stage and the match, from
 * the definitions: the one builder the game (`matchCpuWorlds`), the golden and
 * the CPU sweep share, so none of them can leave a field out (Plan 5, Task 4b
 * fix round 1: one of three left the up special model out). `matchDefs` is every
 * port's definition, by port, as the match runs them; `bake` the bake it steps
 * with, if any.
 */
export function cpuWorldFromDef(
  def: FighterDef,
  stage: StageView,
  matchDefs: readonly (FighterDef | undefined)[] = [],
  fighter?: (defId: string) => FighterDef | undefined,
  bake?: BakeTables,
): CpuWorld {
  return {
    stage,
    jumps: def.attributes.jumps,
    // Per fighter, from its own move data. A shared constant here is what let a
    // CPU decide it was close enough to punch from further than its arm goes.
    meleeReach: meleeReachFromDef(def),
    airBrake: airBrakeFromDef(def),
    airDodge: airDodgeFromDef(def),
    // Where its up special goes: it leaves the fighter helpless (Plan 5, Task 4b).
    recovery: recoveryFromDef(def),
    // Its own fall, for a tech; the match's moves, for a parry (Plan 5, Task 18).
    fighterDef: def,
    matchDefs,
    // The match's fighter lookup, for a Copy Ability's move (Task 19).
    ...(fighter !== undefined ? { fighter } : {}),
    // The match's bake, for the body a parry's swing must reach (Task 18, ruling R-T18j).
    ...(bake !== undefined ? { bake } : {}),
  };
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
 *
 * Plan 5 adds two, each the chance of one decision (rulings R-T18d, R-T18e), and
 * tested as that against what the CPU does (`defence.test.ts`): `techSkill`,
 * the chance it techs a landing, and air-dodges out of hitstun when the cancel
 * opens, climbs with `recoverySkill` because both are survival; `parrySkill`,
 * the chance it parries a swing it can time, stays at zero until level 4 and
 * reaches only 0.5, because a parry is a read and a CPU that parried everything
 * would be reading inputs. Task 19 adds `specialSkill`, the chance it uses a
 * special it has the moment for (a reflect, a counter, a charge, a smash-input
 * special; one roll a threat or an opening), climbing as `moveChoiceSkill` does:
 * knowing the moveset is move choice. UNVERIFIED: the values are tuning, not
 * data — Ultimate's CPU is not published.
 */
const TUNING: readonly LevelTuning[] = [
  { level: 1, reactionFrames: 30, aggression: 0.15, shieldRate: 0.02, dodgeRate: 0.0, diSkill: 0.0, sdiSkill: 0.0, recoverySkill: 0.15, edgeguardSkill: 0.0, moveChoiceSkill: 0.15, noise: 0.9, fumbleChance: 0.3, techSkill: 0.0, parrySkill: 0.0, specialSkill: 0.0 },
  { level: 2, reactionFrames: 27, aggression: 0.22, shieldRate: 0.06, dodgeRate: 0.02, diSkill: 0.05, sdiSkill: 0.0, recoverySkill: 0.3, edgeguardSkill: 0.0, moveChoiceSkill: 0.25, noise: 0.8, fumbleChance: 0.24, techSkill: 0.05, parrySkill: 0.0, specialSkill: 0.05 },
  { level: 3, reactionFrames: 23, aggression: 0.3, shieldRate: 0.12, dodgeRate: 0.05, diSkill: 0.15, sdiSkill: 0.0, recoverySkill: 0.45, edgeguardSkill: 0.05, moveChoiceSkill: 0.35, noise: 0.7, fumbleChance: 0.19, techSkill: 0.12, parrySkill: 0.0, specialSkill: 0.12 },
  { level: 4, reactionFrames: 20, aggression: 0.38, shieldRate: 0.2, dodgeRate: 0.1, diSkill: 0.28, sdiSkill: 0.05, recoverySkill: 0.58, edgeguardSkill: 0.12, moveChoiceSkill: 0.45, noise: 0.6, fumbleChance: 0.15, techSkill: 0.22, parrySkill: 0.02, specialSkill: 0.22 },
  { level: 5, reactionFrames: 16, aggression: 0.47, shieldRate: 0.3, dodgeRate: 0.18, diSkill: 0.42, sdiSkill: 0.15, recoverySkill: 0.7, edgeguardSkill: 0.22, moveChoiceSkill: 0.55, noise: 0.5, fumbleChance: 0.11, techSkill: 0.35, parrySkill: 0.05, specialSkill: 0.35 },
  { level: 6, reactionFrames: 13, aggression: 0.56, shieldRate: 0.42, dodgeRate: 0.28, diSkill: 0.56, sdiSkill: 0.3, recoverySkill: 0.8, edgeguardSkill: 0.36, moveChoiceSkill: 0.66, noise: 0.4, fumbleChance: 0.08, techSkill: 0.5, parrySkill: 0.1, specialSkill: 0.5 },
  { level: 7, reactionFrames: 10, aggression: 0.66, shieldRate: 0.56, dodgeRate: 0.4, diSkill: 0.7, sdiSkill: 0.48, recoverySkill: 0.88, edgeguardSkill: 0.52, moveChoiceSkill: 0.77, noise: 0.3, fumbleChance: 0.05, techSkill: 0.65, parrySkill: 0.2, specialSkill: 0.65 },
  { level: 8, reactionFrames: 7, aggression: 0.78, shieldRate: 0.72, dodgeRate: 0.55, diSkill: 0.85, sdiSkill: 0.7, recoverySkill: 0.95, edgeguardSkill: 0.72, moveChoiceSkill: 0.88, noise: 0.2, fumbleChance: 0.02, techSkill: 0.8, parrySkill: 0.35, specialSkill: 0.8 },
  { level: 9, reactionFrames: 4, aggression: 0.9, shieldRate: 0.9, dodgeRate: 0.72, diSkill: 1.0, sdiSkill: 0.95, recoverySkill: 1.0, edgeguardSkill: 0.92, moveChoiceSkill: 1.0, noise: 0.1, fumbleChance: 0.0, techSkill: 0.95, parrySkill: 0.5, specialSkill: 0.95 },
];

export function tuningForLevel(level: number): LevelTuning {
  const clamped = Math.min(Math.max(Math.round(level), MIN_LEVEL), MAX_LEVEL);
  return TUNING[clamped - 1];
}

/**
 * Every behaviour, in the order ties break. Earlier wins a tie, which is why
 * the survival and recovery behaviours are listed first: when two scores land
 * equal after jitter, not dying is the better default. Built here rather than
 * in `behaviours.ts`, which `specials.ts` imports from: the table needs both, and
 * neither of them each other at load (the drift note's import cycle).
 */
export const BEHAVIOURS: readonly { readonly name: BehaviourName; readonly run: Behaviour }[] = [
  { name: "tech", run: tech },
  { name: "escape", run: escape },
  { name: "survive", run: survive },
  { name: "mash", run: mash },
  { name: "sideRecover", run: sideRecover },
  { name: "recover", run: recover },
  { name: "holding", run: holding },
  { name: "finalSmash", run: finalSmash },
  { name: "parry", run: parry },
  { name: "reflect", run: reflect },
  { name: "counter", run: counter },
  { name: "shield", run: shield },
  { name: "edgeguard", run: edgeguard },
  { name: "storeCharge", run: storeCharge },
  { name: "smashSpecial", run: smashSpecial },
  { name: "smashBall", run: smashBall },
  { name: "attack", run: attack },
  { name: "platformMove", run: platformMove },
  { name: "approach", run: approach },
  { name: "retreat", run: retreat },
  { name: "centre", run: centre },
  { name: "idle", run: idle },
];

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
    meleeReach: world.meleeReach ?? MELEE_RANGE,
    airBrake: world.airBrake ?? 0,
    airDodge: world.airDodge ?? DEFAULT_AIR_DODGE,
    recovery: world.recovery ?? null,
    // The moveset it fights with now: a Kirby's Copy Ability's included (Task 19).
    fighterDef: cpuDef(self, world) ?? null,
    matchDefs: world.matchDefs ?? [],
    ...(world.bake !== undefined ? { bake: world.bake } : {}),
    rolls,
  };

  let bestScore = -1;
  let bestInput: InputFrame = 0;
  let bestName: BehaviourName = "idle";
  let decided: { readonly name: BehaviourName; readonly input: InputFrame } | null = null;
  const scores: Record<string, number> = {};

  for (let i = 0; i < BEHAVIOURS.length; i++) {
    const { name, run } = BEHAVIOURS[i];
    const result = run(ctx);
    if (result.score <= 0) continue;

    const jitter = 1 + (rolls[DECISION_ROLLS + i] - 0.5) * 2 * tuning.noise;
    const score = result.score * jitter;
    scores[name] = score;
    if (result.decided === true && decided === null) decided = { name, input: result.input };

    // Strictly-greater keeps the earlier behaviour on a tie, and `BEHAVIOURS`
    // is ordered so that the survival ones come first.
    if (score > bestScore) {
      bestScore = score;
      bestInput = result.input;
      bestName = name;
    }
  }

  // A decision its own dial has made (a tech, an escape, a parry; Plan 5, rulings
  // R-T18d and R-T18e) takes the frame outright, the first in `BEHAVIOURS` order:
  // the dial is the chance, so neither the jitter nor the fumble may undo it.
  if (decided !== null) {
    return { input: specialPending(self, state.frame) ? upBHold(decided.input) : decided.input, seed, behaviour: decided.name, scores };
  }

  // An aerial near or off the stage that would leave the fighter no way back is
  // not pressed (Plan 5, Task 19: `aerialStrands`): whatever asked for it, the
  // fighter drifts home instead, the whole stick on it, Up and Down let go with the
  // swing (the Task 19 review's M4: a Down kept from a down air fast-fell). Judgement,
  // not a roll.
  if (aerialStrands(ctx, bestInput)) {
    const home = ctx.view.self.x < 0 ? ctx.stage.leftLedge : ctx.stage.rightLedge;
    bestInput = (bestInput & ~(Btn.Attack | Btn.Left | Btn.Right | Btn.Up | Btn.Down)) | towardX(ctx.view.self.x, home);
  }

  // The fumble: a dropped frame of input. It is what a low-level CPU's hands
  // look like — a jab that does not come out, a direction let go halfway across
  // the stage — and it is cheaper and more honest than deliberately aiming
  // badly. Level 9 never fumbles.
  if (rolls[ROLL_FUMBLE] < tuning.fumbleChance) {
    return { input: specialPending(self, state.frame) ? upBHold(0) : 0, seed, behaviour: bestName, scores };
  }

  return { input: specialPending(self, state.frame) ? upBHold(bestInput) : bestInput, seed, behaviour: bestName, scores };
}

/**
 * A Special press still in the fighter's buffer for the next frame: only the up
 * special's (`recover` is the one behaviour that presses Special where it waits
 * in the buffer; every special `specials.ts` uses is pressed from a state free to
 * act, which reads it at once: `free`). Whatever wins
 * the frame, or a fumble, it fires holding Up and never Down, never on a stick
 * that would make it a side or a neutral special (ruling R-T13b-c; the Task 13b
 * review's I-1: a press buffered in an offstage aerial fired on the drift frame
 * after it, as a side special).
 */
function specialPending(self: FighterState, frame: number): boolean {
  const b = self.bufferedAction;
  // The next step runs frame `frame + 1`, and reads a press up to `BUFFER_FRAMES` old.
  return b !== null && b.kind === "special" && frame + 1 - b.frame <= BUFFER_FRAMES;
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
