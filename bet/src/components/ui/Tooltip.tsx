"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  /** The trigger content. Rendered inside a wrapper `<span>` that owns the
   * hover/focus handlers (see below for why it's no longer cloned onto the
   * child directly). */
  children: ReactNode;
  side?: TooltipSide;
  className?: string;
}

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * A hover/focus-triggered label (SPEC §3.4 "add them as a friend first",
 * §5.2 disabled-order-ticket reasons). Client component: it owns
 * open/closed state driven by pointer and focus events.
 *
 * Used to `cloneElement`/`isValidElement` the trigger so handlers could
 * attach directly to it instead of an extra wrapper. That broke the first
 * time a Server Component passed `children` across the client boundary
 * (Task 9's `GroupHeader.tsx`, wrapping a plain `<span role="tab">`):
 * `isValidElement()` evaluates `true` for that same child during the
 * client's hydration pass but `false` during the server's render of the
 * client tree — Next.js's Flight-serialized RSC children aren't identical
 * React elements on both sides of that boundary — so the server emitted
 * the bare (unwrapped, un-handlered) child while the client emitted the
 * wrapped-and-handlered version, a genuine hydration mismatch on every
 * page load, not a one-off. Attaching the handlers to the (already always
 * present) wrapper `<span>` instead and just rendering `{children}` inside
 * it removes the child-identity dependency entirely, works identically
 * regardless of whether the trigger was authored in a Server or Client
 * Component, and renders exactly the same DOM shape as before in the
 * previously-working case. Trade-off: `aria-describedby` now lives on the
 * wrapper rather than the focused element itself, which some screen
 * readers won't announce on focus of a nested control — acceptable for a
 * supplementary hint tooltip (the `role="tooltip"` + visible content still
 * carries the information), and there is no known workaround that stays
 * this SSR-boundary-safe.
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-block"
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute z-50 rounded-(--radius-input) border border-(--border) bg-(--surface-3) px-2 py-1 text-xs whitespace-nowrap text-(--text-1) shadow-lg",
            sideClasses[side],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
