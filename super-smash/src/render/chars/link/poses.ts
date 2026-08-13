/**
 * Link: the clips that are Link’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB`
 * for the whole roster, which is the right default — fifty clips across eight
 * rigs instead of four hundred hand-authored ones — and the wrong answer for
 * any move whose *shape* is the character. Whatever is named here wins over the
 * shared clip for this fighter alone; whatever is not named falls through
 * unchanged, so this file only ever holds the moves that earn their place.
 *
 * Link earns nearly all of them, for one reason: he is a swordsman, and a sword
 * swing is not a punch played on a longer arm. The shared clips hold the blade
 * out in front and travel about eighty degrees with it over three frames, which
 * on a fighter who is holding four rig units of Master Sword reads as a man
 * pointing. Every clip below exists because the *blade path* is the move — an
 * overhead chop, a low sweep, a thrust, a whirl — and the blade path is the one
 * thing a rig cannot supply for free.
 *
 * Two of them are here for the opposite reason. Link’s neutral air is a flying
 * kick and his back air is two kicks, and the shared clips are a spread-legged
 * sex kick and a single back kick — close enough to be tempting and wrong about
 * how long the leg stays out, which for a move whose hitbox is live for
 * twenty-five of its thirty-eight frames is the whole move.
 *
 * Author against the real move: the frame data (ultimateframedata.com) says
 * when the hitbox is live, and `poseTimeFor` will put the clip’s `strike` key
 * on that frame whatever the numbers are, so the clip only has to be the right
 * *shape*. Where a move has **no** hitbox — the bow, the boomerang, the bomb —
 * there is no `strike`, no remap, and clip time is exactly `frame / totalFrames`:
 * those three place their release keys by hand, and the comments say where.
 *
 * The motions themselves are SmashWiki’s descriptions of the real animations,
 * quoted in each clip’s comment, checked against captures of this rig.
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/** Link, jab: a fast downward slash from over the shoulder. */
const jabClip: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -10, head: 8,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 200, shinL: 20, footL: -84,
        upperArmR: 300, forearmR: 35,
        upperArmL: 150, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 14, head: -10,
        thighR: 152, shinR: 22, footR: -86,
        thighL: 208, shinL: 20, footL: -82,
        upperArmR: 72, forearmR: -4,
        upperArmL: 205, forearmL: -55,
      }),
      offsetX: 0.3,
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.4,
      pose: P({
        torso: 6, head: -4,
        thighR: 154, shinR: 22, footR: -86,
        thighL: 204, shinL: 20, footL: -83,
        upperArmR: 108, forearmR: 4,
        upperArmL: 192, forearmL: -46,
      }),
      offsetX: 0.16,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 150, forearmR: 10, upperArmL: 186, forearmL: -34 }) },
  ],
};

/** Link, forward tilt: a lunging downward slash. */
const ftiltClip: PoseClip = {
  loop: false,
  strike: 0.32,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -16, head: 10,
        thighR: 162, shinR: 26, footR: -86,
        thighL: 200, shinL: 24, footL: -82,
        upperArmR: 318, forearmR: 30,
        upperArmL: 156, forearmL: -26,
      }),
      offsetX: -0.3,
      ease: "in",
    },
    {
      t: 0.32,
      pose: P({
        torso: 16, head: -12, hip: -4,
        thighR: 132, shinR: 40, footR: -80,
        thighL: 224, shinL: 18, footL: -74,
        upperArmR: 74, forearmR: -6,
        upperArmL: 226, forearmL: -58,
      }),
      offsetX: 0.75,
      offsetY: -0.35,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 8, head: -6,
        thighR: 136, shinR: 38, footR: -80,
        thighL: 218, shinL: 18, footL: -76,
        upperArmR: 112, forearmR: 5,
        upperArmL: 212, forearmL: -48,
      }),
      offsetX: 0.45,
      offsetY: -0.3,
    },
    {
      t: 0.66,
      pose: P({
        torso: 6, head: -2,
        thighR: 144, shinR: 30, footR: -84,
        thighL: 210, shinL: 20, footL: -78,
        upperArmR: 140, forearmR: 10,
        upperArmL: 200, forearmL: -40,
      }),
      offsetX: 0.2,
      offsetY: -0.15,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 154, forearmR: 10, upperArmL: 190, forearmL: -32 }) },
  ],
};

/** Link, up tilt: an overhead arcing slash that starts from behind him. */
const utiltClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 14, head: -12,
        thighR: 150, shinR: 40, footR: -84,
        thighL: 204, shinL: 34, footL: -82,
        upperArmR: 216, forearmR: 20,
        upperArmL: 216, forearmL: -36,
      }),
      offsetY: -0.5,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: -8, head: 10,
        thighR: 168, shinR: 14, footR: -88,
        thighL: 194, shinL: 12, footL: -86,
        upperArmR: 18, forearmR: 2,
        upperArmL: 344, forearmL: 6,
      }),
      offsetY: 0.3,
      scaleY: 1.1,
      scaleX: 0.94,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 2, head: 2,
        thighR: 162, shinR: 20, footR: -86,
        thighL: 198, shinL: 18, footL: -84,
        upperArmR: 88, forearmR: 2,
        upperArmL: 306, forearmL: -8,
      }),
      offsetY: 0.1,
    },
    {
      t: 0.62,
      pose: P({
        torso: 6, head: -2,
        thighR: 156, shinR: 26, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 132, forearmR: 8,
        upperArmL: 252, forearmL: -24,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 158, forearmR: 8, upperArmL: 220, forearmL: -28 }) },
  ],
};

/** Link, down tilt: a kneeling inward slash along the ground. */
const dtiltClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 20, head: -16,
        thighR: 136, shinR: 90, footR: -80,
        thighL: 144, shinL: 86, footL: -78,
        upperArmR: 320, forearmR: 10,
        upperArmL: 330, forearmL: -20,
      }),
      offsetY: -1.5,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 24, head: -18, hip: -6,
        thighR: 122, shinR: 96, footR: -76,
        thighL: 148, shinL: 94, footL: -74,
        upperArmR: 84, forearmR: 4,
        upperArmL: 300, forearmL: -34,
      }),
      offsetX: 0.35,
      offsetY: -1.95,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 22, head: -16,
        thighR: 126, shinR: 94, footR: -78,
        thighL: 148, shinL: 92, footL: -74,
        upperArmR: 122, forearmR: 6,
        upperArmL: 290, forearmL: -30,
      }),
      offsetX: 0.16,
      offsetY: -1.85,
    },
    {
      t: 0.66,
      pose: P({
        torso: 20, head: -14,
        thighR: 132, shinR: 88, footR: -80,
        thighL: 146, shinL: 86, footL: -76,
        upperArmR: 156, forearmR: 8,
        upperArmL: 316, forearmL: -24,
      }),
      offsetY: -1.65,
    },
    { t: 1, pose: P({ torso: 18, thighR: 136, shinR: 90, thighL: 146, shinL: 86, upperArmR: 160, forearmR: 8 }), offsetY: -1.5 },
  ],
};

/** Link, dash attack — the Jump Slash: a hop into a downward slash. */
const dashAttackClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 24, head: -16,
        thighR: 140, shinR: 50, footR: -80,
        thighL: 214, shinL: 30, footL: -74,
        upperArmR: 300, forearmR: 32,
        upperArmL: 150, forearmL: -34,
      }),
      offsetX: 0.2,
      ease: "in",
    },
    {
      t: 0.18,
      pose: P({
        torso: 10, head: -6,
        thighR: 128, shinR: 74, footR: -70,
        thighL: 150, shinL: 70, footL: -70,
        upperArmR: 320, forearmR: 26,
        upperArmL: 160, forearmL: -30,
      }),
      offsetX: 0.6,
      offsetY: 0.7,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 26, head: -20, hip: -8,
        thighR: 132, shinR: 34, footR: -80,
        thighL: 222, shinL: 26, footL: -72,
        upperArmR: 76, forearmR: -8,
        upperArmL: 232, forearmL: -56,
      }),
      offsetX: 1.25,
      offsetY: 0.15,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 18, head: -12,
        thighR: 138, shinR: 34, footR: -82,
        thighL: 214, shinL: 26, footL: -74,
        upperArmR: 122, forearmR: 5,
        upperArmL: 214, forearmL: -46,
      }),
      offsetX: 0.85,
    },
    {
      t: 0.66,
      pose: P({
        torso: 12, head: -6,
        thighR: 146, shinR: 30, footR: -84,
        thighL: 206, shinL: 22, footL: -78,
        upperArmR: 152, forearmR: 8,
        upperArmL: 200, forearmL: -38,
      }),
      offsetX: 0.4,
    },
    { t: 1, pose: P({ torso: 8, upperArmR: 158, forearmR: 8, upperArmL: 190, forearmL: -32 }) },
  ],
};

/** Link, forward smash: a two-handed lunging overhead chop — the Master Sword goes up and behind the head, then down and through, and the recovery holds it cocked where the second slash would fire from. */
const fsmashClip: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    // Frame 0. The carry: sword low and back at his side, knees softening, the
    // off hand already leaving the shield for the hilt.
    {
      t: 0,
      pose: P({
        hip: 2, torso: -6, head: 6,
        thighR: 168, shinR: 16, footR: -94,
        thighL: 188, shinL: 8, footL: -106,
        upperArmR: 186, forearmR: 14, handR: 0,
        upperArmL: 196, forearmL: -16,
      }),
      offsetX: -0.1,
      offsetY: -0.15,
      ease: "out",
    },
    // Frame ~7, and the pose a charging smash parks on. Coiled: both knees
    // folded under him, weight back off the front foot, chest turned away from
    // the target, both hands stacked above the head with the blade laid back
    // over the shoulder. The hands sit high rather than beside the ear so the
    // blade clears the cap on the way over.
    {
      t: 0.14,
      pose: P({
        hip: 12, torso: -30, head: 24,
        thighR: 133, shinR: 61, footR: -116,
        thighL: 172, shinL: 40, footL: -134,
        upperArmR: 358, forearmR: -22, handR: -24,
        upperArmL: 4, forearmL: -26,
      }),
      offsetX: -0.7,
      offsetY: -0.7,
      scaleX: 0.95,
      ease: "in",
    },
    // Frame 17: contact. Lunged onto the front foot with the rear heel driven
    // up, chest out over the knee, arms and blade one straight line forward at
    // chest height — which is where the frame data puts its two hitboxes, the
    // near one at the crossguard and the far one at the tip.
    {
      t: 0.3,
      pose: P({
        hip: -8, torso: 28, head: -18,
        thighR: 145, shinR: 16, footR: -63,
        thighL: 222, shinL: 16, footL: -122,
        upperArmR: 70, forearmR: 2, handR: 0,
        upperArmL: 80, forearmL: -6,
      }),
      offsetX: 1.3,
      offsetY: -1.0,
      scaleX: 1.1,
      scaleY: 0.95,
      ease: "out",
    },
    // Frame ~22. The blade carries on past the target and buries itself
    // down-forward; the body is still out over the front foot.
    {
      t: 0.42,
      pose: P({
        hip: -4, torso: 18, head: -10,
        thighR: 149, shinR: 15, footR: -70,
        thighL: 212, shinL: 14, footL: -114,
        upperArmR: 96, forearmR: 24, handR: 10,
        upperArmL: 104, forearmL: 12,
      }),
      offsetX: 0.8,
      offsetY: -0.55,
      scaleX: 1.04,
    },
    // Frame ~27. The off hand leaves the hilt and takes the shield back to
    // guard while the sword arm hauls the blade up in front of him: the cocked
    // position the second, one-handed outward slash fires from. Frames 23-36
    // are the window that second input is read in, so this shape is what the
    // move waits in.
    {
      t: 0.52,
      pose: P({
        hip: 2, torso: 6, head: -2,
        thighR: 154, shinR: 18, footR: -84,
        thighL: 190, shinL: 10, footL: -112,
        upperArmR: 144, forearmR: -90, handR: -22,
        upperArmL: 178, forearmL: -70,
      }),
      offsetX: 0.35,
      offsetY: -0.3,
      ease: "out",
    },
    // Frame ~35, the end of that window. Held, not frozen: the blade sinks a
    // few degrees and the feet come back under him.
    {
      t: 0.7,
      pose: P({
        hip: 1, torso: 5, head: -1,
        thighR: 166, shinR: 12, footR: -89,
        thighL: 186, shinL: 6, footL: -103,
        upperArmR: 150, forearmR: -84, handR: -20,
        upperArmL: 182, forearmL: -64,
      }),
      offsetX: 0.15,
      offsetY: -0.12,
    },
    // Frame ~44. Nobody pressed attack again: the arm drops and the blade
    // lowers back to the carry.
    {
      t: 0.88,
      pose: P({
        hip: 1, torso: 3, head: 0,
        thighR: 172, shinR: 8, footR: -91,
        thighL: 184, shinL: 6, footL: -101,
        upperArmR: 168, forearmR: 6, handR: -4,
        upperArmL: 192, forearmL: -18,
      }),
      offsetX: 0.05,
      offsetY: -0.06,
    },
    // Terminator, never drawn — idle's own first key, so the last frame of the
    // recovery is already standing.
    {
      t: 1,
      pose: P({
        hip: 0.8, torso: 5.5, head: -4,
        thighR: 174.7, shinR: 5, footR: -88,
        thighL: 179.7, shinL: 3, footL: -88,
        upperArmR: 162.5, forearmR: 21.7, handR: 0,
        upperArmL: 195, forearmL: -17.5,
      }),
    },
  ],
};

/** Link, up smash: three overhead arcing slashes, alternating direction. */
const usmashClip: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 14, head: -12,
        thighR: 138, shinR: 78, footR: -84,
        thighL: 146, shinL: 74, footL: -82,
        upperArmR: 222, forearmR: 14,
        upperArmL: 230, forearmL: -40,
      }),
      offsetY: -1.1,
      ease: "in",
    },
    {
      t: 0.24,
      pose: P({
        torso: -6, head: 8,
        thighR: 168, shinR: 12, footR: -88,
        thighL: 194, shinL: 12, footL: -86,
        upperArmR: 22, forearmR: 4,
        upperArmL: 340, forearmL: 8,
      }),
      offsetY: 0.35,
      scaleY: 1.12,
      scaleX: 0.94,
      ease: "out",
    },
    {
      t: 0.32,
      pose: P({
        torso: 6, head: -2,
        thighR: 160, shinR: 18, footR: -86,
        thighL: 198, shinL: 16, footL: -84,
        upperArmR: 96, forearmR: 3,
        upperArmL: 300, forearmL: -10,
      }),
      offsetY: 0.1,
      ease: "in",
    },
    {
      t: 0.41,
      pose: P({
        torso: -4, head: 6,
        thighR: 166, shinR: 12, footR: -88,
        thighL: 195, shinL: 12, footL: -86,
        upperArmR: 6, forearmR: 3,
        upperArmL: 348, forearmL: 6,
      }),
      offsetY: 0.3,
      scaleY: 1.1,
      scaleX: 0.95,
      ease: "out",
    },
    {
      t: 0.49,
      pose: P({
        torso: 0, head: 2,
        thighR: 162, shinR: 16, footR: -86,
        thighL: 197, shinL: 14, footL: -85,
        upperArmR: 288, forearmR: 12,
        upperArmL: 316, forearmL: -8,
      }),
      offsetY: 0.15,
      ease: "in",
    },
    {
      t: 0.59,
      pose: P({
        torso: -10, head: 10,
        thighR: 170, shinR: 10, footR: -88,
        thighL: 192, shinL: 10, footL: -87,
        upperArmR: 22, forearmR: 2,
        upperArmL: 338, forearmL: 8,
      }),
      offsetY: 0.55,
      scaleY: 1.18,
      scaleX: 0.9,
      ease: "out",
    },
    {
      t: 0.7,
      pose: P({
        torso: 4, head: -2,
        thighR: 160, shinR: 18, footR: -86,
        thighL: 198, shinL: 16, footL: -84,
        upperArmR: 92, forearmR: 4,
        upperArmL: 292, forearmL: -12,
      }),
      offsetY: 0.1,
      scaleY: 1.04,
    },
    {
      t: 0.84,
      pose: P({
        torso: 6, head: -4,
        thighR: 154, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 138, forearmR: 12,
        upperArmL: 248, forearmL: -30,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 152, forearmR: 10, upperArmL: 228, forearmL: -24 }) },
  ],
};

/** Link, down smash: a kneeling inward slash in front, then one behind. */
const dsmashClip: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 18, head: -14,
        thighR: 138, shinR: 88, footR: -80,
        thighL: 146, shinL: 84, footL: -78,
        upperArmR: 300, forearmR: 12,
        upperArmL: 320, forearmL: -20,
      }),
      offsetY: -1.6,
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 22, head: -16, hip: -4,
        thighR: 126, shinR: 96, footR: -76,
        thighL: 150, shinL: 92, footL: -74,
        upperArmR: 84, forearmR: 4,
        upperArmL: 300, forearmL: -34,
      }),
      offsetX: 0.35,
      offsetY: -1.95,
      scaleX: 1.14,
      scaleY: 0.9,
      ease: "out",
    },
    {
      t: 0.35,
      pose: P({
        torso: 20, head: -12,
        thighR: 128, shinR: 94, footR: -76,
        thighL: 150, shinL: 90, footL: -74,
        upperArmR: 140, forearmR: 8,
        upperArmL: 286, forearmL: -30,
      }),
      offsetX: 0.1,
      offsetY: -1.95,
      ease: "in",
    },
    {
      t: 0.457,
      pose: P({
        torso: 6, head: 8, hip: -4,
        thighR: 132, shinR: 92, footR: -76,
        thighL: 152, shinL: 88, footL: -74,
        upperArmR: 236, forearmR: 8,
        upperArmL: 130, forearmL: -40,
      }),
      offsetX: -0.35,
      offsetY: -1.95,
      scaleX: 1.14,
      scaleY: 0.9,
      ease: "out",
    },
    {
      t: 0.58,
      pose: P({
        torso: 10, head: 2,
        thighR: 134, shinR: 90, footR: -78,
        thighL: 150, shinL: 86, footL: -76,
        upperArmR: 278, forearmR: 10,
        upperArmL: 160, forearmL: -34,
      }),
      offsetX: -0.16,
      offsetY: -1.8,
    },
    {
      t: 0.75,
      pose: P({
        torso: 14, head: -6,
        thighR: 140, shinR: 76, footR: -80,
        thighL: 148, shinL: 72, footL: -78,
        upperArmR: 204, forearmR: 4,
        upperArmL: 200, forearmL: -30,
      }),
      offsetY: -1.4,
    },
    { t: 1, pose: P({ torso: 10, thighR: 148, shinR: 60, thighL: 154, shinL: 56, upperArmR: 158, forearmR: 8 }), offsetY: -0.9 },
  ],
};

/**
 * Link, neutral air: a flying kick — not a sword move (his nair hitboxes carry
 * no slash effect, which agrees). The clean hit is frames 7–8 and the weak tail
 * runs to frame 31 of 38, so the leg has to stay out for four fifths of the
 * clip rather than snapping back after the contact key.
 */
const nairClip: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -4,
        thighR: 150, shinR: 60, footR: -80,
        thighL: 200, shinL: 50, footL: -78,
        upperArmR: 200, forearmR: 20,
        upperArmL: 200, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 6, head: -2,
        thighR: 90, shinR: -14, footR: 16,
        thighL: 236, shinL: 52, footL: -60,
        upperArmR: 250, forearmR: 22,
        upperArmL: 120, forearmL: -22,
      }),
      scaleX: 1.12,
      scaleY: 0.94,
      ease: "out",
    },
    {
      t: 0.34,
      pose: P({
        torso: 4,
        thighR: 96, shinR: -8, footR: 12,
        thighL: 230, shinL: 50, footL: -62,
        upperArmR: 244, forearmR: 20,
        upperArmL: 124, forearmL: -20,
      }),
      scaleX: 1.08,
    },
    {
      t: 0.6,
      pose: P({
        torso: 2,
        thighR: 104, shinR: -4, footR: 8,
        thighL: 224, shinL: 48, footL: -64,
        upperArmR: 236, forearmR: 18,
        upperArmL: 132, forearmL: -18,
      }),
      scaleX: 1.04,
    },
    {
      t: 0.825,
      pose: P({
        torso: 2,
        thighR: 118, shinR: 6, footR: -4,
        thighL: 216, shinL: 44, footL: -66,
        upperArmR: 224, forearmR: 16,
        upperArmL: 144, forearmL: -18,
      }),
    },
    {
      t: 0.92,
      pose: P({
        torso: 2,
        thighR: 138, shinR: 26, footR: -40,
        thighL: 208, shinL: 38, footL: -70,
        upperArmR: 200, forearmR: 12,
        upperArmL: 172, forearmL: -22,
      }),
    },
    { t: 1, pose: P({ torso: 2, thighR: 146, shinR: 34, thighL: 206, shinL: 30, upperArmR: 176, upperArmL: 196 }) },
  ],
};

/**
 * Link, forward air: two alternating outward slashes. The first comes down
 * across the front (frames 16–17), the second comes back up through it
 * (frames 24–25) — alternating, so the blade never has to rewind.
 */
const fairClip: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -12, head: 10,
        thighR: 152, shinR: 44, footR: -76,
        thighL: 204, shinL: 40, footL: -74,
        upperArmR: 328, forearmR: 22,
        upperArmL: 160, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: 16, head: -12, hip: -4,
        thighR: 144, shinR: 40, footR: -72,
        thighL: 208, shinL: 36, footL: -72,
        upperArmR: 88, forearmR: -4,
        upperArmL: 216, forearmL: -50,
      }),
      offsetX: 0.3,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.36,
      pose: P({
        torso: 12, head: -8,
        thighR: 148, shinR: 40, footR: -74,
        thighL: 206, shinL: 36, footL: -72,
        upperArmR: 148, forearmR: 8,
        upperArmL: 206, forearmL: -44,
      }),
      offsetX: 0.16,
      ease: "in",
    },
    {
      t: 0.44,
      pose: P({
        torso: 4, head: -2, hip: -2,
        thighR: 150, shinR: 38, footR: -74,
        thighL: 206, shinL: 34, footL: -72,
        upperArmR: 74, forearmR: -6,
        upperArmL: 220, forearmL: -48,
      }),
      offsetX: 0.3,
      scaleX: 1.08,
      ease: "out",
    },
    {
      t: 0.56,
      pose: P({
        torso: -2, head: 4,
        thighR: 152, shinR: 36, footR: -76,
        thighL: 204, shinL: 32, footL: -74,
        upperArmR: 20, forearmR: 2,
        upperArmL: 200, forearmL: -40,
      }),
      offsetX: 0.14,
    },
    {
      t: 0.76,
      pose: P({
        torso: 4,
        thighR: 150, shinR: 34, footR: -76,
        thighL: 204, shinL: 30, footL: -74,
        upperArmR: 106, forearmR: 6,
        upperArmL: 196, forearmL: -34,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 152, forearmR: 8, upperArmL: 194, forearmL: -30 }) },
  ],
};

/**
 * Link, back air: a hook kick followed by a mid-level roundhouse — two kicks,
 * no sword, one per hitbox window (frames 6–8 and 15–17 of 30).
 */
const bairClip: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 16, head: -12,
        thighR: 140, shinR: 70, footR: -74,
        thighL: 148, shinL: 66, footL: -72,
        upperArmR: 150, forearmR: -30,
        upperArmL: 150, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.24,
      pose: P({
        torso: 30, head: -24, hip: 8,
        thighR: 290, shinR: -6, footR: -30,
        thighL: 176, shinL: 46, footL: -70,
        upperArmR: 120, forearmR: -40,
        upperArmL: 116, forearmL: -38,
      }),
      offsetX: -0.4,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.36,
      pose: P({
        torso: 18, head: -14,
        thighR: 220, shinR: 40, footR: -60,
        thighL: 200, shinL: 30, footL: -70,
        upperArmR: 140, forearmR: -34,
        upperArmL: 140, forearmL: -32,
      }),
      offsetX: -0.15,
      ease: "in",
    },
    {
      t: 0.514,
      pose: P({
        torso: 28, head: -22, hip: 6,
        thighR: 190, shinR: 30, footR: -70,
        thighL: 292, shinL: -4, footL: -30,
        upperArmR: 118, forearmR: -38,
        upperArmL: 122, forearmL: -40,
      }),
      offsetX: -0.4,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.72,
      pose: P({
        torso: 14, head: -10,
        thighR: 178, shinR: 34, footR: -74,
        thighL: 212, shinL: 30, footL: -68,
        upperArmR: 150, forearmR: -26,
        upperArmL: 152, forearmL: -28,
      }),
      offsetX: -0.15,
    },
    { t: 1, pose: P({ torso: 8, thighR: 172, shinR: 32, thighL: 204, shinL: 28, upperArmR: 166, upperArmL: 176 }) },
  ],
};

/**
 * Link, up air — the Jump Thrust: the sword driven straight up in both hands.
 * The hitbox lives from frame 11 to frame 40 of 59, so the blade stays up for
 * two thirds of the clip; a thrust that retracts on the contact frame is a
 * thrust that spends most of the move claiming nothing.
 */
const uairClip: PoseClip = {
  loop: false,
  strike: 0.22,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 14, head: -12,
        thighR: 148, shinR: 58, footR: -78,
        thighL: 200, shinL: 52, footL: -76,
        upperArmR: 200, forearmR: 30,
        upperArmL: 206, forearmL: -26,
      }),
      ease: "in",
    },
    {
      t: 0.22,
      pose: P({
        torso: -8, head: 8,
        thighR: 172, shinR: 10, footR: -84,
        thighL: 190, shinL: 10, footL: -84,
        upperArmR: 10, forearmR: -2,
        upperArmL: 350, forearmL: 2,
      }),
      offsetY: 0.35,
      scaleY: 1.16,
      scaleX: 0.9,
      ease: "out",
    },
    {
      t: 0.42,
      pose: P({
        torso: -4, head: 6,
        thighR: 170, shinR: 12, footR: -84,
        thighL: 192, shinL: 12, footL: -84,
        upperArmR: 14, forearmR: -2,
        upperArmL: 346, forearmL: 2,
      }),
      offsetY: 0.2,
      scaleY: 1.1,
      scaleX: 0.93,
    },
    {
      t: 0.698,
      pose: P({
        torso: 0, head: 4,
        thighR: 166, shinR: 16, footR: -84,
        thighL: 194, shinL: 14, footL: -84,
        upperArmR: 22, forearmR: 0,
        upperArmL: 338, forearmL: 4,
      }),
      offsetY: 0.08,
      scaleY: 1.04,
    },
    {
      t: 0.86,
      pose: P({
        torso: 6, head: -2,
        thighR: 158, shinR: 26, footR: -82,
        thighL: 200, shinL: 22, footL: -80,
        upperArmR: 86, forearmR: 6,
        upperArmL: 290, forearmL: -12,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 150, forearmR: 8, upperArmL: 226, forearmL: -26 }) },
  ],
};

/**
 * Link, down air — the Down Thrust: the sword point driven straight down under
 * him, held there. The meteor window is frames 14–19 and the weak tail runs to
 * frame 64 of 79, so the blade is down for four fifths of the clip; the legs
 * fold back out of its way rather than hanging through it.
 */
const dairClip: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 8,
        thighR: 146, shinR: 70, footR: -78,
        thighL: 200, shinL: 66, footL: -76,
        upperArmR: 300, forearmR: 40,
        upperArmL: 214, forearmL: 20,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 4, head: -2,
        thighR: 208, shinR: 66, footR: -66,
        thighL: 222, shinL: 62, footL: -64,
        upperArmR: 158, forearmR: 8,
        upperArmL: 176, forearmL: 6,
      }),
      offsetY: -0.2,
      scaleY: 1.16,
      scaleX: 0.86,
      ease: "out",
    },
    {
      t: 0.45,
      pose: P({
        torso: 2,
        thighR: 212, shinR: 62, footR: -66,
        thighL: 224, shinL: 60, footL: -64,
        upperArmR: 162, forearmR: 8,
        upperArmL: 178, forearmL: 6,
      }),
      offsetY: -0.12,
      scaleY: 1.1,
      scaleX: 0.9,
    },
    {
      t: 0.818,
      pose: P({
        torso: 0,
        thighR: 206, shinR: 58, footR: -68,
        thighL: 220, shinL: 56, footL: -66,
        upperArmR: 166, forearmR: 8,
        upperArmL: 182, forearmL: 6,
      }),
      scaleY: 1.06,
      scaleX: 0.94,
    },
    {
      t: 0.92,
      pose: P({
        torso: 0,
        thighR: 190, shinR: 44, footR: -74,
        thighL: 208, shinL: 42, footL: -72,
        upperArmR: 160, forearmR: 8,
        upperArmL: 196, forearmL: 4,
      }),
    },
    { t: 1, pose: P({ torso: 0, thighR: 176, shinR: 32, thighL: 198, shinL: 30, upperArmR: 156, upperArmL: 196 }) },
  ],
};

/**
 * Link, Hero's Bow.
 *
 * The bow has **no hitbox**, so `strike` never fires and clip time is exactly
 * `frame / 44`. The arrow leaves on frame 16, so the loose is authored at
 * t = 16/44 ≈ 0.364 and nowhere else.
 *
 * The bow is held in the **left** hand and the string drawn with the right.
 * That is the wrong hand for the real Link and the only one that works here:
 * the sword is a prop welded to `handR` and is drawn whatever the pose does, so
 * a bow in the right hand is a bow with a sword through it — which is exactly
 * what the first capture showed. With the draw hand at his cheek the blade
 * instead rakes back over his shoulder, out of the shot and out of the way.
 */
const neutralBClip: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 4,
        thighR: 158, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 250, forearmR: 40,
        upperArmL: 128, forearmL: -30,
      }),
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 0, head: 0,
        thighR: 152, shinR: 24, footR: -86,
        thighL: 210, shinL: 22, footL: -82,
        upperArmR: 288, forearmR: 26,
        upperArmL: 88, forearmL: 2,
      }),
      offsetX: 0.1,
      ease: "in",
    },
    {
      t: 0.364,
      pose: P({
        torso: 4, head: -4,
        thighR: 150, shinR: 24, footR: -86,
        thighL: 212, shinL: 22, footL: -82,
        upperArmR: 302, forearmR: 18,
        upperArmL: 86, forearmL: 2,
      }),
      offsetX: 0.18,
      scaleX: 1.04,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: 2, head: -2,
        thighR: 152, shinR: 24, footR: -86,
        thighL: 208, shinL: 22, footL: -83,
        upperArmR: 268, forearmR: 8,
        upperArmL: 104, forearmL: 4,
      }),
      offsetX: 0.08,
    },
    {
      t: 0.76,
      pose: P({
        torso: 4,
        thighR: 154, shinR: 22, footR: -86,
        thighL: 204, shinL: 20, footL: -84,
        upperArmR: 208, forearmR: 8,
        upperArmL: 140, forearmL: -16,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 168, forearmR: 8, upperArmL: 178, forearmL: -30 }) },
  ],
};

/**
 * Link, Boomerang: an overhand hurl with the left hand.
 *
 * No hitbox, so `strike` never fires and clip time is exactly `frame / 45`.
 * The boomerang leaves on frame 27, so the release is authored at t = 0.6 and
 * nowhere else — three fifths of this move is wind-up, which is why it is the
 * one special of his that can be seen coming.
 *
 * Thrown left-handed, which the real Link does not do. The sword is welded to
 * `handR`, so a right-handed throw is a thrown sword; moving the shield off the
 * left forearm and onto his back (see `rig.ts`) is what frees the hand that
 * this, the bomb and the grab all need.
 *
 * Overhand rather than the sidearm it started as, for a reason that is about
 * the renderer and not about Link: move effects are painted *under* the
 * fighter, so a boomerang wound up behind his shoulder is a boomerang behind
 * his cap, and the first two capture rounds had nothing visible in them until
 * frame 24. Held above the head it is outside his silhouette for the whole
 * wind-up, which is the two thirds of this move a player has to read.
 */
const sideBClip: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 202, shinL: 20, footL: -84,
        upperArmR: 196, forearmR: 10,
        upperArmL: 40, forearmL: -24,
      }),
      ease: "in",
    },
    {
      t: 0.35,
      pose: P({
        torso: -18, head: 12,
        thighR: 166, shinR: 24, footR: -86,
        thighL: 198, shinL: 22, footL: -82,
        upperArmR: 202, forearmR: 10,
        upperArmL: 8, forearmL: -34,
      }),
      offsetX: -0.35,
      ease: "in",
    },
    {
      t: 0.6,
      pose: P({
        torso: 24, head: -18, hip: -4,
        thighR: 138, shinR: 30, footR: -84,
        thighL: 218, shinL: 24, footL: -76,
        upperArmR: 216, forearmR: 12,
        upperArmL: 74, forearmL: -14,
      }),
      offsetX: 0.6,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.75,
      pose: P({
        torso: 12, head: -8,
        thighR: 144, shinR: 28, footR: -84,
        thighL: 212, shinL: 22, footL: -78,
        upperArmR: 200, forearmR: 10,
        upperArmL: 110, forearmL: 2,
      }),
      offsetX: 0.3,
    },
    {
      t: 0.88,
      pose: P({
        torso: 8, head: -4,
        thighR: 150, shinR: 24, footR: -86,
        thighL: 206, shinL: 20, footL: -82,
        upperArmR: 182, forearmR: 8,
        upperArmL: 150, forearmL: -18,
      }),
      offsetX: 0.14,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 166, forearmR: 8, upperArmL: 180, forearmL: -30 }) },
  ],
};

/**
 * Link, Spin Attack: the blade whirls a full turn around him, twice, over the
 * long active window (frames 7–39 of 76), and he rises as it does.
 *
 * The rotation is in the *arm*, not in the clip's `spin`. `spin` turns the whole
 * body about its middle, which in a side view is a cartwheel — and Spin Attack
 * is a pirouette about the vertical axis, which a side view cannot show at all.
 * What a player actually reads is the blade going round, so the blade goes
 * round: successive keys step the accumulated hand angle by ninety degrees, each
 * step well under the half-turn at which shortest-path interpolation would flip
 * direction, which is what lets a chain of keys express a rotation that a single
 * pair never could.
 */
const upBClip: PoseClip = {
  loop: false,
  strike: 0.2,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 12, head: -10,
        thighR: 140, shinR: 74, footR: -80,
        thighL: 148, shinL: 70, footL: -78,
        upperArmR: 226, forearmR: 14,
        upperArmL: 220, forearmL: -34,
      }),
      offsetY: -1.0,
      ease: "in",
    },
    {
      t: 0.2,
      pose: P({
        torso: 4, head: -2,
        thighR: 156, shinR: 40, footR: -84,
        thighL: 200, shinL: 36, footL: -82,
        upperArmR: 96, forearmR: 2,
        upperArmL: 268, forearmL: -10,
      }),
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.26,
      pose: P({
        torso: 2,
        thighR: 164, shinR: 28, footR: -86,
        thighL: 196, shinL: 26, footL: -84,
        upperArmR: 186, forearmR: 2,
        upperArmL: 358, forearmL: -6,
      }),
      offsetY: 0.2,
      ease: "linear",
    },
    {
      t: 0.32,
      pose: P({
        torso: 2,
        thighR: 168, shinR: 22, footR: -86,
        thighL: 194, shinL: 20, footL: -85,
        upperArmR: 276, forearmR: 2,
        upperArmL: 88, forearmL: -6,
      }),
      offsetY: 0.34,
      ease: "linear",
    },
    {
      t: 0.38,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 18, footR: -87,
        thighL: 192, shinL: 18, footL: -86,
        upperArmR: 4, forearmR: 2,
        upperArmL: 176, forearmL: -6,
      }),
      offsetY: 0.46,
      ease: "linear",
    },
    {
      t: 0.44,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 16, footR: -87,
        thighL: 192, shinL: 16, footL: -86,
        upperArmR: 94, forearmR: 2,
        upperArmL: 266, forearmL: -6,
      }),
      offsetY: 0.56,
      ease: "linear",
    },
    {
      t: 0.5,
      pose: P({
        torso: 2,
        thighR: 170, shinR: 16, footR: -87,
        thighL: 192, shinL: 16, footL: -86,
        upperArmR: 184, forearmR: 2,
        upperArmL: 356, forearmL: -6,
      }),
      offsetY: 0.62,
      ease: "linear",
    },
    {
      t: 0.577,
      pose: P({
        torso: 2,
        thighR: 168, shinR: 18, footR: -86,
        thighL: 194, shinL: 18, footL: -85,
        upperArmR: 274, forearmR: 2,
        upperArmL: 86, forearmL: -6,
      }),
      offsetY: 0.64,
      ease: "linear",
    },
    {
      t: 0.66,
      pose: P({
        torso: 4,
        thighR: 164, shinR: 24, footR: -86,
        thighL: 196, shinL: 22, footL: -84,
        upperArmR: 4, forearmR: 4,
        upperArmL: 174, forearmL: -8,
      }),
      offsetY: 0.54,
    },
    {
      t: 0.78,
      pose: P({
        torso: 6, head: -4,
        thighR: 156, shinR: 34, footR: -84,
        thighL: 202, shinL: 30, footL: -82,
        upperArmR: 96, forearmR: 6,
        upperArmL: 248, forearmL: -20,
      }),
      offsetY: 0.32,
    },
    {
      t: 0.9,
      pose: P({
        torso: 8, head: -6,
        thighR: 150, shinR: 44, footR: -82,
        thighL: 206, shinL: 38, footL: -80,
        upperArmR: 144, forearmR: 8,
        upperArmL: 218, forearmL: -28,
      }),
      offsetY: 0.12,
    },
    { t: 1, pose: P({ torso: 6, upperArmR: 158, forearmR: 8, upperArmL: 200, forearmL: -30 }) },
  ],
};

/**
 * Link, Remote Bomb: the Sheikah Slate held out, a bomb materialising in the
 * off hand and dropped forward.
 *
 * No hitbox, so clip time is `frame / 39`; the bomb exists from frame 17, which
 * is t ≈ 0.436. This is the one special that must not look like a throw — in
 * Ultimate the bomb is *made*, not launched, and detonating it is a separate
 * input entirely.
 */
const downBClip: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 10, head: -6,
        thighR: 156, shinR: 26, footR: -86,
        thighL: 202, shinL: 24, footL: -84,
        upperArmR: 176, forearmR: 10,
        upperArmL: 150, forearmL: -62,
      }),
      ease: "in",
    },
    {
      t: 0.25,
      pose: P({
        torso: 4, head: -2,
        thighR: 154, shinR: 26, footR: -86,
        thighL: 204, shinL: 24, footL: -84,
        upperArmR: 182, forearmR: 10,
        upperArmL: 100, forearmL: -50,
      }),
      ease: "in",
    },
    {
      t: 0.436,
      pose: P({
        torso: 12, head: -8,
        thighR: 150, shinR: 26, footR: -86,
        thighL: 210, shinL: 24, footL: -82,
        upperArmR: 186, forearmR: 10,
        upperArmL: 84, forearmL: -18,
      }),
      offsetX: 0.25,
      scaleX: 1.04,
      ease: "out",
    },
    {
      t: 0.6,
      pose: P({
        torso: 6, head: -4,
        thighR: 152, shinR: 26, footR: -86,
        thighL: 206, shinL: 24, footL: -83,
        upperArmR: 180, forearmR: 10,
        upperArmL: 108, forearmL: 4,
      }),
      offsetX: 0.12,
    },
    {
      t: 0.8,
      pose: P({
        torso: 4,
        thighR: 154, shinR: 24, footR: -86,
        thighL: 204, shinL: 22, footL: -84,
        upperArmR: 170, forearmR: 8,
        upperArmL: 150, forearmL: -20,
      }),
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 162, forearmR: 8, upperArmL: 184, forearmL: -32 }) },
  ],
};

/**
 * Link, grab: reaches out with one hand — the left, because the right is
 * holding a sword and a two-armed lunge with the Master Sword in it is a stab,
 * not a grab.
 *
 * The terminator keeps the arm out rather than returning to guard: this clip is
 * also the `grabHold` and `pummel` pose, so whatever it converges towards is
 * what a fighter holding an opponent stands in.
 */
const grabClip: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 4,
        thighR: 158, shinR: 22, footR: -86,
        thighL: 202, shinL: 20, footL: -84,
        upperArmR: 176, forearmR: 10,
        upperArmL: 150, forearmL: -40,
      }),
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: 12, head: -8,
        thighR: 150, shinR: 24, footR: -86,
        thighL: 212, shinL: 22, footL: -80,
        upperArmR: 205, forearmR: 6,
        upperArmL: 86, forearmL: 0,
      }),
      offsetX: 0.4,
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.45,
      pose: P({
        torso: 8, head: -4,
        thighR: 152, shinR: 24, footR: -86,
        thighL: 208, shinL: 22, footL: -82,
        upperArmR: 198, forearmR: 8,
        upperArmL: 94, forearmL: -4,
      }),
      offsetX: 0.2,
    },
    { t: 1, pose: P({ torso: 6, upperArmR: 190, forearmR: 8, upperArmL: 100, forearmL: -8 }) },
  ],
};

/** Link, forward throw: a front kick. The sword never enters it. */
const fthrowClip: PoseClip = {
  loop: false,
  strike: 0.35,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 184, forearmR: 10,
        upperArmL: 110, forearmL: -50,
      }),
      ease: "in",
    },
    {
      t: 0.35,
      pose: P({
        torso: -12, head: 12, hip: 6,
        thighR: 96, shinR: -10, footR: 18,
        thighL: 196, shinL: 16, footL: -80,
        upperArmR: 200, forearmR: 12,
        upperArmL: 96, forearmL: -20,
      }),
      offsetX: 0.3,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: -4, head: 6,
        thighR: 124, shinR: 16, footR: -30,
        thighL: 198, shinL: 18, footL: -80,
        upperArmR: 192, forearmR: 10,
        upperArmL: 118, forearmL: -14,
      }),
      offsetX: 0.16,
    },
    { t: 1, pose: P({ torso: 2, thighR: 152, shinR: 24, upperArmR: 172, forearmR: 8, upperArmL: 160, forearmL: -26 }) },
  ],
};

/** Link, back throw: a side kick, delivered behind him. */
const bthrowClip: PoseClip = {
  loop: false,
  strike: 0.37,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 10, head: -6,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 180, forearmR: 10,
        upperArmL: 116, forearmL: -44,
      }),
      ease: "in",
    },
    {
      t: 0.37,
      pose: P({
        torso: 28, head: -22, hip: 8,
        thighR: 268, shinR: -8, footR: -26,
        thighL: 176, shinL: 34, footL: -78,
        upperArmR: 148, forearmR: -20,
        upperArmL: 132, forearmL: -30,
      }),
      offsetX: -0.4,
      scaleX: 1.12,
      ease: "out",
    },
    {
      t: 0.55,
      pose: P({
        torso: 18, head: -14,
        thighR: 232, shinR: 18, footR: -56,
        thighL: 188, shinL: 28, footL: -80,
        upperArmR: 166, forearmR: -8,
        upperArmL: 150, forearmL: -26,
      }),
      offsetX: -0.18,
    },
    { t: 1, pose: P({ torso: 6, thighR: 190, shinR: 24, upperArmR: 176, forearmR: 6, upperArmL: 176, forearmL: -28 }) },
  ],
};

/** Link, up throw: raises the opponent overhead, then slashes them upward. */
const uthrowClip: PoseClip = {
  loop: false,
  strike: 0.5,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -6,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 210, forearmR: 12,
        upperArmL: 120, forearmL: -50,
      }),
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: -6, head: 6,
        thighR: 160, shinR: 20, footR: -86,
        thighL: 198, shinL: 18, footL: -84,
        upperArmR: 250, forearmR: 20,
        upperArmL: 20, forearmL: -10,
      }),
      offsetY: 0.12,
      ease: "in",
    },
    {
      t: 0.5,
      pose: P({
        torso: -8, head: 10,
        thighR: 168, shinR: 12, footR: -88,
        thighL: 192, shinL: 12, footL: -86,
        upperArmR: 8, forearmR: -4,
        upperArmL: 350, forearmL: 4,
      }),
      offsetY: 0.35,
      scaleY: 1.12,
      scaleX: 0.94,
      ease: "out",
    },
    {
      t: 0.66,
      pose: P({
        torso: 0, head: 4,
        thighR: 162, shinR: 18, footR: -86,
        thighL: 196, shinL: 16, footL: -85,
        upperArmR: 80, forearmR: 6,
        upperArmL: 306, forearmL: -10,
      }),
      offsetY: 0.12,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 152, forearmR: 8, upperArmL: 210, forearmL: -30 }) },
  ],
};

/** Link, down throw: pins the opponent, hops, and drops an elbow on them. */
const dthrowClip: PoseClip = {
  loop: false,
  strike: 0.48,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -10, head: 8,
        thighR: 156, shinR: 24, footR: -86,
        thighL: 202, shinL: 22, footL: -84,
        upperArmR: 176, forearmR: 10,
        upperArmL: 128, forearmL: -46,
      }),
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: -4, head: 4,
        thighR: 120, shinR: 90, footR: -66,
        thighL: 130, shinL: 86, footL: -64,
        upperArmR: 320, forearmR: 96,
        upperArmL: 150, forearmL: -60,
      }),
      offsetY: 0.8,
      ease: "in",
    },
    {
      t: 0.48,
      pose: P({
        torso: 34, head: -26, hip: -10,
        thighR: 128, shinR: 96, footR: -74,
        thighL: 138, shinL: 92, footL: -72,
        upperArmR: 150, forearmR: -88,
        upperArmL: 168, forearmL: -30,
      }),
      offsetY: -1.9,
      scaleX: 1.1,
      scaleY: 0.88,
      ease: "out",
    },
    {
      t: 0.62,
      pose: P({
        torso: 26, head: -18,
        thighR: 132, shinR: 92, footR: -76,
        thighL: 142, shinL: 88, footL: -74,
        upperArmR: 164, forearmR: -60,
        upperArmL: 176, forearmL: -22,
      }),
      offsetY: -1.7,
    },
    { t: 1, pose: P({ torso: 14, thighR: 146, shinR: 62, thighL: 152, shinL: 58, upperArmR: 172, forearmR: 8 }), offsetY: -1.0 },
  ],
};

export const poses: Partial<Record<PoseName, PoseClip>> = {
  jab: jabClip,
  ftilt: ftiltClip,
  utilt: utiltClip,
  dtilt: dtiltClip,
  dashAttack: dashAttackClip,
  fsmash: fsmashClip,
  usmash: usmashClip,
  dsmash: dsmashClip,
  nair: nairClip,
  fair: fairClip,
  bair: bairClip,
  uair: uairClip,
  dair: dairClip,
  neutralB: neutralBClip,
  sideB: sideBClip,
  upB: upBClip,
  downB: downBClip,
  grab: grabClip,
  fthrow: fthrowClip,
  bthrow: bthrowClip,
  uthrow: uthrowClip,
  dthrow: dthrowClip,
};
