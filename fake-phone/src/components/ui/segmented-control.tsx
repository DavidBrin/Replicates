"use client";

/**
 * A one-of-N picker, sized for a thumb.
 *
 * Buttons rather than a `<select>` because every option has to be readable
 * without opening anything: this surface is configured in advance, but it is
 * also glanced at under stress, and a closed dropdown hides the thing the user
 * came to check (research/competitive-teardown.md §4 Q3 — minimal input, no
 * multi-step UI).
 *
 * An option can be `inert`: visible, focusable, announced as disabled, and
 * unselectable. That is how the AI voice tier ships — the architecture is wired
 * and unlit, and the UI states that rather than hiding the option and letting
 * the user assume it does not exist.
 */

import clsx from "clsx";
import { useRef } from "react";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Present but unselectable. Stays focusable so it is discoverable. */
  readonly inert?: boolean;
  readonly testId?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly labelId: string;
  readonly describedBy?: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  readonly testId?: string;
  readonly className?: string;
}

export function SegmentedControl<T extends string>({
  labelId,
  describedBy,
  value,
  options,
  onChange,
  testId,
  className,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Arrow keys move between options, which is what a radiogroup is required to
   * do. Inert options are skipped rather than landed on, so keyboard users are
   * never parked on something that cannot be chosen.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    const step = forward ? 1 : -1;
    event.preventDefault();

    const selectable = options.filter((option) => !option.inert);
    if (selectable.length === 0) return;
    const current = selectable.findIndex((option) => option.value === value);
    const next = selectable[(current + step + selectable.length) % selectable.length];
    onChange(next.value);

    const button = containerRef.current?.querySelector<HTMLButtonElement>(
      `[data-segment="${next.value}"]`,
    );
    button?.focus();
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      className={clsx(
        "flex gap-1 rounded-2xl border border-hairline bg-surface-2 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-segment={option.value}
            data-testid={option.testId}
            aria-checked={selected}
            aria-disabled={option.inert ? true : undefined}
            // Roving tabindex: one stop for the whole group, as a radiogroup
            // should have. An inert option stays reachable via arrow keys.
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              // The guard, not a `disabled` attribute: a `disabled` button is
              // removed from the accessibility tree, and this option's entire
              // job is to be seen.
              if (option.inert) return;
              onChange(option.value);
            }}
            className={clsx(
              "min-h-11 flex-1 rounded-xl px-2 text-[14px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              option.inert
                ? "cursor-not-allowed text-text-secondary/50"
                : selected
                  ? "bg-accent/12 text-accent ring-1 ring-accent/40"
                  : "text-text-secondary hover:text-text-primary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
