/**
 * The golden trace's fifteenth match: scripted keys for a clank, a hit on a shield
 * and a pummel (Plan 5 final wave, part 3; the Task 13b re-review 1's carry).
 *
 * `rebound`, `shieldStun` and `pummel` each rested on one non-CPU golden match (the
 * script or the projectile lab), so a re-tuned step there could drop one with
 * nothing else to reach it. Appending them to a lab would move that lab's trace,
 * so they get a lab of their own (as the crawl did, ruling R-T8e), and the other
 * fourteen traces stay byte-identical.
 *
 * Mario (port 0) against Donkey Kong (port 1) on Final Destination, a stock match,
 * 15 apart and facing each other:
 * - the clank: Donkey Kong jabs on 1 and Mario on 4; the two jabs meet on 5 and
 *   both rebound, actionable on 32 (`clank.test.ts` plays the same pair);
 * - the shield hit: Mario shields from 36; Donkey Kong walks up from 36 and jabs on
 *   46, which meets the shield on 50: `shieldStun` to 61;
 * - the pummel: Donkey Kong grabs Mario out of his shield on 91 (the grab catches
 *   him on 98 and holds him from 99), pummels on 102 (2%, on 103), and down-throws
 *   him on 130; Mario is launched on 148 and stands again on 175.
 *
 * Each step's comment gives the frame it starts on and the events it names. They
 * were checked against a run when the match was added; the pins in `golden.test.ts`
 * (every action state visited, and this lab's own) notice if a rule change stops
 * one, and a task that moves them re-tunes the steps here.
 */

import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import type { LabMatch } from "./goldenLab";
import { scriptedInputs } from "./goldenScript";
import type { ScriptStep } from "./goldenScript";

const A = Btn.Attack;
const S = Btn.Shield;
const G = Btn.Grab;
const D = Btn.Down;
/** A walk: a part-way push (`Btn.Soft`) toward Mario. */
const WALK_IN = Btn.Left | Btn.Soft;

const STEPS: readonly ScriptStep[] = [
  // The clank.
  [1, 0, A], //                     1: Donkey Kong jabs
  [2, 0, 0],
  [1, A, 0], //                     4: Mario jabs; the jabs clank on 5, both rebound
  [31, 0, 0], //                       to 31, standing on 32
  // The shield hit.
  [10, S, WALK_IN], //             36: Mario shields; Donkey Kong walks in, to 10.1
  [1, S, A], //                    46: Donkey Kong jabs: Mario's shield is hit on 50,
  [44, S, 0], //                       `shieldStun` to 61
  // The pummel.
  [1, S, G], //                    91: Donkey Kong grabs him out of his shield,
  [10, 0, 0], //                       catching him on 98, holding him from 99
  [1, 0, A], //                   102: the pummel, 2% on 103
  [27, 0, 0],
  [1, 0, D], //                   130: the down throw: Mario launched on 148,
  [69, 0, 0], //                       standing on 175
];

export const CONTACT_LAB: LabMatch = {
  name: "contact-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["mario", "donkeyKong"],
  seed: 909,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 200,
  setup(state: GameState) {
    const [mario, dk] = state.fighters;
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(0), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(dk, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(15), y: 0, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
