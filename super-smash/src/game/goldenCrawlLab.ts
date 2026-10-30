/**
 * The golden trace's ninth match: scripted keys for Pikachu's crawl (Plan 5,
 * Task 12; ruling P5-R14: new actions are visited, not exempted).
 *
 * No golden CPU crawls, and neither lab has a fighter who can: the states lab
 * (`goldenStatesLab.ts`) is Donkey Kong against Mario and the Inhale lab
 * (`goldenInhaleLab.ts`) Kirby against Mario, and a lab's fighters are fixed
 * for the match, so appending to either (ruling R-T11a) cannot reach it. So the
 * crawl gets a lab of its own (ruling R-T8e), and the other eight traces stay
 * byte-identical.
 *
 * Pikachu (port 0) against Mario (port 1) on Final Destination, a stock match.
 * They start standing apart, facing each other; Mario never presses a key:
 * - the crawl: Pikachu crouches, crawls forward at 0.7, back at 0.5 still
 *   facing Mario, stops crouched, and crawls forward again;
 * - the down tilt out of it: still crawling, Pikachu attacks: the down tilt,
 *   which hits Mario on its frame 7 (UltimateFrameData's startup);
 * - off the edge (ruling R-T12b): crouched again, Pikachu crawls back, still
 *   facing the stage, off its left edge, falls and catches the ledge on the
 *   frame it leaves the ground, and climbs back up.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added (Plan 5, Task 12); the pins
 * in `golden.test.ts` (every action state visited) notice if a rule change stops
 * one, and a task that moves them re-tunes the steps here.
 */

import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import type { LabMatch } from "./goldenLab";
import { scriptedInputs } from "./goldenScript";
import type { ScriptStep } from "./goldenScript";

const D = Btn.Down;
const R = Btn.Right;
const L = Btn.Left;
const A = Btn.Attack;

const STEPS: readonly ScriptStep[] = [
  // The crawl, from -60.
  [12, D, 0], //                    1: crouches, crouched from 6
  [10, D | R, 0], //               13: crawls forward, 0.7 a frame, to -53.0 on 22
  [10, D | L, 0], //               23: crawls back, 0.5 a frame, still facing Mario
  [4, D, 0], //                    33: stops, crouched (it slides to -58.71)
  [8, D | R, 0], //                37: crawls forward again...
  [1, D | R | A, 0], //            45: ...and down tilts out of the crawl, which hits
  [26, D, 0], //                       Mario on 51 (its frame 7) for 7.56% (6.0, ×1.05
  //                                   fresh, ×1.2 one-on-one); crouches again from 72
  // Off the edge.
  [62, D | L, 0], //               72: crawls back from 77, facing the stage, off its
  //                                   left edge (-80.0): falls and catches the ledge on 133
  [16, 0, 0],
  [1, R, 0], //                   150: climbs up, standing on 176
  [50, 0, 0],
];

export const CRAWL_LAB: LabMatch = {
  name: "crawl-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["pikachu", "mario"],
  seed: 808,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 200,
  setup(state: GameState) {
    const [pikachu, mario] = state.fighters;
    Object.assign(pikachu, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-60), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-45), y: 0, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
