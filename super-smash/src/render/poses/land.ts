/**
 * Arriving on the ground.
 *
 * Ultimate has two of these and they are not the same animation at two
 * lengths. Touching down normally — or out of an aerial that auto-cancelled —
 * runs the fighter's ordinary landing, which SmashWiki puts at two to six
 * frames depending on the character; `LANDING_ANIMATION_FRAMES` is four, the
 * middle of that range. An aerial that did *not* auto-cancel runs the move's
 * own landing lag instead, which is per-move and per-fighter: six frames for
 * Mario's neutral air, thirty-eight for Donkey Kong's up special, and ten for
 * an air dodge. The short one is a bounce; the long one is the fighter being
 * *stuck*, and that is the thing the animation has to say.
 *
 * `squashFor()` in `characterArt.ts` already multiplies an impact squash onto
 * both — 1.22× wide, 0.8× tall on the contact frame, linearly gone by frame six
 * — so neither clip restates it, and the scale keys below are all about
 * outrunning its decay or replacing it once it has expired.
 *
 * Two consequences shape everything else. The squash is front-loaded, so the
 * contact frame is *already* the most compressed drawing and the legs should
 * still be long on it: knees fold on the frame after impact, not during it.
 * And the squash is gone by frame six, which on a twenty-frame landing lag is
 * less than a third of the way in — so `landingLag` has to carry its own
 * compression from there, or the fighter stands up straight with fourteen
 * frames of helplessness left to serve.
 */

import { P, type PoseClip } from "./clip";

/**
 * The light landing: four frames, and they render as exactly four.
 *
 * `actionFrame` runs 0..3 before the state machine hands over to `stand`, and
 * `poseTimeFor` divides it by four, so keys on the quarters are one key per
 * frame — each is a whole sixtieth of a second of screen time, and nothing is
 * ever interpolated. The first two spans are `hold` for the same reason: at
 * this length the beats have to be *drawn* rather than travelled through, and
 * the moment the clip is stretched (a fighter with a longer landing) it is the
 * contact and the fold that should sit still, not the recovery.
 *
 * The four are: contact with the legs still long, the fold, the push, the
 * stand. Contact is the widest of them — the arms are still out where the fall
 * left them, on top of the squash — and the fold is the lowest and the most
 * closed. The hands never open back out after that, which is what makes four
 * separate drawings read as one movement rather than four.
 */
export const land: PoseClip = {
  loop: false,
  keys: [
    // Contact. The squash is at full strength here and does the crushing; the
    // legs are barely bent, because a leg cannot fold in the frame it lands.
    {
      t: 0,
      pose: P({
        hip: -2, torso: 14, head: -13,
        thighR: 162, shinR: 30, footR: -93,
        thighL: 172, shinL: 24, footL: -95,
        upperArmR: 124, forearmR: -28,
        upperArmL: 238, forearmL: 34,
      }),
      offsetY: -0.12,
      ease: "hold",
    },
    // The fold: knees driven forward, weight down, head tucked, and the arms
    // still falling past a body that has already stopped. The one frame that
    // says the landing had weight in it.
    //
    // The lone scale key in the clip, and it earns its place. The external
    // squash *decays* from the contact frame, and it decays faster than
    // `offsetY` alone can sink the body: without the five per cent the fold
    // comes out two hundredths of a rig unit below the contact frame — a dip
    // that exists in the numbers and nowhere on the screen. With it the dip is
    // half a unit, which is the difference between a landing that gives under
    // the fighter and one that merely gets shorter.
    {
      t: 0.25,
      pose: P({
        hip: -6, torso: 22, head: -20,
        thighR: 138, shinR: 72, footR: -98,
        thighL: 150, shinL: 64, footL: -106,
        upperArmR: 146, forearmR: -46,
        upperArmL: 224, forearmL: 52,
      }),
      offsetY: -0.45,
      scaleY: 0.95,
      ease: "hold",
    },
    // The push out of it. Arms swing back down through the body's line.
    {
      t: 0.5,
      pose: P({
        hip: -3, torso: 11, head: -9,
        thighR: 160, shinR: 38, footR: -93,
        thighL: 168, shinL: 32, footL: -98,
        upperArmR: 158, forearmR: -6,
        upperArmL: 204, forearmL: 8,
      }),
      offsetY: -0.25,
    },
    // Standing, one frame early, so the handover to `stand` is not a cut.
    {
      t: 0.75,
      pose: P({
        hip: -1, torso: 5, head: -4,
        thighR: 174, shinR: 10, footR: -87,
        thighL: 180, shinL: 6, footL: -89,
        upperArmR: 166, forearmR: 12,
        upperArmL: 194, forearmL: -12,
      }),
      offsetY: 0,
    },
    // Never sampled at four frames — `poseTimeFor` tops out at 3/4 — but the
    // clip should still end where it claims to if the state ever gets longer.
    {
      t: 1,
      pose: P({
        torso: 3, head: -3,
        thighR: 176, shinR: 6, footR: -86,
        thighL: 184, shinL: 2, footL: -90,
        upperArmR: 167, forearmR: 16,
        upperArmL: 193, forearmL: -16,
      }),
    },
  ],
};

/**
 * Landing lag: the same impact, then a fighter who cannot do anything about it.
 *
 * Length is the move's own lag — six frames to thirty-eight across this roster
 * — so the beats are written as fractions that have to survive both ends of
 * that range. Ordered: the contact, the collapse onto the front foot, a long
 * dwell that is the lag itself, the push, and standing.
 *
 * The dwell is the whole point, and it is why its two keys differ by a few
 * degrees in the body and twenty in the arms rather than not at all. Holding
 * one drawing for twelve frames is how the placeholder read — a photograph —
 * but the fix is not to *move*, which would look like recovery the fighter has
 * not earned. It is to keep settling: the weight rocks back off the toes, the
 * trailing arm keeps falling, and the head comes up a little to look at what it
 * can no longer punish.
 *
 * `scaleY` here is not a second impact squash. It is the compression that is
 * left once `squashFor` has run out at frame six, and it is what keeps a
 * twenty-frame lag pinned to the floor instead of standing at attention for its
 * back half.
 */
export const landingLag: PoseClip = {
  loop: false,
  keys: [
    // Contact, legs long — as in `land`, the squash is doing the work.
    {
      t: 0,
      pose: P({
        hip: -2, torso: 16, head: -14,
        thighR: 160, shinR: 32, footR: -94,
        thighL: 170, shinL: 26, footL: -96,
        upperArmR: 108, forearmR: -34,
        upperArmL: 250, forearmL: 40,
      }),
      offsetX: 0.15,
      offsetY: -0.1,
      ease: "out",
    },
    // The collapse. Deeper than the light landing and unbalanced with it: the
    // front knee takes the load and the back leg trails, which is what an
    // aerial's momentum leaves behind.
    {
      t: 0.1,
      pose: P({
        hip: -8, torso: 26, head: -23,
        thighR: 132, shinR: 80, footR: -100,
        thighL: 148, shinL: 66, footL: -108,
        upperArmR: 138, forearmR: -52,
        upperArmL: 232, forearmL: 58,
      }),
      offsetX: 0.28,
      offsetY: -0.75,
      scaleX: 1.03,
      scaleY: 0.93,
    },
    // The dwell — stuck. Barely a different drawing, and deliberately so.
    //
    // At 0.45 this key lands on frame five of a ten-frame air-dodge lag, six of
    // a fourteen and seven of a sixteen, which is where `squashFor` runs out.
    // The clip picks the compression up on roughly the frame the external
    // squash puts it down, so the fighter does not visibly grow through the
    // middle of the lag. Nothing written as a fraction can line up for every
    // length: on a thirty-eight-frame up special the same key falls at frame
    // seventeen, so the body rebounds a little around frame six and then sags
    // back down over the next dozen. That reads as a heavy fighter settling,
    // which is the least bad way for the mismatch to come out.
    {
      t: 0.45,
      pose: P({
        hip: -6, torso: 22, head: -16,
        thighR: 138, shinR: 74, footR: -100,
        thighL: 152, shinL: 62, footL: -106,
        upperArmR: 152, forearmR: -34,
        upperArmL: 218, forearmL: 40,
      }),
      offsetX: -0.12,
      offsetY: -0.75,
      scaleX: 1.06,
      scaleY: 0.84,
      ease: "in",
    },
    // The push. Placed by the short end of the range rather than the long one:
    // the roster's shortest lag is six frames, and a push any later than this
    // leaves a six-frame landing still halfway down when `stand` takes over.
    {
      t: 0.74,
      pose: P({
        hip: -2, torso: 9, head: -7,
        thighR: 166, shinR: 26, footR: -92,
        thighL: 174, shinL: 20, footL: -94,
        upperArmR: 162, forearmR: 2,
        upperArmL: 200, forearmL: 0,
      }),
      offsetY: -0.2,
      scaleY: 0.97,
      ease: "out",
    },
    {
      t: 1,
      pose: P({
        torso: 3, head: -3,
        thighR: 176, shinR: 6, footR: -86,
        thighL: 184, shinL: 2, footL: -90,
        upperArmR: 167, forearmR: 16,
        upperArmL: 193, forearmL: -16,
      }),
    },
  ],
};
