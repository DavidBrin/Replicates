/**
 * The project list.
 *
 * Everything about *which* projects appear was decided in the `where` clause of
 * `projects.listForUser` — a guest sees the projects they were added to and no
 * others, and that is a query rather than a filter applied here for the reason
 * `SPEC.md` §4 gives: a list that fetches everything and hides some leaks
 * through counts and empty states. This component renders what it was given and
 * asks no questions about visibility.
 */

import { cn } from "@/lib/cn";

import { ProjectCard } from "./project-card";
import type { ProjectCardView } from "./types";

export interface ProjectListProps {
  projects: readonly ProjectCardView[];
  /** `/{workspace}` — the prefix each row's link is built from. */
  basePath: string;
  className?: string;
}

export function ProjectList({ projects, basePath, className }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div
        data-testid="project-list"
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)]",
          "border border-dashed border-default px-6 py-16 text-center",
          className,
        )}
      >
        <p className="text-small text-secondary">No projects yet</p>
        <p className="text-mini text-tertiary">
          A project groups issues across teams and gives them a target date.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className={cn(
          "hidden grid-cols-[minmax(0,1fr)_120px_92px_64px_72px] items-center gap-3",
          "border-b border-subtle px-3 pb-2 text-micro text-quaternary sm:grid",
        )}
      >
        <span>Project</span>
        <span>Health</span>
        <span>Status</span>
        <span className="text-center">Lead</span>
        <span className="text-right">Target</span>
      </div>
      <ul data-testid="project-list" className="flex flex-col pt-1">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            href={`${basePath}/project/${project.slugId}`}
          />
        ))}
      </ul>
    </div>
  );
}
