/**
 * The spot dodge's and the rolls' rules that more than one layer reads (Plan 3
 * final wave): each fighter's lengths and intangibility, and which way a roll
 * went. The statuses (`status/guard.ts`: how long they last, which way a roll
 * moves), the state machine (`states.ts`: intangibility) and the renderer all
 * ask, and must agree. Like `airDodge.ts`, this module imports only types.
 *
 * Sources are UltimateFrameData's "Dodges / Rolls" tables, one page per
 * fighter (https://ultimateframedata.com/<fighter>), cited in each fighter file
 * (`FighterAttributes.groundDodge`). They replace Plan 1's unsourced shared
 * numbers (a 24-frame spot dodge intangible on 3-20, a 31-frame roll on 4-20),
 * which were read the other way round from the air dodge's (the final review,
 * Minor 1).
 *
 * **Frames.** The air dodge's convention (`airDodge.ts`): a dodge is entered on
 * its own frame in phase 3, which is its frame 1, `actionFrame` 0, so a
 * published frame N is `actionFrame` N − 1. A length T ("Total frames") ends the
 * dodge on `actionFrame` T, frame T + 1, its first actionable frame, where the
 * fighter acts (`handOff`). UFD's intangibility a-b is `actionFrame` a − 1 to
 * b − 1.
 *
 * UNVERIFIED, not modelled: dodge staling (SmashWiki "Spot dodge": repeated
 * dodges start their intangibility later and last longer), and the spot dodge's
 * cancel into a ground attack or special 5 frames early (UFD's first number).
 */

import type { DodgeFrames, FighterAttributes, GroundDodgeAttributes } from "./types";

/**
 * Mario's (https://ultimateframedata.com/mario): spot dodge 25 frames,
 * intangible 3-17; forward roll 29, 4-15; back roll 34, 5-16. What a fighter
 * whose definition authors none gets: the engine's hand-built test fighters,
 * which also air dodge as Mario does (`DEFAULT_AIR_DODGE`).
 */
export const DEFAULT_GROUND_DODGE: GroundDodgeAttributes = {
  spotDodge: { frames: 25, intangible: [3, 17] },
  forwardRoll: { frames: 29, intangible: [4, 15] },
  backRoll: { frames: 34, intangible: [5, 16] },
};

/** A fighter's spot dodge and rolls, or Mario's when its definition has none. */
export function groundDodgeOf(attrs: Pick<FighterAttributes, "groundDodge">): GroundDodgeAttributes {
  return attrs.groundDodge ?? DEFAULT_GROUND_DODGE;
}

/**
 * `charge` means nothing outside a smash, so a roll borrows it to remember its
 * way, as an air dodge does its direction: 0 forward, 1 back.
 */
export const ROLL_FORWARD = 0;
export const ROLL_BACK = 1;

/** The `charge` of a roll toward stick x (−1 or 1) by a fighter facing `facing`. */
export function rollCharge(x: number, facing: number): number {
  return x === facing ? ROLL_FORWARD : ROLL_BACK;
}

/** The roll a `charge` remembers: forward unless it is `ROLL_BACK`. */
export function rollOf(a: GroundDodgeAttributes, charge: number): DodgeFrames {
  return charge === ROLL_BACK ? a.backRoll : a.forwardRoll;
}

/**
 * A ground dodge's intangible window as [first, last] `actionFrame`: UFD's
 * frames a-b are `actionFrame` a − 1 to b − 1 (the module's convention). The
 * roster's earliest is frame 3, so the window never starts on the entry frame,
 * which `updateDodgeIntangibility` does not see (the status changes after it).
 */
export function dodgeIntangible(d: DodgeFrames): readonly [number, number] {
  return [d.intangible[0] - 1, d.intangible[1] - 1];
}
