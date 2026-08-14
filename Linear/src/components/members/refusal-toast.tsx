"use client";

/**
 * The surface a server refusal lands on.
 *
 * ## Why this is not `components/ui/toast.tsx`
 *
 * It very nearly is, and it borrows that component's geometry and tokens on
 * purpose. What it adds is the one thing the e2e contract needs and the design
 * system does not currently expose: `data-testid="toast"`. `e2e/README.md`
 * lists that id under *Shell*, so it belongs to whichever component ends up
 * mounting the toast stack — and until that lands, a permission refusal has
 * nowhere to be asserted on.
 *
 * The rule this file follows so the two can coexist: **exactly one element with
 * `data-testid="toast"` may be on screen at a time.** This component renders
 * nothing at all when there is no refusal, and this slice never raises a design
 * system toast for the same event. A duplicate id would not merely be untidy —
 * Playwright's strict mode turns two matches into a failure of every spec that
 * touches a toast, including ones this slice does not own.
 *
 * Several panels on one screen each mount their own instance, so the invariant
 * is upheld by *when* they render rather than by how many exist: one
 * interaction produces at most one refusal, a second refusal in the same panel
 * replaces the first rather than stacking, and each card clears itself after
 * {@link DISMISS_AFTER_MS}. Two panels failing within that window is the one
 * case that would put two cards up, and it is the reason a shared toast stack
 * with this id is the better home for this once the design system grows one.
 */

import { useEffect } from "react";

import { cn } from "@/lib/cn";

/** Long enough to read a sentence, short enough not to stack up. */
const DISMISS_AFTER_MS = 8_000;

export interface RefusalToastProps {
  /** The refusal, or null for "nothing to say". */
  message: string | null;
  onDismiss: () => void;
  className?: string;
}

export function RefusalToast({
  message,
  onDismiss,
  className,
}: RefusalToastProps) {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [message, onDismiss]);

  if (message === null) return null;

  return (
    <div
      data-testid="toast"
      // `alert` rather than `status`: a refusal is the outcome of something the
      // person just did, and it has to interrupt a screen reader rather than
      // wait for a pause.
      role="alert"
      className={cn(
        "fixed bottom-4 left-4 z-[var(--z-toast)] flex max-w-[380px] items-start",
        "gap-3 rounded-[var(--radius-lg)] border border-default bg-overlay",
        "px-3 py-2.5 text-small text-primary shadow-[var(--shadow-medium)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger"
      />
      <p className="flex-1 leading-5">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-mr-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-mini text-tertiary hover:bg-hover hover:text-primary"
      >
        Dismiss
      </button>
    </div>
  );
}
