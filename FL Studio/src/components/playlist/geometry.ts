/**
 * Playlist pixel geometry — the only place screen-space math for this
 * surface happens. Everything downstream (paint position, drag deltas,
 * ruler labels) goes through here so it stays in lockstep with
 * `src/domain/tickMath.ts`'s bar/tick constants.
 */

import { snapTicksFloor, type SnapUnit } from "@/domain/tickMath";
import { TICKS_PER_BAR } from "@/domain/types";

export const LANE_HEIGHT_PX = 64;
export const HEADER_WIDTH_PX = 168;
export const RULER_HEIGHT_PX = 24;
export const CLIP_HEADER_HEIGHT_PX = 16;

/** Bars kept visible past the furthest clip, so there's always room to paint. */
export const TRAILING_BARS = 8;
export const MIN_VISIBLE_BARS = 16;

export function ticksToPx(ticks: number, pxPerBar: number): number {
  return (ticks / TICKS_PER_BAR) * pxPerBar;
}

export function pxToTicks(px: number, pxPerBar: number): number {
  return (px / pxPerBar) * TICKS_PER_BAR;
}

/** Snap a raw pointer x-offset (px, lane-relative) to a paintable tick — always a bar boundary, since every pattern is exactly one bar (SPEC.md §2). */
export function snapPointerToBar(offsetXPx: number, pxPerBar: number): number {
  const rawTicks = pxToTicks(Math.max(0, offsetXPx), pxPerBar);
  return snapTicksFloor(rawTicks, "bar" satisfies SnapUnit);
}

export function totalVisibleBars(furthestClipEndTicks: number): number {
  const clipBars = Math.ceil(furthestClipEndTicks / TICKS_PER_BAR);
  return Math.max(MIN_VISIBLE_BARS, clipBars + TRAILING_BARS);
}

/**
 * Ctrl+wheel zoom-at-cursor (SPEC.md §4.4, same non-negotiable primitive as
 * the piano roll's `zoomAtCursor`): the tick under the pointer must stay
 * under the pointer. `anchorTicks` is the tick that was under the cursor
 * *before* the zoom changed `pxPerBar`; `pointerOffsetPx` is the cursor's
 * distance from the scroll container's left edge (viewport space, not
 * content space). The result is the `scrollLeft` that keeps that tick fixed.
 */
export function scrollLeftForZoom(
  anchorTicks: number,
  pointerOffsetPx: number,
  pxPerBar: number,
): number {
  return Math.max(0, ticksToPx(anchorTicks, pxPerBar) - pointerOffsetPx);
}
