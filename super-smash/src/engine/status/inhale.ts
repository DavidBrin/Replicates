/**
 * Kirby's Inhale (Plan 5, Task 9): the statuses around a mouthful. The catch,
 * the releases and the Copy Ability are `engine/inhale.ts`.
 *
 * SSBU's statuses (skyline-smash `lua_const.rs`,
 * https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/lua_const.rs):
 * Kirby's FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT, with its _WALK, _TURN,
 * _JUMP1, _FALL and _LANDING family, is one replica status, `inhaleHold`; the
 * fighter in his mouth is in FIGHTER_STATUS_KIND_SWALLOWED, `swallowed`; one he
 * spat flies in FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR, `spatStar`. The
 * swallow and the spit (SPECIAL_N_SWALLOW, SPECIAL_N_SPIT) are moves Kirby runs
 * in `special`: `inhaleSwallow` and `inhaleSpit`.
 *
 * SmashWiki "Kirby (SSBU)/Neutral special"
 * (https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special):
 * - "the amount of frames the opponent is held in Kirby's mouth is determined
 *   by 180 + 1.1t - k" (t: their percent, k: Kirby's); "On the ground, button
 *   mashing reduces this amount by 12 frames per stick input, and 21.6 frames per
 *   button input, while in the air, these amounts are increased to 16 and 28.8";
 * - "Walk speed multiplier with inhaled opponent 1.08"; Kirby can "walk around
 *   slowly, or perform a short hop";
 * - spat as a star, "The duration in frames is determined by 25 + 0.5t, with a
 *   maximum of 60"; "Button mashing from the target reduces the star's duration
 *   by 10 frames per stick input, and 18 frames per button input, with a minimum
 *   resulting duration of 4 frames"; "Opponent's speed when escaping star 0.73,
 *   2.3".
 * SmashWiki "Inhale (Kirby)" (https://www.ssbwiki.com/Inhale_(Kirby)): "Kirby can
 * swallow the victim by pressing down or the special move button" and "spit them
 * out as a star ... by pressing the attack button"; "Kirby always has a minimum
 * of 14 frames to swallow or spit the opponent"; held characters, after their
 * time, "are automatically released".
 *
 * UNVERIFIED, the replica's readings where nothing is published:
 * - The hold's and the flight's rounding: down, as the grab's `90 + 1.7p` is.
 * - The grab button spits as the attack button does (as it throws in the carry).
 * - Kirby turns only on the ground, and hops once, from the ground, at once (no
 *   jump squat): the EAT_JUMP statuses' lengths are unpublished.
 * - Once the swallow or the spit has begun the held fighter no longer struggles,
 *   as one being thrown does not: its timer waits.
 * - Out of the mouth by mashing or by time, the fighter is where Kirby is
 *   (`step`'s phase 5b holds it inside him), standing if he stands, and has the
 *   grab's 60 frames of grab immunity; SSBU's SWALLOWED_CANCEL motion is
 *   unpublished.
 * - A star's rider is intangible for the flight, and the escape speed's 0.73
 *   points the way the star flew.
 */

import { ONE, fx } from "../fixed";
import { kineticGroundJump, kineticSet } from "../kinetic";
import { fighterParams } from "../params";
import { mashFrames } from "../shield";
import { buttonPresses, presses, startAction, startMove } from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState, MoveSlot } from "../types";
import { releaseHeld } from "./grab";
import type { FighterStatus } from "./kind";

/**
 * ×1.08 walk speed with a mouthful (SmashWiki, above: "Walk speed multiplier with
 * inhaled opponent 1.08"). UNVERIFIED: that it scales the walk's acceleration too;
 * the page names the speed alone, and the status's `walkMul` scales both, as Donkey
 * Kong's carry's published ×1.1 "walk speed and acceleration" does.
 */
export const INHALE_WALK = fx(1.08);
/** Mashing out of the mouth, in tenths of a frame: on the ground and in the air (SmashWiki, above). */
export const INHALE_MASH_BUTTON = 216;
export const INHALE_MASH_STICK = 120;
export const INHALE_MASH_BUTTON_AIR = 288;
export const INHALE_MASH_STICK_AIR = 160;
/** Kirby holds a fighter at least this long, however hard it mashes (SmashWiki "Inhale (Kirby)"). */
export const INHALE_MIN_FRAMES = 14;
/** Mashing a star's flight shorter, tenths of a frame (SmashWiki, above). */
export const STAR_MASH_BUTTON = 180;
export const STAR_MASH_STICK = 100;
/** A star flies at most this long, and at least this long however hard its rider mashes. */
export const STAR_MAX_FRAMES = 60;
export const STAR_MIN_FRAMES = 4;
/** "Opponent's speed when escaping star" (SmashWiki, above), Q12. */
export const STAR_ESCAPE_X = fx(0.73);
export const STAR_ESCAPE_Y = fx(2.3);

/** `180 + 1.1t − k` frames, the percents Q12; at least one. */
export function inhaleHoldFrames(victimPercent: number, kirbyPercent: number): number {
  return Math.max(1, Math.floor((1800 * ONE + 11 * victimPercent - 10 * kirbyPercent) / (10 * ONE)));
}

/** `25 + 0.5t` frames, 60 at most, the percent Q12. */
export function starFrames(victimPercent: number): number {
  return Math.min(STAR_MAX_FRAMES, Math.floor((50 * ONE + victimPercent) / (2 * ONE)));
}

/** The swallow and the spit, from the inhale that caught (its `InhaleDef`), else the roster's slots. */
function releaseMoves(ctx: StateContext): { swallow: MoveSlot; spit: MoveSlot } {
  return ctx.def.moves.neutralB?.inhale ?? { swallow: "inhaleSwallow", spit: "inhaleSpit" };
}

/**
 * A spat fighter leaves its star (its flight is over, or the star is gone): it
 * falls, flying off at the published escape speed, the 0.73 the way the star
 * flew. One the swallow's star carried out (`ride` negative) falls from rest:
 * the page publishes that escape speed for the spit's star alone (UNVERIFIED).
 * `STATUS_SPAT_STAR`'s `end` clears what the ride kept.
 */
export function leaveStar(f: FighterState): void {
  const outStar = f.combat.ride < 0;
  startAction(f, "fall");
  if (outStar) kineticSet(f, 0, 0);
  else kineticSet(f, f.facing * STAR_ESCAPE_X, STAR_ESCAPE_Y);
}

export const STATUS_INHALE_HOLD: FighterStatus = {
  kind: "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT",
  action: "inhaleHold",
  kineticType: "WALK",
  // Speed ×1.08 (published) and acceleration ×1.08 (UNVERIFIED: `INHALE_WALK`).
  walkMul: INHALE_WALK,
  main(f, intent, ctx) {
    // The mouthful is gone when the link is broken (the held fighter got out, a
    // hit, a grab, a KO), or, as a backstop, when the fighter held has left the
    // mouth with it intact, as a hold ends (`STATUS_CATCH_WAIT`).
    const held = f.grabbing >= 0 ? ctx.fighters[f.grabbing] : undefined;
    if (held === undefined || held.grabbedBy !== f.port || held.action !== "swallowed") {
      releaseHeld(f, ctx.fighters);
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    // The input buffer reaches the mouthful as it reaches every status.
    const p = presses(f, intent, ctx.frame);
    const moves = releaseMoves(ctx);
    if (p.special || intent.downPressed) {
      startMove(f, "special", moves.swallow);
      return;
    }
    if (p.attack || p.grab) {
      startMove(f, "special", moves.spit);
      return;
    }
    if (f.grounded && intent.x !== 0) f.facing = intent.x;
    // "perform a short hop": from the ground, once.
    if (p.jump && f.grounded) {
      kineticGroundJump(f, fighterParams(ctx.def), false);
      f.shortHop = true;
      f.grounded = false;
      f.platform = -1;
      f.jumpsUsed = 1;
      f.fastFalling = false;
    }
  },
};

/** The struggle in the mouth: a frame at a time, faster for every press, never before the 14th frame. */
function struggleInMouth(f: FighterState, kirby: FighterState, intent: Intent, ctx: StateContext): void {
  const air = !kirby.grounded;
  const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
  f.grabTimer -= 1 + mashFrames(
    f.combat,
    buttonPresses(intent),
    sticks,
    air ? INHALE_MASH_BUTTON_AIR : INHALE_MASH_BUTTON,
    air ? INHALE_MASH_STICK_AIR : INHALE_MASH_STICK,
  );
  if (f.grabTimer > 0 || f.actionFrame < INHALE_MIN_FRAMES) return;
  // Out, by mashing or by time: Kirby lets go, and the fighter is immune to
  // grabs for the grab's second (`releaseHeld`; R-T9b: through `releaseGrab`, so
  // the mash credit goes with the link).
  releaseHeld(kirby, ctx.fighters);
  startAction(f, f.grounded ? "stand" : "fall");
}

export const STATUS_SWALLOWED: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SWALLOWED",
  action: "swallowed",
  kineticType: "NONE",
  main(f, intent, ctx) {
    const kirby = f.grabbedBy >= 0 ? ctx.fighters[f.grabbedBy] : undefined;
    // Let out by anything but a struggle: a hit or a grab on Kirby, his KO.
    if (kirby === undefined || kirby.grabbing !== f.port) {
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    // Inside Kirby nothing can touch them.
    f.intangible = Math.max(f.intangible, 1);
    // A swallow or a spit under way is a throw: no struggle (UNVERIFIED, above).
    if (kirby.action !== "inhaleHold") return;
    struggleInMouth(f, kirby, intent, ctx);
  },
};

export const STATUS_SPAT_STAR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR",
  action: "spatStar",
  kineticType: "NONE",
  main(f, intent) {
    f.intangible = Math.max(f.intangible, 1);
    // `grabTimer` holds what is left of the flight; mashing shortens a spit star's
    // (`ride` its instance id). The swallow's star (`ride` negative,
    // `carryOutStarRiders`) flies its 10 frames: no mash is published for it
    // (UNVERIFIED).
    const outStar = f.combat.ride < 0;
    const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
    const mashed = outStar ? 0 : mashFrames(f.combat, buttonPresses(intent), sticks, STAR_MASH_BUTTON, STAR_MASH_STICK);
    f.grabTimer -= 1 + mashed;
    if (f.combat.ride === 0 || (f.grabTimer <= 0 && (outStar || f.actionFrame >= STAR_MIN_FRAMES))) leaveStar(f);
  },
  // Nothing of the ride outlives it, however it ends: its flight, its star, a KO.
  end(f) {
    f.combat.ride = 0;
    f.combat.mash = 0;
    f.grabTimer = 0;
  },
};

export const INHALE_STATUSES: readonly FighterStatus[] = [STATUS_INHALE_HOLD, STATUS_SWALLOWED, STATUS_SPAT_STAR];
