"use client";

/**
 * The property pickers.
 *
 * All five are the same control — `research/04-interaction.md` §3 opens with
 * "**Build it once**", and `components/ui/combobox.tsx` is where it was built.
 * What lives here is only the part that differs per property: which options,
 * which glyph, and what a selection means. No keyboard model, no filtering, no
 * focus management is re-implemented below.
 *
 * ## Why `Popover` + `Combobox` rather than `ComboboxPopover`
 *
 * `ComboboxPopover` is the same two components composed, and it is the right
 * call almost everywhere. It is not used here for one reason: the e2e contract
 * (`e2e/README.md`) requires `status-picker`, `priority-picker`,
 * `assignee-picker` and `label-picker` on the popovers themselves, and the
 * composed helper exposes no slot to hang an attribute on. Reaching for
 * `ComboboxPopover` and then addressing the panel through a CSS class would
 * make the suite assert on styling, which is the thing that README exists to
 * prevent.
 *
 * ## `picker-option-{value}` is a *semantic* value, not the option's id
 *
 * The suite addresses a status option as `picker-option-started` and a member
 * as `picker-option-guest@demo.test`. Neither is a database id, and neither
 * could be: a spec that hard-codes `sta_9fK2…` is a spec that breaks when the
 * seed is regenerated. So each picker chooses the stable, human-meaningful
 * token for its domain — a state's *type*, a user's email, a label's name —
 * while the option's `value` stays the id the mutation actually needs.
 */

import { useMemo, type ReactNode, type RefObject } from "react";

import {
  PRIORITY_LABELS,
  type Label,
  type LabelId,
  type Priority,
  type Project,
  type ProjectId,
  type StateId,
  type User,
  type UserId,
  type WorkflowState,
} from "@/domain/entities";
import { compareWorkflowStates } from "@/domain/sorting";
import { Avatar } from "@/components/ui/avatar";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { Popover } from "@/components/ui/popover";
import { startedProgressByState } from "@/components/issues/grouping";

/** The panel width Linear uses for property menus. */
const PICKER_WIDTH = 244;

interface PickerShellProps {
  readonly testId: string;
  readonly label: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}

function PickerShell({
  testId,
  label,
  open,
  onOpenChange,
  anchor,
  children,
}: PickerShellProps) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      placement="bottom-start"
      aria-label={label}
      className="p-0"
      style={{ width: PICKER_WIDTH }}
    >
      <div data-testid={testId}>{children}</div>
    </Popover>
  );
}

/**
 * The glyph slot, carrying the option's test handle.
 *
 * The handle sits on the icon rather than on the row because the row is the
 * combobox's own element and is not ours to annotate. A click on this span
 * bubbles to the row's handler, so `getByTestId(...).click()` selects the
 * option exactly as a click on its label would.
 */
function OptionGlyph({ token, children }: { token: string; children: ReactNode }) {
  return (
    <span data-testid={`picker-option-${token}`} className="contents">
      {children}
    </span>
  );
}

/** Common props: every picker is opened by its owner and closes through it. */
interface PickerBase {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly anchor: RefObject<HTMLElement | null>;
}

/* ================================================================ status = */

export interface StatusPickerProps extends PickerBase {
  readonly states: readonly WorkflowState[];
  /** The applied state, or null when the selection holds several. */
  readonly value: StateId | null;
  readonly onSelect: (stateId: StateId, meta: { close: boolean }) => void;
}

export function StatusPicker({
  states,
  value,
  onSelect,
  ...shell
}: StatusPickerProps) {
  const options = useMemo<ComboboxOption[]>(() => {
    const ordered = [...states].sort(compareWorkflowStates);
    const progress = startedProgressByState(ordered);
    return ordered.map((state, index) => ({
      value: state.id,
      label: state.name,
      // "done" should find "Completed" and "wip" should find "In Progress":
      // the type is the word people reach for when the team renamed the state.
      keywords: state.type,
      icon: (
        <OptionGlyph token={state.type}>
          <StatusIcon
            type={state.type}
            color={state.color}
            progress={progress.get(state.id) ?? 0.5}
            decorative
          />
        </OptionGlyph>
      ),
      hint: index < 9 ? String(index + 1) : undefined,
    }));
  }, [states]);

  return (
    <PickerShell testId="status-picker" label="Change status" {...shell}>
      <Combobox
        options={options}
        value={value}
        label="Status"
        placeholder="Change status…"
        onSelect={(next, meta) => onSelect(next, meta)}
        onRequestClose={() => shell.onOpenChange(false)}
      />
    </PickerShell>
  );
}

/* ============================================================== priority = */

/**
 * Picker order, which is not sort order.
 *
 * A list ordered by priority puts *No priority* last (`sorting.ts`); the picker
 * puts it first, because clearing a priority is the row people reach for and
 * burying it under four others makes the common case the longest one. Both are
 * Linear's.
 */
const PRIORITY_PICKER_ORDER: readonly Priority[] = [0, 1, 2, 3, 4];

const PRIORITY_TOKEN: Readonly<Record<Priority, string>> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

export interface PriorityPickerProps extends PickerBase {
  readonly value: Priority | null;
  readonly onSelect: (priority: Priority, meta: { close: boolean }) => void;
}

export function PriorityPicker({
  value,
  onSelect,
  ...shell
}: PriorityPickerProps) {
  const options = useMemo<ComboboxOption[]>(
    () =>
      PRIORITY_PICKER_ORDER.map((priority) => ({
        value: String(priority),
        label: PRIORITY_LABELS[priority],
        icon: (
          <OptionGlyph token={PRIORITY_TOKEN[priority]}>
            <PriorityIcon priority={priority} decorative />
          </OptionGlyph>
        ),
        // Bare digits inside the open picker, per §1.10 — the global binding is
        // `Shift+1..4` only because bare digits are Triage actions.
        hint: String(priority),
      })),
    [],
  );

  return (
    <PickerShell testId="priority-picker" label="Change priority" {...shell}>
      <Combobox
        options={options}
        value={value === null ? null : String(value)}
        label="Priority"
        placeholder="Set priority…"
        onSelect={(next, meta) => onSelect(Number(next) as Priority, meta)}
        onRequestClose={() => shell.onOpenChange(false)}
      />
    </PickerShell>
  );
}

/* ============================================================== assignee = */

/** The sentinel for "Unassigned". Not an id, so it cannot collide with one. */
export const UNASSIGNED = "__unassigned__";

export interface AssigneePickerProps extends PickerBase {
  readonly users: readonly User[];
  readonly value: UserId | null;
  readonly onSelect: (
    assigneeId: UserId | null,
    meta: { close: boolean },
  ) => void;
}

export function AssigneePicker({
  users,
  value,
  onSelect,
  ...shell
}: AssigneePickerProps) {
  const options = useMemo<ComboboxOption[]>(
    () => [
      {
        value: UNASSIGNED,
        label: "Unassigned",
        icon: (
          <OptionGlyph token="unassigned">
            <span className="size-4 rounded-full border border-dashed border-strong" />
          </OptionGlyph>
        ),
      },
      ...users.map((user) => ({
        value: user.id,
        label: user.name,
        keywords: `${user.email} ${user.displayName}`,
        description: user.displayName,
        icon: (
          <OptionGlyph token={user.email}>
            <Avatar
              id={user.id}
              name={user.name}
              src={user.avatarUrl}
              color={user.avatarColor}
              size={16}
              decorative
            />
          </OptionGlyph>
        ),
      })),
    ],
    [users],
  );

  return (
    <PickerShell testId="assignee-picker" label="Change assignee" {...shell}>
      <Combobox
        options={options}
        value={value ?? UNASSIGNED}
        label="Assignee"
        placeholder="Assign to…"
        onSelect={(next, meta) =>
          onSelect(next === UNASSIGNED ? null : next, meta)
        }
        onRequestClose={() => shell.onOpenChange(false)}
      />
    </PickerShell>
  );
}

/* ================================================================ labels = */

export interface LabelPickerProps extends PickerBase {
  readonly labels: readonly Label[];
  /** The labels currently on the target. Multi-select: the picker stays open. */
  readonly values: readonly LabelId[];
  readonly onToggle: (labelId: LabelId, meta: { close: boolean }) => void;
}

export function LabelPicker({
  labels,
  values,
  onToggle,
  ...shell
}: LabelPickerProps) {
  const options = useMemo<ComboboxOption[]>(
    () =>
      labels.map((label) => ({
        value: label.id,
        label: label.name,
        icon: (
          <OptionGlyph token={label.name}>
            <span
              className="size-2 rounded-full"
              style={{ background: label.color }}
            />
          </OptionGlyph>
        ),
      })),
    [labels],
  );

  return (
    <PickerShell testId="label-picker" label="Change labels" {...shell}>
      <Combobox
        options={options}
        values={values}
        multiple
        label="Labels"
        placeholder="Add label…"
        emptyMessage="No labels"
        onSelect={(next, meta) => onToggle(next, meta)}
        onRequestClose={() => shell.onOpenChange(false)}
      />
    </PickerShell>
  );
}

/* =============================================================== project = */

export const NO_PROJECT = "__no_project__";

export interface ProjectPickerProps extends PickerBase {
  readonly projects: readonly Pick<Project, "id" | "name" | "icon" | "color">[];
  readonly value: ProjectId | null;
  readonly onSelect: (
    projectId: ProjectId | null,
    meta: { close: boolean },
  ) => void;
}

export function ProjectPicker({
  projects,
  value,
  onSelect,
  ...shell
}: ProjectPickerProps) {
  const options = useMemo<ComboboxOption[]>(
    () => [
      {
        value: NO_PROJECT,
        label: "No project",
        icon: (
          <OptionGlyph token="no-project">
            <span className="size-2 rounded-[2px] border border-strong" />
          </OptionGlyph>
        ),
      },
      ...projects.map((project) => ({
        value: project.id,
        label: project.name,
        icon: (
          <OptionGlyph token={project.name}>
            <span
              className="size-2 rounded-[2px]"
              style={{ background: project.color }}
            />
          </OptionGlyph>
        ),
      })),
    ],
    [projects],
  );

  return (
    <PickerShell testId="project-picker" label="Change project" {...shell}>
      <Combobox
        options={options}
        value={value ?? NO_PROJECT}
        label="Project"
        placeholder="Add to project…"
        onSelect={(next, meta) =>
          onSelect(next === NO_PROJECT ? null : next, meta)
        }
        onRequestClose={() => shell.onOpenChange(false)}
      />
    </PickerShell>
  );
}
