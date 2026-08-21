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
export interface StepCellProps {
  step: number; // 0-based, 0..15
  on: boolean;
  isPlayhead: boolean;
  onPointerDown: (button: number) => void;
  onPointerEnter: (buttons: number) => void;
  onContextMenu: () => void;
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
  return (
    <button
      type="button"
      className="fl-step"
      data-testid={`step-${step}`}
      data-step={step}
      data-group={stepHueGroup(step)}
      data-on={on}
      data-playhead={isPlayhead}
      aria-pressed={on}
      aria-label={`Step ${step + 1}`}
      onPointerDown={(event) => onPointerDown(event.button)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu();
      }}
      onPointerEnter={(event) => onPointerEnter(event.buttons)}
      onWheel={(event) => {
        if (!event.altKey || !onAltWheel) return;
        event.preventDefault();
        onAltWheel(event.deltaY < 0 ? 1 : -1);
      }}
    />
  );
}
