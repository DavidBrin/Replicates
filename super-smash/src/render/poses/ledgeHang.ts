import { P, still, type PoseClip } from "./clip";

// Hanging by both hands from a ledge above and in front.
export const ledgeHang: PoseClip = still(
  P({
    torso: -4, head: 6,
    thighR: 168, shinR: 40, footR: -60,
    thighL: 194, shinL: 34, footL: -64,
    upperArmR: 6, forearmR: 4,
    upperArmL: -6, forearmL: -4,
  }),
  { offsetY: 0.6, offsetX: -0.3 },
);

/** Placeholder: climbing the ledge is hanging from it. */
export const ledgeGetUp: PoseClip = ledgeHang;
