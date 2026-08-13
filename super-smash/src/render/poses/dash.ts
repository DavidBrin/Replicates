import { P, still, type PoseClip } from "./clip";

// The initial dash: everything already thrown forward, weight ahead of the feet.
export const dash: PoseClip = still(
  P({
    torso: 22,
    head: -16,
    hip: -6,
    thighR: 138, shinR: 26, footR: -80,
    thighL: 216, shinL: 40, footL: -60,
    upperArmR: 220, forearmR: 40,
    upperArmL: 130, forearmL: -50,
  }),
  { offsetX: 0.5, offsetY: -0.2 },
);
