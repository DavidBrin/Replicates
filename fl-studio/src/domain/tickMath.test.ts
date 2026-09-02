import { describe, expect, it } from "vitest";

import {
  SNAP_TICKS,
  arrangementLengthTicks,
  barStepToTick,
  ceilToBar,
  clamp,
  clampTempo,
  isOffBeatStep,
  isStepAligned,
  quantizeToStep,
  secondsToTicks,
  snapTicks,
  snapTicksFloor,
  stepIndices,
  stepToTicks,
  swingDelayTicks,
  tickToBarStep,
  ticksToSeconds,
  ticksToStep,
} from "./tickMath";
import { fixtureProject } from "./testKit";
import { PATTERN_LENGTH_TICKS, PPQ, TICKS_PER_BAR, TICKS_PER_STEP } from "./types";

describe("tick constants", () => {
  it("are internally consistent at PPQ 96, 4/4, 16 steps per bar", () => {
    expect(PPQ).toBe(96);
    expect(TICKS_PER_BAR).toBe(PPQ * 4);
    expect(TICKS_PER_STEP).toBe(TICKS_PER_BAR / 16);
    expect(TICKS_PER_STEP).toBe(24);
    expect(PATTERN_LENGTH_TICKS).toBe(TICKS_PER_BAR);
  });
});

describe("step <-> tick", () => {
  it("maps step index to its tick position", () => {
    expect(stepToTicks(0)).toBe(0);
    expect(stepToTicks(1)).toBe(24);
    expect(stepToTicks(15)).toBe(360);
    expect(stepToTicks(16)).toBe(PATTERN_LENGTH_TICKS);
  });

  it("floors a tick into the step it falls in", () => {
    expect(ticksToStep(0)).toBe(0);
    expect(ticksToStep(23)).toBe(0);
    expect(ticksToStep(24)).toBe(1);
    expect(ticksToStep(359)).toBe(14);
  });

  it("round-trips every step of a bar", () => {
    for (const step of stepIndices()) {
      expect(ticksToStep(stepToTicks(step))).toBe(step);
    }
    expect(stepIndices()).toHaveLength(16);
  });

  it("recognises step-aligned ticks only", () => {
    expect(isStepAligned(0)).toBe(true);
    expect(isStepAligned(48)).toBe(true);
    expect(isStepAligned(12)).toBe(false);
    expect(isStepAligned(24.5)).toBe(false);
  });
});

describe("snapping", () => {
  it("exposes the snap unit sizes the roll offers", () => {
    expect(SNAP_TICKS).toEqual({ bar: 384, beat: 96, halfBeat: 48, quarterBeat: 24 });
  });

  it("rounds to the nearest boundary of the unit", () => {
    expect(snapTicks(100, "beat")).toBe(96);
    expect(snapTicks(150, "beat")).toBe(192);
    expect(snapTicks(200, "bar")).toBe(384);
    expect(snapTicks(180, "bar")).toBe(0);
    expect(snapTicks(30, "quarterBeat")).toBe(24);
    expect(snapTicks(37, "quarterBeat")).toBe(48);
    expect(snapTicks(70, "halfBeat")).toBe(48);
  });

  it("leaves a position alone when snap is off, bar a whole tick", () => {
    expect(snapTicks(137, "off")).toBe(137);
    expect(snapTicks(137.4, "off")).toBe(137);
  });

  it("floors for placement", () => {
    expect(snapTicksFloor(100, "beat")).toBe(96);
    expect(snapTicksFloor(190, "beat")).toBe(96);
    expect(snapTicksFloor(383, "bar")).toBe(0);
    expect(snapTicksFloor(47, "off")).toBe(47);
  });

  it("quantizes a step toggle to the nearest 16th", () => {
    expect(quantizeToStep(11)).toBe(0);
    expect(quantizeToStep(13)).toBe(24);
    expect(quantizeToStep(360)).toBe(360);
  });
});

describe("swing", () => {
  it("swings only odd (off-beat) 16th steps", () => {
    expect(isOffBeatStep(stepToTicks(0))).toBe(false);
    expect(isOffBeatStep(stepToTicks(1))).toBe(true);
    expect(isOffBeatStep(stepToTicks(2))).toBe(false);
    expect(isOffBeatStep(stepToTicks(15))).toBe(true);
  });

  it("delays an off-beat step by half a step at full swing", () => {
    expect(swingDelayTicks(stepToTicks(1), 1)).toBe(TICKS_PER_STEP / 2);
    expect(swingDelayTicks(stepToTicks(1), 0.5)).toBe(6);
    expect(swingDelayTicks(stepToTicks(1), 0)).toBe(0);
  });

  it("never delays an on-beat step", () => {
    expect(swingDelayTicks(stepToTicks(4), 1)).toBe(0);
    expect(swingDelayTicks(0, 1)).toBe(0);
  });

  it("never delays a free-timed note that is not step-aligned", () => {
    // A piano-roll note drawn with snap off must not be nudged by swing.
    expect(swingDelayTicks(30, 1)).toBe(0);
    expect(swingDelayTicks(25, 1)).toBe(0);
  });

  it("clamps a swing amount outside 0..1", () => {
    expect(swingDelayTicks(stepToTicks(3), 5)).toBe(TICKS_PER_STEP / 2);
    expect(swingDelayTicks(stepToTicks(3), -2)).toBe(0);
  });
});

describe("tempo and seconds", () => {
  it("converts ticks to seconds at a tempo", () => {
    // One bar at 120 BPM is exactly 2 seconds.
    expect(ticksToSeconds(TICKS_PER_BAR, 120)).toBeCloseTo(2, 10);
    expect(ticksToSeconds(PPQ, 140)).toBeCloseTo(60 / 140, 10);
  });

  it("round-trips seconds back to ticks", () => {
    const ticks = 517;
    expect(secondsToTicks(ticksToSeconds(ticks, 137), 137)).toBeCloseTo(ticks, 8);
  });

  it("clamps BPM to lane 1's 10..522", () => {
    expect(clampTempo(140)).toBe(140);
    expect(clampTempo(9)).toBe(10);
    expect(clampTempo(9000)).toBe(522);
    expect(clampTempo(Number.NaN)).toBe(10);
  });

  it("clamps generically", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-3, -1, 1)).toBe(-1);
    expect(clamp(3, -1, 1)).toBe(1);
  });
});

describe("bars", () => {
  it("rounds a tick up to a whole bar", () => {
    expect(ceilToBar(0)).toBe(0);
    expect(ceilToBar(1)).toBe(384);
    expect(ceilToBar(384)).toBe(384);
    expect(ceilToBar(385)).toBe(768);
  });

  it("splits a tick into bar and step, and back", () => {
    expect(tickToBarStep(0)).toEqual({ bar: 0, step: 0 });
    expect(tickToBarStep(384 + 72)).toEqual({ bar: 1, step: 3 });
    expect(barStepToTick(1, 3)).toBe(456);
    expect(tickToBarStep(barStepToTick(5, 9))).toEqual({ bar: 5, step: 9 });
  });
});

describe("arrangementLengthTicks", () => {
  it("is one bar for an empty playlist", () => {
    expect(arrangementLengthTicks(fixtureProject())).toBe(TICKS_PER_BAR);
  });

  it("reaches the end of the last clip, rounded up to a bar", () => {
    const project = fixtureProject();
    const withClips = {
      ...project,
      clips: {
        a: { id: "a", trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        b: { id: "b", trackId: "trk-2", patternId: "pat-1", startTick: TICKS_PER_BAR * 3 },
      },
    };
    expect(arrangementLengthTicks(withClips)).toBe(TICKS_PER_BAR * 4);
  });

  it("counts a muted track's clips — muting silences a track, it does not shorten the song", () => {
    const project = fixtureProject();
    const muted = {
      ...project,
      playlistTracks: {
        ...project.playlistTracks,
        "trk-1": { id: "trk-1", name: "Track 1", color: "#fff", muted: true },
      },
      clips: {
        a: { id: "a", trackId: "trk-1", patternId: "pat-1", startTick: TICKS_PER_BAR * 7 },
      },
    };
    expect(arrangementLengthTicks(muted)).toBe(TICKS_PER_BAR * 8);
  });

  it("rounds a clip landing off the bar grid up to the next bar", () => {
    const project = fixtureProject();
    const offGrid = {
      ...project,
      clips: { a: { id: "a", trackId: "trk-1", patternId: "pat-1", startTick: 24 } },
    };
    expect(arrangementLengthTicks(offGrid)).toBe(TICKS_PER_BAR * 2);
  });
});
