import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SpinnerSize = "sm" | "md";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /**
   * Announced to assistive tech. Leave unset inside a control that already has
   * an accessible name and `aria-busy` — a second announcement there is noise,
   * so the spinner hides itself instead.
   */
  label?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "size-3 border-2",
  md: "size-4 border-2",
};

/** Pure CSS, so it is server-renderable and ships no icon dependency. */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = "md", label, className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
