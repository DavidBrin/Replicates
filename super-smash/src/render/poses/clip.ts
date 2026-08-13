/**
 * How a pose clip is written, and how it is sampled.
 *
 * Poses are authored in **degrees** and stored in radians. Angles follow
 * `skeleton.ts`: parent-relative, zero along the parent, clockwise positive
 * with the fighter facing right. So for a leg, 180° hangs straight down, 150°
 * swings it forward, 210° swings it back; for an arm, 90° points straight
 * forward and 0° straight up.
 *
 * Clips interpolate with **shortest-path angle lerp under a per-span ease**.
 * Linear lerp between 350° and 10° walks the long way round the circle and
 * spins a limb through a full turn on a two-frame transition; easing removes
 * the velocity discontinuity at each keyframe, which is what makes four keys
 * per attack look like anticipation rather than like four photographs.
 */

import { deg, type BoneName, type PoseAngles } from "../skeleton";

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

/**
 * How a span between two keys is traversed.
 *
 * `smooth` eases both ends and is right for anything that is not a hit. It is
 * wrong for a hit, and wrong in a way that reads as the whole game being made
 * of putty: a smoothstepped wind-up decelerates *into* the contact frame, so a
 * forward smash arrives at full extension at walking pace. Real attacks
 * accelerate into contact and decelerate out of it, which is `in` on the
 * wind-up span and `out` on the strike span.
 *
 * `hold` is the fifth case and the one that makes *movement* read: it keeps the
 * key's pose exactly until the next key's time and then cuts. A three-frame
 * jumpsquat that eases into its launch has no jumpsquat in it — the pose the
 * eye needs to see is gone before it can be read. Snapping is what an
 * animator's held drawing does, and it is right whenever a shape must be
 * legible for a fixed number of frames rather than travelled through.
 */
export type Ease = "smooth" | "in" | "out" | "linear" | "hold";

export function applyEase(kind: Ease | undefined, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (kind) {
    // Cubic rather than quadratic: the extra order is what makes the limb sit
    // still through the anticipation and then cover the distance in three or
    // four frames, which is the shape of a real swing.
    case "in":
      return c * c * c;
    case "out":
      return 1 - (1 - c) ** 3;
    case "linear":
      return c;
    case "hold":
      return c >= 1 ? 1 : 0;
    default:
      return smoothstep(c);
  }
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
  /** How the span *leaving* this key is traversed. Default `smooth`. */
  readonly ease?: Ease;
}

export interface PoseClip {
  readonly keys: readonly Keyframe[];
  readonly loop: boolean;
  /**
   * Frames in one cycle, for a looping clip. Defaults to 30.
   *
   * This belongs to the animation and not to a table somewhere else: a walk
   * cycle is thirty-two frames long because that is the cadence the legs were
   * drawn at, and the number is meaningless apart from the keys it paces.
   */
  readonly period?: number;
  /**
   * Whole turns of the entire body across one play, in the facing direction.
   *
   * Keyframe `rotation` cannot express this: angles interpolate the short way
   * round, so a key at 0 and a key at 360° are the same key and the body never
   * moves. A tumbling or rolling fighter has to keep turning past half a
   * revolution, so the turn count is declared here and integrated over clip
   * time instead.
   */
  readonly spin?: number;
  /**
   * The `t` of the key that is the moment of contact, for clips that have one.
   *
   * Attacks are the only clips whose timing has an external truth to be right
   * or wrong about: the move's hitbox is live on particular frames, and the
   * fighter had better be at full extension on those exact frames. Naming the
   * strike key here is what lets `poseTimeFor` stretch the wind-up and the
   * recovery independently so that it is — see `MoveTiming`.
   */
  readonly strike?: number;
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
export function P(a: Partial<Record<BoneName, number>>): PoseAngles {
  const out: PoseAngles = {};
  for (const key of Object.keys(a) as BoneName[]) {
    const v = a[key];
    if (v !== undefined) out[key] = deg(v);
  }
  return out;
}

/**
 * Author-time helper: a single-key clip.
 *
 * Reach for this only where the action genuinely *is* one shape — there are
 * very few. A single key means the fighter is a photograph for the whole
 * action, and seventeen of the twenty-one movement clips being photographs is
 * exactly what "the movements don't look like the real thing" meant.
 */
export function still(pose: PoseAngles, extra: Omit<Keyframe, "t" | "pose"> = {}): PoseClip {
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
  const local = span <= 0 ? 0 : applyEase(a.ease, (u - a.t) / span);

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
