/**
 * Which clip a fighter is in, and how far through it they are.
 *
 * ## Why a movement clip needs a duration
 *
 * An attack's clip is anchored on the frame its hitbox goes live (`MoveTiming`
 * below), because that is a truth the animation can be wrong about. Movements
 * have exactly the same problem and it went unnoticed for longer, because
 * seventeen of the twenty-one movement clips were a *single frozen pose* — and
 * a photograph cannot be mistimed. Give a landing a squash key and a recovery
 * key and the question appears immediately: a landing lasts four frames, a
 * landing out of a forward-air lasts as many as the move's landing lag says,
 * and a roll lasts thirty-one. Played at the old fixed thirty-frame guess, a
 * four-frame landing would show the first thirteen percent of its clip and
 * nothing else.
 *
 * So `actionDurationFor` reads the state machine's own frame counts. Every
 * number it returns is the same constant the engine branches on, imported
 * rather than copied, so an animation cannot drift out of step with the state
 * it animates.
 */

import { toFloat } from "@/engine/fixed";
import { actionFrameOf } from "@/engine/hitbox";
import {
  AIR_DODGE_FRAMES,
  DASH_INTERRUPT_FRAME,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  JUMP_SQUAT_FRAMES,
  ROLL_FRAMES,
  SHIELD_BREAK_STUN,
  SHIELD_RELEASE_FRAMES,
  SPOT_DODGE_FRAMES,
} from "@/engine/constants";
import {
  CROUCH_END_FRAMES,
  CROUCH_START_FRAMES,
  DOWNED_FRAMES,
  ENTRY_FRAMES,
  GETUP_FRAMES,
  LEDGE_GETUP_FRAMES,
  LEDGE_JUMP_FRAMES,
  LEDGE_ROLL_FRAMES,
  LANDING_ANIMATION_FRAMES,
  PUMMEL_FRAMES,
  RUN_BRAKE_FRAMES,
  SHIELD_START_FRAMES,
  TURNAROUND_FRAMES,
} from "@/engine/states";
import type { FighterDef, FighterState, MoveSlot } from "@/engine/types";
import { clipFor } from "../chars/poses";
import { samplePose, type PoseSample } from "./clip";
import { type PoseName } from "./library";

/** Everything the pose layer needs to know about a fighter. */
export type PosedFighter = Pick<
  FighterState,
  | "defId"
  | "action"
  | "actionFrame"
  | "move"
  | "port"
  | "charge"
  | "jumpsUsed"
  | "fastFalling"
  | "hitstun"
  | "vx"
  | "shortHop"
>;

/**
 * What the pose layer needs from a fighter's attributes.
 *
 * Only the jump needs any, and it needs them because a jump's length is not a
 * constant: it lasts until the rise runs out, which is the launch velocity
 * divided by the fighter's own gravity. Fox is airborne for 18 frames and Samus
 * for 31. Played over a fixed thirty, Fox's somersault reached 216 degrees
 * before the fall cut in and handed the renderer a fighter tucked on his side.
 */
export type JumpAttributes = Pick<
  FighterDef["attributes"],
  "gravity" | "fullHopVelocity" | "shortHopVelocity" | "airJumpVelocity"
>;

const SLOT_POSE: Record<MoveSlot, PoseName> = {
  jab1: "jab",
  jab2: "jab",
  jab3: "jab",
  rapidJab: "jab",
  ftilt: "ftilt",
  utilt: "utilt",
  dtilt: "dtilt",
  dashAttack: "dashAttack",
  fsmash: "fsmash",
  usmash: "usmash",
  dsmash: "dsmash",
  nair: "nair",
  fair: "fair",
  bair: "bair",
  uair: "uair",
  dair: "dair",
  neutralB: "neutralB",
  sideB: "sideB",
  upB: "upB",
  downB: "downB",
  grab: "grab",
  dashGrab: "grab",
  pummel: "grab",
  fthrow: "fthrow",
  bthrow: "bthrow",
  uthrow: "uthrow",
  dthrow: "dthrow",
  ledgeAttack: "ftilt",
  getUpAttack: "dsmash",
  finalSmash: "neutralB",
};

/** A looping clip that names no period of its own runs at half a second. */
const DEFAULT_PERIOD = 30;

/**
 * World units one walk or run cycle covers, so cadence follows speed.
 *
 * A fixed frame period makes the fast half of the roster skate. Fox walks at
 * 1.523 units a frame and Kirby at 0.977 — a 56% spread — so one 32-frame cycle
 * for both means Fox's feet plant 56% short of where his body has gone, and
 * dragging feet is the single most recognisable sign of an animation that is
 * not attached to its movement.
 *
 * Driving the cycle by distance rather than by frames removes the whole class:
 * a fighter moving twice as fast steps twice as often, every fighter's foot
 * plants where the ground is, and the clip does not need to know whose legs it
 * is on. Thirty-six units is Mario's walk speed across the walk clip's own
 * period, which is also within a whisker of his run speed across the run clip's
 * — a stride is a stride, and running only does it more often.
 *
 * A fighter held at zero speed — walking into a wall — freezes mid-step, which
 * is correct: feet stop when the fighter stops.
 */
const STRIDE = 36;

/** Cycles are paced by distance covered, not by frames elapsed. */
const PACED_BY_SPEED: Partial<Record<PoseName, true>> = { walk: true, run: true };

/** Normalised position within a cycle, for any real number of cycles. */
function wrap(cycles: number): number {
  if (!Number.isFinite(cycles)) return 0;
  return cycles - Math.floor(cycles);
}

export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed" | "fastFalling">): PoseName {
  switch (f.action) {
    case "stand":
    case "entering":
    case "respawnPlatform":
      return "idle";
    case "walk":
      return "walk";
    case "dashStart":
      return "dash";
    case "run":
      return "run";
    case "runBrake":
      return "brake";
    case "turnaround":
      return "turn";
    case "crouchStart":
      return "crouchStart";
    case "crouch":
      return "crouch";
    case "crouchEnd":
      return "crouchEnd";
    case "getUp":
      return "getUp";
    case "jumpSquat":
      return "jumpSquat";
    // The second jump is a different animation in Ultimate — a flip, a spin or
    // a kick depending on the fighter — and it is the clearest read there is
    // that the jump has been spent.
    case "jump":
      return f.jumpsUsed >= 2 ? "doubleJump" : "rise";
    case "fall":
    case "dead":
      return f.fastFalling ? "fastFall" : "fall";
    case "land":
      return "land";
    case "landingLag":
      return "landingLag";
    case "attack":
    case "special":
    case "throw":
      return f.move ? SLOT_POSE[f.move] : "jab";
    case "grab":
    case "grabHold":
    case "pummel":
      return "grab";
    case "shieldStart":
    case "shield":
    case "shieldStun":
      return "shield";
    case "shieldRelease":
      return "shieldRelease";
    case "shieldBroken":
      return "shieldBroken";
    case "spotDodge":
      return "spotDodge";
    case "roll":
    case "ledgeRoll":
      return "roll";
    case "airDodge":
      return "airDodge";
    case "hitstun":
      return "hitstun";
    case "tumble":
      return "tumble";
    case "grabbed":
      return "grabbed";
    case "thrown":
      return "thrown";
    case "downed":
      return "downed";
    case "ledgeHang":
      return "ledgeHang";
    case "ledgeGetUp":
      return "ledgeGetUp";
    case "ledgeJump":
      return "rise";
    case "ledgeAttack":
      return "ftilt";
    default:
      return "idle";
  }
}

/**
 * How many frames the fighter's current *state* lasts, where that is knowable.
 *
 * Undefined means the state has no fixed length — standing, walking, falling,
 * holding shield — and those are all looping or single-pose clips, which do not
 * need one.
 */
export function actionDurationFor(
  f: Pick<PosedFighter, "action" | "actionFrame" | "charge" | "hitstun" | "jumpsUsed" | "shortHop">,
  attrs?: JumpAttributes,
): number | undefined {
  switch (f.action) {
    // Frames until the rise runs out. The ratio of two Q12 values is a plain
    // number, so no conversion is needed.
    case "jump": {
      if (!attrs || attrs.gravity <= 0) return undefined;
      const v =
        f.jumpsUsed >= 2
          ? attrs.airJumpVelocity
          : f.shortHop
            ? attrs.shortHopVelocity
            : attrs.fullHopVelocity;
      return Math.max(1, Math.round(v / attrs.gravity));
    }
    case "entering":
      return ENTRY_FRAMES;
    case "jumpSquat":
      return JUMP_SQUAT_FRAMES;
    case "land":
      return LANDING_ANIMATION_FRAMES;
    // `charge` carries the remaining lag for a landing; see `onLanded`.
    case "landingLag":
      return f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES;
    case "crouchStart":
      return CROUCH_START_FRAMES;
    case "crouchEnd":
      return CROUCH_END_FRAMES;
    case "turnaround":
      return TURNAROUND_FRAMES;
    case "runBrake":
      return RUN_BRAKE_FRAMES;
    case "dashStart":
      return DASH_INTERRUPT_FRAME;
    case "shieldStart":
      return SHIELD_START_FRAMES;
    case "shieldRelease":
      return SHIELD_RELEASE_FRAMES;
    case "shieldBroken":
      return SHIELD_BREAK_STUN;
    case "spotDodge":
      return SPOT_DODGE_FRAMES;
    case "roll":
      return ROLL_FRAMES;
    case "ledgeRoll":
      return LEDGE_ROLL_FRAMES;
    // `charge` is how an air dodge remembers it was directional — the same flag
    // the engine reads for its intangibility window and its landing lag.
    case "airDodge":
      return f.charge === 1 ? DIRECTIONAL_AIR_DODGE_FRAMES : AIR_DODGE_FRAMES;
    case "downed":
      return DOWNED_FRAMES;
    case "getUp":
      return GETUP_FRAMES;
    case "ledgeGetUp":
      return LEDGE_GETUP_FRAMES;
    case "ledgeJump":
      return LEDGE_JUMP_FRAMES;
    case "pummel":
      return PUMMEL_FRAMES;
    // Hitstun counts down while `actionFrame` counts up, so their sum is the
    // length of the reel — and it is different for every hit.
    case "hitstun":
      return f.actionFrame + f.hitstun;
    default:
      return undefined;
  }
}

/**
 * What the renderer knows about the move being animated.
 *
 * `firstActive` is the whole reason this exists. Driving an attack clip by
 * `actionFrame / totalFrames` puts the strike key at a fixed *fraction* of the
 * move, and no move's hitbox is live at a fixed fraction of itself: Mario's
 * forward smash is 47 frames and connects on frame 15 (32%), his jab is 20 and
 * connects on frame 2 (10%). Under the old scheme the jab reached full
 * extension eight frames after the hitbox had already gone, and the smash
 * arrived at its extension a frame late and then held it, motionless, for
 * thirty frames — which is exactly what "the attacks don't look like anything"
 * turned out to mean.
 */
export interface MoveTiming {
  readonly total: number;
  /** First frame any hitbox is live, or -1 for a move with none. */
  readonly firstActive: number;
  readonly lastActive: number;
}

/** Read the timing of the move a fighter is currently performing. */
export function moveTimingFor(
  def: Pick<FighterDef, "moves"> | null | undefined,
  move: MoveSlot | null,
): MoveTiming | undefined {
  const def_ = def?.moves;
  const m = move && def_ ? def_[move] : undefined;
  if (!m) return undefined;
  let first = -1;
  let last = -1;
  for (const hb of m.hitboxes) {
    if (first < 0 || hb.startFrame < first) first = hb.startFrame;
    if (hb.endFrame > last) last = hb.endFrame;
  }
  // Converted out of the frame-data convention and into `actionFrame`, which is
  // what every caller here counts in. See `moveFrameOf`.
  return {
    total: m.totalFrames,
    firstActive: first < 0 ? -1 : actionFrameOf(first),
    lastActive: last < 0 ? -1 : actionFrameOf(last),
  };
}

/**
 * Normalised clip time for a fighter.
 *
 * Looping clips are driven by the *global* frame for idle (so four fighters do
 * not breathe in lockstep once their `actionFrame`s coincide) and by
 * `actionFrame` for everything else that loops (so a walk starts on its contact
 * key).
 *
 * An attack is driven by a **two-piece map anchored on its own contact frame**:
 * the wind-up is stretched to fill the startup and the recovery is stretched to
 * fill the rest, so the clip's strike key lands on `firstActive` whatever the
 * move's frame data says. That is what makes one shared clip serve a 20-frame
 * jab and a 47-frame smash and read correctly in both — the alternative is a
 * hand-tuned clip per move per fighter, which is the three hundred and twenty
 * animations this whole approach exists to avoid.
 *
 * Every other clip plays once across the length of its own state.
 */
export function poseTimeFor(
  name: PoseName,
  fighter: PosedFighter,
  frame: number,
  timing?: MoveTiming,
  attrs?: JumpAttributes,
): number {
  const clip = clipFor(fighter.defId, name);
  if (clip?.loop) {
    if (PACED_BY_SPEED[name]) {
      return wrap((fighter.actionFrame * Math.abs(toFloat(fighter.vx))) / STRIDE);
    }
    const period = clip.period ?? DEFAULT_PERIOD;
    // Idle alone is driven by the global frame and offset per port, so that
    // four fighters standing still do not breathe in lockstep.
    const t = name === "idle" ? frame + fighter.port * 27 : fighter.actionFrame;
    return wrap(t / period);
  }

  const strike = clip?.strike;
  // A charging smash parks partway up its wind-up, so the charge glow has a
  // coiled pose to sit behind rather than a finished one.
  if (fighter.charge > 0 && (name === "fsmash" || name === "usmash" || name === "dsmash")) {
    return (strike ?? 0.3) * 0.55;
  }

  const stateFrames = actionDurationFor(fighter, attrs);
  const total = timing && timing.total > 0 ? timing.total : (stateFrames ?? 30);
  const f = fighter.actionFrame;
  const first = timing?.firstActive ?? -1;
  // Only remap when there is a contact frame with room on both sides of it.
  // A move whose hitbox is live on frame 0, or on its last frame, has no
  // wind-up or no recovery to stretch, and the plain ratio is right.
  if (strike !== undefined && first > 0 && first < total) {
    return f <= first
      ? (strike * f) / first
      : Math.min(1, strike + ((1 - strike) * (f - first)) / (total - first));
  }
  return total <= 0 ? 0 : Math.min(1, f / total);
}

/**
 * Whole-body rotation for the clips that declare one, in radians.
 *
 * Signed by facing, because a fighter rolling to the left rolls the other way
 * round. Kept apart from the pose sample for that reason: the sample is
 * facing-agnostic and gets mirrored, and a spin must not be.
 */
export function poseSpinFor(
  fighter: PosedFighter,
  frame: number,
  timing?: MoveTiming,
  attrs?: JumpAttributes,
): number {
  const name = poseNameFor(fighter);
  const spin = clipFor(fighter.defId, name)?.spin;
  if (!spin) return 0;
  return poseTimeFor(name, fighter, frame, timing, attrs) * spin * Math.PI * 2;
}

/** The pose a fighter is in this frame, ready to hand to `resolve()`. */
export function samplePoseForFighter(
  fighter: PosedFighter,
  frame: number,
  timing?: MoveTiming,
  attrs?: JumpAttributes,
): PoseSample {
  const name = poseNameFor(fighter);
  return samplePose(clipFor(fighter.defId, name), poseTimeFor(name, fighter, frame, timing, attrs));
}
