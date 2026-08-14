"use client";

/**
 * The view controls that sit at the right of the sub-header: filter, display
 * options, and the list⇄board switch.
 *
 * Every one of them has a keyboard equivalent and says so in its tooltip —
 * `research/04-interaction.md` §1.1, rule 5: *"every shortcut has a mouse
 * equivalent, and every menu shows its shortcut"*, with contextual menus
 * described by Linear's own designer as a **teaching surface**. A control whose
 * shortcut is undiscoverable is a control most users never learn.
 *
 * The layout switch is a segmented pair rather than a single toggle button: a
 * toggle shows the state you are *not* in, which people read backwards about
 * half the time, and there is no third state to justify the ambiguity.
 */

import type { RefObject } from "react";

import type { ViewLayout } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { FilterIcon, PlusIcon, SlidersIcon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";

export interface ViewToolbarProps {
  readonly layout: ViewLayout;
  readonly onLayoutChange: (layout: ViewLayout) => void;
  readonly onOpenFilter: () => void;
  readonly filterActive: boolean;
  readonly displayRef: RefObject<HTMLButtonElement | null>;
  readonly onOpenDisplay: () => void;
  readonly onNewIssue: () => void;
}

export function ViewToolbar({
  layout,
  onLayoutChange,
  onOpenFilter,
  filterActive,
  displayRef,
  onOpenDisplay,
  onNewIssue,
}: ViewToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      <Tooltip content="Filter" shortcut="f">
        <button
          type="button"
          aria-label="Filter"
          onClick={onOpenFilter}
          className={cn(
            "flex size-7 items-center justify-center rounded-[var(--radius-md)]",
            "[transition:background-color_var(--speed-quick)_var(--ease-quad)]",
            filterActive
              ? "bg-[var(--accent-tint)] text-[var(--accent-text)]"
              : "text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
          )}
        >
          <FilterIcon size={14} />
        </button>
      </Tooltip>

      <Tooltip content="Display" shortcut="shift+v">
        <button
          ref={displayRef}
          type="button"
          aria-label="Display options"
          onClick={onOpenDisplay}
          className="flex size-7 items-center justify-center rounded-[var(--radius-md)] text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
        >
          <SlidersIcon size={14} />
        </button>
      </Tooltip>

      <div
        role="group"
        aria-label="Layout"
        className="ml-1 flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--bg-translucent)] p-0.5"
      >
        <LayoutButton
          layout="list"
          current={layout}
          onSelect={onLayoutChange}
          label="List"
        />
        <LayoutButton
          layout="board"
          current={layout}
          onSelect={onLayoutChange}
          label="Board"
        />
      </div>

      <Tooltip content="New issue" shortcut="c">
        <button
          type="button"
          data-testid="new-issue-button"
          aria-label="New issue"
          onClick={onNewIssue}
          className="ml-1 flex size-7 items-center justify-center rounded-[var(--radius-md)] border border-default text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
        >
          <PlusIcon size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

function LayoutButton({
  layout,
  current,
  onSelect,
  label,
}: {
  layout: ViewLayout;
  current: ViewLayout;
  onSelect: (layout: ViewLayout) => void;
  label: string;
}) {
  const active = layout === current;
  return (
    <button
      type="button"
      data-testid={`layout-${layout}`}
      aria-pressed={active}
      onClick={() => onSelect(layout)}
      className={cn(
        "h-6 rounded-[var(--radius-sm)] px-2 text-mini",
        "[transition:background-color_var(--speed-quick)_var(--ease-quad)]",
        active
          ? "bg-[var(--bg-elevated)] text-primary"
          : "text-tertiary hover:text-primary",
      )}
    >
      {label}
    </button>
  );
}
