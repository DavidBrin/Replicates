import { P, type PoseClip } from "./clip";

export const run: PoseClip = {
  loop: true,
  period: 20,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 18, head: -14,
        thighR: 128, shinR: 40, footR: -70,
        thighL: 224, shinL: 55, footL: -60,
        upperArmR: 228, forearmR: 55,
        upperArmL: 122, forearmL: -60,
      }),
      offsetY: 0.1,
    },
    {
      t: 0.25,
      pose: P({
        torso: 20, head: -15,
        thighR: 168, shinR: 8, footR: -86,
        thighL: 186, shinL: 78, footL: -40,
        upperArmR: 176, forearmR: 20,
        upperArmL: 178, forearmL: -22,
      }),
      offsetY: 0.55,
    },
    {
      t: 0.5,
      pose: P({
        torso: 18, head: -14,
        thighR: 224, shinR: 55, footR: -60,
        thighL: 128, shinL: 40, footL: -70,
        upperArmR: 122, forearmR: 60,
        upperArmL: 228, forearmL: -55,
      }),
      offsetY: 0.1,
    },
    {
      t: 0.75,
      pose: P({
        torso: 20, head: -15,
        thighR: 186, shinR: 78, footR: -40,
        thighL: 168, shinL: 8, footL: -86,
        upperArmR: 178, forearmR: 22,
        upperArmL: 176, forearmL: -20,
      }),
      offsetY: 0.55,
    },
  ],
};
