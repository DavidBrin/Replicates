"use client";

/**
 * The create-issue modal — `C`.
 *
 * ## Why it renders the pickers rather than a form of selects
 *
 * The properties on a new issue are set with the *same* controls, and the same
 * keys, as the properties on an existing one. `research/04-interaction.md` §1.6
 * puts it as the heart of the model: "the same key does the same thing whether
 * one issue is focused in a list, many are selected, or you are inside issue
 * detail". A create form with its own bespoke dropdowns is a second interaction
 * model for the same nouns, and it is where a clone starts feeling assembled
 * rather than designed.
 *
 * ## Defaults are inherited from where you pressed the key
 *
 * `+` on the *In Progress* group header opens this with the status already set;
 * `C` on a team board inherits that team's default state. The modal never
 * invents a status — it is handed one.
 *
 * ## Submission is optimistic, and the id is minted here
 *
 * The issue id is generated on the client before the request leaves, so the
 * row can render immediately and be reconciled by id rather than by position
 * (`entities.ts`, and §6.5 rule 2: a server-minted id changes the React key on
 * arrival and remounts the row, which is visible as a flash).
 */

import { useRef, useState } from "react";

import {
  type Label,
  type LabelId,
  type Priority,
  type Project,
  type ProjectId,
  type StateId,
  type Team,
  type User,
  type UserId,
  type WorkflowState,
} from "@/domain/entities";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { Input } from "@/components/ui/input";
import { Shortcut } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  ProjectPicker,
  StatusPicker,
} from "@/components/issues/property-pickers";

export interface NewIssueDraft {
  readonly title: string;
  readonly description: string;
  readonly stateId: StateId;
  readonly priority: Priority;
  readonly assigneeId: UserId | null;
  readonly projectId: ProjectId | null;
  readonly labelIds: readonly LabelId[];
}

export interface NewIssueDefaults {
  readonly stateId?: StateId;
  readonly priority?: Priority;
  readonly assigneeId?: UserId | null;
  readonly projectId?: ProjectId | null;
  readonly labelIds?: readonly LabelId[];
}

export interface NewIssueModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly team: Pick<Team, "id" | "key" | "name">;
  readonly states: readonly WorkflowState[];
  readonly users: readonly User[];
  readonly labels: readonly Label[];
  readonly projects: readonly Pick<Project, "id" | "name" | "icon" | "color">[];
  readonly defaults: NewIssueDefaults;
  readonly onCreate: (draft: NewIssueDraft) => void;
}

type OpenPicker = "status" | "priority" | "assignee" | "label" | "project" | null;

export function NewIssueModal({
  open,
  onOpenChange,
  team,
  states,
  users,
  labels,
  projects,
  defaults,
  onCreate,
}: NewIssueModalProps) {
  // Initialised from the defaults, never reset by an effect. The owner gives
  // this component a fresh `key` each time it opens, so React discards the
  // previous form's state for us — the documented way to reset state on a prop
  // change, and one less cascading render than clearing seven fields in an
  // effect body.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stateId, setStateId] = useState<StateId | null>(
    defaults.stateId ?? states[0]?.id ?? null,
  );
  const [priority, setPriority] = useState<Priority>(defaults.priority ?? 0);
  const [assigneeId, setAssigneeId] = useState<UserId | null>(
    defaults.assigneeId ?? null,
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(
    defaults.projectId ?? null,
  );
  const [labelIds, setLabelIds] = useState<readonly LabelId[]>(
    defaults.labelIds ?? [],
  );
  const [picker, setPicker] = useState<OpenPicker>(null);

  const statusRef = useRef<HTMLButtonElement | null>(null);
  const priorityRef = useRef<HTMLButtonElement | null>(null);
  const assigneeRef = useRef<HTMLButtonElement | null>(null);
  const labelRef = useRef<HTMLButtonElement | null>(null);
  const projectRef = useRef<HTMLButtonElement | null>(null);

  if (!open) return null;

  const resolvedState = states.find((state) => state.id === stateId) ?? states[0];
  const assignee = users.find((user) => user.id === assigneeId) ?? null;
  const project = projects.find((entry) => entry.id === projectId) ?? null;
  const chosenLabels = labels.filter((label) => labelIds.includes(label.id));

  const submit = (): void => {
    const trimmed = title.trim();
    if (trimmed === "" || !resolvedState) return;
    onCreate({
      title: trimmed,
      description,
      stateId: resolvedState.id,
      priority,
      assigneeId,
      projectId,
      labelIds,
    });
    onOpenChange(false);
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/40 pt-[12vh]"
      style={{ zIndex: "var(--z-modal)" }}
      onClick={() => onOpenChange(false)}
    >
      <div
        data-testid="new-issue-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`New issue in ${team.name}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && picker === null) {
            event.stopPropagation();
            onOpenChange(false);
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        className={cn(
          "flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-3",
          "rounded-[var(--radius-xl)] border border-default bg-[var(--bg-overlay)] p-4",
          "shadow-[var(--shadow-high)]",
        )}
      >
        <div className="flex items-center gap-2 text-mini text-tertiary">
          <span className="rounded-[var(--radius-sm)] bg-[var(--bg-translucent)] px-1.5 py-0.5">
            {team.key}
          </span>
          <span>New issue</span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="text-tertiary hover:text-primary"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <Input
          data-testid="new-issue-title"
          variant="bare"
          autoFocus
          value={title}
          placeholder="Issue title"
          aria-label="Issue title"
          onChange={(event) => setTitle(event.target.value)}
          containerClassName="h-9 px-0"
          className="text-title3 text-primary [font-weight:var(--weight-title)]"
        />

        <Textarea
          value={description}
          placeholder="Add description…"
          aria-label="Issue description"
          rows={3}
          variant="control"
          onChange={(event) => setDescription(event.target.value)}
          className="border-none px-0"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <PropertyChip
            ref={statusRef}
            onClick={() => setPicker("status")}
            icon={
              resolvedState ? (
                <StatusIcon
                  type={resolvedState.type}
                  color={resolvedState.color}
                  decorative
                />
              ) : null
            }
          >
            {resolvedState?.name ?? "Status"}
          </PropertyChip>

          <PropertyChip
            ref={priorityRef}
            onClick={() => setPicker("priority")}
            icon={<PriorityIcon priority={priority} size={14} decorative />}
          >
            {priority === 0 ? "Priority" : `P${priority}`}
          </PropertyChip>

          <PropertyChip
            ref={assigneeRef}
            onClick={() => setPicker("assignee")}
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
                <span className="size-3.5 rounded-full border border-dashed border-strong" />
              )
            }
          >
            {assignee?.name ?? "Assignee"}
          </PropertyChip>

          <PropertyChip ref={labelRef} onClick={() => setPicker("label")}>
            {chosenLabels.length === 0
              ? "Labels"
              : chosenLabels.map((label) => label.name).join(", ")}
          </PropertyChip>

          <PropertyChip ref={projectRef} onClick={() => setPicker("project")}>
            {project?.name ?? "Project"}
          </PropertyChip>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-subtle pt-3">
          <Shortcut keys="mod+Enter" className="mr-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="new-issue-submit"
            variant="primary"
            size="md"
            disabled={title.trim() === ""}
            onClick={submit}
          >
            Create issue
          </Button>
        </div>

        <StatusPicker
          open={picker === "status"}
          onOpenChange={(next) => setPicker(next ? "status" : null)}
          anchor={statusRef}
          states={states}
          value={stateId}
          onSelect={(next) => {
            setStateId(next);
            setPicker(null);
          }}
        />
        <PriorityPicker
          open={picker === "priority"}
          onOpenChange={(next) => setPicker(next ? "priority" : null)}
          anchor={priorityRef}
          value={priority}
          onSelect={(next) => {
            setPriority(next);
            setPicker(null);
          }}
        />
        <AssigneePicker
          open={picker === "assignee"}
          onOpenChange={(next) => setPicker(next ? "assignee" : null)}
          anchor={assigneeRef}
          users={users}
          value={assigneeId}
          onSelect={(next) => {
            setAssigneeId(next);
            setPicker(null);
          }}
        />
        <LabelPicker
          open={picker === "label"}
          onOpenChange={(next) => setPicker(next ? "label" : null)}
          anchor={labelRef}
          labels={labels}
          values={labelIds}
          onToggle={(next) =>
            setLabelIds((current) =>
              current.includes(next)
                ? current.filter((id) => id !== next)
                : [...current, next],
            )
          }
        />
        <ProjectPicker
          open={picker === "project"}
          onOpenChange={(next) => setPicker(next ? "project" : null)}
          anchor={projectRef}
          projects={projects}
          value={projectId}
          onSelect={(next) => {
            setProjectId(next);
            setPicker(null);
          }}
        />
      </div>
    </div>
  );
}

interface PropertyChipProps {
  readonly ref: React.RefObject<HTMLButtonElement | null>;
  readonly onClick: () => void;
  readonly icon?: React.ReactNode;
  readonly children: React.ReactNode;
}

function PropertyChip({ ref, onClick, icon, children }: PropertyChipProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-lg)] border border-default",
        "px-2 text-small text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
        "[transition:background-color_var(--speed-quick)_var(--ease-quad)]",
      )}
    >
      {icon}
      <span className="max-w-[160px] truncate">{children}</span>
    </button>
  );
}
