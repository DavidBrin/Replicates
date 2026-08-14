import "server-only";

/**
 * Turning a request into an {@link Actor}, once, for every screen and route in
 * this slice.
 *
 * `lib/auth/current-user.ts` answers "who is this?" and `domain/policy.ts`
 * answers "may they?". What sits between them is the boring, repetitive and
 * easy-to-get-wrong part: resolve the workspace from a URL segment, load the
 * membership, and assemble the {@link Resource} the matrix needs. Written once
 * per route handler, that is nine places for a forgotten `can()` to hide.
 *
 * ## Why this file lives under `components/members`
 *
 * Because the slice that owns projects, teams and members owns exactly these
 * directories and the nine route files listed in its brief — there is no shared
 * `lib/` module it may create. The `server-only` import is what keeps the
 * placement honest: a client component that reaches for this fails the build
 * rather than shipping the database adapter to a browser.
 *
 * ## The one piece of real logic here: a project has *several* teams
 *
 * `can()` reads at most one team role, because a {@link Resource} names at most
 * one team. A project attached to Engineering and Design is a resource where
 * the actor may hold a role in either, and asking the matrix about only the
 * first would deny a Design lead their own project. {@link canOnProject}
 * therefore asks once per attached team and takes the union — which is the same
 * rule `policy.ts` applies across the three axes, extended to the one axis that
 * can hold more than one value.
 */

import { getDb, type SqlDatabase } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import type {
  ProjectId,
  Team,
  TeamId,
  Workspace,
  WorkspaceId,
} from "@/domain/entities";
import {
  can,
  explainDenial,
  type Action,
  type Actor,
  type Denial,
} from "@/domain/policy";
import {
  actorFor,
  currentUser,
  userFromRequest,
  type SessionUser,
} from "@/lib/auth/current-user";
import { sessionCookie } from "@/lib/auth/session";
import type { Repositories } from "@/ports/repositories";

/* ================================================================ access = */

export interface WorkspaceAccess {
  readonly db: SqlDatabase;
  readonly repos: Repositories;
  readonly workspace: Workspace;
  readonly user: SessionUser;
  readonly actor: Actor;
}

/**
 * A signed-in principal's standing in the workspace named by a URL segment.
 *
 * `null` covers three different situations on purpose — not signed in, no such
 * workspace, not a member of it — because a caller that distinguishes them is a
 * caller that tells an outsider which workspace URLs exist. All three become
 * the same `notFound()` or the same 404.
 *
 * A *suspended* member is the one case that stays non-null: they demonstrably
 * know the workspace exists, so hiding it from them says nothing they do not
 * already know, and `can()` denies them everything by precondition (R9) with a
 * 403 that names the real reason.
 */
export async function accessForPage(
  urlKey: string,
): Promise<WorkspaceAccess | null> {
  const user = await currentUser();
  if (!user) return null;
  return assemble(user, await workspaceByUrlKey(urlKey));
}

export interface RequestSession {
  readonly user: SessionUser;
  /**
   * Headers carrying a renewed session cookie, if the request produced one.
   *
   * Built before the first early return and passed to every response the
   * handler can produce: a sliding renewal that is not forwarded signs the user
   * out, and the responses most likely to forget it are the error ones.
   */
  readonly headers: Headers;
}

/** The signed-in user for a route handler, or `null` for a 401. */
export async function sessionForRequest(
  request: Request,
): Promise<RequestSession | null> {
  const session = await userFromRequest(request);
  if (!session) return null;
  const headers = new Headers();
  if (session.renewedToken !== undefined) {
    headers.append("Set-Cookie", sessionCookie(session.renewedToken));
  }
  return { user: session.user, headers };
}

/**
 * The user's standing in one workspace, resolved by id.
 *
 * A route usually learns its workspace from the resource it was handed — a
 * project id, a team id — so the id is the parameter and resolving the resource
 * is the handler's job. That keeps "does this exist" and "may this actor touch
 * it" next to each other, which is where the 404-versus-403 decision belongs.
 */
export async function accessForWorkspace(
  user: SessionUser,
  workspaceId: WorkspaceId | null | undefined,
): Promise<WorkspaceAccess | null> {
  if (!workspaceId) return null;
  return assemble(user, await getRepositories().workspaces.byId(workspaceId));
}

async function workspaceByUrlKey(urlKey: string): Promise<Workspace | null> {
  return getRepositories().workspaces.byUrlKey(urlKey);
}

async function assemble(
  user: SessionUser,
  workspace: Workspace | null,
): Promise<WorkspaceAccess | null> {
  if (!workspace) return null;
  const db = getDb();
  const repos = getRepositories();
  const actor = await actorFor(workspace.id, user.id, { db });
  // Somebody with no `workspace_members` row is not a principal of this
  // workspace at all. Returning an actor for them would make every caller
  // answer 403, which confirms the workspace exists — so the membership check
  // happens once, here, and an outsider is indistinguishable from a typo.
  if (actor.workspaceRole === null) return null;
  return { db, repos, workspace, user, actor };
}

/* ============================================================== resources = */

/**
 * Everything the matrix needs to know about a project's containers.
 *
 * `allTeamsPublic` is footnote 11's roll-up and is computed rather than stored,
 * for the reason `membership.ts` gives: one private team on a project hides the
 * project from workspace members who are not in that team, and a stored flag
 * would have to be maintained by every path that attaches or unattaches a team.
 */
export interface ProjectScope {
  readonly teams: readonly Team[];
  readonly allTeamsPublic: boolean;
}

export async function projectScope(
  repos: Repositories,
  projectId: ProjectId,
): Promise<ProjectScope> {
  const teamIds = await repos.projects.listTeams(projectId);
  const teams: Team[] = [];
  for (const teamId of teamIds) {
    const team = await repos.teams.byId(teamId);
    if (team) teams.push(team);
  }
  return {
    teams,
    allTeamsPublic: teams.every((team) => !team.private),
  };
}

/**
 * May the actor perform `action` on this project?
 *
 * Asked once per attached team, plus once with no team at all when the project
 * has none. The union is deliberate: a project reached through *any* team the
 * actor administers is a project they administer.
 */
export function canOnProject(
  actor: Actor,
  action: Action,
  projectId: ProjectId,
  scope: ProjectScope,
): boolean {
  const project = { id: projectId, allTeamsPublic: scope.allTeamsPublic };
  if (scope.teams.length === 0) {
    return can(actor, action, { kind: "project", project });
  }
  return scope.teams.some((team) =>
    can(actor, action, {
      kind: "project",
      project,
      team: { id: team.id, private: team.private },
    }),
  );
}

export function canOnTeam(
  actor: Actor,
  action: Action,
  team: { readonly id: TeamId; readonly private: boolean },
): boolean {
  return can(actor, action, {
    kind: "team",
    team: { id: team.id, private: team.private },
  });
}

/* =============================================================== refusals = */

/**
 * The HTTP status for a refusal.
 *
 * Following `research/05-oss-architecture.md` §3.6, the *route* picks 403
 * versus 404 rather than the policy: "you are not a member" and "there is no
 * such row" both answer 404, because a 403 on a resource the caller cannot see
 * confirms that the resource exists. A refusal the caller can act on — the last
 * owner, the last team admin — is a 409, because nothing about the actor's role
 * would change the answer.
 */
export function statusForDenial(denial: Denial): number {
  switch (denial.code) {
    case "NOT_A_MEMBER":
    case "NOT_FOUND":
      return 404;
    case "LAST_OWNER":
    case "LAST_TEAM_ADMIN":
      return 409;
    case "INVITE_EXPIRED":
    case "INVITE_ALREADY_USED":
      return 410;
    case "INVITE_INVALID":
      return 404;
    default:
      return 403;
  }
}

/** A refusal as JSON, carrying the code so the UI can phrase it in its own words. */
export function denialResponse(denial: Denial, headers?: Headers): Response {
  return Response.json(
    { error: explainDenial(denial), code: denial.code },
    { status: statusForDenial(denial), headers },
  );
}

/** The refusal a route reaches for when `can()` said no and there is no `Denial`. */
export function forbidden(action: Action, headers?: Headers): Response {
  return denialResponse({ code: "INSUFFICIENT_ROLE", action }, headers);
}

export function notFoundResponse(
  what: "workspace" | "team" | "project" | "member" | "invite",
  headers?: Headers,
): Response {
  return denialResponse({ code: "NOT_FOUND", what }, headers);
}

export function unauthorized(): Response {
  return Response.json(
    { error: "Sign in to continue.", code: "UNAUTHENTICATED" },
    { status: 401 },
  );
}

/** A malformed body. Never carries the parse detail — it is not actionable. */
export function badRequest(message: string, headers?: Headers): Response {
  return Response.json({ error: message, code: "INVALID_REQUEST" }, {
    status: 400,
    headers,
  });
}
