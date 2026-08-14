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
  dag: "DAG",
};

/**
 * A tab that navigates to a route of its own rather than a filter of the list.
 *
 * `/team/{KEY}/dag` is a static segment, so Next matches it in preference to
 * the `[view]` segment next to it and the issue-list page never sees `"dag"`.
 * It is still a member of {@link TeamView} because that is what makes
 * `isTeamView` accept the URL and this tab row mark itself current.
 */
const TAB_TITLES: Readonly<Partial<Record<TeamView, string>>> = {
  dag: "Blocking relations as a directed graph",
};

export interface ViewTabsProps {
  readonly current: TeamView;
  /** `/{workspace}/team/{KEY}` — the tab appends its own segment. */
  readonly basePath: string;
  /**
   * The board is reachable by `Cmd+B` and stays out of the row; the DAG is in
   * it, because nothing else in the product hints that the view exists.
   */
  readonly tabs?: readonly TeamView[];
}

export function ViewTabs({
  current,
  basePath,
  tabs = ["active", "backlog", "all", "dag"],
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
            title={TAB_TITLES[tab]}
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
