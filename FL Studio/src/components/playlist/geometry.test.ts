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

/*
 * Round 7 #5. `Math.round` breaks ties toward +∞, and a drag delta is signed,
 * so the ONE tick the nearest-bar rule exists to place — the exact halfway
 * point — was the one it handled asymmetrically.
 */
describe("snapMovedClipTick — the exact half-bar tie is direction-aware", () => {
  const half = TICKS_PER_BAR / 2;

  it("advances a bar on a rightward drag of exactly half a bar", () => {
    // Clip at bar 1, dragged RIGHT by exactly half a bar.
    expect(snapMovedClipTick(TICKS_PER_BAR + half, false, 1)).toBe(TICKS_PER_BAR * 2);
  });

  it("retreats a bar on a leftward drag of exactly half a bar — the mirror image", () => {
    // Clip at bar 1, dragged LEFT by exactly half a bar. Round-half-up put it
    // back at bar 1, so the same distance moved the clip one way and not the
    // other.
    expect(snapMovedClipTick(TICKS_PER_BAR - half, false, -1)).toBe(0);
  });

  it("moves both signs by the SAME number of bars from the same start", () => {
    const start = TICKS_PER_BAR * 4;
    const right = snapMovedClipTick(start + half, false, 1);
    const left = snapMovedClipTick(start - half, false, -1);
    expect(right - start).toBe(TICKS_PER_BAR);
    expect(start - left).toBe(TICKS_PER_BAR);
  });

  it("changes nothing away from the tie, in either direction", () => {
    expect(snapMovedClipTick(TICKS_PER_BAR + half - 1, false, 1)).toBe(TICKS_PER_BAR);
    expect(snapMovedClipTick(TICKS_PER_BAR + half + 1, false, 1)).toBe(TICKS_PER_BAR * 2);
    expect(snapMovedClipTick(TICKS_PER_BAR + half - 1, false, -1)).toBe(TICKS_PER_BAR);
    expect(snapMovedClipTick(TICKS_PER_BAR + half + 1, false, -1)).toBe(TICKS_PER_BAR * 2);
  });

  it("keeps round-half-up for a caller with no direction to offer", () => {
    expect(snapMovedClipTick(half)).toBe(TICKS_PER_BAR);
    expect(snapMovedClipTick(half, false, 0)).toBe(TICKS_PER_BAR);
  });

  it("still never returns a negative tick at a leftward tie", () => {
    expect(snapMovedClipTick(-half, false, -1)).toBe(0);
  });

  it("leaves Alt (bypassSnap) alone — the tie policy is a SNAP rule", () => {
    expect(snapMovedClipTick(TICKS_PER_BAR + half, true, -1)).toBe(TICKS_PER_BAR + half);
  });
});
