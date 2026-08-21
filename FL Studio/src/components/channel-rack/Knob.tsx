"use client";

import { useRef } from "react";

/**
 * Shared pan/volume knob (SPEC §1.1 "Pan knob" / "Volume knob"; lane 1 §1.4,
 * §8–9). Vertical drag adjusts the value; Alt+click *or* double-click resets
 * to `defaultValue` (lane 1 §9's "Alt+click (or middle-click) knob | reset to
 * default"); the whole drag gesture is meant to fold into one undo entry, so
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
}

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

  function mintCoalesceKey(): string {
    gestureCounter += 1;
    return `knob:${label}:${gestureCounter}`;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.altKey) {
      resetToDefault();
      return;
    }
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragState.current = {
      startY: event.clientY,
      startValue: value,
      coalesceKey: mintCoalesceKey(),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const deltaY = drag.startY - event.clientY; // up = increase
    const range = max - min;
    const next = clamp(drag.startValue + (deltaY / travelPx) * range, min, max);
    onChange(next, drag.coalesceKey);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
    }
    dragState.current = null;
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
      onDoubleClick={resetToDefault}
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
