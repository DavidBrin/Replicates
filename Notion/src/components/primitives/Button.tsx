"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailing?: ReactNode;
}

const SIZES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-xs gap-1 rounded-[4px]",
  md: "h-7 px-2.5 text-sm gap-1.5 rounded-[4px]",
  lg: "h-9 px-3.5 text-base gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, trailing, className, children, ...rest },
  ref,
) {
  // Colours come from tokens rather than Tailwind palette classes so that a
  // single theme swap retargets every button.
  const style: React.CSSProperties =
    variant === "primary"
      ? { background: "var(--accent)", color: "#fff" }
      : variant === "secondary"
        ? { background: "var(--bac-int)", color: "var(--tex-pri)" }
        : variant === "subtle"
          ? { background: "transparent", color: "var(--tex-sec)" }
          : { background: "transparent", color: "var(--tex-pri)" };

  return (
    <button
      ref={ref}
      type="button"
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium",
        "transition-colors duration-100 outline-hidden",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "hover:brightness-95",
        variant !== "primary" && "hover:bg-[var(--bac-int-strong)]",
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: number;
}

/** Square icon-only affordance — the toolbar and row-hover control. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, size = 28, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        style={{ width: size, height: size, color: "var(--ico-sec)" }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[4px]",
          "transition-colors duration-100 outline-hidden",
          "hover:bg-[var(--bac-int)] hover:text-[var(--ico-pri)]",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
