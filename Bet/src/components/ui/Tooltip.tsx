"use client";

import { cloneElement, isValidElement, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  /** The trigger element. Must accept a ref and forward extra props (a
   * native element or a component built with `forwardRef`). */
  children: ReactElement;
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
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  });

  return (
    <span className="relative inline-block">
      {trigger}
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
