"use client";

import { useRef } from "react";

import { useGestureSession } from "@/lib/gestureHold";
import { CUSTOM_SLIDER_KEYS, claimHandledKey } from "@/lib/keyboard";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How close two control values have to be before an edit is a NO-OP.
 *
 * The values here are floats — a pan of `0`, a volume of `0.8`, whatever a
 * drag left behind — so the comparison cannot be `===`: a knob dragged away
 * and back lands on `0.7999999999999999`, which is the default to every
 * meaning the user has for the word. An absolute epsilon is right rather than
 * a relative one because the whole range is `[min, max]` with the widest span
 * in this app being 2 (pan's `-1..1`), so there is no scale for it to lose.
 */
const NO_OP_EPSILON = 1e-9;

function isNoOp(next: number, current: number): boolean {
  return Math.abs(next - current) <= NO_OP_EPSILON;
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
  /**
   * SPEC §2.2: no autosave lands while this knob is held
   * (`@/lib/gestureHold`), and the session's id IS this gesture's
   * `coalesceKey` — a knob makes one entry per gesture by minting a key
   * unique to it (`domain/undo.ts`'s second supported pattern), and the
   * session already mints exactly that, from a module counter no remount can
   * rewind.
   *
   * `onCancel` is the half a private `useRef` cannot have: the session ends
   * from the OUTSIDE too — an undo/redo/import under the pointer, unmount,
   * another gesture pre-empting this one — and a `dragState` left set made
   * the next pointer MOVE (a hover, no button down) push this dead drag's
   * `startValue` and key into the replacement project.
   */
  const gesture = useGestureSession("knob", {
    onCancel: () => {
      dragState.current = null;
    },
  });

  /** A one-shot edit's key: the reset, and each arrow-key nudge. */
  function mintCoalesceKey(): string {
    return gesture.keyFor();
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
    dragState.current = {
      startY: event.clientY,
      startValue: value,
      // The pointer id goes with it: the session scopes its terminators to
      // the pointer that opened it (`@/lib/gestureHold`).
      coalesceKey: gesture.begin(event),
      lastY: event.clientY,
      accumulated: 0,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    // Only the pointer that opened the drag drives it (`@/lib/gestureHold`
    // rule (g)). A second finger landing on the knob used to move the value
    // by ITS distance from the owner's `startY`, which is a jump to wherever
    // that finger happened to be.
    if (!gesture.ownsEvent(event)) return;
    const deltaY = drag.lastY - event.clientY; // up = increase
    const range = max - min;
    const sensitivity = event.ctrlKey ? 1 / FINE_DRAG_DIVISOR : 1;
    drag.lastY = event.clientY;
    drag.accumulated += (deltaY / travelPx) * range * sensitivity;
    const next = clamp(drag.startValue + drag.accumulated, min, max);
    onChange(next, drag.coalesceKey);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    // A release by a pointer that does not own the drag is not this drag's
    // end: ending here would seal the undo entry with the owner's button
    // still down, and every later move of the real drag would land in a
    // second entry.
    if (dragState.current && !gesture.ownsEvent(event)) return;
    if (dragState.current) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
    }
    dragState.current = null;
    gesture.end();
  }

  /**
   * A cancelled pointer never delivers `pointerup`. Leaving `dragState` set
   * turned every subsequent *hover* over the knob into a value change with no
   * button held — the pointer-move handler only ever asked whether a drag
   * existed, never whether one was still under a pressed button.
   */
  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current && !gesture.ownsEvent(event)) return;
    dragState.current = null;
    gesture.end();
  }

  /**
   * Alt+click / middle-click / double-click / Enter / Space — "reset to
   * default" (SPEC §4.4).
   *
   * A knob that is ALREADY at its default dispatches nothing. It used to
   * dispatch anyway, and the result was an undo entry that undoes nothing —
   * one `Ctrl+Z` spent putting a value back where it already was, with the
   * edit the user actually wanted to take back still one press further down —
   * plus a store write and the autosave it schedules. Every channel starts at
   * pan `0` / volume `0.8`, so "reset a control that is already default" is
   * not an exotic case: it is what a double-click on an untouched knob does.
   */
  function resetToDefault(): void {
    changeValue(defaultValue);
  }

  /**
   * The single dispatch point for every ONE-SHOT edit — the reset and the
   * arrow nudges — with the no-op check in it, so a new one-shot cannot be
   * added without it. An arrow key held at either end of the range is the same
   * no-op as the already-default reset: the value is clamped and unchanged,
   * and each repeat used to file its own history entry.
   *
   * The drag path is deliberately NOT routed through here. Its dispatches all
   * share one `coalesceKey` and fold into a single undo entry, so a repeated
   * value there costs nothing a user can see, and it holds the session that
   * defers autosave anyway.
   */
  function changeValue(next: number): void {
    if (isNoOp(next, value)) return;
    onChange(next, mintCoalesceKey());
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
      // A key this knob acts on is this knob's; the global registry listens
      // on the window and used to see it too, so `Space` reset the knob AND
      // toggled playback, and the arrows nudged the knob AND transposed the
      // piano roll's selection (`@/lib/keyboard`).
      onKeyDown={(event) => {
        if (!claimHandledKey(event, CUSTOM_SLIDER_KEYS)) return;
        if (event.key === "ArrowUp") changeValue(clamp(value + (max - min) / 100, min, max));
        if (event.key === "ArrowDown") changeValue(clamp(value - (max - min) / 100, min, max));
        if (event.key === "Enter" || event.key === " ") resetToDefault();
      }}
    >
      <div className="fl-knob__dial" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="fl-knob__indicator" />
      </div>
    </div>
  );
}
