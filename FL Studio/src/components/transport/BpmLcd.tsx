"use client";

import { useRef, useState } from "react";

import { TEMPO_MAX, TEMPO_MIN, clampTempo } from "@/components/shell/wiring";
import { useGestureHold } from "@/lib/gestureHold";

/** Vertical travel below which a press is still a click, not a tempo drag. */
const DRAG_SLOP_PX = 2;

export interface BpmLcdProps {
  value: number;
  onChange: (bpm: number) => void;
  min?: number;
  max?: number;
}

/**
 * Tempo LCD (SPEC §4.3 LCD plate token; lane 1 §1.3/§1.2): "drag + type-in,
 * live-safe" per SPEC §1.1's transport row. Left-click and hold + type
 * commits a value on Enter/blur; the `▲`/`▼` spinner steps by 1;
 * vertical drag adjusts live while dragging, both clamped to
 * `[min, max]` (spec default 10–522).
 */
export function BpmLcd({
  value,
  onChange,
  min = TEMPO_MIN,
  max = TEMPO_MAX,
}: BpmLcdProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const dragState = useRef<{
    startY: number;
    startValue: number;
    /** Set by the first move that clears {@link DRAG_SLOP_PX} — a drag, not a click. */
    moved: boolean;
  } | null>(null);
  /**
   * A completed drag must not also open the text editor.
   *
   * `click` fires *after* `pointerup`, and pointer-up had already cleared
   * `dragState`, so the click handler's "was I dragging?" test looked at
   * `null` and answered no — every finished drag ended in the edit box, with
   * the tempo it had just been dragged to sitting in a field the user has to
   * dismiss. The verdict is latched at pointer-up instead and consumed by the
   * click that follows.
   */
  const suppressNextClick = useRef(false);
  /**
   * SPEC §2.2: no autosave lands while the LCD is being dragged.
   *
   * `onCancel` clears the drag whenever the session ends from outside this
   * component — an undo/redo/import replacing the project under the pointer,
   * unmount, another gesture pre-empting this one. A `dragState` left set
   * made every later HOVER over the plate a tempo change with no button held,
   * computed from a `startValue` the replacement project never had.
   */
  const gesture = useGestureHold("bpm-lcd", {
    onCancel: () => {
      // The DRAG only. `suppressNextClick` is a verdict about the click that
      // has not happened yet, latched by `handlePointerUp` immediately before
      // it releases the session — clearing it here threw that verdict away
      // and every completed drag ended in the text editor again.
      dragState.current = null;
    },
  });

  function beginEditing(): void {
    setDraft(String(value));
    setEditing(true);
  }

  function commit(raw: string): void {
    const parsed = Number.parseFloat(raw);
    onChange(clampTempo(Number.isFinite(parsed) ? parsed : value, min, max));
    setEditing(false);
  }

  /**
   * The `▲`/`▼` spinner lives INSIDE the LCD plate, so its pointer events
   * bubble straight into this initializer: pressing a spinner armed a tempo
   * drag, and the smallest twitch before release both dragged the tempo *and*
   * then applied the button's ±1 on click — two edits from one press, the
   * drag's landing value silently overwritten by the increment.
   *
   * A drag starts only on a PRIMARY press on the plate itself (the value face
   * and its surrounding chrome). Any press inside the spinner is the
   * spinner's, and any non-primary press is nobody's.
   */
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    if (event.button !== 0) return;
    if ((event.target as Element).closest?.(".fl-lcd__spinner")) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    // The pointer id scopes the session's terminators to THIS press
    // (`@/lib/gestureHold`), and marks it as the same press that opened the
    // tempo session wrapped around this plate, so the two do not pre-empt
    // each other.
    gesture.hold(event);
    dragState.current = { startY: event.clientY, startValue: value, moved: false };
    suppressNextClick.current = false;
  }

  /**
   * Nothing changes until the pointer has cleared {@link DRAG_SLOP_PX}.
   *
   * The slop threshold latched `moved` — which correctly stopped a twitchy
   * click from being swallowed as a drag — but the value change itself was
   * dispatched on EVERY move, slop or no slop. So a click that wandered one
   * pixel still edited the tempo: `moved` stayed false, the click opened the
   * editor as intended, and the field came up holding a BPM the user never
   * asked for, one off the project's real tempo, with an undo entry behind
   * it. An intended click must leave the tempo exactly where it found it.
   *
   * Once the threshold is crossed the drag reports continuously from its
   * ORIGINAL anchor, so the value still tracks total travel rather than
   * jumping by the slop it spent getting there.
   */
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    // The drag belongs to the pointer that opened it (`@/lib/gestureHold`
    // rule (g)); a second pointer's y against this drag's anchor is a tempo
    // jump the user never asked for.
    if (!gesture.ownsEvent(event)) return;
    const deltaY = drag.startY - event.clientY; // up = increase
    if (Math.abs(deltaY) > DRAG_SLOP_PX) drag.moved = true;
    if (!drag.moved) return;
    onChange(clampTempo(drag.startValue + deltaY, min, max));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    // Not this drag's release: it must not latch the click verdict or seal
    // the tempo gesture while the owning button is still down.
    if (drag && !gesture.ownsEvent(event)) return;
    if (drag) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      suppressNextClick.current = drag.moved;
    }
    dragState.current = null;
    gesture.release();
  }

  /**
   * A cancelled pointer (capture lost, a system gesture, the tab hidden) never
   * delivers `pointerup`, and the drag state left behind turned every later
   * *hover* over the LCD into a tempo change with no button held.
   */
  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current && !gesture.ownsEvent(event)) return;
    dragState.current = null;
    suppressNextClick.current = false;
    gesture.release();
  }

  return (
    <div
      className="fl-lcd"
      data-testid="bpm-lcd"
      role="spinbutton"
      aria-label="Tempo (BPM)"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          inputMode="decimal"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(draft);
            if (event.key === "Escape") {
              setDraft(String(value));
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          onDoubleClick={beginEditing}
          onClick={(event) => {
            // A click that wasn't the start of a drag opens the editor,
            // matching FL's "left-click and hold while typing" idiom closely
            // enough for a single-click affordance in a mouse-driven UI.
            const wasDrag = suppressNextClick.current;
            suppressNextClick.current = false;
            if (wasDrag) return;
            if (event.detail >= 1 && !dragState.current) beginEditing();
          }}
        >
          {value.toFixed(0)}
        </span>
      )}
      <span className="fl-lcd__unit">BPM</span>
      <span className="fl-lcd__spinner">
        <button
          type="button"
          aria-label="Increase tempo"
          onClick={() => onChange(clampTempo(value + 1, min, max))}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="Decrease tempo"
          onClick={() => onChange(clampTempo(value - 1, min, max))}
        >
          ▼
        </button>
      </span>
    </div>
  );
}
