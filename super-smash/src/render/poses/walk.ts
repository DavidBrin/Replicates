import { P, type PoseClip } from "./clip";

// Four keys: contact, pass, contact-mirrored, pass. The canonical walk.
export const walk: PoseClip = {
  loop: true,
  period: 32,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 5,
        head: -4,
        thighR: 152, shinR: 10, footR: -84,
        thighL: 206, shinL: 20, footL: -96,
        upperArmR: 200, forearmR: 18,
        upperArmL: 158, forearmL: -22,
      }),
      offsetY: 0,
    },
    {
      t: 0.25,
      pose: P({
        torso: 6,
        head: -5,
        thighR: 178, shinR: 4, footR: -88,
        thighL: 180, shinL: 30, footL: -70,
        upperArmR: 182, forearmR: 10,
        upperArmL: 176, forearmL: -12,
      }),
      offsetY: 0.28,
    },
    {
      t: 0.5,
      pose: P({
        torso: 5,
        head: -4,
        thighR: 206, shinR: 20, footR: -96,
        thighL: 152, shinL: 10, footL: -84,
        upperArmR: 158, forearmR: 22,
        upperArmL: 200, forearmL: -18,
      }),
      offsetY: 0,
    },
    {
      t: 0.75,
      pose: P({
        torso: 6,
        head: -5,
        thighR: 180, shinR: 30, footR: -70,
        thighL: 178, shinL: 4, footL: -88,
        upperArmR: 176, forearmR: 12,
        upperArmL: 182, forearmL: -10,
      }),
      offsetY: 0.28,
    },
  ],
};
