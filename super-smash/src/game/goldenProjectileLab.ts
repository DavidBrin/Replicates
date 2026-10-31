/**
 * The golden trace's tenth match: scripted keys for projectiles that live out
 * their lives (Plan 5, Task 13c; ruling P5-R14's way: visited, not exempted, and
 * the Task 6 carry: no golden match let a projectile reach the end of its life).
 *
 * No golden CPU lays a bomb, and the CPU matches' few projectiles hit, are caught
 * or leave the stage. Every lab's fighters are fixed for its match and none has
 * Samus, so this one is its own (ruling R-T8e), and the nine traces before it stay
 * byte-identical (ruling R-T11a).
 *
 * Samus (port 0) against Link (port 1) on Final Destination, a stock match. They
 * start standing apart, facing each other:
 * - the bomb: Samus lays one; it hops, bounces, goes off on its timer by the
 *   floor and rests there, hitting nobody;
 * - the clank: Samus's uncharged Charge Shot and Link's uncharged arrow meet
 *   half way, and both are gone (5% and 4%, within 9%);
 * - the end of a life: Samus fires again, Link jumps it, and the shot flies on to
 *   its 60th frame and is gone;
 * - the rebound (Task 13c fix round 1, ruling R-T13c-f: appended after frame 200,
 *   the steps before it untouched): Samus fires once more and Link jabs into the
 *   shot. They clank (5% against 3%, within 9%): the shot is gone, and Link, on the
 *   ground and beaten by no more than 9%, freezes for the shot's hitlag and then
 *   rebounds (`rebound`, which no other golden match reaches);
 * - the smash-input specials (Task 13d, ruling R-T11a: appended after frame 300,
 *   the steps before it untouched): Samus's Super Missile waits, flies and hits
 *   Link, and Link's smash-thrown Boomerang hits Samus, turns and comes home. No
 *   other golden match smash-inputs a special;
 * - the failed throw (Task 13d fix round 1, ruling R-T13d-d: appended after frame
 *   600): Link throws the Boomerang and, with it out, throws again, which fails.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added; the pins in
 * `golden.test.ts` (`PROJECTILE_PATHS`) notice if a rule change stops one, and a
 * task that moves them re-tunes the steps here.
 */

import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import type { LabMatch } from "./goldenLab";
import { scriptedInputs } from "./goldenScript";
import type { ScriptStep } from "./goldenScript";

const B = Btn.Special;
const A = Btn.Attack;
const D = Btn.Down;
const J = Btn.Jump;
const L = Btn.Left;
const R = Btn.Right;
const S = Btn.Soft;

const STEPS: readonly ScriptStep[] = [
  // The bomb.
  [1, D | B, 0], //                  1: Samus lays a bomb, out on 11 at (-29, 2); it
  [48, 0, 0], //                        bounces on 48, 72 and 86, goes off on 83 (a hop
  //                                    0.36 off the floor), rests from 94 and is gone
  //                                    after 100, its 90th frame: it hits nobody
  // The clank.
  [1, B, B], //                     50: Samus starts a charge; Link draws his bow
  [4, 0, 0],
  [1, B, 0], //                     55: Samus fires it uncharged: the shot and the arrow
  [64, 0, 0], //                        are out on 65, meet on 75 and are both gone
  // The end of a life.
  [1, B, 0], //                    120: Samus again
  [4, 0, 0],
  [1, B, 0], //                    125: fires, out on 135
  [24, 0, 0],
  [1, 0, J], //                    150: Link jumps it; the shot flies on, past him, and
  [50, 0, 0], //                        is gone after 194, its 60th frame
  // The rebound (Task 13c fix round 1).
  [1, B, 0], //                    201: Samus again
  [4, 0, 0],
  [1, B, 0], //                    206: fires, out on 216
  [27, 0, 0],
  [1, 0, A], //                    234: Link jabs; his jab and the shot clank on 240 (any
  [66, 0, 0], //                        press from 229 to 240 does): the shot is gone, Link
  //                                    freezes 8 (the shot's 5%) and rebounds 16 frames,
  //                                    248 to 263, standing on 264; to 300, the trace's
  //                                    next sample
  // The smash-input specials (Task 13d, appended after frame 300, ruling R-T11a).
  [1, R | B, 0], //                301: Samus presses Right and B together, a smash
  [119, 0, 0], //                       input: her Super Missile, out on 321; it waits
  //                                    26 frames at 0.18, flies from 347 and hits Link
  //                                    on 368 (12%, ×1.2 one-on-one: 14.4%); he lands
  //                                    on 410
  [1, 0, L | B], //                421: Link throws the Boomerang with a smash input:
  [179, 0, 0], //                       out on 447 at 3.1, it hits Samus on 473 (9.6%,
  //                                    ×1.2: 11.52%), turns on 507 (age 60) and is
  //                                    caught on 566; to 600, the trace's last sample
  // The failed throw (Task 13d fix round 1, ruling R-T13d-d; appended after 600).
  [1, 0, S | L | B], //            601: Link throws the Boomerang as a tilt (Tilt held):
  [49, 0, 0], //                        out on 627 at 2.4
  [1, 0, L | B], //                651: and again with a smash input while it is out:
  [149, 0, 0], //                       the failed throw, launching nothing, actionable
  //                                    on 710 (its 60th frame); the Boomerang turns on
  //                                    672 and is caught on 717; to 800, the trace's
  //                                    last sample
];

export const PROJECTILE_LAB: LabMatch = {
  name: "projectile-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["samus", "link"],
  seed: 1013,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 800,
  setup(state: GameState) {
    const [samus, link] = state.fighters;
    Object.assign(samus, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-30), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(link, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(30), y: 0, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
