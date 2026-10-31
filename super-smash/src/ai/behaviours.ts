/**
 * The CPU's repertoire: eight small behaviours, each of which looks at one
 * delayed view of the world and answers two questions — "does this apply right
 * now, and how much?" and "what would I press?".
 *
 * Nothing here knows what level the CPU is. A behaviour reads its weights off
 * the `LevelTuning` it is handed and is otherwise identical at level 1 and
 * level 9; the difference between a CPU that walks into the blast zone and one
 * that edgeguards you off the top is entirely in those numbers and in how stale
 * its view of you is. Keeping the split that way means a new behaviour is
 * written once and scales across all nine levels for free, and it means the
 * tuning table in `cpu.ts` reads as a description of nine opponents rather than
 * as nine copies of the same code.
 *
 * Two rules the whole file obeys:
 *
 *  - **No unseeded randomness, no wall clock.** Every random number a behaviour
 *    needs is drawn in `cpu.ts` from the seed threaded through `GameState` and
 *    handed down in `ctx.rolls`, so a behaviour is a pure function of its
 *    context and a rollback re-runs it to the same answer. See SPEC §3.
 *  - **The CPU only knows what it can see.** Behaviours read the opponent
 *    through `ctx.view`, never `ctx.state.fighters[other]`. The view is rewound
 *    by the level's reaction delay, so a level-1 CPU is swinging at where you
 *    were half a second ago. A CPU that read the live state — or worse, the
 *    opponent's input — would feel like it was cheating, because it would be.
 */

import {
  Btn,
  type ActionState,
  type AirDodgeAttributes,
  type FighterDef,
  type FighterState,
  type GameState,
  type InputFrame,
  type MoveAim,
  type MoveDef,
  type MoveSlot,
  type StageDef,
} from "@/engine/types";
import { cloneFighter } from "@/engine/simulate";
import { advanceFighter, applyMovement, interpretInput, updateInputTracking, type StateContext } from "@/engine/states";
import { HARD_PLATFORM_DEPTH, integrate } from "@/engine/physics";
import { WALL_JUMP_WINDOW } from "@/engine/wallJump";
import { AIR_DODGE_SLIDE_FRAMES, airDodgeCharge, airDodgeFrames, airDodgeOf } from "@/engine/airDodge";
import {
  AIR_DODGE_SLIDE_DISTANCE,
  AIR_DODGE_SLIDE_END_SPEED,
  AIR_DODGE_SLINGSHOT_DISTANCE,
  AIR_DODGE_SLINGSHOT_FRAMES,
  LEDGE_GRAB_BACK_PENALTY,
  LEDGE_GRAB_RANGE_X,
  LEDGE_GRAB_RANGE_Y,
  SDI_INPUT_INTERVAL,
  SMASH_INPUT_WINDOW,
} from "@/engine/constants";
import { ONE, abs, fx, magnitude, mul } from "@/engine/fixed";
import { fighterParams, type FighterParams } from "@/engine/params";

/* ------------------------------------------------------------------ stage -- */

/**
 * The slice of stage geometry the CPU needs: where it can stand, where the
 * ledges are, and where it dies.
 *
 * Declared here rather than imported from `src/stages/` so that `ai/` depends
 * only on the frozen engine contract. `stageViewFromDef` converts a real
 * `StageDef` when the match loop has one.
 */
export interface StageView {
  /** X of the main platform's left and right ledges. Fixed. */
  readonly leftLedge: number;
  readonly rightLedge: number;
  /** Y of the main platform's surface. Fixed. */
  readonly groundY: number;
  readonly blastLeft: number;
  readonly blastRight: number;
  readonly blastTop: number;
  readonly blastBottom: number;
  /** Soft platforms, for `platformMove`. */
  readonly platforms: readonly { readonly x: number; readonly y: number; readonly halfWidth: number }[];
}

/**
 * Battlefield's geometry, used when the caller does not supply a stage.
 *
 * A default exists at all because the CPU has to be usable from a unit test and
 * from a preview screen that has not loaded a stage yet; the match loop always
 * passes the real one. Battlefield rather than Final Destination because a
 * CPU that has never met a soft platform is the more surprising failure.
 */
export const DEFAULT_STAGE_VIEW: StageView = {
  leftLedge: fx(-80),
  rightLedge: fx(80),
  groundY: 0,
  blastLeft: fx(-240),
  blastRight: fx(240),
  blastTop: fx(192),
  blastBottom: fx(-140),
  platforms: [
    { x: fx(-38.2), y: fx(27.2), halfWidth: fx(19.4) },
    { x: fx(38.2), y: fx(27.2), halfWidth: fx(19.4) },
    { x: 0, y: fx(54.5), halfWidth: fx(19.5) },
  ],
};

/** Project a real stage onto what the CPU needs from it. */
export function stageViewFromDef(def: StageDef): StageView {
  const main = def.platforms.find((p) => p.ledges) ?? def.platforms[0];
  const soft = def.platforms.filter((p) => p.soft);
  return {
    leftLedge: main ? main.x - main.halfWidth : DEFAULT_STAGE_VIEW.leftLedge,
    rightLedge: main ? main.x + main.halfWidth : DEFAULT_STAGE_VIEW.rightLedge,
    groundY: main ? main.y : DEFAULT_STAGE_VIEW.groundY,
    blastLeft: def.blastZone.left,
    blastRight: def.blastZone.right,
    blastTop: def.blastZone.top,
    blastBottom: def.blastZone.bottom,
    platforms: soft.map((p) => ({ x: p.x, y: p.y, halfWidth: p.halfWidth })),
  };
}

/* ----------------------------------------------------------------- tuning -- */

/**
 * The nine dials a level sets. Every field is 0..1 except `reactionFrames`.
 * The values live in `cpu.ts`; this is only their shape.
 */
export interface LevelTuning {
  readonly level: number;
  /** How far back in time the CPU's view of the opponent is. 30 → 4 frames. */
  readonly reactionFrames: number;
  /** How readily it closes distance instead of waiting. */
  readonly aggression: number;
  readonly shieldRate: number;
  readonly dodgeRate: number;
  /** 0 never DIs; 1 always DIs perpendicular to the launch. */
  readonly diSkill: number;
  /** 0 never mashes SDI during hitlag; 1 mashes every available pulse. */
  readonly sdiSkill: number;
  /** 0 forgets to jump back and dies offstage; 1 recovers reliably. */
  readonly recoverySkill: number;
  readonly edgeguardSkill: number;
  /** How well the move choice matches the situation, versus flailing. */
  readonly moveChoiceSkill: number;
  /** Score jitter, ±this fraction. High at low levels — visible indecision. */
  readonly noise: number;
  /** Chance of dropping a frame's input entirely. The low-level fumble. */
  readonly fumbleChance: number;
}

/* ------------------------------------------------------------ observation -- */

const NEUTRAL_GROUNDED: ActionState = "stand";
const NEUTRAL_AIRBORNE: ActionState = "fall";

const ATTACK_ACTIONS: readonly ActionState[] = ["attack", "special"];
const GRAB_ACTIONS: readonly ActionState[] = ["grab", "grabHold"];
const SHIELD_ACTIONS: readonly ActionState[] = ["shieldStart", "shield", "shieldStun"];
const REELING_ACTIONS: readonly ActionState[] = [
  "hitstun",
  "tumble",
  "grabbed",
  "thrown",
  "downed",
  "shieldBroken",
];
const INACTIVE_ACTIONS: readonly ActionState[] = ["dead", "entering", "respawnPlatform"];
/** Helpless after a recovery move (Plan 5, Task 4b): only the stick does anything. */
const HELPLESS_ACTIONS: readonly ActionState[] = ["specialFall"];

/**
 * What the CPU believes is happening.
 *
 * The opponent's position is rewound by the reaction delay, and their *action*
 * is only believed once it has been visible for that long — a level-9 CPU
 * notices a smash on frame 4 of its startup and can still shield it; a level-1
 * CPU is told the opponent is standing still until 30 frames after the swing
 * began, by which time it has already been hit. That single mechanism produces
 * most of the felt difference between the levels, and it produces it without
 * ever giving the CPU a number a human could not have seen.
 */
export interface Observation {
  /** Own state, exact — a fighter always knows what it is doing. */
  readonly self: FighterState;
  /** Nearest living opponent, rewound. Null in a one-fighter state. */
  readonly target: FighterState | null;
  /** What the CPU believes the target is doing. */
  readonly targetAction: ActionState;
  /** Frames the believed action has been visible for. -1 when unknown. */
  readonly targetActionAge: number;
  /** Target minus self, in fixed units, using the rewound position. */
  readonly dx: number;
  readonly dy: number;
  readonly distance: number;
  readonly facingTarget: boolean;
  readonly frame: number;
}

function isLiveOpponent(f: FighterState, port: number): boolean {
  return f.port !== port && f.stocks > 0 && !INACTIVE_ACTIONS.includes(f.action);
}

/**
 * Rewind a fighter by `frames` using its current velocity.
 *
 * A genuine input-delay buffer would need the CPU to carry a ring of past
 * states, which would put mutable history outside `GameState` and break
 * rollback — a rolled-back frame would have to un-remember. Extrapolating
 * backwards along the velocity gets the same *effect* (the CPU aims where you
 * were, and leads you wrongly when you turn) out of the current state alone, so
 * `cpuInput` stays a pure function of `(state, port, level, seed)` and
 * re-simulates identically. It is also the more forgiving error: it degrades
 * smoothly with speed instead of snapping.
 */
function rewind(f: FighterState, frames: number): FighterState {
  if (frames <= 0) return f;
  return { ...f, x: f.x - f.vx * frames, y: f.y - f.vy * frames };
}

export function observe(state: GameState, port: number, reactionFrames: number): Observation {
  const self = state.fighters[port];
  let nearest: FighterState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const other of state.fighters) {
    if (!isLiveOpponent(other, port)) continue;
    const d = magnitude(other.x - self.x, other.y - self.y);
    // Strictly-less keeps the lowest port on a tie, so target selection is
    // deterministic and does not depend on array iteration luck.
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = other;
    }
  }

  if (!nearest) {
    return {
      self,
      target: null,
      targetAction: NEUTRAL_GROUNDED,
      targetActionAge: -1,
      dx: 0,
      dy: 0,
      distance: 0,
      facingTarget: true,
      frame: state.frame,
    };
  }

  const seen = rewind(nearest, reactionFrames);
  const noticed = nearest.actionFrame >= reactionFrames;
  const targetAction = noticed
    ? nearest.action
    : nearest.grounded
      ? NEUTRAL_GROUNDED
      : NEUTRAL_AIRBORNE;

  const dx = seen.x - self.x;
  const dy = seen.y - self.y;

  return {
    self,
    target: seen,
    targetAction,
    targetActionAge: noticed ? nearest.actionFrame - reactionFrames : -1,
    dx,
    dy,
    distance: magnitude(dx, dy),
    facingTarget: dx === 0 ? true : dx > 0 === self.facing > 0,
    frame: state.frame,
  };
}

/* --------------------------------------------------------------- contexts -- */

/** Indices into `ctx.rolls`. Fixed so the draw count never varies by branch. */
export const ROLL_SHIELD = 0;
export const ROLL_DODGE = 1;
export const ROLL_EDGEGUARD = 2;
export const ROLL_RECOVER = 3;
export const ROLL_MOVE = 4;
export const ROLL_FUMBLE = 5;
export const DECISION_ROLLS = 6;

export interface BehaviourContext {
  /** Read for `frame` and `rules` only — never for the opponent. */
  readonly state: GameState;
  readonly view: Observation;
  readonly stage: StageView;
  readonly tuning: LevelTuning;
  /** Air jumps the CPU believes it has. Kirby has five; most have one. */
  readonly jumps: number;
  /** How far this fighter's pokes actually reach. See `meleeReachFromDef`. */
  readonly meleeReach: number;
  /** This fighter's air friction, Q12 a frame. See `airBrakeFromDef`. */
  readonly airBrake: number;
  /** This fighter's air-dodge lengths. See `airDodgeFromDef`. */
  readonly airDodge: AirDodgeAttributes;
  /**
   * Where this fighter's up special goes, for when to spend it (Plan 5, Task
   * 4b). See `recoveryFromDef`. Null: spend it as soon as it is needed.
   */
  readonly recovery: RecoveryMove | null;
  /** Pre-drawn randoms in [0,1), one per `ROLL_*` slot. */
  readonly rolls: readonly number[];
}

export interface BehaviourResult {
  readonly score: number;
  readonly input: InputFrame;
}

export type Behaviour = (ctx: BehaviourContext) => BehaviourResult;

export type BehaviourName =
  | "survive"
  | "recover"
  | "shield"
  | "edgeguard"
  | "attack"
  | "platformMove"
  | "approach"
  | "retreat"
  | "idle";

const NOTHING: BehaviourResult = { score: 0, input: 0 };

/* ------------------------------------------------------------- primitives -- */

/** Ranges, in fixed units. A fighter is roughly 12 units tall. */
export const GRAB_RANGE = fx(11);
/**
 * The fallback swing range, for a CPU whose fighter's reach was not supplied.
 *
 * Kept only as a default. Using it for a real fighter is what produced the
 * whiff deadlock described on `meleeReachFromDef`.
 */
export const MELEE_RANGE = fx(20);
export const THREAT_RANGE = fx(30);

/** The pokes the default swing in `attack` can actually come out as. */
const POKE_SLOTS: readonly MoveSlot[] = ["jab1", "ftilt"];

/**
 * How far this fighter can actually hit from, in world units.
 *
 * `attack` and `approach` are two halves of one threshold: `approach` stops
 * closing at it and `attack` starts swinging at it, so the number has to be a
 * distance the fighter's arm genuinely covers. A single constant for the whole
 * roster is not — Donkey Kong's jab reaches 11.5 units (offset 7.5, radius
 * 4.0), so a CPU using `MELEE_RANGE` parked at 14 units away, decided that was
 * close enough to punch, and threw jabs at empty air. Nothing recovered: with
 * both fighters stationary the state was identical on the next frame, so the
 * same decision came back forever and the match sat at 58%–0% until the timer
 * would have run out.
 *
 * Taken as the *minimum* across the pokes rather than the maximum, because the
 * default swing does not get to choose which one comes out — a tilt when the
 * direction has gone stale, a jab when it has not. Closing to the shorter of
 * the two means whichever the engine reads, it connects. Every heavier option
 * reaches further than either, so nothing else needs a threshold of its own.
 *
 * Conservative on purpose in one more way: it ignores the victim's hurtbox
 * radius, which only ever adds reach. Standing a little too close costs the CPU
 * nothing; standing a little too far costs it the entire match.
 */
export function meleeReachFromDef(def: FighterDef): number {
  let reach = 0;
  let found = false;

  for (const slot of POKE_SLOTS) {
    const move = def.moves[slot];
    if (!move) continue;

    const furthest = moveReach(move);
    if (furthest <= 0) continue;

    reach = found ? Math.min(reach, furthest) : furthest;
    found = true;
  }

  return found ? reach : MELEE_RANGE;
}

/** A fighter's air friction (`air_brake_x`), for `dodgeDrift`. */
export function airBrakeFromDef(def: FighterDef): number {
  return fighterParams(def).air_brake_x;
}

/** A fighter's own air-dodge lengths (Plan 3, Task 20c), for how long a dodge drifts it. */
export function airDodgeFromDef(def: FighterDef): AirDodgeAttributes {
  return airDodgeOf(def.attributes);
}

/**
 * What the CPU needs of its fighter's up special to judge a recovery (Plan 5,
 * Task 4b). The move leaves the fighter helpless, with no second try, so when
 * to spend it, and which way to hold the stick through it, is decided by where
 * it actually goes. Since Task 13b that is found by running the engine's own
 * per-frame rules on a copy of the fighter (`upBPath`): the move's aims, turn,
 * launch, phases and windows (`engine/upSpecial.ts`), its drift and gravity,
 * and the helpless fall after, exactly as `step()` runs them for a fighter
 * alone in the air. Nothing here restates a rule, so nothing can drift from it.
 */
export interface RecoveryMove {
  readonly def: FighterDef;
  /** The up special it uses in the air: its own aerial one where it has one (`upBAir`). */
  readonly slot: MoveSlot;
  /** Its length begun in the air (`MoveDef.fromAir`), the move frames before the helpless fall. */
  readonly totalFrames: number;
  /** The fighter's own: air speed, accelerations and friction, gravity, fall speeds. */
  readonly params: FighterParams;
  /** The helpless fall's top drift speed, Q12 a frame (`HelplessDef.airSpeed`; the fighter's own air speed without one). */
  readonly helplessDrift: number;
  /** How the stick aims it (`MoveDef.aim`), which decides the sticks worth trying (`upBSticks`). */
  readonly aim: MoveAim["kind"] | "none";
  /** The move frame its second leg is aimed on (Pikachu's 20), or 0. */
  readonly secondAim: number;
  /** It can wall jump, which must come before it (special fall refuses one; Plan 5, Task 10). */
  readonly wallJump: boolean;
}

/**
 * A fighter's up special as `recover` judges it, or null when it has none. Its
 * movement is no longer read off a momentum list (Task 13 put moves on their
 * scripts, and Task 13b gave up specials launches, phases and aims): the model
 * runs the move itself, so a move whose data changes keeps a working model.
 */
export function recoveryFromDef(def: FighterDef): RecoveryMove | null {
  const slot: MoveSlot = def.moves.upBAir !== undefined ? "upBAir" : "upB";
  const move = def.moves[slot];
  if (move === undefined) return null;
  const p = fighterParams(def);
  const second = (move.momentum ?? []).find((w) => w.second === true);
  return {
    def,
    slot,
    totalFrames: move.fromAir?.totalFrames ?? move.totalFrames,
    params: p,
    helplessDrift: mul(p.air_speed_x_stable, move.helpless?.airSpeed ?? ONE),
    aim: move.aim?.kind ?? "none",
    secondAim: second?.aimAt ?? 0,
    wallJump: def.attributes.canWallJump,
  };
}

/** One frame of an up special's path: where the fighter is, relative to where it was, its vertical speed, its facing, and whether it is helpless. */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
  readonly facing: number;
  readonly helpless: boolean;
}

/**
 * The stick through an up special: `first` held until the move reaches move
 * frame `switchAt`, then `then` (a second leg aimed another way); the same for
 * a move with one aim. Direction bits only.
 */
export interface UpBStick {
  readonly first: InputFrame;
  readonly then: InputFrame;
  readonly switchAt: number;
}

const one = (stick: InputFrame): UpBStick => ({ first: stick, then: stick, switchAt: 0 });

/** No floor, no ledge, no blast line in reach: the move's own path and nothing else. */
const GHOST_STAGE: StageDef = {
  id: "upBGhost",
  name: "up special path",
  series: "",
  platforms: [],
  blastZone: { left: -fx(100_000), right: fx(100_000), top: fx(100_000), bottom: -fx(100_000) },
  spawns: [{ x: 0, y: 0 }],
  theme: "",
};

/** Whether `f` is in the up special `r` models. */
function inUpB(f: Pick<FighterState, "action" | "move">, r: RecoveryMove): boolean {
  return f.action === "special" && (f.move === "upB" || f.move === r.slot);
}

/**
 * Where the up special takes the fighter, frame by frame, for `frames` frames:
 * started on the first of them (Up and Special pressed with `stick`'s first
 * direction), or carried on from where it is if the fighter is already in it,
 * then the helpless fall. Each frame is `step()`'s for one fighter alone in the
 * air: the input read (`updateInputTracking`, `interpretInput`), the airtime,
 * the status (`advanceFighter`), the movement (`applyMovement`) and the move
 * (`integrate`), on a copy. Not modelled: a hit, a landing, a ledge or a wall on
 * the way (the caller reads those off the path); a blast line is the caller's
 * too. `stop`, if given, ends the path at the first point it accepts.
 */
export function upBPath(
  r: RecoveryMove,
  self: FighterState,
  stick: UpBStick | InputFrame,
  frames: number,
  frame0 = 0,
  stop?: (p: PathPoint) => boolean,
): PathPoint[] {
  const plan = typeof stick === "number" ? one(stick) : stick;
  const f = cloneFighter(self);
  // The frame number is the one thing that changes: the buffer reads it.
  const ctx: { -readonly [K in keyof StateContext]: StateContext[K] } = { def: r.def, stage: GHOST_STAGE, frame: frame0, fighters: [f] };
  const started = inUpB(f, r);
  // The move frame the next step runs: the press is move frame 1.
  let moveFrame = started ? f.actionFrame + 2 : 1;
  let prev: InputFrame = 0;
  const out: PathPoint[] = [];
  for (let i = 0; i < frames; i++) {
    const dir = moveFrame >= plan.switchAt && plan.switchAt > 0 ? plan.then : plan.first;
    const input = i === 0 && !started ? upBPress(dir) : dir;
    ctx.frame = frame0 + i + 1;
    updateInputTracking(f, input, prev);
    const intent = interpretInput(f, input, prev);
    if (f.hitstun > 0) f.hitstun -= 1;
    if (!f.grounded && f.ledge === null) f.airTime += 1;
    advanceFighter(f, intent, ctx);
    applyMovement(f, intent, ctx);
    integrate(f);
    prev = input;
    moveFrame += 1;
    const p = { x: f.x - self.x, y: f.y - self.y, vy: f.vy, facing: f.facing, helpless: f.action === "specialFall" };
    out.push(p);
    if (stop?.(p) === true) break;
  }
  return out;
}

/**
 * The sticks worth holding through the up special, toward the ledge first
 * (`toward` −1 or 1): one side or none for a move the stick only drifts, turns
 * or tilts; the octants that lead toward the stage for one it aims (Fox); and
 * for one with two legs (Pikachu), pairs of them, the second turned from the
 * first, after one leg alone. Few on purpose: each is a run of the move.
 */
export function upBSticks(r: RecoveryMove, toward: number): UpBStick[] {
  const T: InputFrame = toward > 0 ? Btn.Right : Btn.Left;
  const A: InputFrame = toward > 0 ? Btn.Left : Btn.Right;
  if (r.aim === "octant") return [T | Btn.Up, T, Btn.Up, T | Btn.Down, 0].map(one);
  if (r.aim === "legs") {
    const firsts: InputFrame[] = [T | Btn.Up, Btn.Up, T];
    const out: UpBStick[] = [];
    for (const first of firsts) for (const then of [T | Btn.Up, T, Btn.Up]) if (then !== first) out.push({ first, then, switchAt: r.secondAim });
    return [...out, ...firsts.map(one)];
  }
  return [T, 0, A].map(one);
}

/**
 * The press that starts the up special, with a plan's stick (ruling R-T13b-c): its
 * side, Up and Special, never Down. Up and Down cancel (`stickY` 0), so a press with
 * both is a side special: Fox's `T | Down` plan pressed whole came out as Fox Illusion
 * (the Task 13b review's I-1). The plan's Down is held from the move's second frame
 * on, which is where Fire Fox reads its aim (`upSpecial.ts`).
 */
export function upBPress(stick: InputFrame): InputFrame {
  return upBHold(stick) | Btn.Special;
}

/** A plan's stick with Up and without Down: what the CPU holds until its up special comes out (ruling R-T13b-c). */
export function upBHold(stick: InputFrame): InputFrame {
  return (stick & ~Btn.Down) | Btn.Up;
}

/** The stick a plan holds on the move frame the fighter's next step runs (its first, outside the move). */
export function upBStickNow(plan: UpBStick, self: FighterState, r: RecoveryMove): InputFrame {
  const next = inUpB(self, r) ? self.actionFrame + 2 : 1;
  return plan.switchAt > 0 && next >= plan.switchAt ? plan.then : plan.first;
}

/**
 * How far in front of the fighter one move's hitboxes reach, in world units:
 * the furthest box's centre plus its radius, 0 for a move that reaches nothing
 * in front. An extended box reaches from whichever of its two ends is further
 * (`Hitbox.x2`): a grab's capsule runs out from the body, and its far end is
 * the reach (Plan 3, Task 18).
 */
export function moveReach(move: MoveDef): number {
  let furthest = 0;
  for (const hitbox of move.hitboxes) {
    furthest = Math.max(furthest, Math.max(hitbox.x, hitbox.x2 ?? hitbox.x) + hitbox.radius);
  }
  return furthest;
}

export const VERTICAL_REACH = fx(13);

export function isStunned(f: FighterState): boolean {
  return f.hitlag > 0 || f.hitstun > 0 || REELING_ACTIONS.includes(f.action);
}

export function canAct(f: FighterState): boolean {
  return !isStunned(f) && !INACTIVE_ACTIONS.includes(f.action) && !isHelpless(f);
}

/** Helpless after a recovery move (Plan 5, Task 4b): no button does anything until it lands or grabs a ledge. */
export function isHelpless(f: FighterState): boolean {
  return HELPLESS_ACTIONS.includes(f.action);
}

export function isAttacking(action: ActionState): boolean {
  return ATTACK_ACTIONS.includes(action);
}

export function isGrabbing(action: ActionState): boolean {
  return GRAB_ACTIONS.includes(action);
}

export function isShielding(action: ActionState): boolean {
  return SHIELD_ACTIONS.includes(action);
}

/** The direction bit that moves `from` toward `to`, or 0 when already there. */
export function towardX(from: number, to: number): InputFrame {
  if (to > from) return Btn.Right;
  if (to < from) return Btn.Left;
  return 0;
}

/**
 * A button that has to be *pressed*, not held, emitted on a repeating cycle so
 * a fresh edge exists every `period` frames.
 *
 * The CPU is memoryless by construction — it never sees the frame it produced
 * last tick — so it cannot "remember to let go". Deriving the on/off phase from
 * `state.frame` gives it a hand that opens and closes on a schedule, which is
 * both deterministic under rollback and a fair model of a human's mash rate.
 * The port offset stops four CPUs on the same stage from pressing in unison.
 */
export function pulse(frame: number, port: number, period: number, holdFrames: number): boolean {
  const phase = (((frame + port * 3) % period) + period) % period;
  return phase < holdFrames;
}

/** Two frames of jump: released inside the 3-frame jumpsquat, so a short hop. */
export function shortHopPulse(frame: number, port: number): boolean {
  return pulse(frame, port, 8, 2);
}

/** Five frames of jump: held past jumpsquat, so a full hop. */
export function fullHopPulse(frame: number, port: number): boolean {
  return pulse(frame, port, 10, 5);
}

/** How far a point is from the nearest blast zone. Bigger is safer. */
export function blastMargin(x: number, y: number, stage: StageView): number {
  return Math.min(
    x - stage.blastLeft,
    stage.blastRight - x,
    stage.blastTop - y,
    y - stage.blastBottom,
  );
}

export function isOffstage(f: FighterState, stage: StageView): boolean {
  return f.x < stage.leftLedge - fx(2) || f.x > stage.rightLedge + fx(2);
}

/**
 * How far an air dodge carries the fighter sideways over `frames` more frames,
 * from its `vx` now. A neutral dodge keeps the fighter's momentum (SmashWiki
 * "Air dodge", https://www.ssbwiki.com/Air_dodge: "preserving their momentum";
 * Plan 3, Task 20b), and with the stick let go air friction (`airBrake`) takes
 * that much off it every frame (SmashWiki "Air friction",
 * https://www.ssbwiki.com/Air_friction). All of `vx` is bled at that rate,
 * though a launch on it decays at its own 0.051, faster than any fighter's air
 * friction here: so this is the further of the two, and errs towards not dodging.
 * `frames` is the fighter's own dodge length for a dodge not yet begun, and what
 * is left of it for one under way (Task 20c), whose `vx` may be a directional
 * dodge's slide: further again, and the steering it asks for is back over the stage.
 */
export function dodgeDrift(vx: number, airBrake: number, frames: number): number {
  const speed = abs(vx);
  const n = Math.max(0, airBrake > 0 ? Math.min(frames, Math.trunc(speed / airBrake)) : frames);
  const drift = n * speed - Math.trunc((airBrake * n * (n + 1)) / 2);
  return vx < 0 ? -drift : drift;
}

/** Whether an air dodge with `frames` left would carry the fighter off the stage before it could act again. */
export function dodgeCarriesOffstage(f: FighterState, stage: StageView, airBrake: number, frames: number): boolean {
  if (f.grounded) return false;
  return isOffstage({ ...f, x: f.x + dodgeDrift(f.vx, airBrake, frames) }, stage);
}

/**
 * How far a sideways directional air dodge carries the fighter, `dir` −1 or 1
 * (Plan 3, Task 20c): 7 back and 20 forward (the slingshot and the slide,
 * whatever it was moving at), then the 1.3 it hands to drift, bled by air
 * friction over the rest of its own sideways length with the stick let go, as
 * `dodgeDrift` bleeds a neutral dodge's.
 */
export function sideDodgeTravel(dir: number, airBrake: number, a: AirDodgeAttributes): number {
  const rest = airDodgeFrames(a, airDodgeCharge(dir, 0)) - AIR_DODGE_SLINGSHOT_FRAMES - AIR_DODGE_SLIDE_FRAMES;
  const slide = dir * (AIR_DODGE_SLIDE_DISTANCE - AIR_DODGE_SLINGSHOT_DISTANCE);
  return slide + dodgeDrift(dir * AIR_DODGE_SLIDE_END_SPEED, airBrake, rest);
}

/** Whether a sideways directional air dodge now would carry the fighter off the stage before it could act again. */
export function sideDodgeCarriesOffstage(
  f: FighterState,
  stage: StageView,
  airBrake: number,
  a: AirDodgeAttributes,
  dir: number,
): boolean {
  if (f.grounded) return false;
  return isOffstage({ ...f, x: f.x + sideDodgeTravel(dir, airBrake, a) }, stage);
}

/**
 * Quantise a vector onto the nine digital directions a keyboard can express.
 *
 * An axis is included when it carries at least 40% of the dominant component,
 * which is what turns a 30° vector into "sideways" and a 50° one into a
 * diagonal — the same shape as a real controller's octagonal gate.
 */
export function digitalDirection(x: number, y: number): InputFrame {
  const ax = abs(x);
  const ay = abs(y);
  const dominant = Math.max(ax, ay);
  if (dominant === 0) return 0;

  let bits: InputFrame = 0;
  if (ax * 5 >= dominant * 2) bits |= x > 0 ? Btn.Right : Btn.Left;
  if (ay * 5 >= dominant * 2) bits |= y > 0 ? Btn.Up : Btn.Down;
  return bits;
}

/**
 * Survival DI: perpendicular to the launch, on whichever side moves away from
 * the blast zone that is about to kill.
 *
 * Perpendicular is the correct answer because DI rotates the trajectory rather
 * than replacing it — the component along the launch does nothing at all, so
 * the whole of the 9.74° budget is spent by holding across it. Which of the two
 * perpendiculars survives depends on where you are: launched horizontally at
 * the right blast zone you hold up, but launched diagonally up-left with a
 * ceiling above you, up is the direction that kills you. Both candidates are
 * scored against the actual geometry rather than guessed from the angle.
 */
export function diDirection(self: FighterState, stage: StageView): InputFrame {
  const vx = self.vx;
  const vy = self.vy;
  if (vx === 0 && vy === 0) return 0;

  const a = digitalDirection(-vy, vx);
  const b = digitalDirection(vy, -vx);
  if (a === 0) return b;
  if (b === 0) return a;

  const step = fx(24);
  const marginFor = (bits: InputFrame): number => {
    const nx = self.x + ((bits & Btn.Right) !== 0 ? step : (bits & Btn.Left) !== 0 ? -step : 0);
    const ny = self.y + ((bits & Btn.Up) !== 0 ? step : (bits & Btn.Down) !== 0 ? -step : 0);
    return blastMargin(nx, ny, stage);
  };

  return marginFor(b) > marginFor(a) ? b : a;
}

/* ------------------------------------------------------------ behaviours -- */

/**
 * Do not die: DI during hitstun, SDI during hitlag.
 *
 * Scored far above everything else because during hitstun nothing else is even
 * legal — the fighter cannot act, so the only question left is which way it
 * travels. Every other behaviour is gated on `canAct`, so this one is
 * uncontested when it applies and silent when it does not.
 */
export const survive: Behaviour = (ctx) => {
  const { self } = ctx.view;
  if (!isStunned(self)) return NOTHING;

  const escape = diDirection(self, ctx.stage);
  if (escape === 0) return { score: 1000, input: 0 };

  if (self.hitlag > 0) {
    // SDI is one pulse per fresh direction press, and the engine counts at most
    // one per SDI_INPUT_INTERVAL frames, so a two-on / two-off cycle at that
    // period extracts every pulse on offer and wastes none.
    if (ctx.rolls[ROLL_MOVE] >= ctx.tuning.sdiSkill) return { score: 1000, input: 0 };
    const holding = pulse(ctx.view.frame, self.port, SDI_INPUT_INTERVAL, 2);
    return { score: 1000, input: holding ? escape : 0 };
  }

  if (ctx.rolls[ROLL_MOVE] >= ctx.tuning.diSkill) return { score: 1000, input: 0 };
  return { score: 1000, input: escape };
};

/**
 * Get back to the stage. Jump while jumps remain, up-B once they do not — and
 * at low levels, sometimes neither, which is where level-1 CPUs go to die. A
 * fighter that can wall jump kicks off the stage's wall first, where it is close
 * under the ledge; the up special is pressed with the stick its own path says
 * gets the fighter back, and that stick is held through it (Plan 5, Task 13b).
 */
export const recover: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const { stage, tuning } = ctx;

  // Helpless (Plan 5, Task 4b): the up special is spent and nothing else comes
  // out, so all that is left is to drift home, at every level, as the air
  // dodge's steering below is. Never down: a fast fall is all it could add.
  if (isHelpless(self)) {
    const home = isOffstage(self, stage) || self.y < stage.groundY ? (self.x < 0 ? stage.leftLedge : stage.rightLedge) : 0;
    return { score: 950, input: towardX(self.x, home) };
  }
  if (!canAct(self)) return NOTHING;

  if (self.action === "ledgeHang") {
    // Climbing costs nothing and the ledge regrab limit is six, so there is no
    // level at which hanging forever is the right answer.
    return { score: 700, input: pulse(ctx.view.frame, self.port, 12, 4) ? Btn.Up : 0 };
  }

  // In an air dodge the fighter cannot act until it ends, and a neutral one
  // keeps falling (Plan 3, Task 20b): whatever else it was chasing, it steers
  // back over the stage rather than drifting out past the ledge, judged over
  // the frames its own dodge has left (Task 20c). Steering is drift, which this
  // behaviour does at every level (the level-1 failure below is the button,
  // not the stick), so it is not gated by `recoverySkill` either.
  if (self.action === "airDodge") {
    const left = airDodgeFrames(ctx.airDodge, self.charge) - self.actionFrame;
    if (dodgeCarriesOffstage(self, stage, ctx.airBrake, left)) return { score: 900, input: towardX(self.x, 0) };
  }

  const offstage = isOffstage(self, stage);
  const belowStage = self.y < stage.groundY - fx(4);
  const r = ctx.recovery;

  // In its own up special (Plan 5, Task 13b): the stick aims the move and steers
  // it, so this behaviour keeps it whatever else would press. Off the stage it
  // holds the stick that, run on from here, gets it back (`upBPlan`), or with none
  // that does the first of them, toward the stage; over the stage, none, so the
  // move flies as authored and nothing aims it off (a second leg pressed away by
  // another behaviour once took a Pikachu off Battlefield). At every level: like
  // the helpless drift above, it is steering, not the button.
  if (r !== null && inUpB(self, r)) {
    if (self.grounded || (!offstage && !belowStage)) return { score: 950, input: 0 };
    const nearer = self.x < 0 ? stage.leftLedge : stage.rightLedge;
    const toward = nearer > self.x ? 1 : -1;
    const plan = upBPlan(self, nearer, stage, r, ctx.view.frame) ?? upBSticks(r, toward)[0];
    return { score: 950, input: upBStickNow(plan, self, r) };
  }

  if (self.grounded || (!offstage && !belowStage)) return NOTHING;

  const nearerLedge = self.x < 0 ? stage.leftLedge : stage.rightLedge;
  const drift = towardX(self.x, nearerLedge);

  // The level-1 self-destruct, made explicit rather than emergent: it drifts
  // back but forgets the button, runs out of altitude and dies. At level 9 the
  // roll never fails.
  if (ctx.rolls[ROLL_RECOVER] >= tuning.recoverySkill) {
    return { score: 900, input: drift };
  }

  // A wall jump first, where the fighter can make one: touching the stage's wall
  // below the ledge, falling, it presses away from the wall (Plan 5, Task 13b; the
  // Task 10 review). It gains height and costs no jump, and special fall refuses
  // one (SmashWiki "Helpless", https://www.ssbwiki.com/Helpless: "unable to take
  // any action"), so it has to come before the up special.
  const side = self.combat.wallSide;
  if (r !== null && r.wallJump && side !== 0 && self.combat.wallFrames <= WALL_JUMP_WINDOW && self.vy <= 0 && self.y < stage.groundY) {
    return { score: 950, input: side < 0 ? Btn.Right : Btn.Left };
  }

  // ...and close to the wall under the ledge, it drifts into it to kick off it
  // rather than spend the up special, unless waiting is no longer safe.
  const underLedge = self.y < stage.groundY - fx(4) && self.y > stage.groundY - HARD_PLATFORM_DEPTH;
  if (r !== null && r.wallJump && underLedge && abs(self.x - nearerLedge) <= WALL_SEEK_RANGE && !upBNowOrNever(self, stage, r, ctx.view.frame)) {
    return { score: 950, input: drift };
  }

  const outOfJumps = self.jumpsUsed >= ctx.jumps;
  const deep = self.y < stage.groundY - fx(20);

  const jumping = fullHopPulse(ctx.view.frame, self.port);

  // Up-B is the last resource, so it is spent only when the jump is gone or
  // the fighter is already too low for a jump alone to reach the ledge. It
  // leaves the fighter helpless (Plan 5, Task 4b), so it is spent once the
  // ledge is in its reach, or as soon as waiting longer would put the ledge
  // out of it; until then the fighter drifts closer, and jumps if it can.
  if (outOfJumps || deep) {
    // The stick it would hold through the up special, read off the move's own path
    // (Plan 5, Task 13b: `upBPlan`), and pressed with it as the move starts.
    const plan = r === null ? null : upBPlan(self, nearerLedge, stage, r, ctx.view.frame);
    if (r !== null && plan === null && !upBNowOrNever(self, stage, r, ctx.view.frame)) {
      return { score: 950, input: drift | (!outOfJumps && jumping ? Btn.Jump : 0) };
    }
    // Decided: every frame up to the one the special comes out holds Up and never
    // Down (ruling R-T13b-c), so whichever frame the press lands on, or a buffered
    // one fires on, reads as the up special and not a side or neutral one.
    const firing = pulse(ctx.view.frame, self.port, 6, 3);
    const stick = plan === null ? drift : upBStickNow(plan, self, r!);
    return { score: 950, input: firing ? upBPress(stick) : upBHold(stick) };
  }

  return { score: 900, input: drift | (jumping ? Btn.Jump : 0) };
};

/**
 * UNVERIFIED (CPU judgement, no source): frames of falling the CPU allows for
 * between deciding to up special and the move's first frame (its press pulses
 * three frames on, three off), at the fighter's own fall speed.
 */
const UPB_DECISION_FRAMES = 6;

/**
 * UNVERIFIED (CPU judgement, Plan 5, Task 13b): how far from the stage's wall,
 * under the ledge, a fighter that can wall jump drifts into it to kick off it
 * before it spends the up special.
 */
const WALL_SEEK_RANGE = fx(10);

/**
 * UNVERIFIED (CPU judgement): helpless frames `upBInReach` follows past the
 * move's end, enough to come back down to a ledge from any up special's height.
 */
const UPB_LOOKAHEAD_FRAMES = 120;

/**
 * Whether the up special, used now (or carried on) with `stick`, gets the
 * fighter back (Plan 5, Task 4b fix round 1; Task 13b): somewhere on its path
 * (`upBPath`, the move and then the helpless fall) the fighter comes down on
 * the main stage, between its ledges, or is falling within a ledge grab of it
 * (`LEDGE_GRAB_RANGE_X`, less from behind, and `LEDGE_GRAB_RANGE_Y` below, as
 * `findLedgeGrab` measures; the body's own half-width, which only adds reach,
 * is left out). A path through a blast line does not, nor a helpless fall
 * already below grabbing height, which can only go on down.
 */
export function upBInReach(self: FighterState, ledge: number, stage: StageView, r: RecoveryMove, stick: UpBStick | InputFrame = 0, frame0 = 0): boolean {
  const toward = ledge > self.x ? 1 : -1;
  let prevY = self.y;
  let reached = false;
  upBPath(r, self, stick, r.totalFrames + UPB_LOOKAHEAD_FRAMES, frame0, (p) => {
    const x = self.x + p.x;
    const y = self.y + p.y;
    if (x < stage.blastLeft || x > stage.blastRight || y < stage.blastBottom || y > stage.blastTop) return true;
    // How far past the ledge, toward the stage: positive is over it.
    const past = (x - ledge) * toward;
    const onStage = x >= stage.leftLedge && x <= stage.rightLedge;
    if (past > 0 && onStage && p.vy <= 0 && prevY >= stage.groundY && y <= stage.groundY) return (reached = true);
    const drop = stage.groundY - y;
    // Facing the ledge as the path faces it then (the move may have turned it).
    const range = p.facing === toward ? LEDGE_GRAB_RANGE_X : mul(LEDGE_GRAB_RANGE_X, LEDGE_GRAB_BACK_PENALTY);
    if (p.vy <= 0 && past <= 0 && -past <= range && drop >= 0 && drop <= LEDGE_GRAB_RANGE_Y) return (reached = true);
    prevY = y;
    return p.helpless && drop > LEDGE_GRAB_RANGE_Y;
  });
  return reached;
}

/**
 * The first stick, in `upBSticks`' order, with which the up special gets the
 * fighter back from here, or null. Used before the move, to decide to spend it,
 * and during it, to hold the stick that keeps it on course.
 */
export function upBPlan(self: FighterState, ledge: number, stage: StageView, r: RecoveryMove, frame0 = 0): UpBStick | null {
  const toward = ledge > self.x ? 1 : -1;
  for (const plan of upBSticks(r, toward)) if (upBInReach(self, ledge, stage, r, plan, frame0)) return plan;
  return null;
}

/**
 * Whether it is now or never for the up special: a few more frames of falling
 * (`UPB_DECISION_FRAMES`) and the move's highest point, from the fighter's
 * speed now and with the stick at rest, would no longer lift it to grabbing
 * height under the ledge. Then `recover` spends it even out of reach, as the
 * last thing left.
 */
export function upBNowOrNever(self: FighterState, stage: StageView, r: RecoveryMove, frame0 = 0): boolean {
  let apex = 0;
  for (const p of upBPath(r, self, 0, r.totalFrames, frame0)) if (p.y > apex) apex = p.y;
  const terminal = self.fastFalling ? r.params.dive_speed_y : r.params.air_speed_y_stable;
  return stage.groundY - LEDGE_GRAB_RANGE_Y - self.y + UPB_DECISION_FRAMES * terminal >= apex;
}

/**
 * Shield what it can see coming, and spot-dodge a grab.
 *
 * Everything about this depends on the observation delay: `targetAction` is
 * only "attack" once the swing has been visible for the level's reaction time,
 * so a level-9 CPU (4 frames) sees almost every startup and a level-1 CPU
 * (30 frames) sees essentially none of them.
 */
export const shield: Behaviour = (ctx) => {
  const { self, targetAction, distance } = ctx.view;
  const { tuning } = ctx;
  if (!canAct(self) || !ctx.view.target) return NOTHING;
  if (distance > THREAT_RANGE) return NOTHING;

  const incomingAttack = isAttacking(targetAction);
  const incomingGrab = isGrabbing(targetAction);
  if (!incomingAttack && !incomingGrab) return NOTHING;

  // A grab beats a shield, so the answer to a grab is to leave the ground for a
  // few frames instead. Only levels that dodge at all attempt it.
  if (incomingGrab && ctx.rolls[ROLL_DODGE] < tuning.dodgeRate) {
    return { score: 620, input: Btn.Down | Btn.Shield };
  }

  if (ctx.rolls[ROLL_SHIELD] >= tuning.shieldRate) return NOTHING;

  // Whether an air dodge would carry the fighter off the stage is recovery
  // judgement, so a CPU whose recovery roll fails forgets it, as it forgets the
  // jump back in `recover` (Task 20c).
  const minded = ctx.rolls[ROLL_RECOVER] < tuning.recoverySkill;

  // A shield that is nearly out of health is worse than no shield: it breaks
  // and hands over 240 frames of free punishment. Roll away instead. In the air
  // that is a directional dodge (Task 20c): not one whose travel leaves the
  // stage, where the neutral dodge below is weighed instead.
  const shieldSpent = self.shieldHealth <= fx(12);
  if (shieldSpent) {
    const away = towardX(ctx.view.dx, 0);
    const dir = away === Btn.Right ? 1 : away === Btn.Left ? -1 : 0;
    const offstage = minded && sideDodgeCarriesOffstage(self, ctx.stage, ctx.airBrake, ctx.airDodge, dir);
    if (dir !== 0 && !offstage) return { score: 600, input: away | Btn.Shield };
  }

  // In the air the shield is a neutral air dodge, and it keeps the drift over
  // the fighter's own dodge length (Task 20c): not one that carries the fighter
  // off the stage.
  if (minded && dodgeCarriesOffstage(self, ctx.stage, ctx.airBrake, airDodgeFrames(ctx.airDodge, 0))) return NOTHING;
  return { score: 600, input: Btn.Shield };
};

/**
 * Take the stage's edge away while the opponent is offstage.
 *
 * The highest-value thing in the game and the last thing a CPU learns, so it is
 * gated hard on `edgeguardSkill`: nothing below level 3 ever does it, and only
 * the top levels leave the stage to do it.
 */
export const edgeguard: Behaviour = (ctx) => {
  const { self, target, dx } = ctx.view;
  const { stage, tuning } = ctx;
  if (!canAct(self) || !target) return NOTHING;
  if (tuning.edgeguardSkill <= 0) return NOTHING;
  if (!isOffstage(target, stage) || isOffstage(self, stage)) return NOTHING;
  if (ctx.rolls[ROLL_EDGEGUARD] >= tuning.edgeguardSkill) return NOTHING;

  const ledge = target.x < 0 ? stage.leftLedge : stage.rightLedge;
  const atLedge = abs(self.x - ledge) < fx(8);

  if (!atLedge) return { score: 500, input: towardX(self.x, ledge) };

  // Off the stage after them, but only for CPUs good enough to get back.
  const chaseOff = tuning.edgeguardSkill > 0.6 && target.y > stage.groundY - fx(24);
  if (chaseOff) {
    const out = towardX(0, dx);
    const swinging = pulse(ctx.view.frame, self.port, 12, 3);
    return { score: 520, input: out | (swinging ? Btn.Attack : 0) };
  }

  // Otherwise hold the ledge's inside edge and cover the get-up.
  const swinging = pulse(ctx.view.frame, self.port, 16, 3);
  return { score: 500, input: towardX(self.x, 0) | (swinging ? Btn.Down | Btn.Attack : 0) };
};

/**
 * Pick a move and throw it.
 *
 * The weighting is the situational one SPEC §6 implies: an aerial when the
 * target is above, a grab when they are shielding, a smash when they are in
 * hitstun at a percent where a smash kills, a tilt otherwise. `moveChoiceSkill`
 * decides how often that reasoning is used at all versus a plain jab — a low
 * level does hit you, it just hits you with the wrong thing.
 *
 * Smash versus tilt is produced the way a human produces it, through the
 * keyboard rules in SPEC §6 rather than by asking for a smash: the engine reads
 * an attack within `SMASH_INPUT_WINDOW` frames of a *fresh* direction press as a
 * smash, so a smash is "flick the stick and hit attack on the same frame" and a
 * tilt is "hold the direction until the window has lapsed, then attack".
 * `framesSinceDirPress` is the fighter's own state, so the CPU can read it
 * without seeing anything a player could not.
 */
export const attack: Behaviour = (ctx) => {
  const { self, target, targetAction, dx, dy, distance, facingTarget } = ctx.view;
  const { tuning } = ctx;
  if (!canAct(self) || !target) return NOTHING;
  if (distance > ctx.meleeReach) return NOTHING;

  const toward = towardX(0, dx);
  if (!facingTarget && self.grounded && toward !== 0) {
    // Turning is an input, not a free action; hold the direction one frame.
    return { score: 380, input: toward };
  }

  const swinging = pulse(ctx.view.frame, self.port, 10, 3);
  const smart = ctx.rolls[ROLL_MOVE] < tuning.moveChoiceSkill;

  if (smart) {
    // Above: an up aerial from a short hop, or an up tilt from the ground.
    if (dy > VERTICAL_REACH) {
      if (self.grounded) {
        const hopping = shortHopPulse(ctx.view.frame, self.port);
        return { score: 430, input: (hopping ? Btn.Jump : 0) | Btn.Up | (swinging ? Btn.Attack : 0) };
      }
      return { score: 430, input: Btn.Up | (swinging ? Btn.Attack : 0) };
    }

    // Shielding: a grab goes straight through it.
    if (isShielding(targetAction) && distance <= GRAB_RANGE) {
      return { score: 460, input: swinging ? Btn.Grab : 0 };
    }

    // Reeling at a killing percent: commit to a smash.
    if (REELING_ACTIONS.includes(targetAction) && target.damage >= fx(80)) {
      return { score: 480, input: smashInput(ctx, toward) };
    }

    // Below and airborne: a down aerial, which is where the meteors live.
    if (dy < -VERTICAL_REACH && !self.grounded) {
      return { score: 420, input: Btn.Down | (swinging ? Btn.Attack : 0) };
    }
  }

  // The default: a tilt if the direction has gone stale, a jab if it has not —
  // never an accidental smash, which is the classic keyboard misfire.
  const stale = self.framesSinceDirPress > SMASH_INPUT_WINDOW;
  return {
    score: 400,
    input: (stale ? toward : 0) | (swinging ? Btn.Attack : 0),
  };
};

/**
 * Flick-and-hit: the two-frame pattern that reads as a smash.
 *
 * When the engine's smash window is already open the attack goes out with the
 * direction on the same frame. When it is not, the direction is released for a
 * frame first, because a direction that has been held for twenty frames cannot
 * produce a fresh press — and without a fresh press the same input is a tilt.
 */
function smashInput(ctx: BehaviourContext, toward: InputFrame): InputFrame {
  const { self } = ctx.view;
  if (toward === 0) return Btn.Attack;
  if (self.framesSinceDirPress <= SMASH_INPUT_WINDOW) return toward | Btn.Attack;
  return pulse(ctx.view.frame, self.port, 2, 1) ? toward | Btn.Attack : 0;
}

/**
 * Change height to match the target: jump to the platform they are on, or drop
 * through the one this fighter is standing on.
 */
export const platformMove: Behaviour = (ctx) => {
  const { self, target, dy } = ctx.view;
  if (!canAct(self) || !target) return NOTHING;
  if (!self.grounded) return NOTHING;

  const aboveGround = self.y > ctx.stage.groundY + fx(4);

  if (dy < -VERTICAL_REACH && aboveGround) {
    // Standing on a soft platform with the target below it: fall through.
    return { score: 260, input: pulse(ctx.view.frame, self.port, 10, 4) ? Btn.Down : 0 };
  }

  if (dy > VERTICAL_REACH) {
    const overhead = ctx.stage.platforms.some(
      (p) => p.y > self.y + fx(4) && abs(p.x - self.x) <= p.halfWidth + fx(10),
    );
    if (!overhead) return NOTHING;
    const jumping = fullHopPulse(ctx.view.frame, self.port);
    return { score: 250, input: (jumping ? Btn.Jump : 0) | towardX(0, ctx.view.dx) };
  }

  return NOTHING;
};

/** Close the distance. The behaviour `aggression` scales directly. */
export const approach: Behaviour = (ctx) => {
  const { self, target, dx, dy, distance } = ctx.view;
  if (!canAct(self) || !target) return NOTHING;
  // The same threshold `attack` swings at, so there is no band of distances
  // where neither behaviour will act — that gap is what let a CPU stand still
  // and punch nothing for the rest of the match.
  if (distance <= ctx.meleeReach) return NOTHING;

  let input = towardX(0, dx);
  // Jumping toward a target well above is the same decision as platformMove,
  // scored lower here so the platform-aware version wins when it applies.
  if (dy > VERTICAL_REACH * 2 && self.grounded && fullHopPulse(ctx.view.frame, self.port)) {
    input |= Btn.Jump;
  }
  return { score: 200 * ctx.tuning.aggression, input };
};

/**
 * Back off: when this fighter is the one at a killing percent, when the target
 * is winding up a smash, or simply because the level is a patient one.
 */
export const retreat: Behaviour = (ctx) => {
  const { self, target, dx, distance } = ctx.view;
  const { stage } = ctx;
  if (!canAct(self) || !target) return NOTHING;

  const losing = self.damage > target.damage + fx(40);
  // A charging smash is only a reason to leave once the CPU has noticed the
  // swing — `targetAction` is the perceived one, so this respects the delay.
  const charging = isAttacking(ctx.view.targetAction) && target.charge > 0 && distance < THREAT_RANGE;
  if (!losing && !charging) return NOTHING;

  // Never retreat over the ledge — that is how a CPU walks off the stage it
  // was trying to survive on.
  const away = towardX(dx, 0);
  const nextX = self.x + (away === Btn.Right ? fx(6) : away === Btn.Left ? -fx(6) : 0);
  if (nextX < stage.leftLedge || nextX > stage.rightLedge) return NOTHING;

  return { score: 190 * (1 - ctx.tuning.aggression), input: away };
};

/** The floor: always available, so `cpuInput` always has an answer. */
export const idle: Behaviour = () => ({ score: 1, input: 0 });

/**
 * Every behaviour, in the order ties break. Earlier wins a tie, which is why
 * the survival and recovery behaviours are listed first: when two scores land
 * equal after jitter, not dying is the better default.
 */
export const BEHAVIOURS: readonly { readonly name: BehaviourName; readonly run: Behaviour }[] = [
  { name: "survive", run: survive },
  { name: "recover", run: recover },
  { name: "shield", run: shield },
  { name: "edgeguard", run: edgeguard },
  { name: "attack", run: attack },
  { name: "platformMove", run: platformMove },
  { name: "approach", run: approach },
  { name: "retreat", run: retreat },
  { name: "idle", run: idle },
];
