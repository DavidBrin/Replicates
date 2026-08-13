import { P, still, type PoseClip } from "./clip";

export const shieldBroken: PoseClip = still(
  P({
    torso: -14, head: 20, hip: 6,
    thighR: 168, shinR: 12, footR: -92,
    thighL: 192, shinL: 12, footL: -88,
    upperArmR: 148, forearmR: -34,
    upperArmL: 212, forearmL: 34,
  }),
  { offsetY: -0.2 },
);
