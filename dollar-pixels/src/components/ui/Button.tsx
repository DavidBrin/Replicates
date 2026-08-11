import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the spinner, sets `aria-busy` and forces `disabled`. */
  loading?: boolean;
}

/* Square corners throughout: a 2005 layout had no border radius, and the grid
   frame it sits next to is a hard 1px rule. */
const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-bold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-(--rule) bg-(--gold) text-(--ink) hover:bg-(--gold-dim)",
  secondary: "border-(--rule) bg-(--panel-2) text-(--ink) hover:bg-(--panel)",
  ghost: "border-transparent bg-transparent text-(--ink-2) hover:bg-(--panel)",
  danger: "border-(--rule) bg-(--open) text-(--panel-2) hover:opacity-90",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
};

/**
 * The one button primitive. Server-renderable — interactivity is whatever
 * handler a client-component caller passes in.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(base, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
});
