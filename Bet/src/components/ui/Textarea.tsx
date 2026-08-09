import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { fieldBorder } from "./Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Base multi-line text input. Server-renderable. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full resize-y rounded-(--radius-input) border bg-(--surface-2) px-3 py-2 text-sm text-(--text-1) transition-colors",
        "placeholder:text-(--text-3)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
        "disabled:cursor-not-allowed disabled:opacity-50",
        fieldBorder(invalid),
        className,
      )}
      {...props}
    />
  );
});
