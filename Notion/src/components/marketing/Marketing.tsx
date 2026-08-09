import type { CSSProperties, ReactNode } from "react";
import { layout } from "@/config/app.config";
import { cn } from "@/lib/utils/cn";
import "./marketing.css";

/**
 * Root wrapper for every marketing route.
 *
 * Owns the `.marketing` class that scopes the notion.com token set (see
 * `marketing.css`) and injects the geometry from `layout.marketing`, so page
 * width lives in config rather than being sprinkled through the CSS.
 */
export function Marketing({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const style = {
    "--mkt-max-width": `${layout.marketing.maxWidth}px`,
    "--mkt-gutter": `${layout.marketing.gutter}px`,
  } as CSSProperties;

  return (
    <div className={cn("marketing", className)} style={style}>
      {children}
    </div>
  );
}

/** Centred page column, capped at `layout.marketing.maxWidth`. */
export function Container({
  children,
  className,
  hero = false,
}: {
  children: ReactNode;
  className?: string;
  /** Narrower measure used by the hero's centre column. */
  hero?: boolean;
}) {
  return (
    <div
      className={cn("mkt-container", hero && "mkt-container--hero", className)}
    >
      {children}
    </div>
  );
}
