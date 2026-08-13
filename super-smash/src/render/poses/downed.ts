import { P, still, type PoseClip } from "./clip";
import { deg } from "../skeleton";

// Face-up on the ground. The 90° rotation is what sells it; the pose only has
// to stop the limbs from clipping through the floor.
export const downed: PoseClip = still(
  P({
    torso: -6, head: 12, hip: 4,
    thighR: 158, shinR: 26, footR: -70,
    thighL: 200, shinL: 22, footL: -70,
    upperArmR: 130, forearmR: -20,
    upperArmL: 230, forearmL: 20,
  }),
  { rotation: deg(-84), offsetY: -3.0 },
);

/** Placeholder: getting up off the floor is lying on the floor. */
export const getUp: PoseClip = downed;
