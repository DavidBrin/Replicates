import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { CalendarIcon } from "@/components/ui/icons";

/**
 * The small pills that hang off the right-hand end of an issue row.
 *
 * Three shapes, all measured from `linear-app-issue-list-dark.png`: a **label
 * chip** (a coloured dot and a name), a **due-date pill** (a calendar glyph and
 * a short date), and a **count pill** (a bare number, as on the sidebar's
 * `Inbox 1`).
 *
 * ## Why the label's colour is a dot, not a fill
 *
 * A tinted-background chip is the obvious rendering and it is wrong here. An
 * issue commonly carries three or four labels, and four saturated fills in a
 * 44px row out-shout the title they are annotating — Linear's list is scanned
 * by *title*, with labels as peripheral information. A 6px dot carries the same
 * identity at a fraction of the visual weight, and it keeps every chip on one
 * neutral background so they align as a row of equal-weight objects.
 *
 * ## Why the date pill is not red by default
 *
 * `overdue` is opt-in. A due date in the past on a Done issue is not a problem,
 * and colouring it red anyway teaches the user to ignore the colour. The caller
 * knows whether the issue is still open; the pill does not.
 */

const BASE =
  "inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] " +
  "px-1.5 h-5 text-mini leading-none whitespace-nowrap " +
  "[font-weight:var(--weight-normal)]";

export interface BadgeProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** The neutral pill every other variant is built from. */
export function Badge({ children, className, style, title }: BadgeProps) {
  return (
    <span
      title={title}
      style={style}
      className={cn(
        BASE,
        "border border-default text-tertiary",
        "bg-[var(--bg-translucent)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface LabelChipProps {
  name: string;
  /** The label's stored hex. Rendered as the dot, never as the background. */
  color: string;
  /** Hide the name and show the dot alone — the compact list-row rendering. */
  dotOnly?: boolean;
  className?: string;
}

export function LabelChip({ name, color, dotOnly = false, className }: LabelChipProps) {
  return (
    <span
      className={cn(
        BASE,
        "border border-default text-tertiary",
        dotOnly && "px-1",
        className,
      )}
      title={dotOnly ? name : undefined}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      {dotOnly ? <span className="sr-only">{name}</span> : name}
    </span>
  );
}

export interface DueDatePillProps {
  /** Already formatted — "Aug 31". Formatting is a locale concern, not a chip one. */
  children: ReactNode;
  /**
   * Paint it in the danger colour.
   *
   * The caller decides: a past date on a completed issue is not overdue, and
   * only the caller knows the state.
   */
  overdue?: boolean;
  /** The full date, for the tooltip and the accessible name. */
  title?: string;
  className?: string;
}

export function DueDatePill({
  children,
  overdue = false,
  title,
  className,
}: DueDatePillProps) {
  return (
    <span
      title={title}
      className={cn(
        BASE,
        "border border-default",
        overdue ? "text-danger" : "text-tertiary",
        className,
      )}
    >
      <CalendarIcon size={12} />
      {children}
    </span>
  );
}

export interface CountPillProps {
  count: number;
  /**
   * Cap the displayed number.
   *
   * A sidebar item reading `1284` re-flows the whole nav row; `99+` does not.
   */
  max?: number;
  /** Announced instead of the bare digits — "12 unread notifications". */
  label?: string;
  className?: string;
}

/**
 * A bare count, as on `Inbox 1` and a status group header.
 *
 * No border and no background: in the measured app these are plain 11px text in
 * the muted grey, sitting in the row's own padding. A bordered badge here would
 * be the single loudest thing in the sidebar.
 */
export function CountPill({ count, max = 99, label, className }: CountPillProps) {
  const display = count > max ? `${max}+` : `${count}`;
  return (
    <span
      className={cn(
        "shrink-0 tabular-nums text-micro text-tertiary",
        "[font-weight:var(--weight-normal)]",
        className,
      )}
      aria-label={label}
    >
      {display}
    </span>
  );
}
