"use client";

/**
 * The Updates tab: the only thing in the application that writes project
 * health.
 *
 * That is not a UI convention, it is the data model. `projects.health` is
 * written by `postUpdate` and by nothing else, so the project row and the
 * latest update can never disagree about the same fact
 * (`adapters/repositories/projects.ts`). The health selector therefore lives in
 * the composer here rather than in the header, where it would look like a
 * property of the project and behave like one.
 *
 * An "at risk" project whose issues all close stays at risk until somebody says
 * otherwise — because the risk was never about the issue count.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_HEALTHS, type ProjectHealth } from "@/domain/entities";
import { cn } from "@/lib/cn";

import {
  PROJECT_HEALTH_COLORS,
  PROJECT_HEALTH_LABELS,
  type ProjectAbilities,
  type UpdateView,
} from "./types";

export interface ProjectUpdatesProps {
  projectId: string;
  updates: readonly UpdateView[];
  abilities: ProjectAbilities;
}

export function ProjectUpdates({
  projectId,
  updates,
  abilities,
}: ProjectUpdatesProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [health, setHealth] = useState<ProjectHealth>("onTrack");
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function post(): Promise<void> {
    const trimmed = body.trim();
    if (trimmed === "") return;
    setPending(true);
    const result = await callApi(`/api/projects/${projectId}`, {
      method: "POST",
      body: { action: "postUpdate", body: trimmed, health },
    });
    setPending(false);
    if (result.ok) {
      setBody("");
      router.refresh();
      return;
    }
    setRefusal(refusalMessage(result.failure));
  }

  return (
    <section data-testid="project-updates" className="flex flex-col gap-4">
      {abilities.canEdit ? (
        <form
          className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-default bg-panel p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <Textarea
            aria-label="Project update"
            placeholder="What changed this week?"
            rows={3}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-mini text-tertiary">Health</span>
              <select
                aria-label="Project health"
                value={health}
                onChange={(event) => {
                  setHealth(event.target.value as ProjectHealth);
                }}
                className="h-7 rounded-[var(--radius-md)] border border-default bg-elevated px-2 text-mini text-primary focus:border-[var(--border-focus)] focus:outline-none"
              >
                {PROJECT_HEALTHS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {PROJECT_HEALTH_LABELS[candidate]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Posting…" : "Post update"}
            </Button>
          </div>
          <p className="text-micro text-quaternary">
            Posting an update is the only thing that sets the project&rsquo;s
            health. It is a judgement, never derived from the issue list.
          </p>
        </form>
      ) : null}

      <ol className="flex flex-col gap-3">
        {updates.length === 0 ? (
          <li className="text-mini text-tertiary">No updates yet.</li>
        ) : (
          updates.map((update) => (
            <li
              key={update.id}
              className="rounded-[var(--radius-lg)] border border-subtle bg-panel p-3"
            >
              <div className="flex items-center gap-2">
                {update.author === null ? null : (
                  <Avatar
                    id={update.author.id}
                    name={update.author.name}
                    src={update.author.avatarUrl}
                    color={update.author.avatarColor}
                    size={20}
                    decorative
                  />
                )}
                <span className="text-small text-primary">
                  {update.author?.name ?? "Someone"}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-[var(--radius-full)]",
                    "border border-default px-1.5 py-0.5 text-micro text-secondary",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ background: PROJECT_HEALTH_COLORS[update.health] }}
                  />
                  {PROJECT_HEALTH_LABELS[update.health]}
                </span>
                <time
                  dateTime={update.createdAt}
                  className="ml-auto text-micro text-quaternary"
                >
                  {new Date(update.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-small leading-5 text-secondary">
                {update.body}
              </p>
            </li>
          ))
        )}
      </ol>

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </section>
  );
}
