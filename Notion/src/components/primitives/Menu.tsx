"use client";

/**
 * Menu surfaces used inside a `Popover` — Notion's dropdown vocabulary:
 * a section label, rows with an optional leading icon and trailing hint,
 * and a hairline separator.
 */

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function MenuList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("py-1", className)}>{children}</div>;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-3 pb-1 pt-2 text-[11px] font-medium"
      style={{ color: "var(--tex-ter)" }}
    >
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px" style={{ background: "var(--bor-pri)" }} />;
}

export interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  /** Right-aligned hint — a shortcut, a value, or a chevron. */
  hint?: ReactNode;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function MenuItem({
  children,
  onSelect,
  icon,
  hint,
  selected,
  danger,
  disabled,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-[6px] text-left text-sm",
        "transition-colors duration-75",
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-[var(--bac-int)]",
      )}
      style={{ color: danger ? "var(--tag-red-fg)" : "var(--tex-pri)" }}
    >
      {icon ? (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: danger ? "var(--tag-red-fg)" : "var(--ico-sec)" }}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate">{children}</span>
      {selected ? <Check size={14} style={{ color: "var(--ico-sec)" }} /> : null}
      {hint ? (
        <span className="shrink-0 text-xs" style={{ color: "var(--tex-ter)" }}>
          {hint}
        </span>
      ) : null}
    </button>
  );
}
