"use client";

/**
 * One team in the "Your teams" section, with its Issues / Projects / Views
 * children.
 *
 * ## Why the disclosure state is per team and remembered
 *
 * A workspace with eight teams has an eighty-row sidebar if every team is open.
 * Linear keeps each team's disclosure independently and restores it, so the two
 * teams you actually work in stay expanded and the rest stay out of the way.
 * The state is held by the sidebar and persisted with the rest of the shell's
 * layout preferences, rather than here, so a re-render of one team cannot lose
 * another's.
 *
 * ## `sidebar-team-{KEY}` is a contract
 *
 * `e2e/README.md` addresses a team entry by its key, and the permission journey
 * asserts that a guest's sidebar contains `sidebar-team-DES` and does **not**
 * contain `sidebar-team-ENG`. That is the assertion that proves teams are
 * filtered by the repository query rather than hidden by CSS, so the id belongs
 * on the element that exists only when the team does.
 */

import { cn } from "@/lib/cn";
import {
  ChevronDownIcon,
  IssuesIcon,
  ProjectsIcon,
  ViewsIcon,
} from "@/components/ui/icons";
import { SidebarItem } from "@/components/app-shell/sidebar-section";
import {
  workspacePath,
  type ShellTeam,
} from "@/components/app-shell/workspace-context";

export interface TeamNavProps {
  readonly team: ShellTeam;
  readonly urlKey: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** The path the router is on, for the active row. */
  readonly pathname: string;
}

export function TeamNav({
  team,
  urlKey,
  expanded,
  onToggle,
  pathname,
}: TeamNavProps) {
  const base = workspacePath(urlKey, "team", team.key);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        data-testid={`sidebar-team-${team.key}`}
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "group/team flex h-7 shrink-0 items-center gap-2 rounded-[var(--radius-md)] px-2",
          "text-small text-secondary hover:bg-[var(--bg-hover)] hover:text-primary",
          "[transition:background-color_var(--speed-row-hover)_linear]",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[10px] [font-weight:var(--weight-title)]"
          style={{ background: `${team.color}33`, color: team.color }}
        >
          {team.key.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{team.name}</span>
        <ChevronDownIcon
          size={10}
          className={cn(
            "text-quaternary opacity-0 group-hover/team:opacity-100",
            "[transition:transform_var(--speed-quick)_var(--ease-quad),opacity_var(--speed-quick)_var(--ease-quad)]",
            !expanded && "-rotate-90",
          )}
        />
      </button>

      {expanded ? (
        <>
          <SidebarItem
            href={`${base}/all`}
            icon={<IssuesIcon size={14} />}
            label="Issues"
            depth={1}
            active={pathname.startsWith(base)}
          />
          <SidebarItem
            href={workspacePath(urlKey, "projects")}
            icon={<ProjectsIcon size={14} />}
            label="Projects"
            depth={1}
          />
          <SidebarItem
            href={`${base}/board`}
            icon={<ViewsIcon size={14} />}
            label="Views"
            depth={1}
          />
        </>
      ) : null}
    </div>
  );
}
