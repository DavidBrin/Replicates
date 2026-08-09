"use client";

/**
 * The contract every cell editor implements, plus the two bits of chrome they
 * all share.
 *
 * A cell never decides *which* editor to use — `PropertyCell` does that from a
 * registry. A cell only knows how to render and write one property type, which
 * is why each one can safely narrow the `PropertySchema` union with a single
 * guard at the top.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { Id, PropertySchema, PropertyValue } from "@/lib/model/types";

/**
 * `table` fills the whole 33px cell box and has no radius (the grid draws the
 * lines); `peek` is an inline control in the row panel's two-column list.
 */
export type CellVariant = "table" | "peek";

export interface CellProps {
  databaseId: Id;
  rowId: Id;
  schema: PropertySchema;
  value: PropertyValue | undefined;
  variant?: CellVariant;
}

/** Base geometry shared by every editor, so the grid stays aligned. */
export function cellClass(variant: CellVariant = "table"): string {
  return cn(
    "flex w-full min-w-0 items-center gap-1 text-sm",
    variant === "table"
      ? "h-full px-2 py-0"
      : "min-h-[28px] rounded-[4px] px-2 py-[3px] hover:bg-[var(--bac-int)]",
  );
}

/** A cell rendered as a click target that opens a picker. */
export const CellTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: CellVariant;
  children: ReactNode;
}>(function CellTrigger({ variant = "table", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        cellClass(variant),
        "cursor-pointer text-left transition-colors duration-75 outline-hidden",
        variant === "table" && "hover:bg-[var(--bac-int)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Placeholder shown when a cell has no value — Notion leaves these blank. */
export function EmptyHint({ children }: { children?: ReactNode }) {
  return (
    <span className="truncate" style={{ color: "var(--tex-ter)" }}>
      {children ?? ""}
    </span>
  );
}

/** Borderless input that inherits the cell box exactly. */
export function BareInput({
  value,
  onChange,
  onBlur,
  placeholder,
  variant = "table",
  type = "text",
  alignEnd,
  inputMode,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  variant?: CellVariant;
  type?: string;
  alignEnd?: boolean;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "url";
  /** Set when the input replaces a read-only display, so focus is not lost. */
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      inputMode={inputMode}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      // Escape should abandon focus rather than bubble to a parent popover.
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
      className={cn(
        cellClass(variant),
        "bg-transparent outline-hidden placeholder:text-[var(--tex-ter)]",
        alignEnd && "text-right",
      )}
      style={{ color: "var(--tex-pri)" }}
    />
  );
}
