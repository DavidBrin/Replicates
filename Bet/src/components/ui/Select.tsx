import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { fieldBorder } from "./Input";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Base native `<select>`, styled to match `Input`/`Textarea`. Takes plain
 * `<option>` children — no bespoke options-array API, so it stays a drop-in
 * replacement for a native select wherever one is needed. Server-renderable. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full appearance-none rounded-(--radius-input) border bg-(--surface-2) py-2 pr-9 pl-3 text-sm text-(--text-1) transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
          "disabled:cursor-not-allowed disabled:opacity-50",
          fieldBorder(invalid),
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-(--text-3)"
      />
    </div>
  );
});
