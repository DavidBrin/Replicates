"use client";

/**
 * The segmented toggle of SPEC §7 (`/new`'s `FFA | 1v1`): a dark 270×56 track
 * at radius 28 with the active segment filled `--cyan`.
 *
 * Generic over the option value so the format toggle and the seat-kind toggle
 * are the same control, not two.
 */
import clsx from "clsx";

import { SETUP_TOKENS } from "./tokens";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedToggleProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Overall track width in px; the SPEC's is 270. */
  readonly width?: number;
  /** Track height in px; the SPEC's is 56 (and never below the 44 px floor). */
  readonly height?: number;
  readonly testId?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  width = 270,
  height = 56,
  testId,
  ariaLabel,
  className,
}: SegmentedToggleProps<T>) {
  const h = Math.max(44, height);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId ?? "segmented-toggle"}
      data-value={value}
      className={clsx("inline-flex items-center p-[3px]", className)}
      style={{
        width: `min(${width}px, 100%)`,
        height: h,
        background: SETUP_TOKENS.segmentTrack,
        borderRadius: h / 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`${testId ?? "segmented-toggle"}-${option.value}`}
            data-active={active ? "true" : "false"}
            onClick={() => onChange(option.value)}
            className={clsx(
              "flex h-full flex-1 cursor-pointer items-center justify-center font-head font-bold uppercase outline-none",
              "focus-visible:ring-2 focus-visible:ring-white/80",
            )}
            style={{
              borderRadius: h / 2,
              background: active ? "var(--cyan)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              fontSize: "clamp(14px, 2.4vw, 22px)",
              letterSpacing: ".04em",
              transition: "background 200ms ease-out, color 200ms ease-out",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedToggle;
