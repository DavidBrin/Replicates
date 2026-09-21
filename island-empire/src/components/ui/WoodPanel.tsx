import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/**
 * The brown plank panel of the weekly-challenge cards and dialogs (SPEC §8
 * "Wood panel", `play-06.png`): `#A1632D` planks inside a `#804A1D` frame
 * with a warm-black outline, and an optional darker footer strip (where the
 * original shows "Available 6d 13h 59m").
 */
export interface WoodPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  footer?: ReactNode;
  /** Padding preset; `none` for panels that lay out their own edges. */
  padding?: "none" | "sm" | "md";
}

export function WoodPanel({ children, footer, padding = "md", className, ...rest }: WoodPanelProps) {
  return (
    <div {...rest} className={clsx("ie-panel", className)}>
      <div className={clsx(padding === "md" && "p-4", padding === "sm" && "p-2")}>{children}</div>
      {footer !== undefined && <div className="ie-panel__footer ie-outline ie-caps text-sm">{footer}</div>}
    </div>
  );
}

export default WoodPanel;
