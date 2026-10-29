import { P, samplePose, type PoseClip, type PoseSample } from "./clip";
import { BASE_RIG, deg, type BoneName } from "../skeleton";

/**
 * The air dodge — one clip stretched across every air dodge in the game.
 *
 * Each fighter's dodges are its own (Plan 3, Task 20c): a neutral one lasts 38
 * to 61 frames and is intangible to frame 26-32; a directional one lasts 54 to
 * 141 and is intangible only to frame 19-22 (`airDodgeFrames`,
 * `airDodgeIntangible`). Every beat is a proportion, played linearly where the
 * window ends between 0.32 and 0.56 of the clip, the range it was authored for,
 * and around the window's end otherwise (`airDodgeClipTime`). The frame numbers
 * below are quoted for Mario's neutral dodge (52 frames, intangible 3-29, which
 * plays linearly). SmashWiki records the directional dodge — Ultimate's
 * declawed wavedash — as opening with "a five frame windup animation" in which
 * the fighter pulls back opposite the input before moving, which is the
 * counter-lean here: the fighter is still gathering for the first few frames
 * they are already intangible on. The deepest point of the curl is at
 * `t = 0.3`, and that number is doing the work — with the window's end kept at
 * 0.32 of the clip or later, it is inside the window of every dodge on the roster.
 *
 * The important beat is the last one. A fighter gets one air dodge per airtime
 * and cannot act until this animation ends, so its tail is the classic punish
 * in the game — and a directional dodge leaves the fighter tangible for most of
 * its length. The ball therefore starts loosening at `t = 0.5` and is thrown
 * open at 0.64, which makes the recovery more than half the clip and gives it a
 * shape of its own: uncurl, overshoot, settle. It has to be unmistakably not the
 * dodge any more, because for most of it the fighter is exactly as hittable as
 * they look.
 *
 * The turn is keyed `rotation` and not `spin` even though it is a spin. `spin`
 * integrates linearly to `t = 1` and cannot come back: a value big enough to
 * sell the tuck would still be turning through the recovery, and would leave
 * the fighter tilted on the frame the clip cuts to `fall` — clips do not blend
 * into one another. Unwinding the turn *is* the recovery, so it has to live in
 * a channel that can return to zero. For the same reason the last key is
 * `fall`'s apex pose rather than one of its own: `states.ts` sends the fighter
 * straight into `fall` on the frame this clip runs out, and the two drawings
 * have to meet.
 */
export const airDodge: PoseClip = {
  loop: false,
  keys: [
    // Frame 0. Airborne and already gathering — the state cuts to here from a
    // rise or a fall with nothing in between, so this cannot be far from one.
    {
      t: 0,
      pose: P({
        torso: 4, head: -4,
        thighR: 158, shinR: 38, footR: -72,
        thighL: 198, shinL: 30, footL: -78,
        upperArmR: 100, forearmR: -30,
        upperArmL: 244, forearmL: 18,
      }),
      offsetY: 0.12,
    },
    // Frame 2.6. The windup: hips back, chest open, the body leaning the
    // wrong way. Three frames of anticipation is all the window can spare,
    // and without them the tuck has nothing behind it.
    {
      t: 0.05,
      pose: P({
        torso: -18, head: 12, hip: 8,
        thighR: 152, shinR: 50, footR: -66,
        thighL: 196, shinL: 42, footL: -70,
        upperArmR: 134, forearmR: -46,
        upperArmL: 218, forearmL: -26,
      }),
      offsetX: -0.5,
      offsetY: -0.1,
      rotation: deg(-16),
      scaleX: 0.94,
      scaleY: 1.04,
    },
    // Frame 7.8. The tuck: knees to chest, arms wrapped over the shins,
    // the ball already tipped a quarter turn into the dodge. Intangibility has
    // been on since frame 3, so for a moment the fighter is safe and does not
    // look it — which is what the real move's windup does too.
    {
      t: 0.15,
      pose: P({
        hip: -14, torso: 40, head: -26,
        thighR: 110, shinR: 118, footR: -64,
        thighL: 118, shinL: 114, footL: -60,
        upperArmR: 108, forearmR: -108,
        upperArmL: 116, forearmL: -112,
      }),
      offsetX: 0.2,
      offsetY: -1.7,
      rotation: deg(44),
      scaleX: 0.84,
      scaleY: 0.86,
    },
    // Frame 15.6. The tightest the fighter ever gets, well inside the window.
    // This is the drawing the blink and the afterimages are trailing.
    {
      t: 0.3,
      pose: P({
        hip: -16, torso: 42, head: -28,
        thighR: 104, shinR: 124, footR: -58,
        thighL: 112, shinL: 120, footL: -54,
        upperArmR: 102, forearmR: -116,
        upperArmL: 110, forearmL: -120,
      }),
      offsetX: 0.1,
      offsetY: -2.1,
      rotation: deg(60),
      scaleX: 0.76,
      scaleY: 0.8,
    },
    // Frame 26. The ball loosens while the turn carries on past horizontal —
    // the spin outlasts the tuck, which is what stops the middle of the clip
    // being a photograph of a curled fighter for twenty frames.
    {
      t: 0.5,
      pose: P({
        hip: -14, torso: 38, head: -24,
        thighR: 112, shinR: 112, footR: -62,
        thighL: 120, shinL: 108, footL: -58,
        upperArmR: 110, forearmR: -104,
        upperArmL: 118, forearmL: -108,
      }),
      offsetY: -1.85,
      rotation: deg(76),
      scaleX: 0.81,
      scaleY: 0.85,
      ease: "out",
    },
    // Frame 33.3. Thrown open. The legs go first and the arms trail: the
    // fighter is not righting themselves, they are being unfolded by the fall.
    {
      t: 0.64,
      pose: P({
        hip: -8, torso: 26, head: -18,
        thighR: 128, shinR: 82, footR: -68,
        thighL: 150, shinL: 74, footL: -64,
        upperArmR: 124, forearmR: -70,
        upperArmL: 190, forearmL: -50,
      }),
      offsetY: -1.15,
      rotation: deg(44),
      scaleX: 0.88,
      scaleY: 0.9,
    },
    // Frame 41.1. The helpless part. The limbs are flung past where they
    // will settle and the chest tips back — nobody who could act would be in
    // this shape, and the fighter cannot act for another ten frames.
    {
      t: 0.79,
      pose: P({
        hip: 4, torso: -12, head: 2,
        thighR: 174, shinR: 30, footR: -66,
        thighL: 212, shinL: 22, footL: -86,
        upperArmR: 34, forearmR: 6,
        upperArmL: 306, forearmL: -6,
      }),
      offsetY: -0.1,
      rotation: deg(-9),
      scaleX: 0.99,
      scaleY: 1.05,
    },
    // Frame 47.3. The arms come back down. This key exists because the
    // last frames are otherwise a single ease from the flail to the fall
    // pose — under a degree a frame, which the eye reads as a fighter who is
    // ready again, before they are.
    {
      t: 0.91,
      pose: P({
        hip: 1, torso: -3, head: 2,
        thighR: 168, shinR: 36, footR: -68,
        thighL: 202, shinL: 28, footL: -84,
        upperArmR: 54, forearmR: -6,
        upperArmL: 308, forearmL: 4,
      }),
      offsetY: 0.1,
      rotation: deg(-3),
      scaleX: 0.98,
      scaleY: 1.04,
    },
    // Frame 52, which is also frame 0 of `fall`.
    {
      t: 1,
      pose: P({
        torso: 3, head: -3,
        thighR: 164, shinR: 40, footR: -70,
        thighL: 196, shinL: 30, footL: -80,
        upperArmR: 70, forearmR: -14,
        upperArmL: 296, forearmL: 14,
      }),
      offsetY: 0.3,
      scaleX: 0.97,
      scaleY: 1.05,
    },
  ],
};

/**
 * Where in the clip an intangible window may end and the drawing still read
 * right: the clip was authored for windows ending 20/63 of the way through (the
 * old flat directional dodge) to 28/50 (the old flat neutral one) — curled up to
 * there, uncurling after.
 */
export const AIR_DODGE_WINDOW_END_MIN = 20 / 63;
export const AIR_DODGE_WINDOW_END_MAX = 28 / 50;

/**
 * The most any one bone may turn from one frame's drawing to the next, in
 * degrees: past about this the fighter reads as replaced rather than moved
 * (`airDodge.test.ts` holds every roster dodge under 32).
 */
export const AIR_DODGE_MAX_BONE_STEP = 30;

/** The largest angle any single bone turns between two poses, in degrees. */
function boneTurn(a: PoseSample, b: PoseSample): number {
  let worst = 0;
  for (const name of Object.keys(BASE_RIG) as BoneName[]) {
    let d = Math.abs(((b.angles[name] ?? BASE_RIG[name].angle) - (a.angles[name] ?? BASE_RIG[name].angle)) * 180) / Math.PI;
    d %= 360;
    worst = Math.max(worst, d > 180 ? 360 - d : d);
  }
  return worst;
}

/**
 * The plain clip time: linear, `frame / total`, wherever that puts the
 * window's end inside the range the clip was authored for
 * (`AIR_DODGE_WINDOW_END_MIN`/`_MAX`). Outside it the clip is played in two
 * pieces, as an attack's is around its contact frame (`poseTimeFor`): the
 * window's last frame lands on the range's nearer end, the clip before it
 * stretched across the window and the clip after it across the rest.
 */
function plainClipTime(frame: number, total: number, lastIntangible: number): number {
  const linear = Math.min(1, Math.max(0, frame / total));
  if (lastIntangible <= 0 || lastIntangible >= total) return linear;
  const at = lastIntangible / total;
  const end = at < AIR_DODGE_WINDOW_END_MIN ? AIR_DODGE_WINDOW_END_MIN : at > AIR_DODGE_WINDOW_END_MAX ? AIR_DODGE_WINDOW_END_MAX : at;
  if (end === at) return linear;
  if (frame <= lastIntangible) return Math.max(0, (end * frame) / lastIntangible);
  return Math.min(1, end + ((1 - end) * (frame - lastIntangible)) / (total - lastIntangible));
}

/** How finely the clip's own motion is measured for pacing. */
const MOTION_STEPS = 1000;
let motion: number[] | null = null;

/** How far the clip's bones have turned, in total, by clip time `i / MOTION_STEPS`; measured once. */
function clipMotion(): number[] {
  if (motion === null) {
    const poses = Array.from({ length: MOTION_STEPS + 1 }, (_, i) => samplePose(airDodge, i / MOTION_STEPS));
    const out = [0];
    for (let i = 1; i <= MOTION_STEPS; i++) out.push(out[i - 1] + boneTurn(poses[i - 1], poses[i]));
    motion = out;
  }
  return motion;
}

/** The clip time at which `clipMotion` reaches `m`. */
function timeAtMotion(m: number): number {
  const c = clipMotion();
  let lo = 0;
  let hi = MOTION_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid] < m) lo = mid;
    else hi = mid;
  }
  const span = c[hi] - c[lo];
  return (lo + (span > 0 ? Math.min(1, Math.max(0, (m - c[lo]) / span)) : 0)) / MOTION_STEPS;
}

/** The clip's motion at clip time `t`, read off `clipMotion`. */
function motionAt(t: number): number {
  const c = clipMotion();
  const x = Math.min(1, Math.max(0, t)) * MOTION_STEPS;
  const lo = Math.floor(x);
  return lo >= MOTION_STEPS ? c[MOTION_STEPS] : c[lo] + (c[lo + 1] - c[lo]) * (x - lo);
}

const clipTables = new Map<string, readonly number[]>();

/**
 * The clip time on each frame 0..`total` of one dodge. The plain map
 * (`plainClipTime`) wherever no bone turns more than `AIR_DODGE_MAX_BONE_STEP`
 * a frame under it — every dodge on the roster but Fox's 38-frame neutral one,
 * whose window leaves 12 frames for the recovery. There each of the plain
 * map's two pieces is paced by the clip's own motion instead (the bones turn
 * the same amount every frame of the piece), so the window still ends on the
 * same clip time and the motion is spread over the length.
 */
function clipTimes(total: number, lastIntangible: number): readonly number[] {
  const key = `${total}:${lastIntangible}`;
  const cached = clipTables.get(key);
  if (cached !== undefined) return cached;
  const plain = Array.from({ length: total + 1 }, (_, f) => plainClipTime(f, total, lastIntangible));
  const poses = plain.map((t) => samplePose(airDodge, t));
  let peak = 0;
  for (let f = 0; f < total; f++) peak = Math.max(peak, boneTurn(poses[f], poses[f + 1]));
  let table: readonly number[] = plain;
  if (peak > AIR_DODGE_MAX_BONE_STEP) {
    const split = lastIntangible > 0 && lastIntangible < total ? lastIntangible : total;
    const end = plain[split];
    const paced = (f: number, f0: number, f1: number, t0: number, t1: number): number => {
      const m0 = motionAt(t0);
      return timeAtMotion(m0 + ((motionAt(t1) - m0) * (f - f0)) / (f1 - f0));
    };
    table = plain.map((_, f) => (f <= split ? paced(f, 0, split, 0, end) : paced(f, split, total, end, 1)));
  }
  clipTables.set(key, table);
  return table;
}

/**
 * Clip time for `actionFrame` `frame` of an air dodge `total` frames long whose
 * intangibility ends on `lastIntangible` (`airDodgeIntangible`): `clipTimes`.
 * Each fighter's own lengths put most dodges outside the clip's authored range
 * (Plan 3, Task 20c): a directional dodge's window ends 19-22 frames into
 * 54-141, a neutral one's 26-32 into 38-61. Render only: the simulation never
 * reads it.
 */
export function airDodgeClipTime(frame: number, total: number, lastIntangible: number): number {
  if (total <= 0) return 0;
  const table = clipTimes(total, lastIntangible);
  const f = Math.min(total, Math.max(0, frame));
  const lo = Math.floor(f);
  const hi = Math.min(total, lo + 1);
  return table[lo] + (table[hi] - table[lo]) * (f - lo);
}
