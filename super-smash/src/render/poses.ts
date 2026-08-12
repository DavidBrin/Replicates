/**
 * The shared pose library.
 *
 * Every fighter reuses every pose in this file. That is the decision the whole
 * procedural-art approach rests on: eight fighters × forty poses hand-authored
 * per character is three hundred and twenty animations nobody is going to
 * write, whereas forty poses shared across eight *rigs* is forty. Per-fighter
 * identity comes from bone-length scaling, props and palette (see
 * `characterArt.ts`) — Donkey Kong's forward smash is Mario's forward smash
 * played on a rig with a torso twice as wide and arms half again as long, and
 * it reads as Donkey Kong's because of the arms, not because of the keyframes.
 *
 * Poses are authored in **degrees** and stored in radians. Angles follow
 * `skeleton.ts`: parent-relative, zero along the parent, clockwise positive
 * with the fighter facing right. So for a leg, 180° hangs straight down, 150°
 * swings it forward, 210° swings it back; for an arm, 90° points straight
 * forward and 0° straight up.
 *
 * Clips interpolate with **shortest-path angle lerp under a smoothstep ease**.
 * Linear lerp between 350° and 10° walks the long way round the circle and
 * spins a limb through a full turn on a two-frame transition; smoothstep
 * removes the velocity discontinuity at each keyframe, which is what makes
 * three keys per attack look like anticipation rather than like three
 * photographs.
 */

import type { ActionState, FighterState, MoveSlot } from "@/engine/types";
import { deg, type BoneName, type PoseAngles } from "./skeleton";

/* ----------------------------------------------------------- interpolation -- */

/** Signed shortest difference from `a` to `b`, in `(-π, π]`. */
export function angleDelta(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Interpolate between two angles the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** Hermite ease, `3t² − 2t³`. Zero velocity at both ends. */
export function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ clips -- */

export interface Keyframe {
  /** Normalised position in the clip, 0..1. Keys must be sorted. */
  readonly t: number;
  readonly pose: PoseAngles;
  /** Whole-body translation in rig units. +x is forward, +y is up. */
  readonly offsetX?: number;
  readonly offsetY?: number;
  /** Whole-body rotation about the pelvis, radians. */
  readonly rotation?: number;
  /** Squash and stretch for this key. Default 1. */
  readonly scaleX?: number;
  readonly scaleY?: number;
}

export interface PoseClip {
  readonly keys: readonly Keyframe[];
  readonly loop: boolean;
}

export interface PoseSample {
  readonly angles: PoseAngles;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Author-time helper: a pose written in degrees. */
function P(a: Partial<Record<BoneName, number>>): PoseAngles {
  const out: PoseAngles = {};
  for (const key of Object.keys(a) as BoneName[]) {
    const v = a[key];
    if (v !== undefined) out[key] = deg(v);
  }
  return out;
}

/** Author-time helper: a single-key clip. */
function still(pose: PoseAngles, extra: Omit<Keyframe, "t" | "pose"> = {}): PoseClip {
  return { keys: [{ t: 0, pose, ...extra }], loop: false };
}

/**
 * Sample a clip at normalised time `t`.
 *
 * Bones absent from a keyframe fall back to the rig's rest angle, which
 * `resolve()` supplies — so a pose only has to name the bones it actually
 * moves, and the library stays readable.
 */
export function samplePose(clip: PoseClip, t: number): PoseSample {
  const keys = clip.keys;
  if (keys.length === 0) {
    return { angles: {}, offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  }
  if (keys.length === 1) return sampleOne(keys[0]);

  let u = clip.loop ? t - Math.floor(t) : t < 0 ? 0 : t > 1 ? 1 : t;
  if (Number.isNaN(u)) u = 0;

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= u) i++;

  const a = keys[i];
  const b = clip.loop && i === keys.length - 1 ? keys[0] : keys[Math.min(i + 1, keys.length - 1)];
  const spanEnd = clip.loop && i === keys.length - 1 ? 1 : b.t;
  const span = spanEnd - a.t;
  const local = span <= 0 ? 0 : smoothstep((u - a.t) / span);

  return blendKeys(a, b, local);
}

function sampleOne(k: Keyframe): PoseSample {
  return {
    angles: { ...k.pose },
    offsetX: k.offsetX ?? 0,
    offsetY: k.offsetY ?? 0,
    rotation: k.rotation ?? 0,
    scaleX: k.scaleX ?? 1,
    scaleY: k.scaleY ?? 1,
  };
}

function blendKeys(a: Keyframe, b: Keyframe, t: number): PoseSample {
  const angles: PoseAngles = {};
  const names = new Set<BoneName>([
    ...(Object.keys(a.pose) as BoneName[]),
    ...(Object.keys(b.pose) as BoneName[]),
  ]);
  for (const name of names) {
    const from = a.pose[name];
    const to = b.pose[name];
    // A bone named in one key but not the other holds the value it has rather
    // than snapping to the rest angle mid-clip.
    if (from === undefined) angles[name] = to as number;
    else if (to === undefined) angles[name] = from;
    else angles[name] = lerpAngle(from, to, t);
  }
  return {
    angles,
    offsetX: lerp(a.offsetX ?? 0, b.offsetX ?? 0, t),
    offsetY: lerp(a.offsetY ?? 0, b.offsetY ?? 0, t),
    rotation: lerpAngle(a.rotation ?? 0, b.rotation ?? 0, t),
    scaleX: lerp(a.scaleX ?? 1, b.scaleX ?? 1, t),
    scaleY: lerp(a.scaleY ?? 1, b.scaleY ?? 1, t),
  };
}

/** Blend two already-sampled poses — used to ease between clips. */
export function blendSamples(a: PoseSample, b: PoseSample, t: number): PoseSample {
  const angles: PoseAngles = {};
  const names = new Set<BoneName>([
    ...(Object.keys(a.angles) as BoneName[]),
    ...(Object.keys(b.angles) as BoneName[]),
  ]);
  for (const name of names) {
    const from = a.angles[name];
    const to = b.angles[name];
    if (from === undefined) angles[name] = to as number;
    else if (to === undefined) angles[name] = from;
    else angles[name] = lerpAngle(from, to, t);
  }
  return {
    angles,
    offsetX: lerp(a.offsetX, b.offsetX, t),
    offsetY: lerp(a.offsetY, b.offsetY, t),
    rotation: lerpAngle(a.rotation, b.rotation, t),
    scaleX: lerp(a.scaleX, b.scaleX, t),
    scaleY: lerp(a.scaleY, b.scaleY, t),
  };
}

/* ------------------------------------------------------------- the library -- */

export type PoseName =
  // locomotion and neutral
  | "idle"
  | "walk"
  | "dash"
  | "run"
  | "brake"
  | "turn"
  | "crouch"
  | "jumpSquat"
  | "rise"
  | "fall"
  | "land"
  // defence
  | "shield"
  | "shieldBroken"
  | "roll"
  | "spotDodge"
  | "airDodge"
  // reeling
  | "hitstun"
  | "tumble"
  | "downed"
  | "grabbed"
  | "ledgeHang"
  // offence
  | "grab"
  | "jab"
  | "ftilt"
  | "utilt"
  | "dtilt"
  | "dashAttack"
  | "fsmash"
  | "usmash"
  | "dsmash"
  | "nair"
  | "fair"
  | "bair"
  | "uair"
  | "dair"
  | "neutralB"
  | "sideB"
  | "upB"
  | "downB"
  | "fthrow"
  | "bthrow"
  | "uthrow"
  | "dthrow";

/**
 * Every attack is three keys — wind-up, strike, recovery.
 *
 * Two keys would be enough to get the hitbox-frame silhouette on screen, and it
 * would look terrible: an attack that starts at its extension has no
 * anticipation, and the eye reads it as a teleport. The wind-up key is the one
 * that sells the hit, and it costs one line.
 */
export const POSE_LIBRARY: Record<PoseName, PoseClip> = {
  /* --------------------------------------------------------- locomotion -- */

  // Two keys and a slow loop: the breathing bob. A fighter that is perfectly
  // still reads as a paused game.
  idle: {
    loop: true,
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
  },

  // Four keys: contact, pass, contact-mirrored, pass. The canonical walk.
  walk: {
    loop: true,
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
  },

  // The initial dash: everything already thrown forward, weight ahead of the feet.
  dash: still(
    P({
      torso: 22,
      head: -16,
      hip: -6,
      thighR: 138, shinR: 26, footR: -80,
      thighL: 216, shinL: 40, footL: -60,
      upperArmR: 220, forearmR: 40,
      upperArmL: 130, forearmL: -50,
    }),
    { offsetX: 0.5, offsetY: -0.2 },
  ),

  run: {
    loop: true,
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
  },

  // Skidding: heels dug in, torso leaning back against the momentum.
  brake: still(
    P({
      torso: -16, head: 12, hip: 8,
      thighR: 158, shinR: 22, footR: -108,
      thighL: 198, shinL: 30, footL: -78,
      upperArmR: 130, forearmR: -30,
      upperArmL: 226, forearmL: 30,
    }),
    { offsetY: -0.5 },
  ),

  turn: still(
    P({ torso: -8, head: 10, upperArmR: 210, forearmR: 30, upperArmL: 150, forearmL: -30 }),
    { offsetY: -0.25, scaleX: 0.82 },
  ),

  crouch: still(
    P({
      torso: 16, head: -14, hip: -4,
      thighR: 132, shinR: 96, footR: -84,
      thighL: 140, shinL: 92, footL: -80,
      upperArmR: 150, forearmR: 62,
      upperArmL: 210, forearmL: -62,
    }),
    { offsetY: -1.55, scaleY: 0.94 },
  ),

  // Three frames, universally (SPEC §4) — so this is one key and it has to be
  // legible in a single frame at 60Hz. Deep, arms swept back, weight down.
  jumpSquat: still(
    P({
      torso: 14, head: -12,
      thighR: 142, shinR: 70, footR: -80,
      thighL: 146, shinL: 68, footL: -78,
      upperArmR: 226, forearmR: 44,
      upperArmL: 232, forearmL: -44,
    }),
    { offsetY: -1.2, scaleX: 1.08, scaleY: 0.9 },
  ),

  rise: still(
    P({
      torso: 4, head: -2,
      thighR: 162, shinR: 24, footR: -70,
      thighL: 190, shinL: 16, footL: -84,
      upperArmR: 40, forearmR: 22,
      upperArmL: 320, forearmL: -22,
    }),
    { offsetY: 0.3, scaleX: 0.94, scaleY: 1.08 },
  ),

  fall: still(
    P({
      torso: -3, head: 4,
      thighR: 158, shinR: 34, footR: -76,
      thighL: 200, shinL: 26, footL: -84,
      upperArmR: 118, forearmR: -28,
      upperArmL: 242, forearmL: 28,
    }),
    { offsetY: 0.1 },
  ),

  land: still(
    P({
      torso: 18, head: -16,
      thighR: 134, shinR: 88, footR: -86,
      thighL: 142, shinL: 84, footL: -82,
      upperArmR: 138, forearmR: 40,
      upperArmL: 222, forearmL: -40,
    }),
    { offsetY: -1.5, scaleX: 1.14, scaleY: 0.86 },
  ),

  /* ------------------------------------------------------------ defence -- */

  shield: still(
    P({
      torso: 8, head: -8,
      thighR: 156, shinR: 44, footR: -84,
      thighL: 202, shinL: 40, footL: -80,
      upperArmR: 108, forearmR: -68,
      upperArmL: 116, forearmL: -74,
    }),
    { offsetY: -0.7 },
  ),

  shieldBroken: still(
    P({
      torso: -14, head: 20, hip: 6,
      thighR: 168, shinR: 12, footR: -92,
      thighL: 192, shinL: 12, footL: -88,
      upperArmR: 148, forearmR: -34,
      upperArmL: 212, forearmL: 34,
    }),
    { offsetY: -0.2 },
  ),

  // A ball. Rotation is applied on top by the caller, once per roll frame.
  roll: still(
    P({
      torso: 40, head: -36, hip: -14,
      thighR: 108, shinR: 118, footR: -70,
      thighL: 112, shinL: 116, footL: -70,
      upperArmR: 92, forearmR: -108,
      upperArmL: 96, forearmL: -110,
    }),
    { offsetY: -2.0, scaleX: 0.9, scaleY: 0.9 },
  ),

  spotDodge: still(
    P({
      torso: 24, head: -22, hip: -8,
      thighR: 126, shinR: 104, footR: -80,
      thighL: 132, shinL: 100, footL: -78,
      upperArmR: 120, forearmR: -80,
      upperArmL: 124, forearmL: -84,
    }),
    { offsetY: -1.9, scaleX: 0.78, scaleY: 0.92 },
  ),

  airDodge: still(
    P({
      torso: 30, head: -26, hip: -10,
      thighR: 118, shinR: 106, footR: -74,
      thighL: 124, shinL: 102, footL: -72,
      upperArmR: 104, forearmR: -96,
      upperArmL: 108, forearmL: -98,
    }),
    { offsetY: -1.2, scaleX: 0.86, scaleY: 0.9 },
  ),

  /* ------------------------------------------------------------ reeling -- */

  hitstun: still(
    P({
      torso: -26, head: 28, hip: 10,
      thighR: 166, shinR: 16, footR: -70,
      thighL: 196, shinL: 22, footL: -66,
      upperArmR: 46, forearmR: 34,
      upperArmL: 306, forearmL: -34,
    }),
    { offsetX: -0.4, offsetY: 0.2, scaleX: 0.95, scaleY: 1.05 },
  ),

  tumble: {
    loop: true,
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
  },

  // Face-up on the ground. The 90° rotation is what sells it; the pose only has
  // to stop the limbs from clipping through the floor.
  downed: still(
    P({
      torso: -6, head: 12, hip: 4,
      thighR: 158, shinR: 26, footR: -70,
      thighL: 200, shinL: 22, footL: -70,
      upperArmR: 130, forearmR: -20,
      upperArmL: 230, forearmL: 20,
    }),
    { rotation: deg(-84), offsetY: -3.0 },
  ),

  grabbed: still(
    P({
      torso: -14, head: 16,
      thighR: 164, shinR: 26, footR: -78,
      thighL: 198, shinL: 22, footL: -80,
      upperArmR: 34, forearmR: 30,
      upperArmL: 318, forearmL: -30,
    }),
    { offsetY: 0.4 },
  ),

  // Hanging by both hands from a ledge above and in front.
  ledgeHang: still(
    P({
      torso: -4, head: 6,
      thighR: 168, shinR: 40, footR: -60,
      thighL: 194, shinL: 34, footL: -64,
      upperArmR: 6, forearmR: 4,
      upperArmL: -6, forearmL: -4,
    }),
    { offsetY: 0.6, offsetX: -0.3 },
  ),

  /* ------------------------------------------------------------ offence -- */

  grab: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -6, upperArmR: 140, forearmR: -50, upperArmL: 152, forearmL: -46 }) },
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
      },
      { t: 1, pose: P({ torso: 6, upperArmR: 100, forearmR: -12, upperArmL: 104, forearmL: -10 }) },
    ],
  },

  jab: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -8, head: 6, upperArmR: 196, forearmR: 60, upperArmL: 150, forearmL: -30 }) },
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
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 150, forearmR: -30, upperArmL: 190, forearmL: -40 }) },
    ],
  },

  ftilt: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -12, head: 8, upperArmR: 206, forearmR: 54, upperArmL: 158, forearmL: -20 }) },
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
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 132, forearmR: -24, upperArmL: 196, forearmL: -34 }) },
    ],
  },

  utilt: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 12, head: -10, upperArmR: 190, forearmR: 50, upperArmL: 176, forearmL: -40 }) },
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
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 120, forearmR: -30, upperArmL: 236, forearmL: 30 }) },
    ],
  },

  dtilt: {
    loop: false,
    keys: [
      {
        t: 0,
        pose: P({ torso: 18, head: -14, thighR: 138, shinR: 90, thighL: 146, shinL: 86 }),
        offsetY: -1.5,
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
      },
      { t: 1, pose: P({ torso: 18, thighR: 136, shinR: 92, thighL: 146, shinL: 86 }), offsetY: -1.5 },
    ],
  },

  dashAttack: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 24, head: -16, upperArmR: 214, forearmR: 46, upperArmL: 150, forearmL: -40 }), offsetX: 0.2 },
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
        scaleX: 1.1,
      },
      { t: 1, pose: P({ torso: 16, upperArmR: 140, forearmR: -28, upperArmL: 200, forearmL: -34 }), offsetY: -0.6 },
    ],
  },

  // Smashes hold their wind-up: `charge` frames are spent at t≈0.18 so the
  // charge glow has a pose to sit behind.
  fsmash: {
    loop: false,
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
        scaleX: 1.08,
      },
      { t: 1, pose: P({ torso: 8, upperArmR: 126, forearmR: -30, upperArmL: 200, forearmL: -40 }), offsetY: -0.3 },
    ],
  },

  usmash: {
    loop: false,
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
        scaleY: 1.1,
      },
      { t: 1, pose: P({ torso: 6, upperArmR: 110, forearmR: -40, upperArmL: 244, forearmL: 40 }) },
    ],
  },

  dsmash: {
    loop: false,
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
        scaleX: 1.16,
        scaleY: 0.9,
      },
      { t: 1, pose: P({ torso: 12, thighR: 140, shinR: 72, thighL: 150, shinL: 68 }), offsetY: -1.3 },
    ],
  },

  /* -------------------------------------------------------------- aerials -- */

  nair: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 8, thighR: 150, shinR: 50, thighL: 206, shinL: 40 }) },
      {
        t: 0.22,
        pose: P({
          torso: 4, head: -2,
          thighR: 112, shinR: 6, footR: -80,
          thighL: 236, shinL: 14, footL: -70,
          upperArmR: 62, forearmR: 10,
          upperArmL: 288, forearmL: -10,
        }),
        scaleX: 1.12,
      },
      { t: 1, pose: P({ torso: 2, thighR: 146, shinR: 34, thighL: 210, shinL: 28, upperArmR: 118, upperArmL: 242 }) },
    ],
  },

  fair: {
    loop: false,
    keys: [
      {
        t: 0,
        pose: P({ torso: -14, head: 10, upperArmR: 330, forearmR: 30, upperArmL: 160, forearmL: -30 }),
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
      },
      { t: 1, pose: P({ torso: 6, upperArmR: 146, forearmR: -26, upperArmL: 210, forearmL: -30 }) },
    ],
  },

  bair: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 14, head: -12, thighR: 150, shinR: 60, thighL: 158, shinL: 56 }) },
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
        scaleX: 1.1,
      },
      { t: 1, pose: P({ torso: 10, thighR: 196, shinR: 30, thighL: 202, shinL: 26 }) },
    ],
  },

  uair: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 12, head: -10, thighR: 154, shinR: 54, thighL: 202, shinL: 50 }) },
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
        scaleY: 1.12,
      },
      { t: 1, pose: P({ torso: 0, thighR: 152, shinR: 30, thighL: 200, shinL: 26 }) },
    ],
  },

  dair: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -8, head: 8, thighR: 146, shinR: 70, thighL: 200, shinL: 66 }) },
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
        scaleX: 0.9,
        scaleY: 1.14,
      },
      { t: 1, pose: P({ torso: 0, thighR: 168, shinR: 20, thighL: 192, shinL: 18 }) },
    ],
  },

  /* -------------------------------------------------------------- specials -- */

  neutralB: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -14, head: 10, upperArmR: 200, forearmR: 60, upperArmL: 168, forearmL: -30 }) },
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
      },
      { t: 1, pose: P({ torso: 4, upperArmR: 126, forearmR: -26, upperArmL: 200, forearmL: -30 }) },
    ],
  },

  sideB: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -18, head: 12, upperArmR: 222, forearmR: 60, upperArmL: 150, forearmL: -36 }), offsetX: -0.3 },
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
        scaleX: 1.08,
      },
      { t: 1, pose: P({ torso: 10, upperArmR: 132, forearmR: -28, upperArmL: 202, forearmL: -34 }), offsetX: 0.3 },
    ],
  },

  upB: {
    loop: false,
    keys: [
      {
        t: 0,
        pose: P({ torso: 16, head: -14, thighR: 140, shinR: 76, thighL: 148, shinL: 72, upperArmR: 210, upperArmL: 224 }),
        offsetY: -1.2,
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
        scaleX: 0.9,
        scaleY: 1.16,
      },
      { t: 1, pose: P({ torso: 2, upperArmR: 46, forearmR: 20, upperArmL: 314, forearmL: -20 }), offsetY: 0.3 },
    ],
  },

  downB: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 6, head: -6, upperArmR: 40, forearmR: 30, upperArmL: 320, forearmL: -30 }) },
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
        scaleX: 1.06,
      },
      { t: 1, pose: P({ torso: 10, thighR: 148, shinR: 60, thighL: 154, shinL: 56 }), offsetY: -0.9 },
    ],
  },

  /* ---------------------------------------------------------------- throws -- */

  fthrow: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -16, upperArmR: 130, forearmR: -50, upperArmL: 138, forearmL: -46 }) },
      {
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
      { t: 1, pose: P({ torso: 8, upperArmR: 118, forearmR: -30, upperArmL: 124, forearmL: -28 }) },
    ],
  },

  bthrow: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 14, upperArmR: 108, forearmR: -40, upperArmL: 114, forearmL: -38 }) },
      {
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
      { t: 1, pose: P({ torso: -6, upperArmR: 214, forearmR: 20, upperArmL: 220, forearmL: 18 }) },
    ],
  },

  uthrow: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: 12, head: -10, upperArmR: 116, forearmR: -50, upperArmL: 122, forearmL: -48 }), offsetY: -0.6 },
      {
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
      { t: 1, pose: P({ torso: 2, upperArmR: 60, forearmR: 20, upperArmL: 300, forearmL: -20 }) },
    ],
  },

  dthrow: {
    loop: false,
    keys: [
      { t: 0, pose: P({ torso: -10, upperArmR: 122, forearmR: -46, upperArmL: 128, forearmL: -44 }) },
      {
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
      { t: 1, pose: P({ torso: 14, thighR: 146, shinR: 62, thighL: 152, shinL: 58 }), offsetY: -1.0 },
    ],
  },
};

/* ---------------------------------------------------- state -> pose mapping -- */

const SLOT_POSE: Record<MoveSlot, PoseName> = {
  jab1: "jab",
  jab2: "jab",
  jab3: "jab",
  rapidJab: "jab",
  ftilt: "ftilt",
  utilt: "utilt",
  dtilt: "dtilt",
  dashAttack: "dashAttack",
  fsmash: "fsmash",
  usmash: "usmash",
  dsmash: "dsmash",
  nair: "nair",
  fair: "fair",
  bair: "bair",
  uair: "uair",
  dair: "dair",
  neutralB: "neutralB",
  sideB: "sideB",
  upB: "upB",
  downB: "downB",
  grab: "grab",
  dashGrab: "grab",
  pummel: "grab",
  fthrow: "fthrow",
  bthrow: "bthrow",
  uthrow: "uthrow",
  dthrow: "dthrow",
  ledgeAttack: "ftilt",
  getUpAttack: "dsmash",
  finalSmash: "neutralB",
};

/** Frames one full cycle of each looping locomotion clip takes. */
const WALK_PERIOD = 32;
const RUN_PERIOD = 20;
const IDLE_PERIOD = 108;
const TUMBLE_PERIOD = 26;

export function poseNameFor(action: ActionState, move: MoveSlot | null): PoseName {
  switch (action) {
    case "stand":
    case "entering":
    case "respawnPlatform":
      return "idle";
    case "walk":
      return "walk";
    case "dashStart":
      return "dash";
    case "run":
      return "run";
    case "runBrake":
      return "brake";
    case "turnaround":
      return "turn";
    case "crouchStart":
    case "crouch":
    case "crouchEnd":
    case "getUp":
      return "crouch";
    case "jumpSquat":
      return "jumpSquat";
    case "jump":
      return "rise";
    case "fall":
    case "dead":
      return "fall";
    case "land":
    case "landingLag":
      return "land";
    case "attack":
    case "special":
    case "throw":
      return move ? SLOT_POSE[move] : "jab";
    case "grab":
    case "grabHold":
    case "pummel":
      return "grab";
    case "shieldStart":
    case "shield":
    case "shieldStun":
    case "shieldRelease":
      return "shield";
    case "shieldBroken":
      return "shieldBroken";
    case "spotDodge":
      return "spotDodge";
    case "roll":
    case "ledgeRoll":
      return "roll";
    case "airDodge":
      return "airDodge";
    case "hitstun":
      return "hitstun";
    case "tumble":
      return "tumble";
    case "grabbed":
    case "thrown":
      return "grabbed";
    case "downed":
      return "downed";
    case "ledgeHang":
      return "ledgeHang";
    case "ledgeGetUp":
    case "ledgeJump":
      return "rise";
    case "ledgeAttack":
      return "ftilt";
    default:
      return "idle";
  }
}

/**
 * Normalised clip time for a fighter.
 *
 * Looping clips are driven by the *global* frame for idle (so four fighters do
 * not breathe in lockstep once their `actionFrame`s coincide) and by
 * `actionFrame` for locomotion (so a walk starts on its contact key). Attacks
 * are driven by `actionFrame / totalFrames`, which means the pose is
 * automatically in time with the move's real frame data rather than with a
 * guess — a 60-frame forward smash and a 12-frame jab both hit their strike key
 * at 30% of their own duration.
 */
export function poseTimeFor(
  name: PoseName,
  fighter: Pick<FighterState, "actionFrame" | "port" | "charge">,
  frame: number,
  moveTotalFrames?: number,
): number {
  switch (name) {
    case "idle":
      return ((frame + fighter.port * 27) % IDLE_PERIOD) / IDLE_PERIOD;
    case "walk":
      return (fighter.actionFrame % WALK_PERIOD) / WALK_PERIOD;
    case "run":
      return (fighter.actionFrame % RUN_PERIOD) / RUN_PERIOD;
    case "tumble":
      return (fighter.actionFrame % TUMBLE_PERIOD) / TUMBLE_PERIOD;
    default: {
      const total = moveTotalFrames && moveTotalFrames > 0 ? moveTotalFrames : 30;
      // A charging smash parks on its wind-up key instead of running the clip.
      if (fighter.charge > 0 && (name === "fsmash" || name === "usmash" || name === "dsmash")) {
        return 0.16;
      }
      return Math.min(1, fighter.actionFrame / total);
    }
  }
}

/** The pose a fighter is in this frame, ready to hand to `resolve()`. */
export function samplePoseForFighter(
  fighter: Pick<FighterState, "action" | "actionFrame" | "move" | "port" | "charge">,
  frame: number,
  moveTotalFrames?: number,
): PoseSample {
  const name = poseNameFor(fighter.action, fighter.move);
  const clip = POSE_LIBRARY[name];
  return samplePose(clip, poseTimeFor(name, fighter, frame, moveTotalFrames));
}
