import { P, type PoseClip } from "./clip";

/**
 * Roll — 31 frames, intangible on 4-20 (`ROLL_FRAMES`, `ROLL_INTANGIBLE`).
 *
 * One full revolution across the roll, declared as `spin` rather than as a
 * rotation key: angles interpolate the short way round, so a key at 0 and a key
 * at 360° are the same key and the body never turns.
 */
export const roll: PoseClip = {
  loop: false,
  spin: 1,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 40, head: -36, hip: -14,
        thighR: 108, shinR: 118, footR: -70,
        thighL: 112, shinL: 116, footL: -70,
        upperArmR: 92, forearmR: -108,
        upperArmL: 96, forearmL: -110,
      }),
      offsetY: -2.0,
      scaleX: 0.9,
      scaleY: 0.9,
    },
  ],
};
