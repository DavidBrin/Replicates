/**
 * The golden trace's eighth match: scripted keys for Kirby's Inhale (Plan 5,
 * Task 9; ruling P5-R14: new actions are visited, not exempted).
 *
 * No golden CPU inhales (a CPU fires specials only to recover), and the states
 * lab (`goldenStatesLab.ts`) is Donkey Kong against Mario, whose trace must stay
 * byte-identical, so Inhale gets a lab of its own (ruling R-T8e).
 *
 * Kirby (port 0) against Mario (port 1) on Final Destination, a stock match.
 * They start a little apart, facing each other, so the steps below are about
 * the moves, not the walk to them; Mario's one key is a walk:
 * - the spit: Kirby inhales Mario (`inhaleHold`, `swallowed`), walks a few steps
 *   with his mouthful, and spits him (`spatStar`): Mario rides the star across
 *   the stage, is let go and lands;
 * - the swallow: Kirby walks back up to him, inhales him again, swallows him for
 *   his Fireball (the Copy Ability), and throws two copied Fireballs at him, ×1.2.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added (Plan 5, Task 9); the pins
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
const B = Btn.Special;
const A = Btn.Attack;

const STEPS: readonly ScriptStep[] = [
  // The spit.
  [1, B, 0], //                     1: Inhale; Mario is caught on 10
  [19, 0, 0],
  [12, R, 0], //                   21: walks right with his mouthful
  [8, 0, 0],
  [1, A, 0], //                    41: spit, released on 48 (7.20%); Mario rides the
  [119, 0, 0], //                      star to 75, falls from 76 and lands on 134
  // The swallow.
  [40, R, 0], //                  161: runs back up to Mario, standing from 205
  [10, 0, 0],
  [1, B, 0], //                   211: Inhale again; Mario is caught on 220
  [19, 0, 0],
  [1, B, 0], //                   231: swallow, released on 238 (12%): Mario's Fireball
  [20, 0, 0],
  [12, 0, R], //                  252: Mario walks off ahead of him
  [7, 0, 0],
  [1, B, 0], //                   271: a copied Fireball, out on 287, hits on 299 (7.20%)
  [49, 0, 0],
  [1, B, 0], //                   321: and another, out on 337, hits on 349
  [79, 0, 0],
];

export const INHALE_LAB: LabMatch = {
  name: "inhale-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["kirby", "mario"],
  seed: 909,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 400,
  setup(state: GameState) {
    const [kirby, mario] = state.fighters;
    Object.assign(kirby, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-60), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-50), y: 0, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
