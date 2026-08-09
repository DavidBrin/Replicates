"use client";

/**
 * The single sidebar row shape.
 *
 * Every navigational line in the sidebar — Search, Home, Inbox, a page, Trash —
 * is 27px tall with 2px/8px padding and a 4px radius. Those numbers are the
 * whole "Notion feel" of the left rail, so they live in one place and every
 * consumer (including `SidebarPageRow`, which builds a richer row by hand)
 * reads them from here rather than re-typing them.
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export const SIDEBAR_ROW_HEIGHT = 27;
/** Notion indents each nesting level by a hair under an icon width. */
export const SIDEBAR_INDENT_PER_DEPTH = 12;
export const SIDEBAR_BASE_PADDING = 8;

/**
 * Class list shared by every row.
 *
 * The hover background is a *class* rather than an inline style on purpose:
 * inline styles beat `:hover` rules, so an active row's inline
 * `--bac-int-strong` correctly wins over the hover wash instead of flickering.
 */
export const sidebarRowClass = cn(
  "flex w-full min-w-0 items-center gap-2 rounded-[4px] text-left",
  "transition-colors duration-100 outline-hidden select-none",
  "hover:bg-[var(--bac-int)]",
);

export function sidebarRowStyle(active?: boolean, depth = 0): CSSProperties {
  return {
    height: SIDEBAR_ROW_HEIGHT,
    paddingTop: 2,
    paddingBottom: 2,
    paddingRight: 8,
    paddingLeft: SIDEBAR_BASE_PADDING + depth * SIDEBAR_INDENT_PER_DEPTH,
    fontSize: 14,
    lineHeight: "20px",
    color: active ? "var(--tex-pri)" : "var(--tex-sec)",
    fontWeight: active ? 500 : 400,
    // Only set a background when active — see the note on `sidebarRowClass`.
    background: active ? "var(--bac-int-strong)" : undefined,
  };
}

export interface SidebarRowProps {
  icon?: ReactNode;
  label: ReactNode;
  /** Right-aligned adornment: a shortcut hint, a count badge, a hover control. */
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  depth?: number;
  title?: string;
  className?: string;
}

/** A plain navigational row. Renders a link when `href` is given, else a button. */
export function SidebarRow({
  icon,
  label,
  trailing,
  href,
  onClick,
  active,
  depth = 0,
  title,
  className,
}: SidebarRowProps) {
  const body = (
    <>
      {icon ? (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: active ? "var(--ico-pri)" : "var(--ico-sec)" }}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="ml-auto flex shrink-0 items-center">{trailing}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        title={title}
        draggable={false}
        className={cn(sidebarRowClass, "group/row", className)}
        style={sidebarRowStyle(active, depth)}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(sidebarRowClass, "group/row", className)}
      style={sidebarRowStyle(active, depth)}
    >
      {body}
    </button>
  );
}
