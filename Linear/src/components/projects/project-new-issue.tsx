"use client";

/**
 * Filing an issue straight into the project.
 *
 * ## It reuses the shell's modal rather than growing a second one
 *
 * `components/issues/new-issue-modal.tsx` is a controlled, presentational
 * component: it owns the form and the property pickers and knows nothing about
 * where the issue goes. So this file supplies the trigger, the defaults
 * (`projectId` — the whole point) and the request, and the person filing gets
 * the same controls and the same keys they would get anywhere else. A bespoke
 * "add issue to project" form would be a second interaction model for the same
 * noun.
 *
 * ## The `new-issue-button` id is not duplicated
 *
 * `ViewToolbar` carries that id on the team and My Issues screens; those
 * screens render `issue-view`, and this page does not. Exactly one element with
 * the id is on any given page, which is what keeps Playwright's strict mode
 * from turning a shared id into a failure of every spec that touches it.
 *
 * ## Which team the issue lands in
 *
 * The first team attached to the project. An issue belongs to exactly one team
 * — that is where its number comes from — and a project spanning two teams has
 * no better answer available without asking, which is a picker the modal does
 * not have. A project with no teams renders no button, because there is no team
 * to number the issue in.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { PlusIcon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
import {
  NewIssueModal,
  type NewIssueDraft,
} from "@/components/issues/new-issue-modal";
import type {
  Label,
  Project,
  Team,
  User,
  WorkflowState,
} from "@/domain/entities";
import { newId } from "@/lib/ids";

export interface ProjectNewIssueProps {
  project: Pick<Project, "id" | "name" | "icon" | "color">;
  team: Pick<Team, "id" | "key" | "name">;
  states: readonly WorkflowState[];
  users: readonly User[];
  labels: readonly Label[];
}

export function ProjectNewIssue({
  project,
  team,
  states,
  users,
  labels,
}: ProjectNewIssueProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function create(draft: NewIssueDraft): Promise<void> {
    // The id is minted here, before the request leaves, so a retry after a
    // timeout names a row that already exists rather than creating a second one
    // — the create endpoint is idempotent on exactly this.
    const result = await callApi("/api/issues", {
      method: "POST",
      body: {
        id: newId("iss"),
        teamId: team.id,
        title: draft.title,
        description: draft.description,
        stateId: draft.stateId,
        priority: draft.priority,
        assigneeId: draft.assigneeId,
        projectId: project.id,
        labelIds: draft.labelIds,
      },
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRefusal(refusalMessage(result.failure));
  }

  return (
    <>
      <Tooltip content="New issue" shortcut="c">
        <button
          type="button"
          data-testid="new-issue-button"
          aria-label="New issue"
          onClick={() => {
            setOpen(true);
          }}
          className="flex size-7 items-center justify-center rounded-[var(--radius-md)] border border-default text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
        >
          <PlusIcon size={14} />
        </button>
      </Tooltip>

      <NewIssueModal
        open={open}
        onOpenChange={setOpen}
        team={team}
        states={states}
        users={users}
        labels={labels}
        projects={[project]}
        defaults={{ projectId: project.id }}
        onCreate={(draft) => {
          void create(draft);
        }}
      />

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </>
  );
}
