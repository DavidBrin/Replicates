"use client";

/**
 * One card on the board.
 *
 * Deliberately sparse, and that is Linear's own framing:
 * *"Descriptions are not shown on cards. If an issue has many properties, not
 * all properties may have space to be displayed"* (`research/04-interaction.md`
 * §5.2). Overflow is **dropped, not wrapped** — a card that grows to fit its
 * labels breaks the column's rhythm, which is the only thing making a board
 * scannable.
 *
 * Three lines: identifier and assignee, title, then status, labels and
 * priority. The same four visual states as a row — rest, hover, keyboard
 * cursor, selected — expressed the same way, so the two views cannot drift.
 */

import { memo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";

import type { DisplayProperty, IssueWithRelations } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { DueDatePill, LabelChip } from "@/components/ui/badge";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { formatShortDate, isOverdue, type RowProperty } from "@/components/issues/issue-row";

export interface BoardCardProps {
  readonly issue: IssueWithRelations;
  readonly href: string;
  readonly progress: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly pending: boolean;
  readonly dragging: boolean;
  readonly properties: readonly DisplayProperty[];
  readonly onOpen: (issue: IssueWithRelations) => void;
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
  readonly onDragStart: (issue: IssueWithRelations) => void;
  readonly onDragEnd: () => void;
}

function BoardCardImpl({
  issue,
  href,
  progress,
  selected,
  focused,
  pending,
  dragging,
  properties,
  onOpen,
  onSelect,
  onFocus,
  onOpenPicker,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  const shows = (property: DisplayProperty): boolean =>
    properties.includes(property);

  const onClick = (event: ReactMouseEvent): void => {
    if (event.shiftKey) {
      event.preventDefault();
      onSelect(issue, "range");
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      onSelect(issue, "additive");
      return;
    }
    onOpen(issue);
  };

  const beginDrag = (event: ReactDragEvent<HTMLDivElement>): void => {
    // The payload lives in the board's own state, not in `dataTransfer`:
    // `getData` is unreadable during `dragover` in every browser, and the drop
    // index has to be computed there. `setData` is still called because Firefox
    // refuses to start a drag without it.
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", issue.identifier);
    onDragStart(issue);
  };

  return (
    <div
      data-board-card=""
      data-testid={`board-card-${issue.identifier}`}
      data-issue-id={issue.id}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      draggable
      onDragStart={beginDrag}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onFocus={() => onFocus(issue)}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-[var(--radius-lg)] border p-3",
        "bg-[var(--bg-elevated)] outline-none",
        "[transition:background-color_var(--speed-row-hover)_linear,box-shadow_0.15s_var(--ease-quad)]",
        selected ? "border-accent" : "border-subtle hover:border-default",
        focused && "[box-shadow:0_0_0_1px_var(--border-strong)_inset]",
        pending && "opacity-70",
        // The drop has already moved the card in the store, so the original is
        // hidden rather than animated home (§5.4).
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-micro text-tertiary tabular-nums">
          {issue.identifier}
        </span>
        {shows("assignee") && issue.assignee ? (
          <button
            type="button"
            aria-label={`Assignee: ${issue.assignee.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPicker("assignee", issue, event.currentTarget);
            }}
          >
            <Avatar
              id={issue.assignee.id}
              name={issue.assignee.name}
              src={issue.assignee.avatarUrl}
              color={issue.assignee.avatarColor}
              size={16}
              decorative
            />
          </button>
        ) : null}
      </div>

      <a
        href={href}
        data-testid="issue-row-title"
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
          }
        }}
        className="line-clamp-2 text-small text-primary [font-weight:var(--weight-normal)]"
      >
        {issue.title}
      </a>

      <div className="flex items-center gap-1.5 overflow-hidden">
        {shows("status") ? (
          <StatusIcon
            type={issue.state.type}
            color={issue.state.color}
            progress={progress}
            decorative
          />
        ) : null}
        {shows("priority") ? (
          <PriorityIcon priority={issue.priority} size={14} muted decorative />
        ) : null}
        {shows("labels")
          ? issue.labels
              .slice(0, 2)
              .map((label) => (
                <LabelChip key={label.id} name={label.name} color={label.color} />
              ))
          : null}
        <span className="flex-1" />
        {shows("dueDate") && issue.dueDate ? (
          <DueDatePill overdue={isOverdue(issue)} title={issue.dueDate}>
            {formatShortDate(issue.dueDate)}
          </DueDatePill>
        ) : null}
      </div>
    </div>
  );
}

export const BoardCard = memo(BoardCardImpl);
