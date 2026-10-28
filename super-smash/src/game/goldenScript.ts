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
 * Some step lengths are tuned to the engine: how far a walk carries Mario, and
 * when he reaches a ledge. The pins in `golden.test.ts` are what notice if they
 * stop landing: every action state, every soft-stick path, and `SCRIPT_HITS`,
 * the kinds of hit this match must land. A behaviour task that moves the
 * fighters (walk speed, traction, jump arcs) re-tunes the steps until the pins
 * pass again, then regenerates the trace; it never drops a pin entry. Task 21
 * (air friction) re-tuned the walk to the right ledge on frame 1163, and gave
 * Fox the soft walk-in from 1602, because air friction had left him out of the
 * short-hop neutral air's reach. Task 22 (walking) halved every soft walk (a
 * soft stick is half deflection, so half the top speed), which lengthened each
 * of them; the idle waits around them were shortened by the same frames, so the
 * forward smash (732–733), the ledge jump (884) and everything pressed after it
 * keep their frames, except the short hop, nair, shields and roll after Fox's
 * longer walk-in (14 to 6 frames later, back on schedule from the dash to the
 * edge on 1759).
 *
 * Plan 3 Task 3 (the Sakurai angle) re-tuned the forward smash and what hangs on
 * it. A grounded victim hit for 88 knockback or more now leaves at 38°, not flat,
 * so the smash that used to slide Fox three units sent him off the right side of
 * Final Destination and the script lost him on 872. The two now fight on the left:
 * after the throw Fox walks back toward the middle (274) and turns to face Mario
 * (308), who walks past him and turns round (312), so the smash (732) goes to the
 * left and Fox lands on the stage. Fox then walks back to Mario's side (903) for
 * the forward tilt, and steps in a little ahead of the fireball (1416), which
 * leaves the neutral air in reach on 1635. The walk to the right ledge is a frame
 * longer, for the turn from left to right: the hang is on 863, not 862.
 *
 * Plan 3 Task 4 (DI) re-tuned Fox's walk-in for the forward tilt. DI and LSI now
 * act only on a launch that tumbles, so the forward throw (10% damage, no tumble)
 * is no longer bent by Fox's soft up, and it leaves him 0.7 units further along.
 * That puts him 0.7 units nearer Mario for the forward smash, so the smash's
 * close hitbox (14.7%) wins over the far one (17.8%): a weaker hit, and a
 * shorter hitlag for Mario (the hang is on 862 again, not 863). Fox now lands at
 * x 3, not -15, so his soft walk back to Mario's side is 69 frames (903–971), not
 * 94: the last step is 26 frames of walk and 29 of standing, not 51 of walk, and
 * the forward tilt on 1002 and what follows it keep their frames. The fireball
 * then lands a frame early (1577), the short-hop nair, at 52% not 56%, no longer
 * tumbles Fox, so the script reaches `downed` and `getUp` twice, not three times,
 * and his self-destruct is three frames later (1862).
 *
 * Plan 3 Task 9 (shields) re-tuned the walk back for the forward tilt. Shield
 * damage is ×1.19 and each jab pushes Fox back a little, so the shield breaks on
 * 649, not 657, into 400 − 10 = 389 frames of stun, not 240: Fox is still
 * stunned when the smash comes on 733. He stands 2 units nearer Mario, so the
 * smash's far hitbox wins (22.4%, not 18.5%) and sends him to x -16, not 3. His
 * soft walk back to Mario's side is now 95 frames (903–997), not 69, and the
 * wait before the forward tilt is 3 frames, not 29, so the forward tilt on 1002
 * and what follows it keep their frames. The smash's longer hitlag puts the hang
 * on 863, not 862, and the fireball lands a frame later (1578).
 *
 * Each step's comment gives the frame it starts on, and the events it names
 * (the shield break on 649, the hangs on 863, 1193, 1299 and 1400, the hits on
 * 747, 1006, 1578 and 1635, time up on 2014). All were checked against a run
 * after Plan 3 Task 9.
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
  // A soft-stick walk: Soft keeps a held direction a walk instead of a dash, and
  // (Task 22) at half the top speed, so the walk to Fox takes 85 frames, not 40.
  [85, R | SOFT, 0], //            21: Mario walks to about 10 from Fox
  [10, 0, 0],
  // Grab, and hold until the 60-frame hold lets go on its own.
  [1, G, 0], //                   116: grab: Fox is grabbed
  [70, 0, 0], //                  117: grabHold, then both stand
  [4, R | SOFT, 0], //            187: in to about 8: a throw reaches, a pummel does not
  [10, 0, 0],
  // Grab, pummel (it whiffs at this range), forward throw. Fox holds a soft up
  // through the throw; it does not tumble, so (Task 4) the stick bends nothing.
  [1, G, 0], //                   201: grab
  [15, 0, 0],
  [1, A, 0], //                   217: pummel, then back to grabHold
  [15, 0, 0],
  [1, R, SOFT | U], //            233: forward throw: Fox is thrown, then launched
  [40, 0, SOFT | U],
  // Task 3: the smash below launches a grounded Fox at 38°, so the fight moves to
  // the left of the stage. Mario still walks in to about 8 for the jabs, past Fox,
  // who walks back toward the middle and turns round to shield from him.
  [34, R | SOFT, L | SOFT], //    274: Fox walks left (from 289, when his hitstun ends)
  [1, R | SOFT, R | SOFT], //     308: Fox turns back to face Mario
  [3, R | SOFT, 0],
  [1, L | SOFT, 0], //            312: Mario turns round to face Fox
  [21, 0, 0],
  // Fox shields, then spot-dodges out of it.
  [10, 0, S], //                  334: shield
  [1, 0, S | D], //               344: spotDodge
  [30, 0, 0],
  // Fox shields until it breaks; Mario jabs it three times on the way.
  [40, 0, S], //                  375: shield
  [1, A, S], //                   415: jab: shieldStun
  [30, 0, S],
  [1, A, S], //                   446: jab: shieldStun
  [30, 0, S],
  [1, A, S], //                   477: jab: shieldStun
  [254, 0, S], //                 478: the shield breaks on 649: shieldBroken, stunned 389 frames
  // Mario forward-smashes the stunned Fox, to the left, who holds a soft up through
  // the launch: 38° and a tumble, so the soft DI bends it, and Fox flies across the
  // stage and lands near its middle.
  [1, L, SOFT | U], //            732: a fresh left...
  [1, L | A, SOFT | U], //        733: ...and attack inside 5 frames: forward smash
  [66, 0, SOFT | U], //           734: tumble (747), downed (787), getUp (827); Mario can walk again on 801
  // Mario walks off the right edge onto the ledge. Each walk to a ledge ends
  // inside the hang's first 4 frames, when it ignores the stick: a right still
  // held after that would let go and regrab, over and over.
  [65, R | SOFT, 0], //           800: ledgeHang on 863 (he turns from left to right first)
  [19, 0, 0],
  [1, J, 0], //                   884: ledgeJump, then jump
  [18, L, 0], //                  885: drift back over the stage
  [2, L, R | SOFT], //            903: Fox walks back from the middle of the stage
  [40, 0, R | SOFT],
  [1, L | A, R | SOFT], //        945: forward air on the way down...
  [52, 0, R | SOFT], //           946: ...that lands inside itself: landingLag; Fox stops on 998
  [3, 0, 0],
  // Soft turns a fresh direction plus attack into a tilt.
  [1, L | SOFT, 0], //           1001: facing left since the ledge
  [1, L | SOFT | A, 0], //       1002: forward tilt, not forward smash: it hits Fox on 1006
  [40, 0, 0],
  [12, D, 0], //                 1043: crouchStart, crouch
  [12, 0, 0], //                 1055: crouchEnd
  [30, L, 0], //                 1067: walk, dashStart, run
  [1, R, 0], //                  1097: reversing a run: turnaround
  [20, 0, 0],
  [30, R, 0], //                 1118: run
  [15, 0, 0], //                 1148: let go: runBrake
  // Air friction (Task 21) bleeds the ledge jump's drift, so Mario lands further
  // right, and the soft walk (Task 22) is half speed: the walk to this ledge is 32
  // frames. It stops inside the hang's first 4 frames (the hang begins on 1193) and
  // he hangs until the 1243 press.
  [32, R | SOFT, 0], //          1163: to the right ledge again
  [48, 0, 0],
  [1, L, 0], //                  1243: toward the stage: ledgeGetUp
  [40, 0, 0],
  [17, R | SOFT, 0], //          1284: back onto the ledge (the hang begins on 1299)
  [13, 0, 0],
  [1, A, 0], //                  1314: ledgeAttack
  [70, 0, 0],
  [17, R | SOFT, 0], //          1385: back onto the ledge (the hang begins on 1400)
  [13, 0, 0],
  [1, S, 0], //                  1415: ledgeRoll
  [4, 0, R | SOFT], //           1416: Fox steps in a little, ahead of the fireball
  [46, 0, 0],
  [1, J, 0], //                  1466: a tap is a short hop
  [6, 0, 0],
  [1, S, 0], //                  1473: airDodge, landing inside it: landingLag
  [80, 0, 0],
  [1, B, 0], //                  1554: neutral special: a fireball that hits Fox on 1578
  // Air friction left Fox at x 32 after the fireball, out of nair range, so he
  // walks in: 27 frames of soft walk (half speed, Task 22) from 1602 put him at
  // about x 54 when the nair lands.
  [47, 0, 0],
  [27, 0, R | SOFT], //          1602: Fox walks in toward Mario
  // Attack inside jumpsquat is a short-hop aerial, which deals 0.85× damage.
  [1, J, 0], //                  1629: jumpSquat...
  [1, A, 0], //                  1630: ...short-hop neutral air: hits Fox on 1635
  [60, 0, 0],
  [5, S, 0], //                  1691: shield...
  [1, S | L, 0], //              1696: ...roll
  [32, 0, 0],
  [6, S, 0], //                  1729: shield, held past its 3-frame minimum...
  [24, 0, 0], //                 1735: ...and let go: shieldRelease
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
