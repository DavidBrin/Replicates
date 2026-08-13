import { P, still, type PoseClip } from "./clip";

export const turn: PoseClip = still(
  P({ torso: -8, head: 10, upperArmR: 210, forearmR: 30, upperArmL: 150, forearmL: -30 }),
  { offsetY: -0.25, scaleX: 0.82 },
);
