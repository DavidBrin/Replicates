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
 *
 * The reading's other choices (Plan 6, Task 11 fix round 1):
 * - D5's corroboration: every fighter's `GenesisFire` calls `SlowModule::set_whole(4, 0)` and
 *   `clear_whole()` five frames later (rubendal 13.0.1 `data.json`, read by the Task 11
 *   review), a small integer rate and then a length, 0 for "until cleared".
 * - UNVERIFIED-simplified: stepped, not smooth. The page has slowdown work "without reducing
 *   the rate at which these factors are recalculated", and a slowed limb's hitbox out "for
 *   multiple frames"; here a slowed fighter steps whole on one step in `rate` and stands
 *   still on the rest, its boxes live only on its running steps.
 * - UNVERIFIED: a Final Smash's scene stands a bystander's slow still with it (the count
 *   sits after `step`'s scene branch), so a bystander leaves a long scene still slowed; a
 *   trapped fighter is in the scene, and its slow counts on.
 * - A KO ends the slow with the stock (`step`'s KO block), so the respawn's countdown runs at
 *   full speed.
 * - A press on a still step waits in the buffer as it was made: a stick smash stays a smash,
 *   and a smash-input special keeps its smash version (`bufferPress`; UNVERIFIED, the
 *   controller's ruling, for every buffered press). The buffer ages only on the fighter's
 *   own running steps (`step`'s still-step branch keeps a waiting press a step younger;
 *   Task 41's fix wave, final review I-1), so under any rate, Mario Finale's 20 and the
 *   Ancient Arrow's 30 included, a press on a still step fires on the next running step.
 * - Not modelled: the start scripts' own `SlowModule` calls, a slowing of the whole match:
 *   Donkey Kong's `game_finalstart` `set_whole(30, 0)` on its frame 15, cleared on 16; Fox's
 *   `FinalLockOn` `set_whole(2, 0)` from 5 to 25 (read by the review in `data.json`) and his
 *   `game_finalstart` `clear_whole()` on 5.
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
