"use client";

import { useRef } from "react";

import { useGestureSession } from "@/lib/gestureHold";
import { CUSTOM_SLIDER_KEYS, claimHandledKey } from "@/lib/keyboard";

/**
 * The mixer's long-throw vertical level fader (SPEC §4.3 mixer tokens; lane
 * 1 §5.2: "a wide, short, pale horizontal-cap slider handle running in a
 * vertical track… turn orange when the track is not at default"). Modelled
 * after `channel-rack/Knob.tsx`'s drag-coalescing contract — every
 * intermediate `onChange` during one drag carries the same `coalesceKey` so
 * the whole gesture folds into a single undo entry (SPEC §2.1) — but shaped
 * as a vertical track instead of a rotary dial, and reset via *double-click
 * only* ("Double-click fader = reset to unity per FL convention" — no
 * Alt+click reset for faders, unlike knobs).
 */
export interface FaderProps {
  value: number;
  min: number;
  max: number;
  /** The unity/default position (SPEC: mixer default volume 0.8). */
  defaultValue: number;
  label: string;
  /** Pixels of the track's travel; the handle moves the same distance as the pointer. */
  travelPx?: number;
  onChange: (value: number, coalesceKey: string) => void;
}

interface DragState {
  startY: number;
  startValue: number;
  coalesceKey: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Fader({ value, min, max, defaultValue, label, travelPx = 140, onChange }: FaderProps) {
  const dragState = useRef<DragState | null>(null);
  /**
   * SPEC §2.2: no autosave lands while the fader is held
   * (`@/lib/gestureHold`), and the session's id is this gesture's
   * `coalesceKey` — the knob's contract exactly, including `onCancel`, which
   * clears the drag when the session is ended from outside (an undo under the
   * pointer, unmount, pre-emption). A `dragState` left set turned the next
   * hover into a level change with no button held.
   */
  const gesture = useGestureSession("fader", {
    onCancel: () => {
      dragState.current = null;
    },
  });

  /** A one-shot edit's key: the double-click reset, each arrow-key nudge. */
  function mintCoalesceKey(): string {
    return gesture.keyFor();
  }

  function resetToDefault(): void {
    onChange(defaultValue, mintCoalesceKey());
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    // Primary button only. Every button opened a drag, so a right-click on the
    // fader (which delivers no `pointerup` once the context menu takes over,
    // and none at all on the middle button's autoscroll) armed a gesture that
    // then moved the level on plain hover. The knob already guards this way.
    if (event.button !== 0) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragState.current = {
      startY: event.clientY,
      startValue: value,
      coalesceKey: gesture.begin(event),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragState.current;
    if (!drag) return;
    const deltaY = drag.startY - event.clientY; // up = increase, matches a physical fader
    const range = max - min;
    const next = clamp(drag.startValue + (deltaY / travelPx) * range, min, max);
    onChange(next, drag.coalesceKey);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragState.current) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
    }
    dragState.current = null;
    gesture.end();
  }

  /**
   * A cancelled pointer never delivers `pointerup`, and the drag left open
   * behind it made every later *hover* over the fader move the level with no
   * button held — the same hole the knob had.
   */
  function handlePointerCancel(): void {
    dragState.current = null;
    gesture.end();
  }

  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div
      className="fl-fader"
      data-testid={`fader-${label}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-off-default={value !== defaultValue}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={resetToDefault}
      // The keys this fader acts on stop here — the window-level registry
      // used to see them too (`@/lib/keyboard`).
      onKeyDown={(event) => {
        if (!claimHandledKey(event, CUSTOM_SLIDER_KEYS)) return;
        const step = (max - min) / 100;
        if (event.key === "ArrowUp") onChange(clamp(value + step, min, max), mintCoalesceKey());
        if (event.key === "ArrowDown") onChange(clamp(value - step, min, max), mintCoalesceKey());
        if (event.key === "Enter" || event.key === " ") resetToDefault();
      }}
    >
      <div className="fl-fader__track">
        <div className="fl-fader__handle" style={{ bottom: `${percent}%` }} data-testid={`fader-handle-${label}`} />
      </div>
    </div>
  );
}
