"use client";

/**
 * One row of the issue list.
 *
 * 44px tall, no separator, and the hover highlight is a **pill inset 8px from
 * each edge** rather than a full-bleed band — three measurements from
 * `research/01-visual-design.md` §6.2 that between them account for most of
 * whether a screenshot reads as Linear.
 *
 * ## The transition, which is the one thing to get right
 *
 * ```
 * transition: background-color 0s, box-shadow 0.15s
 * ```
 *
 * The background changes **instantly**; only the shadow eases. §8, item 6 of
 * the same document: *"any easing on background-color makes the list feel
 * laggy"* — a 150ms colour fade on a row you are scanning past reads as the app
 * struggling to keep up. `--speed-row-hover` is `0s` for exactly this, and it
 * is a token rather than a literal so the rule is visible where the durations
 * are defined.
 *
 * ## Four states, not two
 *
 * Rest, hover, **keyboard-focused**, and selected — with focused-and-selected a
 * fourth combination (§4.1). Hover and the keyboard cursor are independent:
 * moving the mouse must not move the cursor, and arrowing must not follow the
 * pointer. Conflating them is named in the research as *the* classic bug in
 * clones, and it is why focus is a `box-shadow` ring while hover is a
 * background — two properties that can be true at once without fighting.
 *
 * ## Why the checkbox occupies space it cannot see
 *
 * Hover reveals a checkbox at the left edge. Its width is reserved permanently
 * and only `opacity` changes: inserting it on hover would shift every column in
 * the row by 20px under the pointer, which is the jankiest thing a dense list
 * can do.
 */

import { memo, useRef, type MouseEvent as ReactMouseEvent } from "react";

import type { DisplayProperty, IssueWithRelations } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { DueDatePill, LabelChip } from "@/components/ui/badge";
import { CheckIcon } from "@/components/ui/icons";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";

/** Which property chip a click inside a row opened. */
export type RowProperty = "status" | "priority" | "assignee" | "labels" | "project";

export interface IssueRowProps {
  readonly issue: IssueWithRelations;
  readonly href: string;
  /** 0–1 wedge fill for a started state; ignored otherwise. */
  readonly progress: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly pending: boolean;
  readonly properties: readonly DisplayProperty[];
  readonly onOpen: (issue: IssueWithRelations) => void;
  /** `additive` is Cmd/Ctrl-click, `range` is Shift-click (§4.2). */
  readonly onSelect: (
    issue: IssueWithRelations,
    mode: "toggle" | "additive" | "range",
  ) => void;
  readonly onFocus: (issue: IssueWithRelations) => void;
  readonly onOpenPicker: (
    property: RowProperty,
    issue: IssueWithRelations,
    anchor: HTMLElement,
  ) => void;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * `Jul 14`, in a fixed locale.
 *
 * Fixed because these components render on the server as well: a locale read
 * from the environment produces one string in the SSR pass and another during
 * hydration, and React replaces the node rather than reusing it.
 */
export function formatShortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

/** A due date is only overdue while the issue is still open. */
export function isOverdue(issue: IssueWithRelations, today = new Date()): boolean {
  if (!issue.dueDate) return false;
  if (issue.state.type === "completed" || issue.state.type === "canceled") {
    return false;
  }
  return issue.dueDate < today.toISOString().slice(0, 10);
}

function IssueRowImpl({
  issue,
  href,
  progress,
  selected,
  focused,
  pending,
  properties,
  onOpen,
  onSelect,
  onFocus,
  onOpenPicker,
}: IssueRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const shows = (property: DisplayProperty): boolean =>
    properties.includes(property);

  const onClick = (event: ReactMouseEvent): void => {
    if (event.shiftKey) {
      event.preventDefault();
      onSelect(issue, "range");
      return;
    }
    // Cmd/Ctrl-click selects rather than opening a new tab. That overrides a
    // browser convention, and it is Linear's — §4.2 flags it as surprising and
    // says to keep parity; middle-click and the context menu still open a tab.
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      onSelect(issue, "additive");
      return;
    }
    onOpen(issue);
  };

  const stop = (
    property: RowProperty,
  ): ((event: ReactMouseEvent<HTMLButtonElement>) => void) => {
    return (event) => {
      // Without this the row navigates out from under the picker that is
      // opening (§4.2).
      event.stopPropagation();
      event.preventDefault();
      onOpenPicker(property, issue, event.currentTarget);
    };
  };

  return (
    <div
      ref={rowRef}
      data-testid={`issue-row-${issue.identifier}`}
      data-issue-id={issue.id}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      onClick={onClick}
      onFocus={() => onFocus(issue)}
      className={cn(
        "group relative mx-2 flex h-[var(--row-height)] cursor-pointer items-center gap-2",
        "rounded-[var(--radius-lg)] px-2 outline-none",
        "[transition:background-color_var(--speed-row-hover)_linear,box-shadow_0.15s_var(--ease-quad)]",
        selected ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]",
        focused && "[box-shadow:0_0_0_1px_var(--border-strong)_inset]",
        // Pending is a tint, never a spinner and never a size change: the
        // optimistic row has to occupy the same box as the confirmed one
        // (§6.5, rule 4).
        pending && "opacity-70",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${issue.identifier}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(issue, event.shiftKey ? "range" : "toggle");
        }}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
          "border [transition:opacity_var(--speed-quick)_var(--ease-quad)]",
          selected
            ? "border-accent bg-accent text-[var(--text-on-accent)] opacity-100"
            : "border-strong opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        {selected ? <CheckIcon size={12} /> : null}
      </button>

      {shows("priority") ? (
        <button
          type="button"
          aria-label={`Priority: ${issue.priority}`}
          onClick={stop("priority")}
          className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-translucent)]"
        >
          {/* Muted inside a dense list — a column of orange squares out-shouts
              the titles (`priority-icon.tsx`). */}
          <PriorityIcon priority={issue.priority} muted decorative />
        </button>
      ) : null}

      {shows("identifier") ? (
        <span className="w-[68px] shrink-0 truncate text-mini text-tertiary tabular-nums">
          {issue.identifier}
        </span>
      ) : null}

      {shows("status") ? (
        <button
          type="button"
          aria-label={`Status: ${issue.state.name}`}
          onClick={stop("status")}
          className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-translucent)]"
        >
          <StatusIcon
            type={issue.state.type}
            color={issue.state.color}
            progress={progress}
            decorative
          />
        </button>
      ) : null}

      <a
        href={href}
        data-testid="issue-row-title"
        onClick={(event) => {
          // The anchor exists for middle-click, copy-link and the context menu.
          // A plain left click is the row's gesture, handled once on the row.
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
          }
        }}
        className="min-w-0 flex-1 truncate text-small text-primary [font-weight:var(--weight-normal)]"
      >
        {issue.title}
      </a>

      {shows("labels") && issue.labels.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1">
          {issue.labels.slice(0, 3).map((label) => (
            <LabelChip
              key={label.id}
              name={label.name}
              color={label.color}
              dotOnly={issue.labels.length > 2}
            />
          ))}
        </span>
      ) : null}

      {shows("dueDate") && issue.dueDate ? (
        <DueDatePill overdue={isOverdue(issue)} title={issue.dueDate}>
          {formatShortDate(issue.dueDate)}
        </DueDatePill>
      ) : null}

      {shows("estimate") && issue.estimate !== null ? (
        <span className="shrink-0 text-micro text-tertiary tabular-nums">
          {issue.estimate}
        </span>
      ) : null}

      {shows("assignee") ? (
        <button
          type="button"
          aria-label={
            issue.assignee ? `Assignee: ${issue.assignee.name}` : "Unassigned"
          }
          onClick={stop("assignee")}
          className="flex size-5 shrink-0 items-center justify-center rounded-full"
        >
          {issue.assignee ? (
            <Avatar
              id={issue.assignee.id}
              name={issue.assignee.name}
              src={issue.assignee.avatarUrl}
              color={issue.assignee.avatarColor}
              size={20}
              decorative
            />
          ) : (
            <span className="size-5 rounded-full border border-dashed border-strong" />
          )}
        </button>
      ) : null}

      {shows("updated") || shows("created") ? (
        <span className="w-12 shrink-0 text-right text-mini text-tertiary tabular-nums">
          {formatShortDate(shows("created") ? issue.createdAt : issue.updatedAt)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Memoised on identity.
 *
 * The store reconciles by merging into the existing object and preserves
 * identity where nothing changed (§6.5, rule 5), so a status edit on one issue
 * re-renders one row rather than two hundred.
 */
export const IssueRow = memo(IssueRowImpl);
