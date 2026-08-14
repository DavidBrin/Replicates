/**
 * `/{workspace}/team/{KEY}/{all|active|backlog|board}` — the screen users spend
 * the day in.
 *
 * ## The refusal is the feature
 *
 * `canViewTeam` decides whether this route exists for this viewer, and it is a
 * **404, not a filtered-empty list**. `e2e/permissions.spec.ts` asserts exactly
 * that — *"hiding a link is not authorization; the route itself has to
 * refuse"* — because a page that renders its chrome and an empty list has
 * already told a guest that `ENG` is a team here.
 *
 * `canViewTeam` rather than `can(actor, "team.view", …)` by hand: the policy
 * table splits public and private teams across two rows with different columns,
 * and `domain/policy.ts` is explicit that a caller choosing the wrong row is a
 * silent privacy bug.
 *
 * ## What each tab is
 *
 * | Tab | Filter |
 * |---|---|
 * | Active | `unstarted` + `started` — Todo and In Progress |
 * | Backlog | `backlog` + `triage` |
 * | All issues | no state constraint |
 * | Board | no state constraint, laid out as columns |
 *
 * The board is a *layout* of the same query rather than a fifth filter, which
 * is why `Cmd+B` can move between the two without a different request.
 */

import { notFound, redirect } from "next/navigation";

import { getRepositories } from "@/adapters/repositories";
import type { IssueFilter, StateType } from "@/domain/entities";
import { can, canViewTeam } from "@/domain/policy";
import { actorFor, currentUser } from "@/lib/auth/current-user";
import { isTeamView, type TeamView } from "@/components/app-shell/team-view";
import { IssueView } from "@/components/issues/issue-view";

const STATE_TYPES_FOR_VIEW: Readonly<
  Partial<Record<TeamView, readonly StateType[]>>
> = {
  active: ["unstarted", "started"],
  backlog: ["backlog", "triage"],
};

export default async function TeamViewPage({
  params,
}: {
  params: Promise<{ workspace: string; key: string; view: string }>;
}) {
  const { workspace: urlKey, key, view } = await params;
  if (!isTeamView(view)) notFound();

  const path = `/${urlKey}/team/${key}/${view}`;
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(path)}`);

  const repositories = getRepositories();
  const workspace = await repositories.workspaces.byUrlKey(urlKey);
  if (!workspace) notFound();

  const actor = await actorFor(workspace.id, user.id);
  if (!can(actor, "workspace.view", { kind: "workspace" })) notFound();

  const team = await repositories.teams.byKey(workspace.id, key.toUpperCase());
  if (!team) notFound();
  if (!canViewTeam(actor, team)) notFound();

  const stateTypes = STATE_TYPES_FOR_VIEW[view];
  const filter: IssueFilter = {
    teamIds: [team.id],
    ...(stateTypes ? { stateTypes } : {}),
  };

  const [issues, states, members, labels, projects, defaultState] =
    await Promise.all([
      repositories.issues.list({
        workspaceId: workspace.id,
        filter,
        orderBy: "manual",
        limit: 500,
      }),
      repositories.teams.listStates(team.id),
      repositories.teams.listMembers(team.id),
      repositories.labels.listForWorkspace(workspace.id, team.id),
      repositories.projects.listForUser(workspace.id, user.id),
      repositories.teams.defaultStateFor(team.id),
    ]);

  const basePath = `/${encodeURIComponent(workspace.urlKey)}/team/${encodeURIComponent(team.key)}`;

  return (
    <IssueView
      workspaceUrlKey={workspace.urlKey}
      crumbs={[{ label: team.name, href: `${basePath}/all` }, { label: "Issues" }]}
      team={{ id: team.id, key: team.key, name: team.name }}
      currentView={view}
      basePath={basePath}
      issues={issues}
      catalog={{
        states,
        users: members.map((member) => member.user),
        labels,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          icon: project.icon,
          color: project.color,
        })),
        teams: [
          { id: team.id, key: team.key, name: team.name, color: team.color },
        ],
      }}
      initialLayout={view === "board" ? "board" : "list"}
      initialGroupBy="status"
      defaultStateId={defaultState.id}
    />
  );
}
