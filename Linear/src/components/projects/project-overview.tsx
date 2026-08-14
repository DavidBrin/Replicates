"use client";

/**
 * The project overview: progress, dates, teams — and the one AI affordance.
 *
 * ## Progress is a rollup, not a stored column
 *
 * Every number here comes from a `count` over `issues.project_id`. Linear
 * pre-materialises burn-up series because their sync engine ships whole models
 * to clients; here the query is cheaper than any column that has to be kept
 * true by every path that moves an issue (`research/03-data-model.md` §6).
 *
 * ## Summarise renders "disabled", never "error"
 *
 * `getConnector()` returns a `DisabledConnector` when no key is configured, and
 * it answers with `reason: "unconfigured"` rather than throwing. So the button
 * stays visible and its result panel explains which environment variable turns
 * it on. A fresh clone of this repository has no API key by definition; a
 * feature that renders as broken in the default configuration is a feature that
 * makes the whole app look broken.
 */

import { useState } from "react";

import { callApi } from "@/components/members/mutations";
import { Button } from "@/components/ui/button";
import { ProgressDonut } from "@/components/ui/progress-donut";
import { cn } from "@/lib/cn";

import {
  completionRatio,
  formatDate,
  type ProjectDetailView,
} from "./types";

interface AiSuccess {
  readonly ok: true;
  readonly text: string;
  readonly provider: string;
  readonly model: string;
}

interface AiFailureBody {
  readonly ok: false;
  readonly reason: string;
  readonly message: string;
}

type AiBody = AiSuccess | AiFailureBody;

export interface ProjectOverviewProps {
  workspaceId: string;
  project: ProjectDetailView;
  /** Titles of the project's open issues — the material for a summary. */
  issueTitles: readonly string[];
}

export function ProjectOverview({
  workspaceId,
  project,
  issueTitles,
}: ProjectOverviewProps) {
  const [summary, setSummary] = useState<AiBody | null>(null);
  const [pending, setPending] = useState(false);

  const { progress } = project;
  const percent = Math.round(completionRatio(progress) * 100);

  async function summarise(): Promise<void> {
    setPending(true);
    setSummary(null);
    const input = [
      `Project: ${project.name}`,
      project.description === "" ? null : project.description,
      issueTitles.length === 0
        ? null
        : `Open issues:\n${issueTitles.map((title) => `- ${title}`).join("\n")}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n\n");

    const result = await callApi<AiBody>("/api/ai", {
      method: "POST",
      body: { workspaceId, task: "summarize", input },
    });
    setPending(false);

    if (result.ok) {
      setSummary(result.value);
      return;
    }
    setSummary({
      ok: false,
      reason: result.failure.code,
      message: result.failure.message,
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <ProgressDonut
            completed={progress.completed + progress.canceled}
            total={progress.total}
            size={28}
            label={`${percent}% complete`}
          />
          <div>
            <div className="text-small text-primary">{percent}% complete</div>
            <div className="text-mini text-tertiary">
              {progress.completed} done · {progress.started} in progress ·{" "}
              {progress.total} total
            </div>
          </div>
        </div>

        {progress.scope === null ? null : (
          <div>
            <div className="text-small text-primary">
              {progress.completedScope ?? 0}/{progress.scope} points
            </div>
            <div className="text-mini text-tertiary">Estimated scope</div>
          </div>
        )}

        <div>
          <div className="text-small text-primary">
            {formatDate(project.startDate)} → {formatDate(project.targetDate)}
          </div>
          <div className="text-mini text-tertiary">Start and target</div>
        </div>
      </div>

      {project.teams.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-mini text-tertiary">Teams</span>
          {project.teams.map((team) => (
            <span
              key={team.id}
              className={cn(
                "flex items-center gap-1.5 rounded-[var(--radius-md)] border",
                "border-default px-1.5 py-0.5 text-mini text-secondary",
              )}
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ background: team.color }}
              />
              <span className="font-mono text-micro">{team.key}</span>
              {team.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-subtle bg-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-small text-primary">Summarise this project</div>
            <div className="text-mini text-tertiary">
              Sends the description and open issue titles to the configured
              provider.
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              void summarise();
            }}
          >
            {pending ? "Summarising…" : "Summarise"}
          </Button>
        </div>

        {summary === null ? null : summary.ok ? (
          <p className="whitespace-pre-wrap text-small leading-5 text-secondary">
            {summary.text}
            <span className="mt-1 block text-micro text-quaternary">
              {summary.provider} · {summary.model}
            </span>
          </p>
        ) : (
          <p className="text-small leading-5 text-tertiary">{summary.message}</p>
        )}
      </div>
    </section>
  );
}
