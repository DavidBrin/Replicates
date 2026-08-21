"use client";

import { useRef, useState } from "react";

import { TEMPO_MAX, TEMPO_MIN, clampTempo } from "@/components/shell/wiring";

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
  const dragState = useRef<{ startY: number; startValue: number } | null>(
    null,
  );

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
    dragState.current = { startY: event.clientY, startValue: value };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const deltaY = drag.startY - event.clientY; // up = increase
    onChange(clampTempo(drag.startValue + deltaY, min, max));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
    }
    dragState.current = null;
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
