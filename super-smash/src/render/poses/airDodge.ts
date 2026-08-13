import { P, still, type PoseClip } from "./clip";

export const airDodge: PoseClip = still(
  P({
    torso: 30, head: -26, hip: -10,
    thighR: 118, shinR: 106, footR: -74,
    thighL: 124, shinL: 102, footL: -72,
    upperArmR: 104, forearmR: -96,
    upperArmL: 108, forearmL: -98,
  }),
  { offsetY: -1.2, scaleX: 0.86, scaleY: 0.9 },
);
