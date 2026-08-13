/**
 * The reel: what a fighter does while a hit is still holding them.
 *
 * ## The length is different every single time
 *
 * `hitstun = floor(knockback × 0.4) − 1` ([SmashWiki: Hitstun]) and the state
 * runs for exactly that many frames, so `poseTimeFor` samples this clip at
 * `actionFrame / hitstun`. A jab gives three to five frames and the strongest
 * hit that stays out of tumble gives thirty-one — at 32 the victim is sent to
 * `tumble` instead (`TUMBLE_HITSTUN`, checked at the moment of the hit in
 * `simulate.ts`), so thirty-one is a hard ceiling and this clip never has to
 * cover a launch.
 *
 * That range is the whole design problem, and it is not the same problem
 * `landingLag` has. A three-frame reel samples t = 0, ⅓, ⅔ and *nothing else* —
 * so any beat authored between those, however good, does not exist on a jab,
 * and a jab is the most common hit in a match by an order of magnitude. Two
 * rules fall out and everything below follows from them:
 *
 * 1. **The extreme is on frame 0.** Not frame 1, not "the first fifth" — frame
 *    0, because at three frames that is the only early sample there is. This is
 *    also just true: a hit taken has no anticipation.
 * 2. **Everything after frame 0 recovers monotonically.** A pose that got
 *    worse before it got better would, subsampled at three points, read as a
 *    random selection of drawings. Monotone means *any* subsampling of it still
 *    tells the same story, which is the only way one clip serves 3 and 31.
 *
 * The interest a thirty-frame reel needs therefore lives in the *extremities*,
 * not in the spine: the head and arms overshoot and settle, and that overshoot
 * is deliberately parked in the 0 → 0.07 span, which every short reel skips
 * entirely. It costs a jab nothing and gives a long reel a whip.
 *
 * ## Frame 0 is not one frame
 *
 * During hitlag the victim's state machine does not run at all — `simulate.ts`
 * decrements the counter and `continue`s — so `actionFrame` does not advance
 * and `t` stays pinned at 0 for the entire freeze. Hitlag is
 * `floor(damage × 0.65 + 6)`, which is seven frames for a 2% jab and up to
 * thirty. The first key is therefore on screen roughly twice as long as the
 * rest of the clip put together, and is far and away the most-looked-at drawing
 * in the game. It gets drawn like one.
 *
 * The renderer covers the impact itself and this clip must not restate it:
 * `hitlagShake` vibrates the body every frame of the freeze and `squashFor`
 * stretches it 0.86 × 1.16 for the same window. The pose's own `scaleY` is a
 * small addition on top of that, not the effect. And `blend.ts` classes hitstun
 * as *imposed* and refuses to cross-fade into it, so the first key lands on the
 * frame of contact with nothing eased away — it is authored as the hit, not as
 * a departure from whatever stance preceded it.
 *
 * ## What is not here
 *
 * Hitstun cancelling opens at frame 40 for an air dodge and 45 for an aerial
 * ([SmashWiki: Hitstun canceling]); both are past this clip's ceiling of 31, so
 * there is no cancel to animate and the reel simply ends.
 *
 * One clip has to commit to one direction, and it commits to the common case:
 * hit from the front, driven backwards. `offsetX` is in the facing direction,
 * so the whole reel is mirrored for a fighter facing the other way and a hit
 * taken from behind reads as being knocked through — which is wrong, but is
 * wrong for four frames and is the price of not authoring eight clips.
 *
 * [SmashWiki: Hitstun]: https://www.ssbwiki.com/Hitstun
 * [SmashWiki: Hitstun canceling]: https://www.ssbwiki.com/Hitstun_canceling
 */

import { P, type PoseClip } from "./clip";

export const hitstun: PoseClip = {
  loop: false,
  keys: [
    // The hit. Pelvis thrust forward under a chest that has been driven back,
    // legs swept out in front because the body left without them, both arms
    // thrown up and open. Nothing in the pose is defended: the shape has to say
    // "this was done to me" from across the screen and at a twelfth of the
    // screen's height, which means the silhouette does it or nothing does.
    //
    // `in` on the way out, so a long reel keeps this drawing for a frame or two
    // past the freeze and then covers the whip in three, rather than starting
    // to drift on the frame after contact.
    {
      t: 0,
      pose: P({
        hip: 16, torso: -40, head: -14,
        thighR: 126, shinR: 50, footR: -54,
        thighL: 148, shinL: 42, footL: -50,
        upperArmR: 54, forearmR: 62,
        upperArmL: 324, forearmL: -58,
      }),
      offsetX: -0.85, offsetY: 0.28,
      rotation: -0.19,
      scaleX: 0.95, scaleY: 1.06,
      ease: "in",
    },
    // The whip: the torso has already stopped going back and the head and the
    // hands have not, so they arrive at their extreme a couple of frames late.
    // This is the one key a jab never samples, which is exactly why the
    // overshoot is put here — the spine is recovering while the extremities are
    // still peaking, so the "how far thrown back is this fighter" read never
    // goes backwards no matter how coarsely the clip is sampled.
    //
    // Launch speed decays from the frame it is granted, and the *poses* say so:
    // two thirds of the recoil is gone by the next key and the rest trails away
    // over three times as long. Saying it a second time in the easing as well
    // would be saying it twice — an `out` here arrives at the next key with no
    // velocity left and parks the fighter for three frames in the middle of the
    // reel, which is the one place a reel must not stop.
    {
      t: 0.07,
      pose: P({
        hip: 14, torso: -36, head: -22,
        thighR: 120, shinR: 58, footR: -58,
        thighL: 142, shinL: 48, footL: -54,
        upperArmR: 40, forearmR: 74,
        upperArmL: 308, forearmL: -70,
      }),
      offsetX: -0.72, offsetY: 0.25,
      rotation: -0.15,
      scaleX: 0.96, scaleY: 1.05,
      ease: "linear",
    },
    // Limp. The drive is spent and nothing has replaced it: arms falling out of
    // the flail under their own weight, knees still folded, head still behind
    // the hips. A three-frame reel lands near here for its middle sample, so
    // this drawing carries "still held" on its own.
    //
    // `linear` from here to the check, and this is the one piece of the timing
    // that is counter-intuitive. `smooth` is the library's default and it is
    // wrong for the back half of *this* clip: zero velocity at both ends of
    // every span means the fighter stalls at each key, and a recovery that
    // stalls twice reads as two more little hits rather than as one continuous
    // return of control. Hitstun itself decrements one frame per frame; the
    // animation of it should be as even as the counter is.
    {
      t: 0.3,
      pose: P({
        hip: 8, torso: -27, head: -8,
        thighR: 140, shinR: 50, footR: -70,
        thighL: 164, shinL: 36, footL: -66,
        upperArmR: 82, forearmR: 70,
        upperArmL: 260, forearmL: -64,
      }),
      offsetX: -0.38, offsetY: 0.14,
      rotation: -0.08,
      scaleX: 0.99, scaleY: 1.02,
      ease: "linear",
    },
    // The gather: feet coming back under the hips, arms nearly down, head level.
    // The fighter still cannot act, but has stopped being carried, and the
    // distance between this and the key before it is the frame count the
    // attacker is counting.
    {
      t: 0.58,
      pose: P({
        hip: 3, torso: -17, head: -2,
        thighR: 160, shinR: 28, footR: -76,
        thighL: 182, shinL: 18, footL: -80,
        upperArmR: 146, forearmR: 52,
        upperArmL: 218, forearmL: -48,
      }),
      offsetX: -0.16, offsetY: 0.05,
      rotation: -0.03,
      ease: "linear",
    },
    // The check — the frame that says hitstun is over. The weight finally
    // arrives back over the feet and the knees take it, so the body dips and
    // the chest comes forward *past* upright, into the opponent rather than
    // away from them. That reversal of direction is the whole tell: everything
    // up to here has been the fighter travelling, and this is the first frame
    // they are driving.
    //
    // It sits at 0.80 and not at the end because the span after it is the last
    // fifth of the reel — the frames a defender is about to act on — and if the
    // last key were the pose itself those frames would be a still image. So the
    // check is a dip to rise out of, and the rise is what plays over them. A
    // four-frame reel's final sample (t = 0.75) lands just short of it.
    {
      t: 0.8,
      pose: P({
        hip: -4, torso: 10, head: -12,
        thighR: 158, shinR: 34, footR: -80,
        thighL: 178, shinL: 26, footL: -84,
        upperArmR: 178, forearmR: 30,
        upperArmL: 186, forearmL: -30,
      }),
      offsetX: 0, offsetY: -0.16,
      ease: "linear",
    },
    // Never sampled — `poseTimeFor` tops out at (n−1)/n — but the clip ends on
    // the library's standing pose so that the four-frame fade into `stand` or
    // `fall`, which hitstun *is* faded out of, starts from the right place.
    {
      t: 1,
      pose: P({
        hip: 0, torso: 3, head: -3,
        thighR: 176, shinR: 6, footR: -86,
        thighL: 184, shinL: 2, footL: -90,
        upperArmR: 167, forearmR: 16,
        upperArmL: 193, forearmL: -16,
      }),
    },
  ],
};
