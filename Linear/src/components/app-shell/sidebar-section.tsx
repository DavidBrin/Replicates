"use client";

/**
 * A collapsible sidebar section, and the nav row every item in the sidebar is
 * built from.
 *
 * Two measurements do the work here: rows are **28px** (`sidebarPadding: 12`,
 * `research/01-visual-design.md` §6.1) and the section label is 11px in the
 * muted grey with a disclosure chevron that only appears on hover. Making the
 * chevron permanent turns a quiet list of headings into a column of controls.
 *
 * The section header is a real `<button>` with `aria-expanded`, so its state is
 * announced rather than implied by a rotation.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { CountPill } from "@/components/ui/badge";
import { ChevronDownIcon } from "@/components/ui/icons";

export interface SidebarSectionProps {
  readonly label: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** Rendered at the right of the header on hover — usually a `+`. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function SidebarSection({
  label,
  expanded,
  onToggle,
  action,
  children,
}: SidebarSectionProps) {
  return (
    <section className="group/section flex flex-col">
      <div className="flex h-7 items-center gap-1 pr-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 px-2 text-left"
        >
          <span className="truncate text-mini text-tertiary [font-weight:var(--weight-medium)]">
            {label}
          </span>
          <ChevronDownIcon
            size={10}
            className={cn(
              "text-quaternary opacity-0 [transition:transform_var(--speed-quick)_var(--ease-quad),opacity_var(--speed-quick)_var(--ease-quad)]",
              "group-hover/section:opacity-100",
              !expanded && "-rotate-90",
            )}
          />
        </button>
        {action ? (
          <span className="opacity-0 [transition:opacity_var(--speed-quick)_var(--ease-quad)] group-hover/section:opacity-100">
            {action}
          </span>
        ) : null}
      </div>
      {expanded ? <div className="flex flex-col">{children}</div> : null}
    </section>
  );
}

export interface SidebarItemProps {
  readonly href?: string;
  readonly onClick?: () => void;
  readonly icon?: ReactNode;
  readonly label: string;
  readonly count?: number;
  readonly active?: boolean;
  /** Nesting depth. A team's children sit one step in. */
  readonly depth?: number;
  readonly testId?: string;
  readonly trailing?: ReactNode;
}

/**
 * One 28px navigation row.
 *
 * Rendered as an `<a>` when it navigates and a `<button>` when it does not, so
 * middle-click, copy-link and "open in new tab" work on the things that are
 * genuinely places.
 */
export function SidebarItem({
  href,
  onClick,
  icon,
  label,
  count,
  active = false,
  depth = 0,
  testId,
  trailing,
}: SidebarItemProps) {
  const className = cn(
    "flex h-7 shrink-0 items-center gap-2 rounded-[var(--radius-md)] pr-2 text-small",
    "[transition:background-color_var(--speed-row-hover)_linear]",
    active
      ? "bg-[var(--bg-selected)] text-primary"
      : "text-secondary hover:bg-[var(--bg-hover)] hover:text-primary",
  );
  const style = { paddingLeft: 8 + depth * 16 };

  const body = (
    <>
      {icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 ? (
        <CountPill count={count} label={`${count} unread`} />
      ) : null}
      {trailing}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        data-testid={testId}
        aria-current={active ? "page" : undefined}
        className={className}
        style={style}
      >
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={className}
      style={style}
    >
      {body}
    </button>
  );
}
