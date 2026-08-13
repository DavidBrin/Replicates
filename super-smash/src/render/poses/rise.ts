import { P, still, type PoseClip } from "./clip";

export const rise: PoseClip = still(
  P({
    torso: 4, head: -2,
    thighR: 162, shinR: 24, footR: -70,
    thighL: 190, shinL: 16, footL: -84,
    upperArmR: 40, forearmR: 22,
    upperArmL: 320, forearmL: -22,
  }),
  { offsetY: 0.3, scaleX: 0.94, scaleY: 1.08 },
);

/** Placeholder: the second jump is the first one. Ultimate's is a distinct flip. */
export const doubleJump: PoseClip = rise;
