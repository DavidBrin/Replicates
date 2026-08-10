"use client";

/**
 * A number input flanked by −/+ buttons.
 *
 * Both halves earn their place: the buttons are the one-handed path (a 44px
 * target beats a numeric keyboard while walking), and the input is the only
 * sane way to set a viewer count of 1,240 without ninety taps.
 *
 * The draft state is here for the same reason as in `TextField` — a half-typed
 * number is not a valid patch, and the store must never be handed one. See the
 * long comment there.
 */

import clsx from "clsx";
import { useState } from "react";

export interface StepperProps {
  readonly id: string;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly describedBy?: string;
  /** Rendered after the number, e.g. "seconds". Decorative only. */
  readonly unit?: string;
  readonly testId?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Stepper({
  id,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  describedBy,
  unit,
  testId,
}: StepperProps) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(next: number): void {
    setDraft(null);
    onValueChange(clamp(Math.round(next), min, max));
  }

  const buttonClass =
    "h-11 w-11 shrink-0 rounded-xl border border-hairline bg-surface-2 text-lg text-text-primary disabled:text-text-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={buttonClass}
        onClick={() => commit(value - step)}
        disabled={value <= min}
        aria-label="Decrease"
        data-testid={testId ? `${testId}-decrement` : undefined}
      >
        −
      </button>

      <div className="relative flex-1">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          aria-describedby={describedBy}
          data-testid={testId}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const parsed = Number(raw);
            if (raw.trim() !== "" && Number.isFinite(parsed)) {
              onValueChange(clamp(Math.round(parsed), min, max));
            }
          }}
          onBlur={() => setDraft(null)}
          className={clsx(
            // 16px minimum — see TextField.
            "tabular min-h-11 w-full rounded-xl border border-hairline bg-surface-2 px-3 text-base text-text-primary",
            "focus-visible:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            unit ? "pr-16" : undefined,
          )}
        />
        {unit ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-text-secondary"
          >
            {unit}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className={buttonClass}
        onClick={() => commit(value + step)}
        disabled={value >= max}
        aria-label="Increase"
        data-testid={testId ? `${testId}-increment` : undefined}
      >
        +
      </button>
    </div>
  );
}
