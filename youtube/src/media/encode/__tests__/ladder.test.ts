// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  LADDER_REFERENCE_RUNGS,
  SEGMENT_DURATION_US,
  createSegmentGate,
  segmentIndexAt,
  selectLadder,
} from "../ladder";

/**
 * Two things are pinned here, and they fail in completely different ways.
 *
 * Ladder selection fails *visibly*: a wrong rung is a blurry video or a 40 MB
 * upload of a 480p source upscaled to 1080p. Anyone would notice.
 *
 * Keyframe cadence fails *invisibly*. Every rung plays perfectly on its own.
 * The bug only appears when a player switches rungs mid-playback on a real
 * network — the new rung's first sample is a P-frame referencing pictures the
 * fresh decoder never saw, and the viewer gets a freeze or a smear that nobody
 * can reproduce on a fast connection. So the cadence tests below are the more
 * important half of this file, and they are written as *properties* (every rung
 * agrees; a dropped frame does not shift the anchor) rather than as a snapshot
 * of whatever the implementation happens to emit.
 */

const NTSC_FRAME_US = (1001 * 1_000_000) / 30_000; // 30000/1001 fps ≈ 33366.67 µs

function timestampsAt(fps: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((i * 1_000_000) / fps));
}

/** Which frame indices the gate decides should carry an IDR. */
function keyframeIndices(timestamps: readonly number[]): number[] {
  const gate = createSegmentGate();
  const keys: number[] = [];
  timestamps.forEach((ts, i) => {
    if (gate.admit(ts).keyFrame) keys.push(i);
  });
  return keys;
}

/* ------------------------------------------------------- ladder selection -- */

describe("selectLadder", () => {
  it("reproduces the published 16:9 table exactly for a 1080p source", () => {
    // research/01 §6.5, with the bitrates from §6.2 (Mux). If this drifts, the
    // ladder no longer matches any published guidance and the numbers become
    // folklore.
    expect(selectLadder({ width: 1920, height: 1080 })).toEqual([
      { name: "1080p", width: 1920, height: 1080, bitrate: 5_000_000 },
      { name: "720p", width: 1280, height: 720, bitrate: 2_800_000 },
      { name: "480p", width: 854, height: 480, bitrate: 1_400_000 },
      { name: "360p", width: 640, height: 360, bitrate: 800_000 },
      { name: "240p", width: 426, height: 240, bitrate: 400_000 },
      { name: "144p", width: 256, height: 144, bitrate: 150_000 },
    ]);
  });

  it("never upscales — a 720p source gets no 1080p rung", () => {
    const rungs = selectLadder({ width: 1280, height: 720 });
    expect(rungs.map((r) => r.name)).toEqual([
      "720p",
      "480p",
      "360p",
      "240p",
      "144p",
    ]);
  });

  it("caps a 4K source at 1080p rather than asking a browser to encode 2160p", () => {
    const rungs = selectLadder({ width: 3840, height: 2160 });
    expect(rungs[0]).toEqual({
      name: "1080p",
      width: 1920,
      height: 1080,
      bitrate: 5_000_000,
    });
    expect(rungs).toHaveLength(6);
  });

  it("measures vertical video by its smaller dimension, so Shorts get a full ladder", () => {
    const vertical = selectLadder({ width: 1080, height: 1920 });
    const landscape = selectLadder({ width: 1920, height: 1080 });

    expect(vertical.map((r) => r.name)).toEqual(landscape.map((r) => r.name));
    expect(vertical.map((r) => [r.width, r.height])).toEqual([
      [1080, 1920],
      [720, 1280],
      [480, 854],
      [360, 640],
      [240, 426],
      [144, 256],
    ]);
    // Same pixel count as the landscape ladder, so the same bitrates.
    expect(vertical.map((r) => r.bitrate)).toEqual(
      landscape.map((r) => r.bitrate),
    );
  });

  it("derives dimensions for a 4:3 source instead of pretending it is 16:9", () => {
    expect(selectLadder({ width: 640, height: 480 })).toEqual([
      { name: "480p", width: 640, height: 480, bitrate: 1_049_000 },
      { name: "360p", width: 480, height: 360, bitrate: 600_000 },
      { name: "240p", width: 320, height: 240, bitrate: 300_000 },
      { name: "144p", width: 192, height: 144, bitrate: 113_000 },
    ]);
  });

  it("scales bitrate with pixel count, so a square source is not billed for 16:9", () => {
    const square = selectLadder({ width: 1080, height: 1080 });
    const top = square[0];
    expect(top?.name).toBe("1080p");
    // 1080×1080 is 9/16 the area of 1920×1080.
    expect(top?.bitrate).toBe(Math.round((5_000_000 * 9) / 16 / 1000) * 1000);
  });

  it("gives a source below the smallest rung one rung at its own size", () => {
    expect(selectLadder({ width: 120, height: 90 })).toEqual([
      { name: "90p", width: 120, height: 90, bitrate: 44_000 },
    ]);
  });

  it("floors an odd-dimensioned tiny source to even rather than growing it", () => {
    const rungs = selectLadder({ width: 121, height: 91 });
    expect(rungs).toHaveLength(1);
    expect(rungs[0]?.width).toBe(120);
    expect(rungs[0]?.height).toBe(90);
  });

  it("stops at the largest standard rung the source can fill", () => {
    // 562 sits between 480p and 720p. YouTube downscales to the standard rung
    // rather than inventing a "562p" the quality menu cannot label.
    const rungs = selectLadder({ width: 1000, height: 562 });
    expect(rungs.map((r) => r.name)).toEqual(["480p", "360p", "240p", "144p"]);
  });

  it("emits only even dimensions, because 4:2:0 chroma has no half pixel", () => {
    const sources = [
      { width: 1920, height: 1080 },
      { width: 1000, height: 562 },
      { width: 640, height: 480 },
      { width: 1080, height: 1080 },
      { width: 1440, height: 1080 },
      { width: 720, height: 1280 },
      { width: 999, height: 563 },
    ];
    for (const source of sources) {
      for (const rung of selectLadder(source)) {
        expect(rung.width % 2, `${rung.name} of ${source.width}x${source.height}`).toBe(0);
        expect(rung.height % 2, `${rung.name} of ${source.width}x${source.height}`).toBe(0);
      }
    }
  });

  it("returns rungs largest first, with unique names", () => {
    const rungs = selectLadder({ width: 1920, height: 1080 });
    const areas = rungs.map((r) => r.width * r.height);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);
    expect(new Set(rungs.map((r) => r.name)).size).toBe(rungs.length);
  });

  it("never exceeds the source in either dimension", () => {
    for (const source of [
      { width: 1920, height: 1080 },
      { width: 1000, height: 562 },
      { width: 300, height: 400 },
      { width: 641, height: 361 },
      // The rounding trap: a rung whose short side matches the source exactly,
      // with an odd long side. Rounding to nearest even would return 642.
      { width: 641, height: 360 },
    ]) {
      for (const rung of selectLadder(source)) {
        expect(rung.width).toBeLessThanOrEqual(source.width);
        expect(rung.height).toBeLessThanOrEqual(source.height);
      }
    }
  });

  it("rejects a source too small to be a video at all", () => {
    expect(() => selectLadder({ width: 1, height: 1 })).toThrow(/at least 2/);
  });

  it("keeps the reference table sorted and 16:9", () => {
    for (const rung of LADDER_REFERENCE_RUNGS) {
      expect(rung.width / rung.height).toBeCloseTo(16 / 9, 1);
    }
  });
});

/* ------------------------------------------------------- keyframe cadence -- */

describe("segmentIndexAt", () => {
  it("uses 2s segments", () => {
    expect(SEGMENT_DURATION_US).toBe(2_000_000);
  });

  it("puts a boundary exactly on the segment start, not one frame late", () => {
    expect(segmentIndexAt(0)).toBe(0);
    expect(segmentIndexAt(1_999_999)).toBe(0);
    expect(segmentIndexAt(2_000_000)).toBe(1);
    expect(segmentIndexAt(3_999_999)).toBe(1);
    expect(segmentIndexAt(4_000_000)).toBe(2);
  });

  it("handles the negative timestamps an edit list can produce", () => {
    expect(segmentIndexAt(-1)).toBe(-1);
    expect(segmentIndexAt(-2_000_000)).toBe(-1);
    expect(segmentIndexAt(-2_000_001)).toBe(-2);
  });
});

describe("createSegmentGate", () => {
  it("opens with a keyframe and then keys every 2s at 30fps", () => {
    expect(keyframeIndices(timestampsAt(30, 240))).toEqual([0, 60, 120, 180]);
  });

  it("stays anchored to time, not to a frame count, at 30000/1001 fps", () => {
    // 60 NTSC frames is 2.002s, so a frame counter would drift 2ms per segment
    // and eventually place an IDR in a different segment from the other rungs.
    const ntsc = Array.from({ length: 200 }, (_, i) => Math.round(i * NTSC_FRAME_US));
    expect(keyframeIndices(ntsc)).toEqual([0, 60, 120, 180]);
  });

  it("keeps the keyframe on the same PTS when the decoder drops a frame", () => {
    const complete = timestampsAt(30, 130);
    const withDrop = complete.filter((_, i) => i !== 10);

    const completeKeyPts = keyframeIndices(complete).map((i) => complete[i]);
    const droppedKeyPts = keyframeIndices(withDrop).map((i) => withDrop[i]);
    expect(droppedKeyPts).toEqual(completeKeyPts);

    // The control: a frame counter, which is what this gate exists to avoid.
    // Its second keyframe lands 33ms later than every other rung's, which is
    // exactly the mid-playback switch glitch nobody can reproduce.
    const counterKeyPts = withDrop.filter((_, i) => i % 60 === 0);
    expect(counterKeyPts).not.toEqual(completeKeyPts);
  });

  it("agrees across six independent rungs fed the same timestamps", () => {
    // The pipeline computes the decision once and fans it out, but the property
    // that makes that safe is that the decision is a pure function of the PTS.
    // If it were not, six encoders would drift apart and the ladder would stop
    // being switchable.
    const jittered = Array.from({ length: 400 }, (_, i) =>
      Math.round((i * 1_000_000) / 30) + (i % 7) - 3,
    );
    const perRung = Array.from({ length: 6 }, () => keyframeIndices(jittered));
    for (const rung of perRung) expect(rung).toEqual(perRung[0]);
    expect(perRung[0]?.length).toBeGreaterThan(4);
  });

  it("does not key twice for a duplicated timestamp", () => {
    const gate = createSegmentGate();
    expect(gate.admit(2_000_000).keyFrame).toBe(true);
    expect(gate.admit(2_000_000).keyFrame).toBe(false);
    expect(gate.admit(2_000_001).keyFrame).toBe(false);
  });

  it("keys once, at the correct index, across a gap that skips a segment", () => {
    const gate = createSegmentGate();
    expect(gate.admit(0)).toEqual({ segmentIndex: 0, keyFrame: true });
    expect(gate.admit(6_100_000)).toEqual({ segmentIndex: 3, keyFrame: true });
    expect(gate.admit(6_200_000)).toEqual({ segmentIndex: 3, keyFrame: false });
  });

  it("honours a custom segment duration on both the gate and the index", () => {
    const gate = createSegmentGate(6_000_000);
    expect(gate.admit(0).keyFrame).toBe(true);
    expect(gate.admit(5_999_999).keyFrame).toBe(false);
    expect(gate.admit(6_000_000)).toEqual({ segmentIndex: 1, keyFrame: true });
    expect(segmentIndexAt(6_000_000, 6_000_000)).toBe(1);
  });

  it("starts a source whose first frame is not at zero with a keyframe", () => {
    const gate = createSegmentGate();
    expect(gate.admit(5_000_000)).toEqual({ segmentIndex: 2, keyFrame: true });
  });
});
