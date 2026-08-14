"use client";

/**
 * The grouped issue list.
 *
 * Presentational on purpose: every piece of state it renders — the grouping,
 * the selection, the keyboard cursor — is owned by `issue-view.tsx` and shared
 * with the board. `research/04-interaction.md` §5.5 is explicit that the two
 * views must be one implementation differing only in "next in direction", and
 * the way to keep that true is for neither of them to own any of it.
 *
 * ## `role="listbox"` and a roving tabindex
 *
 * §9.2: a list with hundreds of rows must not put hundreds of stops in the tab
 * order. Exactly one row carries `tabIndex=0` — the focused one — and the
 * arrow keys move it. `aria-activedescendant` is the other valid model and is
 * what the combobox uses; a roving index is the better fit here because the
 * rows contain their own controls (a checkbox, property chips) that must be
 * reachable once you are on a row.
 */

import type {
  DisplayProperty,
  IssueId,
  IssueWithRelations,
  StateId,
} from "@/domain/entities";
import { cn } from "@/lib/cn";
import type { IssueGroup } from "@/components/issues/grouping";
import { IssueGroupHeader } from "@/components/issues/issue-group-header";
import { IssueRow, type RowProperty } from "@/components/issues/issue-row";

export interface IssueListProps {
  readonly groups: readonly IssueGroup[];
  /** False when grouping is `none`: a single header saying "All issues" is noise. */
  readonly showGroupHeaders: boolean;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggleGroup: (groupId: string) => void;
  readonly onCreateInGroup: (group: IssueGroup) => void;

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
}

export function IssueList({
  groups,
  showGroupHeaders,
  collapsed,
  onToggleGroup,
  onCreateInGroup,
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
}: IssueListProps) {
  const total = groups.reduce((sum, group) => sum + group.issues.length, 0);

  return (
    <div
      data-testid="issue-list"
      role="listbox"
      aria-label="Issues"
      aria-multiselectable="true"
      className="min-h-0 flex-1 overflow-y-auto pb-8"
    >
      {total === 0 ? (
        <p className="px-6 py-16 text-center text-small text-tertiary">
          No issues here yet. Press{" "}
          <kbd className="rounded-sm bg-[var(--bg-translucent)] px-1">C</kbd> to
          create one.
        </p>
      ) : null}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return (
          <section key={group.id} className={cn(showGroupHeaders && "mb-1")}>
            {showGroupHeaders ? (
              <IssueGroupHeader
                name={group.name}
                glyph={group.glyph}
                count={group.issues.length}
                collapsed={isCollapsed}
                onToggle={() => onToggleGroup(group.id)}
                onCreate={() => onCreateInGroup(group)}
              />
            ) : null}

            {isCollapsed
              ? null
              : group.issues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    href={hrefFor(issue)}
                    progress={progressByState.get(issue.stateId) ?? 0.5}
                    selected={selected.has(issue.id)}
                    focused={focusedId === issue.id}
                    pending={(pending[issue.id] ?? 0) > 0}
                    properties={properties}
                    onOpen={onOpen}
                    onSelect={onSelect}
                    onFocus={onFocus}
                    onOpenPicker={onOpenPicker}
                  />
                ))}
          </section>
        );
      })}
    </div>
  );
}
