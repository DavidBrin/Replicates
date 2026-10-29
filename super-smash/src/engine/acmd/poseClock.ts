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
/** Idle is offset per port so four fighters do not breathe in lockstep. */
export const IDLE_PORT_OFFSET = 27;
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
 * The status motion for every non-move frame. The air dodge and the roll read
 * `charge` (ruling R4): each direction class has its own length
 * (`airDodgeFrames`: a left and a right diagonal last the same; `rollOf`), so
 * each is its own motion, baked once at that length.
 */
export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge">): MotionKind {
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
export const VARIABLE_LENGTH_ACTIONS: ReadonlySet<ActionState> = new Set<ActionState>(["jump", "land", "landingLag", "hitstun"]);

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
    // `charge` carries a landing's length; see `onLanded`.
    case "land":
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
    case "pummel":
      return PUMMEL_FRAMES;
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
 * The (motion, frame) a fighter's bones are at, or null when no bake covers it
 * (callers fall back to the legacy single capsule / root bone).
 */
export function poseIndexOf(def: FighterDef, f: ClockedFighter, globalFrame: number, clockOf: ClockLookup): PoseIndex | null {
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
      return { motion, frame: wrap(globalFrame + f.port * IDLE_PORT_OFFSET, clock.frames) };
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
