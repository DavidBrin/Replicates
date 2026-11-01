/**
 * The CPU's repertoire: small behaviours, each of which looks at one delayed
 * view of the world and answers two questions — "does this apply right now, and
 * how much?" and "what would I press?". They live by concern (Plan 5 final wave,
 * ruling R-FW1j): `recovery.ts` (its model of its own up special and fall, and
 * `recover`), `defence.ts` (`survive`, `tech`, `escape`, `parry`, `shield`),
 * `offence.ts` (`attack`, `edgeguard` and the movement behaviours) and Plan 5's
 * specials, `specials.ts`. This file holds what they all share: the stage's view,
 * the level's dials, the observation, the context and the primitives. The table of
 * all of them, in the order ties break, is `cpu.ts`'s `BEHAVIOURS`.
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
 *    where the swing is now, as it reads the swing's frame (`parry`). It sees the
 *    opponent's intangibility only once it began at least the reaction time ago,
 *    so not one that began in the frames its view hasn't caught up with (ruling
 *    R-T19k, amended: `observe`, `intangibleSince`). Invincibility (a respawn's)
 *    shows on screen, as the Smash Ball and a Final Smash do, and is read as it is.
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

import { ENTRY_INTANGIBILITY, LEDGE_HANG_MIN, dodgeWindow, moveIntangibility } from "@/engine/states";
import { ledgeIntangibilityFrames } from "@/engine/physics";

import { FOOTSTOOL_INTANGIBLE_FIRST } from "@/engine/footstool";
import { AIR_DODGE_SLIDE_FRAMES, airDodgeCharge, airDodgeFrames, airDodgeOf } from "@/engine/airDodge";

import { hitboxWorldPos, type Capsule } from "@/engine/hitbox";

import type { BakeTables } from "@/engine/acmd/bakeTables";

import {
  AIR_DODGE_SLIDE_DISTANCE,
  AIR_DODGE_SLIDE_END_SPEED,
  AIR_DODGE_SLINGSHOT_DISTANCE,
  AIR_DODGE_SLINGSHOT_FRAMES,
  LEDGE_REGRAB_SCALING,
} from "@/engine/constants";
import { abs, fx, magnitude } from "@/engine/fixed";
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
export const SHIELD_ACTIONS: readonly ActionState[] = ["shieldStart", "shield", "shieldStun"];
export const REELING_ACTIONS: readonly ActionState[] = [
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

export function observe(state: GameState, port: number, reactionFrames: number, defs: readonly (FighterDef | undefined)[] = []): Observation {
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
  // Its intangibility, only where it began at least the reaction time ago (ruling
  // R-T19k, amended): one begun in the frames the view hasn't caught up with is
  // hidden, one it has seen stays seen across the target's actions (a ledge's into
  // the get-up). Invincibility (a respawn's, a throw's catch) is on screen, read as it is.
  const rewound = rewind(nearest, reactionFrames);
  const seen = intangibleSince(nearest, defs[nearest.port]) >= reactionFrames ? rewound : { ...rewound, intangible: 0 };
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

/**
 * How many frames ago, at least, the fighter's intangibility began (ruling R-T19k,
 * amended), from the engine's own timers; `Infinity` with none. The engine grants it
 * two ways:
 *  - a window an action re-asserts a frame at a time (a dodge, a tech, a move's own
 *    frames: `dodgeWindow`, `moveIntangibility`), which leaves the countdown at 1:
 *    begun at the window's first frame; a footstool jump's, by its own clock
 *    (`footstoolFrame`, from `FOOTSTOOL_INTANGIBLE_FIRST`); any other held at 1 (Kirby's
 *    mouthful and its star), at the action's start at the latest, or a countdown's
 *    last frame;
 *  - a grant of 2 or more counting down a frame at a time, the entry drop's
 *    (`ENTRY_INTANGIBILITY`, at the match's start) or a ledge grab's
 *    (`ledgeIntangibilityFrames`, as the hang began). So in the hang, its own frames;
 *    elsewhere, the grant less what is left: the entry's exactly (the only grant a
 *    fighter with no ledge grab since its last hit or KO can have, `ledgeRegrabs`
 *    0), and a ledge's at least, its least grant being the one with no air time
 *    (the air time before the grab is not kept), at the damage now (no hit lands on
 *    it since) and the last grab's regrab count (an earlier grab's was larger); and
 *    at least the action's own frames (the hang's least, `LEDGE_HANG_MIN`, before a
 *    ledge option's).
 * Not read exactly, and so hidden for longer than the view would (measured in the
 * sweep): a ledge grant's air time; a window that took over from intangibility
 * already running (an air dodge's into a tech, a dodge's last frame into its
 * landing), read from the window's or the action's start; and a Kirby star's, begun
 * at the swallow before it, read from the star's start.
 */
export function intangibleSince(f: FighterState, def: FighterDef | undefined): number {
  if (f.intangible <= 0) return Number.POSITIVE_INFINITY;
  const w = def === undefined ? null : (dodgeWindow(f, def.attributes) ?? moveIntangibility(f, def));
  if (w !== null && f.intangible <= 1 && f.actionFrame >= w[0] && f.actionFrame <= w[1]) return f.actionFrame - w[0];
  if (f.action === "ledgeHang") return f.actionFrame;
  const ledgeOption = LEDGE_OPTIONS.includes(f.action);
  if (f.intangible <= 1 && !ledgeOption) {
    const bounce = f.combat.footstoolFrame;
    return bounce >= FOOTSTOOL_INTANGIBLE_FIRST ? bounce - FOOTSTOOL_INTANGIBLE_FIRST : f.actionFrame;
  }
  const inAction = f.actionFrame + (ledgeOption ? LEDGE_HANG_MIN : 1);
  if (f.intangible <= 1) return inAction;
  const grant = f.ledgeRegrabs === 0 ? ENTRY_INTANGIBILITY : ledgeIntangibilityFrames(0, f.damage, Math.min(f.ledgeRegrabs - 1, LEDGE_REGRAB_SCALING.length - 2));
  return Math.max(inAction, grant - f.intangible);
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

/** A box that lands a hit on a shield: not a catch (a grab goes through one) or a windbox (a push). */
export function strikes(hb: Hitbox): boolean {
  return hb.grabbing !== true && hb.windbox !== true;
}

/** A hitbox as the capsule it covers where its fighter stands, facing its way: its far end only with both of its coordinates, as the engine places it (`gatherHitboxes`). */
export function boxCapsule(f: Pick<FighterState, "x" | "y" | "facing">, hb: Hitbox): Capsule {
  const near = hitboxWorldPos(f.x, f.y, f.facing, hb);
  const far = hb.x2 === undefined || hb.y2 === undefined ? near : hitboxWorldPos(f.x, f.y, f.facing, { x: hb.x2, y: hb.y2 });
  return { x1: near.x, y1: near.y, x2: far.x, y2: far.y, r: hb.radius };
}

/** The ledge options: a fighter in one keeps its ledge until the option has left it (`findLedgeGrab`). */
export const LEDGE_OPTIONS: readonly ActionState[] = ["ledgeGetUp", "ledgeAttack", "ledgeRoll", "ledgeJump"];
