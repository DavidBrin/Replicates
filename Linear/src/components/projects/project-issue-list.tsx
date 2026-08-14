/**
 * The project's issues.
 *
 * A Server Component: the rows are read-only here and every property on them is
 * already rendered by the time the browser gets it, so there is nothing to
 * hydrate. Clicking a row goes to the issue detail, which is where editing
 * happens.
 *
 * The container carries `data-testid="project-issues"`, which is what the
 * permission journey asserts a newly created issue lands in. The "New issue"
 * affordance beside the heading is {@link ProjectNewIssue}, which reuses the
 * shell's modal and defaults the project from this page — see the note there
 * about why the `new-issue-button` id is not duplicated.
 */

import type { ReactNode } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { cn } from "@/lib/cn";

import type { ProjectIssueView } from "./types";

export interface ProjectIssueListProps {
  issues: readonly ProjectIssueView[];
  /** `/{workspace}` — the prefix each row's link is built from. */
  basePath: string;
  /** {@link ProjectNewIssue}, or nothing when there is no team to file into. */
  action?: ReactNode;
}

export function ProjectIssueList({
  issues,
  basePath,
  action,
}: ProjectIssueListProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-mini font-[var(--weight-medium)] text-tertiary">
          Issues
        </h2>
        {action}
      </div>
      <ul
        data-testid="project-issues"
        className="flex flex-col rounded-[var(--radius-lg)] border border-subtle"
      >
        {issues.length === 0 ? (
          <li className="px-3 py-6 text-center text-mini text-tertiary">
            No issues in this project yet.
          </li>
        ) : (
          issues.map((issue) => (
            <li
              key={issue.id}
              data-testid={`issue-row-${issue.identifier}`}
              className="border-b border-subtle last:border-b-0"
            >
              <Link
                href={`${basePath}/issue/${issue.identifier}`}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2",
                  "transition-colors duration-[var(--speed-quick)] hover:bg-hover",
                )}
              >
                <PriorityIcon priority={issue.priority} muted size={14} />
                <span className="w-16 shrink-0 font-mono text-mini text-tertiary">
                  {issue.identifier}
                </span>
                <StatusIcon
                  type={issue.stateType}
                  color={issue.stateColor}
                  label={issue.stateName}
                  size={14}
                />
                <span
                  data-testid="issue-row-title"
                  className="min-w-0 flex-1 truncate text-small text-primary"
                >
                  {issue.title}
                </span>
                {issue.assignee === null ? null : (
                  <Avatar
                    id={issue.assignee.id}
                    name={issue.assignee.name}
                    src={issue.assignee.avatarUrl}
                    color={issue.assignee.avatarColor}
                    size={16}
                  />
                )}
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
