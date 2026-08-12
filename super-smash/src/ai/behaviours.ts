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
  type FighterDef,
  type FighterState,
  type GameState,
  type InputFrame,
  type MoveSlot,
  type StageDef,
} from "@/engine/types";
import { SDI_INPUT_INTERVAL, SMASH_INPUT_WINDOW } from "@/engine/constants";
import { abs, fx, magnitude } from "@/engine/fixed";

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

    let furthest = 0;
    for (const hitbox of move.hitboxes) {
      furthest = Math.max(furthest, hitbox.x + hitbox.radius);
    }
    if (furthest <= 0) continue;

    reach = found ? Math.min(reach, furthest) : furthest;
    found = true;
  }

  return found ? reach : MELEE_RANGE;
}
export const VERTICAL_REACH = fx(13);

export function isStunned(f: FighterState): boolean {
  return f.hitlag > 0 || f.hitstun > 0 || REELING_ACTIONS.includes(f.action);
}

export function canAct(f: FighterState): boolean {
  return !isStunned(f) && !INACTIVE_ACTIONS.includes(f.action);
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
 * at low levels, sometimes neither, which is where level-1 CPUs go to die.
 */
export const recover: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const { stage, tuning } = ctx;
  if (!canAct(self)) return NOTHING;

  if (self.action === "ledgeHang") {
    // Climbing costs nothing and the ledge regrab limit is six, so there is no
    // level at which hanging forever is the right answer.
    return { score: 700, input: pulse(ctx.view.frame, self.port, 12, 4) ? Btn.Up : 0 };
  }

  const offstage = isOffstage(self, stage);
  const belowStage = self.y < stage.groundY - fx(4);
  if (self.grounded || (!offstage && !belowStage)) return NOTHING;

  const nearerLedge = self.x < 0 ? stage.leftLedge : stage.rightLedge;
  const drift = towardX(self.x, nearerLedge);

  // The level-1 self-destruct, made explicit rather than emergent: it drifts
  // back but forgets the button, runs out of altitude and dies. At level 9 the
  // roll never fails.
  if (ctx.rolls[ROLL_RECOVER] >= tuning.recoverySkill) {
    return { score: 900, input: drift };
  }

  const outOfJumps = self.jumpsUsed >= ctx.jumps;
  const deep = self.y < stage.groundY - fx(20);

  // Up-B is the last resource, so it is spent only when the jump is gone or
  // the fighter is already too low for a jump alone to reach the ledge.
  if (outOfJumps || deep) {
    const firing = pulse(ctx.view.frame, self.port, 6, 3);
    return { score: 950, input: drift | (firing ? Btn.Special | Btn.Up : 0) };
  }

  const jumping = fullHopPulse(ctx.view.frame, self.port);
  return { score: 900, input: drift | (jumping ? Btn.Jump : 0) };
};

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

  // A shield that is nearly out of health is worse than no shield: it breaks
  // and hands over 240 frames of free punishment. Roll away instead.
  const shieldSpent = self.shieldHealth <= fx(12);
  if (shieldSpent) {
    const away = towardX(ctx.view.dx, 0);
    return { score: 600, input: away | Btn.Shield };
  }

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
