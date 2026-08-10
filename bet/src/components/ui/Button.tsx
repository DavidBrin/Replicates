import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "yes" | "no";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy` and forces `disabled`. */
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-(--radius-input) " +
  "font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-(--accent) text-(--surface-0) hover:bg-(--accent-2)",
  secondary:
    "bg-(--surface-3) text-(--text-1) border border-(--border) hover:border-(--border-2)",
  ghost: "bg-transparent text-(--text-1) hover:bg-(--surface-3)",
  danger: "bg-(--no) text-(--surface-0) hover:opacity-90",
  yes: "bg-(--yes-bg) text-(--yes) border border-(--yes-br) hover:bg-(--yes) hover:text-(--surface-0) hover:border-(--yes)",
  no: "bg-(--no-bg) text-(--no) border border-(--no-br) hover:bg-(--no) hover:text-(--surface-0) hover:border-(--no)",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

/**
 * The single button primitive for the whole app (SPEC §7, Task 8 brief).
 * Server-renderable — no client boundary of its own; interactivity comes
 * from whatever `onClick` a client-component caller passes in.
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
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children as ReactNode}
    </button>
  );
});
