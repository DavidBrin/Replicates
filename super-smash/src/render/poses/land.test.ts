/**
 * What the two landing clips have to *do*, rather than what numbers they are
 * written with.
 *
 * Everything here goes through `samplePose` and then through `resolve` on the
 * reference rig, with `squashFor` multiplied in exactly as `drawOneFighter`
 * multiplies it — so these are measurements of the silhouette the screen shows,
 * not a restatement of the keyframes. That matters most for the heights: the
 * external squash and the clip's own `offsetY`/`scaleY` pull in opposite
 * directions, and whether the fighter ends up *lower* on the frame after impact
 * is not something you can read off either one alone.
 *
 * Lag lengths are swept rather than sampled at one value, because `landingLag`
 * is the only clip in the library whose duration is chosen by the move: six
 * frames for the roster's quickest aerial, thirty-eight for Donkey Kong's up
 * special, and it has to read at both ends.
 */

import { describe, expect, it } from "vitest";

import { squashFor } from "../characterArt";
import { BASE_RIG, resolve, type BoneName } from "../skeleton";
import { angleDelta, samplePose, type PoseClip } from "./clip";
import { land, landingLag } from "./land";

const DEG = 180 / Math.PI;

/** Every lag length any move in the roster asks for, plus both extremes. */
const LAG_LENGTHS = [6, 8, 10, 14, 17, 20, 24, 30, 38] as const;

interface Silhouette {
  /** Height of the crown above the ground line, in rig units. */
  readonly crown: number;
  readonly hip: number;
  /** The lower ankle. Zero is the ground; negative is through it. */
  readonly ankle: number;
  /** Horizontal distance between the hands — how wide the pose reads. */
  readonly span: number;
  readonly angles: Partial<Record<BoneName, number>>;
}

/** One simulation frame of an action, measured the way the renderer draws it. */
function frameOf(
  clip: PoseClip,
  action: "land" | "landingLag",
  frames: number,
  frame: number,
): Silhouette {
  const s = samplePose(clip, frame / frames);
  const squash = squashFor({ action, actionFrame: frame, hitlag: 0 });
  const sk = resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: squash.scaleX * s.scaleX,
    scaleY: squash.scaleY * s.scaleY,
    facing: 1,
  });
  // Screen space is y-down with the feet at the origin, so height above the
  // ground is -y; `offsetY` moves the whole rig and is not part of the skeleton.
  return {
    crown: s.offsetY - sk.head.y1,
    hip: s.offsetY - sk.hip.y1,
    ankle: Math.min(s.offsetY - sk.footR.y0, s.offsetY - sk.footL.y0),
    span: Math.abs(sk.handR.x1 - sk.handL.x1),
    angles: s.angles,
  };
}

function playOut(clip: PoseClip, action: "land" | "landingLag", frames: number): Silhouette[] {
  return Array.from({ length: frames }, (_, f) => frameOf(clip, action, frames, f));
}

/** The fastest any single bone turns between two neighbouring frames, degrees. */
function fastestTurn(rows: readonly Silhouette[]): number {
  let worst = 0;
  for (let i = 1; i < rows.length; i++) {
    for (const bone of Object.keys(rows[i].angles) as BoneName[]) {
      const from = rows[i - 1].angles[bone];
      const to = rows[i].angles[bone];
      if (from === undefined || to === undefined) continue;
      worst = Math.max(worst, Math.abs(angleDelta(from, to)) * DEG);
    }
  }
  return worst;
}

/** How far through the clip the fighter first passes half-way back to standing. */
function riseStartsAt(rows: readonly Silhouette[]): number {
  const low = Math.min(...rows.map((r) => r.crown));
  const high = Math.max(...rows.map((r) => r.crown));
  const half = (low + high) / 2;
  return rows.findIndex((r) => r.crown > half) / rows.length;
}

/** Ankle height on the rig at rest — the reference for "standing on the floor". */
const REST_ANKLE = -resolve(BASE_RIG, {}, { x: 0, y: 0, scale: 1, facing: 1 }).footR.y0;

describe("the light landing", () => {
  const rows = playOut(land, "land", 4);

  it("spends its four frames on four different drawings", () => {
    for (let i = 1; i < rows.length; i++) {
      const moved = (Object.keys(rows[i].angles) as BoneName[]).some((bone) => {
        const from = rows[i - 1].angles[bone];
        const to = rows[i].angles[bone];
        return from !== undefined && to !== undefined && Math.abs(angleDelta(from, to)) * DEG > 8;
      });
      expect(moved, `frame ${i} is a redraw of frame ${i - 1}`).toBe(true);
    }
  });

  it("bottoms out on the frame after contact and is standing by the last", () => {
    const lowest = rows.indexOf(rows.reduce((a, b) => (a.crown <= b.crown ? a : b)));
    expect(lowest).toBe(1);
    // Visibly lower, not lower by a rounding error: the external squash is
    // already releasing on this frame and the clip has to out-run it.
    expect(rows[0].crown - rows[1].crown).toBeGreaterThan(0.3);
    expect(rows[3].crown).toBe(Math.max(...rows.map((r) => r.crown)));
    // Recovered, not merely rising: within a tenth of where the clip ends up.
    expect(rows[3].crown).toBeGreaterThan(frameOf(land, "land", 4, 4).crown * 0.9);
  });

  it("holds the contact and the fold instead of easing through them", () => {
    for (const [t, key] of [
      [0.08, 0],
      [0.2, 0],
      [0.3, 0.25],
      [0.49, 0.25],
    ] as const) {
      expect(samplePose(land, t)).toEqual(samplePose(land, key));
    }
  });

  it("keeps both feet on the ground", () => {
    for (const [i, r] of rows.entries()) {
      expect(Math.abs(r.ankle - REST_ANKLE), `frame ${i} ankle ${r.ankle}`).toBeLessThan(0.35);
    }
  });

  it("draws the arms in and never lets them swing back out", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].span).toBeLessThan(rows[i - 1].span);
    }
  });

  it("turns no bone faster than a knee can fold on impact", () => {
    expect(fastestTurn(rows)).toBeLessThan(50);
  });
});

describe("landing lag", () => {
  it("is no longer the light landing wearing a different name", () => {
    expect(landingLag).not.toBe(land);
    // And not just a differently-shaped clip: it takes the fighter lower.
    const deepest = (rows: readonly Silhouette[]) => Math.min(...rows.map((r) => r.crown));
    expect(deepest(playOut(landingLag, "landingLag", 16))).toBeLessThan(
      deepest(playOut(land, "land", 4)),
    );
  });

  it("dwells: it starts standing up later in its own length than the light landing", () => {
    const light = riseStartsAt(playOut(land, "land", 4));
    for (const frames of LAG_LENGTHS) {
      const lag = riseStartsAt(playOut(landingLag, "landingLag", frames));
      expect(lag, `${frames}-frame lag rises at ${lag}, light landing at ${light}`).toBeGreaterThan(
        light,
      );
      expect(lag).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("bottoms out early and stays down — the compression is not a bounce", () => {
    for (const frames of LAG_LENGTHS) {
      const rows = playOut(landingLag, "landingLag", frames);
      const low = Math.min(...rows.map((r) => r.crown));
      const lowest = rows.findIndex((r) => r.crown === low);
      expect(lowest / frames, `${frames}-frame lag`).toBeLessThan(0.4);
      // Halfway through, the fighter is still nearer the floor than the ceiling.
      const mid = rows[Math.floor(frames / 2)].crown;
      const high = Math.max(...rows.map((r) => r.crown));
      expect(mid - low, `${frames}-frame lag at halfway`).toBeLessThan((high - low) / 2);
    }
  });

  it("is back on its feet by its last frame, however long the lag", () => {
    for (const frames of LAG_LENGTHS) {
      const rows = playOut(landingLag, "landingLag", frames);
      const standing = frameOf(landingLag, "landingLag", frames, frames).crown;
      expect(rows[frames - 1].crown / standing, `${frames}-frame lag`).toBeGreaterThan(0.93);
    }
  });

  it("keeps both feet on the ground, however long the lag", () => {
    for (const frames of LAG_LENGTHS) {
      for (const [i, r] of playOut(landingLag, "landingLag", frames).entries()) {
        expect(Math.abs(r.ankle - REST_ANKLE), `${frames}-frame lag, frame ${i}`).toBeLessThan(0.4);
      }
    }
  });

  it("draws the arms in and never lets them swing back out", () => {
    for (const frames of LAG_LENGTHS) {
      const rows = playOut(landingLag, "landingLag", frames);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].span, `${frames}-frame lag, frame ${i}`).toBeLessThan(rows[i - 1].span + 0.05);
      }
    }
  });

  it("never snaps, even at the shortest lag where it has least room", () => {
    for (const frames of LAG_LENGTHS) {
      expect(fastestTurn(playOut(landingLag, "landingLag", frames)), `${frames}-frame lag`)
        .toBeLessThan(50);
    }
  });

  it("keeps moving through the dwell rather than freezing on one drawing", () => {
    // Twelve identical frames is what the placeholder looked like. Every frame
    // of a long lag has to differ from the one before it by *something*.
    const rows = playOut(landingLag, "landingLag", 24);
    for (let i = 1; i < rows.length; i++) {
      const changed = (Object.keys(rows[i].angles) as BoneName[]).some((bone) => {
        const from = rows[i - 1].angles[bone];
        const to = rows[i].angles[bone];
        return from !== undefined && to !== undefined && Math.abs(angleDelta(from, to)) * DEG > 0.1;
      });
      expect(changed, `frame ${i} is identical to frame ${i - 1}`).toBe(true);
    }
  });
});
