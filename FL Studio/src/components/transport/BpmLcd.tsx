"use client";

import { useRef, useState } from "react";

import { TEMPO_MAX, TEMPO_MIN, clampTempo } from "@/components/shell/wiring";

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

  function beginEditing(): void {
    setDraft(String(value));
    setEditing(true);
  }

  function commit(raw: string): void {
    const parsed = Number.parseFloat(raw);
    onChange(clampTempo(Number.isFinite(parsed) ? parsed : value, min, max));
    setEditing(false);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragState.current = { startY: event.clientY, startValue: value, moved: false };
    suppressNextClick.current = false;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const deltaY = drag.startY - event.clientY; // up = increase
    if (Math.abs(deltaY) > DRAG_SLOP_PX) drag.moved = true;
    onChange(clampTempo(drag.startValue + deltaY, min, max));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (drag) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      suppressNextClick.current = drag.moved;
    }
    dragState.current = null;
  }

  /**
   * A cancelled pointer (capture lost, a system gesture, the tab hidden) never
   * delivers `pointerup`, and the drag state left behind turned every later
   * *hover* over the LCD into a tempo change with no button held.
   */
  function handlePointerCancel() {
    dragState.current = null;
    suppressNextClick.current = false;
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
