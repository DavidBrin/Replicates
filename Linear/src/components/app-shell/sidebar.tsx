"use client";

/**
 * The navigation rail — 244px, and **no border on its right edge**.
 *
 * That last part is the structural tell `research/01-visual-design.md` §6.1
 * calls out by name: *"Linear separates sidebar from content with a lightness
 * step, not a border… reproducing this with a 1px vertical divider is the
 * single most common structural tell in clones."* The sidebar sits on the
 * darker ground at `--bg-sidebar` and the content pane is an inset card
 * floating over it.
 *
 * 244px, not the 220px that circulates online — that figure is stale for the
 * current build.
 *
 * ## Sections
 *
 * Workspace switcher and search at the top, then the personal rows (Inbox, My
 * Issues), then *Workspace* (Projects, Views), then *Your teams*. The teams
 * section is the one that carries a permission consequence: it renders exactly
 * the teams the repository returned for this viewer, so a guest's sidebar is
 * the whole of what they can reach.
 */

import { useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import {
  ChevronDownIcon,
  InboxIcon,
  IssuesIcon,
  PlusIcon,
  ProjectsIcon,
  SearchIcon,
  SettingsIcon,
  ViewsIcon,
} from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";
import {
  SidebarItem,
  SidebarSection,
} from "@/components/app-shell/sidebar-section";
import { TeamNav } from "@/components/app-shell/team-nav";
import {
  useWorkspace,
  workspacePath,
} from "@/components/app-shell/workspace-context";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";

/**
 * Re-broadcast a shortcut instead of wiring a callback through the shell.
 *
 * Search belongs to the command palette and creation belongs to the issue view;
 * neither is mounted by the sidebar, and the sidebar is rendered from a server
 * layout that cannot pass a function down. Dispatching the keystroke the
 * feature already listens for keeps the rail decoupled from both, and keeps the
 * mouse path and the keyboard path on exactly one implementation — which is the
 * point of §1.1's "every shortcut has a mouse equivalent".
 */
function broadcast(key: string, code: string, meta = false): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key, code, metaKey: meta, bubbles: true }),
  );
}

export interface SidebarProps {
  readonly pathname: string;
  readonly expandedTeams: ReadonlySet<string>;
  readonly onToggleTeam: (key: string) => void;
  readonly expandedSections: ReadonlySet<string>;
  readonly onToggleSection: (id: string) => void;
}

export function Sidebar({
  pathname,
  expandedTeams,
  onToggleTeam,
  expandedSections,
  onToggleSection,
}: SidebarProps) {
  const { workspace, workspaces, user, teams, views, unreadCount } =
    useWorkspace();
  const switcherRef = useRef<HTMLButtonElement | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <nav
      data-testid="sidebar"
      aria-label="Workspace"
      className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col gap-1 overflow-hidden bg-[var(--bg-sidebar)] px-2 pb-2"
    >
      <div className="flex h-[var(--header-height)] shrink-0 items-center gap-1">
        <button
          ref={switcherRef}
          type="button"
          data-testid="workspace-switcher"
          onClick={() => setSwitcherOpen((open) => !open)}
          aria-expanded={switcherOpen}
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-1.5",
            "text-small text-primary [font-weight:var(--weight-medium)]",
            "hover:bg-[var(--bg-hover)]",
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent text-[10px] text-[var(--text-on-accent)] [font-weight:var(--weight-title)]"
          >
            {workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">
            {workspace.name}
          </span>
          <ChevronDownIcon size={10} className="text-tertiary" />
        </button>

        <button
          type="button"
          aria-label="Search"
          onClick={() => broadcast("k", "KeyK", true)}
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
        >
          <SearchIcon size={14} />
        </button>

        <button
          type="button"
          // Deliberately *not* `new-issue-button`: that id belongs to the view's
          // toolbar, and two elements carrying it would make every
          // `getByTestId("new-issue-button")` in the e2e suite ambiguous.
          data-testid="sidebar-compose"
          aria-label="New issue"
          onClick={() => broadcast("c", "KeyC")}
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-default text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
        >
          <PlusIcon size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex flex-col">
          <SidebarItem
            href={workspacePath(workspace.urlKey, "inbox")}
            icon={<InboxIcon size={14} />}
            label="Inbox"
            count={unreadCount}
            active={pathname.endsWith("/inbox")}
          />
          <SidebarItem
            href={workspacePath(workspace.urlKey, "my-issues")}
            icon={<IssuesIcon size={14} />}
            label="My Issues"
            active={pathname.endsWith("/my-issues")}
          />
        </div>

        <SidebarSection
          label="Workspace"
          expanded={expandedSections.has("workspace")}
          onToggle={() => onToggleSection("workspace")}
        >
          <SidebarItem
            href={workspacePath(workspace.urlKey, "projects")}
            icon={<ProjectsIcon size={14} />}
            label="Projects"
            active={pathname.endsWith("/projects")}
          />
          <SidebarItem
            href={workspacePath(workspace.urlKey, "views")}
            icon={<ViewsIcon size={14} />}
            label="Views"
            active={pathname.endsWith("/views")}
          />
          {views.slice(0, 5).map((view) => (
            <SidebarItem
              key={view.id}
              href={workspacePath(workspace.urlKey, "views", view.id)}
              label={view.name}
              depth={1}
            />
          ))}
        </SidebarSection>

        <div data-testid="sidebar-teams">
          <SidebarSection
            label="Your teams"
            expanded={expandedSections.has("teams")}
            onToggle={() => onToggleSection("teams")}
          >
            {teams.map((team) => (
              <TeamNav
                key={team.id}
                team={team}
                urlKey={workspace.urlKey}
                expanded={expandedTeams.has(team.key)}
                onToggle={() => onToggleTeam(team.key)}
                pathname={pathname}
              />
            ))}
          </SidebarSection>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <a
          href={workspacePath(workspace.urlKey, "settings", "members")}
          className="flex size-7 items-center justify-center rounded-[var(--radius-md)] text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
          aria-label="Settings"
        >
          <SettingsIcon size={14} />
        </a>
        <ThemeToggle />
        <span className="flex-1" />
        <Avatar
          id={user.id}
          name={user.name}
          src={user.avatarUrl}
          color={user.avatarColor}
          size={20}
        />
      </div>

      <Popover
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        anchor={switcherRef}
        aria-label="Switch workspace"
        style={{ width: 228 }}
        className="p-1"
      >
        <ul className="flex flex-col">
          {workspaces.map((entry) => (
            <li key={entry.id}>
              <a
                href={workspacePath(entry.urlKey, "my-issues")}
                className={cn(
                  "flex h-7 items-center gap-2 rounded-[var(--radius-md)] px-2 text-small",
                  entry.id === workspace.id
                    ? "bg-[var(--bg-selected)] text-primary"
                    : "text-secondary hover:bg-[var(--bg-hover)]",
                )}
              >
                {entry.name}
              </a>
            </li>
          ))}
        </ul>
      </Popover>
    </nav>
  );
}
