import { P, type PoseClip } from "./clip";
import { deg } from "../skeleton";

/**
 * The air dodge — one clip stretched across two different moves.
 *
 * A neutral air dodge is 50 frames with intangibility on 3–28; a directional
 * one is 63 with intangibility on 3–20 (`AIR_DODGE_FRAMES`,
 * `DIRECTIONAL_AIR_DODGE_FRAMES` and their windows). Both play this clip, so
 * every beat is a proportion and the frame numbers below are quoted for the
 * neutral first, the directional in brackets. SmashWiki records the directional
 * dodge — Ultimate's declawed wavedash — as opening with "a five frame windup
 * animation" in which the fighter pulls back opposite the input before moving,
 * which is the counter-lean here: the fighter is still gathering for the first
 * few frames they are already intangible on. The deepest point of the curl is
 * at `t = 0.3`, and that number is doing the work — it is the one place inside
 * the intangible window of *both* dodges, frame 15 of the neutral and frame 19
 * of the directional.
 *
 * The important beat is the last one. A fighter gets one air dodge per airtime
 * and cannot act until this animation ends, so its tail is the classic punish
 * in the game — and on the directional dodge the fighter has been tangible
 * again since frame 20 of 63. The ball therefore starts loosening at `t = 0.5`
 * and is thrown open at 0.64, which makes the recovery more than half the clip
 * and gives it a shape of its own: uncurl, overshoot, settle. It has to be
 * unmistakably not the dodge any more, because for most of it the fighter is
 * exactly as hittable as they look.
 *
 * The turn is keyed `rotation` and not `spin` even though it is a spin. `spin`
 * integrates linearly to `t = 1` and cannot come back: a value big enough to
 * sell the tuck would still be turning through the recovery, and would leave
 * the fighter tilted on the frame the clip cuts to `fall` — clips do not blend
 * into one another. Unwinding the turn *is* the recovery, so it has to live in
 * a channel that can return to zero. For the same reason the last key is
 * `fall`'s apex pose rather than one of its own: `states.ts` sends the fighter
 * straight into `fall` on the frame this clip runs out, and the two drawings
 * have to meet.
 */
export const airDodge: PoseClip = {
  loop: false,
  keys: [
    // Frame 0. Airborne and already gathering — the state cuts to here from a
    // rise or a fall with nothing in between, so this cannot be far from one.
    {
      t: 0,
      pose: P({
        torso: 4, head: -4,
        thighR: 158, shinR: 38, footR: -72,
        thighL: 198, shinL: 30, footL: -78,
        upperArmR: 100, forearmR: -30,
        upperArmL: 244, forearmL: 18,
      }),
      offsetY: 0.12,
    },
    // Frame 2.5 [3.2]. The windup: hips back, chest open, the body leaning the
    // wrong way. Three frames of anticipation is all a 50-frame move can spare,
    // and without them the tuck has nothing behind it.
    {
      t: 0.05,
      pose: P({
        torso: -18, head: 12, hip: 8,
        thighR: 152, shinR: 50, footR: -66,
        thighL: 196, shinL: 42, footL: -70,
        upperArmR: 134, forearmR: -46,
        upperArmL: 218, forearmL: -26,
      }),
      offsetX: -0.5,
      offsetY: -0.1,
      rotation: deg(-16),
      scaleX: 0.94,
      scaleY: 1.04,
    },
    // Frame 7.5 [9.5]. The tuck: knees to chest, arms wrapped over the shins,
    // the ball already tipped a quarter turn into the dodge. Intangibility has
    // been on since frame 3, so for a moment the fighter is safe and does not
    // look it — which is what the real move's windup does too.
    {
      t: 0.15,
      pose: P({
        hip: -14, torso: 40, head: -26,
        thighR: 110, shinR: 118, footR: -64,
        thighL: 118, shinL: 114, footL: -60,
        upperArmR: 108, forearmR: -108,
        upperArmL: 116, forearmL: -112,
      }),
      offsetX: 0.2,
      offsetY: -1.7,
      rotation: deg(44),
      scaleX: 0.84,
      scaleY: 0.86,
    },
    // Frame 15 [19]. The tightest the fighter ever gets, on the last frame the
    // shorter of the two windows still covers. This is the drawing the blink
    // and the afterimages are trailing.
    {
      t: 0.3,
      pose: P({
        hip: -16, torso: 42, head: -28,
        thighR: 104, shinR: 124, footR: -58,
        thighL: 112, shinL: 120, footL: -54,
        upperArmR: 102, forearmR: -116,
        upperArmL: 110, forearmL: -120,
      }),
      offsetX: 0.1,
      offsetY: -2.1,
      rotation: deg(60),
      scaleX: 0.76,
      scaleY: 0.8,
    },
    // Frame 25 [31.5]. The ball loosens while the turn carries on past
    // horizontal — the spin outlasts the tuck, which is what stops the middle
    // of the clip being a photograph of a curled fighter for twenty frames.
    {
      t: 0.5,
      pose: P({
        hip: -14, torso: 38, head: -24,
        thighR: 112, shinR: 112, footR: -62,
        thighL: 120, shinL: 108, footL: -58,
        upperArmR: 110, forearmR: -104,
        upperArmL: 118, forearmL: -108,
      }),
      offsetY: -1.85,
      rotation: deg(76),
      scaleX: 0.81,
      scaleY: 0.85,
      ease: "out",
    },
    // Frame 32 [40]. Thrown open. The legs go first and the arms trail: the
    // fighter is not righting themselves, they are being unfolded by the fall.
    {
      t: 0.64,
      pose: P({
        hip: -8, torso: 26, head: -18,
        thighR: 128, shinR: 82, footR: -68,
        thighL: 150, shinL: 74, footL: -64,
        upperArmR: 124, forearmR: -70,
        upperArmL: 190, forearmL: -50,
      }),
      offsetY: -1.15,
      rotation: deg(44),
      scaleX: 0.88,
      scaleY: 0.9,
    },
    // Frame 39.5 [49.8]. The helpless part. The limbs are flung past where they
    // will settle and the chest tips back — nobody who could act would be in
    // this shape, and the fighter cannot act for another ten frames.
    {
      t: 0.79,
      pose: P({
        hip: 4, torso: -12, head: 2,
        thighR: 174, shinR: 30, footR: -66,
        thighL: 212, shinL: 22, footL: -86,
        upperArmR: 34, forearmR: 6,
        upperArmL: 306, forearmL: -6,
      }),
      offsetY: -0.1,
      rotation: deg(-9),
      scaleX: 0.99,
      scaleY: 1.05,
    },
    // Frame 45.5 [57.3]. The arms come back down. This key exists because the
    // last ten frames are otherwise a single ease from the flail to the fall
    // pose — under a degree a frame, which the eye reads as a fighter who is
    // ready again, ten frames before they are.
    {
      t: 0.91,
      pose: P({
        hip: 1, torso: -3, head: 2,
        thighR: 168, shinR: 36, footR: -68,
        thighL: 202, shinL: 28, footL: -84,
        upperArmR: 54, forearmR: -6,
        upperArmL: 308, forearmL: 4,
      }),
      offsetY: 0.1,
      rotation: deg(-3),
      scaleX: 0.98,
      scaleY: 1.04,
    },
    // Frame 50 [63], which is also frame 0 of `fall`.
    {
      t: 1,
      pose: P({
        torso: 3, head: -3,
        thighR: 164, shinR: 40, footR: -70,
        thighL: 196, shinL: 30, footL: -80,
        upperArmR: 70, forearmR: -14,
        upperArmL: 296, forearmL: 14,
      }),
      offsetY: 0.3,
      scaleX: 0.97,
      scaleY: 1.05,
    },
  ],
};
