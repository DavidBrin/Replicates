/**
 * The golden trace's eleventh match: a cinematic Final Smash, staged (Plan 5,
 * Task 15; ruling P5-R14: new actions are visited, not exempted).
 *
 * No golden match breaks a Smash Ball (the scripted match plays with it on,
 * `goldenScript.ts`; every other with it off), so nothing else reaches
 * `finalTrapped`. A lab's fighters are fixed for the
 * match and every other lab's trace must stay as it is (rulings R-T8e, R-T11a):
 * granting standby in an existing lab's setup would change its digest from its
 * first sample (the digest reads `finalSmashReady`). So the Final Smash gets a
 * lab of its own, and the ten other traces stay byte-identical.
 *
 * Donkey Kong (port 0) against Mario (port 1) on Final Destination, a one-on-one
 * stock match. Donkey Kong starts with the Smash Ball's power, granted in the
 * setup ("Standby Mode", `FINAL_SMASH_READY`, as breaking the ball sets it), 18
 * units from Mario, facing him; Mario never presses a key:
 * - the trap: Donkey Kong's neutral special is Jungle Rush; its detection punch
 *   (a capsule, 8 to 28 units ahead) traps Mario on frame 29 for 15.12% (12%,
 *   ×1.05 fresh, ×1.2 one-on-one), both frozen 30 frames (its hitlag ×5);
 * - the scene: on the start's frame 37 (frame 66) the barrage plays, 31 punches
 *   with Mario in `finalTrapped` and the match otherwise still
 *   (`GameState.cinematic`), to 60.34%;
 * - the launch: the uppercut, the end's frame 7 (the end from frame 229, so 235),
 *   launches him at 77.98% into a tumble, 150 units up by frame 297; Donkey Kong's
 *   end is over on 304 (its 61 frames, fix round 1, ruling R-T15i), and the lab
 *   ends with Mario falling.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added (Plan 5, Task 15); the pins
 * in `golden.test.ts` (every action state visited) notice if a rule change stops
 * one, and a task that moves them re-tunes the steps here.
 */

import { FINAL_SMASH_READY } from "@/engine/final";
import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import type { LabMatch } from "./goldenLab";
import { scriptedInputs } from "./goldenScript";
import type { ScriptStep } from "./goldenScript";

const B = Btn.Special;

const STEPS: readonly ScriptStep[] = [
  [1, B, 0], //                    1: Jungle Rush; the punch traps Mario on 29
  [399, 0, 0], //                     the barrage from 66, the uppercut on 235
];

export const FINAL_LAB: LabMatch = {
  name: "final-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["donkeyKong", "mario"],
  seed: 909,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 400,
  setup(state: GameState) {
    const [donkeyKong, mario] = state.fighters;
    Object.assign(donkeyKong, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-30), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-12), y: 0, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
    donkeyKong.finalSmashReady = FINAL_SMASH_READY;
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
