/**
 * One project, as a row in the project list.
 *
 * Linear's project list is a table of rows rather than a grid of cards, and the
 * columns are fixed: name and icon, health, lead, progress, target date. This
 * keeps that shape — a `<li>` laid out as a grid — because the value of the
 * screen is scanning twelve projects for the one that is off track, and a card
 * grid makes that a hunt.
 *
 * Progress is a donut, not a bar: at 32px a bar reads as decoration and a donut
 * reads as a fraction, which is what `research/01-visual-design.md` measured on
 * the real list.
 */

import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { ProgressDonut } from "@/components/ui/progress-donut";
import { cn } from "@/lib/cn";

import { ProjectIcon } from "./project-icon";
import {
  PROJECT_HEALTH_COLORS,
  PROJECT_HEALTH_LABELS,
  PROJECT_STATE_LABELS,
  formatDate,
  type ProjectCardView,
} from "./types";

export interface ProjectCardProps {
  project: ProjectCardView;
  /** `/{workspace}/project/{slug}` — assembled by the caller, which knows it. */
  href: string;
}

export function ProjectCard({ project, href }: ProjectCardProps) {
  const health = project.health;

  return (
    <li data-testid={`project-card-${project.slugId}`}>
      <Link
        href={href}
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-lg)]",
          "px-3 py-2.5 transition-colors duration-[var(--speed-quick)] hover:bg-hover",
          "sm:grid-cols-[minmax(0,1fr)_120px_92px_64px_72px]",
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <ProjectIcon
            icon={project.icon}
            color={project.color}
            name={project.name}
            size={20}
          />
          <span className="min-w-0">
            <span className="block truncate text-small text-primary">
              {project.name}
            </span>
            {project.summary === "" ? null : (
              <span className="block truncate text-mini text-tertiary">
                {project.summary}
              </span>
            )}
          </span>
        </span>

        <span className="hidden items-center gap-1.5 text-mini text-tertiary sm:flex">
          {health === null ? (
            <span className="text-quaternary">No update</span>
          ) : (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ background: PROJECT_HEALTH_COLORS[health] }}
              />
              {PROJECT_HEALTH_LABELS[health]}
            </>
          )}
        </span>

        <span className="hidden text-mini text-tertiary sm:block">
          {PROJECT_STATE_LABELS[project.state]}
        </span>

        <span className="hidden justify-self-center sm:block">
          {project.lead === null ? (
            <span
              aria-label="No lead"
              className="block size-5 rounded-full border border-dashed border-strong"
            />
          ) : (
            <Avatar
              id={project.lead.id}
              name={project.lead.name}
              src={project.lead.avatarUrl}
              color={project.lead.avatarColor}
              size={20}
            />
          )}
        </span>

        <span className="flex items-center justify-end gap-2">
          <ProgressDonut
            completed={project.progress.completed + project.progress.canceled}
            total={project.progress.total}
            size={16}
            label={`${project.progress.completed} of ${project.progress.total} issues complete`}
          />
          <span className="hidden w-12 text-right text-mini text-tertiary sm:block">
            {formatDate(project.targetDate)}
          </span>
        </span>
      </Link>
    </li>
  );
}
