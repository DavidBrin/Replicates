/**
 * The fighter action state machine, and the rules that turn keys into intent.
 *
 * Two things live here that could plausibly live elsewhere, and both are here on
 * purpose.
 *
 * **Input *interpretation* is simulation.** Which physical key is "jump" belongs
 * to `input/`; whether a held direction is a walk or a dash, whether an attack is
 * a tilt or a smash, and whether a press nine frames early still counts do not —
 * they are decisions the game makes from state, they must produce the same answer
 * on both peers of a rollback session, and a remote player's `InputFrame` arrives
 * over the wire with no interpretation attached. So the raw bitfield crosses the
 * network and every meaning is derived here, identically, on both machines.
 *
 * **The state machine owns what is legal.** `ActionState` is a closed union
 * (types.ts) and exactly one member is true each frame; the switch below is the
 * only place that decides what a fighter may do next. Scattering "can I act?"
 * checks across the codebase is how a game ends up letting you shield out of
 * hitstun on one machine and not the other.
 *
 * SPEC §6 is the contract for the interpretation half; §4 for the frame counts.
 */

import { DIAGONAL, ONE, fx, clamp } from "./fixed";
import {
  AIR_DODGE_INTANGIBLE,
  AIR_DODGE_LANDING_LAG,
  DIRECTIONAL_AIR_DODGE_LANDING_LAG,
  BUFFER_FRAMES,
  DASH_THRESHOLD_FRAMES,
  DIRECTIONAL_AIR_DODGE_INTANGIBLE,
  DIRECTIONAL_AIR_DODGE_SPEED,
  LEDGE_JUMP_VELOCITY,
  LEDGE_TRUMPED_FRAMES,
  PERFECT_SHIELD_WINDOW,
  RESPAWN_INVINCIBILITY_MAX,
  RESPAWN_INVINCIBILITY_MIN,
  RESPAWN_PLATFORM_FRAMES,
  ROLL_INTANGIBLE,
  SDI_INPUT_INTERVAL,
  SMASH_CHARGE_DAMAGE,
  SMASH_CHARGE_MAX,
  SMASH_INPUT_WINDOW,
  TAP_JUMP_FRAMES,
  SPOT_DODGE_INTANGIBLE,
  TECH_CEILING_INTANGIBLE,
  TECH_FLOOR_MAX_SPEED,
  TECH_INTANGIBLE,
  TECH_WINDOW,
} from "./constants";
import { cloneCombat } from "./combat";
import {
  dropThroughPlatform,
  ecbOf,
  findLedgeGrab,
  hitstunGravityOptions,
  integrate,
  platformCentreX,
  resolveCollision,
} from "./physics";
import { moveScriptFrame } from "./acmd/run";
import { clearHitRecord } from "./hitbox";
import {
  carrierOf,
  cloneKinetic,
  kineticAdopt,
  kineticClear,
  kineticEndMotion,
  kineticExec,
  jumpLaunchSpeed,
  kineticJump,
  kineticMotion,
  kineticReel,
  kineticSet,
  kineticSetX,
  kineticSetY,
} from "./kinetic";
import { fighterParams } from "./params";
import { STATUS_TABLE, changeStatus } from "./status/kind";
import type { StatusTable } from "./status/kind";
import { Btn, held, pressed, released, stickX, stickY } from "./types";
import type {
  ActionState,
  BufferedAction,
  FighterDef,
  FighterState,
  InputFrame,
  MoveSlot,
  StageDef,
} from "./types";

/* ------------------------------------------------------- frame constants -- */

/** Entry animation: fighters drop in intangible rather than materialising. */
export const ENTRY_FRAMES = 12;
/** Blank frames between losing a stock and appearing on the respawn platform. */
export const DEAD_FRAMES = 60;
/** Shield is up on frame 1 — the shield-*start* is a single frame in Ultimate. */
export const SHIELD_START_FRAMES = 1;
export const CROUCH_START_FRAMES = 5;
export const CROUCH_END_FRAMES = 5;
export const TURNAROUND_FRAMES = 11;
export const RUN_BRAKE_FRAMES = 4;
export const LANDING_ANIMATION_FRAMES = 4;
/** Lying on the floor after a tumble landing, and the get-up that follows. */
export const DOWNED_FRAMES = 40;
export const GETUP_FRAMES = 30;
/**
 * How long a grab holds before the victim escapes on their own: floor(90 + 1.7p)
 * frames, fixed when the grab connects (SmashWiki "Grab",
 * https://www.ssbwiki.com/Grab: "From Brawl onward, the formula is changed to
 * 90 + 1.7p rounded down"). `percent` is Q12.
 */
export function grabHoldFrames(percent: number): number {
  return Math.floor((900 * ONE + 17 * percent) / (10 * ONE));
}
/** No grab lets go sooner than this, however hard the victim mashes (SmashWiki "Grab"). */
export const GRAB_MIN_FRAMES = 19;
/** Mashing out of a grab, in tenths of a frame: 14.4 a button press, 8 a stick input (SmashWiki "Grab", Ultimate). */
export const GRAB_MASH_BUTTON = 144;
export const GRAB_MASH_STICK = 80;
/** Frames a fighter who broke out of a grab cannot be grabbed again: "around one second" (SmashWiki "Grab", Ultimate). */
export const GRAB_RELEASE_IMMUNITY = 60;
export const PUMMEL_FRAMES = 10;
export const THROW_FRAMES = 40;
/** Ledge options are locked out for the first few frames of the hang. */
export const LEDGE_HANG_MIN = 4;
export const LEDGE_GETUP_FRAMES = 26;
export const LEDGE_ROLL_FRAMES = 34;
export const LEDGE_JUMP_FRAMES = 13;
export const LEDGE_ATTACK_FRAMES = 55;
/** How far a roll travels in total, and how far a ledge option lands inboard. */
export const ROLL_DISTANCE = fx(28);
export const LEDGE_ROLL_DISTANCE = fx(20);
export const LEDGE_GETUP_DISTANCE = fx(8);

/* ------------------------------------------------------------- the intent -- */

/**
 * One frame of a fighter's *meaning*, derived from one frame of its keys.
 *
 * Everything the state machine branches on is here, and nothing here is read
 * from anywhere but `interpretInput` — so the whole "what did the player mean"
 * question has exactly one implementation and one set of tests.
 */
export interface Intent {
  readonly x: number;
  readonly y: number;
  readonly jumpPressed: boolean;
  readonly jumpHeld: boolean;
  readonly attackPressed: boolean;
  readonly attackHeld: boolean;
  readonly specialPressed: boolean;
  readonly shieldHeld: boolean;
  readonly shieldPressed: boolean;
  readonly shieldReleased: boolean;
  readonly grabPressed: boolean;
  readonly downPressed: boolean;
  /** The horizontal direction has been held past the 3-frame walk window. */
  readonly wantsDash: boolean;
  /** Attack pressed within 5 frames of a fresh direction press: a smash. */
  readonly smash: boolean;
  /** The fresh direction that made `smash` true, which may differ from x/y. */
  readonly smashX: number;
  readonly smashY: number;
  /** One SDI pulse this frame, or (0, 0). Only ever non-zero during hitlag. */
  readonly sdiX: number;
  readonly sdiY: number;
  /** `Btn.Soft`: a partial tilt. No dash, no smash, a quarter of the DI. */
  readonly soft: boolean;
}

function dirVector(bit: number): { x: number; y: number } {
  switch (bit) {
    case Btn.Left:
      return { x: -1, y: 0 };
    case Btn.Right:
      return { x: 1, y: 0 };
    case Btn.Up:
      return { x: 0, y: 1 };
    case Btn.Down:
      return { x: 0, y: -1 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Track how recently a direction was *freshly pressed*.
 *
 * A keyboard reports a key as down or up and nothing in between, so the two
 * distinctions Smash draws from stick velocity — walk vs. dash, tilt vs. smash —
 * both come down to this counter. It is state rather than a derived value
 * because it has to survive a rollback along with everything else.
 */
export function updateInputTracking(f: FighterState, input: InputFrame, prev: InputFrame): void {
  const bits = [Btn.Left, Btn.Right, Btn.Up, Btn.Down];
  for (const b of bits) {
    if (pressed(input, prev, b)) {
      f.framesSinceDirPress = 0;
      f.lastDirPressed = b;
      return;
    }
  }
  // Capped so the counter stays bounded across an eight-minute match; every
  // window that reads it is under ten frames wide, so the ceiling is invisible.
  if (f.framesSinceDirPress < 1000) f.framesSinceDirPress += 1;
}

/**
 * Read one frame of keys as one frame of intent. SPEC §6.
 *
 * The two timing rules are the whole of the keyboard adaptation: a direction held
 * three frames or less is a walk and beyond that becomes a dash, and an attack
 * within five frames of a fresh direction press is a smash. Both windows come
 * from `constants.ts` rather than being literals here, because the CPU (`ai/`)
 * has to reason about the same numbers to press its own keys convincingly.
 */
export function interpretInput(f: FighterState, input: InputFrame, prev: InputFrame): Intent {
  const x = stickX(input);
  const y = stickY(input);
  const dir = dirVector(f.lastDirPressed);
  const dirStillHeld = f.lastDirPressed !== 0 && held(input, f.lastDirPressed);
  // A partial tilt is what the keyboard's timing rules stand in for: the stick
  // that knows it is not fully deflected walks and tilts on its own say-so.
  const soft = held(input, Btn.Soft);
  const smash =
    pressed(input, prev, Btn.Attack) &&
    dirStillHeld &&
    !soft &&
    f.framesSinceDirPress <= SMASH_INPUT_WINDOW;

  // SDI: one pulse per fresh direction press, and at most one every four frames.
  // The rate limit rides on the hitlag counter because `FighterState` has no
  // spare field for "frames since the last pulse" — and it must not gain one,
  // since every field in it is hashed and re-simulated on every rollback.
  const freshDir = f.framesSinceDirPress === 0;
  const canPulse = f.hitlag > 0 && freshDir && f.hitlag % SDI_INPUT_INTERVAL === 0;

  // Tap jump: an up press that nobody claimed.
  //
  // It fires on the frame the arbitration window closes, and it is expressed as
  // an ordinary jump press so that everything downstream — the buffer,
  // jumpsquat, short hop, air jumps, ledge jumps — treats it exactly like the
  // jump key without knowing it exists.
  //
  // The "nobody claimed it" test needs no bookkeeping, which is the nice part.
  // An attack, special or grab pressed inside the window has already taken the
  // fighter out of an actionable state by the time this fires, so the jump
  // simply never gets asked for; and `framesSinceDirPress` is reset by *any*
  // fresh direction, so it can only equal the window on the press that started
  // it. Both facts mean one press can produce at most one jump, and holding up
  // does not pogo.
  const tapJump =
    f.lastDirPressed === Btn.Up &&
    f.framesSinceDirPress === TAP_JUMP_FRAMES &&
    held(input, Btn.Up);

  return {
    x,
    y,
    jumpPressed: pressed(input, prev, Btn.Jump) || tapJump,
    // Holding up holds the jump, so up gives a full hop and a flick gives a
    // short one — the same distinction the stick makes.
    jumpHeld: held(input, Btn.Jump) || held(input, Btn.Up),
    attackPressed: pressed(input, prev, Btn.Attack),
    attackHeld: held(input, Btn.Attack),
    specialPressed: pressed(input, prev, Btn.Special),
    shieldHeld: held(input, Btn.Shield),
    shieldPressed: pressed(input, prev, Btn.Shield),
    shieldReleased: released(input, prev, Btn.Shield),
    grabPressed: pressed(input, prev, Btn.Grab),
    downPressed: pressed(input, prev, Btn.Down),
    wantsDash: x !== 0 && !soft && f.framesSinceDirPress > DASH_THRESHOLD_FRAMES,
    smash,
    smashX: smash ? dir.x : 0,
    smashY: smash ? dir.y : 0,
    sdiX: canPulse ? dir.x : 0,
    sdiY: canPulse ? dir.y : 0,
    soft,
  };
}

/**
 * Fresh button presses this frame, for a mash (shield-break stun, a grab):
 * attack, special, jump, shield and grab each count once. A stick input is a
 * fresh direction press: `framesSinceDirPress === 0` (Plan 3, Task 9).
 */
export function buttonPresses(intent: Intent): number {
  let n = 0;
  if (intent.attackPressed) n += 1;
  if (intent.specialPressed) n += 1;
  if (intent.jumpPressed) n += 1;
  if (intent.shieldPressed) n += 1;
  if (intent.grabPressed) n += 1;
  return n;
}

/* ---------------------------------------------------------------- buffer -- */

/**
 * Ultimate's 9-frame input buffer: a press made too early still fires.
 *
 * Without it, every option out of landing lag or hitstun would have to be pressed
 * on the exact frame it becomes legal, which is a demand no player meets and no
 * rollback prediction survives — the buffer is as much a netcode feature as a
 * comfort one, because it makes an input that arrives a frame late behave the
 * same as one that arrived on time.
 */
export function bufferPress(f: FighterState, intent: Intent, frame: number): void {
  let kind: BufferedAction["kind"] | null = null;
  if (intent.jumpPressed) kind = "jump";
  else if (intent.attackPressed) kind = "attack";
  else if (intent.specialPressed) kind = "special";
  else if (intent.grabPressed) kind = "grab";
  else if (intent.shieldPressed) kind = "shield";
  if (kind !== null) f.bufferedAction = { kind, frame } as BufferedAction;
}

/** The buffered action still inside its window, or null. Expired ones are dropped. */
export function peekBuffer(f: FighterState, frame: number): BufferedAction["kind"] | null {
  const b = f.bufferedAction;
  if (b === null) return null;
  if (frame - b.frame > BUFFER_FRAMES) {
    f.bufferedAction = null;
    return null;
  }
  return b.kind;
}

/* --------------------------------------------------------------- context -- */

export interface StateContext {
  readonly def: FighterDef;
  readonly stage: StageDef;
  readonly frame: number;
  /**
   * Everybody in the match, because a grab is the one thing in this file that
   * is not a property of a single fighter.
   *
   * It is stored twice — `grabbing` on the holder, `grabbedBy` on the victim —
   * and every transition that ends one has to clear both halves, which means the
   * state machine has to be able to reach the other fighter. Nothing else here
   * writes to it. See `releaseGrab`.
   */
  readonly fighters: readonly FighterState[];
}

/** Change status through the StatusModule (`status/kind.ts`): end, reset, pre. */
export function startAction(f: FighterState, action: ActionState): void {
  changeStatus(f, action);
}

/**
 * Enter a swinging status with `slot` as its move. Task 8 also resets the hit
 * record in those statuses' `pre`; it is reset here too so a status not yet
 * registered — a test that skips the registry — behaves the same.
 */
export function startMove(f: FighterState, action: ActionState, slot: MoveSlot): void {
  changeStatus(f, action);
  f.move = slot;
  f.charge = 0;
  clearHitRecord(f);
}

/** Damage multiplier from a held smash charge: 1.0 fresh, 1.4 at 60 frames. */
export function chargeMultiplier(charge: number): number {
  if (charge <= 0) return ONE;
  const t = clamp(charge, 0, SMASH_CHARGE_MAX);
  return ONE + Math.trunc(((SMASH_CHARGE_DAMAGE - ONE) * t) / SMASH_CHARGE_MAX);
}

/* ------------------------------------------------------ dodge windows -- */

/**
 * The intangible window of a dodge, as [first frame, last frame].
 *
 * `FighterState.intangible` is a countdown, not a schedule, so a spot dodge
 * cannot simply set it to 20 on entry: that would grant intangibility on frames
 * 0–2, which the real game deliberately does not. Instead the window is
 * re-asserted one frame at a time from inside it, which reproduces `[3, 20]`
 * exactly and leaves a longer grant (a ledge grab, a respawn) untouched.
 */
export function dodgeWindow(f: FighterState): readonly [number, number] | null {
  switch (f.action) {
    case "spotDodge":
      return SPOT_DODGE_INTANGIBLE;
    case "roll":
      return ROLL_INTANGIBLE;
    case "airDodge":
      return f.charge === 1 ? DIRECTIONAL_AIR_DODGE_INTANGIBLE : AIR_DODGE_INTANGIBLE;
    // Teching (Plan 3, Task 12): SmashWiki "Lucario (SSBU)/Techs".
    case "tech":
    case "techRoll":
    case "techWall":
      return TECH_INTANGIBLE;
    case "techCeiling":
      return TECH_CEILING_INTANGIBLE;
    default:
      return null;
  }
}

export function updateDodgeIntangibility(f: FighterState): void {
  const w = dodgeWindow(f);
  if (w === null) return;
  if (f.actionFrame >= w[0] && f.actionFrame <= w[1]) {
    f.intangible = Math.max(f.intangible, 1);
  }
}

/* ------------------------------------------------------- move selection -- */

/** Which ground attack a direction means. Smash direction wins over held direction. */
export function groundAttackSlot(f: FighterState, intent: Intent): MoveSlot {
  if (f.action === "run" || f.action === "dashStart") return "dashAttack";
  if (f.action === "crouch" || f.action === "crouchStart") return "dtilt";
  if (intent.smash) {
    if (intent.smashX !== 0) return "fsmash";
    if (intent.smashY > 0) return "usmash";
    if (intent.smashY < 0) return "dsmash";
  }
  if (intent.x !== 0) return "ftilt";
  if (intent.y > 0) return "utilt";
  if (intent.y < 0) return "dtilt";
  return "jab1";
}

/**
 * Which aerial a direction means, relative to the way the fighter is facing.
 *
 * Forward and back air are the same key with opposite facings, which is why
 * turning around mid-air changes which move comes out — and why Kirby's back air
 * is a different proposition from his forward air even though the two inputs
 * differ by nothing but a facing flag.
 */
export function aerialSlot(f: FighterState, intent: Intent): MoveSlot {
  if (intent.y < 0) return "dair";
  if (intent.y > 0) return "uair";
  if (intent.x === 0) return "nair";
  return intent.x === f.facing ? "fair" : "bair";
}

export function specialSlot(intent: Intent): MoveSlot {
  if (intent.y > 0) return "upB";
  if (intent.y < 0) return "downB";
  if (intent.x !== 0) return "sideB";
  return "neutralB";
}

export function hasMove(ctx: StateContext, slot: MoveSlot): boolean {
  return ctx.def.moves[slot] !== undefined;
}

/**
 * Start an attack, falling back down the moveset when a slot is unauthored.
 *
 * Not every fighter has every slot — a rapid jab, a dash grab — and the roster
 * data is written by hand. Falling back to a tilt and then to jab means a
 * half-finished fighter is playable rather than a crash, and keeps the engine
 * usable by the fighter author before their file is complete.
 */
export function beginAttack(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
  if (hasMove(ctx, slot)) {
    startMove(f, "attack", slot);
    return true;
  }
  if (slot === "fsmash" || slot === "usmash" || slot === "dsmash") {
    const tilt: MoveSlot = slot === "fsmash" ? "ftilt" : slot === "usmash" ? "utilt" : "dtilt";
    if (hasMove(ctx, tilt)) {
      startMove(f, "attack", tilt);
      return true;
    }
  }
  if (hasMove(ctx, "jab1")) {
    startMove(f, "attack", "jab1");
    return true;
  }
  return false;
}

export function beginSpecial(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
  if (!hasMove(ctx, slot)) return false;
  startMove(f, "special", slot);
  return true;
}

/* -------------------------------------------------- actionable behaviour -- */

/** Can a fighter in this state start something new right now? */
export function isActionable(f: FighterState): boolean {
  switch (f.action) {
    case "stand":
    case "walk":
    case "dashStart":
    case "run":
    case "runBrake":
    case "crouch":
    case "fall":
    case "tumbleFall":
    case "jump":
      return true;
    default:
      return false;
  }
}

export interface Presses {
  jump: boolean;
  attack: boolean;
  special: boolean;
  grab: boolean;
  shield: boolean;
}

/** This frame's presses, with a still-valid buffered press folded in. */
export function presses(f: FighterState, intent: Intent, frame: number): Presses {
  const b = peekBuffer(f, frame);
  const p: Presses = {
    jump: intent.jumpPressed || b === "jump",
    attack: intent.attackPressed || b === "attack",
    special: intent.specialPressed || b === "special",
    grab: intent.grabPressed || b === "grab",
    shield: intent.shieldPressed || b === "shield",
  };
  if (b !== null) f.bufferedAction = null;
  return p;
}

export function airJump(f: FighterState, ctx: StateContext): boolean {
  const p = fighterParams(ctx.def);
  if (f.jumpsUsed >= p.jump_count_max) return false;
  f.jumpsUsed += 1;
  // A multi-jumper's midair jumps each have their own height; the first midair
  // jump is the one whose `jumpsUsed` is now 2. The index is clamped at both ends:
  // an airborne fighter that never spent the ground jump would read before the list.
  const list = p.jump_aerial_y_list;
  const height = list === undefined ? p.jump_aerial_y : list[Math.min(Math.max(f.jumpsUsed - 2, 0), list.length - 1)];
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, height));
  f.fastFalling = false;
  // An air jump is a full jump at full height: whatever the hop that got the
  // fighter here was, the short-hop penalty ends with it.
  f.shortHop = false;
  startAction(f, "jump");
  return true;
}

/** What a fighter pressing nothing means, for the frames `landsWithin` imagines. */
const NO_INPUT: Intent = {
  x: 0,
  y: 0,
  jumpPressed: false,
  jumpHeld: false,
  attackPressed: false,
  attackHeld: false,
  specialPressed: false,
  shieldHeld: false,
  shieldPressed: false,
  shieldReleased: false,
  grabPressed: false,
  downPressed: false,
  wantsDash: false,
  smash: false,
  smashX: 0,
  smashY: 0,
  sdiX: 0,
  sdiY: 0,
  soft: false,
};

/**
 * Would this airborne tumbling fighter, left alone, land on a floor within the
 * next `frames` frames (this one included), at a launch the floor tech takes?
 *
 * Exact, not an estimate: it replays the frames on a scratch copy with the
 * movement and the collision the step itself runs (`applyMovement`,
 * `integrate`, `resolveCollision`, with the frame number, so a moving platform
 * is where it will be), and the ledge grab that would end the fall first. What
 * it assumes is that nothing else happens: this frame is played with the
 * `intent` it has, the later ones with no input, the hitstun runs down and a
 * tumble that runs out tumbles on (`tumbleFall`), and nobody else touches it.
 * It does not run the status's `main`, which could ask this very question again;
 * so a fast fall pressed on this frame, which lands it sooner, is not seen
 * (that errs towards "no", never towards a landing that does not happen).
 *
 * Pure: the fighter and the state are not touched. `kinetic` and `combat` are
 * the two sub-objects the replay writes, and are copied; the arrays and the
 * buffered action it only reads. Integer arithmetic, and only the state, the
 * stage and the frame. Plan 3, Task 12.
 */
export function landsWithin(f: FighterState, intent: Intent, ctx: StateContext, frames: number): boolean {
  const g: FighterState = { ...f, kinetic: cloneKinetic(f.kinetic), combat: cloneCombat(f.combat) };
  const attrs = ctx.def.attributes;
  for (let k = 0; k < frames; k++) {
    if (k > 0) {
      // Phase 3 for a fighter nobody touches: the hitstun runs down, and a tumble
      // whose hitstun is over in the air tumbles on (`reelMain`).
      if (g.hitstun > 0) g.hitstun -= 1;
      if (g.hitstun === 0) {
        g.balloon = false;
        if (g.action === "tumble") startAction(g, "tumbleFall");
      }
    }
    applyMovement(g, k === 0 ? intent : NO_INPUT, ctx);
    const prevX = g.x;
    const prevY = g.y;
    integrate(g);
    const speed = g.launchSpeed;
    const frame = ctx.frame + k;
    if (resolveCollision(g, prevX, prevY, ctx.stage, attrs, frame).landed) return speed <= TECH_FLOOR_MAX_SPEED;
    if (!g.grounded && findLedgeGrab(g, ctx.stage, frame, ecbOf(g, attrs).half) !== null) return false;
  }
  return false;
}

/**
 * A tumbling fighter pressing shield (or holding it) with the floor under it
 * inside the tech window, and a tech input live, is making a tech input, not
 * asking for an air dodge (Plan 3, Task 12).
 * SmashWiki "Lucario (SSBU)/Techs": "a neutral airdodge option within 15 frames
 * of landing will also activate a tech option": in the game the one press does
 * both. The replica's air dodge stops dead where it starts and could not reach
 * the floor, so a press that close to landing is read as the tech alone.
 *
 * Only while the tech is real: `updateTechInput` has already run, so
 * `techWindow` is what this frame's collision will see (a press inside the
 * 40-frame lockout opens none, and then it is an air dodge, as it was); and
 * only if the landing falls inside what is left of it (`landsWithin`), or a
 * shield held from an earlier frame, which techs a floor, is keeping it live
 * (on the frame it is pressed a shield is held too, but that is the press).
 * UNVERIFIED: that reading, and `TECH_WINDOW` as how close "close" is.
 * `tumble` is the hitstun cancel's side of it (`status/damage.ts`),
 * `tumbleFall` the other (`handleActionable`).
 */
export function techInputNearFloor(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (f.action !== "tumble" && f.action !== "tumbleFall") return false;
  // A shield held from before this frame keeps the floor tech live; the frame a
  // press is made it is "held" too, which is no reason to read it as one.
  const held = intent.shieldHeld && !intent.shieldPressed;
  const live = Math.max(f.combat.techWindow, held ? TECH_WINDOW : 0);
  return live > 0 && landsWithin(f, intent, ctx, live);
}

export function startAirDodge(f: FighterState, intent: Intent): boolean {
  if (f.airDodged) return false;
  f.airDodged = true;
  // An air dodge begun out of a tumble techs on a surface in its first 15
  // frames (Task 12); read before the status changes.
  const fromTumble = f.action === "tumble" || f.action === "tumbleFall";
  const directional = intent.x !== 0 || intent.y !== 0;
  startAction(f, "airDodge");
  f.combat.tumbleDodge = fromTumble;
  // `charge` is meaningless outside a smash, so an air dodge borrows it to
  // remember whether it was directional — which decides both its length (63
  // frames against 50) and its intangible window.
  f.charge = directional ? 1 : 0;
  if (directional) {
    const diagonal = intent.x !== 0 && intent.y !== 0;
    const speed = diagonal
      ? Math.trunc((DIRECTIONAL_AIR_DODGE_SPEED * DIAGONAL) / ONE)
      : DIRECTIONAL_AIR_DODGE_SPEED;
    kineticSet(f, intent.x * speed, intent.y * speed);
  } else {
    kineticSet(f, 0, 0);
  }
  f.launchSpeed = 0;
  return true;
}

/**
 * Everything a fighter who is free to act might do, in priority order.
 *
 * The order is the game's: shield and dodge beat attacks, attacks beat movement,
 * because a player who presses two things on one frame meant the more committal
 * one. Returns true if a new action started, so the caller knows not to run the
 * ordinary movement branch.
 */
export function handleActionable(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  const p = presses(f, intent, ctx.frame);

  if (f.grounded) {
    if (p.shield || intent.shieldHeld) {
      startAction(f, "shieldStart");
      return true;
    }
    if (p.grab) {
      const slot: MoveSlot = f.action === "run" || f.action === "dashStart" ? "dashGrab" : "grab";
      startMove(f, "grab", hasMove(ctx, slot) ? slot : "grab");
      return true;
    }
    if (p.special && beginSpecial(f, ctx, specialSlot(intent))) return true;
    if (p.attack && beginAttack(f, ctx, groundAttackSlot(f, intent))) return true;
    if (p.jump) {
      startAction(f, "jumpSquat");
      return true;
    }
    if (intent.downPressed && dropThroughPlatform(f, ctx.stage)) {
      startAction(f, "fall");
      return true;
    }
    return false;
  }

  // Airborne.
  if ((p.shield || intent.shieldHeld) && !techInputNearFloor(f, intent, ctx) && startAirDodge(f, intent)) return true;
  if (p.special && beginSpecial(f, ctx, specialSlot(intent))) return true;
  if (p.attack) {
    const slot = aerialSlot(f, intent);
    if (hasMove(ctx, slot)) {
      startMove(f, "attack", slot);
      return true;
    }
    return false;
  }
  if (p.jump && airJump(f, ctx)) return true;
  return false;
}

/* ------------------------------------------------------ the state machine -- */

/**
 * Advance one fighter by one frame of action state.
 *
 * Called after hitlag has been decremented and before physics, so every branch
 * here can assume the fighter is not frozen. Mutates in place: `step()` is
 * already working on its own clone by this point.
 */
export function advanceFighter(f: FighterState, intent: Intent, ctx: StateContext, table: StatusTable = STATUS_TABLE): void {
  f.actionFrame += 1;
  updateDodgeIntangibility(f);

  const status = table[f.action];
  if (status === undefined) {
    // Every status lives in `status/` and registers itself from
    // `status/index.ts`. Reaching here means that module was never imported.
    throw new Error(`no status registered for "${f.action}"; import "@/engine/status"`);
  }
  status.main(f, intent, ctx);
}

/**
 * Put a fighter back on the stage when its ledge option finishes.
 *
 * Ledge options are a teleport rather than a trajectory, which is a genuine
 * simplification and a deliberate one: the alternative is running collision
 * against the very ledge the fighter is climbing over, which lands it back on
 * the ledge it is trying to leave on the first frame of every getup.
 */
export function finishLedgeOption(f: FighterState, ctx: StateContext): void {
  const ledge = f.ledge;
  f.ledge = null;
  if (f.action === "ledgeJump") {
    kineticSetY(f, LEDGE_JUMP_VELOCITY);
    f.jumpsUsed = 1;
    startAction(f, "jump");
    return;
  }
  if (ledge === null || ledge.platform >= ctx.stage.platforms.length) {
    startAction(f, "fall");
    return;
  }
  const p = ctx.stage.platforms[ledge.platform];
  const inward = -ledge.side;
  const distance = f.action === "ledgeRoll" ? LEDGE_ROLL_DISTANCE : LEDGE_GETUP_DISTANCE;
  f.x = platformCentreX(p, ctx.frame) + ledge.side * p.halfWidth + inward * distance;
  f.y = p.y;
  kineticSet(f, 0, 0);
  f.grounded = true;
  f.platform = ledge.platform;
  f.jumpsUsed = 0;
  f.airDodged = false;
  f.airTime = 0;
  startAction(f, "stand");
}

/**
 * The statuses a captor can be in and still be holding someone: CATCH, CATCH_WAIT,
 * CATCH_ATTACK and THROW. A fighter in any other status with `grabbing` set has
 * stopped holding (a clank cancelled the pummel, say), and the link ends there.
 */
export function isHolding(action: ActionState): boolean {
  return action === "grab" || action === "grabHold" || action === "pummel" || action === "throw";
}

/**
 * Sever every grab this fighter is part of, from **both** ends.
 *
 * A grab is one relationship stored twice: `grabbing` on the holder and
 * `grabbedBy` on the victim. Clearing only the holder's half looks like it
 * works — the holder returns to `stand` and the animation ends — while leaving
 * the victim with `grabbedBy >= 0`, and the only exit from the `grabbed` state
 * is `grabbedBy < 0`. The result is a fighter frozen in a grab that nobody is
 * holding, for the rest of the match. Every path that ends a grab (the hold
 * timer running out, a throw finishing, either fighter being hit, either
 * fighter being KO'd) goes through here, and each call passes whichever end it
 * happens to have.
 *
 * Symmetric and idempotent: it takes either role, clears both, and does nothing
 * to a fighter who is not grabbing and is not grabbed. The `=== f.port` guards
 * matter in a four-player match — a stale index must not be allowed to clear a
 * link that now belongs to somebody else.
 */
export function releaseGrab(f: FighterState, fighters: readonly FighterState[]): void {
  if (f.grabbing >= 0) {
    const victim = fighters[f.grabbing];
    if (victim !== undefined && victim.grabbedBy === f.port) {
      victim.grabbedBy = -1;
      // The escape timer is the victim's (Plan 3, Task 14): it goes with the link.
      victim.grabTimer = 0;
    }
  }
  if (f.grabbedBy >= 0) {
    const holder = fighters[f.grabbedBy];
    if (holder !== undefined && holder.grabbing === f.port) holder.grabbing = -1;
  }
  f.grabbing = -1;
  f.grabbedBy = -1;
  f.grabTimer = 0;
}

/**
 * Invincibility granted for stepping off the respawn platform.
 *
 * Ultimate pays you for leaving early and charges you for waiting: the grant
 * starts at `RESPAWN_INVINCIBILITY_MAX` for a fighter who drops in at once and
 * falls away linearly with the frames spent up there, bottoming out at
 * `RESPAWN_INVINCIBILITY_MIN` for one who rides the platform to its own
 * expiry. Handing out the maximum regardless — which is what the grant on
 * *entry* alone amounted to — makes waiting free, and waiting is exactly the
 * thing the scaling exists to price. SPEC §4, research §9.
 */
export function respawnInvincibilityFrames(framesWaited: number): number {
  const waited = clamp(framesWaited, 0, RESPAWN_PLATFORM_FRAMES);
  const span = RESPAWN_INVINCIBILITY_MAX - RESPAWN_INVINCIBILITY_MIN;
  return RESPAWN_INVINCIBILITY_MAX - Math.floor((span * waited) / RESPAWN_PLATFORM_FRAMES);
}

/* --------------------------------------------------------------- movement -- */

/**
 * Is this fighter inside a move's super-armour window?
 *
 * Read from the move's `game_` script on the frame the move is on, which is
 * derived from `move` and `actionFrame`, both of which are already simulation
 * state, so armour rolls back with everything else and needs no field of its
 * own. `superArmourFrames` has been in the type — and on Donkey Kong's Giant
 * Punch — since the roster was written, and until this was read it did nothing
 * at all: the one move in the game that is *defined* by walking through a jab
 * flinched like everybody else.
 */
export function hasSuperArmour(f: FighterState, def: FighterDef): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special") return false;
  return moveScriptFrame(def, f)?.state.superArmour === true;
}

/**
 * A move's own scripted movement, if it has one on this frame.
 *
 * This is what makes a Fox Illusion cross the stage, a Dolphin Slash rise, and
 * a Stone drop like a stone. It is read from the move's `game_` script
 * (`moveScriptFrame`: the `momentum` its commands have set by this frame, and
 * the game frame it holds `until`), compiled from `MoveDef.momentum` for every
 * legacy move (`acmd/legacy.ts`), so the script and the move cannot disagree.
 *
 * The velocity is **set**, not added (`kineticMotion` on the MOTION energy):
 * these are scripted movements with a definite speed, and adding would make a
 * Fox Illusion out of a run faster than one from a standstill. `x` is
 * facing-relative and `y` absolute, matching the projectile convention.
 *
 * The hold is what makes it a drop rather than a hop. Without it, gravity claws
 * the velocity back to the fighter's ordinary fall speed on the very next
 * frame, and a stone falls at exactly the speed a puffball does.
 *
 * Returns true while a hold is live, so the caller knows to leave gravity and
 * air drift alone.
 */
function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
  const live = f.move !== null && (f.action === "attack" || f.action === "special" || f.action === "throw");
  const run = live ? moveScriptFrame(ctx.def, f) : null;
  const m = run?.state.momentum ?? null;
  if (run === null || m === null) {
    // No hold is live: the move ended, was cut short (a landing clears `move`
    // mid-hold, so its last frame never ran) or has not reached its momentum.
    // Whatever velocity a hold left becomes drift and gravity's; no-op if none.
    kineticEndMotion(f);
    return false;
  }
  // The floor still wins. A downward impulse on a grounded fighter drove
  // them straight through the stage — a grounded Stone fell out of the world.
  // A Stone used on the ground simply sits there, as it does in the real game.
  kineticMotion(f, m.x * (f.facing >= 0 ? 1 : -1), f.grounded && m.y < 0 ? 0 : m.y);
  const holding = run.gameFrame < m.until;
  // On the last frame of the hold, drift and gravity take over this very frame.
  if (!holding) kineticEndMotion(f);
  return holding;
}

/**
 * Turn the current action into this frame's velocity.
 *
 * Split from `advanceFighter` because the transition and the movement answer
 * different questions — "what am I doing" and "how fast am I going" — and because
 * a state that has just been entered should move on the frame it is entered,
 * which a single combined pass gets wrong half the time depending on branch order.
 */
export function applyMovement(f: FighterState, intent: Intent, ctx: StateContext): void {
  const status = STATUS_TABLE[f.action];
  if (status === undefined) {
    throw new Error(`no status registered for "${f.action}"; import "@/engine/status"`);
  }
  const type = status.kineticType;
  const carrier = carrierOf(type);
  // Fold any direct write to vx/vy since the last frame into the energies.
  kineticAdopt(f, carrier);

  if (f.ledge !== null) {
    kineticClear(f);
    return;
  }

  // Scripted movement outranks everything below it — that is the point of a
  // move that carries its own — but only for as long as it is held.
  if (f.hitstun <= 0 && applyMoveMomentum(f, ctx)) return;

  if (f.hitstun > 0) {
    kineticReel(f, fighterParams(ctx.def), hitstunGravityOptions(f).balloon === true);
    return;
  }

  const w = dodgeWindow(f);
  kineticExec(f, type, {
    stickX: intent.x,
    stickMag: intent.soft ? ONE >> 1 : ONE,
    params: fighterParams(ctx.def),
    // An air dodge holds its own velocity outright; gravity resumes when the
    // intangible window closes, which is what makes a missed one a free punish.
    holdVertical: f.action === "airDodge" && w !== null && f.actionFrame <= w[1],
  });
  status.exec?.(f, intent, ctx);
}

/* -------------------------------------------------------------- landings -- */

/**
 * A fighter touched the ground. What that costs depends on what it was doing.
 *
 * Landing during an aerial pays that move's landing lag — unless the move
 * auto-cancels, which is the whole reason `autoCancelBefore`/`After` exist and
 * the reason a rising nair is safe while a falling one is not.
 */
export function onLanded(f: FighterState, ctx: StateContext): void {
  const p = fighterParams(ctx.def);
  // Heavy if the fighter spent `landing_heavy_frame` frames at full fall
  // speed (SmashWiki "Lag", normal landing); read before it is reset.
  // UNVERIFIED: ">=" rather than ">" — the threshold's inclusivity is unpublished.
  const heavy = f.kinetic.fallFrames >= p.landing_heavy_frame;
  f.kinetic.fallFrames = 0;
  f.fastFalling = false;
  f.launchSpeed = 0;
  f.jumpsUsed = 0;
  f.airDodged = false;
  f.airTime = 0;
  // The hop is over, so the next one decides its own height and its own damage.
  f.shortHop = false;

  // A tumble that reaches the floor lies down: in hitstun, one too slow to
  // bounce (`techOrBounce`); after it (`tumbleFall`), at any speed — DAMAGE_FALL
  // has no bounce (SmashWiki "Tumbling": "they will land into a lying position").
  if (f.action === "tumble" || f.action === "tumbleFall") {
    f.hitstun = 0;
    kineticSetX(f, 0, "stop");
    startAction(f, "downed");
    return;
  }
  if (f.hitstun > 0) return; // still reeling; the landing does not interrupt it
  if (f.action === "attack" && f.move !== null) {
    const move = ctx.def.moves[f.move];
    if (move?.landingLag !== undefined) {
      const early = move.autoCancelBefore !== undefined && f.actionFrame <= move.autoCancelBefore;
      const late = move.autoCancelAfter !== undefined && f.actionFrame >= move.autoCancelAfter;
      if (early || late) {
        // An auto-cancelled aerial lands heavily (SmashWiki "Lag", aerial landing).
        // UNVERIFIED: that this holds in Ultimate; the page's "landing in the
        // auto-cancel window is a heavy landing" rule may describe an earlier game.
        startAction(f, "land");
        f.charge = p.landing_frame;
        return;
      }
      startAction(f, "landingLag");
      // `charge` is free once a move is over and carries the remaining lag,
      // which keeps `FighterState` from growing a field that is zero all match.
      f.charge = move.landingLag;
      return;
    }
  }
  if (f.action === "airDodge") {
    // Read before `startAction`, which clears it: `charge` is how an air dodge
    // remembers it was directional (see `updateDodgeIntangibility`).
    const directional = f.charge === 1;
    startAction(f, "landingLag");
    f.charge = directional ? DIRECTIONAL_AIR_DODGE_LANDING_LAG : AIR_DODGE_LANDING_LAG;
    return;
  }
  startAction(f, "land");
  // `charge` carries the landing's length, as it does for landingLag.
  // UNVERIFIED: that the published lag is the number of frames spent in `land`.
  f.charge = heavy ? p.landing_frame : p.landing_frame_light;
}

/**
 * A fighter left the ground without jumping: walked off an edge, or a move of its
 * own (a rising special) lifted it.
 *
 * Leaving the ground any way but a jump spends the ground jump: the fighter has
 * `jump_count_max − 1` midair jumps, not one more. SmashWiki Double jump
 * (https://www.ssbwiki.com/Double_jump): "Most characters can only jump once
 * while airborne"; SmashWiki Jump (https://www.ssbwiki.com/Jump): "Kirby, Meta
 * Knight, and Jigglypuff can do a midair jump five times." The spend does not
 * depend on the fighter being actionable: a special that carries it off the
 * edge, or up off the floor, is still a way of leaving the ground.
 */
export function onLeftGround(f: FighterState): void {
  if (f.action === "jumpSquat") return;
  f.jumpsUsed = Math.max(f.jumpsUsed, 1);
  if (isActionable(f)) startAction(f, "fall");
}

/**
 * Ledge trump (Plan 3, Task 15): another fighter grabbed the ledge `f` was
 * hanging on, so `f` lets go — losing the ledge's intangibility — and cannot
 * act for a moment (SmashWiki "Ledge trump", https://www.ssbwiki.com/Ledge_trump:
 * "grabbing onto a ledge that has already been grabbed by another player will
 * gently remove them from the ledge", who "cannot take any action for a
 * moment").
 *
 * A hanging fighter stands on the ledge point, so it is set `clearance` outboard
 * first, or it would land on the stage it was just removed from (UNVERIFIED
 * placement until Plan 4's ECB). `ledgeLockout` keeps it off every ledge for the
 * length of the lag: it is the one rule for "cannot grab a ledge" (`findLedgeGrab`),
 * so no other phase has to know the fighter is trumped. `ledgeRegrabs` is left
 * as it was: the wiki names hitstun and touching the ground as what resets that
 * count (SmashWiki "Ledge"), and a trump is neither.
 */
export function trumpLedge(f: FighterState, clearance: number): void {
  if (f.ledge !== null) f.x += f.ledge.side * clearance;
  f.ledge = null;
  f.intangible = 0;
  f.ledgeLockout = LEDGE_TRUMPED_FRAMES;
  kineticClear(f);
  startAction(f, "ledgeTrumped");
}

/** Snap a fighter onto a ledge it just grabbed. */
export function grabLedge(
  f: FighterState,
  platform: number,
  side: number,
  x: number,
  y: number,
  intangibility: number,
): void {
  f.ledge = { platform, side };
  f.x = x;
  f.y = y;
  kineticClear(f);
  f.facing = -side;
  // A ledge grab restores the midair jumps (SmashWiki Double jump, https://www.ssbwiki.com/Double_jump:
  // "A character's double jump(s) are restored upon landing, grabbing a ledge, being KO'd and
  // respawning, or being grabbed by an opposing character"). The fighter is still in the air,
  // so the ground jump stays spent: a drop or a hit off the ledge leaves jump_count_max − 1.
  f.jumpsUsed = 1;
  f.airDodged = false;
  f.fastFalling = false;
  f.shortHop = false;
  f.ledgeRegrabs += 1;
  f.intangible = Math.max(f.intangible, intangibility);
  startAction(f, "ledgeHang");
}

/* --------------------------------------------------------------- shields -- */

/** Is this action one where the fighter's shield is up and taking hits? */
export function isShielding(action: ActionState): boolean {
  return action === "shield" || action === "shieldStart" || action === "shieldStun";
}

/**
 * Is this fighter inside the parry window?
 *
 * Ultimate's defining defensive change: the perfect shield is on *release*. The
 * first 5 frames of the 11-frame drop animation parry anything that touches
 * them, so the reward goes to a player who read the attack and let go, not to one
 * who pressed shield late. `SHIELD_MIN_HOLD` on the way in stops it being a mash.
 */
export function isParrying(f: FighterState): boolean {
  // Frames 0 through 4 of the drop: five frames, counting the one the shield was
  // released on, because hits resolve later in that same frame.
  return f.action === "shieldRelease" && f.actionFrame < PERFECT_SHIELD_WINDOW;
}

/** Facing-aware: a shield only covers the side the fighter is looking at. */
export function shieldCovers(f: FighterState, fromX: number): boolean {
  if (!isShielding(f.action) && !isParrying(f)) return false;
  const delta = fromX - f.x;
  if (delta === 0) return true;
  return (delta > 0 ? 1 : -1) === f.facing;
}
