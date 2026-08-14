"use client";

/**
 * The display-options panel — `Shift+V`.
 *
 * Grouping, ordering, and which properties a row shows. It writes
 * {@link DisplayOptions} from `domain/entities.ts` rather than a shape of its
 * own, because that is what a saved view persists — a panel with its own
 * vocabulary would need a translation layer whose only job is to be wrong once.
 *
 * ## Ordering gates dragging
 *
 * §4.7: manual reordering is only available while the view is ordered
 * manually — Linear gates it explicitly, in this panel. A view sorted by
 * priority that still accepted drags would either lose the drop or silently
 * re-sort it away, so the *view* disables dragging and this is where the user
 * finds out why.
 *
 * ## Why the layout toggle lives here and on the toolbar
 *
 * Three affordances for one state, which is Linear's rule (§1.1, item 5: every
 * shortcut has a mouse equivalent). `Cmd+B` toggles it, the toolbar shows it as
 * two segmented buttons, and this panel names it. All three write the same
 * field.
 */

import { useId } from "react";

import {
  DISPLAY_PROPERTIES,
  GROUP_BY_OPTIONS,
  ORDER_BY_OPTIONS,
  type DisplayOptions,
  type DisplayProperty,
  type GroupBy,
  type OrderBy,
} from "@/domain/entities";
import { cn } from "@/lib/cn";
import { Popover } from "@/components/ui/popover";

/** The shipped default: grouped by status, manual order, Linear's own row. */
export const DEFAULT_DISPLAY: DisplayOptions = Object.freeze({
  layout: "list",
  groupBy: "status",
  orderBy: "manual",
  orderDirection: "asc",
  showSubIssues: false,
  showEmptyGroups: false,
  showCompletedIssues: true,
  properties: Object.freeze([
    "priority",
    "identifier",
    "status",
    "labels",
    "dueDate",
    "assignee",
    "updated",
  ]) as readonly DisplayProperty[],
});

const GROUP_LABELS: Readonly<Record<GroupBy, string>> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  project: "Project",
  label: "Label",
  team: "Team",
  none: "No grouping",
};

const ORDER_LABELS: Readonly<Record<OrderBy, string>> = {
  manual: "Manual",
  priority: "Priority",
  created: "Created",
  updated: "Updated",
  dueDate: "Due date",
  title: "Title",
};

const PROPERTY_LABELS: Readonly<Record<DisplayProperty, string>> = {
  priority: "Priority",
  identifier: "ID",
  status: "Status",
  labels: "Labels",
  project: "Project",
  dueDate: "Due date",
  estimate: "Estimate",
  assignee: "Assignee",
  created: "Created",
  updated: "Updated",
};

export interface DisplayOptionsPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly anchor: React.RefObject<HTMLElement | null>;
  readonly value: DisplayOptions;
  readonly onChange: (next: DisplayOptions) => void;
}

export function DisplayOptionsPanel({
  open,
  onOpenChange,
  anchor,
  value,
  onChange,
}: DisplayOptionsPanelProps) {
  const baseId = useId();

  const toggleProperty = (property: DisplayProperty): void => {
    const properties = value.properties.includes(property)
      ? value.properties.filter((entry) => entry !== property)
      : [...value.properties, property];
    onChange({ ...value, properties });
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      placement="bottom-end"
      aria-label="Display options"
      className="p-3"
      style={{ width: 280 }}
    >
      <div data-testid="display-options" className="flex flex-col gap-3">
        <Row label="Grouping" htmlFor={`${baseId}-group`}>
          <Select
            id={`${baseId}-group`}
            testId="display-group-by"
            value={value.groupBy}
            options={GROUP_BY_OPTIONS.map((option) => ({
              value: option,
              label: GROUP_LABELS[option],
            }))}
            onChange={(next) => onChange({ ...value, groupBy: next as GroupBy })}
          />
        </Row>

        <Row label="Ordering" htmlFor={`${baseId}-order`}>
          <Select
            id={`${baseId}-order`}
            testId="display-order-by"
            value={value.orderBy}
            options={ORDER_BY_OPTIONS.map((option) => ({
              value: option,
              label: ORDER_LABELS[option],
            }))}
            onChange={(next) => onChange({ ...value, orderBy: next as OrderBy })}
          />
        </Row>

        <Row label="Layout" htmlFor={`${baseId}-layout`}>
          <Select
            id={`${baseId}-layout`}
            testId="display-layout"
            value={value.layout}
            options={[
              { value: "list", label: "List" },
              { value: "board", label: "Board" },
            ]}
            onChange={(next) =>
              onChange({ ...value, layout: next === "board" ? "board" : "list" })
            }
          />
        </Row>

        <Toggle
          label="Show empty groups"
          checked={value.showEmptyGroups}
          onChange={(checked) => onChange({ ...value, showEmptyGroups: checked })}
        />
        <Toggle
          label="Show completed issues"
          checked={value.showCompletedIssues}
          onChange={(checked) =>
            onChange({ ...value, showCompletedIssues: checked })
          }
        />
        <Toggle
          label="Show sub-issues"
          checked={value.showSubIssues}
          onChange={(checked) => onChange({ ...value, showSubIssues: checked })}
        />

        <div className="flex flex-col gap-1.5 border-t border-subtle pt-3">
          <span className="text-micro text-tertiary">Display properties</span>
          <div className="flex flex-wrap gap-1">
            {DISPLAY_PROPERTIES.map((property) => {
              const active = value.properties.includes(property);
              return (
                <button
                  key={property}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleProperty(property)}
                  className={cn(
                    "h-6 rounded-[var(--radius-md)] border px-2 text-mini",
                    "[transition:background-color_var(--speed-quick)_var(--ease-quad)]",
                    active
                      ? "border-accent bg-[var(--accent-tint)] text-[var(--accent-text)]"
                      : "border-default text-tertiary hover:text-primary",
                  )}
                >
                  {PROPERTY_LABELS[property]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Popover>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="text-small text-tertiary">
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  id,
  testId,
  value,
  options,
  onChange,
}: {
  id: string;
  testId: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-7 rounded-[var(--radius-md)] border border-default bg-[var(--bg-translucent)]",
        "px-2 text-small text-primary outline-none",
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-small text-tertiary">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[var(--accent)]"
      />
    </label>
  );
}
