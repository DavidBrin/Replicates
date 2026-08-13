import { P, type PoseClip } from "./clip";

export const grab: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({ torso: -6, upperArmR: 140, forearmR: -50, upperArmL: 152, forearmL: -46 }),
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 12, head: -8,
        thighR: 154, shinR: 26, footR: -84,
        thighL: 206, shinL: 22, footL: -80,
        upperArmR: 84, forearmR: 4, handR: 0,
        upperArmL: 88, forearmL: 2,
      }),
      offsetX: 0.4,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: 8, head: -4,
        upperArmR: 92, forearmR: -2,
        upperArmL: 96, forearmL: -2,
      }),
      offsetX: 0.2,
    },
    { t: 1, pose: P({ torso: 6, upperArmR: 100, forearmR: -12, upperArmL: 104, forearmL: -10 }) },
  ],
};

export const jab: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({ torso: -8, head: 6, upperArmR: 196, forearmR: 60, upperArmL: 150, forearmL: -30 }),
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 14, head: -8,
        thighR: 158, shinR: 20, footR: -86,
        thighL: 202, shinL: 18, footL: -84,
        upperArmR: 92, forearmR: -2,
        upperArmL: 200, forearmL: -70,
      }),
      offsetX: 0.35,
      scaleX: 1.06,
      ease: "out",
    },
    // The follow-through. Without it the recovery is one long ease from the
    // extension to the rest pose, which over a smash's thirty recovery frames
    // is under a degree a frame and reads as a freeze. The fist stays out
    // while the body unwinds first — which is both what a punch does and what
    // tells the opponent the move is over.
    {
      t: 0.44,
      pose: P({
        torso: 4, head: -2,
        thighR: 152, shinR: 22, footR: -86,
        upperArmR: 98, forearmR: 6,
        upperArmL: 186, forearmL: -56,
      }),
      offsetX: 0.2,
    },
    { t: 1, pose: P({ torso: 2, upperArmR: 150, forearmR: -30, upperArmL: 190, forearmL: -40 }) },
  ],
};

export const ftilt: PoseClip = {
  loop: false,
  strike: 0.32,
  keys: [
    {
      t: 0,
      pose: P({ torso: -12, head: 8, upperArmR: 206, forearmR: 54, upperArmL: 158, forearmL: -20 }),
      ease: "in",
    },
    {
      t: 0.32,
      pose: P({
        torso: 10, head: -6,
        thighR: 146, shinR: 22, footR: -88,
        thighL: 214, shinL: 24, footL: -78,
        upperArmR: 88, forearmR: -6, handR: 0,
        upperArmL: 212, forearmL: -50,
      }),
      offsetX: 0.5,
      scaleX: 1.08,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 2, head: 0,
        thighR: 150, shinR: 24, footR: -86,
        upperArmR: 100, forearmR: 4,
        upperArmL: 200, forearmL: -42,
      }),
      offsetX: 0.28,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 132, forearmR: -24, upperArmL: 196, forearmL: -34 }) },
  ],
};

export const utilt: PoseClip = {
  loop: false,
  strike: 0.32,
  keys: [
    {
      t: 0,
      pose: P({ torso: 12, head: -10, upperArmR: 190, forearmR: 50, upperArmL: 176, forearmL: -40 }),
      ease: "in",
    },
    {
      t: 0.32,
      pose: P({
        torso: -8, head: 10, hip: -2,
        thighR: 162, shinR: 30, footR: -84,
        thighL: 200, shinL: 26, footL: -82,
        upperArmR: 24, forearmR: -10,
        upperArmL: 344, forearmL: 10,
      }),
      offsetY: 0.35,
      scaleY: 1.08,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: -2, head: 6,
        upperArmR: 42, forearmR: -4,
        upperArmL: 328, forearmL: 6,
      }),
      offsetY: 0.14,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 120, forearmR: -30, upperArmL: 236, forearmL: 30 }) },
  ],
};

export const dtilt: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({ torso: 18, head: -14, thighR: 138, shinR: 90, thighL: 146, shinL: 86 }),
      offsetY: -1.5,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 24, head: -18, hip: -6,
        thighR: 118, shinR: -8, footR: -84,
        thighL: 150, shinL: 96, footL: -70,
        upperArmR: 178, forearmR: 44,
        upperArmL: 196, forearmL: -44,
      }),
      offsetY: -1.9,
      offsetX: 0.3,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 22, head: -16,
        thighR: 126, shinR: 22, footR: -84,
        thighL: 148, shinL: 92, footL: -72,
      }),
      offsetY: -1.8,
      offsetX: 0.16,
    },
    { t: 1, pose: P({ torso: 18, thighR: 136, shinR: 92, thighL: 146, shinL: 86 }), offsetY: -1.5 },
  ],
};

export const dashAttack: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({ torso: 24, head: -16, upperArmR: 214, forearmR: 46, upperArmL: 150, forearmL: -40 }),
      offsetX: 0.2,
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: 40, head: -30, hip: -10,
        thighR: 128, shinR: 60, footR: -70,
        thighL: 218, shinL: 40, footL: -66,
        upperArmR: 74, forearmR: -14,
        upperArmL: 78, forearmL: -16,
      }),
      offsetX: 1.1,
      offsetY: -0.6,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 30, head: -20,
        thighR: 136, shinR: 46, footR: -74,
        thighL: 210, shinL: 34, footL: -70,
        upperArmR: 96, forearmR: -6,
        upperArmL: 100, forearmL: -8,
      }),
      offsetX: 0.7,
      offsetY: -0.6,
    },
    { t: 1, pose: P({ torso: 16, upperArmR: 140, forearmR: -28, upperArmL: 200, forearmL: -34 }), offsetY: -0.6 },
  ],
};

// Smashes hold their wind-up: `charge` frames are spent at t≈0.18 so the
// charge glow has a pose to sit behind.
export const fsmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -26, head: 18, hip: 8,
        thighR: 168, shinR: 34, footR: -86,
        thighL: 206, shinL: 30, footL: -76,
        upperArmR: 236, forearmR: 76,
        upperArmL: 142, forearmL: -34,
      }),
      offsetX: -0.5,
      offsetY: -0.4,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 22, head: -14, hip: -4,
        thighR: 136, shinR: 26, footR: -90,
        thighL: 222, shinL: 30, footL: -72,
        upperArmR: 86, forearmR: -4, handR: 0,
        upperArmL: 224, forearmL: -58,
      }),
      offsetX: 1.0,
      offsetY: -0.5,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 12, head: -6, hip: -2,
        thighR: 142, shinR: 26, footR: -88,
        thighL: 214, shinL: 28, footL: -74,
        upperArmR: 98, forearmR: 6,
        upperArmL: 210, forearmL: -46,
      }),
      offsetX: 0.62,
      offsetY: -0.4,
    },
    { t: 1, pose: P({ torso: 8, upperArmR: 126, forearmR: -30, upperArmL: 200, forearmL: -40 }), offsetY: -0.3 },
  ],
};

export const usmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 20, head: -18, hip: -6,
        thighR: 138, shinR: 78, footR: -84,
        thighL: 144, shinL: 74, footL: -82,
        upperArmR: 214, forearmR: 60,
        upperArmL: 220, forearmL: -60,
      }),
      offsetY: -1.4,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: -6, head: 8,
        thighR: 168, shinR: 12, footR: -88,
        thighL: 194, shinL: 12, footL: -86,
        upperArmR: 8, forearmR: -6,
        upperArmL: -8, forearmL: 6,
      }),
      offsetY: 0.5,
      scaleY: 1.16,
      scaleX: 0.92,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 0, head: 4,
        thighR: 164, shinR: 16, footR: -86,
        upperArmR: 30, forearmR: -10,
        upperArmL: 330, forearmL: 10,
      }),
      offsetY: 0.16,
      scaleY: 1.04,
    },
    { t: 1, pose: P({ torso: 6, upperArmR: 110, forearmR: -40, upperArmL: 244, forearmL: 40 }) },
  ],
};

export const dsmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 16, head: -14,
        thighR: 142, shinR: 74, footR: -82,
        thighL: 148, shinL: 70, footL: -80,
        upperArmR: 26, forearmR: 20,
        upperArmL: 334, forearmL: -20,
      }),
      offsetY: -1.2,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 6, head: -4, hip: -4,
        thighR: 124, shinR: 100, footR: -78,
        thighL: 236, shinL: -100, footL: 78,
        upperArmR: 96, forearmR: 62,
        upperArmL: 264, forearmL: -62,
      }),
      offsetY: -2.0,
      scaleX: 1.22,
      scaleY: 0.86,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 10, head: -8,
        thighR: 130, shinR: 88, footR: -80,
        thighL: 224, shinL: -70, footL: 76,
        upperArmR: 80, forearmR: 44,
        upperArmL: 280, forearmL: -44,
      }),
      offsetY: -1.7,
      scaleX: 1.08,
    },
    { t: 1, pose: P({ torso: 12, thighR: 140, shinR: 72, thighL: 150, shinL: 68 }), offsetY: -1.3 },
  ],
};

export const nair: PoseClip = {
  loop: false,
  strike: 0.22,
  keys: [
    { t: 0, pose: P({ torso: 8, thighR: 150, shinR: 50, thighL: 206, shinL: 40 }), ease: "in" },
    {
      t: 0.22,
      pose: P({
        torso: 4, head: -2,
        thighR: 112, shinR: 6, footR: -80,
        thighL: 236, shinL: 14, footL: -70,
        upperArmR: 62, forearmR: 10,
        upperArmL: 288, forearmL: -10,
      }),
      scaleX: 1.18,
      scaleY: 0.94,
      ease: "out",
    },
    {
      t: 0.4,
      pose: P({
        torso: 2,
        thighR: 126, shinR: 18, footR: -78,
        thighL: 224, shinL: 22, footL: -72,
        upperArmR: 84, forearmR: 4,
        upperArmL: 268, forearmL: -4,
      }),
      scaleX: 1.06,
    },
    { t: 1, pose: P({ torso: 2, thighR: 146, shinR: 34, thighL: 210, shinL: 28, upperArmR: 118, upperArmL: 242 }) },
  ],
};

export const fair: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({ torso: -14, head: 10, upperArmR: 330, forearmR: 30, upperArmL: 160, forearmL: -30 }),
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 20, head: -14, hip: -6,
        thighR: 148, shinR: 40, footR: -70,
        thighL: 204, shinL: 36, footL: -72,
        upperArmR: 122, forearmR: -8, handR: 0,
        upperArmL: 200, forearmL: -46,
      }),
      offsetX: 0.4,
      scaleX: 1.1,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 10, head: -6,
        thighR: 150, shinR: 38, footR: -72,
        upperArmR: 148, forearmR: -14,
        upperArmL: 206, forearmL: -38,
      }),
      offsetX: 0.22,
    },
    { t: 1, pose: P({ torso: 6, upperArmR: 146, forearmR: -26, upperArmL: 210, forearmL: -30 }) },
  ],
};

export const bair: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({ torso: 14, head: -12, thighR: 150, shinR: 60, thighL: 158, shinL: 56 }),
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 26, head: -22, hip: 8,
        thighR: 244, shinR: -6, footR: 84,
        thighL: 250, shinL: -8, footL: 86,
        upperArmR: 138, forearmR: -30,
        upperArmL: 146, forearmL: -34,
      }),
      offsetX: -0.5,
      scaleX: 1.16,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 20, head: -16,
        thighR: 226, shinR: 8, footR: 70,
        thighL: 232, shinL: 6, footL: 72,
      }),
      offsetX: -0.24,
      scaleX: 1.05,
    },
    { t: 1, pose: P({ torso: 10, thighR: 196, shinR: 30, thighL: 202, shinL: 26 }) },
  ],
};

export const uair: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({ torso: 12, head: -10, thighR: 154, shinR: 54, thighL: 202, shinL: 50 }),
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: -10, head: 12,
        thighR: 128, shinR: -12, footR: -60,
        thighL: 136, shinL: -14, footL: -58,
        upperArmR: 20, forearmR: -12,
        upperArmL: 340, forearmL: 12,
      }),
      offsetY: 0.4,
      scaleY: 1.18,
      scaleX: 0.92,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: -2, head: 6,
        thighR: 140, shinR: 6, footR: -66,
        thighL: 156, shinL: 4, footL: -64,
      }),
      offsetY: 0.16,
      scaleY: 1.06,
    },
    { t: 1, pose: P({ torso: 0, thighR: 152, shinR: 30, thighL: 200, shinL: 26 }) },
  ],
};

export const dair: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({ torso: -8, head: 8, thighR: 146, shinR: 70, thighL: 200, shinL: 66 }),
      ease: "in",
    },
    {
      t: 0.26,
      pose: P({
        torso: 6, head: -4,
        thighR: 178, shinR: -2, footR: -110,
        thighL: 182, shinL: -2, footL: -108,
        upperArmR: 150, forearmR: -40,
        upperArmL: 210, forearmL: 40,
      }),
      offsetY: -0.5,
      scaleX: 0.86,
      scaleY: 1.2,
      ease: "out",
    },
    {
      t: 0.44,
      pose: P({
        torso: 2,
        thighR: 174, shinR: 8, footR: -96,
        thighL: 186, shinL: 8, footL: -94,
      }),
      offsetY: -0.22,
      scaleY: 1.08,
    },
    { t: 1, pose: P({ torso: 0, thighR: 168, shinR: 20, thighL: 192, shinL: 18 }) },
  ],
};

export const neutralB: PoseClip = {
  loop: false,
  strike: 0.34,
  keys: [
    {
      t: 0,
      pose: P({ torso: -14, head: 10, upperArmR: 200, forearmR: 60, upperArmL: 168, forearmL: -30 }),
      ease: "in",
    },
    {
      t: 0.34,
      pose: P({
        torso: 10, head: -6,
        thighR: 150, shinR: 30, footR: -86,
        thighL: 208, shinL: 26, footL: -80,
        upperArmR: 96, forearmR: -8, handR: 0,
        upperArmL: 104, forearmL: -6,
      }),
      offsetX: 0.3,
      scaleX: 1.06,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: 2, head: 0,
        upperArmR: 104, forearmR: 4,
        upperArmL: 118, forearmL: 2,
      }),
      offsetX: 0.14,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 126, forearmR: -26, upperArmL: 200, forearmL: -30 }) },
  ],
};

export const sideB: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({ torso: -18, head: 12, upperArmR: 222, forearmR: 60, upperArmL: 150, forearmL: -36 }),
      offsetX: -0.3,
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 28, head: -20, hip: -6,
        thighR: 134, shinR: 34, footR: -84,
        thighL: 220, shinL: 30, footL: -74,
        upperArmR: 78, forearmR: -8,
        upperArmL: 226, forearmL: -60,
      }),
      offsetX: 0.9,
      scaleX: 1.14,
      ease: "out",
    },
    {
      t: 0.46,
      pose: P({
        torso: 16, head: -10,
        thighR: 140, shinR: 30, footR: -82,
        upperArmR: 96, forearmR: 2,
        upperArmL: 212, forearmL: -48,
      }),
      offsetX: 0.58,
    },
    { t: 1, pose: P({ torso: 10, upperArmR: 132, forearmR: -28, upperArmL: 202, forearmL: -34 }), offsetX: 0.3 },
  ],
};

export const upB: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({ torso: 16, head: -14, thighR: 140, shinR: 76, thighL: 148, shinL: 72, upperArmR: 210, upperArmL: 224 }),
      offsetY: -1.2,
      ease: "in",
    },
    {
      t: 0.28,
      pose: P({
        torso: -4, head: 6,
        thighR: 164, shinR: 18, footR: -80,
        thighL: 198, shinL: 16, footL: -80,
        upperArmR: 12, forearmR: -4,
        upperArmL: -12, forearmL: 4,
      }),
      offsetY: 0.9,
      scaleX: 0.86,
      scaleY: 1.22,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: 0, head: 4,
        thighR: 160, shinR: 22, footR: -80,
        thighL: 200, shinL: 20, footL: -80,
        upperArmR: 26, forearmR: 4,
        upperArmL: 334, forearmL: -4,
      }),
      offsetY: 0.5,
      scaleY: 1.08,
    },
    { t: 1, pose: P({ torso: 2, upperArmR: 46, forearmR: 20, upperArmL: 314, forearmL: -20 }), offsetY: 0.3 },
  ],
};

export const downB: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({ torso: 6, head: -6, upperArmR: 40, forearmR: 30, upperArmL: 320, forearmL: -30 }),
      ease: "in",
    },
    {
      t: 0.3,
      pose: P({
        torso: 18, head: -14, hip: -6,
        thighR: 138, shinR: 84, footR: -82,
        thighL: 146, shinL: 80, footL: -80,
        upperArmR: 122, forearmR: -66,
        upperArmL: 128, forearmL: -70,
      }),
      offsetY: -1.4,
      scaleX: 1.12,
      scaleY: 0.92,
      ease: "out",
    },
    {
      t: 0.48,
      pose: P({
        torso: 14, head: -10,
        thighR: 142, shinR: 74, footR: -82,
        thighL: 150, shinL: 70, footL: -80,
        upperArmR: 140, forearmR: -40,
        upperArmL: 218, forearmL: -44,
      }),
      offsetY: -1.2,
    },
    { t: 1, pose: P({ torso: 10, thighR: 148, shinR: 60, thighL: 154, shinL: 56 }), offsetY: -0.9 },
  ],
};

export const fthrow: PoseClip = {
  loop: false,
  strike: 0.35,
  keys: [
    { ease: "in", t: 0, pose: P({ torso: -16, upperArmR: 130, forearmR: -50, upperArmL: 138, forearmL: -46 }) },
    {
      ease: "out",
      t: 0.35,
      pose: P({
        torso: 24, head: -16,
        thighR: 142, shinR: 26, footR: -86,
        thighL: 214, shinL: 24, footL: -78,
        upperArmR: 82, forearmR: -4,
        upperArmL: 86, forearmL: -4,
      }),
      offsetX: 0.6,
    },
    {
      t: 0.52,
      pose: P({
        torso: 14, head: -8,
        thighR: 146, shinR: 24, footR: -86,
        upperArmR: 96, forearmR: 2,
        upperArmL: 100, forearmL: 2,
      }),
      offsetX: 0.34,
    },
    { t: 1, pose: P({ torso: 8, upperArmR: 118, forearmR: -30, upperArmL: 124, forearmL: -28 }) },
  ],
};

export const bthrow: PoseClip = {
  loop: false,
  strike: 0.4,
  keys: [
    { ease: "in", t: 0, pose: P({ torso: 14, upperArmR: 108, forearmR: -40, upperArmL: 114, forearmL: -38 }) },
    {
      ease: "out",
      t: 0.4,
      pose: P({
        torso: -30, head: 22, hip: 10,
        thighR: 170, shinR: 20, footR: -84,
        thighL: 198, shinL: 18, footL: -82,
        upperArmR: 254, forearmR: 40,
        upperArmL: 260, forearmL: 38,
      }),
      offsetX: -0.7,
    },
    {
      t: 0.58,
      pose: P({
        torso: -18, head: 14,
        thighR: 168, shinR: 18, footR: -84,
        upperArmR: 238, forearmR: 30,
        upperArmL: 244, forearmL: 28,
      }),
      offsetX: -0.4,
    },
    { t: 1, pose: P({ torso: -6, upperArmR: 214, forearmR: 20, upperArmL: 220, forearmL: 18 }) },
  ],
};

export const uthrow: PoseClip = {
  loop: false,
  strike: 0.35,
  keys: [
    { ease: "in", t: 0, pose: P({ torso: 12, head: -10, upperArmR: 116, forearmR: -50, upperArmL: 122, forearmL: -48 }), offsetY: -0.6 },
    {
      ease: "out",
      t: 0.35,
      pose: P({
        torso: -8, head: 10,
        thighR: 166, shinR: 14, footR: -86,
        thighL: 196, shinL: 12, footL: -84,
        upperArmR: 10, forearmR: -8,
        upperArmL: -10, forearmL: 8,
      }),
      offsetY: 0.6,
      scaleY: 1.1,
    },
    {
      t: 0.52,
      pose: P({
        torso: -2, head: 6,
        upperArmR: 26, forearmR: -4,
        upperArmL: 334, forearmL: 4,
      }),
      offsetY: 0.3,
      scaleY: 1.04,
    },
    { t: 1, pose: P({ torso: 2, upperArmR: 60, forearmR: 20, upperArmL: 300, forearmL: -20 }) },
  ],
};

export const dthrow: PoseClip = {
  loop: false,
  strike: 0.35,
  keys: [
    { ease: "in", t: 0, pose: P({ torso: -10, upperArmR: 122, forearmR: -46, upperArmL: 128, forearmL: -44 }) },
    {
      ease: "out",
      t: 0.35,
      pose: P({
        torso: 30, head: -24, hip: -8,
        thighR: 134, shinR: 88, footR: -80,
        thighL: 142, shinL: 84, footL: -78,
        upperArmR: 158, forearmR: -20,
        upperArmL: 164, forearmL: -18,
      }),
      offsetY: -1.7,
      scaleX: 1.08,
    },
    {
      t: 0.52,
      pose: P({
        torso: 22, head: -16,
        thighR: 138, shinR: 80, footR: -80,
        thighL: 146, shinL: 76, footL: -78,
        upperArmR: 170, forearmR: -10,
        upperArmL: 176, forearmL: -8,
      }),
      offsetY: -1.4,
    },
    { t: 1, pose: P({ torso: 14, thighR: 146, shinR: 62, thighL: 152, shinL: 58 }), offsetY: -1.0 },
  ],
};
