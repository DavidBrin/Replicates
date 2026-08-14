"use client";

import { useRef, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/cn";
import {
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  type Priority,
} from "@/domain/entities";
import { Avatar } from "@/components/ui/avatar";
import { LabelChip } from "@/components/ui/badge";
import { CalendarIcon, LabelIcon, ProjectsIcon } from "@/components/ui/icons";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon, startedStateProgress } from "@/components/ui/icons/status-icon";
import { Popover } from "@/components/ui/popover";
import { ProgressDonut } from "@/components/ui/progress-donut";

import { PropertyPicker, type PropertyPickerOption } from "./property-picker";
import type {
  DetailIssueRef,
  DetailLabel,
  DetailProject,
  DetailState,
  DetailUser,
} from "./types";

/**
 * The 260px properties rail.
 *
 * Every row here is the same interaction: a chip that opens a picker, and a
 * picker that **applies on selection**. There is no Save button in this file,
 * no local draft, and no dirty state — `research/04-interaction.md` §3 opens
 * with that rule, and it is the reason `Escape` is safe on a picker (it closes
 * the panel; it does not undo what already landed).
 *
 * ## Which picker is open is not state that lives here
 *
 * The parent owns it. `S`, `A`, `P` and `L` open a picker from anywhere in the
 * pane, so the open flag has to be reachable by the shortcut dispatcher; if it
 * lived in this component the keyboard would need a ref and an imperative
 * handle to reach it, which is a second source of truth for the same fact.
 */

export type PickerKind =
  | "status"
  | "priority"
  | "assignee"
  | "label"
  | "project"
  | "dueDate";

export interface PropertiesRailProps {
  states: readonly DetailState[];
  labels: readonly DetailLabel[];
  projects: readonly DetailProject[];
  members: readonly DetailUser[];
  subIssues: readonly DetailIssueRef[];

  stateId: string;
  priority: Priority;
  assigneeId: string | null;
  labelIds: readonly string[];
  projectId: string | null;
  dueDate: string | null;

  openPicker: PickerKind | null;
  onOpenPicker: (kind: PickerKind | null) => void;

  onStateChange: (stateId: string) => void;
  onPriorityChange: (priority: Priority) => void;
  onAssigneeChange: (assigneeId: string | null) => void;
  onLabelToggle: (labelId: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onDueDateChange: (dueDate: string | null) => void;

  readOnly?: boolean;
}

/** The sentinel a picker uses for "no value", since option values are strings. */
const NONE = "__none__";

export function PropertiesRail(props: PropertiesRailProps) {
  const {
    states,
    labels,
    projects,
    members,
    subIssues,
    stateId,
    priority,
    assigneeId,
    labelIds,
    projectId,
    dueDate,
    openPicker,
    onOpenPicker,
    onStateChange,
    onPriorityChange,
    onAssigneeChange,
    onLabelToggle,
    onProjectChange,
    onDueDateChange,
    readOnly = false,
  } = props;

  const statusRef = useRef<HTMLButtonElement | null>(null);
  const priorityRef = useRef<HTMLButtonElement | null>(null);
  const assigneeRef = useRef<HTMLButtonElement | null>(null);
  const labelRef = useRef<HTMLButtonElement | null>(null);
  const projectRef = useRef<HTMLButtonElement | null>(null);
  const dueDateRef = useRef<HTMLButtonElement | null>(null);

  const state = states.find((candidate) => candidate.id === stateId) ?? null;
  const assignee = members.find((member) => member.id === assigneeId) ?? null;
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const applied = labels.filter((label) => labelIds.includes(label.id));
  const completedSubIssues = subIssues.filter(
    (issue) => issue.stateType === "completed",
  ).length;

  const toggle = (kind: PickerKind): void => {
    if (readOnly) return;
    onOpenPicker(openPicker === kind ? null : kind);
  };

  const statusOptions: PropertyPickerOption[] = states.map((candidate) => ({
    value: candidate.id,
    // The state *type*, so a test can ask for `picker-option-started` without
    // knowing a generated id that changes on every rebuild.
    token: candidate.type,
    label: candidate.name,
    keywords: candidate.type,
    glyph: (
      <StatusIcon
        type={candidate.type}
        color={candidate.color}
        progress={startedStateProgress(candidate.groupIndex, candidate.groupCount)}
        size={14}
        decorative
      />
    ),
  }));

  const priorityOptions: PropertyPickerOption[] = PRIORITY_VALUES.map((value) => ({
    value: String(value),
    label: PRIORITY_LABELS[value],
    glyph: <PriorityIcon priority={value} size={14} decorative />,
  }));

  const assigneeOptions: PropertyPickerOption[] = [
    {
      value: NONE,
      label: "No assignee",
      keywords: "unassigned nobody",
      glyph: <PriorityIcon priority={0} size={14} decorative muted />,
    },
    ...members.map((member) => ({
      value: member.id,
      // The `@mention` handle: unique per workspace and stable across
      // rebuilds, unlike the generated id.
      token: member.displayName,
      label: member.name,
      description: `@${member.displayName}`,
      keywords: member.displayName,
      glyph: (
        <Avatar
          id={member.id}
          name={member.name}
          src={member.avatarUrl}
          color={member.avatarColor}
          size={16}
          decorative
        />
      ),
    })),
  ];

  const labelOptions: PropertyPickerOption[] = labels.map((label) => ({
    value: label.id,
    label: label.name,
    glyph: <LabelChip name={label.name} color={label.color} dotOnly />,
  }));

  const projectOptions: PropertyPickerOption[] = [
    {
      value: NONE,
      label: "No project",
      glyph: <ProjectsIcon size={14} />,
    },
    ...projects.map((candidate) => ({
      value: candidate.id,
      label: candidate.name,
      glyph: <ProjectsIcon size={14} style={{ color: candidate.color }} />,
    })),
  ];

  return (
    <aside
      data-testid="issue-properties"
      aria-label="Issue properties"
      className="shrink-0 py-6 pr-6 [width:var(--properties-width)]"
    >
      <Section title="Properties">
        <PropertyRow
          testId="issue-property-status"
          anchorRef={statusRef}
          onClick={() => toggle("status")}
          disabled={readOnly}
          label={state?.name ?? "No status"}
          icon={
            state ? (
              <StatusIcon
                type={state.type}
                color={state.color}
                progress={startedStateProgress(state.groupIndex, state.groupCount)}
                size={16}
                decorative
              />
            ) : (
              <StatusIcon type="backlog" size={16} decorative />
            )
          }
        />
        <PropertyPicker
          testId="status-picker"
          label="Status"
          open={openPicker === "status"}
          onOpenChange={(open) => onOpenPicker(open ? "status" : null)}
          anchor={statusRef}
          options={statusOptions}
          value={stateId}
          onSelect={(value) => onStateChange(value)}
        />

        <PropertyRow
          testId="issue-property-priority"
          anchorRef={priorityRef}
          onClick={() => toggle("priority")}
          disabled={readOnly}
          label={PRIORITY_LABELS[priority]}
          icon={<PriorityIcon priority={priority} size={16} decorative />}
        />
        <PropertyPicker
          testId="priority-picker"
          label="Priority"
          open={openPicker === "priority"}
          onOpenChange={(open) => onOpenPicker(open ? "priority" : null)}
          anchor={priorityRef}
          options={priorityOptions}
          value={String(priority)}
          onSelect={(value) => onPriorityChange(Number(value) as Priority)}
        />

        <PropertyRow
          testId="issue-property-assignee"
          anchorRef={assigneeRef}
          onClick={() => toggle("assignee")}
          disabled={readOnly}
          label={assignee?.name ?? "Unassigned"}
          icon={
            assignee ? (
              <Avatar
                id={assignee.id}
                name={assignee.name}
                src={assignee.avatarUrl}
                color={assignee.avatarColor}
                size={16}
                decorative
              />
            ) : (
              <span className="inline-block size-4 rounded-full border border-dashed border-strong" />
            )
          }
        />
        <PropertyPicker
          testId="assignee-picker"
          label="Assignee"
          open={openPicker === "assignee"}
          onOpenChange={(open) => onOpenPicker(open ? "assignee" : null)}
          anchor={assigneeRef}
          options={assigneeOptions}
          value={assigneeId ?? NONE}
          onSelect={(value) => onAssigneeChange(value === NONE ? null : value)}
        />

        <PropertyRow
          testId="issue-property-due-date"
          anchorRef={dueDateRef}
          onClick={() => toggle("dueDate")}
          disabled={readOnly}
          label={dueDate ?? "No due date"}
          icon={<CalendarIcon size={16} />}
        />
        <Popover
          open={openPicker === "dueDate"}
          onOpenChange={(open) => onOpenPicker(open ? "dueDate" : null)}
          anchor={dueDateRef}
          aria-label="Due date"
        >
          <div data-testid="due-date-picker" className="flex flex-col gap-2 p-2">
            <input
              type="date"
              aria-label="Due date"
              data-testid="due-date-input"
              defaultValue={dueDate ?? ""}
              onChange={(event) =>
                onDueDateChange(event.target.value === "" ? null : event.target.value)
              }
              className="rounded-[var(--radius-md)] border border-default bg-transparent px-2 py-1 text-small"
            />
            <button
              type="button"
              data-testid="due-date-clear"
              onClick={() => {
                onDueDateChange(null);
                onOpenPicker(null);
              }}
              className="text-left text-small text-tertiary hover:text-primary"
            >
              Clear
            </button>
          </div>
        </Popover>

        {subIssues.length > 0 ? (
          <div
            data-testid="issue-property-sub-issues"
            className="flex h-7 items-center gap-2 px-1.5 text-small text-tertiary"
          >
            <ProgressDonut
              completed={completedSubIssues}
              total={subIssues.length}
              size={16}
            />
            <span>
              {completedSubIssues}/{subIssues.length} sub-issues
            </span>
          </div>
        ) : null}
      </Section>

      <Section title="Labels">
        <PropertyRow
          testId="issue-property-labels"
          anchorRef={labelRef}
          onClick={() => toggle("label")}
          disabled={readOnly}
          label={applied.length === 0 ? "Add label" : ""}
          icon={<LabelIcon size={16} />}
        >
          {applied.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {applied.map((label) => (
                <LabelChip key={label.id} name={label.name} color={label.color} />
              ))}
            </span>
          ) : null}
        </PropertyRow>
        <PropertyPicker
          testId="label-picker"
          label="Labels"
          multiple
          open={openPicker === "label"}
          onOpenChange={(open) => onOpenPicker(open ? "label" : null)}
          anchor={labelRef}
          options={labelOptions}
          values={labelIds}
          onSelect={(value) => onLabelToggle(value)}
        />
      </Section>

      <Section title="Project">
        <PropertyRow
          testId="issue-property-project"
          anchorRef={projectRef}
          onClick={() => toggle("project")}
          disabled={readOnly}
          label={project?.name ?? "Add to project"}
          icon={
            <ProjectsIcon size={16} style={project ? { color: project.color } : undefined} />
          }
        />
        <PropertyPicker
          testId="project-picker"
          label="Project"
          open={openPicker === "project"}
          onOpenChange={(open) => onOpenPicker(open ? "project" : null)}
          anchor={projectRef}
          options={projectOptions}
          value={projectId ?? NONE}
          onSelect={(value) => onProjectChange(value === NONE ? null : value)}
        />
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 px-1.5 text-mini text-tertiary">{title}</h2>
      {children}
    </section>
  );
}

function PropertyRow({
  testId,
  anchorRef,
  onClick,
  disabled,
  label,
  icon,
  children,
}: {
  testId: string;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  disabled: boolean;
  label: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <button
      ref={anchorRef}
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-7 w-full items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1",
        "text-left text-small text-primary",
        "hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">
        {icon}
      </span>
      {children ?? <span className="truncate">{label}</span>}
    </button>
  );
}
