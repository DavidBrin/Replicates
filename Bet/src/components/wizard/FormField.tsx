import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FormFieldProps {
  htmlFor: string;
  label: string;
  /** Rendered right-aligned next to the label — e.g. a "42/140" character
   * counter or an "optional" hint. */
  labelSuffix?: ReactNode;
  hint?: string;
  /** The field's error message, if any. Rendered inline directly beneath
   * the control (David's ambiguity resolution: inline errors next to the
   * offending field, never a bulk dump) and wired to the control via
   * `aria-describedby` — every caller MUST set that itself, using
   * `errorId(htmlFor)` below, since `FormField` doesn't clone its
   * children. */
  error?: string;
  children: ReactNode;
  className?: string;
}

/** The id `FormField`'s error message renders under — callers pass this to
 * their control's `aria-describedby` so screen readers announce the error
 * on focus, not just visually. */
export function errorId(htmlFor: string): string {
  return `${htmlFor}-error`;
}

/** A label + control + inline-error row, shared by every wizard step so
 * error placement/wiring stays consistent. Server-renderable — no
 * interactivity of its own. */
export function FormField({
  htmlFor,
  label,
  labelSuffix,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-(--text-1)">
          {label}
        </label>
        {labelSuffix ? (
          <span className="text-xs text-(--text-3) tabular-nums">{labelSuffix}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={errorId(htmlFor)} role="alert" className="text-xs text-(--no)">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-(--text-3)">{hint}</p>
      ) : null}
    </div>
  );
}
