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
 * and a roll as many as the fighter's own (Mario's forward roll is 29). Played
 * at the old fixed thirty-frame guess, a four-frame landing would show the
 * first thirteen percent of its clip and nothing else.
 *
 * So `actionDurationFor` reads the state machine's own frame counts. Every
 * number it returns is the same constant the engine branches on, imported
 * rather than copied, so an animation cannot drift out of step with the state
 * it animates.
 */

import { DEFAULT_AIR_DODGE, airDodgeFrames, airDodgeIntangible, airDodgeOf } from "@/engine/airDodge";
import { DEFAULT_GROUND_DODGE, dodgeIntangible, groundDodgeOf, rollOf } from "@/engine/groundDodge";
import { toFloat } from "@/engine/fixed";
import { FOOTSTOOL_GROUND_FRAMES } from "@/engine/footstool";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { actionFrameOf } from "@/engine/hitbox";
import {
  DASH_INTERRUPT_FRAME,
  EDGE_SLIP_FRAMES,
  FLIP_FRAMES,
  JUMP_SQUAT_FRAMES,
  SHIELD_BREAK_STUN,
  SHIELD_RELEASE_FRAMES,
  TECH_CEILING_FRAMES,
  TECH_FRAMES,
  TECH_ROLL_FRAMES,
  TECH_WALL_FRAMES,
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
  edgeSlipFrames,
} from "@/engine/states";
import type { CombatState } from "@/engine/combat";
import type { AirDodgeAttributes, FighterDef, FighterState, GroundDodgeAttributes, MoveSlot } from "@/engine/types";
import { STRIDE_UNITS } from "@/engine/acmd/poseClock";
import { THROW_SLOTS, gameScriptFor } from "@/engine/acmd/legacy";
import { smashHoldFrame, throwStrikeFrame } from "@/engine/acmd/run";
import { clipFor } from "../chars/poses";
import { airDodgeClipTime } from "./airDodge";
import { samplePose, type PoseSample } from "./clip";
import { rollClipTime, rollTurnTime, spotDodgeClipTime } from "./groundDodgeTime";
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
  | "vy"
  | "shortHop"
>;

/**
 * How long each kind of jump rises, in frames, for one fighter.
 *
 * Only the jump needs this, because a jump's length is not a constant: it
 * lasts until the rise runs out, and how long that is depends on the
 * fighter's published heights and gravity. Played over a fixed thirty, Fox's
 * somersault reached 216 degrees before the fall cut in and handed the
 * renderer a fighter tucked on his side. The numbers come from the engine's
 * own rule (`jumpRiseSpeeds`), so the clip and the simulation cannot drift.
 */
export interface JumpTiming {
  readonly full: number;
  readonly short: number;
  /** Per midair jump: `air[0]` is the first. One entry unless the fighter has a per-jump list. */
  readonly air: readonly number[];
  /**
   * A jump off the ledge: its vertical speed on each frame of its `jump` action
   * (`jumpRiseSpeeds(p, "ledge")`), so its rise is `ledgeSpeeds.length`. Kept
   * whole because the speed is how a ledge jump is told from a full hop; see
   * `isLedgeJump`.
   */
  readonly ledgeSpeeds: readonly number[];
  /**
   * The fighter's air-dodge lengths and windows (Plan 3, Task 20c): not a jump,
   * but the other state whose length is the fighter's own, carried here so that
   * every caller already timing a clip by the fighter has it.
   */
  readonly airDodge: AirDodgeAttributes;
  /** The fighter's spot dodge and rolls (Plan 3 final wave), carried for the same reason. */
  readonly groundDodge: GroundDodgeAttributes;
  /** The fighter's pummel's length, its move's `totalFrames` (ruling P5-R10), carried for the same reason. */
  readonly pummel: number;
  /** The fighter's edge slip's length (`edgeSlipFrames`; Plan 6, Task 22), carried for the same reason. */
  readonly edgeSlip?: number;
}

const jumpTimings = new WeakMap<FighterDef, JumpTiming>();

/** The fighter's jump timing, from its `FighterParams`; cached per definition. */
export function jumpTimingFor(def: FighterDef): JumpTiming {
  let t = jumpTimings.get(def);
  if (t === undefined) {
    const p = fighterParams(def);
    const airs = p.jump_aerial_y_list?.length ?? 1;
    t = {
      full: jumpRiseSpeeds(p, "full").length,
      short: jumpRiseSpeeds(p, "short").length,
      air: Array.from({ length: airs }, (_, i) => jumpRiseSpeeds(p, "air", i).length),
      ledgeSpeeds: jumpRiseSpeeds(p, "ledge"),
      airDodge: airDodgeOf(def.attributes),
      groundDodge: groundDodgeOf(def.attributes),
      pummel: def.moves.pummel?.totalFrames ?? PUMMEL_FRAMES,
      edgeSlip: edgeSlipFrames(def),
    };
    jumpTimings.set(def, t);
  }
  return t;
}

/**
 * Whether a first jump (`jumpsUsed` 1, no short hop) is a jump off the ledge
 * rather than a full hop.
 *
 * Nothing in the fighter's state records which it was: `finishLedgeOption`
 * enters `jump` with the same `jumpsUsed` and `shortHop` a full hop has. But
 * both rise by rule, at different speeds, so this frame's vertical speed says:
 * it is the ledge jump's own speed for this frame of the action only on a
 * ledge jump. (No fighter's full hop matches it on any frame; the step-driven
 * test in `jumpTiming.test.ts` holds every one to that.) A rise something else
 * has changed, a ceiling say, reads as a full hop.
 */
function isLedgeJump(f: Pick<PosedFighter, "actionFrame" | "vy">, jump: JumpTiming): boolean {
  return f.vy === jump.ledgeSpeeds[f.actionFrame];
}

export const SLOT_POSE: Record<MoveSlot, PoseName> = {
  jab1: "jab",
  // Each hit of the string gets its own name. They alias the first hit's clip
  // in the shared library, so nothing changes until a fighter overrides one.
  jab2: "jab2",
  jab3: "jab3",
  rapidJab: "rapidJab",
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
  // Its own name (Task 17 fix round 3, ruling R-T17m): a fighter that authors no
  // Final Smash clip plays its own neutral special's (`POSE_FALLBACK`).
  finalSmash: "finalSmash",
  // Plan 5, Task 5 (P5-R4): the counterattack is a clip of its own, its strike
  // key on the cut; the counter's guard stays `downB`.
  counterAttack: "counterAttack",
  // Plan 5, Task 8: Donkey Kong's cargo throws borrow his throws' clips.
  cargoFthrow: "fthrow",
  cargoBthrow: "bthrow",
  cargoUthrow: "uthrow",
  cargoDthrow: "dthrow",
  // Plan 5, Task 9: Kirby's swallow and spit borrow his Inhale's clip.
  inhaleSwallow: "neutralB",
  inhaleSpit: "neutralB",
  // Plan 5, Task 13b: the aerial up special borrows the up special's clip
  // (UNVERIFIED: no aerial clip is authored; the bake times it to its own script).
  upBAir: "upB",
  // Plan 5, Task 13d: a side special's smash version borrows the side special's clip
  // (UNVERIFIED for Samus's Super Missile, whose own animation is unauthored here;
  // the bake times it to its own 57 frames). Link's smash throw is his throw's.
  sideBSmash: "sideB",
  // Fix round 1: Link's failed throw borrows his throw's clip; since Task 17 it is
  // its own motion, the clip played across its own 59 frames (no held last pose).
  sideBFailed: "sideB",
  // Plan 6, Task 8: the grab aerial borrows the grab's clip (no clip of its own yet).
  airGrab: "grab",
  // Plan 5, Task 14: a Final Smash's scene and finishing blow borrow the neutral
  // special's clip, as its start does (UNVERIFIED: no Final Smash clip is authored).
  // Task 17 fix round 1 (ruling R-T17d): the scene and the blow have poses of their
  // own, the fighter's neutral special unless it authors one (`clipFor`): Donkey
  // Kong's barrage and uppercut stay where he stands, where the Giant Punch dived
  // through Mario.
  finalAttack: "finalAttack",
  finalEnd: "finalEnd",
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
const STRIDE = STRIDE_UNITS;

/** Cycles are paced by distance covered, not by frames elapsed. */
export const PACED_BY_SPEED: Partial<Record<PoseName, true>> = { walk: true, run: true, cargoCarry: true };

/** Normalised position within a cycle, for any real number of cycles. */
function wrap(cycles: number): number {
  if (!Number.isFinite(cycles)) return 0;
  return cycles - Math.floor(cycles);
}

export function poseNameFor(
  f: Pick<PosedFighter, "action" | "move" | "jumpsUsed" | "fastFalling"> &
    Partial<Pick<FighterState, "grounded" | "actionFrame">> & { readonly combat?: Pick<CombatState, "dashedOff"> },
): PoseName {
  // The flip off a dash (Plan 6, Task 21), as `statusMotion` names its motion.
  if (f.action === "fall" && f.combat?.dashedOff === true && (f.actionFrame ?? 0) < FLIP_FRAMES) return "fallFlip";
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
    // Plan 5, Task 12's crawl, on a clip of its own since Task 17: a switch to or
    // from the crouch is a change of clip that fades (`blend.ts`), where the one
    // shared loop restarted at its first frame on each.
    case "crawl":
      return "crawl";
    case "crouchEnd":
      return "crouchEnd";
    case "getUp":
    case "tech":
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
    case "ledgeTrumped":
    // Helpless (Plan 5, Task 4b) has no clip of its own: the fall's, as the
    // bake's motion is (`MOTION_OF_ACTION`), and its landing the landing lag's.
    case "specialFall":
      return f.fastFalling ? "fastFall" : "fall";
    // Plan 6, Task 22: the edge slip's own clip.
    case "edgeSlip":
      return "edgeSlip";
    case "land":
      return "land";
    case "landingLag":
    case "specialLanding":
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
    case "techRoll":
      return "roll";
    case "airDodge":
      return "airDodge";
    case "hitstun":
      return "hitstun";
    case "tumble":
    case "tumbleFall":
      return "tumble";
    // Plan 6, Task 22: a wall or ceiling tech braces and opens; it does not tumble.
    case "techWall":
    case "techCeiling":
      return "surfaceTech";
    case "grabbed":
    // Plan 5, Task 8: carried on Donkey Kong's shoulders, still held. Task 14:
    // trapped in a Final Smash, held still for its scene.
    case "cargoHeld":
    case "finalTrapped":
      return "grabbed";
    // Plan 5, Task 11: stood on, under the jumper's feet; its own clip since Task 17.
    case "footstooled":
      return "footstooled";
    // Donkey Kong carrying: the load over his head (Plan 6, Task 20), striding on the
    // ground and held in the air; a state that names no `grounded` is on the ground.
    case "cargoCarry":
      return f.grounded === false ? "cargoFall" : "cargoCarry";
    // Plan 5, Task 9: Kirby walking with a mouthful plays the walk.
    case "inhaleHold":
      return "walk";
    // Plan 5, Task 9: inside Kirby, or flying as his star, the fighter tumbles.
    // Inside, nobody sees it: Task 17 hides the swallowed (`drawScene`).
    case "swallowed":
    case "spatStar":
      return "tumble";
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
  f: Pick<PosedFighter, "action" | "actionFrame" | "charge" | "hitstun" | "jumpsUsed" | "shortHop" | "vy">,
  jump?: JumpTiming,
): number | undefined {
  switch (f.action) {
    // Frames until the rise runs out (`jumpTimingFor`).
    case "jump": {
      if (!jump) return undefined;
      const n =
        f.jumpsUsed >= 2
          ? jump.air[Math.min(f.jumpsUsed - 2, jump.air.length - 1)]
          : f.shortHop
            ? jump.short
            : isLedgeJump(f, jump)
              ? jump.ledgeSpeeds.length
              : jump.full;
      return Math.max(1, n);
    }
    case "entering":
      return ENTRY_FRAMES;
    case "jumpSquat":
      return JUMP_SQUAT_FRAMES;
    case "land":
      return f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES;
    // `charge` carries the remaining lag for a landing; see `onLanded`.
    case "landingLag":
    case "specialLanding":
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
    // The fighter's own lengths, the roll's by the way `charge` remembers: the
    // engine's own rule (`groundDodge.ts`). Without the fighter's timing, Mario's.
    case "spotDodge":
      return (jump?.groundDodge ?? DEFAULT_GROUND_DODGE).spotDodge.frames;
    case "roll":
      return rollOf(jump?.groundDodge ?? DEFAULT_GROUND_DODGE, f.charge).frames;
    case "ledgeRoll":
      return LEDGE_ROLL_FRAMES;
    // The fighter's own length, by the direction `charge` remembers: the
    // engine's own rule (`airDodgeFrames`). Without the fighter's timing, Mario's.
    case "airDodge":
      return airDodgeFrames(jump?.airDodge ?? DEFAULT_AIR_DODGE, f.charge);
    case "downed":
      return DOWNED_FRAMES;
    case "getUp":
      return GETUP_FRAMES;
    // Teching (Plan 3, Task 12): each clip plays across its own state.
    case "tech":
      return TECH_FRAMES;
    case "techRoll":
      return TECH_ROLL_FRAMES;
    case "techWall":
      return TECH_WALL_FRAMES;
    case "techCeiling":
      return TECH_CEILING_FRAMES;
    // Plan 6, Task 22: the fighter's own lockout.
    case "edgeSlip":
      return jump?.edgeSlip ?? EDGE_SLIP_FRAMES;
    case "ledgeGetUp":
      return LEDGE_GETUP_FRAMES;
    case "ledgeJump":
      return LEDGE_JUMP_FRAMES;
    // Stood on: the freeze (Plan 5, Task 11), which its clip spans (Task 17).
    case "footstooled":
      return FOOTSTOOL_GROUND_FRAMES;
    // The fighter's own pummel, as its status runs it (ruling P5-R10). Without
    // the fighter's timing, the engine's fallback.
    case "pummel":
      return jump?.pummel ?? PUMMEL_FRAMES;
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
  /**
   * A chargeable move's hold frame, the `actionFrame` a held charge pins it on
   * (`smashHoldFrame`, the engine's own rule): the move's published hold frame
   * where it has one (`MoveDef.smashHold`, the first frame of SmashWiki's "Charges
   * between", ruling R-T13i), else the frame before its script raises
   * START_SMASH_HOLD (R-T13e), else the frame before `firstActive` (P5-R15), and
   * never before frame 1, so no hitbox is live while it charges. A special
   * that charges on B holds on its loop frame instead, `loopFrame − 1` (Plan 5,
   * `specialChargeMain`; P5-R1), and carries on past it once released. Absent
   * for a move that cannot charge.
   */
  readonly chargeHold?: number;
}

/**
 * Read the timing of the move a fighter is currently performing. A throw strikes
 * on its `ATK_HIT_ABS` (ruling P5-R9): the launch, which is no box in its table,
 * is what its clip anchors on, its boxes or none (Kirby's down-throw stomps come
 * before it, Mario's forward throw has no box at all), and it is live until the
 * later of its last box and the launch.
 */
export function moveTimingFor(
  def: Pick<FighterDef, "moves" | "scripts"> | null | undefined,
  move: MoveSlot | null,
): MoveTiming | undefined {
  const def_ = def?.moves;
  const m = move && def_ ? def_[move] : undefined;
  if (!m || !def || !move) return undefined;
  let first = -1;
  let last = -1;
  for (const hb of m.hitboxes) {
    if (first < 0 || hb.startFrame < first) first = hb.startFrame;
    if (hb.endFrame > last) last = hb.endFrame;
  }
  const script = THROW_SLOTS.has(move) ? gameScriptFor(def, move) : null;
  const strike = script === null ? null : throwStrikeFrame(script);
  if (strike !== null) {
    first = strike;
    last = Math.max(last, strike);
  }
  // A clip that strikes elsewhere than the first box (`MoveDef.clipStrike`; Plan 5,
  // Task 17 fix round 1: Zero Laser), as the bake anchors it.
  if (m.clipStrike !== undefined) first = m.clipStrike;
  // Converted out of the frame-data convention and into `actionFrame`, which is
  // what every caller here counts in. See `moveFrameOf`.
  return {
    total: m.totalFrames,
    firstActive: first < 0 ? -1 : actionFrameOf(first),
    lastActive: last < 0 ? -1 : actionFrameOf(last),
    ...(m.specialCharge !== undefined
      ? { chargeHold: m.specialCharge.loopFrame - 1 }
      : m.chargeable
        ? { chargeHold: smashHoldFrame(def, { move }) }
        : {}),
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
  jump?: JumpTiming,
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
  // coiled pose to sit behind rather than a finished one. Only while it is
  // held: the engine keeps `charge` once the button comes up (frozen, for the
  // swing's damage) until the move ends, so a smash with charge is still
  // charging only while its frame sits on the hold. Past it, it swings. With
  // no hold frame to go on (no move timing), any charge parks. Never further on
  // than the swing resumes from: a smash whose script holds it early (P5-R15:
  // Pikachu's down smash on frame 3) parks on its hold frame's own pose, as the
  // bake does, so the release moves the pose on, not back.
  const charging = fighter.charge > 0 && fighter.actionFrame <= (timing?.chargeHold ?? Infinity);
  if (charging && (name === "fsmash" || name === "usmash" || name === "dsmash")) {
    return Math.min((strike ?? 0.3) * 0.55, poseTimeFor(name, { ...fighter, charge: 0 }, frame, timing, jump));
  }

  // The air dodge plays in two halves around its intangible window (`airDodgeClipTime`).
  if (name === "airDodge" && fighter.action === "airDodge") {
    const a = jump?.airDodge ?? DEFAULT_AIR_DODGE;
    return airDodgeClipTime(fighter.actionFrame, airDodgeFrames(a, fighter.charge), airDodgeIntangible(a, fighter.charge)[1]);
  }

  // The spot dodge and the rolls play their evasive segment over the fighter's own intangible
  // frames (`groundDodgeTime.ts`). Only a dodge: the ledge and tech rolls, which borrow the roll
  // clip, play it plainly over their own lengths.
  if (name === "spotDodge" && fighter.action === "spotDodge") {
    const d = (jump?.groundDodge ?? DEFAULT_GROUND_DODGE).spotDodge;
    return spotDodgeClipTime(fighter.actionFrame, d.frames, ...dodgeIntangible(d));
  }
  if (name === "roll" && fighter.action === "roll") {
    const d = rollOf(jump?.groundDodge ?? DEFAULT_GROUND_DODGE, fighter.charge);
    return rollClipTime(fighter.actionFrame, d.frames, ...dodgeIntangible(d));
  }

  const stateFrames = actionDurationFor(fighter, jump);
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
  jump?: JumpTiming,
): number {
  const name = poseNameFor(fighter);
  const spin = clipFor(fighter.defId, name)?.spin;
  if (!spin) return 0;
  // A roll turns at one constant rate over its own length, not over the re-timed clip
  // (`rollTurnTime`): it rolls without slipping.
  const t =
    name === "roll" && fighter.action === "roll"
      ? rollTurnTime(fighter.actionFrame, actionDurationFor(fighter, jump) ?? 0)
      : poseTimeFor(name, fighter, frame, timing, jump);
  return t * spin * Math.PI * 2;
}

/** The pose a fighter is in this frame, ready to hand to `resolve()`. */
export function samplePoseForFighter(
  fighter: PosedFighter,
  frame: number,
  timing?: MoveTiming,
  jump?: JumpTiming,
): PoseSample {
  const name = poseNameFor(fighter);
  return samplePose(clipFor(fighter.defId, name), poseTimeFor(name, fighter, frame, timing, jump));
}
