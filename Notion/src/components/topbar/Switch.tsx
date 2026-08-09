"use client";

/**
 * Notion's 26x16 pill toggle.
 *
 * Lives here rather than in `components/primitives` because that directory is
 * owned by another part of the build; the only consumers are the page-options
 * menu and the publish tab, both of which are app-shell chrome.
 */

import { cn } from "@/lib/utils/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-[26px] shrink-0 items-center rounded-full",
        "transition-colors duration-150 outline-hidden",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
        disabled && "cursor-not-allowed opacity-40",
      )}
      style={{ background: checked ? "var(--accent)" : "var(--bor-str)" }}
    >
      <span
        className="absolute h-3 w-3 rounded-full bg-white transition-transform duration-150"
        style={{ left: 2, transform: `translateX(${checked ? 10 : 0}px)` }}
      />
    </button>
  );
}
