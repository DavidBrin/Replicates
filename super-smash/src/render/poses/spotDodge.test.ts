/**
 * What the spot dodge has to *look* like, asserted off the sampled clip rather
 * than off the keyframe table.
 *
 * Every test here reads the clip at the twenty-four times the renderer actually
 * asks for — `poseTimeFor` divides `actionFrame` by `SPOT_DODGE_FRAMES`, so no
 * other time is ever sampled — resolves each sample onto the reference rig, and
 * measures the silhouette. That is deliberately one step removed from the
 * numbers in `spotDodge.ts`: a keyframe can be retimed or re-posed freely, and
 * these only complain when the *motion* stops being a spot dodge.
 */

import { describe, expect, it } from "vitest";

import { SPOT_DODGE_FRAMES, SPOT_DODGE_INTANGIBLE } from "@/engine/constants";
import { samplePose, type PoseSample } from "./clip";
import { spotDodge } from "./spotDodge";
import { BASE_RIG, DRAWN_BONES, resolve, type BoneName } from "../skeleton";

const [FIRST_INTANGIBLE, LAST_INTANGIBLE] = SPOT_DODGE_INTANGIBLE;
const FRAMES = Array.from({ length: SPOT_DODGE_FRAMES }, (_, f) => f);
const LAST = SPOT_DODGE_FRAMES - 1;

const sampleAt = (frame: number): PoseSample =>
  samplePose(spotDodge, frame / SPOT_DODGE_FRAMES);

interface Silhouette {
  /** Widest horizontal span of the drawn capsules, in rig units. */
  readonly width: number;
  /** Crown height above the floor. */
  readonly height: number;
  /** Pelvis height above the floor — how far the fighter has sunk. */
  readonly pelvis: number;
  /** Lowest drawn point relative to the floor. Zero means planted. */
  readonly floor: number;
}

/**
 * Measure one sampled frame as it would be drawn.
 *
 * `resolve` puts the rig in screen space (y down) about an origin at the feet,
 * with the pose's squash already applied; the clip's whole-body `offsetY` is
 * added afterwards because the renderer applies it to the fighter's world
 * position rather than to the rig.
 */
function measure(s: PoseSample): Silhouette {
  const skeleton = resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
  });
  let left = Infinity;
  let right = -Infinity;
  let lowest = Infinity;
  let crown = -Infinity;
  for (const name of DRAWN_BONES) {
    const bone = skeleton[name];
    const radius = bone.thickness / 2;
    for (const [x, y] of [
      [bone.x0, bone.y0],
      [bone.x1, bone.y1],
    ]) {
      left = Math.min(left, x - radius);
      right = Math.max(right, x + radius);
      lowest = Math.min(lowest, -y);
      crown = Math.max(crown, -y);
    }
  }
  return {
    width: right - left,
    height: crown + s.offsetY,
    pelvis: -skeleton.hip.y0 + s.offsetY,
    floor: lowest + s.offsetY,
  };
}

const shape = FRAMES.map((f) => measure(sampleAt(f)));
const tallest = Math.max(...shape.map((s) => s.height));
const shortest = Math.min(...shape.map((s) => s.height));
const narrowest = Math.min(...shape.map((s) => s.width));
const window_ = FRAMES.filter((f) => f >= FIRST_INTANGIBLE && f <= LAST_INTANGIBLE);

describe("the spot dodge is not one drawing", () => {
  it("changes shape on most of its frames", () => {
    const distinct = new Set(shape.map((s) => `${s.height.toFixed(2)}/${s.width.toFixed(2)}`));
    expect(distinct.size).toBeGreaterThan(SPOT_DODGE_FRAMES / 2);
  });
});

describe("the compress", () => {
  it("starts from something close to a standing fighter", () => {
    // Nothing interpolates a fighter into this clip except `blendedPose`, and a
    // frame 0 that were already crouched would be a cut rather than a break.
    expect(shape[0].height).toBeGreaterThan(tallest * 0.94);
  });

  it("is finished by the first intangible frame, not spread across the clip", () => {
    const total = shape[0].height - shortest;
    const byIntangible = shape[0].height - shape[FIRST_INTANGIBLE].height;
    expect(total).toBeGreaterThan(tallest * 0.15);
    expect(byIntangible / total).toBeGreaterThan(0.85);
  });

  it("spends its whole travel inside the first quarter of the clip", () => {
    const quarter = Math.floor(SPOT_DODGE_FRAMES / 4);
    const before = shape.slice(0, quarter + 1).map((s) => s.height);
    // Every frame after the first quarter is nearer the crouch than to standing.
    const mid = (tallest + shortest) / 2;
    for (const f of FRAMES.slice(quarter + 1, LAST_INTANGIBLE + 1)) {
      expect(shape[f].height).toBeLessThan(mid);
    }
    expect(Math.min(...before)).toBeLessThan(mid);
  });
});

describe("the intangible window", () => {
  it("holds the crouch — no frame in it stands back up", () => {
    for (const f of window_) {
      expect(shape[f].height).toBeLessThan(tallest * 0.9);
      expect(shape[f].pelvis).toBeLessThan(shape[LAST].pelvis * 0.85);
    }
  });

  it("contains the narrowest drawing in the clip", () => {
    const at = shape.findIndex((s) => s.width === narrowest);
    expect(at).toBeGreaterThanOrEqual(FIRST_INTANGIBLE);
    expect(at).toBeLessThanOrEqual(LAST_INTANGIBLE);
    // …and narrow means narrower than the fighter's own standing silhouette,
    // which is the only comparison an opponent can actually make.
    expect(narrowest).toBeLessThan(shape[LAST].width * 0.95);
  });

  it("is a held shape rather than a slow move through one", () => {
    // Over the frames before the tell the silhouette drifts, but by less than a
    // tenth of the distance it covered getting there.
    const held = window_.filter((f) => f <= LAST_INTANGIBLE - 6);
    const drift = Math.max(...held.map((f) => shape[f].height)) - shortest;
    expect(drift).toBeLessThan((shape[0].height - shortest) * 0.15);
  });
});

describe("the recovery", () => {
  it("is over by the last frame the renderer draws", () => {
    // `poseTimeFor` never reaches t = 1: the frame after this one is `stand`.
    expect(shape[LAST].height).toBe(tallest);
    expect(shape[LAST].pelvis).toBe(Math.max(...shape.map((s) => s.pelvis)));
    const last = sampleAt(LAST);
    expect(last.scaleX).toBeCloseTo(1, 2);
    expect(last.scaleY).toBeCloseTo(1, 2);
  });

  it("rises without pausing once the intangibility ends", () => {
    for (const f of FRAMES.slice(LAST_INTANGIBLE, LAST)) {
      expect(shape[f + 1].height).toBeGreaterThan(shape[f].height);
    }
  });

  it("does most of its standing up in the punish window", () => {
    const regained = shape[LAST].height - shape[LAST_INTANGIBLE].height;
    expect(regained / (shape[LAST].height - shortest)).toBeGreaterThan(0.6);
  });
});

describe("it is a spot dodge and not a roll", () => {
  it("never leaves the spot", () => {
    const travel = FRAMES.map((f) => Math.abs(sampleAt(f).offsetX));
    // A lean, not a step: under a twentieth of the fighter's standing height.
    expect(Math.max(...travel)).toBeLessThan(tallest / 20);
    expect(sampleAt(0).offsetX).toBe(0);
    expect(sampleAt(LAST).offsetX).toBe(0);
  });

  it("keeps its feet on the floor the whole way through", () => {
    for (const f of FRAMES) expect(Math.abs(shape[f].floor)).toBeLessThan(0.2);
  });

  it("never snaps a limb round the long way", () => {
    // A pair of keys either side of the wrap point sends a bone the long way
    // round, which shows up as a limb covering half a turn or more between two
    // consecutive frames. The elbows genuinely do fold about a hundred degrees
    // on the snap into the tuck, so the bar is set above that and well under the
    // hundred and eighty a wrapped bone would take.
    let worst = 0;
    for (let f = 1; f < SPOT_DODGE_FRAMES; f++) {
      const before = sampleAt(f - 1).angles;
      const after = sampleAt(f).angles;
      for (const name of Object.keys(after) as BoneName[]) {
        const a = before[name];
        const b = after[name];
        if (a === undefined || b === undefined) continue;
        worst = Math.max(worst, Math.abs(b - a));
      }
    }
    expect((worst * 180) / Math.PI).toBeLessThan(130);
  });
});
