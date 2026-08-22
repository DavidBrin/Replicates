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

/**
 * How close two levels have to be before an edit is a NO-OP — the knob's
 * epsilon, restated rather than imported (`channel-rack/Knob.tsx`): a mixer
 * strip reaching across into a channel-rack module for a constant would be the
 * first cross-surface import in the tree, and this is two lines.
 *
 * Not `===`, because these are floats: a fader dragged away and back lands on
 * `0.7999999999999999`, which is unity to every meaning the user has for the
 * word.
 */
const NO_OP_EPSILON = 1e-9;

function isNoOp(next: number, current: number): boolean {
  return Math.abs(next - current) <= NO_OP_EPSILON;
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

  /**
   * Double-click / Enter / Space — reset to unity. A fader ALREADY at unity
   * dispatches nothing: the knob's rule (`channel-rack/Knob.tsx`), for the
   * same reason. Every strip starts at the default volume, so double-clicking
   * an untouched fader used to buy a `Ctrl+Z` that undoes nothing and a
   * persistence write with no change in it.
   */
  function resetToDefault(): void {
    changeValue(defaultValue);
  }

  /**
   * The one-shot dispatch point — reset and arrow nudges — carrying the no-op
   * check. An arrow held at the top or bottom of the throw is clamped to the
   * value it already has, and each repeat used to file its own undo entry.
   * The drag path stays direct — it reuses the session's key rather than
   * minting one — but carries the same {@link isNoOp} check for the same
   * reason.
   */
  function changeValue(next: number): void {
    if (isNoOp(next, value)) return;
    onChange(next, mintCoalesceKey());
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
    // Only the pointer that opened the drag drives it (`@/lib/gestureHold`
    // rule (g)) — a second pointer's coordinates against this drag's
    // `startY` is a jump, not a move.
    if (!gesture.ownsEvent(event)) return;
    const deltaY = drag.startY - event.clientY; // up = increase, matches a physical fader
    const range = max - min;
    const next = clamp(drag.startValue + (deltaY / travelPx) * range, min, max);
    // Past the top or bottom of the throw the clamp repeats the level the
    // fader already has, and each repeat dispatched — the first filing an
    // undo entry that undoes nothing, the rest costing a store write and an
    // autosave schedule apiece. `startValue`/`startY` are untouched, so the
    // level still tracks total travel once the pointer comes back in range.
    if (isNoOp(next, value)) return;
    onChange(next, drag.coalesceKey);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    // A foreign pointer's release is not this drag's end — sealing here would
    // close the undo entry with the owning button still down.
    if (dragState.current && !gesture.ownsEvent(event)) return;
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
  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragState.current && !gesture.ownsEvent(event)) return;
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
        if (event.key === "ArrowUp") changeValue(clamp(value + step, min, max));
        if (event.key === "ArrowDown") changeValue(clamp(value - step, min, max));
        if (event.key === "Enter" || event.key === " ") resetToDefault();
      }}
    >
      <div className="fl-fader__track">
        <div className="fl-fader__handle" style={{ bottom: `${percent}%` }} data-testid={`fader-handle-${label}`} />
      </div>
    </div>
  );
}
