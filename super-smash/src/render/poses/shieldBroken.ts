import { P, type PoseClip } from "./clip";
import { deg } from "../skeleton";

/**
 * The shield break — `SHIELD_BREAK_STUN`, 240 frames, four seconds.
 *
 * Ultimate stuns for `400 − damage%` frames and lets the victim mash it down by
 * six frames an input, so 240 is the flat middle of a state that at low percent
 * is the longest stretch of helplessness in the game: the opponent has several
 * seconds to walk over and pick a kill move. Ultimate's own name for the
 * animation is *furafura* — unsteady on the feet — and it dresses the state with
 * an orange halo and a few stars circling the head. Nothing here can draw
 * those, so the whole read has to come out of the body.
 *
 * Which means it has to be a cycle. A one-shot over 240 frames is a still image
 * for the last three seconds however many keys it has, and it freezes on its
 * final frame the moment stun is ever scaled by damage the way the real game
 * scales it. Looping also survives a mash-out: whenever the stun ends the
 * fighter is mid-wobble rather than parked.
 *
 * The cycle is 108 frames and carries *two* sways, deliberately unequal — a big
 * teeter, 34 frames from heels to toes, then a small one over 18 — so the beat
 * the eye latches onto is never the beat that repeats. 240 frames is 2.2 of
 * them, so a shield break never shows a whole number of repetitions either.
 *
 * Three things then move on three different clocks: the body sways twice a
 * cycle, the head lolls twice but never at the same moment as the body (dead
 * weight arrives after the shoulders have gone), and the knees give way and
 * gather just *once*. Nothing lines up until all 108 frames are spent.
 *
 * `in` leaving each extreme and `out` leaving each pass-through is the
 * pendulum: hang at the ends, cover the middle fast. `smooth` throughout would
 * stop the body dead eight times a cycle, which is a shiver rather than a
 * stagger.
 *
 * The head is never once held upright: it hangs between 6° and 20° forward of
 * vertical for the whole four seconds. The legs are solved the other way round
 * — the leading ankle is placed on the floor and the knee angles fall out of
 * it — so the body sways about eight times as far as the foot under it shuffles
 * and the trailing heel peels off only under the forward pitch. A stunned
 * fighter's feet scrabble; their neck does not work.
 *
 * `t = 0` is the frame the shield goes, and is the furthest-back, least-sagged
 * shape of the eight: knocked upright, knees not yet folded. It is not the
 * one-off snap the real game opens with, because a looping clip cannot hold a
 * beat that plays once — that needs a second clip and a branch in `poseNameFor`.
 */
export const shieldBroken: PoseClip = {
  loop: true,
  period: 108,
  keys: [
    {
      t: 0,
      pose: P({
        hip: 3, torso: -4, head: 26,
        thighR: 161, shinR: 18, footR: -81,
        thighL: 171, shinL: 29, footL: -94,
        upperArmR: 162, forearmR: -28,
        upperArmL: 208, forearmL: 30,
      }),
      rotation: deg(-5),
      offsetX: -0.55,
      offsetY: -0.24,
      ease: "in",
    },
    {
      t: 0.157,
      pose: P({
        hip: 1, torso: 5, head: 13,
        thighR: 156, shinR: 35, footR: -97,
        thighL: 174, shinL: 32, footL: -104,
        upperArmR: 157, forearmR: -22,
        upperArmL: 201, forearmL: 26,
      }),
      rotation: deg(1),
      offsetX: 0.05,
      offsetY: -0.3,
      ease: "out",
    },
    {
      t: 0.315,
      pose: P({
        hip: -3, torso: 17, head: -8,
        thighR: 156, shinR: 44, footR: -107,
        thighL: 175, shinL: 44, footL: -98,
        upperArmR: 154, forearmR: -18,
        upperArmL: 198, forearmL: 22,
      }),
      rotation: deg(6),
      offsetX: 0.6,
      offsetY: -0.4,
      ease: "in",
    },
    {
      t: 0.444,
      pose: P({
        hip: -1, torso: 8, head: -3,
        thighR: 151, shinR: 48, footR: -104,
        thighL: 169, shinL: 49, footL: -115,
        upperArmR: 171, forearmR: -16,
        upperArmL: 207, forearmL: 18,
      }),
      rotation: deg(2),
      offsetX: 0.16,
      offsetY: -0.46,
      ease: "out",
    },
    {
      t: 0.574,
      pose: P({
        hip: 2, torso: 0, head: 13,
        thighR: 154, shinR: 37, footR: -94,
        thighL: 170, shinL: 38, footL: -103,
        upperArmR: 171, forearmR: -22,
        upperArmL: 211, forearmL: 24,
      }),
      rotation: deg(-3),
      offsetX: -0.33,
      offsetY: -0.36,
      ease: "in",
    },
    {
      t: 0.657,
      pose: P({
        hip: 1, torso: 4, head: 14,
        thighR: 157, shinR: 32, footR: -95,
        thighL: 173, shinL: 32, footL: -103,
        upperArmR: 158, forearmR: -30,
        upperArmL: 196, forearmL: 32,
      }),
      rotation: deg(1),
      offsetX: -0.05,
      offsetY: -0.28,
      ease: "out",
    },
    {
      t: 0.741,
      pose: P({
        hip: 0, torso: 9, head: 4,
        thighR: 161, shinR: 27, footR: -95,
        thighL: 180, shinL: 23, footL: -102,
        upperArmR: 144, forearmR: -34,
        upperArmL: 186, forearmL: 36,
      }),
      rotation: deg(3),
      offsetX: 0.2,
      offsetY: -0.22,
      ease: "in",
    },
    {
      t: 0.87,
      pose: P({
        hip: 2, torso: 2, head: 6,
        thighR: 163, shinR: 21, footR: -88,
        thighL: 178, shinL: 22, footL: -96,
        upperArmR: 153, forearmR: -32,
        upperArmL: 197, forearmL: 34,
      }),
      rotation: deg(-2),
      offsetX: -0.2,
      offsetY: -0.2,
      ease: "out",
    },
  ],
};
