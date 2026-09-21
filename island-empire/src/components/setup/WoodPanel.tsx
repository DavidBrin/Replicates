"use client";

import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/**
 * Minimal local stand-in for S3's `src/components/ui/WoodPanel` (SPEC §12
 * "Shared pixel UI primitives"; palette matches the weekly-challenge cards
 * measured in `research/screenshots/store/play-06.png` — SPEC §8 "Wood
 * panel"). Swap the import for `@/components/ui/WoodPanel` once that lands.
 */
export interface WoodPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function WoodPanel({ className, style, children, ...rest }: WoodPanelProps) {
  return (
    <div
      {...rest}
      className={clsx("rounded-lg border-4 p-3", className)}
      style={{ backgroundColor: "#A1632D", borderColor: "#804A1D", ...style }}
    >
      {children}
    </div>
  );
}

export default WoodPanel;
