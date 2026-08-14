"use client";

/**
 * One board column: a group, rendered vertically, that accepts drops.
 *
 * ## Where the insertion index comes from
 *
 * From the pointer, measured against the cards' own boxes on `dragover` — not
 * from per-card enter/leave handlers. `dragenter`/`dragleave` fire in an order
 * that depends on child boundaries, so a card with padding or a nested link
 * produces leave-then-enter storms and an index that flickers. One handler on
 * the column, one pass over the rects, one answer:
 *
 * > *"Dragging issues between columns places them where the mouse positioned
 * > them"* — §5.3. Position is honoured, never forced to the top.
 *
 * (Whereas the keyboard path is documented to move an issue **to the top** of
 * the target column, which is why `S` and a drag are not the same code path.)
 *
 * ## `preventDefault` is what makes a target droppable
 *
 * The HTML drag-and-drop API treats everything as non-droppable unless the
 * `dragover` handler cancels the event. A column whose grouping cannot be
 * written by dragging (by team, or ungrouped) simply does not cancel, so the
 * browser shows the "no drop" cursor rather than accepting a gesture that would
 * be silently ignored.
 */

import { useRef, useState, type DragEvent as ReactDragEvent } from "react";

import type { DisplayProperty, IssueId, IssueWithRelations, StateId } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { CountPill } from "@/components/ui/badge";
import { PlusIcon } from "@/components/ui/icons";
import type { IssueGroup } from "@/components/issues/grouping";
import { GroupGlyphIcon } from "@/components/issues/issue-group-header";
import { BoardCard } from "@/components/issues/board-card";
import type { RowProperty } from "@/components/issues/issue-row";

/** The index a pointer at `clientY` would insert at, among `container`'s cards. */
export function insertionIndex(container: HTMLElement, clientY: number): number {
  const cards = Array.from(
    container.querySelectorAll<HTMLElement>("[data-board-card]"),
  );
  for (const [index, card] of cards.entries()) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return cards.length;
}

export interface BoardColumnProps {
  readonly group: IssueGroup;
  readonly draggable: boolean;
  readonly draggingIds: ReadonlySet<IssueId>;
  readonly selected: ReadonlySet<IssueId>;
  readonly focusedId: IssueId | null;
  readonly pending: Readonly<Record<IssueId, number>>;
  readonly progressByState: ReadonlyMap<StateId, number>;
  readonly properties: readonly DisplayProperty[];
  readonly hrefFor: (issue: IssueWithRelations) => string;
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
  readonly onCreate: (group: IssueGroup) => void;
  readonly onCardDragStart: (issue: IssueWithRelations) => void;
  readonly onCardDragEnd: () => void;
  readonly onDropInto: (group: IssueGroup, index: number) => void;
}

export function BoardColumn({
  group,
  draggable,
  draggingIds,
  selected,
  focusedId,
  pending,
  progressByState,
  properties,
  hrefFor,
  onOpen,
  onSelect,
  onFocus,
  onOpenPicker,
  onCreate,
  onCardDragStart,
  onCardDragEnd,
  onDropInto,
}: BoardColumnProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!draggable || draggingIds.size === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const body = bodyRef.current;
    if (body) setDropIndex(insertionIndex(body, event.clientY));
  };

  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!draggable || draggingIds.size === 0) return;
    event.preventDefault();
    const body = bodyRef.current;
    const index =
      dropIndex ?? (body ? insertionIndex(body, event.clientY) : group.issues.length);
    setDropIndex(null);
    onDropInto(group, index);
  };

  return (
    <section
      data-testid={`board-column-${group.name}`}
      aria-label={group.name}
      onDragOver={onDragOver}
      onDragLeave={() => setDropIndex(null)}
      onDrop={onDrop}
      className="flex h-full w-[320px] shrink-0 flex-col gap-2"
    >
      <header className="flex h-[var(--group-header-height)] shrink-0 items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] px-2">
        <GroupGlyphIcon glyph={group.glyph} />
        <span className="min-w-0 flex-1 truncate text-small text-primary [font-weight:var(--weight-medium)]">
          {group.name}
        </span>
        <CountPill count={group.issues.length} label={`${group.issues.length} issues`} />
        <button
          type="button"
          aria-label={`New issue in ${group.name}`}
          onClick={() => onCreate(group)}
          className="flex size-5 items-center justify-center rounded-[var(--radius-sm)] text-tertiary hover:bg-[var(--bg-translucent)] hover:text-primary"
        >
          <PlusIcon size={14} />
        </button>
      </header>

      <div
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-8"
      >
        {group.issues.map((issue, index) => (
          <div key={issue.id} className="contents">
            {dropIndex === index ? <DropMarker /> : null}
            <BoardCard
              issue={issue}
              href={hrefFor(issue)}
              progress={progressByState.get(issue.stateId) ?? 0.5}
              selected={selected.has(issue.id)}
              focused={focusedId === issue.id}
              pending={(pending[issue.id] ?? 0) > 0}
              dragging={draggingIds.has(issue.id)}
              properties={properties}
              onOpen={onOpen}
              onSelect={onSelect}
              onFocus={onFocus}
              onOpenPicker={onOpenPicker}
              onDragStart={onCardDragStart}
              onDragEnd={onCardDragEnd}
            />
          </div>
        ))}
        {dropIndex !== null && dropIndex >= group.issues.length ? (
          <DropMarker />
        ) : null}
      </div>
    </section>
  );
}

/** Where the card will land. A line, not a gap — a gap re-flows the column. */
function DropMarker() {
  return (
    <div
      aria-hidden="true"
      className={cn("h-0.5 shrink-0 rounded-full bg-accent")}
    />
  );
}
