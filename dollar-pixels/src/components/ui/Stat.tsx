import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatTone = "neutral" | "sold" | "open" | "money";

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
}

const toneClasses: Record<StatTone, string> = {
  neutral: "text-(--ink)",
  sold: "text-(--sold)",
  open: "text-(--open)",
  money: "text-(--link)",
};

/**
 * A labelled figure. `data-tone` is on the element so the meaning of the
 * colour survives into tests and screenshots, where a class name is only a
 * class name.
 */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, tone = "neutral", className, ...props },
  ref,
) {
  return (
    <div ref={ref} data-tone={tone} className={cn("flex flex-col", className)} {...props}>
      <span className="text-xs tracking-wide text-(--ink-3) uppercase">{label}</span>
      <span className={cn("tnum text-lg leading-tight font-bold", toneClasses[tone])}>
        {value}
      </span>
    </div>
  );
});
