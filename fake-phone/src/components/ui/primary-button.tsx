"use client";

/**
 * The action buttons on the home surface.
 *
 * `primary` is deliberately the largest control in the app. Every competitor
 * teardown lands on the same failure: multi-step activation under stress
 * (research/competitive-teardown.md §4 Q1, Q2). Everything above this button is
 * preparation done in advance; this is the one tap that has to land, in the
 * dark, one-handed, without looking.
 */

import clsx from "clsx";
import type { ReactNode } from "react";

export interface PrimaryButtonProps {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly variant?: "primary" | "secondary" | "quiet";
  readonly testId?: string;
  readonly className?: string;
}

const VARIANTS: Record<NonNullable<PrimaryButtonProps["variant"]>, string> = {
  // Solid amber, on the darkest ground in the palette: a beacon, not an alarm.
  // Red is unavailable to this product by policy — the app must never read as
  // contacting emergency services (SPEC §1.2).
  primary: "min-h-16 bg-accent text-ground text-[19px] font-semibold tracking-tight",
  secondary:
    "min-h-12 border border-hairline bg-surface-1 text-text-primary text-[15px] font-medium",
  quiet: "min-h-11 text-text-secondary text-[14px]",
};

export function PrimaryButton({
  children,
  onClick,
  variant = "primary",
  testId,
  className,
}: PrimaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={clsx(
        "w-full rounded-2xl px-5 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "active:opacity-90",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
