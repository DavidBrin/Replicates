/**
 * The golden trace's twelfth match: the Final Smashes that trap nobody, staged
 * (Plan 5, Task 16; ruling P5-R14's way: new behaviour visited in a lab). Zero
 * Laser's beam strikes a fighter again every 10 of its frames (its rehit) and its
 * fringe beams every 8, Mario Finale's flames strike a fighter and carry them off the
 * stage, and the Ancient Arrow flies and strikes the first fighter in its line; the
 * last two are used in the air, where they hold their users (fix round 1, ruling
 * R-T16b).
 *
 * No golden match breaks a Smash Ball (the scripted match plays with it on, every
 * other with it off), and a lab's fighters are fixed for its match while every other
 * lab's trace must stay as it is (rulings R-T8e, R-T11a): standby granted in an
 * existing lab's setup would change its digest from its first sample. So these get a
 * lab of their own, and the eleven other traces stay byte-identical.
 *
 * Four fighters on Battlefield (a free-for-all, not one-on-one): Samus (port 0) on the
 * floor at x -75, facing right; Link (port 1) on the top platform at 10, facing left;
 * Donkey Kong (port 2) on the floor at -45, facing left, the one fighter without the
 * power; Mario (port 3) on the top platform at -15, facing left. The setup grants
 * Samus, Link and Mario the Smash Ball's power ("Standby Mode", `FINAL_SMASH_READY`, as
 * breaking the ball sets it). Each Final Smash comes after the last is over, its
 * projectiles included (Task 16 fix round 1, ruling R-T16a), and each fighter it hits
 * has spent its own or has none, so no hit drops a standby (`dropSmashBall`):
 * - Zero Laser (fix round 1: its start, its scripted clears and its fringe beams,
 *   rulings R-T16c to R-T16e; fix round 4: on the muzzle's axis, 15 up, ruling
 *   R-T16o): the start's charge strikes Donkey Kong on 48 and 59 (1%) and its pulls
 *   draw him in; the muzzle on 70 and 77 (1% and 2%); then the beam (1.5%, 13 hits) from
 *   81 and the fringe beams (0.5%; 16 above, 15 below) from 92, each on its own record,
 *   carry him along the floor; the end and both blasts on 417 (5.5% and 2.5% twice): 51
 *   hits, 53.0%. He tumbles off to the right and is KO'd on 666. The fringe beams pass
 *   under the top platform (the upper one, 29 up, reaches the lower platforms, where
 *   Link and Mario stood before fix round 1), and Samus's Final Smash is over on
 *   485. Donkey Kong, Link and Mario are slowed by its start's `SLOW_OPPONENT(5, 50)`
 *   (Plan 6, Task 11; before it the charge struck on 48, 58 and 68, the end landed on
 *   412 and the KO came on 593).
 * - Mario Finale, in the air (ruling R-T16b): Mario drops through the top platform on
 *   480 and presses it on 513, 10 up, where it holds him until 659; its flames are out
 *   on 517 and strike Samus, slowed by its start (Plan 6, Task 11), on 617 and 629
 *   (3.0%, the mid stage: 50°, a launch to the
 *   left, so 130° in the world, then the air box's 23°, 157°), until she is off the
 *   stage's left edge; she falls and is KO'd on 761. Its end lifts Mario by his short
 *   hop (`finalHeightBoost`, Plan 6, Task 10), and he lands on 719; the flames are gone
 *   on 751.
 * - The Ancient Bow and Arrow, in the air: Link drops through the top platform on 780
 *   and presses it on 810, 12 up, after the flames, where it holds him until 909; the
 *   arrow is shot on 869 from 0 and strikes Mario, the first fighter in its line, on
 *   871: 35%, launched up and away at 120°. Its end lifts Link by his short hop, and he
 *   lands on 949, the lab's next-to-last frame.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added (Plan 5, Task 16); the pins in
 * `golden.test.ts` notice if a rule change stops one, and a task that moves them
 * re-tunes the steps here.
 */

import { FINAL_SMASH_READY } from "@/engine/final";
import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import { BATTLEFIELD_UPPER_PLATFORM_Y } from "@/stages/battlefield";
import type { LabMatch } from "./goldenLab";

const B = Btn.Special;
const D = Btn.Down;

/** One step: how many frames, then each port's keys (Samus, Link, Donkey Kong, Mario). */
type Step = readonly [frames: number, samus: InputFrame, link: InputFrame, donkeyKong: InputFrame, mario: InputFrame];

const STEPS: readonly Step[] = [
  [1, B, 0, 0, 0], //                 1: Zero Laser; its charge strikes Donkey Kong on 48
  [478, 0, 0, 0, 0], //                  and 59, the muzzle on 70 and 77, the beam from 81 and
  //                                     the fringe beams from 92, the end on 417; over on
  //                                     485; he is KO'd on 666
  [3, 0, 0, 0, D], //               480: Mario drops through the top platform
  [30, 0, 0, 0, 0],
  [1, 0, 0, 0, B], //               513: Mario Finale in the air, held there until 659; the
  [266, 0, 0, 0, 0], //                  flames out on 517 strike Samus on 617 and 629, until
  //                                     she is off the stage; she is KO'd on 761
  [3, 0, D, 0, 0], //               780: Link drops through the top platform
  [27, 0, 0, 0, 0],
  [1, 0, B, 0, 0], //               810: the Ancient Bow and Arrow in the air, after the
  [140, 0, 0, 0, 0], //                  flames (gone after 751), held until 909; shot on
  //                                     869, it strikes Mario on 871
];

/** The steps, frame by frame: every port's keys on `frame` (from 1); none past the last. */
function stepInputs(steps: readonly Step[]): (frame: number) => readonly InputFrame[] {
  const perFrame: (readonly InputFrame[])[] = [];
  for (const [frames, ...keys] of steps) for (let i = 0; i < frames; i++) perFrame.push(keys);
  return (frame) => perFrame[frame - 1] ?? [0, 0, 0, 0];
}

export const BEAM_LAB: LabMatch = {
  name: "final-beams-lab-battlefield",
  stage: "battlefield",
  fighters: ["samus", "link", "donkeyKong", "mario"],
  seed: 916,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false },
  frames: 950,
  setup(state: GameState) {
    const [samus, link, donkeyKong, mario] = state.fighters;
    const floor = { grounded: true, platform: 0, y: fx(0.111) };
    const top = { grounded: true, platform: 2, y: BATTLEFIELD_UPPER_PLATFORM_Y };
    const still = { action: "stand", actionFrame: 0, intangible: 0, invincible: 0 } as const;
    Object.assign(samus, still, floor, { x: fx(-75), facing: 1 });
    Object.assign(link, still, top, { x: fx(10), facing: -1 });
    Object.assign(donkeyKong, still, floor, { x: fx(-45), facing: -1 });
    Object.assign(mario, still, top, { x: fx(-15), facing: -1 });
    for (const f of state.fighters) kineticClear(f);
    for (const f of [samus, link, mario]) f.finalSmashReady = FINAL_SMASH_READY;
  },
  inputs: stepInputs(STEPS),
};
