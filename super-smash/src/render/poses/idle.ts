import { P, type PoseClip } from "./clip";

// Two keys and a slow loop: the breathing bob. A fighter that is perfectly
// still reads as a paused game.
export const idle: PoseClip = {
  loop: true,
  period: 108,
  keys: [
    {
      t: 0,
      pose: P({ torso: 3, head: -3, upperArmL: 193, forearmL: -16, upperArmR: 167, forearmR: 16 }),
      offsetY: 0,
    },
    {
      t: 0.5,
      pose: P({ torso: 5, head: -5, upperArmL: 197, forearmL: -20, upperArmR: 163, forearmR: 20 }),
      offsetY: 0.16,
      scaleY: 1.015,
    },
  ],
};
