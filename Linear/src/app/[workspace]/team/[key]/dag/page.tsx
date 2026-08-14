/**
 * `/{workspace}/team/{KEY}/dag` — the team's blocking relations as a directed
 * graph.
 *
 * Linear does not have this view. The data has always been there — `blocks` and
 * `blocked_by` are first-class relations — but every screen that shows them
 * shows *one hop*, on the issue you happen to be looking at. Which means a
 * chain four issues long is only visible to someone who already knows to walk
 * it, and a dependency cycle is not visible at all.
 *
 * ## A static segment beside a dynamic one
 *
 * The sibling route is `[view]`, which renders the issue list for `active`,
 * `backlog`, `all` and `board`. Next matches a static segment first, so `dag`
 * lands here and that page never sees it. This is deliberately *not* a fifth
 * branch inside `[view]/page.tsx`: it shares none of that page's data — no
 * states, no labels, no projects, no manual ordering — and adding it there
 * would mean fetching six things to draw a graph that needs two.
 *
 * ## Everything expensive happens here, once
 *
 * The traversal, the normalisation and the layout are all server-side. What
 * ships to the browser is positions and card text, which is why the graph does
 * not reflow after hydration.
 *
 * ## What bounds the walk
 *
 * `listForUser` is the authority on which teams the viewer may see, and it is
 * handed to the query as the set the traversal may not leave — not as a filter
 * on the way out. `dependencyGraph`'s docstring has the argument for why those
 * are different; the short version is that an issue nobody may see must not be
 * usable as a bridge between two that they may.
 */

import { notFound, redirect } from "next/navigation";

import { getRepositories } from "@/adapters/repositories";
import { DEPENDENCY_GRAPH_CONFIG } from "@/config/dependency-graph";
import { can, canViewTeam } from "@/domain/policy";
import { buildDependencyGraph } from "@/domain/services/dependency-graph";
import { layoutGraph } from "@/domain/services/graph-layout";
import { actorFor, currentUser } from "@/lib/auth/current-user";
import { AppHeader, SubHeader } from "@/components/app-shell/header";
import { ViewTabs } from "@/components/app-shell/view-tabs";
import { DependencyGraph } from "@/components/issues/dependency-graph";

export default async function TeamDagPage({
  params,
}: {
  params: Promise<{ workspace: string; key: string }>;
}) {
  const { workspace: urlKey, key } = await params;

  const path = `/${urlKey}/team/${key}/dag`;
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(path)}`);

  const repositories = getRepositories();
  const workspace = await repositories.workspaces.byUrlKey(urlKey);
  if (!workspace) notFound();

  const actor = await actorFor(workspace.id, user.id);
  if (!can(actor, "workspace.view", { kind: "workspace" })) notFound();

  const team = await repositories.teams.byKey(workspace.id, key.toUpperCase());
  if (!team) notFound();
  // A 404 rather than an empty graph, for the reason `[view]/page.tsx` gives:
  // a page that renders its chrome has already confirmed the team exists.
  if (!canViewTeam(actor, team)) notFound();

  const visibleTeams = await repositories.teams.listForUser(
    workspace.id,
    user.id,
  );

  const rows = await repositories.issues.dependencyGraph({
    teamId: team.id,
    visibleTeamIds: visibleTeams.map((visible) => visible.id),
    maxNodes: DEPENDENCY_GRAPH_CONFIG.maxNodes,
  });

  const graph = buildDependencyGraph(rows.issues, rows.relations);
  const layout = layoutGraph(
    graph.nodes.map((node) => node.id),
    graph.edges.map((edge) => ({ from: edge.blockerId, to: edge.blockedId })),
    DEPENDENCY_GRAPH_CONFIG.layout,
  );

  const basePath = `/${encodeURIComponent(workspace.urlKey)}/team/${encodeURIComponent(team.key)}`;
  const issueBasePath = `/${encodeURIComponent(workspace.urlKey)}/issue`;

  /**
   * Issues in this team that the graph does not draw.
   *
   * Two populations, and the count has to include both or it contradicts the
   * page. `isolatedCount` is the SQL answer — issues with no blocking relation
   * at all. `graph.isolated` is what the domain dropped afterwards: an issue
   * whose only blocker lives in a team the viewer cannot see arrives as a node
   * with no drawable edge, and drawing it alone would be a box floating beside
   * the graph for no visible reason.
   */
  const notDrawn =
    rows.isolatedCount +
    graph.isolated.filter((issue) => issue.teamId === team.id).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader
        crumbs={[
          { label: team.name, href: `${basePath}/all` },
          { label: "Dependencies" },
        ]}
      />
      <SubHeader
        actions={
          <GraphSummary
            drawn={graph.nodes.length}
            notDrawn={notDrawn}
            teamKey={team.key}
            truncated={rows.truncated}
          />
        }
      >
        <ViewTabs current="dag" basePath={basePath} />
      </SubHeader>

      {graph.nodes.length === 0 ? (
        <EmptyGraph teamKey={team.key} notDrawn={notDrawn} />
      ) : (
        <DependencyGraph
          issues={graph.nodes}
          edges={graph.edges}
          layout={layout}
          cycles={graph.cycles}
          issueBasePath={issueBasePath}
          teamKey={team.key}
        />
      )}
    </div>
  );
}

function GraphSummary({
  drawn,
  notDrawn,
  teamKey,
  truncated,
}: {
  readonly drawn: number;
  readonly notDrawn: number;
  readonly teamKey: string;
  readonly truncated: boolean;
}) {
  if (drawn === 0) return null;
  return (
    <div
      className="flex items-center gap-2 text-mini text-tertiary"
      data-testid="graph-summary"
    >
      {truncated && (
        <span
          className="rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[var(--warning)]"
          data-testid="graph-truncated"
          title={`This chain is larger than ${DEPENDENCY_GRAPH_CONFIG.maxNodes} issues and has been cut.`}
        >
          Showing the first {DEPENDENCY_GRAPH_CONFIG.maxNodes}
        </span>
      )}
      <span>
        {drawn} {drawn === 1 ? "issue" : "issues"} with dependencies
      </span>
      {notDrawn > 0 && (
        <span data-testid="graph-not-drawn">
          · {notDrawn} in {teamKey} with none
        </span>
      )}
    </div>
  );
}

/**
 * The empty state, which is the common one.
 *
 * Most teams have no blocking relations at all, and an empty canvas with pan
 * controls would read as a page that failed to load. It says what the view is
 * for and where relations are created, because there is nowhere on this screen
 * to create one — the graph is read-only by design.
 */
function EmptyGraph({
  teamKey,
  notDrawn,
}: {
  readonly teamKey: string;
  readonly notDrawn: number;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
      data-testid="graph-empty"
    >
      <p className="text-regular text-primary">No dependencies in {teamKey}</p>
      <p className="max-w-sm text-small text-tertiary">
        {notDrawn > 0
          ? `None of the ${notDrawn} issues in this team blocks another. `
          : ""}
        Mark one issue as blocking another from its detail page and the chain
        will be drawn here.
      </p>
    </div>
  );
}
