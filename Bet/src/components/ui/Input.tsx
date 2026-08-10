import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visually flags the field as invalid (paired with `aria-invalid` by the
   * caller for a11y — validation messaging itself is a caller concern). */
  invalid?: boolean;
}

const fieldBase =
  "w-full rounded-(--radius-input) border bg-(--surface-2) px-3 py-2 text-sm text-(--text-1) " +
  "placeholder:text-(--text-3) transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0) " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const fieldBorder = (invalid?: boolean) =>
  invalid ? "border-(--no)" : "border-(--border) focus-visible:border-(--border-2)";

/** Base single-line text input. Server-renderable. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, fieldBorder(invalid), className)}
      {...props}
    />
  );
});
