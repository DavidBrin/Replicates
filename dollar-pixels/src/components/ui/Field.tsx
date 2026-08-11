"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: ReactNode;
  /** Supply one to point an external `<label>` or error summary at this input. */
  id?: string;
  hint?: ReactNode;
  /** Present means invalid: sets `aria-invalid` and is announced on change. */
  error?: ReactNode;
}

const inputBase =
  "w-full border bg-(--panel-2) px-2 py-1.5 text-sm text-(--ink) " +
  "placeholder:text-(--ink-3) disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Label, input, hint and error wired together.
 *
 * A client component only because `useId` is a hook — the generated id is what
 * makes the label/hint/error association hold without every caller having to
 * invent a unique string and remember to thread it through three attributes.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, id, hint, error, className, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [hint != null ? hintId : null, error != null ? errorId : null]
      .filter((v): v is string => v !== null)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={inputId} className="text-sm font-bold text-(--ink)">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error != null || undefined}
        aria-describedby={describedBy}
        className={cn(inputBase, error != null ? "border-(--open)" : "border-(--rule)")}
        {...props}
      />
      {hint != null ? (
        <p id={hintId} className="text-xs text-(--ink-2)">
          {hint}
        </p>
      ) : null}
      {error != null ? (
        <p id={errorId} role="alert" className="text-xs font-bold text-(--open)">
          {error}
        </p>
      ) : null}
    </div>
  );
});
