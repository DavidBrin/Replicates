import { P, type PoseClip } from "./clip";
import { deg } from "../skeleton";

/**
 * Held, and thrown.
 *
 * ## A grab is a timer, and this clip is its only clock face
 *
 * Ultimate holds a fighter for `90 + 1.7×damage` frames and takes about 14.4 of
 * them off per mashed input, floored at 19 (SmashWiki, *Grab*) — so the victim
 * is never passive, and the game says so: mashing draws wind-blade particles
 * around them that thicken with the mash rate, and the fighter flashes yellow in
 * the last three seconds of the hold (SmashWiki, *Mashing*, *Grab*). Neither cue
 * exists here and `GRAB_HOLD_FRAMES` is a flat 60, so the struggle is the whole
 * signal: it is the only thing on screen that says this ends.
 *
 * ## Five uneven beats, nineteen frames
 *
 * The trap in a looping struggle is the metronome. Two keys half a cycle apart
 * under a `smooth` ease is a pendulum, and a pendulum is soothing — the eye locks
 * on, predicts the swing, and stops reading the clip as effort. So the cycle runs
 * five beats of deliberately unequal size *and* unequal length: haul back, a
 * five-frame heave that throws the whole body forward, a shudder that covers
 * almost nothing, a wrench that comes out of the legs with the shoulders barely
 * involved, and a head-snap that is none of the others. The legs also peak on
 * different keys from the torso, so no two limbs arrive together.
 *
 * `in` leaving an extreme and `out` arriving at one is the shape of a strain: a
 * body pulling against a grip loads up slowly, goes all at once, and is stopped
 * dead. The travel that results is lumpy on purpose — one three-frame surge
 * carries a third of the cycle, and four separate frames barely move at all,
 * spaced eight, six, one and four frames apart. Those stalls are the moment a
 * pull fails, and they are what make the next one look like it cost something.
 *
 * Nineteen frames is a wrench about every 90ms, in the neighbourhood of the
 * 2-to-3-frame cadence a real mash registers at. It also does not divide 60, so
 * the hold times out mid-heave rather than tidily at the end of a cycle.
 *
 * **The arms are the exception, and they look wrong in the source because of it.**
 * Bone angles are parent-relative, so an arm written as a constant swings with
 * the torso — and the victim's hands are the one part of them that is *not* free
 * to swing, because they are clamped on the arm holding them. Each key's shoulder
 * and elbow are therefore counter-rotated by that key's `rotation + hip + torso`,
 * which is why they jump from 46° to 112° across the cycle while the hands barely
 * move: the body thrashes underneath hands that stay put. Anchoring them is also
 * what keeps the head clear of the arms in silhouette on every rig, which the
 * first pass, with the arms up by the face, did not manage on Donkey Kong.
 *
 * ## Thrown is the opposite body
 *
 * Once the throw commits, the fighter is cargo. `blend.ts` cross-fades into
 * neither clip — both are imposed — so the two have to separate on the single
 * frame they cut over, from whatever phase of the struggle the throw interrupted.
 * The shoulders carry that: held, they are forward and up on the grip; thrown,
 * they are behind and below the body. The two never come within 55° of each
 * other at any pair of times.
 *
 * The limbs are a **damped oscillation** — a jolt, an overshoot where they whip
 * past the body, a much smaller secondary swing as the slack comes out, then
 * nothing. The body is not damped: it keeps rolling backwards the whole way, 20°
 * to 70° off vertical. Flailing that dies out while the mass keeps turning is
 * what a launched body does, and it is the exact inverse of the grip clip, which
 * holds its amplitude forever and never leaves vertical by more than 14°.
 *
 * One clip serves all four throw directions, so it says nothing about direction:
 * `offsetX` is zero throughout, and a body tipped off its feet reads as *not in
 * control* whether it is going up, down, forward or back. The last key is slack
 * rather than extreme for a duller reason — `actionDurationFor` has no `thrown`
 * case, so `poseTimeFor` plays the clip across a thirty-frame fallback and then
 * freezes `t = 1` for the rest of the launch, and the pose it freezes on has to
 * be one a coasting body could plausibly hold.
 */
export const grabbed: PoseClip = {
  loop: true,
  period: 19,
  keys: [
    // Hauled backwards against the grip, both hands clamped on the wrist, near
    // knee driven up to shove off against nothing.
    {
      t: 0,
      pose: P({
        hip: 12, torso: -28, head: 26,
        thighR: 138, shinR: 86, footR: -62,
        thighL: 214, shinL: 40, footL: -68,
        upperArmR: 107, forearmR: -58,
        upperArmL: 117, forearmL: -58,
      }),
      offsetX: -0.5,
      offsetY: 1.08,
      rotation: deg(-13),
      scaleX: 0.94,
      scaleY: 1.07,
      ease: "in",
    },
    // The heave. Biggest shape in the cycle, and the one the opponent reads.
    {
      t: 0.26,
      pose: P({
        hip: -14, torso: 34, head: -26,
        thighR: 108, shinR: 112, footR: -50,
        thighL: 182, shinL: 66, footL: -62,
        upperArmR: 62, forearmR: -50,
        upperArmL: 52, forearmL: -50,
      }),
      offsetX: 0.55,
      offsetY: 0.76,
      rotation: deg(14),
      scaleX: 1.08,
      scaleY: 0.92,
      ease: "out",
    },
    // A shudder that goes nowhere: under three frames of almost nothing, so the
    // next wrench has something to be bigger than.
    {
      t: 0.47,
      pose: P({
        hip: 5, torso: -4, head: 6,
        thighR: 154, shinR: 58, footR: -74,
        thighL: 198, shinL: 50, footL: -76,
        upperArmR: 84, forearmR: -58,
        upperArmL: 76, forearmL: -58,
      }),
      offsetX: -0.04,
      offsetY: 1.02,
      rotation: deg(-1),
      scaleX: 0.99,
      scaleY: 1.01,
      ease: "in",
    },
    // Second wrench, out of the legs this time — both feet scrabbling forward
    // for ground that is not there, shoulders barely involved.
    {
      t: 0.61,
      pose: P({
        hip: 10, torso: 14, head: -8,
        thighR: 188, shinR: 20, footR: -88,
        thighL: 148, shinL: 60, footL: -78,
        upperArmR: 46, forearmR: -62,
        upperArmL: 70, forearmL: -54,
      }),
      offsetX: 0.2,
      offsetY: 0.86,
      rotation: deg(4),
      scaleX: 1.04,
      scaleY: 0.96,
      ease: "out",
    },
    // The head snaps back while the body is still catching up, and the hands
    // swap which of them is doing the hauling. No two beats in the cycle put
    // the arms in the same relation, which is most of why it does not tick.
    {
      t: 0.79,
      pose: P({
        hip: -4, torso: -12, head: 20,
        thighR: 168, shinR: 40, footR: -80,
        thighL: 190, shinL: 76, footL: -66,
        upperArmR: 112, forearmR: -56,
        upperArmL: 92, forearmL: -60,
      }),
      offsetX: -0.18,
      offsetY: 0.98,
      rotation: deg(-6),
      scaleX: 0.97,
      scaleY: 1.03,
      ease: "in",
    },
  ],
};

export const thrown: PoseClip = {
  loop: false,
  keys: [
    // The jolt. Still carrying the grip's compression, already going over.
    {
      t: 0,
      pose: P({
        hip: 12, torso: -28, head: 30,
        thighR: 148, shinR: 82, footR: -50,
        thighL: 200, shinL: 70, footL: -46,
        upperArmR: 168, forearmR: -40,
        upperArmL: 200, forearmL: 36,
      }),
      offsetY: 0.9,
      rotation: deg(-20),
      scaleX: 0.93,
      scaleY: 1.09,
      ease: "out",
    },
    // Swept off the feet. The longest, widest frame in the clip, and the limbs
    // overshoot the body rather than being placed by it.
    {
      t: 0.16,
      pose: P({
        hip: 20, torso: -42, head: 40,
        thighR: 168, shinR: 26, footR: -30,
        thighL: 218, shinL: 22, footL: -26,
        upperArmR: 202, forearmR: -12,
        upperArmL: 262, forearmL: 10,
      }),
      offsetY: 1.25,
      rotation: deg(-56),
      scaleX: 0.88,
      scaleY: 1.14,
    },
    // The whip runs out and the arms sag back under the body.
    {
      t: 0.4,
      pose: P({
        hip: 13, torso: -30, head: 28,
        thighR: 176, shinR: 38, footR: -40,
        thighL: 206, shinL: 32, footL: -38,
        upperArmR: 218, forearmR: -20,
        upperArmL: 252, forearmL: 16,
      }),
      offsetY: 1.04,
      rotation: deg(-50),
      scaleX: 0.95,
      scaleY: 1.05,
    },
    // A drift back through, worth a third of the last one.
    {
      t: 0.68,
      pose: P({
        hip: 6, torso: -14, head: 18,
        thighR: 152, shinR: 66, footR: -52,
        thighL: 186, shinL: 58, footL: -48,
        upperArmR: 194, forearmR: 6,
        upperArmL: 264, forearmL: -6,
      }),
      offsetY: 0.98,
      rotation: deg(-58),
      scaleX: 1.0,
      scaleY: 1.0,
    },
    // Slack, and holdable for as long as the launch lasts.
    {
      t: 1,
      pose: P({
        hip: 8, torso: -12, head: 20,
        thighR: 162, shinR: 56, footR: -48,
        thighL: 194, shinL: 48, footL: -44,
        upperArmR: 202, forearmR: -4,
        upperArmL: 258, forearmL: 2,
      }),
      offsetY: 1.0,
      rotation: deg(-70),
      scaleX: 0.98,
      scaleY: 1.02,
    },
  ],
};
