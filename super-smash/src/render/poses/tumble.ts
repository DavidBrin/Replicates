import { P, type PoseClip } from "./clip";

export const tumble: PoseClip = {
  loop: true,
  period: 26,
  // Backwards, and exactly one turn per cycle so the loop does not pop.
  spin: -1,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -10, head: 14,
        thighR: 148, shinR: 30, footR: -60,
        thighL: 212, shinL: 34, footL: -60,
        upperArmR: 62, forearmR: 26,
        upperArmL: 296, forearmL: -26,
      }),
    },
    {
      t: 0.5,
      pose: P({
        torso: 12, head: -10,
        thighR: 212, shinR: 34, footR: -60,
        thighL: 148, shinL: 30, footL: -60,
        upperArmR: 296, forearmR: -26,
        upperArmL: 62, forearmL: 26,
      }),
    },
  ],
};
