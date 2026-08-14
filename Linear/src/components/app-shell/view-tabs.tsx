"use client";

/**
 * Active / Backlog / All issues.
 *
 * Real links, not buttons over client state. Each is a distinct server-rendered
 * view with its own filter, so the browser's back button, a bookmark and a
 * middle-click all behave the way the URL promises. Tabs implemented as local
 * state are the reason so many clones lose your place on reload.
 *
 * `aria-current="page"` rather than `role="tab"`: these navigate, and calling
 * them tabs would promise a tabpanel relationship that does not exist across a
 * route change.
 */

import { cn } from "@/lib/cn";

// The vocabulary lives in a directive-free module so server components can call
// the guard — see `team-view.ts`. Re-exported here so existing imports of the
// tab component keep working.
import type { TeamView } from "./team-view";

export { TEAM_VIEWS, isTeamView, type TeamView } from "./team-view";

const TAB_LABELS: Readonly<Record<TeamView, string>> = {
  active: "Active",
  backlog: "Backlog",
  all: "All issues",
  board: "Board",
};

export interface ViewTabsProps {
  readonly current: TeamView;
  /** `/{workspace}/team/{KEY}` — the tab appends its own segment. */
  readonly basePath: string;
  /** The board is reachable by `Cmd+B`; the tab row shows only the three lists. */
  readonly tabs?: readonly TeamView[];
}

export function ViewTabs({
  current,
  basePath,
  tabs = ["active", "backlog", "all"],
}: ViewTabsProps) {
  return (
    <div className="flex items-center gap-0.5" data-testid="view-tabs">
      {tabs.map((tab) => {
        const active = tab === current;
        return (
          <a
            key={tab}
            href={`${basePath}/${tab}`}
            data-testid={`view-tab-${tab}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 items-center rounded-[var(--radius-lg)] px-2.5 text-small",
              "[transition:background-color_var(--speed-quick)_var(--ease-quad)]",
              active
                ? "bg-[var(--bg-elevated)] text-primary [font-weight:var(--weight-medium)]"
                : "text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
            )}
          >
            {TAB_LABELS[tab]}
          </a>
        );
      })}
    </div>
  );
}
