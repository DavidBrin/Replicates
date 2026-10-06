"use client";

/**
 * The grey utility tray (SPEC §7.1, §8): the `--tray` gradient rounded square
 * that the Stats button, the overlay close button and every utility chassis
 * sit on. Radius 16–18, i.e. ≈20 % of the box.
 */
import type { CSSProperties, ReactNode } from "react";
import clsx from "clsx";

export interface TrayProps {
  readonly children?: ReactNode;
  /** Corner radius in px; the SPEC's tray is 16–18. */
  readonly radius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

export function Tray({ children, radius = 18, className, style, testId }: TrayProps) {
  return (
    <div
      data-testid={testId ?? "tray"}
      className={clsx("flex items-center justify-center", className)}
      style={{
        background: "var(--tray)",
        borderRadius: radius,
        boxShadow: "var(--sh-chip)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default Tray;
