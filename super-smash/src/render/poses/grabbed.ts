import { P, still, type PoseClip } from "./clip";

export const grabbed: PoseClip = still(
  P({
    torso: -14, head: 16,
    thighR: 164, shinR: 26, footR: -78,
    thighL: 198, shinL: 22, footL: -80,
    upperArmR: 34, forearmR: 30,
    upperArmL: 318, forearmL: -30,
  }),
  { offsetY: 0.4 },
);

/** Placeholder: being thrown is being held. */
export const thrown: PoseClip = grabbed;
