import { P, still, type PoseClip } from "./clip";

export const spotDodge: PoseClip = still(
  P({
    torso: 24, head: -22, hip: -8,
    thighR: 126, shinR: 104, footR: -80,
    thighL: 132, shinL: 100, footL: -78,
    upperArmR: 120, forearmR: -80,
    upperArmL: 124, forearmL: -84,
  }),
  { offsetY: -1.9, scaleX: 0.78, scaleY: 0.92 },
);
