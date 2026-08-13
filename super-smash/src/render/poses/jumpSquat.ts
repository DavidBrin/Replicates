import { P, still, type PoseClip } from "./clip";

// Three frames, universally (SPEC §4) — so this is one key and it has to be
// legible in a single frame at 60Hz. Deep, arms swept back, weight down.
export const jumpSquat: PoseClip = still(
  P({
    torso: 14, head: -12,
    thighR: 142, shinR: 70, footR: -80,
    thighL: 146, shinL: 68, footL: -78,
    upperArmR: 226, forearmR: 44,
    upperArmL: 232, forearmL: -44,
  }),
  { offsetY: -1.2, scaleX: 1.08, scaleY: 0.9 },
);
