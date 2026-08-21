"use client";

import { useRef } from "react";

import { useGestureHold } from "@/lib/gestureHold";

/**
 * Shared pan/volume knob (SPEC §1.1 "Pan knob" / "Volume knob"; lane 1 §1.4,
 * §8–9). Vertical drag adjusts the value, ten times finer while `Ctrl` is
 * held (SPEC §4.4 "Ctrl-drag = fine"), and the modifier is read per move so
 * it can be taken and released mid-drag; Alt+click, middle-click *or*
 * double-click resets to `defaultValue` (SPEC §4.4's "Alt+click (or
 * middle-click) knob | reset to default" — all three, since the row's
 * pointer handlers make the first two free);
 * the whole drag gesture is meant to fold into one undo entry, so
 * every intermediate `onChange` during a drag carries the same
 * `coalesceKey` and the caller passes it straight through to
 * `dispatch(cmd, { coalesceKey })` (SPEC §2.1).
 */
export interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  /** Pixels of vertical drag to cross the full `[min, max]` range. */
  travelPx?: number;
  onChange: (value: number, coalesceKey: string) => void;
  formatValue?: (value: number) => string;
}

interface DragState {
  startY: number;
  startValue: number;
  coalesceKey: string;
  /**
   * Where the *coarse* travel stands, in value units, at the moment the last
   * move was processed. Ctrl is a live modifier — pressed and released mid-drag
   * — so sensitivity cannot be a property of the gesture, only of the segment
   * between two moves. Each move applies its own pixel delta at its own
   * sensitivity on top of this accumulator, which is why letting go of Ctrl
   * resumes coarse dragging from wherever the fine pass left the knob instead
   * of snapping back to a value derived from the whole drag.
   */
  lastY: number;
  accumulated: number;
}

/** Ctrl held during a knob drag: one pixel moves a tenth as far (SPEC §4.4). */
export const FINE_DRAG_DIVISOR = 10;

let gestureCounter = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Knob({
  value,
  min,
  max,
  defaultValue,
  label,
  travelPx = 120,
  onChange,
  formatValue,
}: KnobProps) {
  const dragState = useRef<DragState | null>(null);
  // SPEC §2.2: no autosave lands while this knob is held (`@/lib/gestureHold`).
  const gesture = useGestureHold("knob");

  function mintCoalesceKey(): string {
    gestureCounter += 1;
    return `knob:${label}:${gestureCounter}`;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Alt+click *or* middle-click resets (SPEC §4.4: "Alt+click (or
    // middle-click) knob | reset to default"). Middle-click is checked before
    // anything else claims the press — there is no middle-button drag here, so
    // the button never opens a gesture.
    if (event.altKey || event.button === 1) {
      event.preventDefault();
      resetToDefault();
      return;
    }
    if (event.button !== 0) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    gesture.hold();
    dragState.current = {
      startY: event.clientY,
      startValue: value,
      coalesceKey: mintCoalesceKey(),
      lastY: event.clientY,
      accumulated: 0,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const deltaY = drag.lastY - event.clientY; // up = increase
    const range = max - min;
    const sensitivity = event.ctrlKey ? 1 / FINE_DRAG_DIVISOR : 1;
    drag.lastY = event.clientY;
    drag.accumulated += (deltaY / travelPx) * range * sensitivity;
    const next = clamp(drag.startValue + drag.accumulated, min, max);
    onChange(next, drag.coalesceKey);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
    }
    dragState.current = null;
    gesture.release();
  }

  /**
   * A cancelled pointer never delivers `pointerup`. Leaving `dragState` set
   * turned every subsequent *hover* over the knob into a value change with no
   * button held — the pointer-move handler only ever asked whether a drag
   * existed, never whether one was still under a pressed button.
   */
  function handlePointerCancel() {
    dragState.current = null;
    gesture.release();
  }

  function resetToDefault(): void {
    onChange(defaultValue, mintCoalesceKey());
  }

  const percent = ((value - min) / (max - min)) * 100;
  const angle = -135 + (percent / 100) * 270; // 270-degree sweep, matches a hardware knob idiom

  return (
    <div
      className="fl-knob"
      data-testid={`knob-${label}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatValue ? formatValue(value) : value.toFixed(2)}
      data-off-default={value !== defaultValue}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={resetToDefault}
      // Middle-click's default is the browser's autoscroll/paste; the reset
      // already ran on pointer-down, so the auxiliary click is swallowed here.
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") onChange(clamp(value + (max - min) / 100, min, max), mintCoalesceKey());
        if (event.key === "ArrowDown") onChange(clamp(value - (max - min) / 100, min, max), mintCoalesceKey());
        if (event.key === "Enter" || event.key === " ") resetToDefault();
      }}
    >
      <div className="fl-knob__dial" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="fl-knob__indicator" />
      </div>
    </div>
  );
}
