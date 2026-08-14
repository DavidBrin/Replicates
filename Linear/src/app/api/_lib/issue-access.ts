import "server-only";

/**
 * "May this request touch this issue?" — resolved once, for four route handlers.
 *
 * A **private folder** (`_lib`), so the App Router does not treat it as a
 * segment. It is not a route and has no HTTP methods; it exists because the
 * comment, reaction and relation handlers all need the same five facts before
 * they can call `can()`, and four copies of that assembly is four places for one
 * of them to quietly forget the project axis.
 *
 * ## Why the facts are assembled rather than taken from the issue
 *
 * `IssueWithRelations` carries the issue's team and project, but only the parts
 * a list row renders — it has no `team.private` and no `project.allTeamsPublic`.
 * Those two are exactly what `domain/policy`'s footnote-11 predicates read, and
 * a `Resource` missing them **fails closed**: `can()` returns false rather than
 * throwing, so the symptom of forgetting them is not an error, it is a
 * permission that silently never applies. Assembling them here means the
 * failure mode is impossible instead of merely unlikely.
 *
 * ## Status codes
 *
 * Following `research/05-oss-architecture.md` §3.6, the route decides 403 versus
 * 404 and the policy does not. An issue the actor cannot *view* is a 404: a 403
 * would confirm that `iss_…` exists, which is a membership oracle. An issue they
 * can view but not edit is an honest 403.
 */

import { getDb, type SqlDatabase } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import type { IssueWithRelations, Team, UserId, WorkspaceId } from "@/domain/entities";
import { can, type Action, type Actor, type Resource } from "@/domain/policy";
import { actorFor, userFromRequest } from "@/lib/auth/current-user";
import { sessionCookie } from "@/lib/auth/session";
import type { Repositories } from "@/ports/repositories";

export interface IssueContext {
  readonly db: SqlDatabase;
  readonly repos: Repositories;
  readonly userId: UserId;
  readonly actor: Actor;
  readonly issue: IssueWithRelations;
  readonly team: Team;
  readonly workspaceId: WorkspaceId;
  /** Populated with `team.private` and `project.allTeamsPublic`. */
  readonly resource: Resource;
  /** Carries a renewed session cookie, if the session crossed its half-life. */
  readonly headers: Headers;
}

export function jsonError(
  status: number,
  error: string,
  headers?: Headers,
): Response {
  return Response.json({ error }, { status, headers });
}

/**
 * Resolve the request's user and the issue's authorization facts.
 *
 * Returns a `Response` when the request cannot proceed, so a handler reads:
 *
 * ```ts
 * const context = await loadIssueContext(request, issueId);
 * if (context instanceof Response) return context;
 * ```
 */
export async function loadIssueContext(
  request: Request,
  issueId: string,
): Promise<IssueContext | Response> {
  const db = getDb();
  const repos = getRepositories();

  const session = await userFromRequest(request, { db });
  if (!session) return jsonError(401, "Sign in to continue.");

  const headers = new Headers();
  // A sliding renewal the handler does not forward is a sign-out, so it goes on
  // every response produced from here on.
  if (session.renewedToken) {
    headers.append("Set-Cookie", sessionCookie(session.renewedToken));
  }

  const issue = await repos.issues.byId(issueId);
  if (!issue) return jsonError(404, "Not found.", headers);

  const team = await repos.teams.byId(issue.teamId);
  if (!team) return jsonError(404, "Not found.", headers);

  const actor = await actorFor(team.workspaceId, session.user.id, { db });

  let project: Resource["project"];
  if (issue.projectId !== null) {
    const teamIds = await repos.projects.listTeams(issue.projectId);
    const workspaceTeams = await repos.teams.listForWorkspace(team.workspaceId);
    const privacy = new Map(workspaceTeams.map((entry) => [entry.id, entry.private]));
    project = {
      id: issue.projectId,
      allTeamsPublic: teamIds.every((id) => privacy.get(id) === false),
    };
  }

  const resource: Resource = {
    kind: "issue",
    team: { id: team.id, private: team.private },
    ...(project ? { project } : {}),
    authorId: issue.creatorId,
    assigneeId: issue.assigneeId,
  };

  if (!can(actor, "issue.view", resource)) {
    // Indistinguishable from an issue that does not exist, on purpose.
    return jsonError(404, "Not found.", headers);
  }

  return {
    db,
    repos,
    userId: session.user.id,
    actor,
    issue,
    team,
    workspaceId: team.workspaceId,
    resource,
    headers,
  };
}

/**
 * Editing an issue is two matrix rows, and the caller must not pick between
 * them by hand.
 *
 * `issue.update_own` is the one a plain workspace member holds for their own
 * issue in a public team; `issue.update_any` is the container-role grant.
 * Effective permission is the union, exactly as `can()` computes it within one
 * row — this is the same union across two rows the matrix splits.
 */
export function canEditIssue(actor: Actor, resource: Resource): boolean {
  return (
    can(actor, "issue.update_any", resource) ||
    can(actor, "issue.update_own", resource)
  );
}

/** The comment half, with the comment's own author attached. */
export function commentResource(
  base: Resource,
  authorId: UserId | null,
): Resource {
  return { ...base, kind: "comment", authorId };
}

export function requireAction(
  context: IssueContext,
  action: Action,
  resource: Resource = context.resource,
): Response | null {
  return can(context.actor, action, resource)
    ? null
    : jsonError(403, "Your role does not allow this.", context.headers);
}
