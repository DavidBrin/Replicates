/**
 * `SLOW_OPPONENT(rate, frames)`: a Final Smash's start slows every other fighter (Plan 6,
 * Task 11). SmashWiki "Slowdown" (https://www.ssbwiki.com/Slowdown): from Smash 4, "Most
 * Final Smashes" inflict it, and a slowed fighter's "actions will be increased in length
 * proportional to the degree of slowdown, while all sources of motion … are also slowed
 * down". UNVERIFIED (decision D5): the macro's arguments read as (rate, frames): for
 * `frames` steps, the fighter runs one step in `rate` and stands still on the rest
 * (`step`'s still-step branch, ruling R-P6-10): its status, hitstun and movement wait,
 * its hitlag counts on every step (the page's Ultimate "less hitlag" is not modelled
 * beyond that), a press waits in the buffer as in a KO's freeze, and a dodge's or a
 * move's intangible frames hold as in hitlag. Fighters only: projectiles and the stage
 * run at full speed.
 */

import type { FighterState, GameState } from "./types";

/** Slow every fighter but `user` (`MoveDef.slowOpponent`). A later slow replaces an earlier one. */
export function slowOthers(s: GameState, user: number, slow: { readonly rate: number; readonly frames: number }): void {
  for (const f of s.fighters) {
    if (f.port === user || f.action === "dead") continue;
    f.combat.slowRate = slow.rate;
    f.combat.slowFrames = slow.frames;
    f.combat.slowPhase = 0;
  }
}

/**
 * Count a slowed fighter's step, and say whether it stands still on it. The first step of
 * a slow runs (phase 0), then `rate − 1` stand still. Called once a step per fighter.
 */
export function tickSlow(f: FighterState): boolean {
  const c = f.combat;
  if (c.slowFrames <= 0) return false;
  c.slowFrames -= 1;
  const still = c.slowPhase !== 0;
  c.slowPhase = (c.slowPhase + 1) % c.slowRate;
  if (c.slowFrames === 0) {
    c.slowRate = 0;
    c.slowPhase = 0;
  }
  return still;
}

/** Is `f` slowed now (for a reader outside the step)? */
export function slowedThisStep(f: FighterState): boolean {
  return f.combat.slowFrames > 0;
}
