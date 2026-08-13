import { P, still, type PoseClip } from "./clip";

export const crouch: PoseClip = still(
  P({
    torso: 16, head: -14, hip: -4,
    thighR: 132, shinR: 96, footR: -84,
    thighL: 140, shinL: 92, footL: -80,
    upperArmR: 150, forearmR: 62,
    upperArmL: 210, forearmL: -62,
  }),
  { offsetY: -1.55, scaleY: 0.94 },
);

/**
 * The descent into the crouch, and the rise back out of it.
 *
 * Placeholders: both are the settled crouch, so a fighter snaps into the shape
 * on frame 1 and snaps out of it on the last. Ultimate gives each five frames
 * of its own.
 */
export const crouchStart: PoseClip = crouch;
export const crouchEnd: PoseClip = crouch;
