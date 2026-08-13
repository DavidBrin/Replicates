import { P, still, type PoseClip } from "./clip";

export const land: PoseClip = still(
  P({
    torso: 18, head: -16,
    thighR: 134, shinR: 88, footR: -86,
    thighL: 142, shinL: 84, footL: -82,
    upperArmR: 138, forearmR: 40,
    upperArmL: 222, forearmL: -40,
  }),
  { offsetY: -1.5, scaleX: 1.14, scaleY: 0.86 },
);

/** Placeholder: landing lag is the light landing, held for as long as the lag lasts. */
export const landingLag: PoseClip = land;
