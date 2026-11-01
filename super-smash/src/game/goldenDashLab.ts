/**
 * The golden trace's thirteenth match: a Final Smash dash and a cinematic Final Smash,
 * each whiffed in the air (Plan 5, Task 16 fix round 4; ruling P5-R14's way: new
 * behaviour visited in a lab).
 *
 * An aerial Final Smash holds its user where it is (rulings R-T16b, R-T16j, R-T16k), a
 * part that travels only before its first travel window: from it on, the dash keeps its
 * ordinary kinetics, carrying on and falling (ruling R-T16l, amended). No golden match
 * used either in the air: the beams lab's three trap nobody and have no dash, and the
 * Final Smash lab's Jungle Rush is used on the floor. A lab's fighters are fixed for its
 * match, and neither lab has a dasher (Marth, Pikachu) or a cinematic Final Smash with
 * the power still to use, so appending to one (ruling R-T11a) cannot reach these; they
 * get a lab of their own (ruling R-T8e), and the twelve other traces stay
 * byte-identical.
 *
 * Pikachu (port 0) against Fox (port 1) on Final Destination, both with the Smash
 * Ball's power, granted in the setup ("Standby Mode", `FINAL_SMASH_READY`, as breaking
 * the ball sets it). Pikachu starts in the air off the stage's left side, at (-140, 30),
 * facing it; Fox stands on the floor at 40, facing right. Nobody is ever in reach of
 * either Final Smash:
 * - Volt Tackle, in the air: Pikachu presses it on 1. It holds him at (-140, 30) through
 *   its startup (to 46); the tackle carries him 118.392 to -21.61 on 47-83 (3.2 a frame
 *   since Plan 5 final wave 2, ruling R-FW2i; 166.492 at Task 15's 4.5, over Fox's
 *   head), and from there on nothing holds him: his end sets him going at 3 on 84
 *   (`game_finalairdashend`'s SET_SPEED_EX(3, 0), fix round 1 of the final wave's part
 *   2, the re-review's M3), and he carries on to the right and falls, reaching the
 *   stage's right edge at the floor's height on 123, his move ending on 138 under it at
 *   (97.7, -11.4), and is KO'd off the bottom blast line on 221 (SmashWiki "Volt Tackle",
 *   https://www.ssbwiki.com/Volt_Tackle: "it is fairly easy to self-destruct off the side
 *   blast line if the player misses"). He started at -150 until that fix round: slowed to
 *   3 from there, he landed on the far side's edge, so he starts 10 nearer.
 * - Team Star Fox, in the air: Fox jumps on 160, jumps again on 172, and presses it on
 *   178, 50.45 up. Its trap box finds nobody, and it holds him there through its start
 *   (ruling R-T16j), which Pikachu's KO's freeze (221-235) stretches to 276; he falls
 *   with his midair jump back (`jumpsUsed` 2 → 1, ruling R-T16b), still in the air when
 *   the lab ends.
 *
 * Each step's comment gives the frame it starts on and the events it names. They were
 * checked against a run when the match was added; the pins in `golden.test.ts` notice
 * if a rule change stops one, and a task that moves them re-tunes the steps here.
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
const J = Btn.Jump;

const STEPS: readonly ScriptStep[] = [
  [1, B, 0], //                    1: Volt Tackle in the air, held to 46; the tackle 47-83
  [158, 0, 0], //                     carries Pikachu on; he falls, off the bottom blast line on 221
  [4, 0, J], //                  160: Fox's full hop
  [8, 0, 0],
  [1, 0, J], //                  172: his midair jump
  [5, 0, 0],
  [1, 0, B], //                  178: Team Star Fox in the air, held to 276 (the KO's freeze); then falls
  [122, 0, 0],
];

export const DASH_LAB: LabMatch = {
  name: "final-dash-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["pikachu", "fox"],
  seed: 923,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false },
  frames: 300,
  setup(state: GameState) {
    const [pikachu, fox] = state.fighters;
    const still = { actionFrame: 0, intangible: 0, invincible: 0 } as const;
    Object.assign(pikachu, still, { action: "fall", grounded: false, platform: -1, x: fx(-140), y: fx(30), facing: 1 });
    Object.assign(fox, still, { action: "stand", grounded: true, platform: 0, x: fx(40), y: 0, facing: 1 });
    for (const f of state.fighters) kineticClear(f);
    for (const f of state.fighters) f.finalSmashReady = FINAL_SMASH_READY;
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
