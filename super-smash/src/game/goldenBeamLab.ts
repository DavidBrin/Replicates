/**
 * The golden trace's twelfth match: the Final Smashes that trap nobody, staged
 * (Plan 5, Task 16; ruling P5-R14's way: new behaviour visited in a lab). Zero
 * Laser's beam strikes a fighter again every 10 of its frames (its rehit), Mario
 * Finale's flames every 7 and hotter from their mid stage, and the Ancient Arrow
 * flies and strikes the first fighter in its line.
 *
 * No golden match breaks a Smash Ball (the scripted match plays with it on, every
 * other with it off), and a lab's fighters are fixed for its match while every other
 * lab's trace must stay as it is (rulings R-T8e, R-T11a): standby granted in an
 * existing lab's setup would change its digest from its first sample. So these get a
 * lab of their own, and the eleven other traces stay byte-identical.
 *
 * Four fighters on Battlefield (a free-for-all, not one-on-one): Samus (port 0) on the
 * floor at x -75, facing right; Link (port 1) on the right soft platform at 42, facing
 * left; Donkey Kong (port 2) on the floor at -45, facing left, the one fighter without
 * the power; Mario (port 3) on the left soft platform at -30, facing left. The setup
 * grants Samus, Link and Mario the Smash Ball's power ("Standby Mode",
 * `FINAL_SMASH_READY`, as breaking the ball sets it). Each Final Smash comes after the
 * last is over, and each fighter it hits has spent its own or has none, so no hit
 * drops a standby (`dropSmashBall`), and no Final Smash's flames are still out when the
 * next starts:
 * - Zero Laser: the muzzle strikes Donkey Kong on 1 (1%) and 11 (2%), and the beam
 *   every 16 steps from 21 to 197 (twelve 1.5% hits, ten of its frames apart, each
 *   freezing Samus and him 7), its end on 213 (5.5%): fifteen hits, 27.82%. It pushes
 *   him along the floor under Link's platform and launches him onto the right ledge,
 *   where he hangs from 262 to the lab's end. The beam passes under both platforms,
 *   and Samus's Final Smash is over on 280.
 * - Mario Finale: Mario drops through his platform on 292, lands, and presses it on
 *   310; its flames are out on 314 and strike Samus, 35 ahead, on 374, 386, 398 and
 *   411 (2.5%, 50°, a launch to the left, so 130° in the world) and on 426 (3.0%, the
 *   mid stage's air box, 23°, so 157°), until they push her off the stage's left edge;
 *   she falls and is KO'd on 542. Mario's move ends on 466 and the flames on 534.
 * - The Ancient Bow and Arrow: Link drops through his platform on 520, lands, and
 *   presses it on 540, after the flames; Samus's KO freezes the match for 14 frames
 *   from 543, so the arrow is shot on 613 from 32 and strikes Mario, the first fighter
 *   in its line, 62 to its left, on 622: 35%, launched up and away at 120°.
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
import { BATTLEFIELD_LOWER_PLATFORM_Y } from "@/stages/battlefield";
import type { LabMatch } from "./goldenLab";

const B = Btn.Special;
const D = Btn.Down;

/** One step: how many frames, then each port's keys (Samus, Link, Donkey Kong, Mario). */
type Step = readonly [frames: number, samus: InputFrame, link: InputFrame, donkeyKong: InputFrame, mario: InputFrame];

const STEPS: readonly Step[] = [
  [1, B, 0, 0, 0], //                 1: Zero Laser; the muzzle hits Donkey Kong on 1 and 11
  [290, 0, 0, 0, 0], //                  the beam from 21 to 197, its end on 213; he hangs
  //                                     from the right ledge from 262
  [3, 0, 0, 0, D], //               292: Mario drops through the left platform
  [15, 0, 0, 0, 0],
  [1, 0, 0, 0, B], //               310: Mario Finale; the flames out on 314 strike Samus on
  [209, 0, 0, 0, 0], //                  374, 386, 398, 411 and 426, until she is off the
  //                                     stage; she is KO'd on 542
  [3, 0, D, 0, 0], //               520: Link drops through the right platform
  [17, 0, 0, 0, 0],
  [1, 0, B, 0, 0], //               540: the Ancient Bow and Arrow, after the flames (gone
  [160, 0, 0, 0, 0], //                  after 534); shot on 613 (Samus's KO froze 14),
  //                                     it strikes Mario on 622
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
  frames: 700,
  setup(state: GameState) {
    const [samus, link, donkeyKong, mario] = state.fighters;
    const floor = { grounded: true, platform: 0, y: fx(0.111) };
    const platform = { grounded: true, y: BATTLEFIELD_LOWER_PLATFORM_Y };
    const still = { action: "stand", actionFrame: 0, intangible: 0, invincible: 0 } as const;
    Object.assign(samus, still, floor, { x: fx(-75), facing: 1 });
    Object.assign(link, still, platform, { platform: 3, x: fx(42), facing: -1 });
    Object.assign(donkeyKong, still, floor, { x: fx(-45), facing: -1 });
    Object.assign(mario, still, platform, { platform: 1, x: fx(-30), facing: -1 });
    for (const f of state.fighters) kineticClear(f);
    for (const f of [samus, link, mario]) f.finalSmashReady = FINAL_SMASH_READY;
  },
  inputs: stepInputs(STEPS),
};
