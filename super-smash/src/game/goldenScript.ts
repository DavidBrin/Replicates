/**
 * The golden trace's fifth match: scripted keys, not a CPU.
 *
 * The four CPU matches in `golden.test.ts` never grab, never spot-dodge, never
 * break a shield and never jump from a ledge, and `src/ai` never presses
 * `Btn.Soft` at all. This match drives both ports through exactly those paths,
 * frame by frame, so the tasks that move them into statuses have a net under
 * them. It also walks through every other state the CPU matches reach only once
 * or twice (crouch, run brake, the ledge options, a self-destruct and respawn),
 * so a behaviour change that shifts a CPU's choices cannot quietly take one of
 * them out of the trace.
 *
 * Mario (port 0) against Fox (port 1) on Final Destination: one flat platform
 * with a ledge at each end at x ±80, so every distance is a straight line. Seed
 * 505 feeds only the Smash Ball, the one random thing in a match. It is a timed
 * match with the Smash Ball on, so 2,400 frames also run the timer to a `timeUp`
 * outcome and a Smash Ball from its spawn on frame 900 to its decay.
 *
 * Some step lengths are tuned to the engine as it stood on 2026-10-27 (954ed97):
 * how far a walk carries Mario, and when he reaches a ledge. The coverage test in
 * `golden.test.ts` is what notices if they stop landing. A behaviour task that
 * moves the fighters (walk speed, traction, jump arcs) re-tunes them until it
 * passes again, then regenerates the trace.
 */

import { Btn } from "@/engine/types";
import type { InputFrame, MatchRules } from "@/engine/types";

/** Hold these buttons on port 0 and port 1 for this many frames. */
export type ScriptStep = readonly [frames: number, p0: InputFrame, p1: InputFrame];

export interface ScriptedMatch {
  readonly name: string;
  readonly stage: string;
  readonly fighters: readonly [string, string];
  readonly seed: number;
  readonly rules: MatchRules;
  readonly frames: number;
  readonly steps: readonly ScriptStep[];
}

const L = Btn.Left;
const R = Btn.Right;
const U = Btn.Up;
const D = Btn.Down;
const A = Btn.Attack;
const B = Btn.Special;
const S = Btn.Shield;
const J = Btn.Jump;
const G = Btn.Grab;
const SOFT = Btn.Soft;

/*
 * Mario starts at x -30 facing right, Fox at x 30 facing left. Each comment
 * gives the frame its step starts on.
 */
const STEPS: readonly ScriptStep[] = [
  [20, 0, 0], //                    1: both land from the entry drop
  // A soft-stick walk: Soft keeps a held direction a walk instead of a dash.
  [40, R | SOFT, 0], //            21: Mario walks to about 10 from Fox
  [10, 0, 0],
  // Grab, and hold until the 60-frame hold lets go on its own.
  [1, G, 0], //                    71: grab: Fox is grabbed
  [70, 0, 0], //                   72: grabHold, then both stand
  [3, R | SOFT, 0], //            142: in to about 8: a throw reaches, a pummel does not
  [10, 0, 0],
  // Grab, pummel (it whiffs at this range), forward throw. Fox holds a soft up
  // through the throw, so its launch takes soft DI.
  [1, G, 0], //                   155: grab
  [15, 0, 0],
  [1, A, 0], //                   171: pummel, then back to grabHold
  [15, 0, 0],
  [1, R, SOFT | U], //            187: forward throw: Fox is thrown, then launched
  [40, 0, SOFT | U],
  [17, R | SOFT, 0], //           228: in to about 8 again, for the jabs below
  [43, 0, 0],
  // Fox shields, then spot-dodges out of it.
  [10, 0, S], //                  288: shield
  [1, 0, S | D], //               298: spotDodge
  [30, 0, 0],
  // Fox shields until it breaks; Mario jabs it three times on the way.
  [40, 0, S], //                  329: shield
  [1, A, S], //                   369: jab: shieldStun
  [30, 0, S],
  [1, A, S], //                   400: jab: shieldStun
  [30, 0, S],
  [1, A, S], //                   431: jab: shieldStun
  [300, 0, S], //                 432: the shield breaks: shieldBroken
  // Mario forward-smashes the stunned Fox, who holds a soft up through the launch.
  [1, R, SOFT | U], //            732: a fresh right...
  [1, R | A, SOFT | U], //        733: ...and attack inside 5 frames: forward smash
  [100, 0, SOFT | U], //          734: tumble, downed, getUp
  // Mario walks off the right edge onto the ledge. Each walk to a ledge ends
  // inside the hang's first 4 frames, when it ignores the stick: a right still
  // held after that would let go and regrab, over and over.
  [33, R | SOFT, 0], //           834: ledgeHang
  [17, 0, 0],
  [1, J, 0], //                   884: ledgeJump, then jump
  [20, L, 0], //                  885: drift back over the stage
  [40, 0, 0],
  [1, L | A, 0], //               945: forward air on the way down...
  [55, 0, 0], //                  946: ...that lands inside itself: landingLag
  // Soft turns a fresh direction plus attack into a tilt.
  [1, L | SOFT, 0], //           1001: facing left since the ledge
  [1, L | SOFT | A, 0], //       1002: forward tilt, not forward smash
  [40, 0, 0],
  [12, D, 0], //                 1043: crouchStart, crouch
  [12, 0, 0], //                 1055: crouchEnd
  [30, L, 0], //                 1067: walk, dashStart, run
  [1, R, 0], //                  1097: reversing a run: turnaround
  [20, 0, 0],
  [30, R, 0], //                 1118: run
  [15, 0, 0], //                 1148: let go: runBrake
  [50, R | SOFT, 0], //          1163: to the right ledge again
  [30, 0, 0],
  [1, L, 0], //                  1243: toward the stage: ledgeGetUp
  [40, 0, 0],
  [10, R | SOFT, 0], //          1284: back onto the ledge
  [20, 0, 0],
  [1, A, 0], //                  1314: ledgeAttack
  [70, 0, 0],
  [10, R | SOFT, 0], //          1385: back onto the ledge
  [20, 0, 0],
  [1, S, 0], //                  1415: ledgeRoll
  [50, 0, 0],
  [1, J, 0], //                  1466: a tap is a short hop
  [6, 0, 0],
  [1, S, 0], //                  1473: airDodge, landing inside it: landingLag
  [80, 0, 0],
  [1, B, 0], //                  1554: neutral special: a fireball that hits Fox
  [60, 0, 0],
  // Attack inside jumpsquat is a short-hop aerial, which deals 0.85× damage.
  [1, J, 0], //                  1615: jumpSquat...
  [1, A, 0], //                  1616: ...short-hop neutral air, into Fox
  [60, 0, 0],
  [5, S, 0], //                  1677: shield...
  [1, S | L, 0], //              1682: ...roll
  [40, 0, 0],
  [6, S, 0], //                  1723: shield, held past its 3-frame minimum...
  [30, 0, 0], //                 1729: ...and let go: shieldRelease
  // Fox jumps off the right side and drifts away from the ledge to his death.
  [10, 0, R], //                 1759: dash to the edge
  [1, 0, R | J], //              1769: full hop out
  [90, 0, R], //                 1770: a KO through the bottom: dead
  [100, 0, 0], //                       respawnPlatform
  [1, 0, D], //                  1960: step off the platform
  [60, 0, 0],
];

export const SCRIPTED_MATCH: ScriptedMatch = {
  name: "scripted-mario-fox-finalDestination",
  stage: "finalDestination",
  fighters: ["mario", "fox"],
  seed: 505,
  // The KO freeze holds the clock for 14 frames, so time is up on frame 2014.
  rules: { mode: "time", stocks: 3, timeLimit: 2000, smashBall: true, oneOnOne: true },
  frames: 2400,
  steps: STEPS,
};

/** Port 0 and port 1's keys on `frame` (from 1). Nothing is held after the script ends. */
export function scriptedInputs(steps: readonly ScriptStep[]): (frame: number) => readonly InputFrame[] {
  const perFrame: (readonly InputFrame[])[] = [];
  for (const [frames, p0, p1] of steps) {
    for (let i = 0; i < frames; i++) perFrame.push([p0, p1]);
  }
  return (frame) => perFrame[frame - 1] ?? [0, 0];
}
