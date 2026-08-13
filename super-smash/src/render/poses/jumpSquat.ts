import { P, type PoseClip } from "./clip";

/**
 * Three held drawings, one per frame.
 *
 * Ultimate gave every fighter the same three-frame jumpsquat — Kazuya's seven
 * and Giga Bowser's fifteen are the only exceptions — and that universal 3 is
 * the whole design of this clip. Fifty milliseconds is not long enough to
 * traverse a pose, only to show one, so every span is `hold`: `poseTimeFor`
 * divides `actionFrame` by `JUMP_SQUAT_FRAMES`, the renderer asks for exactly
 * 0, ⅓ and ⅔, and gets three unblended drawings. Eased, the three frames would
 * be half-poses of each other and the deep one would never be drawn at all.
 *
 * The beats are break, bottom, unload — which is also what the real animation
 * is, a coiled crouch fired off in three frames. The unload is the one that is
 * easy to leave out and the one that matters most: nothing interpolates between
 * clips, so frame 3 cuts straight to `rise`, and a fighter still compressing on
 * frame 2 pops on the cut. Its legs are opening and its arms are mid-swing, one
 * step short of where `rise` picks them up. Short of, because this clip is never
 * told which jump it is about to become — the button state on the frame it ends
 * is what picks short hop or full hop, which is the decision Ultimate's
 * universal 3 created and then had to sell a short-hop attack macro to soften —
 * so it can be loaded but not committed.
 *
 * Two things constrain the numbers. `squashFor` already multiplies 1.1/0.88
 * onto the whole state, so the break rides that untouched, only the bottom
 * deepens it, and only the unload takes it back past neutral into a stretch.
 * And the feet stay flat rather than up on the toes: eight rigs share this clip
 * with foot bones anywhere from 1.0 to 1.6 units long, and pointing the foot
 * downwards spends that difference on depth — half a unit of Kirby through the
 * stage — where a flat one spends it on shoe length, which nobody can see.
 */
export const jumpSquat: PoseClip = {
  loop: false,
  keys: [
    // The break. Knees give, hips drop, arms still hanging — they have had one
    // frame to move and it shows.
    {
      t: 0,
      pose: P({
        torso: 11, head: -10,
        thighR: 154, shinR: 42, footR: -94,
        thighL: 161, shinL: 38, footL: -99,
        upperArmR: 184, forearmR: 26,
        upperArmL: 196, forearmL: -28,
      }),
      offsetY: -0.07,
      ease: "hold",
    },
    // The bottom. Lowest, widest, arms flung behind the hips. This is the
    // drawing the eye actually catches, so it takes the extra squash.
    {
      t: 1 / 3,
      pose: P({
        torso: 19, head: -18,
        thighR: 140, shinR: 72, footR: -117,
        thighL: 148, shinL: 68, footL: -123,
        upperArmR: 216, forearmR: 22,
        upperArmL: 226, forearmL: -20,
      }),
      offsetY: -0.56,
      scaleX: 1.05,
      scaleY: 0.94,
      ease: "hold",
    },
    // The unload. Legs driving open, torso up, heels off the floor, and taller
    // than standing because the ankles have extended under a body that has not
    // left the ground yet. The arms scissor rather than both coming through:
    // the near one whips forward, the far one carries on the way it was already
    // going, back and up, which keeps the silhouette open and leaves it mid-arc
    // for whatever the jump does with it.
    {
      t: 2 / 3,
      pose: P({
        torso: 6, head: -4,
        thighR: 162, shinR: 32, footR: -76,
        thighL: 170, shinL: 26, footL: -80,
        upperArmR: 116, forearmR: -24,
        upperArmL: 226, forearmL: 20,
      }),
      offsetY: 0.29,
      scaleX: 0.9,
      scaleY: 1.16,
    },
  ],
};
