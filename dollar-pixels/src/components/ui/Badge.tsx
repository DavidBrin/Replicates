import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "sold" | "open" | "premium" | "private";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-(--rule) bg-(--panel-2) text-(--ink-2)",
  sold: "border-(--rule) bg-(--sold) text-(--panel-2)",
  open: "border-(--rule) bg-(--open) text-(--panel-2)",
  premium: "border-(--rule) bg-(--gold) text-(--ink)",
  private: "border-(--rule) bg-(--chrome) text-(--panel-2)",
};

/**
 * Small filled label — a page's kind, a block's state.
 *
 * `private` is deliberately the muted chrome tone rather than anything that
 * reads as a lock: the page is unlisted, not access-controlled (DECISIONS D4),
 * and the badge must not be the thing that implies otherwise.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-tone={tone}
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 text-xs font-bold uppercase",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
});
