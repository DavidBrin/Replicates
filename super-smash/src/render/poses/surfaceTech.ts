import { fall } from "./fall";
import { P, type PoseClip } from "./clip";

/**
 * A tech off a wall or a ceiling (Plan 6, Task 22; the statuses `techWall` and
 * `techCeiling`, rubendal 13.0.1 motions `passive_wall` and `passive_ceil`): braced and
 * compact against the surface, held for the wall's hold (`TECH_WALL_HOLD`, 5 of its 26
 * frames), then opening into the fall's first pose. Plan 3 played the tumble's spin here,
 * which reads as the reel the tech escaped; this one never turns the body over. The
 * replica's shape (the game's animation is unpublished); one clip for both, as neither
 * status says which side the surface is.
 */
export const surfaceTech: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 18, head: -10,
        thighR: 118, shinR: 96, footR: -82,
        thighL: 126, shinL: 90, footL: -84,
        upperArmR: 84, forearmR: -40,
        upperArmL: 276, forearmL: 40,
      }),
      offsetY: 0.4,
    },
    {
      t: 0.2,
      pose: P({
        torso: 18, head: -10,
        thighR: 118, shinR: 96, footR: -82,
        thighL: 126, shinL: 90, footL: -84,
        upperArmR: 84, forearmR: -40,
        upperArmL: 276, forearmL: 40,
      }),
      offsetY: 0.4,
    },
    {
      t: 0.55,
      pose: P({
        torso: 6, head: -2,
        thighR: 140, shinR: 60, footR: -78,
        thighL: 160, shinL: 50, footL: -82,
        upperArmR: 100, forearmR: -20,
        upperArmL: 260, forearmL: 20,
      }),
      offsetY: 0.3,
    },
    { t: 1, pose: fall.keys[0].pose, offsetY: fall.keys[0].offsetY, scaleX: fall.keys[0].scaleX, scaleY: fall.keys[0].scaleY },
  ],
};
