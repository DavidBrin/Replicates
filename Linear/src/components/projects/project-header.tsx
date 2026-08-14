"use client";

/**
 * The project header: name, description, status, health and lead.
 *
 * ## Editing in place, committed on blur
 *
 * The name is an `<input>` that looks like a heading, not a heading with an
 * edit button. Linear works this way and it is the reason a project's name
 * actually gets fixed: the cost of a rename is one click. Commit is on blur and
 * on Enter; Escape restores the stored value, which is the only way to abandon
 * a typo without knowing what it replaced.
 *
 * The name input is deliberately the **first** focusable text field in the
 * header. `e2e/permissions.spec.ts` reaches it as
 * `getByTestId("project-header").getByRole("textbox").first()`, which is a
 * reasonable way for a spec to say "the title" and a fragile one if a search
 * box ever lands above it.
 *
 * ## Status is a control; health is a readout
 *
 * `state` is where the work is and somebody sets it. `health` is the lead's
 * weekly judgement and is written **only** by posting an update — the
 * repository enforces that, `PATCH /api/projects/{id}` does not accept the
 * field, and this component shows it as text with a pointer to the Updates tab.
 * A dropdown here would let the project row and its latest update disagree
 * about the same fact (`research/03-data-model.md` §1.7).
 *
 * ## `data-pending`
 *
 * A commit-on-blur field is optimistic by construction: the new value is what
 * you are looking at long before the server has been asked. The header therefore
 * says whether it is still waiting, the same way the membership surfaces do —
 * without it, "renamed" and "renamed, and the browser cancelled the `PATCH` on
 * its way out of the page" are the same screen, and a reload immediately after a
 * blur is a coin toss rather than a check.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Avatar } from "@/components/ui/avatar";
import { PROJECT_STATES, type ProjectState } from "@/domain/entities";
import { cn } from "@/lib/cn";

import { ProjectIcon } from "./project-icon";
import {
  PROJECT_HEALTH_COLORS,
  PROJECT_HEALTH_LABELS,
  PROJECT_STATE_LABELS,
  formatDate,
  type ProjectAbilities,
  type ProjectDetailView,
} from "./types";

export interface ProjectHeaderProps {
  project: ProjectDetailView;
  abilities: ProjectAbilities;
}

export function ProjectHeader({ project, abilities }: ProjectHeaderProps) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [state, setState] = useState<ProjectState>(project.state);
  /** Edits sent and not yet answered. A count, because fields commit in parallel. */
  const [pending, setPending] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);

  /**
   * What the server is known to hold, for Escape-to-restore and for deciding
   * whether a blur is a change at all.
   *
   * There is no effect resyncing this from props. The page gives this component
   * a `key` derived from the fields below, so a server refresh that changed any
   * of them remounts it with fresh initial state — which is React's own answer
   * to "reset state when a prop changes" and avoids the cascading render an
   * effect-driven `setState` produces.
   */
  const stored = useRef({ name: project.name, description: project.description });

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setPending((current) => current + 1);
    const result = await callApi(`/api/projects/${project.id}`, {
      method: "PATCH",
      body,
    });
    setPending((current) => current - 1);
    if (result.ok) {
      router.refresh();
      return true;
    }
    setRefusal(refusalMessage(result.failure));
    return false;
  }

  async function commitName(): Promise<void> {
    const next = name.trim();
    if (next === "" || next === stored.current.name) {
      setName(stored.current.name);
      return;
    }
    stored.current = { ...stored.current, name: next };
    if (!(await patch({ name: next }))) {
      setName(project.name);
      stored.current = { ...stored.current, name: project.name };
    }
  }

  async function commitDescription(): Promise<void> {
    if (description === stored.current.description) return;
    const next = description;
    stored.current = { ...stored.current, description: next };
    if (!(await patch({ description: next }))) {
      setDescription(project.description);
      stored.current = { ...stored.current, description: project.description };
    }
  }

  return (
    <header
      data-testid="project-header"
      data-pending={pending > 0 ? "true" : "false"}
      className="flex flex-col gap-3 border-b border-subtle pb-4"
    >
      <div className="flex items-start gap-3">
        <ProjectIcon
          icon={project.icon}
          color={project.color}
          name={project.name}
          size={28}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          {abilities.canEdit ? (
            <input
              aria-label="Project name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              onBlur={() => {
                void commitName();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setName(stored.current.name);
                  event.currentTarget.blur();
                }
              }}
              className={cn(
                "-mx-1.5 w-full rounded-[var(--radius-md)] bg-transparent px-1.5 py-0.5",
                "text-large font-[var(--weight-title)] text-primary",
                "hover:bg-hover focus:bg-hover focus:outline-none",
              )}
            />
          ) : (
            <h1 className="text-large font-[var(--weight-title)] text-primary">
              {project.name}
            </h1>
          )}

          {abilities.canEdit ? (
            <textarea
              aria-label="Project description"
              rows={2}
              value={description}
              placeholder="Add a description…"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              onBlur={() => {
                void commitDescription();
              }}
              className={cn(
                "-mx-1.5 mt-1 w-full resize-none rounded-[var(--radius-md)] bg-transparent",
                "px-1.5 py-0.5 text-small leading-5 text-secondary",
                "placeholder:text-quaternary hover:bg-hover focus:bg-hover focus:outline-none",
              )}
            />
          ) : project.description === "" ? null : (
            <p className="mt-1 text-small leading-5 text-secondary">
              {project.description}
            </p>
          )}
        </div>
      </div>

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-mini">
        <div className="flex items-center gap-1.5">
          <dt className="text-tertiary">Status</dt>
          <dd>
            {abilities.canEdit ? (
              <select
                aria-label="Project status"
                value={state}
                onChange={(event) => {
                  const next = event.target.value as ProjectState;
                  const previous = state;
                  setState(next);
                  void patch({ state: next }).then((ok) => {
                    if (!ok) setState(previous);
                  });
                }}
                className="h-6 rounded-[var(--radius-md)] border border-default bg-elevated px-1.5 text-mini text-primary focus:border-[var(--border-focus)] focus:outline-none"
              >
                {PROJECT_STATES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {PROJECT_STATE_LABELS[candidate]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-primary">{PROJECT_STATE_LABELS[state]}</span>
            )}
          </dd>
        </div>

        <div className="flex items-center gap-1.5">
          <dt className="text-tertiary">Health</dt>
          <dd
            className="flex items-center gap-1.5 text-primary"
            title="Health changes by posting an update"
          >
            {project.health === null ? (
              <span className="text-quaternary">No update yet</span>
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ background: PROJECT_HEALTH_COLORS[project.health] }}
                />
                {PROJECT_HEALTH_LABELS[project.health]}
              </>
            )}
          </dd>
        </div>

        <div className="flex items-center gap-1.5">
          <dt className="text-tertiary">Lead</dt>
          <dd className="flex items-center gap-1.5 text-primary">
            {project.lead === null ? (
              <span className="text-quaternary">Unassigned</span>
            ) : (
              <>
                <Avatar
                  id={project.lead.id}
                  name={project.lead.name}
                  src={project.lead.avatarUrl}
                  color={project.lead.avatarColor}
                  size={16}
                  decorative
                />
                {project.lead.name}
              </>
            )}
          </dd>
        </div>

        <div className="flex items-center gap-1.5">
          <dt className="text-tertiary">Target</dt>
          <dd className="text-primary">{formatDate(project.targetDate)}</dd>
        </div>
      </dl>

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </header>
  );
}
