/**
 * The grab's struggle and release, shared by the hold (`status/attack.ts`) and
 * Donkey Kong's carry (`status/cargo.ts`, Plan 5, Task 8), and by `step`'s
 * frozen frames. Their own module, so the two status files each import it and
 * not each other (Task 8 fix round 1).
 */

import { mashFrames } from "../shield";
import {
  GRAB_MASH_BUTTON,
  GRAB_MASH_STICK,
  GRAB_MIN_FRAMES,
  GRAB_RELEASE_IMMUNITY,
  buttonPresses,
  releaseGrab,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";

/**
 * `f`'s own status ended the hold, not a hit: the victim goes free and is immune
 * to grabs for 60 frames, as one that breaks out is (Plan 3, Task 14).
 *
 * UNVERIFIED which releases give the immunity: SmashWiki "Grab" says only
 * "invulnerability to grabs for around one second after being released from
 * them". Here: a break-out or the timer running out (`struggleInGrab`), and a
 * hold its captor's status ends with the link intact (this); not a throw's hit
 * (Ultimate has chain grabs) and not a captor that was hit or KO'd.
 */
export function releaseHeld(f: FighterState, fighters: readonly FighterState[]): void {
  const victim = f.grabbing >= 0 ? fighters[f.grabbing] : undefined;
  if (victim !== undefined && victim.grabbedBy === f.port) victim.combat.grabImmune = GRAB_RELEASE_IMMUNITY;
  releaseGrab(f, fighters);
}

/**
 * One frame of the struggle (Plan 3, Task 14): the timer runs down a frame at a
 * time and faster for every press, pummels or not; no escape before frame 19.
 * It runs on every frame of the hold, the freezes of a pummel included, and
 * mashing counts in them too (Plan 5, Task 7 fix round 1, replacing Plan 3's
 * UNVERIFIED pause): SmashWiki "Grab" (https://www.ssbwiki.com/Grab), the grab
 * time is set when the grab lands, "so it is not affected by pummeling or
 * external damage"; SmashWiki "Pummel" (https://www.ssbwiki.com/Pummel),
 * "opponents can still mash out of the attacker's grab during hitlag". So a
 * hold lasts at most its `90 + 1.7p` frames, however it is pummelled.
 */
export function struggleInGrab(f: FighterState, intent: Intent, ctx: StateContext): void {
  const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
  f.grabTimer -= 1 + mashFrames(f.combat, buttonPresses(intent), sticks, GRAB_MASH_BUTTON, GRAB_MASH_STICK);
  if (f.grabTimer > 0 || f.actionFrame < GRAB_MIN_FRAMES) return;
  // A grab release: the holder's own status sees `grabbing < 0` and stands. The
  // mash credit goes with the link (`releaseGrab`).
  releaseGrab(f, ctx.fighters);
  f.combat.grabImmune = GRAB_RELEASE_IMMUNITY;
  startAction(f, f.grounded ? "stand" : "fall");
}
