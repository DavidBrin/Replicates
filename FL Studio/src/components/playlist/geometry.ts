/**
 * Playlist pixel geometry — the only place screen-space math for this
 * surface happens. Everything downstream (paint position, drag deltas,
 * ruler labels) goes through here so it stays in lockstep with
 * `src/domain/tickMath.ts`'s bar/tick constants.
 */

import { SNAP_TICKS, snapTicks, snapTicksFloor, type SnapUnit } from "@/domain/tickMath";
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

/**
 * Snap a raw pointer x-offset (px, lane-relative) to a paintable tick — the
 * bar boundary at or before the pointer, since every pattern is exactly one
 * bar (SPEC.md §2). **Floor, not nearest**: painting places a clip in the cell
 * the pointer is *inside*, and rounding would place it in the next cell along
 * from the pointer's own half of the bar.
 *
 * `bypassSnap` is SPEC.md §4.4's "Alt held | bypass snap for this gesture":
 * the raw tick under the pointer, rounded to a whole tick and never negative.
 */
export function snapPointerToBar(
  offsetXPx: number,
  pxPerBar: number,
  bypassSnap = false,
): number {
  const rawTicks = pxToTicks(Math.max(0, offsetXPx), pxPerBar);
  if (bypassSnap) return Math.round(rawTicks);
  return snapTicksFloor(rawTicks, "bar" satisfies SnapUnit);
}

/**
 * Where a *moved* clip lands (SPEC.md §4.4). Unlike painting, a move is
 * nearest-bar: the clip is already a bar-wide object being nudged, so flooring
 * made the gesture asymmetric — four pixels leftward crossed a bar boundary
 * and jumped the clip a whole bar, while four pixels rightward did nothing.
 * Rounding puts the boundary where the user sees it, halfway.
 *
 * **The exact halfway tick needs `direction`.** `Math.round` breaks ties
 * *upward* — toward +∞ — and a drag distance is signed, so plain rounding is
 * asymmetric at precisely the boundary it exists to place: dragging a clip
 * right by exactly half a bar advanced it a full bar (1.5 → 2), while dragging
 * it left by exactly half a bar left it where it started (1.5 → 2 again, i.e.
 * back to its own position). Two mirror-image gestures, two different answers.
 *
 * At an exact tie the clip goes the way the pointer went — `direction`
 * carries the sign of the drag delta — so ±half a bar both move it one bar,
 * each in its own direction. Away from the tie nothing changes, and
 * `direction: 0` (an unsigned caller, a keyboard nudge) keeps the old
 * round-half-up behaviour rather than inventing a third rule.
 *
 * `bypassSnap` is Alt: the clip keeps the exact tick offset it was dragged by.
 */
export function snapMovedClipTick(
  rawTicks: number,
  bypassSnap = false,
  direction = 0,
): number {
  const clamped = Math.max(0, rawTicks);
  if (bypassSnap) return Math.round(clamped);
  const size = SNAP_TICKS.bar;
  const quotient = clamped / size;
  const floor = Math.floor(quotient);
  if (direction !== 0 && quotient - floor === 0.5) {
    return (direction > 0 ? floor + 1 : floor) * size;
  }
  return snapTicks(clamped, "bar" satisfies SnapUnit);
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
