"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

import { PIXEL_TEXT_OUTLINE } from "./pixelText";

/**
 * Minimal local stand-in for S3's `src/components/ui/PixelButton` (SPEC §12
 * "Shared pixel UI primitives"). Swap the import for `@/components/ui/PixelButton`
 * once that lands — same call shape (`variant`, everything else is a plain
 * `<button>` prop) is intentional to make that swap a no-op.
 */
export interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "green" | "wood" | "neutral";
  children: ReactNode;
}

const VARIANT_STYLES: Record<NonNullable<PixelButtonProps["variant"]>, { bg: string; border: string }> = {
  green: { bg: "#228F00", border: "#1A1010" },
  wood: { bg: "#A1632D", border: "#804A1D" },
  neutral: { bg: "#4D525E", border: "#1A1010" },
};

export function PixelButton({
  variant = "wood",
  className,
  style,
  children,
  ...rest
}: PixelButtonProps) {
  const colours = VARIANT_STYLES[variant];
  return (
    <button
      {...rest}
      className={clsx(
        "min-h-11 min-w-11 rounded-md border-2 px-4 py-2 text-sm font-bold uppercase tracking-wide",
        "transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{
        backgroundColor: colours.bg,
        borderColor: colours.border,
        color: "#FFFFFF",
        textShadow: PIXEL_TEXT_OUTLINE,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export default PixelButton;
