"use client";

/**
 * Milestones — dated checkpoints inside a project.
 *
 * Progress per milestone is counted from the issues pointing at it rather than
 * stored, for the same reason project progress is: a stored count is a number
 * that has to be kept true by every path that moves an issue, and the query is
 * a `count` over an indexed column.
 *
 * Deleting one does not delete its issues. `issues.milestone_id` is
 * `on delete set null`, so the issues stay in the project and lose only the
 * checkpoint — which is why this delete needs no confirmation and the workflow
 * state delete does.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { formatDate, type MilestoneView, type ProjectAbilities } from "./types";

export interface ProjectMilestonesProps {
  projectId: string;
  milestones: readonly MilestoneView[];
  abilities: ProjectAbilities;
}

export function ProjectMilestones({
  projectId,
  milestones,
  abilities,
}: ProjectMilestonesProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  async function send(body: Record<string, unknown>): Promise<void> {
    const result = await callApi(`/api/projects/${projectId}`, {
      method: "POST",
      body,
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRefusal(refusalMessage(result.failure));
  }

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") return;
    setAdding(false);
    setName("");
    setTargetDate("");
    await send({
      action: "createMilestone",
      name: trimmed,
      targetDate: targetDate === "" ? null : targetDate,
    });
  }

  return (
    <section data-testid="project-milestones" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-mini font-[var(--weight-medium)] text-tertiary">
          Milestones
        </h2>
        {abilities.canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdding((current) => !current);
            }}
          >
            Add milestone
          </Button>
        ) : null}
      </div>

      <ul className="flex flex-col">
        {milestones.length === 0 ? (
          <li className="py-2 text-mini text-tertiary">
            No milestones. Add one to break the project into dated checkpoints.
          </li>
        ) : (
          milestones.map((milestone) => {
            const done =
              milestone.total > 0 && milestone.completed === milestone.total;
            return (
              <li
                key={milestone.id}
                className="flex items-center gap-3 rounded-[var(--radius-md)] px-1 py-1.5 hover:bg-hover"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rotate-45 rounded-[1px]",
                    done ? "bg-accent" : "border border-strong",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-small text-primary">
                  {milestone.name}
                </span>
                <span className="text-mini text-tertiary">
                  {milestone.completed}/{milestone.total}
                </span>
                <span className="w-16 text-right text-mini text-tertiary">
                  {formatDate(milestone.targetDate)}
                </span>
                {abilities.canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete milestone ${milestone.name}`}
                    onClick={() => {
                      void send({
                        action: "deleteMilestone",
                        milestoneId: milestone.id,
                      });
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {adding ? (
        <form
          className="flex items-center gap-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            autoFocus
            aria-label="Milestone name"
            placeholder="Milestone name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            containerClassName="flex-1"
          />
          <Input
            type="date"
            aria-label="Milestone target date"
            value={targetDate}
            onChange={(event) => {
              setTargetDate(event.target.value);
            }}
          />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      ) : null}

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </section>
  );
}
