import { P, still, type PoseClip } from "./clip";

export const hitstun: PoseClip = still(
  P({
    torso: -26, head: 28, hip: 10,
    thighR: 166, shinR: 16, footR: -70,
    thighL: 196, shinL: 22, footL: -66,
    upperArmR: 46, forearmR: 34,
    upperArmL: 306, forearmL: -34,
  }),
  { offsetX: -0.4, offsetY: 0.2, scaleX: 0.95, scaleY: 1.05 },
);
