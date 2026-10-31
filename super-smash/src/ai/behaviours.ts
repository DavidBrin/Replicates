/**
 * The CPU's repertoire: small behaviours, each of which looks at one delayed
 * view of the world and answers two questions — "does this apply right now, and
 * how much?" and "what would I press?". Plan 5's specials are in `specials.ts`,
 * and the table of all of them, in the order ties break, is `cpu.ts`'s
 * `BEHAVIOURS`.
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
 *    One exception, ruled (R-T18j): a parry places a swing it has already seen
 *    where the swing is now, as it reads the swing's frame (`parry`). What it
 *    can see of the opponent's state comes with the action it has seen: a roll's
 *    or a ledge's intangibility, a respawn's invincibility, only once that action
 *    is noticed (ruling R-T19k, `observe`). The Smash Ball and a Final Smash are
 *    on screen for everybody and are read as they are (`specials.ts`).
 */

import {
  Btn,
  type ActionState,
  type AirDodgeAttributes,
  type FighterDef,
  type FighterState,
  type GameState,
  type Hitbox,
  type InputFrame,
  type MoveAim,
  type MoveDef,
  type MoveSlot,
  type Platform,
  type StageDef,
} from "@/engine/types";
import { cloneFighter } from "@/engine/simulate";
import { advanceFighter, applyMovement, interpretInput, shieldCovers, updateInputTracking, type StateContext } from "@/engine/states";
import { HARD_PLATFORM_DEPTH, integrate, platformCentreX } from "@/engine/physics";
import { WALL_JUMP_WINDOW, WALL_TECH_JUMP_FRAMES } from "@/engine/wallJump";
import { AIR_DODGE_SLIDE_FRAMES, airDodgeCharge, airDodgeFrames, airDodgeOf } from "@/engine/airDodge";
import { smashHoldFrame } from "@/engine/acmd/run";
import { actionFrameOf, capsulesOverlap, deepestReach, hitboxWorldPos, hurtboxCapsule, sweptCapsuleOverlaps, type Capsule } from "@/engine/hitbox";
import { fighterHurtboxes } from "@/engine/acmd/hurtboxes";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import { shieldBubble } from "@/engine/shield";
import {
  AIR_DODGE_SLIDE_DISTANCE,
  AIR_DODGE_SLIDE_END_SPEED,
  AIR_DODGE_SLINGSHOT_DISTANCE,
  AIR_DODGE_SLINGSHOT_FRAMES,
  AIR_DODGE_TECH_FRAMES,
  BUFFER_FRAMES,
  GLANCING_BLOW_DEPTH,
  HITSTUN_CANCEL_AIR_DODGE_FRAME,
  HITSTUN_CANCEL_AIR_DODGE_SPEED,
  LAUNCH_SPEED_DECAY,
  LEDGE_GRAB_BACK_PENALTY,
  LEDGE_GRAB_RANGE_X,
  LEDGE_GRAB_RANGE_Y,
  PERFECT_SHIELD_WINDOW,
  SDI_INPUT_INTERVAL,
  SHIELD_MIN_HOLD,
  SMASH_INPUT_WINDOW,
  BOUNCE_FLOOR_LAUNCH_RATIO,
  TECH_FLOOR_MAX_SPEED,
  TECH_LOCKOUT,
  TECH_WINDOW,
} from "@/engine/constants";
import { ONE, abs, byRatio, fx, magnitude, mul } from "@/engine/fixed";
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
  /**
   * Soft platforms, for `platformMove` and a tech's fall. `x` is where one rests;
   * one that sweeps carries its `motion`, placed on the stage's clock
   * (`platformCentreX`, `GameState.stageFrame`).
   */
  readonly platforms: readonly { readonly x: number; readonly y: number; readonly halfWidth: number; readonly motion?: Platform["motion"] }[];
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
    platforms: soft.map((p) => ({ x: p.x, y: p.y, halfWidth: p.halfWidth, ...(p.motion !== undefined ? { motion: p.motion } : {}) })),
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
  /**
   * Plan 5: the chance it techs one landing, and air-dodges out of hitstun when
   * the cancel opens: one roll per landing, one per opening (ruling R-T18e).
   */
  readonly techSkill: number;
  /** Plan 5: the chance it parries a swing it can time: one roll per swing (rulings R-T18d, R-T18e). */
  readonly parrySkill: number;
  /**
   * Plan 5, Task 19: the chance it uses a special it has the moment for, one roll a
   * threat or an opening (`specials.ts`): a reflect, a counter, a charge, a
   * smash-input special.
   */
  readonly specialSkill: number;
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
 * Held by another fighter, or flown by one's star: a mash is all there is to do (Plan 5,
 * Task 19). `specials.ts`'s mash takes these and a broken shield's stun (`MASHED`, built
 * from this list), and `survive` stays silent in them.
 */
export const HELD_ACTIONS: readonly ActionState[] = ["grabbed", "cargoHeld", "swallowed", "spatStar"];

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

  const noticed = nearest.actionFrame >= reactionFrames;
  // What it can see of the target's state goes with the action it has seen (ruling
  // R-T19k, the Task 19 review's M10): until it notices the action, it believes the
  // target standing or falling (`targetAction`), with no intangibility or
  // invincibility of a roll, a dodge, a ledge or a respawn.
  const rewound = rewind(nearest, reactionFrames);
  const seen = noticed ? rewound : { ...rewound, intangible: 0, invincible: 0 };
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
/**
 * Plan 5: teching and hitstun cancels share one roll; parrying has its own; the
 * specials (`specials.ts`) share one more. The layout is fixed: these nine, then
 * one jitter per behaviour in `BEHAVIOURS` order (`cpu.ts`), drawn whatever is
 * decided.
 */
export const ROLL_TECH = 6;
export const ROLL_PARRY = 7;
export const ROLL_SPECIAL = 8;
export const DECISION_ROLLS = 9;

export interface BehaviourContext {
  /**
   * Read for `frame` and `rules` only — never for the opponent, but where a swing
   * it has seen is now, which a parry reads (ruling R-T18j: `parry`).
   */
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
  /**
   * This fighter's own definition, to run its fall by the engine's own rules
   * (`framesToFloor`; ruling R-T18e), and since Task 19 to use its specials
   * (`specials.ts`): the moveset it fights with now, a Kirby's Copy Ability's
   * neutral special included (`cpuDef`). Null: it neither techs nor uses them.
   */
  readonly fighterDef: FighterDef | null;
  /**
   * Every port's definition, as the match runs it: the parry times a swing off
   * its attacker's move data (ruling R-T18d). Empty: it does not parry.
   */
  readonly matchDefs: readonly (FighterDef | undefined)[];
  /**
   * The bake the match steps with (Plan 4), for the body a swing must reach before
   * it lands on a shield, its hurt capsules (`fighterHurtboxes`; ruling R-T18j).
   * Absent: Plan 2's single capsule, as the engine runs without one.
   */
  readonly bake?: BakeTables;
  /** Pre-drawn randoms in [0,1), one per `ROLL_*` slot. */
  readonly rolls: readonly number[];
}

export interface BehaviourResult {
  readonly score: number;
  readonly input: InputFrame;
  /**
   * A decision the level's own dial has already made (Plan 5, rulings R-T18d and
   * R-T18e: a tech, an escape, a parry, one roll each). It takes the frame
   * outright (`decideCpu`): the dial is the chance, and the score jitter and the
   * fumble would count the level's unreliability twice.
   */
  readonly decided?: boolean;
  /**
   * Buttons kept out of whatever input wins the frame, whoever wins it
   * (`decideCpu`), this behaviour's score or none. `tech` keeps Down out while a
   * fast fall would carry the fighter past its decision frame (ruling R-T18q).
   */
  readonly forbid?: InputFrame;
}

export type Behaviour = (ctx: BehaviourContext) => BehaviourResult;

export type BehaviourName =
  | "tech"
  | "escape"
  | "survive"
  | "mash"
  | "sideRecover"
  | "recover"
  | "holding"
  | "finalSmash"
  | "parry"
  | "reflect"
  | "counter"
  | "shield"
  | "edgeguard"
  | "storeCharge"
  | "smashSpecial"
  | "smashBall"
  | "attack"
  | "platformMove"
  | "approach"
  | "retreat"
  | "centre"
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
  /**
   * The press that starts it with a plan's stick: the up special's (`upBPress`) by
   * default; a sideways recovery's is its side and B (Plan 5, Task 19:
   * `sideRecoveryFromDef`).
   */
  readonly press?: (stick: InputFrame) => InputFrame;
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
 * A fighter's side special as a sideways recovery (Plan 5, Task 19), modelled as
 * `recoveryFromDef` models its up special, or null when its side special carries
 * it nowhere (no `MoveDef.momentum` window with a sideways speed: Samus's
 * Missile, Link's Boomerang). Pressed with its side and B, never Up or Down
 * (`specialSlot`); held toward the ledge through it.
 */
export function sideRecoveryFromDef(def: FighterDef): RecoveryMove | null {
  const move = def.moves.sideB;
  if (move === undefined || !(move.momentum ?? []).some((w) => w.x !== 0)) return null;
  const p = fighterParams(def);
  return {
    def,
    slot: "sideB",
    totalFrames: move.fromAir?.totalFrames ?? move.totalFrames,
    params: p,
    helplessDrift: mul(p.air_speed_x_stable, move.helpless?.airSpeed ?? ONE),
    aim: "none",
    secondAim: 0,
    wallJump: def.attributes.canWallJump,
    press: (stick) => (stick & (Btn.Left | Btn.Right)) | Btn.Special,
  };
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

/** A ghost run's `StateContext`: `step()`'s for one fighter alone on `GHOST_STAGE`, its `frame` set by the caller each step. */
type GhostContext = { -readonly [K in keyof StateContext]: StateContext[K] };

function ghostContext(def: FighterDef, frame: number, f: FighterState): GhostContext {
  return { def, stage: GHOST_STAGE, frame, fighters: [f] };
}

/**
 * One step of a copy of a fighter by `step()`'s own per-frame rules for one fighter
 * alone in the air: the one copy of them that every model run steps (Plan 5, Task 19
 * fix round 1, the review's M7: `upBPath`, `ghostFall`, `aerialStrands`,
 * `freeNextStep`). In `step()`'s order: the input read (`updateInputTracking`,
 * `interpretInput`), the hitstun counted down before the status, as `step()` counts
 * it (the review's M7: two of the four copies had left this out), the airtime, the
 * status (`advanceFighter`), the movement (`applyMovement`) and the move
 * (`integrate`), on the step `ctx.frame` runs. Left out, as no ghost run meets them:
 * a freeze (none starts in hitlag, and nothing hits a ghost), and the bookkeeping
 * `step()` does as a hitstun runs out (`comboHits`, `balloon`), which moves nothing
 * (the fall reads `balloon` only while the hitstun lasts: `hitstunGravityOptions`).
 */
function ghostStep(f: FighterState, input: InputFrame, prev: InputFrame, ctx: GhostContext): void {
  updateInputTracking(f, input, prev);
  const intent = interpretInput(f, input, prev);
  if (f.hitstun > 0) f.hitstun -= 1;
  if (!f.grounded && f.ledge === null) f.airTime += 1;
  advanceFighter(f, intent, ctx);
  applyMovement(f, intent, ctx);
  integrate(f);
}

/** Whether `f` is in the special `r` models: its up special (either version), or its side special for a sideways one. */
function inUpB(f: Pick<FighterState, "action" | "move">, r: RecoveryMove): boolean {
  return f.action === "special" && (f.move === r.slot || (r.slot === "upBAir" && f.move === "upB"));
}

/**
 * Where the up special takes the fighter, frame by frame, for `frames` frames:
 * started on the first of them (Up and Special pressed with `stick`'s first
 * direction), or carried on from where it is if the fighter is already in it,
 * then the helpless fall. Each frame is `step()`'s for one fighter alone in the
 * air, on a copy (`ghostStep`). Not modelled: a hit, a landing, a ledge or a wall on
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
  const ctx = ghostContext(r.def, frame0, f);
  const started = inUpB(f, r);
  // The move frame the next step runs: the press is move frame 1.
  let moveFrame = started ? f.actionFrame + 2 : 1;
  let prev: InputFrame = 0;
  const out: PathPoint[] = [];
  for (let i = 0; i < frames; i++) {
    const dir = moveFrame >= plan.switchAt && plan.switchAt > 0 ? plan.then : plan.first;
    const input = i === 0 && !started ? (r.press ?? upBPress)(dir) : dir;
    ctx.frame = frame0 + i + 1;
    ghostStep(f, input, prev, ctx);
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

/**
 * States the engine reads a press in on the next step (`handleActionable`):
 * standing, walking, dashing, running, braking, crouching, crawling, jumping,
 * falling, and a tumble's fall, which is the fall's (`airMain`; Task 19 fix round 1
 * added the last two, which Task 19 had left out). A wall tech's late frames and a
 * move's air tail read one too, but only a press that ends them. A Special pressed
 * anywhere else waits in the buffer, which only `recover`'s up special may use
 * (`cpu.ts`, `specialPending`). The shield's decision for a threat it could not act
 * on comes on the frame before this is true (`freeNextStep`, ruling R-T19g).
 */
const FREE: readonly ActionState[] = ["stand", "walk", "dashStart", "run", "runBrake", "crouch", "crawl", "jump", "fall", "tumbleFall"];

/** Free to act (`FREE`), out of hitstun and hitlag: a press now is read on the next step. */
export function free(f: FighterState): boolean {
  return canAct(f) && FREE.includes(f.action);
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
  // Held, or stunned standing with its shield broken, there is nothing to DI:
  // those frames are the mash's (Plan 5, Task 19: `specials.ts`).
  if (HELD_ACTIONS.includes(self.action) || (self.action === "shieldBroken" && self.grounded)) return NOTHING;

  const escape = diDirection(self, ctx.stage);
  if (escape === 0) return { score: 1000, input: 0 };

  if (self.hitlag > 0) {
    // SDI is one pulse per fresh direction press, and the engine counts at most
    // one per SDI_INPUT_INTERVAL frames, so a two-on / two-off cycle at that
    // period extracts every pulse on offer and wastes none.
    // A per-opportunity choice (ruling R-T19j): rolled every frame, but a pulse is
    // read only on the frames the engine counts one, so each pulse is its own roll.
    if (ctx.rolls[ROLL_MOVE] >= ctx.tuning.sdiSkill) return { score: 1000, input: 0 };
    const holding = pulse(ctx.view.frame, self.port, SDI_INPUT_INTERVAL, 2);
    return { score: 1000, input: holding ? escape : 0 };
  }

  // A per-opportunity choice (ruling R-T19j): rolled every frame of the reel, but DI
  // is read once, on the frame the launch is let go, so that frame's roll is the DI.
  if (ctx.rolls[ROLL_MOVE] >= ctx.tuning.diSkill) return { score: 1000, input: 0 };
  return { score: 1000, input: escape };
};

/**
 * Tech the landing (Plan 5). A tumbling fighter decides once (ruling R-T18e),
 * with one roll of `techSkill`, on the first frame of the landing's approach that
 * has the floor within `TECH_LEAD` frames and a press that would tech it
 * (`pressTechs`): `TECH_LEAD` frames out on a plain fall, its first frame on one
 * that a launch starts closer, or where a lockout runs out. A failed roll is a
 * missed tech. One roll a tumble for the floor (ruling R-T18h): a missed tech
 * that bounces off the floor is not rolled again (`floorBounced`), so a hard
 * landing techs at `techSkill` too. The stage's side, met in the hitstun, is the
 * other kind of contact, with its own roll (ruling R-T18k): a window press techs
 * it as well (`techWall`; Plan 5, Task 19), and out of hitstun a wall is a plain
 * stop (`techOrBounce`).
 *
 * From `TECH_HOLD` frames out it owns the stick (ruling R-T18i): from the first
 * frame a floor is that close under any stick it could hold (`floorHold`), until
 * it lands, pass or fail, it holds the one its model runs, decided, so nothing
 * else (an approach's drift, a fast fall, a shield's air dodge) carries it away
 * from the frame it decides on or onto a floor it never decided for. The fall is
 * the engine's own per-frame rules (`framesToFloor`) with that stick held, onto
 * the floor it actually comes down on, a soft platform (a sweeping one where it
 * will be) or the stage, its momentum's drift included; so the count falls by
 * exactly one a frame and the frame before can be rebuilt. The press is read on
 * the next step:
 *
 *  - in the hitstun (`tumble`) it opens Plan 3's tech window, `TECH_WINDOW`
 *    frames (SmashWiki "Tech": 11 in Ultimate). It holds the stick toward the
 *    middle, press and hold alike, where that lands it (the hitstun moves the body
 *    whatever the stick says, `kineticReel`, and after it the stick drifts): the
 *    tech rolls inward (`techOrBounce` reads the stick at contact);
 *  - out of it (`tumbleFall`; ruling P5-R20), or where the engine will read it as
 *    the hitstun cancel's or at the hitstun's last frame (ruling R-T18f), it is an
 *    air dodge, which techs a floor it meets in its first `AIR_DODGE_TECH_FRAMES`
 *    frames (SmashWiki "Lucario (SSBU)/Techs"). A neutral one, because it keeps the
 *    fall and comes down into the floor, where a direction held would make it the
 *    directional dodge, which can carry the fighter clear of it (Plan 3, Task 20c).
 *    A press that waits in the buffer to come out on a later step is held neutral
 *    until it does.
 *
 * Scored above `survive`, and decided: the DI has done its work by now, and a
 * missed tech is the punish. The scores here and below only order behaviours.
 */
export const tech: Behaviour = (ctx) => {
  const { self } = ctx.view;
  if (self.action === "airDodge") return dodgeHold(ctx);
  const fall = self.action === "tumbleFall";
  if ((self.action !== "tumble" && !fall) || self.grounded || self.hitlag > 0) return NOTHING;
  // Its press, waiting in the buffer, comes out on the next step as an air dodge
  // with whatever stick is held then (`airMain`): held neutral, it is the neutral one.
  if (fall && shieldWaiting(self, ctx.view.frame)) return { score: 1100, input: 0, decided: true };
  const def = ctx.fighterDef;
  if (def === null) return NOTHING;
  const window = !fall && self.hitstun > 1 && !cancelOpen(self);
  // The stage's side, where the hitstun meets it before any floor: its own roll.
  const floor = floorHold(def, self, ctx.stage, ctx.view.frame, ctx.state.stageFrame);
  const wall = fall ? null : framesToWall(def, self, ctx.stage, ctx.view.frame, TECH_LEAD);
  if (wall !== null && (floor === null || wall < floor.frames)) {
    if (!rollsNow(ctx, self, fall, window, wall)) return NOTHING;
    return { score: 1100, input: window ? Btn.Shield | towardX(self.x, 0) : Btn.Shield, decided: true };
  }
  // Before the hold, a fast fall that would carry it past its decision frame:
  // Down kept out of whatever wins (ruling R-T18q), and nothing else taken.
  if (floor === null) return fall && fastFallsNear(def, self, ctx.stage, ctx.view.frame, ctx.state.stageFrame) ? { score: 0, input: 0, forbid: Btn.Down } : NOTHING;
  const hold: BehaviourResult = { score: 1100, input: floor.stick, decided: true };
  if (floor.frames > TECH_LEAD || floorBounced(def, self)) return hold;
  // A window's press techs no floor met faster than the engine allows: that
  // contact is not the landing the roll is for (ruling R-T18p), the next is.
  if (window && floor.speed > TECH_FLOOR_MAX_SPEED) return hold;
  if (!rollsNow(ctx, self, fall, window, floor.frames)) return hold;
  return { score: 1100, input: window ? Btn.Shield | floor.stick : Btn.Shield, decided: true };
};

/**
 * The stick through a tumble's air dodge (ruling R-T18i: until the landing): its
 * press is the tech's, and it techs a floor it meets in its first
 * `AIR_DODGE_TECH_FRAMES` frames (`tumbleDodge`; `techOrBounce` reads the dodge's
 * frame as the step that meets the floor has counted it, one more a step from
 * this frame's). A neutral dodge keeps the fall's rules, the stick's drift
 * included (`startAirDodge`), so it holds the stick that brings a floor under it
 * in the frames left, as before the press; with none, the dodge is no tech and
 * other behaviours steer it.
 */
function dodgeHold(ctx: BehaviourContext): BehaviourResult {
  const { self } = ctx.view;
  const left = AIR_DODGE_TECH_FRAMES - 1 - self.actionFrame;
  if (!self.combat.tumbleDodge || self.grounded || self.hitlag > 0 || left < 1 || ctx.fighterDef === null) return NOTHING;
  const floor = floorHold(ctx.fighterDef, self, ctx.stage, ctx.view.frame, ctx.state.stageFrame, left);
  return floor === null ? NOTHING : { score: 1100, input: floor.stick, decided: true };
}

/**
 * Whether this frame is the approach's one decision, `frames` from the surface
 * (within `TECH_LEAD`), and its roll passes. Only with a press that would tech
 * it (`pressTechs`). The approach starts where a launch resets the gravity energy
 * (`kineticLaunch`), or on the tumble's first frame (a launch with no freeze, a
 * throw's, runs a frame of its fall on the step that fires it); on any later
 * frame, the frame before was one further from the surface, its count falling by
 * one a frame under the stick `tech` holds, and is asked the same
 * (`pressTechedBefore`).
 */
function rollsNow(ctx: BehaviourContext, self: FighterState, fall: boolean, window: boolean, frames: number): boolean {
  if (!pressTechs(self, window)) return false;
  const starts = !fall && (self.kinetic.gravityY === 0 || self.actionFrame === 0);
  if (!starts && frames + 1 <= TECH_LEAD && pressTechedBefore(self, fall)) return false;
  return ctx.rolls[ROLL_TECH] < ctx.tuning.techSkill;
}

/**
 * UNVERIFIED (CPU judgement, no source): the frames short of the shorter of a
 * tech's two windows (the press's `TECH_WINDOW`, the dodge's
 * `AIR_DODGE_TECH_FRAMES`) the CPU wants the floor by when it decides. Its fall
 * model leaves out the ECB's bottom.
 */
const TECH_MARGIN = 2;

/** The frames from the floor a tech is decided on: inside both windows, by `TECH_MARGIN`. */
export const TECH_LEAD = Math.min(TECH_WINDOW, AIR_DODGE_TECH_FRAMES) - TECH_MARGIN;

/**
 * UNVERIFIED (CPU judgement, no source; ruling R-T18i, "about `TECH_LEAD` + 3"):
 * the frames from a floor at which `tech` takes the stick, a few before it
 * decides, so the drift that brought it there is its own by the decision frame.
 */
export const TECH_HOLD = TECH_LEAD + 3;

/**
 * The stick `tech` holds over a tumble's landing (ruling R-T18i), and the frames
 * to the floor with it held, if a floor is within `horizon` under any of them:
 * in the hitstun toward the middle first (its window press's), then neutral,
 * then away; after it, and through its air dodge, neutral first (the dodge's
 * press is), then toward the middle, then away. Each is the engine's own fall
 * with that stick held from now (`floorContact`), so the one it holds keeps its
 * count falling by one a frame, with the launch's speed as it meets the floor.
 */
export function floorHold(def: FighterDef, self: FighterState, stage: StageView, frame0: number, stageFrame0 = 0, horizon = TECH_HOLD): { readonly stick: InputFrame; readonly frames: number; readonly speed: number } | null {
  const inward = towardX(self.x, 0);
  const sides = inward === Btn.Right ? [Btn.Right, Btn.Left] : [Btn.Left, Btn.Right];
  const sticks = self.action === "tumble" && inward !== 0 ? [inward, 0, inward === Btn.Left ? Btn.Right : Btn.Left] : [0, ...sides];
  for (const stick of sticks) {
    const contact = floorContact(def, self, stage, frame0, horizon, stageFrame0, stick);
    if (contact !== null) return { stick, ...contact };
  }
  return null;
}

/**
 * Whether, in a tumble's fall with no floor within `TECH_HOLD` under any stick it
 * could hold (`floorHold`), a fast fall (Down, pressed fresh) would bring one that
 * near: it would carry the fighter past the frame `tech` decides on, so `tech`
 * keeps Down out of the input until the fall comes that near on its own, and
 * leaves every other button to whatever wins (ruling R-T18q).
 */
function fastFallsNear(def: FighterDef, self: FighterState, stage: StageView, frame0: number, stageFrame0: number): boolean {
  return !self.fastFalling && framesToFloor(def, self, stage, frame0, TECH_HOLD, stageFrame0, Btn.Down, true) !== null;
}

/**
 * Whether this tumble has already met the floor at a speed a press could tech
 * (rulings R-T18h, R-T18p: one tech roll a tumble for the floor, spent on the first
 * contact that can be teched), so a landing after it gets no decision. The CPU keeps
 * no memory, so it reads what meeting the floor leaves on the fighter:
 *
 *  - the gravity energy zeroed there, by a bounce (`kineticReflect`, which also
 *    disarms the launch's speed-up) or a landing. A wall's bounce keeps it, and a
 *    launch from a hit zeroes it too but restarts the tumble (`actionFrame` 0).
 *    - In the hitstun, its speed-up disarmed, the gravity energy is a whole number
 *      of the reel's frames from zero, fewer than the tumble has run (a launch's
 *      own fall, sped up or not, has had at least one a frame since its frame 0).
 *    - After it (`tumbleFall`), the gravity energy is short of the fall speed and
 *      a whole number of the fall's frames from zero, or of a balloon reel's and
 *      then this fall's own: a tumble's own fall reaches the fall speed before its
 *      hitstun runs out (`TUMBLE_HITSTUN` frames at the roster's gravities), or, a
 *      balloon one that stops short (Fox's), is no whole number of them
 *      (`defence.test.ts` pins both), so it was zeroed since, by a bounce or by
 *      lying down and sliding off an edge.
 *  - not a ceiling's (ruling R-T18r): a ceiling's stop zeroes the gravity energy
 *    too, and its bounce keeps that zero (`techOrBounce`), but the stop takes the
 *    launch's rise away (`kineticSetY`) and the bounce sends it down, while a floor
 *    bounce sends it up (`|y|`). So a launch going down, or level with what is left
 *    of it still moving, is a ceiling's, not a floor's;
 *  - the contact's speed, read back: the bounce leaves 0.9 of it (`byRatio`), and
 *    the launch has lost `LAUNCH_SPEED_DECAY` a frame since, the frames the
 *    gravity energy counts. One over `TECH_FLOOR_MAX_SPEED`, which no window's
 *    press techs, spent nothing. A launch decayed to nothing since was a slow one.
 *
 * At the fall speed the frames since are no longer counted, so a bounce that long
 * before the next approach goes unseen and that landing is rolled again; a
 * tumble's fall cut short by a wall's bounce can be taken for one that met a floor;
 * a landing whose press a lockout refused (a shield pressed just before the hit) is
 * not rolled for after its bounce either, though nothing was rolled; a floor met
 * with no rise at all (a level launch) reads as a ceiling's stop, and is rolled
 * again. UNVERIFIED: a ceiling stop whose launch had no sideways part left, or
 * whose launch has decayed to nothing since, reads as a floor met (no stage of the
 * six has a ceiling over a floor). UNVERIFIED (engine): whether a tumble can be
 * teched at all on the landing after a missed tech's bounce (Plan 3's
 * `techOrBounce` lets it; no source says), which this ruling leaves to the engine.
 */
export function floorBounced(def: FighterDef, f: FighterState): boolean {
  const p = fighterParams(def);
  const g = -f.kinetic.gravityY;
  const { damageY } = f.kinetic;
  if (damageY < 0 || (damageY === 0 && f.launchSpeed > 0)) return false;
  const frames = framesSinceFloor(p, f, g);
  return frames !== null && f.launchSpeed + frames * LAUNCH_SPEED_DECAY <= byRatio(TECH_FLOOR_MAX_SPEED, BOUNCE_FLOOR_LAUNCH_RATIO);
}

/** The frames since the gravity energy was zeroed by a floor (`floorBounced`), or null where its count shows none. */
function framesSinceFloor(p: FighterParams, f: FighterState, g: number): number | null {
  if (f.action === "tumbleFall") {
    if (g < 0 || g >= p.air_speed_y_stable) return null;
    if (g % p.air_accel_y === 0) return g / p.air_accel_y;
    // A balloon reel's frames since the floor, then this fall's own, one a frame from its first.
    const reel = g - p.air_accel_y * (f.actionFrame + 1);
    return reel >= 0 && reel % p.damage_fly_top_air_accel_y === 0 ? reel / p.damage_fly_top_air_accel_y + f.actionFrame + 1 : null;
  }
  if (f.kinetic.speedUpFaf !== 0) return null;
  const accel = f.balloon ? p.damage_fly_top_air_accel_y : p.air_accel_y;
  const cap = f.balloon ? p.damage_fly_top_speed_y_stable : p.air_speed_y_stable;
  return g >= 0 && g < cap && g % accel === 0 && g / accel < f.actionFrame ? g / accel : null;
}

/**
 * Whether a press now would tech the floor where nothing else will: not while a
 * window is open, which techs the landing itself (`techOrBounce`); in the
 * window's case, a press the lockout allows (it counts down once more on the step
 * that reads the press, `updateTechInput`); otherwise an air dodge out of a
 * tumble, which ignores the lockout, its dodge not yet spent (ruling P5-R20:
 * `startAirDodge`).
 */
function pressTechs(f: FighterState, window: boolean): boolean {
  if (f.combat.techWindow > 0) return false;
  return window ? f.combat.techLockout <= 1 : !f.airDodged;
}

/**
 * The same, asked of the frame before (one frame younger). A press opens a window
 * and a lockout together and they count down together (`updateTechInput`), so a
 * window that was open then and is shut now leaves the lockout at exactly
 * `TECH_LOCKOUT − TECH_WINDOW`. A tumble's fall was a fall then, or the tumble's
 * last frame, an air dodge either way; a tumble had a hitstun more, so its press
 * was the window's unless the cancel was open (`cancelOpenBefore`), and its
 * lockout one more (so at most 1 only if 0 now).
 */
function pressTechedBefore(f: FighterState, fall: boolean): boolean {
  if (f.combat.techLockout === TECH_LOCKOUT - TECH_WINDOW) return false;
  if (fall || cancelOpenBefore(f)) return !f.airDodged;
  return f.combat.techLockout === 0;
}

/** A shield press of its own still waiting in the buffer for the next step (`peekBuffer`). */
function shieldWaiting(f: FighterState, frame: number): boolean {
  const b = f.bufferedAction;
  return b !== null && b.kind === "shield" && frame + 1 - b.frame <= BUFFER_FRAMES;
}

/**
 * How many steps from now this fighter's fall meets a floor, if it does within
 * `horizon`, or null. The fall is the engine's own: a copy of the fighter run
 * through `step()`'s per-frame rules for one fighter alone in the air, with
 * `stick` held and nothing else pressed (as `upBPath` runs an up special), so
 * with that stick held the count goes down by exactly one a frame (`tech` holds
 * it; ruling R-T18i); `fresh`, pressed now rather than held from before (a fast
 * fall's Down). A floor is the stage between its ledges or a soft platform, met
 * coming down on its span, ends included, as the engine lands a body
 * (`resolveCollision`), a sweeping platform where the stage's clock will have it.
 * Not modelled: the ECB's bottom (the origin lands).
 */
export function framesToFloor(def: FighterDef, self: FighterState, stage: StageView, frame0: number, horizon: number, stageFrame0 = 0, stick: InputFrame = 0, fresh = false): number | null {
  return floorContact(def, self, stage, frame0, horizon, stageFrame0, stick, fresh)?.frames ?? null;
}

/**
 * `framesToFloor`'s fall, and the launch's speed on the step that meets the floor,
 * as the engine reads it there (`launchBefore`, before the collision): a window's
 * press techs no contact faster than `TECH_FLOOR_MAX_SPEED` (`techOrBounce`).
 */
export function floorContact(def: FighterDef, self: FighterState, stage: StageView, frame0: number, horizon: number, stageFrame0 = 0, stick: InputFrame = 0, fresh = false): { readonly frames: number; readonly speed: number } | null {
  // The highest surface it could come down on within `horizon`: one under it, or
  // one no higher than its rise can take it (a soft platform, or the stage from off
  // its side), which a fall from under that height lands on on the way down. Out of
  // reach of the fastest fall those frames allow, there is nothing to run. Gravity
  // and a launch's decay each speed a fall by at most their own whole rate a frame,
  // and a fresh fast fall starts at the fast-fall speed, so the bound needs no
  // rounding room (a launch's speed-up runs faster, so then the fall is run).
  const params = fighterParams(def);
  const top = self.y + Math.max(0, self.vy) * horizon;
  let surface: number | null = top >= stage.groundY ? stage.groundY : null;
  for (const p of stage.platforms) if (p.y <= top && (surface === null || p.y > surface)) surface = p.y;
  if (surface === null) return null;
  if (self.kinetic.speedUpMax <= 0) {
    const accel = params.air_accel_y + LAUNCH_SPEED_DECAY;
    const down = Math.max(0, -self.vy, fresh && (stick & Btn.Down) !== 0 ? params.dive_speed_y : 0);
    const reach = horizon * down + (accel * horizon * (horizon + 1)) / 2;
    if (self.y - surface > reach) return null;
  }
  let speed = 0;
  const frames = ghostFall(def, self, frame0, horizon, (prevX, prevY, f, k) => {
    speed = f.launchSpeed;
    return f.y < prevY && landsOn(f.x, prevY, f.y, stage, stageFrame0 + k);
  }, stick, fresh ? 0 : stick);
  return frames === null ? null : { frames, speed };
}

/**
 * How many steps from now this fighter's fall, run as `framesToFloor` runs it,
 * meets the main stage's side, under its top (Plan 5, Task 19: a wall tech, the
 * Task 18 review's carry), if it does within `horizon`, or null. The side is the
 * ledge's x, from the top down `HARD_PLATFORM_DEPTH`; met from outside it. Not
 * modelled, as there: the ECB's half-width (the origin meets it).
 */
export function framesToWall(def: FighterDef, self: FighterState, stage: StageView, frame0: number, horizon: number): number | null {
  const under = (y: number) => y < stage.groundY && y > stage.groundY - HARD_PLATFORM_DEPTH;
  if (!isOffstage(self, stage) || self.y >= stage.groundY) return null;
  return ghostFall(def, self, frame0, horizon, (prevX, _prevY, f) => {
    const left = prevX < stage.leftLedge && f.x >= stage.leftLedge;
    const right = prevX > stage.rightLedge && f.x <= stage.rightLedge;
    return (left || right) && under(f.y);
  });
}

/**
 * A copy of the fighter run through `step()`'s per-frame rules for one fighter
 * alone in the air (`ghostStep`) with `stick` held and nothing else pressed (as
 * `upBPath` runs an up special), until `meets` accepts a frame, `k` steps on: that `k`, or null
 * within `horizon`. `before` is what was held the frame before now: the stick
 * itself, held from before, or nothing, for a fresh press.
 */
function ghostFall(def: FighterDef, self: FighterState, frame0: number, horizon: number, meets: (prevX: number, prevY: number, f: FighterState, k: number) => boolean, stick: InputFrame = 0, before: InputFrame = stick): number | null {
  const f = cloneFighter(self);
  const ctx = ghostContext(def, frame0, f);
  for (let k = 1; k <= horizon; k++) {
    const prevX = f.x;
    const prevY = f.y;
    ctx.frame = frame0 + k;
    ghostStep(f, stick, k === 1 ? before : stick, ctx);
    if (meets(prevX, prevY, f, k)) return k;
  }
  return null;
}

/**
 * Whether a body moving down from `prevY` to `y` at `x` meets the stage or a soft
 * platform, a sweeping one where the stage's clock has it (`platformCentreX`).
 */
function landsOn(x: number, prevY: number, y: number, stage: StageView, stageFrame: number): boolean {
  const crosses = (surface: number) => prevY >= surface && y <= surface;
  if (x >= stage.leftLedge && x <= stage.rightLedge && crosses(stage.groundY)) return true;
  return stage.platforms.some((p) => abs(x - platformCentreX(p, stageFrame)) <= p.halfWidth && crosses(p.y));
}

/**
 * Whether this fighter, not free to act now (`free`), is after its next step: the last
 * frame of a reel, a landing's lag or a get-up (ruling R-T19g, for `shieldDecides`).
 * Its own fighter is run one step on by the engine's rules (`ghostStep`) with nothing
 * pressed; a freeze holds it where it is (`step()` runs no status in hitlag). A press
 * made on this frame is read on that step, or waits in the buffer for the first free
 * frame (`handOff`, `endStatus`): so too where that step also lands a reel in the air,
 * whose plain landing (`land`, a few frames) the buffer outlasts.
 */
export function freeNextStep(def: FighterDef, self: FighterState, frame0: number): boolean {
  if (free(self) || self.hitlag > 0) return false;
  const f = cloneFighter(self);
  ghostStep(f, 0, 0, ghostContext(def, frame0 + 1, f));
  return free(f);
}

/**
 * Plan 3's hitstun cancel will be open when this frame's press is read: frame 41
 * of the reel, launch speed under 2.5 (`HITSTUN_CANCEL_AIR_DODGE_*`, SmashWiki
 * "Hitstun canceling"), still in hitstun. The engine reads the press on the next
 * step, in its own order (ruling R-T18f): hitstun counted down first
 * (`simulate.ts`), so at hitstun 1 the reel ends and the press waits in the
 * buffer; then the frame, one further into the reel (`advanceFighter` counts it
 * before the status runs); and the launch speed as it is now (it decays later in
 * that step, with the movement).
 */
function cancelOpen(f: FighterState): boolean {
  return f.hitstun > 1 && f.actionFrame + 1 >= HITSTUN_CANCEL_AIR_DODGE_FRAME && f.launchSpeed < HITSTUN_CANCEL_AIR_DODGE_SPEED;
}

/**
 * Whether the cancel was already open for the frame before this one: a frame
 * earlier in the reel and a hitstun more, with the launch an airborne decay
 * faster (`LAUNCH_SPEED_DECAY`; a launch's speed-up, over by frame 41, would
 * bleed more).
 */
function cancelOpenBefore(f: FighterState): boolean {
  return f.actionFrame >= HITSTUN_CANCEL_AIR_DODGE_FRAME && f.launchSpeed + LAUNCH_SPEED_DECAY < HITSTUN_CANCEL_AIR_DODGE_SPEED;
}

/**
 * Air-dodge out of hitstun when Plan 3's hitstun cancel opens: up high to drift
 * free. Decided once, on the frame the cancel opens, with the roll a landing's
 * tech uses (ruling R-T18e), and pressed neutral (Plan 3, Task 20b). A landing
 * already within `TECH_HOLD` is the tech's, which holds the stick there (ruling
 * R-T18i): one roll for it.
 *
 * Not one that carries it off the stage (ruling P5-R21): the dodge keeps the
 * fighter's drift, so `escape` minds the ledge as `shield` does, over its own
 * dodge length (Task 20c); that is recovery judgement, so a CPU whose recovery
 * roll fails forgets it.
 */
export const escape: Behaviour = (ctx) => {
  const { self } = ctx.view;
  if (self.grounded || self.airDodged || self.hitlag > 0 || !cancelOpen(self) || cancelOpenBefore(self)) return NOTHING;
  if (ctx.fighterDef !== null && floorHold(ctx.fighterDef, self, ctx.stage, ctx.view.frame, ctx.state.stageFrame) !== null) return NOTHING;
  if (ctx.rolls[ROLL_TECH] >= ctx.tuning.techSkill) return NOTHING;
  const minded = ctx.rolls[ROLL_RECOVER] < ctx.tuning.recoverySkill;
  if (minded && dodgeCarriesOffstage(self, ctx.stage, ctx.airBrake, airDodgeFrames(ctx.airDodge, 0))) return NOTHING;
  return { score: 1050, input: Btn.Shield, decided: true };
};

/**
 * The drop frame a parrying CPU wants a swing's first box to land on: the middle
 * of the drop's parrying frames, `PERFECT_SHIELD_WINDOW` of them (5; Plan 3,
 * `isParrying`), or sooner when the swing is first seen closer than that.
 * UNVERIFIED (CPU judgement, no source).
 */
export const PARRY_AIM = Math.trunc((PERFECT_SHIELD_WINDOW - 1) / 2);

/**
 * The `actionFrame` a fighter's swing lands its first box on, from its move data
 * (`MoveDef.hitboxes`: for a move its script runs, the script's own frames,
 * `scriptHitboxTable`), or null where that cannot be told: no data, no box of its
 * own that strikes (`strikes`: a projectile's flight the CPU does not time, and a
 * catch or a windbox lands no hit to parry), or a smash whose
 * charge is still to come or under way (its hold frame waits on the button;
 * `smashHoldFrame`, `CombatState.smashLetGo`). Knowing a move's startup is a
 * player's knowledge, not an input read; the reaction delay still decides when
 * the swing is seen.
 */
export function swingHitFrame(def: FighterDef | undefined, f: Pick<FighterState, "move" | "actionFrame" | "combat">): number | null {
  if (def === undefined || f.move === null) return null;
  const move = def.moves[f.move];
  if (move === undefined) return null;
  let first = -1;
  for (const hb of move.hitboxes) if (strikes(hb) && (first < 0 || hb.startFrame < first)) first = hb.startFrame;
  if (first < 0) return null;
  if (move.chargeable === true) {
    const hold = smashHoldFrame(def, f);
    if (f.actionFrame < hold || (f.actionFrame === hold && !f.combat.smashLetGo)) return null;
  }
  return actionFrameOf(first);
}

/** A box that lands a hit on a shield: not a catch (a grab goes through one) or a windbox (a push). */
function strikes(hb: Hitbox): boolean {
  return hb.grabbing !== true && hb.windbox !== true;
}

/** A shield the engine will drop on the next step: up, out of shieldstun and past `SHIELD_MIN_HOLD` (`STATUS_GUARD`). */
function canDropShield(f: FighterState): boolean {
  return f.action === "shield" && f.hitstun === 0 && f.actionFrame + 1 >= SHIELD_MIN_HOLD;
}

/**
 * Whether the swing's first live boxes land on this fighter's shield as the
 * engine lands a hit (ruling R-T18j), with this fighter `lands` frames into the
 * drop the parry starts. The swing's boxes reach where it will be when they land
 * (`at`: ruling R-T18m), swept, as the engine sweeps a box (`gatherHitboxes`), from
 * where the step that lands them starts (`was`); the side they come from is judged
 * from where it is now (`swing`, not the view's rewound place; ruling R-T18j). The
 * engine takes, a source and a part, the lowest-id box that reaches the body (`resolveHits`' `reachesBody`: a hurt capsule, the bake's when
 * the match runs one, `fighterHurtboxes`, deeper than a graze or onto a shield),
 * and that box lands on the shield only from the side it covers (`hitReachesShield`:
 * `shieldCovers` at the box's nearest point) and inside its bubble (`shieldBubble`).
 * Each part's box must, or that part hits the body. A box live only on the ground
 * or in the air, for its owner or its target (`whileGrounded`, `situation`), counts
 * only there; a Final Smash's box no shield takes; and nothing lands on a body
 * intangible or invincible when the hit comes, which no shield then meets.
 */
function landsOnShield(def: FighterDef, swing: FighterState, was: FighterState, at: FighterState, self: FighterState, selfDef: FighterDef, lands: number, frame: number, bake: BakeTables | undefined): boolean {
  if (self.intangible > lands + 1 || self.invincible > lands + 1) return false;
  const move = swing.move === null ? undefined : def.moves[swing.move];
  if (move === undefined || move.final !== undefined) return false;
  const live = move.hitboxes.filter(strikes);
  if (live.length === 0) return false;
  const first = Math.min(...live.map((hb) => hb.startFrame));
  // Hits resolve after the status runs, so the step that lands it has the drop `lands` frames in.
  const drop: FighterState = { ...self, action: "shieldRelease", actionFrame: lands };
  const body = (bake === undefined ? null : fighterHurtboxes(selfDef, drop, frame + lands + 1, bake)) ?? [hurtboxCapsule(self, selfDef.attributes)];
  const bubble = shieldBubble(self, selfDef);
  const boxes = live
    .filter((hb) => hb.startFrame === first && (hb.whileGrounded === undefined || hb.whileGrounded === swing.grounded))
    .filter((hb) => !((hb.situation === "ground" && !self.grounded) || (hb.situation === "air" && self.grounded)))
    .sort((a, b) => a.id - b.id);
  const parts: number[] = [];
  let shielded = 0;
  for (const hb of boxes) {
    const part = hb.part ?? 0;
    if (parts.includes(part)) continue;
    const box = boxCapsule(at, hb);
    const from = hitboxWorldPos(was.x, was.y, was.facing, hb);
    const dx = box.x2 - box.x1;
    const dy = box.y2 - box.y1;
    if (!body.some((h) => sweptCapsuleOverlaps(from.x, from.y, box.x1, box.y1, dx, dy, box.r, h))) continue;
    const side = boxCapsule(swing, hb);
    const nearest = Math.min(Math.max(self.x, Math.min(side.x1, side.x2)), Math.max(side.x1, side.x2));
    const onShield = shieldCovers(drop, nearest) && capsulesOverlap(box, bubble);
    // A graze of the body off the shield is no hit, and passes the pick on.
    if (!onShield && deepestReach(from.x, from.y, box.x1, box.y1, dx, dy, box.r, body).depth < GLANCING_BLOW_DEPTH) continue;
    parts.push(part);
    if (onShield) shielded++;
  }
  return parts.length > 0 && shielded === parts.length;
}

/** A hitbox as the capsule it covers where its fighter stands, facing its way: its far end only with both of its coordinates, as the engine places it (`gatherHitboxes`). */
function boxCapsule(f: Pick<FighterState, "x" | "y" | "facing">, hb: Hitbox): Capsule {
  const near = hitboxWorldPos(f.x, f.y, f.facing, hb);
  const far = hb.x2 === undefined || hb.y2 === undefined ? near : hitboxWorldPos(f.x, f.y, f.facing, { x: hb.x2, y: hb.y2 });
  return { x1: near.x, y1: near.y, x2: far.x, y2: far.y, r: hb.radius };
}

/**
 * Could the parry have been decided the frame before (one frame younger)? A
 * droppable shield then (its frame one less), the swing seen, a frame into it,
 * its hit a frame further on and inside `PARRY_AIM`, and its timing known then: a
 * smash's charge decided (`swingHitFrame`). One let go uncharged showed at its
 * hold frame let go; one released from a charge (it keeps its `charge`) was still
 * charging there. And its first boxes landing on the shield as they did then: the
 * swing one frame back on its velocity, as the shield rebuilds a threat
 * (`threatBefore`), its side judged from there, and its boxes where it will be
 * when they land (`was` to `at`, the same places from then as from now).
 */
function couldParryBefore(def: FighterDef, self: FighterState, swing: FighterState, was: FighterState, at: FighterState, selfDef: FighterDef, age: number, lands: number, frame: number, bake: BakeTables | undefined): boolean {
  if (self.actionFrame < SHIELD_MIN_HOLD || age < 1 || swing.actionFrame < 1 || lands + 1 > PARRY_AIM) return false;
  const move = swing.move === null ? undefined : def.moves[swing.move];
  if (move?.chargeable === true) {
    const hold = smashHoldFrame(def, swing);
    const before = swing.actionFrame - 1;
    if (before < hold || (before === hold && (swing.charge > 0 || !swing.combat.smashLetGo))) return false;
  }
  const then: FighterState = { ...swing, x: swing.x - swing.vx, y: swing.y - swing.vy, actionFrame: swing.actionFrame - 1 };
  return landsOnShield(def, then, was, at, self, selfDef, lands + 1, frame - 1, bake);
}

/**
 * Parry (Plan 5; ruling R-T18d): shielding, it sees a swing within reach and
 * lets go so the swing's first box lands inside the drop's parrying frames —
 * the perfect shield is on release (SmashWiki "Perfect shield": "a shield drop
 * ... as the hit lands"). Timed off the swing's move data (`swingHitFrame`):
 * the release is read on the next step, which is the drop's frame 0, so the hit
 * lands on drop frame `first − (actionFrame + 1)`. It decides once a swing, on
 * the first frame that lands it on `PARRY_AIM` or sooner, from a shield the
 * engine can drop, at a swing whose first boxes land on its shield as the engine
 * lands a hit (`landsOnShield`; ruling R-T18j); a failed roll keeps the shield up
 * (`shield` holds it through the swing). Not a projectile.
 *
 * Where the swing is, it reads from the swing as it is now (ruling R-T18j), not
 * the view's place rewound along its velocity: the swing's timing is read off
 * its own frame already, and a dash attack seen where it was crossed a shield up
 * that its rewound place had in front. Its boxes reach from where its own
 * momentum carries it by the step they land on (ruling R-T18m): its place now
 * carried on by its velocity now, `lands + 1` steps, and swept from `lands` steps
 * on, where that step starts, as the engine sweeps every box (`gatherHitboxes`).
 * The golden's Fox forward smash (re-review 2) slid him on past a reach his place
 * now had; carried in, a swing out of reach now lands. Not modelled: what the
 * ground's friction or the air's drift takes off the velocity on the way (it is
 * held, so a sliding swing is placed a little past where it lands); a move's own
 * motion changing it (Pikachu's Quick Attack, still before its dash, is carried at
 * its creep); and the side, which the engine judges where the box lands, so a
 * swing carried across the shield by then is taken for one in front of it.
 */
export const parry: Behaviour = (ctx) => {
  const { self, target, targetAction, targetActionAge, distance } = ctx.view;
  if (target === null || !isAttacking(targetAction) || targetActionAge < 0 || distance > THREAT_RANGE) return NOTHING;
  const selfDef = ctx.fighterDef;
  if (!canDropShield(self) || selfDef === null) return NOTHING;
  const def = ctx.matchDefs[target.port];
  const hit = swingHitFrame(def, target);
  if (hit === null || def === undefined) return NOTHING;
  const lands = hit - (target.actionFrame + 1);
  if (lands < 0 || lands > PARRY_AIM) return NOTHING;
  const swing = ctx.state.fighters[target.port];
  const was: FighterState = { ...swing, x: swing.x + swing.vx * lands, y: swing.y + swing.vy * lands };
  const at: FighterState = { ...swing, x: swing.x + swing.vx * (lands + 1), y: swing.y + swing.vy * (lands + 1) };
  if (!landsOnShield(def, swing, was, at, self, selfDef, lands, ctx.view.frame, ctx.bake)) return NOTHING;
  if (couldParryBefore(def, self, swing, was, at, selfDef, targetActionAge, lands, ctx.view.frame, ctx.bake)) return NOTHING;
  if (ctx.rolls[ROLL_PARRY] >= ctx.tuning.parrySkill) return NOTHING;
  return { score: 650, input: 0, decided: true };
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

  // A wall tech's first frames (Plan 5, Task 10; the Task 10 review's carry): a
  // jump input then, the button or Up held, kicks off the wall as a wall tech
  // jump (`tryWallTechJump`), which rises and spends no jump. Below the ledge
  // that is height the fighter needs, so it holds jump; anywhere else it holds
  // neither jump nor Up, which another behaviour's Up would turn into one. The
  // press is read on the next step, one frame further into the tech
  // (`advanceFighter`). Recovery judgement, so a failed roll forgets it, as the
  // jump back is forgotten below.
  if (self.action === "techWall" && self.actionFrame < WALL_TECH_JUMP_FRAMES) {
    const helps = self.y < stage.groundY && ctx.rolls[ROLL_RECOVER] < tuning.recoverySkill;
    return { score: 950, input: helps ? Btn.Jump : 0 };
  }

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
  // the helpless drift above, it is steering, not the button. Decided (Task 19):
  // the up special's stick was chosen when it was pressed, and a level's fumble
  // dropping it on an aim frame threw the move away (the Task 13b sweep's level-7
  // self-destruct).
  const nearer = self.x < 0 ? stage.leftLedge : stage.rightLedge;
  const ledgeFree = !ledgeHeldInOption(ctx, nearer);
  if (r !== null && inUpB(self, r)) {
    if (self.grounded || (!offstage && !belowStage)) return { score: 950, input: 0, decided: true };
    const toward = nearer > self.x ? 1 : -1;
    const plan = upBPlan(self, nearer, stage, r, ctx.view.frame, ledgeFree) ?? upBSticks(r, toward)[0];
    return { score: 950, input: upBStickNow(plan, self, r), decided: true };
  }

  if (self.grounded || (!offstage && !belowStage)) return NOTHING;

  const nearerLedge = nearer;
  const drift = towardX(self.x, nearerLedge);

  // The level-1 self-destruct, made explicit rather than emergent: it drifts
  // back but forgets the button, runs out of altitude and dies. At level 9 the
  // roll never fails. A per-frame reaction delay (ruling R-T19j): each frame off the
  // stage it may forget, so a low level acts late, by when the stage is out of reach.
  if (ctx.rolls[ROLL_RECOVER] >= tuning.recoverySkill) {
    return { score: 900, input: drift };
  }

  // A wall jump first, where the fighter can make one: touching the stage's wall
  // below the ledge, falling, it presses away from the wall (Plan 5, Task 13b; the
  // Task 10 review). It gains height and costs no jump, and special fall refuses
  // one (SmashWiki "Helpless", https://www.ssbwiki.com/Helpless: "unable to take
  // any action"), so it has to come before the up special.
  // Only from a jump or a fall, where the engine tries one (`airMain`; Task 19: in
  // an aerial the press away did nothing and held off the up special's, which
  // then ran out of the buffer).
  const side = self.combat.wallSide;
  const canKick = self.action === "jump" || self.action === "fall";
  if (r !== null && r.wallJump && canKick && side !== 0 && self.combat.wallFrames <= WALL_JUMP_WINDOW && self.vy <= 0 && self.y < stage.groundY) {
    return { score: 950, input: side < 0 ? Btn.Right : Btn.Left };
  }

  // ...and close to the wall under the ledge, it drifts into it to kick off it
  // rather than spend the up special, unless waiting is no longer safe.
  const underLedge = self.y < stage.groundY - fx(4) && self.y > stage.groundY - HARD_PLATFORM_DEPTH;
  if (r !== null && r.wallJump && canKick && underLedge && abs(self.x - nearerLedge) <= WALL_SEEK_RANGE && !upBNowOrNever(self, stage, r, ctx.view.frame)) {
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
    // (Plan 5, Task 13b: `upBPlan`), and pressed with it as the move starts. A
    // ledge held in a ledge option is no grab (Task 19: `ledgeHeldInOption`).
    const plan = r === null ? null : upBPlan(self, nearerLedge, stage, r, ctx.view.frame, ledgeFree);
    if (r !== null && plan === null) {
      // No stick gets it back yet. Waiting is safe until it is now or never; and
      // with its midair jump still there, it jumps first, whatever (Task 19, the
      // Task 13b review's M-11: up specials spent now or never with the jump unused).
      if (!outOfJumps) {
        // UNVERIFIED (CPU judgement): now or never, a jump pressed every other frame.
        const now = upBNowOrNever(self, stage, r, ctx.view.frame) ? pulse(ctx.view.frame, self.port, 2, 1) : jumping;
        return { score: 950, input: drift | (now ? Btn.Jump : 0) };
      }
      // Still rising (a jump just spent): every frame up is height the up special
      // starts from, and it sets its own launch when it comes out, so it waits for
      // the top (Task 19: the sweep's up specials spent three frames into the jump
      // before them, the jump's rise thrown away).
      if (self.vy > 0 || !upBNowOrNever(self, stage, r, ctx.view.frame)) return { score: 950, input: drift };
    }
    // Decided: every frame up to the one the special comes out holds Up and never
    // Down (ruling R-T13b-c), so whichever frame the press lands on, or a buffered
    // one fires on, reads as the up special and not a side or neutral one. A held
    // Up turns into a tap jump five frames on, which takes the buffer from a
    // Special pressed during an aerial (Task 19, the Task 13b fix round 1's
    // concern): it presses again on the first frame Special is up after that.
    const b = self.bufferedAction;
    const displaced = b !== null && b.kind === "jump" && ctx.view.frame + 1 - b.frame <= BUFFER_FRAMES;
    const firing = displaced ? !pulse(ctx.view.frame - 1, self.port, 6, 3) : pulse(ctx.view.frame, self.port, 6, 3);
    const stick = plan === null ? drift : upBStickNow(plan, self, r!);
    return { score: 950, input: firing ? upBPress(stick) : upBHold(stick) };
  }

  return { score: 900, input: drift | (jumping ? Btn.Jump : 0) };
};

/**
 * UNVERIFIED (CPU judgement): within this of a ledge, or past one, an aerial is
 * checked for a way back before it is pressed (`aerialStrands`). The Task 13b
 * re-review counted the self-destructs out of aerials begun within 30 of the ledge.
 */
const EDGE_AERIAL_RANGE = fx(30);

/** The actions an Attack press starts or buffers an aerial from, in the air. */
const AERIAL_FROM: readonly ActionState[] = ["jump", "fall", "attack"];

/**
 * Would `input`, pressed now, start an aerial (or buffer one in an aerial under
 * way) that leaves the fighter no way back (Plan 5, Task 19: the Task 13b
 * re-review's offstage aerials from the edge, the main lever on its
 * self-destructs; M-11's long offstage aerials with no plan back)? Only near a
 * ledge or past one. The aerial is run by the engine's own rules on a copy
 * (`ghostStep`), as `upBPath` runs an up special: the press, then the same stick held, until the
 * aerial is over. It is safe if the copy comes down on the stage on the way, or
 * after it is back over the stage above its top, or can still get back: its up
 * special has a plan from there (`upBPlan`), or its midair jump does and the up
 * special has one from the jump's top.
 */
export function aerialStrands(ctx: BehaviourContext, input: InputFrame): boolean {
  const { self } = ctx.view;
  const { stage } = ctx;
  if ((input & Btn.Attack) === 0 || self.grounded || !AERIAL_FROM.includes(self.action)) return false;
  if (ctx.recovery === null || ctx.fighterDef === null) return false;
  const nearEdge = isOffstage(self, stage) || abs(self.x - stage.leftLedge) <= EDGE_AERIAL_RANGE || abs(self.x - stage.rightLedge) <= EDGE_AERIAL_RANGE;
  if (!nearEdge) return false;
  const def = ctx.fighterDef;
  const r = ctx.recovery;
  const f = cloneFighter(self);
  const gctx = ghostContext(def, ctx.view.frame, f);
  const stick = input & (Btn.Left | Btn.Right | Btn.Up | Btn.Down);
  let prev: InputFrame = 0;
  let begun = false;
  for (let k = 1; k <= AERIAL_LOOKAHEAD_FRAMES; k++) {
    const prevY = f.y;
    const now = k === 1 ? input : stick;
    gctx.frame = ctx.view.frame + k;
    ghostStep(f, now, prev, gctx);
    prev = now;
    if (f.y < prevY && prevY >= stage.groundY && f.y <= stage.groundY && f.x >= stage.leftLedge && f.x <= stage.rightLedge) return false;
    if (f.action === "attack") begun = true;
    else if (begun) break;
  }
  if (!isOffstage(f, stage) && f.y >= stage.groundY) return false;
  const ledge = f.x < 0 ? stage.leftLedge : stage.rightLedge;
  if (upBPlan(f, ledge, stage, r, gctx.frame) !== null) return false;
  if (f.jumpsUsed >= ctx.jumps) return true;
  // Its midair jump, then the up special from the jump's top.
  const j = cloneFighter(f);
  const jctx = ghostContext(def, gctx.frame, j);
  const home = towardX(j.x, ledge);
  let jprev: InputFrame = 0;
  for (let k = 1; k <= AERIAL_LOOKAHEAD_FRAMES; k++) {
    const now = (k === 1 ? Btn.Jump : 0) | home;
    jctx.frame = gctx.frame + k;
    ghostStep(j, now, jprev, jctx);
    jprev = now;
    if (k > 1 && j.vy <= 0) break;
  }
  return upBPlan(j, ledge, stage, r, jctx.frame) === null && !(j.y >= stage.groundY && !isOffstage(j, stage));
}

/** UNVERIFIED (CPU judgement): the most frames an aerial, or a jump's rise, is run for (`aerialStrands`). */
const AERIAL_LOOKAHEAD_FRAMES = 120;

/** The ledge options: a fighter in one keeps its ledge until the option has left it (`findLedgeGrab`). */
const LEDGE_OPTIONS: readonly ActionState[] = ["ledgeGetUp", "ledgeAttack", "ledgeRoll", "ledgeJump"];

/**
 * Whether the opponent holds the ledge at `ledgeX` in a ledge option, as the CPU
 * sees it (Plan 5, Task 19): `findLedgeGrab` refuses that ledge to anybody else
 * until the option has left it. One hanging there is trumped off by a grab, so a
 * hang is no hold.
 */
function ledgeHeldInOption(ctx: BehaviourContext, ledgeX: number): boolean {
  const t = ctx.view.target;
  return t !== null && t.ledge !== null && LEDGE_OPTIONS.includes(ctx.view.targetAction) && t.x < 0 === ledgeX < 0;
}

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
 *
 * Task 19: `ledgeFree` false is a ledge somebody holds in a ledge option, which
 * `findLedgeGrab` refuses: then only coming down on the stage gets it back. And
 * whether the path on the way passes through the main stage's solid body, under
 * its top (`throughWall`): the engine's stage stops a body there, so a line that
 * does is one the model cannot vouch for (`upBPlan` takes another where one gets
 * back; the Task 13b re-review's Fox at f2681 re-planned into one).
 */
export function upBReach(
  self: FighterState,
  ledge: number,
  stage: StageView,
  r: RecoveryMove,
  stick: UpBStick | InputFrame = 0,
  frame0 = 0,
  ledgeFree = true,
): { readonly reached: boolean; readonly throughWall: boolean } {
  const toward = ledge > self.x ? 1 : -1;
  let prevY = self.y;
  let reached = false;
  let throughWall = false;
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
    if (ledgeFree && p.vy <= 0 && past <= 0 && -past <= range && drop >= 0 && drop <= LEDGE_GRAB_RANGE_Y) return (reached = true);
    if (onStage && y < stage.groundY && y > stage.groundY - HARD_PLATFORM_DEPTH) throughWall = true;
    prevY = y;
    return p.helpless && drop > LEDGE_GRAB_RANGE_Y;
  });
  return { reached, throughWall };
}

/** Whether the up special with `stick` gets the fighter back (`upBReach`). */
export function upBInReach(self: FighterState, ledge: number, stage: StageView, r: RecoveryMove, stick: UpBStick | InputFrame = 0, frame0 = 0, ledgeFree = true): boolean {
  return upBReach(self, ledge, stage, r, stick, frame0, ledgeFree).reached;
}

/**
 * The first stick, in `upBSticks`' order, with which the up special gets the
 * fighter back from here, or null. Used before the move, to decide to spend it,
 * and during it, to hold the stick that keeps it on course. A line the stage's
 * wall does not block comes before one it does (`upBReach`'s `throughWall`; Plan
 * 5, Task 19), so the plan in the move is the plan it was pressed with, not a
 * diagonal into the wall.
 */
export function upBPlan(self: FighterState, ledge: number, stage: StageView, r: RecoveryMove, frame0 = 0, ledgeFree = true): UpBStick | null {
  const toward = ledge > self.x ? 1 : -1;
  let blocked: UpBStick | null = null;
  for (const plan of upBSticks(r, toward)) {
    const reach = upBReach(self, ledge, stage, r, plan, frame0, ledgeFree);
    if (!reach.reached) continue;
    if (!reach.throughWall) return plan;
    blocked ??= plan;
  }
  return blocked;
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
 *
 * One decision a threat (Plan 5, Task 19; ruling R-T18g, as R-T18e made the tech
 * one a landing): the shield rolls its dial once a swing or a grab in range, on the
 * frame `shieldDecides` gives it (the first frame it sees it, or, seen while it
 * could not act, the last frame of what held it: a reel, a landing's lag, a get-up;
 * ruling R-T19g), and on no other. A
 * shield it raised it holds while the swing it saw goes on, whatever the roll:
 * rolling every frame let go of a held shield mid-swing (against Donkey Kong's
 * smash, levels 6-8 were hit in that drop 283, 294 and 107 times in 300); a shield
 * nearly spent is let go to roll away instead (the Task 19 review's M1). The parry
 * (`parry`, decided, before this in `BEHAVIOURS`) is the one deliberate drop, and
 * it is no new decision here: the swing was seen before the drop began.
 */
export const shield: Behaviour = (ctx) => {
  const { self, targetAction } = ctx.view;
  const { tuning } = ctx;
  if (ctx.view.target === null || !threatNow(ctx)) return NOTHING;

  const incomingAttack = isAttacking(targetAction);
  const incomingGrab = isGrabbing(targetAction);

  // Decided over the stage (the dial is the chance: no jitter or fumble undoes it,
  // the up special's steering and the tech's press likewise); off it or below it,
  // recovering comes first and the shield is only scored. UNVERIFIED (CPU
  // judgement): "over the stage" reaches 4 under its top.
  const decided = !isOffstage(self, ctx.stage) && self.y >= ctx.stage.groundY - fx(4);

  // Whether a dodge would carry the fighter off the stage is recovery judgement, so
  // a CPU whose recovery roll fails forgets it, as it forgets the jump back in
  // `recover` (Task 20c).
  const minded = ctx.rolls[ROLL_RECOVER] < tuning.recoverySkill;

  // Up already, against the swing it was raised for: held through it, unless it is
  // nearly spent, when it rolls away (the Task 19 review's M1: a spent shield held).
  if (incomingAttack && canAct(self) && isShielding(self.action)) {
    return (shieldSpent(self) ? rollAway(ctx, minded, decided) : null) ?? { score: 600, input: Btn.Shield, decided };
  }
  if (!shieldDecides(ctx)) return NOTHING;

  // A grab beats a shield, so the answer to a grab is to leave the ground for a
  // few frames instead. Only levels that dodge at all attempt it.
  if (incomingGrab && ctx.rolls[ROLL_DODGE] < tuning.dodgeRate) {
    return { score: 620, input: Btn.Down | Btn.Shield, decided };
  }

  if (!incomingAttack || ctx.rolls[ROLL_SHIELD] >= tuning.shieldRate) return NOTHING;

  // A shield that is nearly out of health is worse than no shield: it breaks
  // and hands over 240 frames of free punishment. Roll away instead.
  if (shieldSpent(self)) {
    const away = rollAway(ctx, minded, decided);
    if (away !== null) return away;
  }

  // In the air the shield is a neutral air dodge, and it keeps the drift over
  // the fighter's own dodge length (Task 20c): not one that carries the fighter
  // off the stage.
  if (minded && dodgeCarriesOffstage(self, ctx.stage, ctx.airBrake, airDodgeFrames(ctx.airDodge, 0))) return NOTHING;
  return { score: 600, input: Btn.Shield, decided };
};

/** A shield so near out of health that holding it is worse than none: one hit more breaks it. */
function shieldSpent(f: FighterState): boolean {
  return f.shieldHealth <= fx(12);
}

/**
 * Roll away from the threat, for a spent shield: away and shield. In the air that is
 * a directional dodge (Task 20c): not one whose travel leaves the stage, where the
 * shield's neutral dodge is weighed instead (null).
 */
function rollAway(ctx: BehaviourContext, minded: boolean, decided: boolean): BehaviourResult | null {
  const away = towardX(ctx.view.dx, 0);
  const dir = away === Btn.Right ? 1 : away === Btn.Left ? -1 : 0;
  const offstage = minded && sideDodgeCarriesOffstage(ctx.view.self, ctx.stage, ctx.airBrake, ctx.airDodge, dir);
  return dir !== 0 && !offstage ? { score: 600, input: away | Btn.Shield, decided } : null;
}

/**
 * Where the fighter cannot act on a threat it sees (ruling R-T19g): a reel, lying
 * down, held, helpless or frozen (`canAct`), or one of the lags it waits out, a
 * landing's (its plain landing, an aerial's landing lag, a special's landing) and a
 * get-up's, from lying down or from a ledge. A shield press made in one only waits
 * in the buffer, and from a long one runs out before it frees the fighter. Its own
 * move (an attack, a special, a jump's squat, a roll, a shield's drop) is not one of
 * them: it chose that with the threat in view, so the shield decides as it first
 * sees the threat, its press waiting in the buffer for the move's end, as before.
 * (Task 19 fix round 1's sweep: deciding those at the move's end instead, as
 * `free` alone would have, had the CPU air-dodge after nearly every aerial, and its
 * self-destructs rose from 96 to 124 over twelve sweeps.)
 */
const WAITS_OUT: readonly ActionState[] = ["land", "landingLag", "specialLanding", "getUp", "ledgeGetUp"];

function cannotAct(f: FighterState): boolean {
  return !canAct(f) || WAITS_OUT.includes(f.action);
}

/**
 * The one frame a threat is decided on (rulings R-T18g, R-T19g). Where it can act
 * (`cannotAct`), the first frame the threat is seen in range. Where it cannot, the
 * last frame of the action it is in, the frame before its first free one
 * (`freeNextStep`, by `free`, the specials' notion), for a threat first seen during
 * that action (`targetActionAge`, counted from the swing's first sight, no more than
 * the action's own frames): the press is read as the fighter comes free, or waits in
 * the buffer for its first free frame. That action began no later than the threat
 * was first seen, so the fighter could not act on it then nor since: a threat it
 * could act on at first sight it never decides again (a shield raised then and
 * dropped by the parry included, since the drop began after).
 *
 * The CPU keeps no memory of its own actions, so two threats get no decision: one
 * first seen in an action that leads into another it cannot act in (lying down, then
 * a get-up), and one seen further off before the action began that came into range
 * during it.
 */
function shieldDecides(ctx: BehaviourContext): boolean {
  const { self, targetActionAge } = ctx.view;
  if (!cannotAct(self)) return !threatBefore(ctx);
  return ctx.fighterDef !== null && targetActionAge <= self.actionFrame && freeNextStep(ctx.fighterDef, self, ctx.view.frame);
}

/** A swing or a grab seen within `THREAT_RANGE`: what the shield decides on. */
function threatNow(ctx: BehaviourContext): boolean {
  const { targetAction, distance } = ctx.view;
  return (isAttacking(targetAction) || isGrabbing(targetAction)) && distance <= THREAT_RANGE;
}

/**
 * Was the same threat already there the frame before (one frame younger)? Seen
 * then (it had been visible a frame already) and in range then: the target one
 * frame further back on its velocity (`rewind`, as `observe` sees it), this
 * fighter one frame back on its own.
 */
function threatBefore(ctx: BehaviourContext): boolean {
  const { self, target, targetActionAge } = ctx.view;
  if (target === null || targetActionAge < 1) return false;
  const dx = target.x - target.vx - (self.x - self.vx);
  const dy = target.y - target.vy - (self.y - self.vy);
  return magnitude(dx, dy) <= THREAT_RANGE;
}

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
  // A chance over a window (ruling R-T19j): rolled every frame the opponent is off
  // the stage, so the longer they are off, the likelier it goes to the ledge at all.
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
  // Nothing lands on a body that cannot be hit (Plan 5, Task 19): a roll, a dodge,
  // a ledge's intangibility, a respawn's invincibility, as the CPU sees them, with
  // the action it has noticed (ruling R-T19k: `observe`), so a slow level still
  // swings into the start of a roll. Swinging into one again and again was the
  // sweep's commonest loop (dash attacks into a roll; a jab at an edge at a fighter
  // hanging there).
  if (target.intangible > 0 || target.invincible > 0) return NOTHING;

  const toward = towardX(0, dx);
  if (!facingTarget && self.grounded && toward !== 0) {
    // Turning is an input, not a free action; hold the direction one frame.
    return { score: 380, input: toward };
  }

  const swinging = pulse(ctx.view.frame, self.port, 10, 3);

  // The same move on the same shield, time after time (Plan 5, Task 19: the jab
  // loops): its own last swings that connected are in its stale queue, marked when
  // they met a shield (`CombatState.staleShield`). After `SHIELD_LOOP` in a row it
  // stops poking: a grab goes through the shield, from further out it walks in to
  // grab range.
  if (SHIELDS_AND_DROPS.includes(targetAction) && pokingShield(self)) {
    if (distance <= GRAB_RANGE) return { score: 460, input: swinging ? Btn.Grab : 0 };
    return { score: 410, input: toward };
  }
  // A per-opportunity choice (ruling R-T19j): rolled every frame, but a swing comes
  // out only on its pulse's press, so each swing's move is its own roll.
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

/** UNVERIFIED (CPU judgement): the swings in a row on a shield, one move, that make a loop to break. */
export const SHIELD_LOOP = 3;

/** A shield up, coming up, stunned or just let go: the defence a poke loop meets. */
const SHIELDS_AND_DROPS: readonly ActionState[] = [...SHIELD_ACTIONS, "shieldRelease"];

/** Its last `SHIELD_LOOP` swings that connected were one move, every one on a shield. */
function pokingShield(f: FighterState): boolean {
  const q = f.staleQueue;
  if (q.length < SHIELD_LOOP) return false;
  for (let i = 0; i < SHIELD_LOOP; i++) if (q[i] !== q[0] || f.combat.staleShield[i] !== true) return false;
  return true;
}

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

/** UNVERIFIED (CPU judgement): how near the middle of the stage counts as there, for `centre`. */
export const CENTRE_BAND = fx(20);

/**
 * With nobody to fight (the opponent between stocks, on the respawn platform or
 * entering), walk back toward the middle of the stage rather than stand where the
 * last exchange left it (Plan 5, Task 19: the sweep's long runs at an edge, most
 * of them while the opponent respawned). Scored only above `idle`.
 */
export const centre: Behaviour = (ctx) => {
  const { self, target } = ctx.view;
  if (target !== null || !canAct(self) || !self.grounded) return NOTHING;
  const mid = Math.trunc((ctx.stage.leftLedge + ctx.stage.rightLedge) / 2);
  if (abs(self.x - mid) <= CENTRE_BAND) return NOTHING;
  return { score: 50, input: towardX(self.x, mid) };
};

/** The floor: always available, so `cpuInput` always has an answer. */
export const idle: Behaviour = () => ({ score: 1, input: 0 });
