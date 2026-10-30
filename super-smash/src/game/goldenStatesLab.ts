/**
 * The golden trace's seventh match: scripted keys for the Plan 5 states no other
 * match reaches (ruling P5-R14: new actions are visited, not exempted).
 *
 * No CPU grabs in the golden matches, and the scripted match (`goldenScript.ts`)
 * is Mario against Fox, so Donkey Kong's cargo (Task 8) has to be driven by hand.
 * Tasks 9, 11 and 12 extend this match for Inhale, the footstool and the crawl.
 *
 * Donkey Kong (port 0) against Mario (port 1) on Final Destination, a stock
 * match. They start standing a grab's reach apart, facing each other, so the
 * steps below are about the moves, not the walk to them:
 * - the struggle: Donkey Kong grabs Mario and lifts him onto his shoulders
 *   (`cargoCarry`, `cargoHeld`), and Mario mashes out of the carry, a grab
 *   release, falling from where he rode;
 * - the carry: once Mario's grab immunity is over, Donkey Kong grabs and lifts
 *   him again, walks, jumps with him, and throws him with the cargo up throw
 *   pressed in the air just before he lands, so the throw finishes on the ground
 *   (the landing keeps a cargo throw going) and launches Mario into a tumble.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added (Plan 5, Task 8); the pins
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

const R = Btn.Right;
const U = Btn.Up;
const A = Btn.Attack;
const J = Btn.Jump;
const G = Btn.Grab;

/** `n` presses of `key` on port 1, one every other frame: a mash. */
function mash(n: number, key: InputFrame): ScriptStep[] {
  return Array.from({ length: n }, (): ScriptStep[] => [
    [1, 0, key],
    [1, 0, 0],
  ]).flat();
}

const STEPS: readonly ScriptStep[] = [
  // The struggle. Mario mashes the grab button: a press counts as any button's,
  // and does nothing once he is free in the air.
  [1, G, 0], //                   1: Donkey Kong grabs; Mario is caught on 8
  [11, 0, 0],
  [1, R, 0], //                  13: forward throw: the lift, carrying from 28
  [16, 0, 0],
  ...mash(15, G), //             30: Mario mashes out on 48 (the carry's 20th frame), lands on 73
  [55, 0, 0],
  // The carry, once Mario's grab immunity is over (on 108).
  [1, G, 0], //                 115: grab again; Mario is caught on 122
  [10, 0, 0],
  [1, R, 0], //                 126: the lift, carrying from 141
  [20, 0, 0],
  [20, R, 0], //                147: walks right, carrying
  [1, J, 0], //                 167: jumps with him, a full hop that lands on 220
  [47, 0, 0],
  [1, U | A, 0], //             215: cargo up throw, in the air...
  [185, 0, 0], //               216: ...landing inside it on 220; the release on 229 (15.12%),
  //                                 and Mario tumbles, lies down on 295 and stands on 365
];

export const STATES_LAB: LabMatch = {
  name: "states-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["donkeyKong", "mario"],
  seed: 707,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 400,
  setup(state: GameState) {
    const [donkeyKong, mario] = state.fighters;
    Object.assign(donkeyKong, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-20), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-8), y: 0, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
