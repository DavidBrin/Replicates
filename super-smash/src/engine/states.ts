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

import { ONE, fx, clamp } from "./fixed";
import {
  AIR_DODGE_FRAMES,
  AIR_DODGE_INTANGIBLE,
  AIR_DODGE_LANDING_LAG,
  DIRECTIONAL_AIR_DODGE_LANDING_LAG,
  BUFFER_FRAMES,
  DASH_INTERRUPT_FRAME,
  DASH_THRESHOLD_FRAMES,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  DIRECTIONAL_AIR_DODGE_INTANGIBLE,
  DIRECTIONAL_AIR_DODGE_SPEED,
  JUMP_SQUAT_FRAMES,
  LAUNCH_SPEED_DECAY,
  LEDGE_REGRAB_LIMIT,
  PERFECT_SHIELD_WINDOW,
  RESPAWN_INVINCIBILITY_MAX,
  RESPAWN_INVINCIBILITY_MIN,
  RESPAWN_PLATFORM_FRAMES,
  ROLL_FRAMES,
  ROLL_INTANGIBLE,
  SDI_INPUT_INTERVAL,
  SHIELD_MIN_HOLD,
  SHIELD_RELEASE_FRAMES,
  SMASH_CHARGE_DAMAGE,
  SMASH_CHARGE_MAX,
  SMASH_INPUT_WINDOW,
  TAP_JUMP_FRAMES,
  SPOT_DODGE_FRAMES,
  SPOT_DODGE_INTANGIBLE,
  TUMBLE_HITSTUN,
} from "./constants";
import {
  airDrift,
  applyGravity,
  applyTraction,
  decayLaunch,
  dropThroughPlatform,
  fastFallVelocity,
  hitstunGravityOptions,
  initialDashVelocity,
  platformCentreX,
  runVelocity,
  walkVelocity,
} from "./physics";
import { clearHitRecord, moveFrameOf } from "./hitbox";
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
/** How long a grab holds before the victim escapes on their own. */
export const GRAB_HOLD_FRAMES = 60;
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
/** Upward velocity of a ledge jump. */
export const LEDGE_JUMP_VELOCITY = fx(3.1);
/** 1/√2, so a diagonal air dodge covers the same distance as a cardinal one. */
const DIAGONAL = fx(0.7071067811865476);

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
  const smash =
    pressed(input, prev, Btn.Attack) &&
    dirStillHeld &&
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
    wantsDash: x !== 0 && f.framesSinceDirPress > DASH_THRESHOLD_FRAMES,
    smash,
    smashX: smash ? dir.x : 0,
    smashY: smash ? dir.y : 0,
    sdiX: canPulse ? dir.x : 0,
    sdiY: canPulse ? dir.y : 0,
  };
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

export function startAction(f: FighterState, action: ActionState): void {
  f.action = action;
  f.actionFrame = 0;
  if (action !== "attack" && action !== "special" && action !== "throw" && action !== "pummel") {
    f.move = null;
    f.charge = 0;
  }
}

function startMove(f: FighterState, action: ActionState, slot: MoveSlot): void {
  f.action = action;
  f.actionFrame = 0;
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
function dodgeWindow(f: FighterState): readonly [number, number] | null {
  switch (f.action) {
    case "spotDodge":
      return SPOT_DODGE_INTANGIBLE;
    case "roll":
      return ROLL_INTANGIBLE;
    case "airDodge":
      return f.charge === 1 ? DIRECTIONAL_AIR_DODGE_INTANGIBLE : AIR_DODGE_INTANGIBLE;
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

function hasMove(ctx: StateContext, slot: MoveSlot): boolean {
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
function beginAttack(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
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

function beginSpecial(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
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
    case "jump":
      return true;
    default:
      return false;
  }
}

interface Presses {
  jump: boolean;
  attack: boolean;
  special: boolean;
  grab: boolean;
  shield: boolean;
}

/** This frame's presses, with a still-valid buffered press folded in. */
function presses(f: FighterState, intent: Intent, frame: number): Presses {
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

function airJump(f: FighterState, ctx: StateContext): boolean {
  const a = ctx.def.attributes;
  if (f.jumpsUsed >= a.jumps) return false;
  f.jumpsUsed += 1;
  f.vy = a.airJumpVelocity;
  f.fastFalling = false;
  f.launchSpeed = 0;
  // An air jump is a full jump at full height: whatever the hop that got the
  // fighter here was, the short-hop penalty ends with it.
  f.shortHop = false;
  startAction(f, "jump");
  return true;
}

function startAirDodge(f: FighterState, intent: Intent): boolean {
  if (f.airDodged) return false;
  f.airDodged = true;
  const directional = intent.x !== 0 || intent.y !== 0;
  startAction(f, "airDodge");
  // `charge` is meaningless outside a smash, so an air dodge borrows it to
  // remember whether it was directional — which decides both its length (63
  // frames against 50) and its intangible window.
  f.charge = directional ? 1 : 0;
  if (directional) {
    const diagonal = intent.x !== 0 && intent.y !== 0;
    const speed = diagonal
      ? Math.trunc((DIRECTIONAL_AIR_DODGE_SPEED * DIAGONAL) / ONE)
      : DIRECTIONAL_AIR_DODGE_SPEED;
    f.vx = intent.x * speed;
    f.vy = intent.y * speed;
  } else {
    f.vx = 0;
    f.vy = 0;
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
function handleActionable(f: FighterState, intent: Intent, ctx: StateContext): boolean {
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
  if ((p.shield || intent.shieldHeld) && startAirDodge(f, intent)) return true;
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
export function advanceFighter(f: FighterState, intent: Intent, ctx: StateContext): void {
  f.actionFrame += 1;
  updateDodgeIntangibility(f);

  switch (f.action) {
    /* ---------------------------------------------------------- reeling -- */
    case "hitstun":
    case "tumble": {
      if (f.hitstun > 0) {
        // Tumble is not a different kind of hitstun, it is hitstun past 32
        // frames — the point at which the victim stops being able to land and
        // instantly act, and starts having to survive.
        if (f.hitstun >= TUMBLE_HITSTUN && f.action !== "tumble") startAction(f, "tumble");
        bufferPress(f, intent, ctx.frame);
        return;
      }
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }

    case "downed": {
      if (f.actionFrame >= DOWNED_FRAMES) startAction(f, "getUp");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "getUp": {
      if (f.actionFrame >= GETUP_FRAMES) startAction(f, "stand");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    /* ------------------------------------------------------------ meta -- */
    case "entering": {
      if (f.actionFrame >= ENTRY_FRAMES) startAction(f, f.grounded ? "stand" : "fall");
      return;
    }

    case "dead": {
      // Out of stocks is a terminal state: no respawn, and the match-end check
      // in `step` reads it rather than a separate "eliminated" flag.
      if (f.stocks <= 0) return;
      if (f.actionFrame >= DEAD_FRAMES) {
        const spawns = ctx.stage.spawns;
        const spawn = spawns[f.port % spawns.length];
        f.x = spawn.x;
        f.y = spawn.y;
        f.vx = 0;
        f.vy = 0;
        f.grounded = false;
        f.platform = -1;
        f.jumpsUsed = 0;
        f.airDodged = false;
        f.shortHop = false;
        f.ledgeRegrabs = 0;
        startAction(f, "respawnPlatform");
        // Covers the transition frame; the platform then holds it up itself and
        // the departure grant replaces it on the way out.
        f.invincible = RESPAWN_INVINCIBILITY_MAX;
      }
      return;
    }

    case "respawnPlatform": {
      const leaving =
        f.actionFrame >= RESPAWN_PLATFORM_FRAMES ||
        intent.jumpPressed ||
        intent.attackPressed ||
        intent.x !== 0 ||
        intent.y !== 0;
      if (leaving) {
        // The grant is decided on the way *out*, from how long the fighter
        // stayed, which is the whole point of it: a player who drops straight
        // back into the fight is protected while they re-enter, and one who
        // waits out the platform's 300 frames gets the 60-frame floor.
        f.invincible = respawnInvincibilityFrames(f.actionFrame);
        startAction(f, "fall");
        return;
      }
      // Standing on the platform is safe for as long as the platform lasts,
      // which is longer than any departure grant — so it is held up a frame at
      // a time (as the dodge windows are) rather than counted down from one.
      f.invincible = Math.max(f.invincible, 1);
      return;
    }

    /* --------------------------------------------------------- defence -- */
    case "shieldStart": {
      if (f.actionFrame >= SHIELD_START_FRAMES) startAction(f, "shield");
      return;
    }

    case "shield": {
      // The shield may not be dropped for its first 3 frames, which is what
      // makes a perfect shield a commitment rather than something you mash.
      if (!intent.shieldHeld && f.actionFrame >= SHIELD_MIN_HOLD) {
        startAction(f, "shieldRelease");
        return;
      }
      const p = presses(f, intent, ctx.frame);
      if (p.jump) {
        startAction(f, "jumpSquat");
        return;
      }
      if (p.grab) {
        startMove(f, "grab", "grab");
        return;
      }
      if (p.attack && hasMove(ctx, "usmash")) {
        startMove(f, "attack", "usmash");
        return;
      }
      if (intent.y < 0) {
        startAction(f, "spotDodge");
        return;
      }
      if (intent.x !== 0) {
        startAction(f, "roll");
        f.vx = intent.x * Math.trunc(ROLL_DISTANCE / ROLL_FRAMES);
        return;
      }
      return;
    }

    case "shieldRelease": {
      if (f.actionFrame >= SHIELD_RELEASE_FRAMES) startAction(f, "stand");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "shieldStun": {
      // Shieldstun reuses the `hitstun` counter: a shielding fighter is never
      // simultaneously in hitstun, and the alternative is a field that exists to
      // be zero 99% of the time and hashed on every frame regardless.
      if (f.hitstun > 0) {
        bufferPress(f, intent, ctx.frame);
        return;
      }
      startAction(f, intent.shieldHeld ? "shield" : "shieldRelease");
      return;
    }

    case "shieldBroken": {
      if (f.hitstun > 0) return;
      startAction(f, "stand");
      return;
    }

    case "spotDodge": {
      if (f.actionFrame >= SPOT_DODGE_FRAMES) startAction(f, "stand");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "roll": {
      if (f.actionFrame >= ROLL_FRAMES) {
        f.vx = 0;
        startAction(f, "stand");
      } else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "airDodge": {
      const total = f.charge === 1 ? DIRECTIONAL_AIR_DODGE_FRAMES : AIR_DODGE_FRAMES;
      if (f.actionFrame >= total) startAction(f, "fall");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    /* ---------------------------------------------------------- offence -- */
    case "attack":
    case "special": {
      const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
      if (move === undefined) {
        startAction(f, f.grounded ? "stand" : "fall");
        return;
      }
      // Charging a smash holds the animation one frame short of its first hitbox.
      if (move.chargeable && f.charge < SMASH_CHARGE_MAX && intent.attackHeld) {
        const holdFrame = Math.max(1, (move.hitboxes[0]?.startFrame ?? 1) - 1);
        if (f.actionFrame >= holdFrame) {
          f.actionFrame = holdFrame;
          f.charge += 1;
          return;
        }
      }
      if (
        move.followUp !== undefined &&
        intent.attackPressed &&
        f.actionFrame >= 3 &&
        hasMove(ctx, move.followUp)
      ) {
        startMove(f, "attack", move.followUp);
        return;
      }
      if (f.actionFrame >= move.totalFrames) {
        startAction(f, f.grounded ? "stand" : "fall");
        return;
      }
      bufferPress(f, intent, ctx.frame);
      return;
    }

    case "grab": {
      if (f.grabbing >= 0) {
        startAction(f, "grabHold");
        f.grabTimer = GRAB_HOLD_FRAMES;
        return;
      }
      const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
      if (f.actionFrame >= (move?.totalFrames ?? 30)) {
        startAction(f, f.grounded ? "stand" : "fall");
      } else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "grabHold": {
      if (f.grabbing < 0) {
        releaseGrab(f, ctx.fighters);
        startAction(f, "stand");
        return;
      }
      f.grabTimer -= 1;
      if (f.grabTimer <= 0) {
        releaseGrab(f, ctx.fighters);
        startAction(f, "stand");
        return;
      }
      const p = presses(f, intent, ctx.frame);
      if (p.attack && hasMove(ctx, "pummel")) {
        startMove(f, "pummel", "pummel");
        return;
      }
      const throwSlot: MoveSlot | null =
        intent.y > 0
          ? "uthrow"
          : intent.y < 0
            ? "dthrow"
            : intent.x === f.facing
              ? "fthrow"
              : intent.x === -f.facing
                ? "bthrow"
                : null;
      if (throwSlot !== null && hasMove(ctx, throwSlot)) {
        startMove(f, "throw", throwSlot);
        // The victim is being carried now, not held. `thrown` and `grabbed`
        // are different animations for a reason — one is a fighter struggling
        // against a grip, the other is a fighter already committed to a
        // trajectory — and until now nothing ever entered `thrown`, so the
        // second of them could not happen.
        const carried = f.grabbing >= 0 ? ctx.fighters[f.grabbing] : undefined;
        if (carried !== undefined && carried.grabbedBy === f.port) {
          startAction(carried, "thrown");
        }
        return;
      }
      return;
    }

    case "pummel": {
      if (f.actionFrame >= PUMMEL_FRAMES) startAction(f, "grabHold");
      return;
    }

    case "throw": {
      const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
      if (f.actionFrame >= (move?.totalFrames ?? THROW_FRAMES)) {
        // A throw normally releases through its own hitbox connecting, but a
        // throw whose hitbox never lands (an unauthored one, or one whose
        // victim was taken away mid-animation) would otherwise end with the
        // link still tying two fighters together. The animation finishing is
        // the backstop: nobody is held once the throw is over.
        releaseGrab(f, ctx.fighters);
        startAction(f, f.grounded ? "stand" : "fall");
      }
      return;
    }

    case "grabbed": {
      if (f.grabbedBy < 0) startAction(f, f.grounded ? "stand" : "fall");
      return;
    }

    case "thrown": {
      // Still in the thrower's hands: the release is the throw's hitbox
      // connecting, which `applyHit` turns into hitstun or tumble. Leaving on
      // `hitstun <= 0` alone would end the carry on its first frame.
      if (f.grabbedBy >= 0) return;
      if (f.hitstun <= 0) startAction(f, f.grounded ? "stand" : "fall");
      return;
    }

    /* ------------------------------------------------------------ ledge -- */
    case "ledgeHang": {
      if (f.actionFrame < LEDGE_HANG_MIN) return;
      const p = presses(f, intent, ctx.frame);
      const inward = f.ledge !== null ? -f.ledge.side : f.facing;
      if (p.jump) {
        startAction(f, "ledgeJump");
        return;
      }
      if (p.attack) {
        startAction(f, "ledgeAttack");
        return;
      }
      if (intent.shieldHeld) {
        startAction(f, "ledgeRoll");
        return;
      }
      if (intent.y > 0 || intent.x === inward) {
        startAction(f, "ledgeGetUp");
        return;
      }
      if (intent.y < 0 || intent.x === -inward) {
        f.ledge = null;
        f.intangible = 0;
        startAction(f, "fall");
        return;
      }
      // Six grabs and the game stops letting you hang: you get up whether you
      // like it or not, which is what makes ledge-stalling a losing plan.
      if (f.ledgeRegrabs > LEDGE_REGRAB_LIMIT) startAction(f, "ledgeGetUp");
      return;
    }

    case "ledgeGetUp":
    case "ledgeAttack":
    case "ledgeRoll":
    case "ledgeJump": {
      const total =
        f.action === "ledgeGetUp"
          ? LEDGE_GETUP_FRAMES
          : f.action === "ledgeAttack"
            ? LEDGE_ATTACK_FRAMES
            : f.action === "ledgeRoll"
              ? LEDGE_ROLL_FRAMES
              : LEDGE_JUMP_FRAMES;
      if (f.actionFrame < total) {
        bufferPress(f, intent, ctx.frame);
        return;
      }
      finishLedgeOption(f, ctx);
      return;
    }

    /* ------------------------------------------------------- locomotion -- */
    case "jumpSquat": {
      if (f.actionFrame < JUMP_SQUAT_FRAMES) {
        // An attack pressed inside jumpsquat is Ultimate's short-hop aerial
        // macro: you cannot buffer a *full*-hop aerial, and an attack during
        // jumpsquat always produces a short hop. Buffering it directly rather
        // than through `bufferPress` because that would prefer a jump press on
        // the same frame, and it is the attack that decides the hop's height.
        if (intent.attackPressed) f.bufferedAction = { kind: "attack", frame: ctx.frame };
        return;
      }
      // Short hop vs. full hop is decided here and nowhere else: whether the
      // button is up on the frame jumpsquat ends is the whole test — or whether
      // an aerial is already buffered, which forces the hop short whatever the
      // jump key is doing. Ultimate's universal 3-frame jumpsquat is what makes
      // that a real decision rather than a character-specific execution barrier.
      const a = ctx.def.attributes;
      const short = !intent.jumpHeld || peekBuffer(f, ctx.frame) === "attack";
      f.vy = short ? a.shortHopVelocity : a.fullHopVelocity;
      // The 0.85× damage penalty rides on this flag for the whole airtime; see
      // `FighterState.shortHop` and SPEC §4.
      f.shortHop = short;
      f.grounded = false;
      f.platform = -1;
      f.jumpsUsed = 1;
      f.fastFalling = false;
      startAction(f, "jump");
      return;
    }

    case "land": {
      if (f.actionFrame >= LANDING_ANIMATION_FRAMES) startAction(f, "stand");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "landingLag": {
      // `charge` carries the remaining lag; see `onLanded`.
      if (f.actionFrame >= f.charge) {
        f.charge = 0;
        startAction(f, "stand");
      } else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "crouchStart": {
      if (f.actionFrame >= CROUCH_START_FRAMES) startAction(f, "crouch");
      return;
    }

    case "crouch": {
      if (handleActionable(f, intent, ctx)) return;
      if (intent.y >= 0) startAction(f, "crouchEnd");
      return;
    }

    case "crouchEnd": {
      if (f.actionFrame >= CROUCH_END_FRAMES) startAction(f, "stand");
      return;
    }

    case "turnaround": {
      if (f.actionFrame >= TURNAROUND_FRAMES) startAction(f, "stand");
      return;
    }

    case "runBrake": {
      if (handleActionable(f, intent, ctx)) return;
      if (f.actionFrame >= RUN_BRAKE_FRAMES) startAction(f, "stand");
      return;
    }

    case "stand":
    case "walk":
    case "dashStart":
    case "run": {
      if (!f.grounded) {
        startAction(f, "fall");
        return;
      }
      if (handleActionable(f, intent, ctx)) return;
      if (intent.y < 0 && f.action === "stand") {
        startAction(f, "crouchStart");
        return;
      }
      if (intent.x === 0) {
        if (f.action === "run") startAction(f, "runBrake");
        else if (f.action !== "stand") startAction(f, "stand");
        return;
      }
      if (intent.x !== f.facing) {
        f.facing = intent.x;
        // Reversing out of a run costs a turnaround; reversing out of an initial
        // dash does not, and that asymmetry is exactly what dash-dancing is.
        if (f.action === "run") {
          startAction(f, "turnaround");
          return;
        }
        if (f.action === "dashStart") {
          startAction(f, "dashStart");
          return;
        }
        // From a standstill or a walk, though, a reversal is just a fresh
        // direction press and takes the same walk-then-dash path as any other,
        // below. Committing it to `dashStart` here instead would hand a
        // one-frame tap the full initial-dash burst — around 19 units of slide
        // for Mario, a quarter of Battlefield — and there would be no way at all
        // to make a small movement away from the way you happen to be facing.
      }
      if (f.action === "dashStart") {
        if (f.actionFrame >= DASH_INTERRUPT_FRAME) startAction(f, "run");
        return;
      }
      if (f.action === "run") return;
      /*
       * Held three frames or less is a walk; past that it becomes a dash.
       *
       * This reads oddly against SPEC §6 — if any sustained hold becomes a dash,
       * when does anybody walk? — and the answer is that they do not, and should
       * not. **A key is always a full deflection.** In Ultimate a fully deflected
       * stick dashes and then runs; walking requires a *partial* tilt, which is a
       * distinction a keyboard has no way to express at all. So "hold = dash" is
       * the faithful translation of a held key, not a missing feature, and making
       * walking the default would be the actual infidelity: it would make the
       * fastest ground movement in the game unreachable from a keyboard.
       *
       * What the window buys is the other half of the analog stick's range. The
       * brief step before the dash commits is what a tap produces, and a tap is
       * therefore the keyboard's micro-spacing tool: one frame moves Mario 0.31
       * units, two 1.23, three 2.76, and a hold from there is a dash. That ladder
       * is why the walk state exists here — not to be held, but to be tapped.
       *
       * Do not "fix" this by inverting it.
       */
      if (intent.wantsDash) startAction(f, "dashStart");
      else if (f.action !== "walk") startAction(f, "walk");
      return;
    }

    case "jump":
    case "fall": {
      if (f.grounded) {
        startAction(f, "land");
        return;
      }
      if (handleActionable(f, intent, ctx)) return;
      // Fast fall is only available after the apex, which makes it a read on the
      // defender rather than a free way to shorten every jump.
      if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
        f.fastFalling = true;
        f.vy = fastFallVelocity(ctx.def.attributes);
      }
      if (f.vy <= 0 && f.action === "jump") startAction(f, "fall");
      return;
    }
  }
}

/**
 * Put a fighter back on the stage when its ledge option finishes.
 *
 * Ledge options are a teleport rather than a trajectory, which is a genuine
 * simplification and a deliberate one: the alternative is running collision
 * against the very ledge the fighter is climbing over, which lands it back on
 * the ledge it is trying to leave on the first frame of every getup.
 */
function finishLedgeOption(f: FighterState, ctx: StateContext): void {
  const ledge = f.ledge;
  f.ledge = null;
  if (f.action === "ledgeJump") {
    f.vy = LEDGE_JUMP_VELOCITY;
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
  f.vx = 0;
  f.vy = 0;
  f.grounded = true;
  f.platform = ledge.platform;
  f.jumpsUsed = 0;
  f.airDodged = false;
  f.airTime = 0;
  startAction(f, "stand");
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
    if (victim !== undefined && victim.grabbedBy === f.port) victim.grabbedBy = -1;
  }
  if (f.grabbedBy >= 0) {
    const holder = fighters[f.grabbedBy];
    if (holder !== undefined && holder.grabbing === f.port) {
      holder.grabbing = -1;
      holder.grabTimer = 0;
    }
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
 * Turn the current action into this frame's velocity.
 *
 * Split from `advanceFighter` because the transition and the movement answer
 * different questions — "what am I doing" and "how fast am I going" — and because
 * a state that has just been entered should move on the frame it is entered,
 * which a single combined pass gets wrong half the time depending on branch order.
 */
/**
 * Is this fighter inside a move's super-armour window?
 *
 * Derived from `move` and `actionFrame`, both of which are already simulation
 * state, so armour rolls back with everything else and needs no field of its
 * own. `superArmourFrames` has been in the type — and on Donkey Kong's Giant
 * Punch — since the roster was written, and until this was read it did nothing
 * at all: the one move in the game that is *defined* by walking through a jab
 * flinched like everybody else.
 */
export function hasSuperArmour(f: FighterState, def: FighterDef): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special") return false;
  // Not named `window`: `layering.test.ts` forbids that identifier anywhere in
  // the engine, and it is right to — the check is a plain grep, because the
  // rule it enforces is "no browser globals reachable from a simulation that
  // has to run identically on both peers", and a grep cannot be fooled by a
  // clever alias the way a type checker can.
  const armour = def.moves[f.move]?.superArmourFrames;
  if (!armour) return false;
  const frame = moveFrameOf(f.actionFrame);
  return frame >= armour[0] && frame <= armour[1];
}

/**
 * A move's own scripted movement, if it has one on this frame.
 *
 * This is what makes a Fox Illusion cross the stage, a Dolphin Slash rise, and
 * a Stone drop like a stone. `MoveDef.momentum` has been in the type since the
 * roster was written and nothing read it, so every special that is *supposed*
 * to move the fighter simply played its animation on the spot.
 *
 * The velocity is **set**, not added: these are scripted movements with a
 * definite speed, and adding would make a Fox Illusion out of a run faster than
 * one from a standstill. `x` is facing-relative and `y` absolute, matching the
 * projectile convention.
 *
 * `hold` is what makes it a drop rather than a hop. Without it, gravity claws
 * the velocity back to the fighter's ordinary fall speed on the very next
 * frame, and a stone falls at exactly the speed a puffball does.
 *
 * Returns true while a hold is live, so the caller knows to leave gravity and
 * air drift alone.
 */
function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special" && f.action !== "throw") return false;
  const impulses = ctx.def.moves[f.move]?.momentum;
  if (!impulses) return false;

  const frame = moveFrameOf(f.actionFrame);
  for (const m of impulses) {
    const until = m.frame + (m.hold ?? 0);
    if (frame < m.frame || frame > until) continue;
    f.vx = m.x * (f.facing >= 0 ? 1 : -1);
    f.vy = m.y;
    // The floor still wins. A downward impulse on a grounded fighter drove
    // them straight through the stage — a grounded Stone fell out of the world
    // — because this branch returns before the clamp at the bottom of
    // `applyMovement` that ordinarily stops that. A Stone used on the ground
    // simply sits there, which is also what it does in the real game.
    if (f.grounded && f.vy < 0) f.vy = 0;
    f.launchSpeed = 0;
    return frame < until;
  }
  return false;
}

export function applyMovement(f: FighterState, intent: Intent, ctx: StateContext): void {
  const a = ctx.def.attributes;

  if (f.ledge !== null) {
    f.vx = 0;
    f.vy = 0;
    return;
  }

  // Scripted movement outranks everything below it — that is the point of a
  // move that carries its own — but only for as long as it is held.
  if (f.hitstun <= 0 && applyMoveMomentum(f, ctx)) return;

  if (f.hitstun > 0) {
    decayLaunch(f, LAUNCH_SPEED_DECAY);
    if (!f.grounded) f.vy = applyGravity(f.vy, a, hitstunGravityOptions(f));
    else f.vx = applyTraction(f.vx, a);
    return;
  }

  switch (f.action) {
    case "walk":
      f.vx = walkVelocity(f.vx, intent.x, a);
      break;
    case "dashStart":
      f.vx = f.actionFrame <= 1 ? initialDashVelocity(f.facing, a) : runVelocity(f.vx, f.facing, a);
      break;
    case "run":
      f.vx = runVelocity(f.vx, f.facing, a);
      break;
    case "roll":
      // Velocity was set on entry; a roll travels a fixed distance.
      break;
    case "respawnPlatform":
    case "dead":
      f.vx = 0;
      f.vy = 0;
      return;
    case "attack":
    case "special":
    case "grab":
    case "grabHold":
    case "pummel":
    case "throw":
    case "jump":
    case "fall":
    case "entering":
    case "airDodge":
      if (f.grounded) f.vx = applyTraction(f.vx, a);
      else f.vx = airDrift(f.vx, intent.x, a);
      break;
    default:
      if (f.grounded) f.vx = applyTraction(f.vx, a);
      break;
  }

  if (!f.grounded) {
    const w = dodgeWindow(f);
    if (f.action === "airDodge" && w !== null && f.actionFrame <= w[1]) {
      // An air dodge holds its own velocity outright; gravity resumes when the
      // intangible window closes, which is what makes a missed one a free punish.
      return;
    }
    f.vy = applyGravity(f.vy, a, { fastFalling: f.fastFalling });
  } else if (f.vy < 0) {
    f.vy = 0;
  }
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
  f.fastFalling = false;
  f.launchSpeed = 0;
  f.jumpsUsed = 0;
  f.airDodged = false;
  f.airTime = 0;
  // The hop is over, so the next one decides its own height and its own damage.
  f.shortHop = false;

  if (f.action === "tumble") {
    f.hitstun = 0;
    f.vx = 0;
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
        startAction(f, "land");
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
}

/** A fighter left the ground without jumping — walked off an edge. */
export function onLeftGround(f: FighterState): void {
  if (f.action === "jumpSquat") return;
  if (isActionable(f)) {
    // Walking off spends the grounded jump: Ultimate gives you your air jumps,
    // not a full-height one you never took.
    f.jumpsUsed = Math.max(f.jumpsUsed, 1);
    startAction(f, "fall");
  }
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
  f.vx = 0;
  f.vy = 0;
  f.launchSpeed = 0;
  f.facing = -side;
  f.jumpsUsed = 0;
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
