/**
 * `/{workspace}/my-issues` — everything assigned to the viewer, across teams.
 *
 * The one screen in the app that is scoped to a *person* rather than to a
 * container, which changes two things:
 *
 * - **The team filter is explicit.** The query is restricted to the teams
 *   `listForUser` returned rather than to the whole workspace. An assignment
 *   made before someone was removed from a team must not keep leaking that
 *   team's issue titles into their My Issues, and "assigned to me" is not by
 *   itself a permission.
 * - **There is no team to file into**, so the create modal is not rendered and
 *   `C` does nothing here. A create form that has to ask "which team?" first is
 *   a different interaction, and Linear puts it behind the team views for the
 *   same reason.
 */

import { notFound, redirect } from "next/navigation";

import { getRepositories } from "@/adapters/repositories";
import type { User } from "@/domain/entities";
import { can } from "@/domain/policy";
import { actorFor, currentUser } from "@/lib/auth/current-user";
import { IssueView } from "@/components/issues/issue-view";

export const metadata = { title: "My Issues" };

export default async function MyIssuesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: urlKey } = await params;
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/${urlKey}/my-issues`)}`);

  const repositories = getRepositories();
  const workspace = await repositories.workspaces.byUrlKey(urlKey);
  if (!workspace) notFound();

  const actor = await actorFor(workspace.id, user.id);
  if (!can(actor, "workspace.view", { kind: "workspace" })) notFound();

  const teams = await repositories.teams.listForUser(workspace.id, user.id);
  const teamIds = teams.map((team) => team.id);

  const [issues, stateLists, memberLists, labels, projects] = await Promise.all([
    teamIds.length === 0
      ? Promise.resolve([])
      : repositories.issues.list({
          workspaceId: workspace.id,
          filter: { teamIds, assigneeIds: [user.id] },
          orderBy: "manual",
          limit: 500,
        }),
    Promise.all(teams.map((team) => repositories.teams.listStates(team.id))),
    Promise.all(teams.map((team) => repositories.teams.listMembers(team.id))),
    repositories.labels.listForWorkspace(workspace.id),
    repositories.projects.listForUser(workspace.id, user.id),
  ]);

  // One entry per person across every team the viewer shares — the assignee
  // picker's option list, and the only member list a guest is allowed to see.
  const users = new Map<string, User>();
  for (const members of memberLists) {
    for (const member of members) users.set(member.user.id, member.user);
  }

  return (
    <IssueView
      workspaceUrlKey={workspace.urlKey}
      crumbs={[{ label: user.name }, { label: "My Issues" }]}
      team={null}
      currentView={null}
      basePath={null}
      issues={issues}
      catalog={{
        states: stateLists.flat(),
        users: [...users.values()],
        labels,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          icon: project.icon,
          color: project.color,
        })),
        teams: teams.map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
          color: team.color,
        })),
      }}
      initialLayout="list"
      // Grouped by status across several teams would produce one column per
      // team-state pair; by priority it is one axis everybody shares.
      initialGroupBy="priority"
      defaultStateId={null}
    />
  );
}
