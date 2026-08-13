import { P, still, type PoseClip } from "./clip";

// Skidding: heels dug in, torso leaning back against the momentum.
export const brake: PoseClip = still(
  P({
    torso: -16, head: 12, hip: 8,
    thighR: 158, shinR: 22, footR: -108,
    thighL: 198, shinL: 30, footL: -78,
    upperArmR: 130, forearmR: -30,
    upperArmL: 226, forearmL: 30,
  }),
  { offsetY: -0.5 },
);
