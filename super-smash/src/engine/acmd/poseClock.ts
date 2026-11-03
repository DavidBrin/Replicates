/**
 * Which motion a fighter is playing, and which frame of it — in integers.
 *
 * Plan 4 bakes every bone of every motion into `BoneTable`s (`bones.ts`). A
 * table is indexed by (motion, frame); this module is the one place that turns
 * a `FighterState` into that index, for the sim (hurtboxes, the ECB) and for the
 * renderer alike, so the two cannot disagree about where a limb is.
 *
 * - A move (`attack`, `special`, `throw`, `grab`, `pummel` with a slot) plays
 *   its `game_` script's motion at the interpreter's `motionFrame`, so
 *   `FT_MOTION_RATE` indexes the bake exactly as it indexes hitboxes.
 * - Every other status plays `status_<action>` (with `_aerial` for a second
 *   jump and `_fast` for a fast fall), on a clock the bake declares per motion
 *   (`MotionClock`): once through a fixed-length state, scaled across a
 *   variable-length one, looping, looping on the global frame (idle), or paced
 *   by distance covered (walk, run).
 * - The dodges are each fighter's own (Plan 3, Task 20c and final wave), and
 *   the air dodge's and the roll's lengths also depend on the way `charge`
 *   remembers. So each is a motion of its own per direction, played once at the
 *   fighter's own length (ruling R4): `status_airDodge` (neutral) and its
 *   `_side`, `_up`, `_down`, `_diagUp` and `_diagDown`; `status_roll` and
 *   `status_roll_back`; `status_spotDodge`.
 *
 * **Frames.** A timed status is drawn on `actionFrame` 0 to T − 1 and never on
 * T: one the fighter enters itself hands off on `actionFrame` T, its first
 * actionable frame (`handOff`), and one entered on contact ends on that frame
 * (`endStatus`). So the once clock (`actionFrame` + 1) shows frames 1 to T, and
 * the scaled one (`actionFrame` × `SCALED_FRAMES` / T + 1) stays inside 1 to
 * `SCALED_FRAMES`.
 *
 * Integers only: `actionFrame`, Q12 `vx` and `vy`, frame counts. The clocks come
 * from the bake, through the sim context (`SimContext.bake`).
 */

import { airDodgeDirection, airDodgeFrames, airDodgeOf } from "../airDodge";
import { FOOTSTOOL_GROUND_FRAMES } from "../footstool";
import {
  DASH_INTERRUPT_FRAME,
  JUMP_SQUAT_FRAMES,
  SHIELD_BREAK_STUN,
  SHIELD_RELEASE_FRAMES,
  TECH_CEILING_FRAMES,
  TECH_FRAMES,
  TECH_ROLL_FRAMES,
  TECH_WALL_FRAMES,
} from "../constants";
import { ONE } from "../fixed";
import { groundDodgeOf, ROLL_BACK, rollOf } from "../groundDodge";
import { jumpRiseSpeeds } from "../kinetic";
import { fighterParams, type FighterParams } from "../params";
import {
  CROUCH_END_FRAMES,
  CROUCH_START_FRAMES,
  DOWNED_FRAMES,
  ENTRY_FRAMES,
  GETUP_FRAMES,
  LANDING_ANIMATION_FRAMES,
  LEDGE_GETUP_FRAMES,
  LEDGE_JUMP_FRAMES,
  LEDGE_ROLL_FRAMES,
  PUMMEL_FRAMES,
  RUN_BRAKE_FRAMES,
  SHIELD_START_FRAMES,
  TURNAROUND_FRAMES,
} from "../states";
import type { ActionState, FighterDef, FighterState } from "../types";
import { moveScriptFrame } from "./run";
import type { MotionKind } from "./types";

/** The fighter fields the clock reads. */
export type ClockedFighter = Pick<
  FighterState,
  "defId" | "action" | "actionFrame" | "move" | "port" | "charge" | "hitstun" | "jumpsUsed" | "fastFalling" | "vx" | "vy" | "shortHop"
>;

export type ClockKind = "script" | "once" | "scaled" | "loop" | "idle" | "paced";

export interface MotionClock {
  readonly kind: ClockKind;
  /** Baked frames: the move's motion frames, a state's length, a cycle, or `SCALED_FRAMES`. */
  readonly frames: number;
}

/** Samples a variable-length state is baked at (60: exact for any length dividing 60). */
export const SCALED_FRAMES = 60;
/** World units one walk or run cycle covers (was `render/poses/timing.ts` STRIDE). */
export const STRIDE_UNITS = 36;
/**
 * Where on the match clock the idle cycle stands, the same for every port (Plan 6, Task
 * 18): the idle pose is the body the sim hits and stands on, so a per-port offset (the
 * old `IDLE_PORT_OFFSET`, 27 a port) made a hit on a standing fighter land or miss by
 * its port. 27 is the old port 1's phase, so a port 1 stands as it always did. Cost:
 * fighters standing still breathe in step (the 2D canvas renderer keeps its own offset,
 * `render/poses/timing.ts`, which no hurtbox reads).
 */
export const IDLE_PHASE = 27;
/** A non-looping state with no length of its own is drawn across this many frames. */
export const OPEN_ENDED_FRAMES = 30;

/** The actions whose frames come from a `game_` script (`simulate.ts` `hasLiveMove`). */
export function playsMoveScript(action: ActionState): boolean {
  return action === "attack" || action === "special" || action === "throw" || action === "grab" || action === "pummel";
}

/** An air dodge's motion suffix by the direction its `charge` remembers (`airDodgeDirection`). */
function airDodgeSuffix(charge: number): string {
  const d = airDodgeDirection(charge);
  if (d.x === 0 && d.y === 0) return "";
  if (d.y === 0) return "_side";
  if (d.x === 0) return d.y > 0 ? "_up" : "_down";
  return d.y > 0 ? "_diagUp" : "_diagDown";
}

/**
 * The actions that play another action's motion: the same clip on the same
 * clock, so nothing of their own is baked. Plan 5, Task 4b: the helpless fall
 * is the fall's (the plan's rule: "helpless uses the fall clip unless a
 * published or plan clip exists"; none does), fast fall included, and its
 * special landing is the landing lag's, scaled across the move's own lag.
 * Task 8 fix round 1 (ruling R-T8c): Donkey Kong's carry is his walk's, and the
 * fighter carried plays the grab's; their own motions baked byte for byte the
 * same frames. Plan 6, Task 20 authored the carry, which left for motions of its
 * own (`status_cargoCarry`, `status_cargoCarry_air`). Task 9:
 * Kirby's mouthful plays the walk's, and the fighter swallowed and the one spat
 * the tumble's (`poseNameFor` gives them those clips). Task 13c fix round 1: a
 * rebound plays the stand's (UNVERIFIED stand-in: no rebound clip is authored;
 * the presentation's to add). Task 14: the fighter trapped in a Final Smash plays
 * the grab's (`poseNameFor`'s clip; its own motion would bake the grab's frames
 * byte for byte, ruling R-T8c). Task 17: the fighter footstooled (Task 11) and
 * Pikachu's crawl (Task 12) left this table for clips and motions of their own.
 */
export const MOTION_OF_ACTION: Readonly<Partial<Record<ActionState, ActionState>>> = {
  rebound: "stand",
  specialFall: "fall",
  // Plan 6, Task 7: the edge slip falls on the fall's clip until it has one of its own.
  edgeSlip: "fall",
  specialLanding: "landingLag",
  cargoHeld: "grabbed",
  finalTrapped: "grabbed",
  inhaleHold: "walk",
  swallowed: "tumble",
  spatStar: "tumble",
};

/**
 * The status motion for every non-move frame. The air dodge and the roll read
 * `charge` (ruling R4): each direction class has its own length
 * (`airDodgeFrames`: a left and a right diagonal last the same; `rollOf`), so
 * each is its own motion, baked once at that length.
 */
export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge"> & Partial<Pick<FighterState, "grounded">>): MotionKind {
  const shared = MOTION_OF_ACTION[f.action];
  if (shared !== undefined) return statusMotion({ ...f, action: shared });
  // Carried in the air (a jump with the load), not striding (Plan 6, Task 20). A caller
  // that names no `grounded` is read as on the ground: the sim passes whole states.
  if (f.action === "cargoCarry" && f.grounded === false) return "status_cargoCarry_air";
  if (f.action === "jump" && f.jumpsUsed >= 2) return "status_jump_aerial";
  if ((f.action === "fall" || f.action === "dead") && f.fastFalling) return `status_${f.action}_fast`;
  if (f.action === "airDodge") return `status_airDodge${airDodgeSuffix(f.charge)}`;
  if (f.action === "roll" && f.charge === ROLL_BACK) return "status_roll_back";
  return `status_${f.action}`;
}

/**
 * The actions whose length varies within one motion, from the fighter's state
 * rather than a constant: the bake scales these. The dodges are not among them:
 * their lengths are the fighter's own and fixed per motion (R4).
 */
export const VARIABLE_LENGTH_ACTIONS: ReadonlySet<ActionState> = new Set<ActionState>(["jump", "land", "landingLag", "specialLanding", "hitstun"]);

/** Every kind of jump's rise for one fighter, from `jumpRiseSpeeds`. */
interface Rises {
  readonly full: number;
  readonly short: number;
  /** Per midair jump: `air[0]` is the first. One entry unless the fighter has a per-jump list. */
  readonly air: readonly number[];
  /** A ledge jump's vertical speed on each frame of its `jump` action: how it is told from a full hop. */
  readonly ledgeSpeeds: readonly number[];
}

const rises = new WeakMap<FighterParams, Rises>();

function risesOf(p: FighterParams): Rises {
  let r = rises.get(p);
  if (r === undefined) {
    const airs = p.jump_aerial_y_list?.length ?? 1;
    r = {
      full: jumpRiseSpeeds(p, "full").length,
      short: jumpRiseSpeeds(p, "short").length,
      air: Array.from({ length: airs }, (_, i) => jumpRiseSpeeds(p, "air", i).length),
      ledgeSpeeds: jumpRiseSpeeds(p, "ledge"),
    };
    rises.set(p, r);
  }
  return r;
}

/**
 * Frames a jump rises for: the length of the engine's own rise
 * (`jumpRiseSpeeds`, Plan 2) — the same number `render/poses/timing.ts`
 * `jumpTimingFor` gives the 2D path, so the bake and both renderers agree.
 *
 * A jump off the ledge enters `jump` with the same `jumpsUsed` and `shortHop` a
 * full hop has. It is told apart by its vertical speed, which is the ledge
 * jump's own for this frame only on a ledge jump (`isLedgeJump` in the 2D path).
 */
export function jumpRiseFrames(p: FighterParams, f: Pick<FighterState, "actionFrame" | "jumpsUsed" | "shortHop" | "vy">): number {
  const r = risesOf(p);
  const n =
    f.jumpsUsed >= 2
      ? r.air[Math.min(f.jumpsUsed - 2, r.air.length - 1)]
      : f.shortHop
        ? r.short
        : f.vy === r.ledgeSpeeds[f.actionFrame]
          ? r.ledgeSpeeds.length
          : r.full;
  return Math.max(1, n);
}

/**
 * How many frames the fighter's current state lasts, where knowable — the
 * state machine's own constants and the fighter's own dodges, imported rather
 * than copied (DECISIONS D39), case for case as `render/poses/timing.ts`
 * `actionDurationFor` reads them. Its own function so the sim's hurtbox clock
 * and the 3D renderer read one source.
 *
 * Undefined for a state with no length: the looping ones, and of Plan 3's,
 * `tumbleFall` and `ledgeTrumped` (its fall clip is drawn open-ended). The techs
 * have lengths.
 */
export function statusDuration(
  f: Pick<FighterState, "action" | "actionFrame" | "charge" | "hitstun" | "jumpsUsed" | "shortHop" | "vy">,
  def: FighterDef,
): number | undefined {
  switch (f.action) {
    case "jump":
      return jumpRiseFrames(fighterParams(def), f);
    case "entering":
      return ENTRY_FRAMES;
    case "jumpSquat":
      return JUMP_SQUAT_FRAMES;
    // `charge` carries a landing's length; see `onLanded` (and
    // `landFromSpecialFall` for the special landing, Plan 5 Task 4b).
    case "land":
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
    // The fighter's own lengths (`groundDodge.ts`), the roll's by the way `charge` remembers.
    case "spotDodge":
      return groundDodgeOf(def.attributes).spotDodge.frames;
    case "roll":
      return rollOf(groundDodgeOf(def.attributes), f.charge).frames;
    case "ledgeRoll":
      return LEDGE_ROLL_FRAMES;
    // The fighter's own length, by the direction `charge` remembers (`airDodge.ts`).
    case "airDodge":
      return airDodgeFrames(airDodgeOf(def.attributes), f.charge);
    case "downed":
      return DOWNED_FRAMES;
    case "getUp":
      return GETUP_FRAMES;
    case "tech":
      return TECH_FRAMES;
    case "techRoll":
      return TECH_ROLL_FRAMES;
    case "techWall":
      return TECH_WALL_FRAMES;
    case "techCeiling":
      return TECH_CEILING_FRAMES;
    case "ledgeGetUp":
      return LEDGE_GETUP_FRAMES;
    case "ledgeJump":
      return LEDGE_JUMP_FRAMES;
    // Stood on: the footstool's freeze (Plan 5, Task 11), which its own clip spans
    // since Task 17 (30 frames, as the open-ended fallback it replaced).
    case "footstooled":
      return FOOTSTOOL_GROUND_FRAMES;
    // The fighter's own pummel, as its status runs it (ruling P5-R10).
    case "pummel":
      return def.moves.pummel?.totalFrames ?? PUMMEL_FRAMES;
    // Hitstun counts down while `actionFrame` counts up: their sum is the reel's length.
    case "hitstun":
      return f.actionFrame + f.hitstun;
    default:
      return undefined;
  }
}

/** Where a fighter's motion clocks come from: the bake (`BakeTables.clock`). */
export type ClockLookup = (fighterId: string, motion: MotionKind) => MotionClock | undefined;

/* --------------------------------------------------------------- clock -- */

export interface PoseIndex {
  readonly motion: MotionKind;
  /** 1-based, within `1..clock.frames`. */
  readonly frame: number;
}

const clampFrame = (n: number, frames: number): number => (n < 1 ? 1 : n > frames ? frames : n);
const wrap = (n: number, frames: number): number => (((n % frames) + frames) % frames) + 1;

/**
 * A full release's (motion, frame) (Plan 6, Task 20), or null: a store-mode special at
 * full charge plays its full motion (`StoredFullCharge.motion`) frame for frame from the
 * move's loop frame, where the release starts (rubendal 13.0.1: Samus's
 * `special_n_f_max` after her 13 entry frames, Donkey Kong's `special_n_max` from his
 * loop frame, which a stored full punch starts on). Before it, the entry plays on the
 * move's own motion.
 */
export function fullReleaseIndex(def: FighterDef, f: Pick<ClockedFighter, "action" | "move" | "charge" | "actionFrame">): PoseIndex | null {
  if (f.action !== "special" || f.move === null) return null;
  const sc = def.moves[f.move]?.specialCharge;
  if (sc?.mode !== "store" || sc.fromStore.motion === undefined || f.charge < sc.frames || f.actionFrame < sc.loopFrame) return null;
  return { motion: sc.fromStore.motion, frame: clampFrame(f.actionFrame - sc.loopFrame + 1, sc.fromStore.fullFrames ?? 1) };
}

/**
 * The (motion, frame) a fighter's bones are at, or null when no bake covers it
 * (callers fall back to the legacy single capsule / root bone).
 */
export function poseIndexOf(def: FighterDef, f: ClockedFighter, globalFrame: number, clockOf: ClockLookup): PoseIndex | null {
  // A full release plays its own motion (Plan 6, Task 20).
  const full = fullReleaseIndex(def, f);
  if (full !== null && clockOf(def.id, full.motion) !== undefined) return full;
  if (f.move !== null && playsMoveScript(f.action)) {
    const run = moveScriptFrame(def, f);
    if (run === null) return null;
    const clock = clockOf(def.id, run.script.motion);
    if (clock === undefined) return null;
    return { motion: run.script.motion, frame: clampFrame(run.state.motionFrame, clock.frames) };
  }
  const motion = statusMotion(f);
  const clock = clockOf(def.id, motion);
  if (clock === undefined) return null;
  const af = f.actionFrame;
  switch (clock.kind) {
    case "script":
    case "once":
      return { motion, frame: clampFrame(af + 1, clock.frames) };
    case "scaled": {
      const d = statusDuration(f, def) ?? OPEN_ENDED_FRAMES;
      return { motion, frame: clampFrame(Math.floor((af * clock.frames) / Math.max(1, d)) + 1, clock.frames) };
    }
    case "loop":
      return { motion, frame: wrap(af, clock.frames) };
    case "idle":
      return { motion, frame: wrap(globalFrame + IDLE_PHASE, clock.frames) };
    case "paced": {
      const speed = f.vx < 0 ? -f.vx : f.vx;
      return { motion, frame: wrap(Math.floor((af * speed * clock.frames) / (STRIDE_UNITS * ONE)), clock.frames) };
    }
  }
}

/**
 * Normalised clip time for a baked frame — what the bake samples and the
 * renderer draws. A fraction, so for those two alone: the sim reads frames.
 */
export function clipTimeOfFrame(clock: MotionClock, frame: number): number {
  return clock.frames <= 0 ? 0 : (frame - 1) / clock.frames;
}
