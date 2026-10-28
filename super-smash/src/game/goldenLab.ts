/**
 * The golden trace's sixth match: four tumbles set up by hand (Plan 3, Task 12).
 *
 * Teching and bouncing is a landing rule, and the five matches reach only some
 * of it: a CPU never presses shield on the way down, and the scripted match
 * (`goldenScript.ts`) tumbles Fox only onto the floor, at launches that tech.
 * The wall and the stage's underside are not places a hit from the other
 * fighter reaches without an off-stage fight no script could keep tuned, and
 * the missed tech that lies down is a launch almost no hit makes: the launch
 * loses 0.051 a frame (`LAUNCH_SPEED_DECAY`) and a tumble's hitstun is 0.4
 * frames a point of knockback (80 or more), so the launch is still 0.8 or more
 * (a bounce's floor) until the last frame or two of the hitstun, and under it
 * only for knockback below 83. So this match starts each fighter already
 * launched, the way `combat.test.ts` does, and the real engine, roster and
 * stage do the rest. Final Destination is flat: the floor is y 0, and its
 * sides are walls 60 deep (`HARD_PLATFORM_DEPTH`).
 *
 * Mario (port 0) tumbles to the floor and techs with the stick held: a tech
 * roll. Fox (1) flies at the stage's right side below the floor: a wall tech.
 * Donkey Kong (2) flies up at the stage's underside: a ceiling tech. Pikachu
 * (3) comes down too fast to tech, bounces, and comes down again at a launch
 * spent to nothing, with hitstun to spare and no shield pressed: the missed
 * tech, which lies down (`downed`) and gets up (`getUp`).
 *
 * The launches are hand-set round numbers (nothing here is a published
 * figure): the pins in `golden.test.ts` notice if a rule change stops one
 * landing, and a task that moves them re-tunes the numbers below.
 */

import { fx } from "@/engine/fixed";
import { kineticLaunch } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";

export interface LabMatch {
  readonly name: string;
  readonly stage: string;
  readonly fighters: readonly string[];
  readonly seed: number;
  readonly rules: MatchRules;
  readonly frames: number;
  /** Put every fighter in its launch, before the first step. */
  readonly setup: (state: GameState) => void;
  /** Every port's keys on `frame` (from 1). */
  readonly inputs: (frame: number) => readonly InputFrame[];
}

/**
 * Launch `f` from (x, y) along (vx, vy), tumbling with `hitstun` frames to go.
 * Every launch here is along one axis, so its speed is that component's.
 */
function launch(f: FighterState, x: number, y: number, vx: number, vy: number, hitstun: number): void {
  Object.assign(f, {
    x: fx(x),
    y: fx(y),
    grounded: false,
    platform: -1,
    action: "tumble",
    actionFrame: 0,
    hitstun,
    intangible: 0,
    invincible: 0,
  });
  kineticLaunch(f, fx(vx), fx(vy), Math.abs(fx(vx)) + Math.abs(fx(vy)));
}

export const TECH_LAB: LabMatch = {
  name: "tech-lab-finalDestination",
  stage: "finalDestination",
  fighters: ["mario", "fox", "donkeyKong", "pikachu"],
  seed: 606,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false },
  frames: 200,
  setup(state) {
    const [mario, fox, donkeyKong, pikachu] = state.fighters;
    launch(mario, -50, 6, 0, -2, 60); //      the floor, at 2: techable
    launch(fox, 100, -20, -4, 0, 60); //      the right wall, at 4: techable
    launch(donkeyKong, -30, -100, 0, 4, 60); // the underside, at 4: techable
    launch(pikachu, 40, 40, 0, -3.5, 300); //  the floor, at 3.5: a bounce, then a launch spent to nothing
  },
  inputs(frame) {
    const S = Btn.Shield;
    // Mario holds right through his landing (frame 3), so his tech is a roll;
    // he and the other two press shield once, on the first frame (a tech
    // window is 11 frames). Pikachu presses nothing.
    return [frame === 1 ? S | Btn.Right : frame <= 4 ? Btn.Right : 0, frame === 1 ? S : 0, frame === 1 ? S : 0, 0];
  },
};
