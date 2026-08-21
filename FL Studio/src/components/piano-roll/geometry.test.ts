/**
 * Geometry unit tests — the tick/pitch ↔ px layer both the painter and the
 * gesture machine read (SPEC §7's "pure-renderer geometry" line).
 *
 * Every assertion is an invariant, not a snapshot of today's constants: round
 * trips, monotonicity, and the *classification* of a gridline rather than its
 * colour. Changing the default zoom must not turn this suite red.
 */

import { describe, expect, it } from "vitest";

import { TICKS_PER_BAR, TICKS_PER_BEAT, TICKS_PER_STEP, type Note } from "@/domain/types";

import {
  BASE_PX_PER_TICK,
  GRIP_WIDTH,
  KEYBOARD_WIDTH,
  MAX_PITCH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  clampScroll,
  createViewport,
  gridBottom,
  gridlineWeight,
  gripRect,
  isBeatBanded,
  isBlackKey,
  noteRect,
  pitchName,
  pitchToY,
  rectContains,
  regionAt,
  tickToBarNumber,
  tickToX,
  velocityToY,
  visiblePitchRange,
  visibleTickRange,
  xToTick,
  yToPitch,
  yToVelocity,
  zoomAtCursor,
} from "./geometry";

const note = (patch: Partial<Note> = {}): Note => ({
  id: "n-1",
  channelId: "ch-1",
  positionTicks: 0,
  lengthTicks: TICKS_PER_STEP,
  pitch: 60,
  velocity: 0.8,
  ...patch,
});

describe("tick ↔ x", () => {
  it("places tick 0 at the right edge of the keyboard column", () => {
    expect(tickToX(createViewport(), 0)).toBe(KEYBOARD_WIDTH);
  });

  it("round-trips through xToTick at any zoom and scroll", () => {
    for (const zoomX of [0.5, 1, 2.75]) {
      const view = createViewport({ zoomX, scrollX: 137 });
      expect(xToTick(view, tickToX(view, 240))).toBeCloseTo(240, 6);
    }
  });

  it("scales with zoom: doubling zoom doubles the pixels per tick", () => {
    const single = createViewport({ zoomX: 1 });
    const double = createViewport({ zoomX: 2 });
    const width = (view: ReturnType<typeof createViewport>) =>
      tickToX(view, TICKS_PER_BEAT) - tickToX(view, 0);
    expect(width(double)).toBeCloseTo(2 * width(single), 6);
    expect(width(single)).toBeCloseTo(TICKS_PER_BEAT * BASE_PX_PER_TICK, 6);
  });

  it("scrolling right moves content left by the same pixel amount", () => {
    const view = createViewport();
    const scrolled = createViewport({ scrollX: 50 });
    expect(tickToX(view, 96) - tickToX(scrolled, 96)).toBe(50);
  });

  it("reports a visible tick range that covers the canvas and no more", () => {
    const view = createViewport({ width: 400, scrollX: 0 });
    const { start, end } = visibleTickRange(view);
    expect(start).toBe(0);
    expect(tickToX(view, end)).toBeGreaterThanOrEqual(view.width - 1);
  });
});

describe("pitch ↔ y", () => {
  it("puts higher pitches higher on screen", () => {
    const view = createViewport();
    expect(pitchToY(view, 72)).toBeLessThan(pitchToY(view, 60));
  });

  it("round-trips: the pitch at a row's own y is that pitch", () => {
    const view = createViewport({ scrollY: 33 });
    for (const pitch of [0, 36, 60, 61, 127]) {
      expect(yToPitch(view, pitchToY(view, pitch) + 1)).toBe(pitch);
    }
  });

  it("puts the top row (127) flush against the ruler at scroll 0", () => {
    expect(pitchToY(createViewport({ scrollY: 0 }), MAX_PITCH)).toBe(RULER_HEIGHT);
  });

  it("keeps the visible pitch range inside 0–127", () => {
    const { low, high } = visiblePitchRange(createViewport({ scrollY: 0 }));
    expect(high).toBe(MAX_PITCH);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThan(high);
  });

  it("classifies black keys as FL's shaded rows", () => {
    expect([0, 2, 4, 5, 7, 9, 11].map((p) => isBlackKey(60 + p))).toEqual(
      Array(7).fill(false),
    );
    expect([1, 3, 6, 8, 10].map((p) => isBlackKey(60 + p))).toEqual(Array(5).fill(true));
    expect(isBlackKey(61 - 12)).toBe(true); // negative-safe modulo
  });

  it("names middle C (MIDI 60) C5, as FL does", () => {
    expect(pitchName(60)).toBe("C5");
    expect(pitchName(59)).toBe("B4");
    expect(pitchName(61)).toBe("C#5");
  });
});

describe("gridline classification", () => {
  it("ranks bar over beat over step", () => {
    expect(gridlineWeight(0)).toBe("bar");
    expect(gridlineWeight(TICKS_PER_BAR)).toBe("bar");
    expect(gridlineWeight(TICKS_PER_BEAT)).toBe("beat");
    expect(gridlineWeight(TICKS_PER_STEP)).toBe("step");
  });

  it("draws nothing between steps", () => {
    expect(gridlineWeight(TICKS_PER_STEP / 2)).toBeNull();
    expect(gridlineWeight(1)).toBeNull();
    expect(gridlineWeight(12.5)).toBeNull();
  });

  it("alternates the beat band every beat", () => {
    expect(isBeatBanded(0)).toBe(false);
    expect(isBeatBanded(TICKS_PER_BEAT)).toBe(true);
    expect(isBeatBanded(2 * TICKS_PER_BEAT)).toBe(false);
    expect(isBeatBanded(TICKS_PER_BEAT + 5)).toBe(true); // mid-beat, same band
  });

  it("numbers bars from 1, as the ruler prints them", () => {
    expect(tickToBarNumber(0)).toBe(1);
    expect(tickToBarNumber(TICKS_PER_BAR - 1)).toBe(1);
    expect(tickToBarNumber(TICKS_PER_BAR)).toBe(2);
  });
});

describe("note rect + grip rect", () => {
  it("spans exactly the note's ticks and one row", () => {
    const view = createViewport();
    const rect = noteRect(view, note({ positionTicks: 96, lengthTicks: 96 }));
    expect(rect.x).toBeCloseTo(tickToX(view, 96), 6);
    expect(rect.width).toBeCloseTo(96 * BASE_PX_PER_TICK, 6);
    expect(rect.height).toBe(ROW_HEIGHT - 1);
    expect(rect.y).toBe(pitchToY(view, 60));
  });

  it("renders a zero-length note (a step) one step wide", () => {
    const view = createViewport();
    const step = noteRect(view, note({ lengthTicks: 0 }));
    expect(step.width).toBeCloseTo(TICKS_PER_STEP * BASE_PX_PER_TICK, 6);
  });

  it("puts the grip flush at the right edge, ~9 px wide", () => {
    const view = createViewport();
    const target = note({ lengthTicks: TICKS_PER_BEAT });
    const rect = noteRect(view, target);
    const grip = gripRect(view, target);
    expect(grip.width).toBe(GRIP_WIDTH);
    expect(grip.x + grip.width).toBeCloseTo(rect.x + rect.width, 6);
    expect(grip.y).toBe(rect.y);
  });

  it("never lets the grip eat more than half a short note", () => {
    const view = createViewport({ zoomX: 0.25 });
    const target = note({ lengthTicks: 6 });
    const rect = noteRect(view, target);
    expect(gripRect(view, target).width).toBeLessThanOrEqual(rect.width / 2);
  });

  it("contains points on its top-left edge but not its bottom-right", () => {
    const rect = { x: 10, y: 20, width: 30, height: 20 };
    expect(rectContains(rect, 10, 20)).toBe(true);
    expect(rectContains(rect, 39.9, 39.9)).toBe(true);
    expect(rectContains(rect, 40, 30)).toBe(false);
    expect(rectContains(rect, 20, 40)).toBe(false);
  });
});

describe("regions", () => {
  const view = createViewport({ width: 600, height: 400, velocityLaneHeight: 80 });

  it("splits keyboard, ruler, grid and velocity lane", () => {
    expect(regionAt(view, 10, 100)).toBe("keyboard");
    expect(regionAt(view, 10, 5)).toBe("keyboard");
    expect(regionAt(view, 300, 5)).toBe("ruler");
    expect(regionAt(view, 300, 100)).toBe("grid");
    expect(regionAt(view, 300, 380)).toBe("velocity");
    expect(regionAt(view, -1, 100)).toBe("outside");
  });

  it("puts the splitter between the grid and the lane", () => {
    expect(regionAt(view, 300, gridBottom(view) + 1)).toBe("splitter");
  });
});

describe("velocity lane", () => {
  const view = createViewport({ height: 400, velocityLaneHeight: 80 });

  it("round-trips velocity through the lane's y axis", () => {
    for (const velocity of [0, 0.25, 0.75, 1]) {
      expect(yToVelocity(view, velocityToY(view, velocity))).toBeCloseTo(velocity, 6);
    }
  });

  it("puts louder notes higher and clamps outside the lane", () => {
    expect(velocityToY(view, 1)).toBeLessThan(velocityToY(view, 0));
    expect(yToVelocity(view, 0)).toBe(1);
    expect(yToVelocity(view, view.height + 50)).toBe(0);
  });
});

describe("scroll + zoom", () => {
  it("never scrolls above zero or past the content", () => {
    const view = createViewport({ width: 600, height: 400 });
    expect(clampScroll(view, -50, -50)).toEqual({ scrollX: 0, scrollY: 0 });
    const far = clampScroll(view, 1e6, 1e6);
    expect(far.scrollX).toBeLessThan(1e6);
    expect(far.scrollY).toBeLessThan(1e6);
  });

  it("keeps the tick under the cursor fixed while zooming (§4.4 primitive)", () => {
    // Narrow viewport + deep zoom, so the 1-bar pattern is actually scrollable.
    const view = createViewport({ width: 300, zoomX: 4, scrollX: 120 });
    const cursorX = 200;
    const anchor = xToTick(view, cursorX);
    const next = zoomAtCursor(view, cursorX, view.zoomX * 1.75);
    expect(xToTick({ ...view, ...next }, cursorX)).toBeCloseTo(anchor, 6);
  });

  it("clamps zoom to the supported range", () => {
    const view = createViewport();
    expect(zoomAtCursor(view, 300, 500).zoomX).toBeLessThanOrEqual(8);
    expect(zoomAtCursor(view, 300, 0.001).zoomX).toBeGreaterThanOrEqual(0.25);
  });
});
