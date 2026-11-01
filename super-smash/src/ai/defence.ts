/**
 * The CPU's defence (Plan 5 final wave, ruling R-FW1j: split out of `behaviours.ts`):
 * `survive` (DI and SDI), `tech` (a tumble's landing, and its stick before it), `escape`
 * (an air dodge out of hitstun), `parry` and `shield`, and the timing of a swing it sees
 * (`swingHitFrame`, `counterWait`, `specialWith`), which `specials.ts`'s counter reads too.
 *
 * The rules `behaviours.ts` sets out hold here: no unseeded randomness and no wall clock
 * (every roll from `ctx.rolls`), and the opponent seen only through `ctx.view`, with the
 * one ruled exception the parry makes (R-T18j).
 */

import { Btn, type ActionState, type FighterDef, type FighterState, type InputFrame, type CounterDef, type MoveDef, type MoveSlot } from "@/engine/types";
import { cloneFighter } from "@/engine/simulate";

import { isFinalSlot } from "@/engine/final";
import { DOWNED_FRAMES, shieldCovers } from "@/engine/states";

import { airDodgeFrames } from "@/engine/airDodge";
import { smashHoldFrame } from "@/engine/acmd/run";
import { actionFrameOf, capsulesOverlap, deepestReach, hitboxWorldPos, hurtboxCapsule, sweptCapsuleOverlaps } from "@/engine/hitbox";
import { fighterHurtboxes } from "@/engine/acmd/hurtboxes";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import { shieldBubble } from "@/engine/shield";
import {
  AIR_DODGE_TECH_FRAMES,
  BUFFER_FRAMES,
  GLANCING_BLOW_DEPTH,
  HITSTUN_CANCEL_AIR_DODGE_FRAME,
  HITSTUN_CANCEL_AIR_DODGE_SPEED,
  LAUNCH_SPEED_DECAY,
  PERFECT_SHIELD_WINDOW,
  SDI_INPUT_INTERVAL,
  SHIELD_MIN_HOLD,
  BOUNCE_FLOOR_LAUNCH_RATIO,
  TECH_FLOOR_MAX_SPEED,
  TECH_LOCKOUT,
  TECH_WINDOW,
} from "@/engine/constants";
import { byRatio, fx, magnitude } from "@/engine/fixed";
import { fighterParams, type FighterParams } from "@/engine/params";

import {
  type Behaviour,
  type BehaviourContext,
  type BehaviourResult,
  boxCapsule,
  canAct,
  diDirection,
  dodgeCarriesOffstage,
  free,
  HELD_ACTIONS,
  isAttacking,
  isGrabbing,
  isOffstage,
  isShielding,
  isStunned,
  type Observation,
  pulse,
  ROLL_DODGE,
  ROLL_MOVE,
  ROLL_PARRY,
  ROLL_RECOVER,
  ROLL_SHIELD,
  ROLL_TECH,
  sideDodgeCarriesOffstage,
  type StageView,
  strikes,
  THREAT_RANGE,
  towardX,
} from "./behaviours";
import { floorContact, framesToFloor, framesToWall, ghostContext, ghostStep } from "./recovery";

const NOTHING: BehaviourResult = { score: 0, input: 0 };

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
    // A chance over a window (ruling R-T19j, its label corrected): the pulse holds
    // the stick 2 frames in every SDI_INPUT_INTERVAL, with a roll on each, and a
    // pass on the second after a miss on the first is still a fresh press, so a
    // pulse gets up to two rolls: 1 − (1 − sdiSkill)² a pulse.
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
 *    disarms the launch's speed-up) or a landing. A wall's or a ceiling's bounce
 *    keeps it (the gravity from before the collision, `techOrBounce`), and a
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
 *    too (`kineticSetY`), and takes the launch's rise away; a ceiling's bounce
 *    gives back the gravity the stop zeroed (`techOrBounce`, ruling R-T18s) and
 *    sends the launch down, while a floor bounce sends it up (`|y|`). So a launch
 *    going down, or level with what is left of it still moving, is a ceiling's,
 *    not a floor's;
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

/** A Special press of its own (only `recover`'s up special waits there) still in the buffer for the next step. */
function specialWaiting(f: FighterState, frame: number): boolean {
  const b = f.bufferedAction;
  return b !== null && b.kind === "special" && frame + 1 - b.frame <= BUFFER_FRAMES;
}

/**
 * Whether the next step reads this airborne fighter's buffered Shield press into an
 * air dodge (ruling R-T19m, on a move's hand-off): its own copy run one step by the
 * engine's rules (`ghostStep`), its buffer kept and nothing pressed, comes out in an
 * air dodge it wasn't in. Exact for the press: `handleActionable` reads a buffered
 * Shield before any other press, so what is pressed on the real step changes only
 * the dodge's direction, not whether it starts. A reel's last frame is no such step:
 * it ends through `endStatus`, which keeps the press for the step after.
 */
export function pressReadNextStep(def: FighterDef, self: FighterState, frame0: number): boolean {
  if (self.hitlag > 0 || self.action === "airDodge") return false;
  const f = cloneFighter(self);
  ghostStep(f, 0, 0, ghostContext(def, frame0 + 1, f));
  return f.action === "airDodge";
}

/**
 * Whether this fighter, not free to act now (`free`), is after its next step: the last
 * frame of a reel, a landing's lag or a get-up (ruling R-T19g, for `shieldDecides`).
 * Its own fighter is run one step on by the engine's rules (`ghostStep`) with nothing
 * pressed and nothing in its buffer (ruling R-T19n); a freeze holds it where it is
 * (`step()` runs no status in hitlag). A press
 * made on this frame is read on that step, or waits in the buffer for the first free
 * frame (`handOff`, `endStatus`): so too where that step also lands a reel in the air,
 * whose plain landing (`land`, a few frames) the buffer outlasts.
 */
export function freeNextStep(def: FighterDef, self: FighterState, frame0: number): boolean {
  if (free(self) || self.hitlag > 0) return false;
  const f = cloneFighter(self);
  // Its own earlier press is not what frees it (ruling R-T19n): the decision's fresh
  // Shield press is read before the buffer (`handleActionable`), so a buffered Attack
  // left in the copy would take a ledge get-up into the attack and read "not free".
  f.bufferedAction = null;
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

/** The special slots, in the order a property is looked for, and the stick that picks each (`specialSlot`). */
const SPECIAL_SLOTS: readonly { readonly slot: MoveSlot; readonly dir: InputFrame }[] = [
  { slot: "downB", dir: Btn.Down },
  { slot: "sideB", dir: 0 },
  { slot: "neutralB", dir: 0 },
];

/** The first special of this fighter's with the property, its slot and the stick that picks it. */
export function specialWith(def: FighterDef | null, has: (m: MoveDef) => boolean): { slot: MoveSlot; dir: InputFrame; move: MoveDef } | null {
  if (def === null) return null;
  for (const { slot, dir } of SPECIAL_SLOTS) {
    const move = def.moves[slot];
    if (move !== undefined && has(move)) return { slot, dir, move };
  }
  return null;
}

/**
 * UNVERIFIED (tuning): the move frames after the counter goes up that the CPU
 * aims a swing's first hit to land on (Marth's is up on frames 6-27).
 */
export const COUNTER_AIM = 2;

/**
 * When the counter decides the swing in view (rulings R-T19f, R-T19l), the one
 * timing `counter` and `shield` both read: the frames from now to its decision frame
 * (0 now, more to come, less that many frames ago), or null for a swing it can't meet.
 *
 * Its frame is the one that puts the swing's first hit `COUNTER_AIM` frames into the
 * counter's live frames (pressed now, the counter is on move frame k on step k; the
 * swing's first box is live on step `hit − actionFrame`). For a swing first seen with
 * its hit already sooner than that but inside the live frames, it is the frame the
 * swing is first seen. A frame the attacker is frozen on (its hitlag) repeats its move
 * frame, so it is never the frame: the freeze's last (hitlag 0) is.
 *
 * Null: no swing it can time (not an attack, unseen, no box of its own, a smash whose
 * charge is still to come: `swingHitFrame`), a Final Smash, or one first seen too late.
 */
export function counterWait(view: Observation, swingDef: FighterDef | undefined, c: CounterDef): number | null {
  const { target, targetAction, targetActionAge } = view;
  if (target === null || !isAttacking(targetAction) || targetActionAge < 0 || isFinalSlot(target.move)) return null;
  const hit = swingHitFrame(swingDef, target);
  if (hit === null) return null;
  const lands = hit - target.actionFrame;
  const aim = c.active[0] + COUNTER_AIM;
  // Where its hit was when it was first seen.
  const first = lands + targetActionAge;
  let wait: number;
  if (first >= aim) wait = lands - aim;
  else if (first >= c.active[0]) wait = -targetActionAge;
  else return null;
  return wait === 0 && target.hitlag > 0 ? 1 : wait;
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
 * Shield what it can see coming, and spot-dodge a grab.
 *
 * Everything about this depends on the observation delay: `targetAction` is
 * only "attack" once the swing has been visible for the level's reaction time,
 * so a level-9 CPU (4 frames) sees almost every startup and a level-1 CPU
 * (30 frames) sees essentially none of them.
 *
 * One decision a threat (Plan 5, Task 19; ruling R-T18g, as R-T18e made the tech
 * one a landing): the shield rolls its dial once a swing or a grab in range, on the
 * frame `shieldDecides` gives it (the first frame it sees it; for a fighter with a
 * counter, a swing the counter can catch on the counter's frame, after the counter,
 * ruling R-T19l; seen while it could not act, the last frame of what held it: a
 * reel, a landing's lag, a get-up, lying down and its get-up, a helpless fall and its
 * landing; rulings R-T19g and its fixed chains), and on no other. A
 * shield it raised it holds while the swing it saw goes on, whatever the roll, its
 * stun included (ruling R-T19o): rolling every frame let go of a held shield
 * mid-swing (against Donkey Kong's smash, levels 6-8 were hit in that drop 283, 294
 * and 107 times in 300); a shield nearly spent is let go to roll away instead (the
 * Task 19 review's M1). The parry (`parry`, decided, before this in `BEHAVIOURS`) is
 * the one deliberate drop, and it is no new decision here: the swing was seen before
 * the drop began.
 *
 * A press it decided that waits in the buffer comes out as the press it judged
 * (ruling R-T19m) on the step that reads it in the air: a free frame (the press made
 * on the last frame of a reel, a lag or a get-up), or the hand-off step of the
 * fighter's own move (an aerial handing off to `fall`, a ledge jump to `jump`, a
 * special's end), where the move's status hands off and `handleActionable` reads the
 * buffer at once (`pressReadNextStep`: the fighter's own copy run one step, its
 * buffer kept, comes out in an air dodge). On that step the stick is masked off
 * whatever wins the frame (`forbid`, as `tech` masks a fast fall's Down), so the air
 * dodge is the neutral one `dodgeCarriesOffstage` weighed. A mask, not a decided result: a
 * decided hold here would lose the frame to every decided behaviour before this one
 * (`recover`'s steering among them), whose stick would make the dodge directional;
 * and no button another behaviour presses on that frame changes what comes out,
 * since `handleActionable` reads the buffered Shield before every other press, on
 * the ground and in the air. On the ground the stick makes no difference (a Shield
 * press is `shieldStart` whatever it holds: measured, no roll or spot dodge out of a
 * last-frame decision in 48 sweeps), so it is not masked there: masking it changed
 * nothing on that frame and only the stick's history after it (a flick's, a tilt's).
 * In a tumble's fall `tech` decides the same neutral for its own press first, so the
 * two agree.
 */
export const shield: Behaviour = (ctx) => {
  const { self, targetAction } = ctx.view;
  const { tuning } = ctx;
  // A recovery's up special waiting in the buffer is not replaced (ruling R-T19p): the
  // buffer keeps one press (`bufferPress`), and a Shield press made now would take its
  // place with an air dodge. Read off the fighter itself, not a model copy.
  if (specialWaiting(self, ctx.view.frame)) return NOTHING;
  if (shieldWaiting(self, ctx.view.frame)) {
    // Its press waiting in the buffer comes out on this step as the press it judged
    // (ruling R-T19m): in the air the stick kept neutral whoever wins the frame, so the
    // air dodge is the neutral one (`dodgeCarriesOffstage` below judged that), not a
    // directional one another behaviour's stick makes of it; `tech` holds the same
    // neutral in a tumble's fall, decided, and comes first. On the ground the press is
    // a shield whatever the stick, so the stick is left alone. A threat seen again on
    // this frame is decided no more: the press already made is its answer (the
    // hand-off).
    if (free(self)) return { score: 0, input: 0, forbid: self.grounded ? 0 : STICK };
    // Read on its own move's hand-off step (an aerial's, a ledge jump's, a special's):
    // the same mask on that step.
    if (!self.grounded && ctx.fighterDef !== null && pressReadNextStep(ctx.fighterDef, self, ctx.view.frame)) return { score: 0, input: 0, forbid: STICK };
  }
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

  // Up already, against the swing it was raised for: held through it, its stun too
  // (ruling R-T19o: the engine ends the stun in a drop unless Shield is held, and the
  // stun's `hitstun` leaves `canAct` false), unless it is nearly spent, when it rolls
  // away (the Task 19 review's M1: a spent shield held).
  if (incomingAttack && isShielding(self.action) && (canAct(self) || self.action === "shieldStun")) {
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
 * sees the threat, its press waiting in the buffer for the move's hand-off step (an
 * aerial's into `fall`, a ledge jump's into `jump`, a special's end), which reads it at
 * once, with the stick masked there (ruling R-T19m), as before.
 * (Task 19 fix round 1's sweep: deciding those at the move's end instead, as
 * `free` alone would have, had the CPU air-dodge after nearly every aerial, and its
 * self-destructs rose from 96 to 124 over twelve sweeps.)
 */
const WAITS_OUT: readonly ActionState[] = ["land", "landingLag", "specialLanding", "getUp", "ledgeGetUp"];

function cannotAct(f: FighterState): boolean {
  return !canAct(f) || WAITS_OUT.includes(f.action);
}

/**
 * The one frame a threat is decided on (rulings R-T18g, R-T19g, R-T19l). Where it can
 * act (`cannotAct`), the first frame the threat is seen in range, or, for a swing a
 * counter of its own can catch (`counterTakes`), the counter's frame while that is
 * still to come; a swing that first comes into range after it, at range entry (ruling
 * R-T19l amended), so approaching swings are decided as before the counter came first.
 * Where it
 * cannot, the last frame of the stretch it is held in, the frame before its first
 * free one (`freeNextStep`, by `free`, the specials' notion, its own buffered press
 * left out: ruling R-T19n), for a threat whose own decision frame came during that
 * stretch (`targetActionAge` from the swing's first sight, or the counter's frame
 * since passed, no more than the stretch's frames, `heldFor`): the press is read as
 * the fighter comes free, or waits in the buffer for its first free frame. The
 * stretch began no later than that frame, so the fighter could not act on it then
 * nor since: a threat it could act on at its frame it never decides again (a shield
 * raised then and dropped by the parry included, since the drop began after).
 *
 * The CPU keeps no memory of its own actions, so some threats get no decision or
 * two: one seen further off before the stretch began that came into range during it
 * (none); one whose first sight `threatBefore` rebuilds out of range on the frame
 * after a last-frame decision whose roll failed (two; a passing roll's press waits in
 * the buffer, and `shield` stands on it); one first seen in a helpless move that
 * lands into its special landing (two, `heldFor`); for a fighter with a counter, a
 * swing that leaves the range and comes back into it after its counter frame (two:
 * R-T19l amended decides at every range entry past the counter's frame, and where the
 * swing was on that frame is kept nowhere; the Task 19 re-review's New Breakage 1);
 * and one whose one-frame rebuild (`threatBefore`) puts it just out of range where the
 * view had it just inside, its velocity having changed on the way (two; the hitlag
 * kind is closed: ruling R-FW1h). Each is counted in the sweep.
 */
function shieldDecides(ctx: BehaviourContext): boolean {
  const { self, targetActionAge } = ctx.view;
  const wait = counterTakes(ctx);
  // The counter's frame still ahead (or now): the counter first (ruling R-T19l). Passed,
  // or none: the shield's own first sight in range (ruling R-T19l amended: a swing that
  // comes into range after its counter frame decides at range entry, as before).
  if (!cannotAct(self)) return wait === null || wait < 0 ? !threatBefore(ctx) : wait === 0;
  if (ctx.fighterDef === null || !freeNextStep(ctx.fighterDef, self, ctx.view.frame)) return false;
  // Frames since the threat's own decision frame: its first sight, or the counter's.
  const since = wait === null ? targetActionAge : -wait;
  return since >= 0 && since <= heldFor(self);
}

/**
 * For a fighter with a counter, the swing the shield leaves to it (ruling R-T19l):
 * the counter's wait (`counterWait`), on whose frame the counter decides first and
 * the shield only if the counter didn't take it; null for a threat the shield decides
 * itself. Keyed on the counter's timing alone, not its other gates (free, over the
 * stage, facing, the slide, range), so a swing the counter declines on its frame still
 * gets the shield's decision on that frame. Not a smash whose charge was still to come
 * when first seen (its hold frame no earlier than the reaction time): the shield
 * decided that at first sight.
 */
function counterTakes(ctx: BehaviourContext): number | null {
  const pick = specialWith(ctx.fighterDef, (m) => m.counter !== undefined);
  const target = ctx.view.target;
  if (pick === null || target === null) return null;
  const swingDef = ctx.matchDefs[target.port];
  const move = target.move === null ? undefined : swingDef?.moves[target.move];
  if (swingDef !== undefined && move?.chargeable === true && smashHoldFrame(swingDef, target) >= ctx.tuning.reactionFrames) return null;
  return counterWait(ctx.view, swingDef, pick.move.counter!);
}

/**
 * How long the stretch the fighter is held in has run, for a threat first seen in it
 * (ruling R-T19g, extended to the engine's fixed chains): the action's own frames; a
 * get-up's, and the lying down before it, which only ever leads into it and lasts
 * `DOWNED_FRAMES`; a special landing's, and the helpless fall before it, whose length
 * the engine keeps nowhere, so any threat seen before the landing counts (a special
 * landing can also follow the move itself, landed mid-move: a threat decided at first
 * sight in that move is decided again here; measured).
 */
function heldFor(f: FighterState): number {
  if (f.action === "getUp") return f.actionFrame + DOWNED_FRAMES;
  if (f.action === "specialLanding") return Number.POSITIVE_INFINITY;
  return f.actionFrame;
}

/** The stick's four directions. */
const STICK: InputFrame = Btn.Left | Btn.Right | Btn.Up | Btn.Down;

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
 *
 * An attacker frozen in hitlag holds its frame (Plan 5 final wave, ruling R-FW1h):
 * first seen in its freeze, it shows the same first sight on every frame of the
 * freeze, so each read as new and was decided again (about 2,900 times in 48 sweeps,
 * the Task 19 re-review counted). Its first sight is taken as the freeze's last frame
 * (hitlag 0), as the counter takes it (`counterWait`): one decision. Older than its
 * first sight, a freeze is rebuilt on its velocity like any frame (the edge of the
 * range is the residual: `shieldDecides`).
 */
function threatBefore(ctx: BehaviourContext): boolean {
  const { self, target, targetActionAge } = ctx.view;
  if (target === null || targetActionAge < 0) return false;
  if (targetActionAge === 0) return target.hitlag > 0;
  const dx = target.x - target.vx - (self.x - self.vx);
  const dy = target.y - target.vy - (self.y - self.vy);
  return magnitude(dx, dy) <= THREAT_RANGE;
}
