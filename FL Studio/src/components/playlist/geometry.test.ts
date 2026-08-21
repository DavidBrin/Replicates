import { describe, expect, it } from "vitest";

import { pxToTicks, scrollLeftForZoom, ticksToPx } from "./geometry";

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
