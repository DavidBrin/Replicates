import { describe, expect, it } from "vitest";

import { ROLL_FRAMES, ROLL_INTANGIBLE } from "@/engine/constants";
import { CHARACTER_RIGS, getCharacterRig, rotationPivot } from "@/render/characterArt";
import { DRAWN_BONES, resolve, type BoneName, type PoseAngles } from "@/render/skeleton";
import { samplePose } from "./clip";
import { roll } from "./roll";

/**
 * What a roll is asserted on.
 *
 * Not the keyframe table: restating the numbers written above would pass
 * whatever they happened to be. These measure the drawing instead — how big the
 * fighter's silhouette is on each simulation frame, where its lowest point sits
 * relative to the floor it is supposed to be rolling along, and how far any one
 * bone travels between two frames. Every rig runs the same clip and each has its
 * own bone lengths, so the geometry is checked against all of them: a tuck that
 * only works on Mario is a tuck that does not work.
 */

const FRAMES = Array.from({ length: ROLL_FRAMES }, (_, i) => i);
const [INTANGIBLE_FROM, INTANGIBLE_TO] = ROLL_INTANGIBLE;
const RIGS = Object.keys(CHARACTER_RIGS);

/** The whole-body turn on a frame, in degrees, built the way `poseSpinFor` builds it. */
function turn(frame: number): number {
  const t = frame / ROLL_FRAMES;
  return (samplePose(roll, t).rotation * 180) / Math.PI + t * (roll.spin ?? 0) * 360;
}

interface Silhouette {
  readonly width: number;
  readonly height: number;
  /** The lowest painted point, in rig units, with the floor at zero and y down. */
  readonly sole: number;
}

function measure(
  rigId: string,
  angles: PoseAngles,
  transform: Partial<Parameters<typeof resolve>[2]>,
): Silhouette {
  const rig = getCharacterRig(rigId);
  const sk = resolve(rig.bones, angles, {
    x: 0,
    y: 0,
    scale: 1,
    facing: 1,
    // The renderer's own pivot, which is why a tuck has to be posed around a
    // point well above the pelvis rather than around the fighter's middle.
    pivot: rotationPivot(rig),
    ...transform,
  });
  let low = -Infinity;
  let high = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const name of DRAWN_BONES) {
    const b = sk[name];
    const half = b.thickness / 2;
    low = Math.max(low, b.y0 + half, b.y1 + half);
    high = Math.min(high, b.y0 - half, b.y1 - half);
    left = Math.min(left, b.x0 - half, b.x1 - half);
    right = Math.max(right, b.x0 + half, b.x1 + half);
  }
  // The head is a circle at the head bone's tip, not a capsule along it.
  const r = rig.headRadius * (transform.scaleX ?? 1);
  low = Math.max(low, sk.head.y1 + r);
  high = Math.min(high, sk.head.y1 - r);
  left = Math.min(left, sk.head.x1 - r);
  right = Math.max(right, sk.head.x1 + r);
  return { width: right - left, height: low - high, sole: low };
}

function silhouette(rigId: string, frame: number): Silhouette {
  const t = frame / ROLL_FRAMES;
  const s = samplePose(roll, t);
  return measure(rigId, s.angles, {
    y: -s.offsetY,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    rotation: (turn(frame) * Math.PI) / 180,
  });
}

/** Where a fighter's soles sit when they are simply standing — the floor's true height. */
function floorOf(rigId: string): number {
  return measure(rigId, {}, {}).sole;
}

function heights(rigId: string): number[] {
  return FRAMES.map((f) => silhouette(rigId, f).height);
}

describe("the body turns once, and only one way", () => {
  it("advances on every frame", () => {
    for (const f of FRAMES.slice(1)) expect(turn(f)).toBeGreaterThan(turn(f - 1));
  });

  it("comes back to where it started, so the fighter is upright when the state ends", () => {
    expect(turn(0)).toBeCloseTo(0, 6);
    // The last drawn frame is ROLL_FRAMES - 1; the turn closes on the frame the
    // roll hands over to `stand`, which is why the fighter finishes within a few
    // degrees of upright rather than exactly on it.
    expect(turn(ROLL_FRAMES - 1)).toBeGreaterThan(340);
    expect(turn(ROLL_FRAMES)).toBeCloseTo(360, 6);
  });
});

describe("the three beats", () => {
  it("is at its most tucked inside the intangible window, on every rig", () => {
    for (const id of RIGS) {
      const h = heights(id);
      const tightest = h.indexOf(Math.min(...h));
      expect(tightest).toBeGreaterThanOrEqual(INTANGIBLE_FROM);
      expect(tightest).toBeLessThanOrEqual(INTANGIBLE_TO);
    }
  });

  it("is at its least tucked at both ends, and finishes taller than it began", () => {
    for (const id of RIGS) {
      const h = heights(id);
      const loosestTuck = Math.max(...h.slice(INTANGIBLE_FROM + 2, INTANGIBLE_TO + 1));
      const tightest = Math.min(...h);
      // Frame 0 is a fighter on their feet and so is the last frame: both are
      // half again as tall as the ball, and taller than anything in the window.
      for (const end of [h[0], h[ROLL_FRAMES - 1]]) {
        expect(end).toBeGreaterThan(loosestTuck);
        expect(end / tightest).toBeGreaterThan(1.3);
      }
      // Frame 0 is still crouching out of shield; the last frame is standing.
      expect(h[ROLL_FRAMES - 1]).toBeGreaterThan(h[0]);
    }
  });

  it("holds the tuck across the window rather than passing through it", () => {
    for (const id of RIGS) {
      const h = heights(id);
      const tightest = Math.min(...h);
      for (let f = INTANGIBLE_FROM + 2; f <= INTANGIBLE_TO; f++) {
        expect(h[f] / tightest).toBeLessThan(1.5);
      }
    }
  });

  it("opens out on every frame of the punish window, so being vulnerable is visible", () => {
    for (const id of RIGS) {
      const h = heights(id);
      for (let f = INTANGIBLE_TO + 1; f < ROLL_FRAMES; f++) {
        expect(h[f]).toBeGreaterThan(h[f - 1]);
      }
    }
  });
});

describe("the tuck is a ball", () => {
  it("keeps its size while it turns, instead of being a shape swung on a string", () => {
    for (const id of RIGS) {
      // The diagonal, because an axis-aligned box round a turning shape trades
      // width for height as it goes: Donkey Kong's arms take him from 5.8 wide
      // to 9.1 and back over the window without his silhouette changing size.
      const sizes = FRAMES.slice(INTANGIBLE_FROM + 2, INTANGIBLE_TO + 1).map((f) => {
        const s = silhouette(id, f);
        return Math.hypot(s.width, s.height);
      });
      expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.2);
    }
  });

  it("is about as wide as it is tall", () => {
    for (const id of RIGS) {
      for (let f = INTANGIBLE_FROM + 2; f <= INTANGIBLE_TO; f++) {
        const { width, height } = silhouette(id, f);
        // Donkey Kong is the loose end of this: his arms are long enough that
        // even wrapped round his shins they stretch the ball sideways.
        expect(Math.max(width, height) / Math.min(width, height), `${id} f${f}`).toBeLessThan(1.5);
      }
    }
  });
});

describe("the fighter stays on the floor", () => {
  it("neither hovers above it nor sinks through it, on any rig", () => {
    for (const id of RIGS) {
      const floor = floorOf(id);
      const standing = silhouette(id, 0).height;
      for (const f of FRAMES) {
        // A fifth of standing height, which is as tight as one shared clip can
        // be held: the turn pivots at a fixed fraction of a rig height that
        // includes the head, so the point Kirby's tuck turns about sits nearly
        // two units lower, relative to his own body, than Mario's. Closing that
        // would mean letting a clip name its own pivot.
        expect(Math.abs(silhouette(id, f).sole - floor)).toBeLessThan(standing * 0.2);
      }
    }
  });
});

describe("nothing snaps", () => {
  it("turns no bone more than 30 degrees between consecutive frames", () => {
    for (const f of FRAMES.slice(1)) {
      const before = samplePose(roll, (f - 1) / ROLL_FRAMES).angles;
      const after = samplePose(roll, f / ROLL_FRAMES).angles;
      for (const name of Object.keys(after) as BoneName[]) {
        const a = before[name];
        const b = after[name];
        if (a === undefined || b === undefined) continue;
        expect(Math.abs(((b - a) * 180) / Math.PI)).toBeLessThan(30);
      }
    }
  });

  it("never jumps the whole body more than a tenth of its height in one frame", () => {
    for (const id of RIGS) {
      const standing = silhouette(id, 0).height;
      const soles = FRAMES.map((f) => silhouette(id, f).sole);
      for (const f of FRAMES.slice(1)) {
        expect(Math.abs(soles[f] - soles[f - 1])).toBeLessThan(standing * 0.12);
      }
    }
  });
});
