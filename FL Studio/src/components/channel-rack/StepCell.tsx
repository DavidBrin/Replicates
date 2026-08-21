"use client";

/**
 * One 16th-note step button — portrait 20×32 rounded rect at 24 px pitch
 * (SPEC §4.3; lane 1 §2.3). Colour comes entirely from CSS via
 * `data-group`/`data-on` (`channelRack.css`'s cool/warm 4-step alternation,
 * lane 1 §2.4) — this component makes no colour decisions itself.
 *
 * Purely presentational: the parent row owns the paint-stroke state machine
 * (SPEC §2.1 drag coalescing — "commit one command on pointer-up") and just
 * tells this cell what to render and what raw gesture events to forward.
 */
import { useCallback, useRef } from "react";

import { useNonPassiveWheel } from "@/lib/useNonPassiveWheel";

export interface StepCellProps {
  step: number; // 0-based, 0..15
  on: boolean;
  isPlayhead: boolean;
  /**
   * `pointerId` travels with every one of these, because the row's stroke is
   * scoped to the press that opened it: its window backstop must ignore some
   * OTHER pointer's release (a second finger, a stylus the app never saw),
   * and the shared gesture registry uses the same id to tell "this stroke
   * walked into the next row" from "a different gesture started".
   */
  onPointerDown: (button: number, pointerId: number) => void;
  onPointerEnter: (buttons: number, pointerId: number) => void;
  /**
   * `buttons` is the live button mask at `contextmenu` time, and the row needs
   * it to tell a right-BUTTON press (mask has bit 2 — a sweep is starting, and
   * a `pointerup` will close it) from a KEYBOARD context-menu request (mask is
   * empty: the ContextMenu key, or Shift+F10, on a focused cell). The keyboard
   * one is a one-shot with no pointer-up coming; see `beginRightPaint`.
   */
  onContextMenu: (buttons: number) => void;
  onAltWheel?: (direction: 1 | -1) => void;
}

/** Cool = groups 1/3 (steps 1-4, 9-12); warm = groups 2/4 (steps 5-8, 13-16). Lane 1 §2.4. */
export function stepHueGroup(step: number): "cool" | "warm" {
  const groupOfFour = Math.floor(step / 4) % 2;
  return groupOfFour === 0 ? "cool" : "warm";
}

export function StepCell({
  step,
  on,
  isPlayhead,
  onPointerDown,
  onPointerEnter,
  onContextMenu,
  onAltWheel,
}: StepCellProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Alt+wheel must SUPPRESS the scroll it rides on; React's own `onWheel` is
  // passive, so `preventDefault` there did nothing and the rack scrolled a
  // notch under the pointer on every velocity nudge — the cell the user was
  // nudging walked out from under the cursor. Same native listener the roll
  // and the playlist use for their Ctrl+wheel zoom.
  useNonPassiveWheel(
    buttonRef,
    useCallback(
      (event: WheelEvent) => {
        if (!event.altKey || !onAltWheel) return;
        event.preventDefault();
        onAltWheel(event.deltaY < 0 ? 1 : -1);
      },
      [onAltWheel],
    ),
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      className="fl-step"
      data-testid={`step-${step}`}
      data-step={step}
      data-group={stepHueGroup(step)}
      data-on={on}
      data-playhead={isPlayhead}
      aria-pressed={on}
      aria-label={`Step ${step + 1}`}
      onPointerDown={(event) => onPointerDown(event.button, event.pointerId)}
      onContextMenu={(event) => {
        event.preventDefault();
        // No `pointerId` here on purpose: `contextmenu` is a MouseEvent and
        // carries none. Guessing the mouse's 1 would be wrong for a pen or a
        // touch long-press, and a stroke scoped to the WRONG pointer never
        // sees its own release. The row uses the id of the pointer-down that
        // preceded this instead — see `lastPointerId` in `ChannelRackRow`.
        onContextMenu(event.buttons);
      }}
      onPointerEnter={(event) => onPointerEnter(event.buttons, event.pointerId)}
    />
  );
}
