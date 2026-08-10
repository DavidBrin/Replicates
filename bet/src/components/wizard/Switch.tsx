"use client";

import { cn } from "@/lib/cn";

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}

/**
 * A labeled on/off switch (`role="switch"`, a real `<button>` — G9), used
 * by Step 2's "this isn't yes/no" toggle and Step 3's `stakesVisible`
 * toggle. No shared `ui/` primitive covers this shape yet (Task 8's list
 * doesn't include one), so it's kept local to the wizard rather than added
 * to `src/components/ui/**`, which this task doesn't own.
 */
export function Switch({ id, checked, onChange, label, description, className }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-(--radius-card) border border-(--border) bg-(--surface-2) px-4 py-3 text-left transition-colors hover:border-(--border-2)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
        className,
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-(--text-1)">{label}</span>
        {description ? <span className="text-xs text-(--text-3)">{description}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-(--radius-pill) transition-colors",
          checked ? "bg-(--accent)" : "bg-(--surface-3)",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-(--surface-0) transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
