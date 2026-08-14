import { notFound } from "next/navigation";

import {
  accessForPage,
  canOnProject,
  projectScope,
} from "@/components/members/workspace-access";
import { ProjectDetail } from "@/components/projects/project-detail";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectIssueList } from "@/components/projects/project-issue-list";
import { ProjectMembersPanel } from "@/components/projects/project-members-panel";
import { ProjectMilestones } from "@/components/projects/project-milestones";
import { ProjectNewIssue } from "@/components/projects/project-new-issue";
import { ProjectOverview } from "@/components/projects/project-overview";
import { ProjectUpdates } from "@/components/projects/project-updates";
import type {
  MilestoneView,
  PersonView,
  ProjectAbilities,
  ProjectDetailView,
  ProjectIssueView,
  ProjectMemberView,
  UpdateView,
} from "@/components/projects/types";
import { OPEN_STATE_TYPES } from "@/domain/entities";
import { can } from "@/domain/policy";

/**
 * `/[workspace]/project/[slug]` — the project screen.
 *
 * ## Why a project nobody may see is a 404
 *
 * `notFound()`, never a 403. A guest who is not on this project and not in its
 * teams must not be able to learn that the slug resolves to anything — that is
 * `SPEC.md` §4's "no project outside their memberships is listable, readable or
 * discoverable", and a 403 would answer the question the 404 refuses.
 *
 * The permission journey asserts exactly this, in both directions: a guest gets
 * a 4xx, is added to the project, gets the page and can edit it, is removed,
 * and gets a 4xx again. Nothing about the *page* changes between those states —
 * the only thing that moves is a row in `project_members`, which is what makes
 * the grant real rather than a rendering decision.
 *
 * ## Abilities are computed here and passed down as facts
 *
 * `canEdit`, `canAddMember` and `canRemoveMember` are `can()` calls made with
 * the same actor and resource the route handlers use. The client renders the
 * answer and never re-derives it from a role. They are affordances, not gates:
 * every mutation is re-checked by the handler that performs it, so a client
 * that renders a button anyway still gets a 4xx.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspace: string; slug: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { workspace: urlKey, slug } = await params;
  const access = await accessForPage(urlKey);
  if (!access) notFound();

  const { repos, workspace, actor } = access;

  const project = await repos.projects.bySlug(workspace.id, slug);
  if (!project) notFound();

  const scope = await projectScope(repos, project.id);
  if (!canOnProject(actor, "project.view", project.id, scope)) notFound();

  const abilities: ProjectAbilities = {
    canEdit: canOnProject(actor, "project.update", project.id, scope),
    // Adding somebody needs a list of people to add, and that list is itself a
    // permission (row 5). A project member who cannot see the workspace roster
    // gets no picker rather than an empty one.
    canAddMember:
      canOnProject(actor, "project.add_member", project.id, scope) &&
      can(actor, "workspace.view_members", { kind: "member" }),
    canRemoveMember: canOnProject(
      actor,
      "project.remove_member",
      project.id,
      scope,
    ),
    canDelete: canOnProject(actor, "project.delete", project.id, scope),
  };

  const [members, milestones, updates, issues, progress] = await Promise.all([
    repos.projects.listMembers(project.id),
    repos.projects.listMilestones(project.id),
    repos.projects.listUpdates(project.id),
    repos.issues.list({
      workspaceId: workspace.id,
      filter: { projectIds: [project.id], includeSubIssues: true },
    }),
    repos.projects.progress(project.id),
  ]);

  const memberViews: ProjectMemberView[] = members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
    avatarColor: member.user.avatarColor,
    role: member.role,
  }));

  const lead = memberViews.find((member) => member.id === project.leadId) ?? null;

  const detail: ProjectDetailView = {
    id: project.id,
    slugId: project.slugId,
    name: project.name,
    summary: project.summary,
    description: project.description,
    icon: project.icon,
    color: project.color,
    state: project.state,
    health: project.health,
    startDate: project.startDate,
    targetDate: project.targetDate,
    lead:
      lead === null
        ? null
        : {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            avatarUrl: lead.avatarUrl,
            avatarColor: lead.avatarColor,
          },
    members: memberViews,
    teams: scope.teams.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      color: team.color,
    })),
    progress: {
      total: progress.total,
      completed: progress.completed,
      started: progress.started,
      canceled: progress.canceled,
      scope: progress.scope,
      completedScope: progress.completedScope,
    },
  };

  // Milestone rollups come from the issue list already in hand rather than one
  // count per milestone: the rows are here, and a second round trip per
  // checkpoint would be N+1 over a list that is never long.
  const milestoneViews: MilestoneView[] = milestones.map((milestone) => {
    const attached = issues.filter(
      (issue) => issue.milestoneId === milestone.id,
    );
    return {
      id: milestone.id,
      name: milestone.name,
      targetDate: milestone.targetDate,
      total: attached.length,
      completed: attached.filter((issue) => issue.state.type === "completed")
        .length,
    };
  });

  const byId = new Map(members.map((member) => [member.userId, member.user]));
  const updateViews: UpdateView[] = updates.map((update) => {
    const author = byId.get(update.userId);
    return {
      id: update.id,
      body: update.body,
      health: update.health,
      createdAt: update.createdAt,
      author:
        author === undefined
          ? null
          : {
              id: author.id,
              name: author.name,
              email: author.email,
              avatarUrl: author.avatarUrl,
              avatarColor: author.avatarColor,
            },
    };
  });

  const issueViews: ProjectIssueView[] = issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    priority: issue.priority,
    stateName: issue.state.name,
    stateType: issue.state.type,
    stateColor: issue.state.color,
    assignee:
      issue.assignee === null
        ? null
        : {
            id: issue.assignee.id,
            name: issue.assignee.name,
            email: issue.assignee.email,
            avatarUrl: issue.assignee.avatarUrl,
            avatarColor: issue.assignee.avatarColor,
          },
  }));

  const candidates: PersonView[] = abilities.canAddMember
    ? (await repos.workspaces.listMembers(workspace.id))
        .filter(
          (member) =>
            !memberViews.some((existing) => existing.id === member.userId),
        )
        .map((member) => ({
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          avatarUrl: member.user.avatarUrl,
          avatarColor: member.user.avatarColor,
        }))
    : [];

  /**
   * Everything the create-issue modal needs, loaded only when it will render.
   *
   * The issue is filed into the project's *first* team, because an issue
   * belongs to exactly one team — that is where its number comes from — and the
   * modal has no team picker. A project with no teams gets no button rather
   * than a button that cannot succeed.
   *
   * The assignee list is the project's own members, not the workspace roster: a
   * guest who was added to this project may file into it (the deviation) and
   * must not thereby learn who else is in the workspace.
   */
  const filingTeam = scope.teams[0];
  const newIssueControl =
    filingTeam === undefined || !abilities.canEdit ? null : (
      <ProjectNewIssue
        project={{
          id: project.id,
          name: project.name,
          icon: project.icon,
          color: project.color,
        }}
        team={{ id: filingTeam.id, key: filingTeam.key, name: filingTeam.name }}
        states={await repos.teams.listStates(filingTeam.id)}
        users={members.map((member) => member.user)}
        labels={await repos.labels.listForWorkspace(workspace.id, filingTeam.id)}
      />
    );

  const openTitles = issues
    .filter((issue) => OPEN_STATE_TYPES.includes(issue.state.type))
    .map((issue) => issue.title)
    .slice(0, 40);

  const basePath = `/${workspace.urlKey}`;

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col px-6 py-6">
      <ProjectDetail
        updateCount={updateViews.length}
        header={
          <ProjectHeader
            // Remounting on a changed field is how the inline editors pick up a
            // server refresh without an effect that re-seeds their state.
            key={`${project.id}:${project.name}:${project.description}:${project.state}`}
            project={detail}
            abilities={abilities}
          />
        }
        overview={
          <>
            <ProjectOverview
              workspaceId={workspace.id}
              project={detail}
              issueTitles={openTitles}
            />
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_240px]">
              <div className="flex flex-col gap-6">
                <ProjectMilestones
                  projectId={project.id}
                  milestones={milestoneViews}
                  abilities={abilities}
                />
                <ProjectIssueList
                  issues={issueViews}
                  basePath={basePath}
                  action={newIssueControl}
                />
              </div>
              <ProjectMembersPanel
                projectId={project.id}
                members={memberViews}
                candidates={candidates}
                abilities={abilities}
              />
            </div>
          </>
        }
        updates={
          <ProjectUpdates
            projectId={project.id}
            updates={updateViews}
            abilities={abilities}
          />
        }
      />
    </div>
  );
}
