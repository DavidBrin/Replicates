/**
 * The golden trace's sixteenth match: scripted keys for the edge slip (Plan 6, Task 7;
 * ruling P5-R14: new actions are visited, not exempted).
 *
 * No golden match slips, and none can on Final Destination, where the states lab plays:
 * its only edges carry ledges, and a fighter knocked off one takes the ledge on the step
 * it leaves the ground (SmashWiki "Edge slipping": "If the edge is grabbable, then they
 * will always grab it"), so no recorded state is ever the slip. So the slip gets a lab of
 * its own on Battlefield, whose soft platforms have no ledges (ruling R-T8e, as the crawl
 * lab did), appended last so every other trace stays byte-identical.
 *
 * Mario (port 0) against Donkey Kong (port 1), both on Battlefield's top platform: Mario
 * at -2 facing right, Donkey Kong 1.8 short of its right end, facing him. Donkey Kong
 * never presses a key:
 * - F.L.U.D.D.: Mario's bare down special, pressed twice, pumps water from 21;
 * - the slip: the water pushes Donkey Kong backward, off the platform's end on 24: he
 *   slips (his 25 frames), pushed on up and away by the later pumps, falls from 49, and
 *   lands on the main stage on 107.
 *
 * Each step's comment gives the frame it starts on and the events it names, checked
 * against a run when the lab was added (Plan 6, Task 7); the pins in `golden.test.ts`
 * (every action state visited) notice if a rule change stops one, and a task that moves
 * them re-tunes the steps here.
 */

import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import { BATTLEFIELD_UPPER_PLATFORM_Y } from "@/stages/battlefield";
import type { LabMatch } from "./goldenLab";
import { scriptedInputs } from "./goldenScript";
import type { ScriptStep } from "./goldenScript";

const DOWN_B = Btn.Down | Btn.Special;

const STEPS: readonly ScriptStep[] = [
  [1, DOWN_B, 0], //               1: F.L.U.D.D.
  [14, 0, 0],
  [1, DOWN_B, 0], //              16: the pumps, the first reaching Donkey Kong on 21;
  //                                  he leaves the platform's end on 24: the slip, to 48
  [104, 0, 0], //                 17: falls from 49, lands on the main stage on 107
];

/** Battlefield's top platform, the soft one at its centre. */
const TOP = 2;

export const SLIP_LAB: LabMatch = {
  name: "slip-lab-battlefield",
  stage: "battlefield",
  fighters: ["mario", "donkeyKong"],
  seed: 909,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 120,
  setup(state: GameState) {
    const [mario, donkeyKong] = state.fighters;
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: TOP, x: fx(-2), y: BATTLEFIELD_UPPER_PLATFORM_Y, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(donkeyKong, { action: "stand", actionFrame: 0, grounded: true, platform: TOP, x: fx(15.5), y: BATTLEFIELD_UPPER_PLATFORM_Y, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
