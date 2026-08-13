import { P, type PoseClip } from "./clip";

/**
 * The standing loop — "Wait", in the series' own internal naming (SmashWiki,
 * *Idle pose*). It is not the same thing as an **idle pose**: those are the
 * flourishes that fire at random after a few seconds of stillness — Mario
 * adjusts his cap, or holds a fist in front of his face — and every character
 * has one or two of them on top of the loop. This clip is only the loop under
 * them, which is the pose a fighter is in whenever nobody is pressing anything,
 * and the pose most of the library departs from and returns to.
 *
 * Four keys, and the whole point of the extra two is that **no part of the body
 * turns round at the same moment as any other**. The chest is highest at key 1,
 * the head is furthest up at key 2, the near arm is furthest back at key 3, the
 * far arm at key 0. Two keys can only give a rise and a fall with everything
 * arriving together, which the eye reads as a metronome no matter how small the
 * amplitude — a body's parts are coupled but they are not in step, and the lag
 * between them is the difference between breathing and pulsing. The key times
 * are uneven for the same reason: a 37-frame inhale against a 71-frame exhale
 * in three unequal beats, so the cycle has no countable beat to it.
 *
 * The rhythms, then, are: the chest rises once (37 frames up, 71 down); the head
 * follows it about a quarter of a cycle later and drifts a couple of degrees
 * either side of level rather than being welded upright; the two arms hang and
 * swing six degrees *against each other*, because nothing synchronises a
 * standing person's arms; and the knees trade a few degrees of softness back and
 * forth, which is as much of a weight shift as a strict profile view can show —
 * the two ankles are all but stacked, so a real transfer of weight is into and
 * out of the screen and only its symptoms are visible from the side.
 * Two bits of bookkeeping keep that shift off the floor. A knee bends without
 * the foot leaving it by taking half the angle back out of the thigh —
 * `thigh -= d/2, shin += d` moves the ankle by two hundredths of a unit over
 * the range used here. And both thighs subtract the pelvis's own tilt from
 * themselves, because they hang off `hip`: without that, a single degree of
 * rock at the pelvis swings four units of leg and drags both feet a pixel
 * sideways across the floor, which is a skate rather than a weight shift.
 *
 * ## Why only the inhale is `smooth`
 *
 * Smoothstep is zero-velocity at *both* ends, so a clip that eases every span
 * brings every bone in the body to a halt at every key. Four keys of that is
 * four dead frames a cycle — a worse metronome than the two-key version it
 * replaces, and the reason a fourth key on its own would not have fixed
 * anything. Only the inhale cushions, then, and a cushion on one span still
 * costs a stall on one side of each of the keys that bound it: the body leaves
 * the settle slowly and arrives at the top of the breath slowly, which is what a
 * breath does. The three spans of the exhale drift at a constant rate instead,
 * where the fastest bone covers a fifth of a degree a frame and a velocity
 * corner is not a thing an eye can find.
 *
 * ## What is deliberately not touched
 *
 * The stance. Around twenty clips hand off to this pose or return to it, so the
 * silhouette is a contract: the feet keep their rest angles and their splayed
 * toes, both arms hang within a degree of the world-space angle the old two-key
 * clip hung them at, and the body's height at the bottom of the breath and at
 * the top of it are the heights they were. What changed is how far they move
 * around that: the near arm swung two degrees and now swings six, the same as
 * the far one, because a hanging arm that moves a third as much as its partner
 * reads as pinned to the hip.
 *
 * `poseTimeFor` drives this from the global frame plus `port * 27`, so no two
 * fighters are at the same point in it and there is no first frame — every
 * phase has to stand on its own as a fighter standing there. Which also means
 * the thing another clip can aim at is not a key but the *average* of the four:
 * that average is the stand, and `turn` and `crouchEnd` both end on it.
 */
export const idle: PoseClip = {
  loop: true,
  period: 108,
  keys: [
    {
      // The settle at the end of the exhale: chest low, weight over the far leg,
      // far arm at the back of its swing. The body leaves it slowly — the span
      // out of here is the one the ease is spent on.
      t: 0,
      pose: P({
        hip: 0.8, torso: 5.5, head: -4.1,
        thighL: 179.7, shinL: 3.0,
        thighR: 174.7, shinR: 5.0,
        upperArmL: 195.0, forearmL: -17.5,
        upperArmR: 162.5, forearmR: 21.7,
      }),
      offsetY: 0.02,
      scaleY: 1.0,
    },
    {
      // Top of the inhale. Most of the rise is `scaleY` rather than `offsetY`:
      // stretching about the feet lifts the chest and the head and leaves the
      // soles on the floor, where translating the body lifts the feet off it.
      t: 0.34,
      pose: P({
        hip: 0.0, torso: 3.2, head: -3.2,
        thighL: 181.75, shinL: 0.5,
        thighR: 174.25, shinR: 7.5,
        upperArmL: 194.8, forearmL: -20.0,
        upperArmR: 162.3, forearmR: 19.5,
      }),
      offsetY: 0.11,
      scaleY: 1.019,
      ease: "linear",
    },
    {
      // The head arrives late — it is still coming up as the chest starts down,
      // which is the whole of what "the head has its own rhythm" amounts to
      // here. Weight now over the near leg, that knee at its softest.
      t: 0.58,
      pose: P({
        hip: -0.8, torso: 4.6, head: -6.8,
        thighL: 184.3, shinL: -3.0,
        thighR: 173.3, shinR: 11.0,
        upperArmL: 191.4, forearmL: -18.5,
        upperArmR: 164.7, forearmR: 18.0,
      }),
      offsetY: 0.06,
      scaleY: 1.009,
      ease: "linear",
    },
    {
      // Lowest point of the cycle, a hair under key 0, so the last span is a
      // small recovery into the settle rather than a fourth extreme.
      t: 0.8,
      pose: P({
        hip: 0.2, torso: 6.0, head: -5.0,
        thighL: 182.05, shinL: -0.5,
        thighR: 173.55, shinR: 8.5,
        upperArmL: 191.5, forearmL: -16.5,
        upperArmR: 165.8, forearmR: 17.5,
      }),
      offsetY: 0.0,
      scaleY: 0.997,
      ease: "linear",
    },
  ],
};
