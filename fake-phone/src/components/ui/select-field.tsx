"use client";

/**
 * A native `<select>`, styled to match the rest of the kit.
 *
 * Native rather than a custom listbox: the platform picker is a full-height
 * wheel on iOS and a bottom sheet on Android, both of which are far easier to
 * hit one-handed than anything reimplemented in a div — and neither of them can
 * be scrolled off the bottom of a `position: fixed` app frame.
 *
 * Used only where the option list is long enough that a segmented control would
 * not fit across a 390px screen.
 */

import clsx from "clsx";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps {
  readonly id: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly describedBy?: string;
  readonly testId?: string;
}

export function SelectField({
  id,
  value,
  options,
  onValueChange,
  describedBy,
  testId,
}: SelectFieldProps) {
  return (
    <select
      id={id}
      value={value}
      aria-describedby={describedBy}
      data-testid={testId}
      onChange={(event) => onValueChange(event.target.value)}
      className={clsx(
        // 16px minimum, like every other control here — mobile Safari zooms the
        // page in on focus below that and never zooms back out.
        "min-h-11 w-full appearance-none rounded-xl border border-hairline bg-surface-2 px-3 text-base text-text-primary",
        "focus-visible:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
