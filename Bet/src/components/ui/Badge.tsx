import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "accent" | "yes" | "no" | "warn";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-(--surface-3) text-(--text-2)",
  accent: "bg-(--accent)/15 text-(--accent)",
  yes: "bg-(--yes-bg) text-(--yes)",
  no: "bg-(--no-bg) text-(--no)",
  warn: "bg-(--warn)/15 text-(--warn)",
};

/** Small filled status label — market status, "Live", etc. Distinct from
 * `Pill`, which is specifically the probability chip (SPEC §5.1).
 * Server-renderable. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-(--radius-pill) px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
});
