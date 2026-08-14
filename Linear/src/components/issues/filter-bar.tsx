"use client";

/**
 * The filter bar — `F` to add one, `Shift+F` to drop the last.
 *
 * ## Why filtering happens in the browser
 *
 * The view already holds every issue it is showing: a team's list is a few
 * hundred rows, fetched once by the server component. Round-tripping a filter
 * change would put a network hop on a control the user expects to be
 * instantaneous, and would fight the optimistic store — a re-fetch is exactly
 * the "invalidate on settle" pattern `research/04-interaction.md` §6.5 rule 1
 * tells you not to build. The SQL translation in `domain/filters.ts` stays the
 * one that matters for saved views and for anything that outgrows a page.
 *
 * ## Empty arrays are removed, not stored
 *
 * `domain/filters.ts` is deliberate that `{ stateIds: [] }` matches *nothing* —
 * "status is any of ∅" is false, and treating it as "no constraint" makes a
 * cleared filter silently show the whole workspace. In a filter *bar* the same
 * gesture means something different: unchecking the last value is how you
 * remove the chip. So {@link setFilterValues} deletes the key rather than
 * writing an empty array, and the two layers stay consistent because the UI
 * never produces the empty-array case at all.
 */

import { useRef, useState } from "react";

import type {
  IssueWithRelations,
  Label,
  LabelId,
  Priority,
  StateId,
  User,
  UserId,
  WorkflowState,
} from "@/domain/entities";
import { PRIORITY_LABELS } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { CloseIcon, FilterIcon } from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  StatusPicker,
  UNASSIGNED,
} from "@/components/issues/property-pickers";

export interface ViewFilter {
  readonly stateIds?: readonly StateId[];
  readonly assigneeIds?: readonly (UserId | null)[];
  readonly priorities?: readonly Priority[];
  readonly labelIds?: readonly LabelId[];
  /** "Find in view" — `Cmd+F`. Matches the title and the identifier. */
  readonly query?: string;
}

export const EMPTY_FILTER: ViewFilter = Object.freeze({});

export type FilterField = "stateIds" | "assigneeIds" | "priorities" | "labelIds";

export function filterIsEmpty(filter: ViewFilter): boolean {
  return (
    filter.stateIds === undefined &&
    filter.assigneeIds === undefined &&
    filter.priorities === undefined &&
    filter.labelIds === undefined &&
    (filter.query ?? "") === ""
  );
}

/** Replace one field's values, dropping the key entirely when it empties. */
export function setFilterValues<F extends FilterField>(
  filter: ViewFilter,
  field: F,
  values: NonNullable<ViewFilter[F]>,
): ViewFilter {
  const next = { ...filter };
  if (values.length === 0) delete next[field];
  else next[field] = values;
  return next;
}

/** Toggle one value in a field, creating or removing the field as needed. */
export function toggleFilterValue<F extends FilterField>(
  filter: ViewFilter,
  field: F,
  value: NonNullable<ViewFilter[F]>[number],
): ViewFilter {
  const current = (filter[field] ?? []) as readonly (typeof value)[];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
  return setFilterValues(filter, field, next as NonNullable<ViewFilter[F]>);
}

/**
 * ANDed across fields, ORed within one — the same grammar `entities.ts`
 * describes for {@link IssueFilter}, so a bar built here can be saved as a view
 * without re-interpretation.
 */
export function applyViewFilter(
  issues: readonly IssueWithRelations[],
  filter: ViewFilter,
): readonly IssueWithRelations[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  return issues.filter((issue) => {
    if (filter.stateIds && !filter.stateIds.includes(issue.stateId)) return false;
    if (filter.assigneeIds && !filter.assigneeIds.includes(issue.assigneeId)) {
      return false;
    }
    if (filter.priorities && !filter.priorities.includes(issue.priority)) {
      return false;
    }
    if (
      filter.labelIds &&
      !issue.labels.some((label) => filter.labelIds?.includes(label.id))
    ) {
      return false;
    }
    if (
      query !== "" &&
      !issue.title.toLowerCase().includes(query) &&
      !issue.identifier.toLowerCase().includes(query)
    ) {
      return false;
    }
    return true;
  });
}

export interface FilterBarProps {
  readonly filter: ViewFilter;
  readonly onChange: (filter: ViewFilter) => void;
  readonly states: readonly WorkflowState[];
  readonly users: readonly User[];
  readonly labels: readonly Label[];
  /** Opened by `F`; the bar reports back when it closes. */
  readonly requestOpen: boolean;
  readonly onRequestOpenChange: (open: boolean) => void;
}

type ValuePicker = FilterField | null;

const FIELD_LABELS: Readonly<Record<FilterField, string>> = {
  stateIds: "Status",
  assigneeIds: "Assignee",
  priorities: "Priority",
  labelIds: "Label",
};

export function FilterBar({
  filter,
  onChange,
  states,
  users,
  labels,
  requestOpen,
  onRequestOpenChange,
}: FilterBarProps) {
  const addRef = useRef<HTMLButtonElement | null>(null);
  const [picker, setPicker] = useState<ValuePicker>(null);

  const chips = describeChips(filter, { states, users, labels });

  const fieldOptions: ComboboxOption[] = (
    Object.keys(FIELD_LABELS) as FilterField[]
  ).map((field) => ({ value: field, label: FIELD_LABELS[field] }));

  return (
    <div
      data-testid="filter-bar"
      className={cn(
        "flex flex-wrap items-center gap-1.5 border-b border-subtle px-4 py-2",
        chips.length === 0 && "hidden",
      )}
    >
      {chips.map((chip) => (
        <span
          key={chip.field}
          data-testid={`filter-chip-${chip.field}`}
          className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-md)] border border-default px-1.5 text-mini text-tertiary"
        >
          <span className="text-quaternary">{chip.label}</span>
          <span className="text-primary">{chip.value}</span>
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => onChange(setFilterValues(filter, chip.field, []))}
            className="text-tertiary hover:text-primary"
          >
            <CloseIcon size={10} />
          </button>
        </span>
      ))}

      <button
        ref={addRef}
        type="button"
        aria-label="Add filter"
        onClick={() => onRequestOpenChange(true)}
        className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-md)] px-1.5 text-mini text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
      >
        <FilterIcon size={12} />
        Filter
      </button>

      <Popover
        open={requestOpen && picker === null}
        onOpenChange={onRequestOpenChange}
        anchor={addRef}
        aria-label="Filter by"
        className="p-0"
        style={{ width: 200 }}
      >
        <Combobox
          options={fieldOptions}
          label="Filter by"
          placeholder="Filter by…"
          onSelect={(value) => {
            setPicker(value as FilterField);
          }}
          onRequestClose={() => onRequestOpenChange(false)}
        />
      </Popover>

      <StatusPicker
        open={picker === "stateIds"}
        onOpenChange={(open) => {
          if (!open) {
            setPicker(null);
            onRequestOpenChange(false);
          }
        }}
        anchor={addRef}
        states={states}
        value={filter.stateIds?.[0] ?? null}
        onSelect={(stateId) =>
          onChange(toggleFilterValue(filter, "stateIds", stateId))
        }
      />
      <AssigneePicker
        open={picker === "assigneeIds"}
        onOpenChange={(open) => {
          if (!open) {
            setPicker(null);
            onRequestOpenChange(false);
          }
        }}
        anchor={addRef}
        users={users}
        value={filter.assigneeIds?.[0] ?? null}
        onSelect={(assigneeId) =>
          onChange(toggleFilterValue(filter, "assigneeIds", assigneeId))
        }
      />
      <PriorityPicker
        open={picker === "priorities"}
        onOpenChange={(open) => {
          if (!open) {
            setPicker(null);
            onRequestOpenChange(false);
          }
        }}
        anchor={addRef}
        value={filter.priorities?.[0] ?? null}
        onSelect={(priority) =>
          onChange(toggleFilterValue(filter, "priorities", priority))
        }
      />
      <LabelPicker
        open={picker === "labelIds"}
        onOpenChange={(open) => {
          if (!open) {
            setPicker(null);
            onRequestOpenChange(false);
          }
        }}
        anchor={addRef}
        labels={labels}
        values={filter.labelIds ?? []}
        onToggle={(labelId) =>
          onChange(toggleFilterValue(filter, "labelIds", labelId))
        }
      />
    </div>
  );
}

interface Chip {
  readonly field: FilterField;
  readonly label: string;
  readonly value: string;
}

/**
 * One chip per constrained field, summarising its values.
 *
 * "Status: In Progress, Todo" rather than one chip per value: the grammar ORs
 * within a field, and rendering the members as separate chips implies they can
 * be combined some other way.
 */
function describeChips(
  filter: ViewFilter,
  catalog: {
    readonly states: readonly WorkflowState[];
    readonly users: readonly User[];
    readonly labels: readonly Label[];
  },
): readonly Chip[] {
  const chips: Chip[] = [];

  if (filter.stateIds) {
    chips.push({
      field: "stateIds",
      label: "Status",
      value: filter.stateIds
        .map(
          (id) =>
            catalog.states.find((state) => state.id === id)?.name ?? "Unknown",
        )
        .join(", "),
    });
  }
  if (filter.assigneeIds) {
    chips.push({
      field: "assigneeIds",
      label: "Assignee",
      value: filter.assigneeIds
        .map((id) =>
          id === null
            ? "Unassigned"
            : (catalog.users.find((user) => user.id === id)?.name ?? UNASSIGNED),
        )
        .join(", "),
    });
  }
  if (filter.priorities) {
    chips.push({
      field: "priorities",
      label: "Priority",
      value: filter.priorities
        .map((priority: Priority) => PRIORITY_LABELS[priority])
        .join(", "),
    });
  }
  if (filter.labelIds) {
    chips.push({
      field: "labelIds",
      label: "Label",
      value: filter.labelIds
        .map(
          (id) =>
            catalog.labels.find((label) => label.id === id)?.name ?? "Unknown",
        )
        .join(", "),
    });
  }
  return chips;
}
