import { P, still, type PoseClip } from "./clip";

export const fall: PoseClip = still(
  P({
    torso: -3, head: 4,
    thighR: 158, shinR: 34, footR: -76,
    thighL: 200, shinL: 26, footL: -84,
    upperArmR: 118, forearmR: -28,
    upperArmL: 242, forearmL: 28,
  }),
  { offsetY: 0.1 },
);

/** Placeholder: fast-falling looks exactly like falling, which is the bug. */
export const fastFall: PoseClip = fall;
