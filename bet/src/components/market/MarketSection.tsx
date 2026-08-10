import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface MarketSectionProps {
  title: string;
  count: number;
  children: ReactNode;
  className?: string;
}

/**
 * One dashboard section — heading + count + a responsive market-card grid
 * (task-9-brief: "sectioned grid ..., responsive 1/2/3 columns"; §3.2:
 * "1 col mobile, 2 col md, 3 col xl"). The caller is responsible for not
 * rendering a section at all when it's empty ("hidden when empty") — this
 * component just lays out whatever it's given. Server-renderable.
 */
export function MarketSection({ title, count, children, className }: MarketSectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h2 className="flex items-baseline gap-2 text-sm font-semibold text-(--text-1)">
        {title}
        <span className="tnum text-(--text-3)">{count}</span>
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}
