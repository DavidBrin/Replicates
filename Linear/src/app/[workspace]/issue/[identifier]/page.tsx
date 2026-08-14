import { notFound, redirect } from "next/navigation";

import { getDb } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import { IssueDetailView } from "@/components/issue-detail/issue-detail-view";
import type {
  DetailActivity,
  DetailIssueRef,
  DetailReaction,
  DetailState,
  DetailUser,
  IssueDetailData,
} from "@/components/issue-detail/types";
import type { StateType, WorkflowState } from "@/domain/entities";
import { can, type Resource } from "@/domain/policy";
import { actorFor, currentUser } from "@/lib/auth/current-user";

/**
 * `/[workspace]/issue/[identifier]` — the issue detail screen.
 *
 * A Server Component that does all the reading, checks `can()` once, and hands
 * one serialisable view model to the client tree. Nothing below it fetches.
 *
 * ## Why the authorization answer is computed here and passed down
 *
 * `canEdit` and `canComment` are `can()` calls, made with the same actor and the
 * same resource the route handlers use. The client renders the *answer*; it
 * never re-derives it from a role, which is the rule `SPEC.md` §4 states and the
 * reason there is no role comparison anywhere in `components/issue-detail`.
 *
 * The flags are a UI affordance, not the gate. Every mutation is re-checked
 * server-side by the handler that performs it — a client that renders the button
 * anyway still gets a 403.
 *
 * ## 404, not 403
 *
 * An issue the actor cannot view is `notFound()`. A 403 would confirm that
 * `ENG-42` exists in a team they are not in, which for a guest is exactly the
 * discovery `SPEC.md` §4 forbids.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspace: string; identifier: string }>;
}

/**
 * The In Progress wedge fills in proportion to a state's position within the
 * *started* group, so "In Review" reads as further along than "In Progress".
 * Every other type is a single glyph, so its group is itself.
 */
function withGroupPositions(states: readonly WorkflowState[]): DetailState[] {
  const byType = new Map<StateType, WorkflowState[]>();
  for (const state of [...states].sort((a, b) => a.position - b.position)) {
    const group = byType.get(state.type) ?? [];
    group.push(state);
    byType.set(state.type, group);
  }

  return [...byType.values()].flatMap((group) =>
    group.map((state, index) => ({
      id: state.id,
      name: state.name,
      type: state.type,
      color: state.color,
      groupIndex: index,
      groupCount: group.length,
    })),
  );
}

function toDetailUser(user: {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
}): DetailUser {
  return {
    id: user.id,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    avatarColor: user.avatarColor,
  };
}

export default async function IssueDetailPage({ params }: PageProps) {
  const { workspace: workspaceKey, identifier } = await params;

  const db = getDb();
  const repos = getRepositories();

  const workspace = await repos.workspaces.byUrlKey(workspaceKey);
  if (!workspace) notFound();

  const viewer = await currentUser({ db });
  if (!viewer) redirect(`/signin?next=/${workspaceKey}/issue/${identifier}`);

  const actor = await actorFor(workspace.id, viewer.id, { db });
  const issue = await repos.issues.byIdentifier(workspace.id, identifier);
  if (!issue) notFound();

  const team = await repos.teams.byId(issue.teamId);
  if (!team) notFound();

  let project: Resource["project"];
  if (issue.projectId !== null) {
    const projectTeamIds = await repos.projects.listTeams(issue.projectId);
    const workspaceTeams = await repos.teams.listForWorkspace(workspace.id);
    const privacy = new Map(workspaceTeams.map((entry) => [entry.id, entry.private]));
    project = {
      id: issue.projectId,
      allTeamsPublic: projectTeamIds.every((id) => privacy.get(id) === false),
    };
  }

  const resource: Resource = {
    kind: "issue",
    team: { id: team.id, private: team.private },
    ...(project ? { project } : {}),
    authorId: issue.creatorId,
    assigneeId: issue.assigneeId,
  };

  if (!can(actor, "issue.view", resource)) notFound();

  const [
    states,
    labels,
    projects,
    members,
    subIssues,
    relations,
    comments,
    activity,
    favorites,
    siblingIssues,
    reactionRows,
  ] = await Promise.all([
    repos.teams.listStates(team.id),
    repos.labels.listForWorkspace(workspace.id, team.id),
    repos.projects.listForUser(workspace.id, viewer.id),
    repos.workspaces.listMembers(workspace.id),
    repos.issues.listSubIssues(issue.id),
    repos.issues.listRelations(issue.id),
    repos.comments.listForIssue(issue.id),
    repos.activity.listForIssue(issue.id),
    repos.views.listFavorites(viewer.id),
    repos.issues.list({
      workspaceId: workspace.id,
      filter: { teamIds: [team.id] },
      orderBy: "manual",
      limit: 250,
    }),
    // Reactions on the description itself. There is no port method for them —
    // reactions are otherwise only ever read as part of a comment — so this is
    // one direct read rather than a repository method with a single caller.
    db.query<{ id: string; emoji: string; user_id: string; name: string }>(
      `select r.id, r.emoji, r.user_id, u.name
         from reactions r join users u on u.id = r.user_id
        where r.issue_id = $1
        order by r.created_at asc, r.id asc`,
      [issue.id],
    ),
  ]);

  const position = siblingIssues.findIndex((candidate) => candidate.id === issue.id);
  const previous = position > 0 ? siblingIssues[position - 1] : undefined;
  const next =
    position !== -1 && position + 1 < siblingIssues.length
      ? siblingIssues[position + 1]
      : undefined;

  const toRef = (candidate: (typeof siblingIssues)[number]): DetailIssueRef => ({
    id: candidate.id,
    identifier: candidate.identifier,
    title: candidate.title,
    stateType: candidate.state.type,
    stateName: candidate.state.name,
    stateColor: candidate.state.color,
    assignee: candidate.assignee ? toDetailUser(candidate.assignee) : null,
  });

  const data: IssueDetailData = {
    workspaceUrlKey: workspace.urlKey,
    viewer: toDetailUser(viewer),
    canEdit:
      can(actor, "issue.update_any", resource) ||
      can(actor, "issue.update_own", resource),
    canComment: can(actor, "comment.create", resource),
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      stateId: issue.stateId,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      projectId: issue.projectId,
      labelIds: issue.labels.map((label) => label.id),
      dueDate: issue.dueDate,
      estimate: issue.estimate,
      teamKey: team.key,
      teamName: team.name,
      createdAt: issue.createdAt,
    },
    states: withGroupPositions(states),
    labels: labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    projects: projects.map((entry) => ({
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      color: entry.color,
    })),
    members: members.map((member) => toDetailUser(member.user)),
    subIssues: subIssues.map(toRef),
    relations: relations.map((relation) => ({
      id: relation.id,
      type: relation.type,
      relatedIdentifier: relation.relatedIdentifier,
      relatedTitle: relation.relatedTitle,
      relatedStateType: relation.relatedStateType,
    })),
    relationCandidates: siblingIssues
      .filter((candidate) => candidate.id !== issue.id)
      .slice(0, 100)
      .map(toRef),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      parentId: comment.parentId,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      user: toDetailUser(comment.user),
      reactions: comment.reactions.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        userId: reaction.userId,
        userName:
          members.find((member) => member.userId === reaction.userId)?.user.name ??
          "Someone",
      })),
    })),
    issueReactions: reactionRows.map(
      (row): DetailReaction => ({
        id: row.id,
        emoji: row.emoji,
        userId: row.user_id,
        userName: row.name,
      }),
    ),
    activity: activity.map(
      (entry): DetailActivity => ({
        id: entry.id,
        type: entry.type,
        payload: entry.payload,
        createdAt: entry.createdAt,
        user: entry.user ? toDetailUser(entry.user) : null,
      }),
    ),
    siblings: {
      index: position === -1 ? 1 : position + 1,
      total: siblingIssues.length,
      previousIdentifier: previous?.identifier ?? null,
      nextIdentifier: next?.identifier ?? null,
    },
    isFavorite: favorites.some(
      (favorite) => favorite.kind === "issue" && favorite.targetId === issue.id,
    ),
  };

  return <IssueDetailView data={data} />;
}
