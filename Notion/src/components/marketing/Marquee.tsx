import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Infinite horizontal marquee.
 *
 * The children are rendered twice and the track slides exactly -50%, so the
 * loop lands on the seam and never stutters. Clipping happens on the wrapper,
 * which is what keeps the page body from ever scrolling sideways.
 *
 * Pure CSS — no JS, no measurement, so this stays a server component.
 */
export function Marquee({
  children,
  durationSeconds = 46,
  className,
}: {
  children: ReactNode;
  durationSeconds?: number;
  className?: string;
}) {
  const style = {
    "--mkt-marquee-duration": `${durationSeconds}s`,
  } as CSSProperties;

  return (
    <div className={cn("mkt-marquee", className)} style={style}>
      <div className="mkt-marquee__track">
        <div className="flex items-center">{children}</div>
        {/* Duplicate: presentational only, hidden from assistive tech. */}
        <div className="flex items-center" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
