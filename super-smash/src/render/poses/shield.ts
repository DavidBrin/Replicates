import { P, still, type PoseClip } from "./clip";

export const shield: PoseClip = still(
  P({
    torso: 8, head: -8,
    thighR: 156, shinR: 44, footR: -84,
    thighL: 202, shinL: 40, footL: -80,
    upperArmR: 108, forearmR: -68,
    upperArmL: 116, forearmL: -74,
  }),
  { offsetY: -0.7 },
);

/** Placeholder: dropping shield is holding shield. */
export const shieldRelease: PoseClip = shield;
