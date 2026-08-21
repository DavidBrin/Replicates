import { describe, expect, it } from "vitest";

import { TICKS_PER_BAR } from "@/domain/types";

import {
  pxToTicks,
  scrollLeftForZoom,
  snapMovedClipTick,
  snapPointerToBar,
  ticksToPx,
} from "./geometry";

describe("scrollLeftForZoom", () => {
  it("keeps the tick under the pointer fixed across a zoom change", () => {
    const oldPxPerBar = 80;
    const newPxPerBar = 92;
    const scrollLeftBefore = 0;
    const pointerOffsetPx = 40;

    // Tick under the pointer before the zoom, per the caller's contract.
    const anchorTicks = pxToTicks(scrollLeftBefore + pointerOffsetPx, oldPxPerBar);

    const scrollLeftAfter = scrollLeftForZoom(anchorTicks, pointerOffsetPx, newPxPerBar);

    // The same tick, re-measured against the new scrollLeft/zoom, must land
    // back at the same pointer offset.
    const tickUnderPointerAfter = pxToTicks(scrollLeftAfter + pointerOffsetPx, newPxPerBar);
    expect(tickUnderPointerAfter).toBeCloseTo(anchorTicks, 6);
  });

  it("matches the direct algebraic result", () => {
    const anchorTicks = 192; // bar 0.5 at TICKS_PER_BAR=384
    const pointerOffsetPx = 40;
    const pxPerBar = 92;
    expect(scrollLeftForZoom(anchorTicks, pointerOffsetPx, pxPerBar)).toBeCloseTo(
      ticksToPx(anchorTicks, pxPerBar) - pointerOffsetPx,
      6,
    );
  });

  it("never returns a negative scroll offset", () => {
    expect(scrollLeftForZoom(0, 500, 24)).toBe(0);
  });
});

/*
 * Round 6 #4/#5. Painting floors (the clip goes in the cell the pointer is
 * inside); a MOVE rounds (the boundary sits halfway, so four pixels left and
 * four pixels right behave alike); Alt bypasses snap in both (SPEC.md §4.4).
 */
describe("snapPointerToBar", () => {
  it("floors to the bar the pointer is inside", () => {
    expect(snapPointerToBar(79, 80)).toBe(0);
    expect(snapPointerToBar(80, 80)).toBe(TICKS_PER_BAR);
    expect(snapPointerToBar(159, 80)).toBe(TICKS_PER_BAR);
  });

  it("returns the raw tick under the pointer when snap is bypassed", () => {
    expect(snapPointerToBar(40, 80, true)).toBe(TICKS_PER_BAR / 2);
    expect(snapPointerToBar(79, 80, true)).toBe(Math.round((79 / 80) * TICKS_PER_BAR));
  });

  it("never returns a negative tick, bypassed or not", () => {
    expect(snapPointerToBar(-500, 80)).toBe(0);
    expect(snapPointerToBar(-500, 80, true)).toBe(0);
  });
});

describe("snapMovedClipTick", () => {
  it("rounds to the NEAREST bar, symmetrically about the boundary", () => {
    const nudgeLeft = TICKS_PER_BAR - 20;
    const nudgeRight = TICKS_PER_BAR + 20;
    expect(snapMovedClipTick(nudgeLeft)).toBe(TICKS_PER_BAR);
    expect(snapMovedClipTick(nudgeRight)).toBe(TICKS_PER_BAR);
  });

  it("crosses to the next bar only past the halfway point", () => {
    expect(snapMovedClipTick(TICKS_PER_BAR / 2 - 1)).toBe(0);
    expect(snapMovedClipTick(TICKS_PER_BAR / 2 + 1)).toBe(TICKS_PER_BAR);
  });

  it("keeps the exact tick when snap is bypassed", () => {
    expect(snapMovedClipTick(TICKS_PER_BAR + 20, true)).toBe(TICKS_PER_BAR + 20);
  });

  it("never returns a negative tick", () => {
    expect(snapMovedClipTick(-TICKS_PER_BAR)).toBe(0);
    expect(snapMovedClipTick(-TICKS_PER_BAR, true)).toBe(0);
  });
});
