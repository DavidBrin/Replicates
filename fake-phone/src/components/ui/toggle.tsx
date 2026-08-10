"use client";

/**
 * An on/off switch.
 *
 * `role="switch"` on a real `<button>` rather than a styled checkbox: the
 * checkbox hack needs a hidden input and a label sibling, and one refactor
 * later the hidden input is the thing that is 3px tall. The button is the hit
 * target, and it is 44px so a thumb finds it.
 */

import clsx from "clsx";

export interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly labelId?: string;
  readonly describedBy?: string;
  readonly testId?: string;
}

export function Toggle({ checked, onChange, labelId, describedBy, testId }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-11 w-16 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden="true"
        className={clsx(
          "h-8 w-14 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-surface-2 ring-1 ring-hairline",
        )}
      />
      <span
        aria-hidden="true"
        className={clsx(
          "absolute h-6 w-6 rounded-full transition-transform",
          checked ? "translate-x-3 bg-ground" : "-translate-x-3 bg-text-secondary",
        )}
      />
    </button>
  );
}
