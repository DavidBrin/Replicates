"use client";

/**
 * The board: the same groups as the list, laid out horizontally.
 *
 * *"The board is a direct-manipulation editor for one field"*
 * (`research/04-interaction.md` §5.3). Dropping a card into another column
 * **writes the grouped field** — status into a status board, assignee into an
 * assignee board — and dropping inside a column writes `sortOrder` and nothing
 * else. Both halves of that come out of {@link planDrop}, which is a pure
 * function precisely because it is the rule worth testing.
 *
 * ## Why the drop is planned, not performed, here
 *
 * The gesture produces a list of {@link ReorderRequest}s and hands them to the
 * store. Nothing on this component's side animates: §5.4 is blunt about it —
 * the card is already where it was dropped because the store moved it, so
 * letting a drag library animate the card home *and then* re-render it in the
 * new column is a visible double-move. There is no drop animation to cancel
 * here because there is no drag library; the native API's own ghost disappears
 * on drop, which is exactly the wanted behaviour.
 *
 * ## Order keys are derived, never invented
 *
 * `keyBetween` from `domain/ordering` produces every key. Multi-card drops
 * chain it — the second card lands between the first card's brand-new key and
 * the row below — which is deterministic, so the server recomputing from the
 * same neighbours arrives at the same strings and the reconcile is a no-op.
 */

import { useMemo, useRef, useState } from "react";

import type {
  DisplayProperty,
  IssueId,
  IssueWithRelations,
  StateId,
} from "@/domain/entities";
import { keyBetween } from "@/domain/ordering";
import type { IssueFieldPatch, ReorderRequest } from "@/lib/store/issues";
import type { IssueGroup } from "@/components/issues/grouping";
import { BoardColumn } from "@/components/issues/board-column";
import type { RowProperty } from "@/components/issues/issue-row";

export interface DropPlanInput {
  /** The cards being dragged, in the order they should end up. */
  readonly dragged: readonly IssueWithRelations[];
  readonly group: IssueGroup;
  /** Insertion index measured against the column as rendered — dragged cards included. */
  readonly index: number;
}

/**
 * Turn a drop into the writes it implies.
 *
 * Two conversions happen here and both are easy to get subtly wrong:
 *
 * 1. **The index is rebased.** It was measured against the column *as
 *    rendered*, which still contains the cards being dragged. Neighbours have
 *    to be read from the column with those cards removed, or dropping a card
 *    one slot down lands it back where it started.
 * 2. **Keys chain.** Asking for `keyBetween(before, after)` twice returns the
 *    same string twice, so a two-card drop would produce a tie. Each card's key
 *    becomes the next card's left neighbour instead.
 */
export function planDrop({
  dragged,
  group,
  index,
}: DropPlanInput): readonly ReorderRequest[] {
  if (!group.droppable || dragged.length === 0) return [];

  const draggedIds = new Set(dragged.map((issue) => issue.id));
  const remaining = group.issues.filter((issue) => !draggedIds.has(issue.id));
  const rebased = group.issues
    .slice(0, index)
    .filter((issue) => !draggedIds.has(issue.id)).length;

  const afterKey = remaining[rebased]?.sortOrder ?? null;
  let cursor = rebased === 0 ? null : (remaining[rebased - 1]?.sortOrder ?? null);

  const requests: ReorderRequest[] = [];
  for (const issue of dragged) {
    const sortOrder = keyBetween(cursor, afterKey);
    const patch: IssueFieldPatch = { ...group.patchFor(issue), sortOrder };
    requests.push({ id: issue.id, beforeKey: cursor, afterKey, patch });
    cursor = sortOrder;
  }
  return requests;
}

export interface IssueBoardProps {
  readonly groups: readonly IssueGroup[];
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
  readonly onCreateInGroup: (group: IssueGroup) => void;
  readonly onMove: (requests: readonly ReorderRequest[]) => void;
}

export function IssueBoard({
  groups,
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
  onCreateInGroup,
  onMove,
}: IssueBoardProps) {
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<IssueId>>(
    () => new Set(),
  );
  // The payload, kept out of state: `dragover` fires dozens of times a second
  // and must not re-render the board to read it.
  const draggedRef = useRef<readonly IssueWithRelations[]>([]);

  const byId = useMemo(() => {
    const map = new Map<IssueId, IssueWithRelations>();
    for (const group of groups) {
      for (const issue of group.issues) map.set(issue.id, issue);
    }
    return map;
  }, [groups]);

  const onCardDragStart = (issue: IssueWithRelations): void => {
    // A selection drags as a unit, but only when the grabbed card is part of
    // it — grabbing an unselected card drags that card alone and leaves the
    // selection untouched (§4.7).
    const ids = selected.has(issue.id) ? [...selected] : [issue.id];
    const payload = ids.flatMap((id) => {
      const found = byId.get(id);
      return found ? [found] : [];
    });
    draggedRef.current = payload;
    setDraggingIds(new Set(payload.map((row) => row.id)));
  };

  const onCardDragEnd = (): void => {
    draggedRef.current = [];
    setDraggingIds(new Set());
  };

  const onDropInto = (group: IssueGroup, index: number): void => {
    const requests = planDrop({
      dragged: draggedRef.current,
      group,
      index,
    });
    onCardDragEnd();
    if (requests.length > 0) onMove(requests);
  };

  return (
    <div
      data-testid="issue-board"
      role="listbox"
      aria-label="Issue board"
      aria-multiselectable="true"
      className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-4"
    >
      {groups.map((group) => (
        <BoardColumn
          key={group.id}
          group={group}
          draggable={group.droppable}
          draggingIds={draggingIds}
          selected={selected}
          focusedId={focusedId}
          pending={pending}
          progressByState={progressByState}
          properties={properties}
          hrefFor={hrefFor}
          onOpen={onOpen}
          onSelect={onSelect}
          onFocus={onFocus}
          onOpenPicker={onOpenPicker}
          onCreate={onCreateInGroup}
          onCardDragStart={onCardDragStart}
          onCardDragEnd={onCardDragEnd}
          onDropInto={onDropInto}
        />
      ))}
    </div>
  );
}
