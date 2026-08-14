import "server-only";

/**
 * The gate every issue Route Handler passes through.
 *
 * Co-located with the handlers rather than under `lib/`, because it is theirs
 * and nothing else may use it: it encodes decisions — which HTTP status a
 * denial gets, what a patch is allowed to name — that only make sense at this
 * boundary. It is a separate module from `route.ts` because Next restricts what
 * a route file may export, and three copies of this logic is three places for
 * the check to rot.
 *
 * ## The rule the whole file exists for
 *
 * **Never trust a client-supplied workspace or team id.** Every request names
 * an *issue* or a *team*; the workspace is read from that row, and the actor is
 * assembled against the workspace the row actually belongs to. A handler that
 * took `workspaceId` from the body would let anyone assemble an actor in a
 * workspace they administer and use it against a row in one they do not.
 *
 * ## Foreign-key validation is authorization, not politeness
 *
 * `stateId`, `assigneeId` and `projectId` all arrive from the client. A state
 * belonging to another team, or a project in another workspace, is not merely
 * invalid — writing it silently moves a row into a container the actor was
 * never checked against. {@link validateReferences} rejects those before any
 * write, and returns 400 rather than 403 because the request is malformed, not
 * refused.
 *
 * `projectId` needs more than a workspace-equality test, which is why
 * {@link resolveProject} exists: attaching an issue to a project puts that
 * project's name into the response and the issue into that project's board, so
 * the actor must hold `project.view` on it. "No such project", "another
 * workspace's project" and "a private project you were never added to" all
 * answer with the *same* message, so the field cannot be used to enumerate
 * projects.
 *
 * ## 404 versus 403
 *
 * Following `research/05-oss-architecture.md` §3.6 and the rest of this
 * codebase: a 403 is only ever shown to somebody who already knows the resource
 * exists. {@link loadIssueContext} therefore returns `null` — a 404 — for an
 * issue the actor may not *view*, and {@link authorizeVisible} downgrades its
 * own refusal to a 404 for the same reason. A 403 on a real id beside a 404 on
 * a made-up one is an enumeration oracle, and it is free to hand out.
 */

import { getDb } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import {
  canOnProject,
  projectScope,
} from "@/components/members/workspace-access";
import type {
  IssueId,
  IssueWithRelations,
  Priority,
  ProjectId,
  Team,
  UserId,
} from "@/domain/entities";
import { can, type Action, type Actor, type Resource } from "@/domain/policy";
import { userFromRequest, type SessionUser } from "@/lib/auth/current-user";
import { sessionCookie } from "@/lib/auth/session";

/** A short-circuit: either the value, or the response to send instead. */
export type Guarded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response };

export interface Viewer {
  readonly user: SessionUser;
  /** Set when the session crossed its half-life; the handler must ship it. */
  readonly renewedToken?: string;
}

/**
 * JSON with the renewed session cookie attached.
 *
 * `userFromRequest` renews a session that crossed its half-life and hands back
 * the new token for the *handler* to deliver — a renewal that never reaches a
 * `Set-Cookie` header signs the user out at the old token's expiry, which
 * presents as "it logs me out every few days" (`lib/auth/current-user.ts`).
 */
export function respond(
  body: unknown,
  status: number,
  viewer?: Viewer,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (viewer?.renewedToken) {
    headers.append("Set-Cookie", sessionCookie(viewer.renewedToken));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function failure(
  status: number,
  error: string,
  viewer?: Viewer,
): Response {
  return respond({ error }, status, viewer);
}

export async function authenticate(request: Request): Promise<Guarded<Viewer>> {
  const resolved = await userFromRequest(request);
  if (!resolved) {
    return { ok: false, response: failure(401, "Not signed in.") };
  }
  return {
    ok: true,
    value: {
      user: resolved.user,
      ...(resolved.renewedToken ? { renewedToken: resolved.renewedToken } : {}),
    },
  };
}

/**
 * The resource an issue action is checked against.
 *
 * `project` may be handed in already resolved, which is what a caller that had
 * to authorize the reference anyway has to spare — {@link resolveProject} rolls
 * up the privacy of *every* team attached to it, which is what footnote 11
 * actually means. Without one, `allTeamsPublic` is derived from the owning team.
 * That approximation cannot widen an issue grant: `projectFullyPublic` is the
 * only predicate that reads it and no issue row in the matrix consults it —
 * every issue action grants `proj:lead` and `proj:member` outright — so on the
 * issue rows the project's job is to *select the actor's project role*, and its
 * id is what does that.
 */
export function issueResource(
  team: Pick<Team, "id" | "private">,
  issue?: Pick<IssueWithRelations, "creatorId" | "assigneeId" | "projectId">,
  project?: Resource["project"],
): Resource {
  const inProject =
    project ??
    (issue?.projectId
      ? { id: issue.projectId, allTeamsPublic: !team.private }
      : undefined);
  return {
    kind: "issue",
    team: { id: team.id, private: team.private },
    ...(inProject ? { project: inProject } : {}),
    ...(issue ? { authorId: issue.creatorId, assigneeId: issue.assigneeId } : {}),
  };
}

export interface IssueContext {
  readonly issue: IssueWithRelations;
  readonly team: Team;
  readonly actor: Actor;
  /**
   * The resource `issue.view` was granted on. Handlers reuse it rather than
   * rebuilding one, so there is a single assembly of the facts the matrix reads.
   */
  readonly resource: Resource;
}

/**
 * Load an issue with everything the policy needs, and the actor for *its*
 * workspace — **or nothing, if the actor may not see it.**
 *
 * The team is fetched separately from `issue.team` on purpose:
 * `IssueWithRelations.team` carries the display fields and not `private`, and
 * the private flag is the one the visibility rows turn on.
 *
 * The `issue.view` gate is here rather than in each handler because the three
 * that call this — PATCH, DELETE and reorder — must not be able to distinguish
 * an issue that does not exist from one they are not entitled to know about.
 * With the check here both answer `null`, and `null` is the 404 every caller
 * already writes. This mirrors `api/_lib/issue-access.ts`, which does the same
 * for the comment, reaction and relation handlers.
 */
export async function loadIssueContext(
  issueId: string,
  userId: UserId,
): Promise<IssueContext | null> {
  const repositories = getRepositories();
  const issue = await repositories.issues.byId(issueId);
  if (!issue) return null;
  const team = await repositories.teams.byId(issue.teamId);
  if (!team) return null;

  const { loadActor } = await import("@/domain/services/membership");
  const actor = await loadActor(getDb(), team.workspaceId, userId);

  const resource = issueResource(team, issue);
  if (!can(actor, "issue.view", resource)) return null;

  return { issue, team, actor, resource };
}

/** `can`, as a guard that produces the refusal. */
export function authorize(
  actor: Actor,
  actions: readonly Action[],
  resource: Resource,
  viewer: Viewer,
): Guarded<true> {
  // Several rows can grant the same request — an issue edit is `update_own`
  // *or* `update_any`, and which one applies depends on facts the caller
  // already attached to the resource. Checking them together keeps that
  // decision out of the handlers.
  if (actions.some((action) => can(actor, action, resource))) {
    return { ok: true, value: true };
  }
  return {
    ok: false,
    response: failure(403, "Your role does not allow this.", viewer),
  };
}

/**
 * {@link authorize}, for a resource the actor may not know exists.
 *
 * `authorize` answers 403, which is the honest answer once the actor has been
 * shown the row — every caller of {@link loadIssueContext} has, because that
 * function already required `issue.view`. A handler that resolves its container
 * from the *request* has shown nothing yet, and a 403 there says "this team is
 * real" to anyone who guesses an id. So the refusal is a 403 only if the actor
 * could have viewed the resource anyway, and a 404 otherwise.
 */
export function authorizeVisible(
  actor: Actor,
  actions: readonly Action[],
  resource: Resource,
  viewer: Viewer,
  missing: string,
): Guarded<true> {
  if (actions.some((action) => can(actor, action, resource))) {
    return { ok: true, value: true };
  }
  if (can(actor, "issue.view", resource)) {
    return {
      ok: false,
      response: failure(403, "Your role does not allow this.", viewer),
    };
  }
  return { ok: false, response: failure(404, missing, viewer) };
}

/**
 * A `projectId` from a client, resolved into the resource fact it stands for —
 * or `null` if the actor has no business naming it.
 *
 * Three refusals collapse into that one `null` deliberately: no such project,
 * a project in another workspace, and a project this actor may not view. They
 * are the same answer because distinguishing them turns the field into a
 * project directory — attaching an issue to a project puts the project's name
 * in the response, so "you may not view it" would leak the very thing the
 * refusal is protecting.
 *
 * `canOnProject` rather than `can`: a project can be attached to several teams
 * and a {@link Resource} names one, so the union across attached teams is taken
 * the same way `components/members/workspace-access.ts` takes it everywhere
 * else a project is authorized.
 */
export async function resolveProject(
  projectId: ProjectId,
  team: Team,
  actor: Actor,
): Promise<Resource["project"] | null> {
  const repositories = getRepositories();
  const project = await repositories.projects.byId(projectId);
  if (!project || project.workspaceId !== team.workspaceId) return null;

  const scope = await projectScope(repositories, projectId);
  if (!canOnProject(actor, "project.view", projectId, scope)) return null;

  return { id: projectId, allTeamsPublic: scope.allTeamsPublic };
}

/** The client-writable fields, already narrowed by the route's schema. */
export interface IssuePatchInput {
  readonly title?: string;
  readonly description?: string;
  readonly stateId?: string;
  readonly priority?: Priority;
  readonly assigneeId?: string | null;
  readonly projectId?: string | null;
  readonly estimate?: number | null;
  readonly dueDate?: string | null;
  readonly sortOrder?: string;
  readonly labelIds?: readonly string[];
}

/**
 * Check that every id in the patch points somewhere the actor is entitled to
 * point it.
 *
 * Returns an error message, or null when the patch is safe to apply.
 *
 * The `actor` is a parameter and not an afterthought: workspace equality is a
 * *containment* test, and containment is not permission. A guest who may edit
 * an issue in team A could otherwise file it into a private project P in the
 * same workspace that they were never added to, and read P's name straight back
 * out of the response.
 */
export async function validateReferences(
  patch: IssuePatchInput,
  team: Team,
  actor: Actor,
): Promise<string | null> {
  const repositories = getRepositories();

  if (patch.stateId !== undefined) {
    const states = await repositories.teams.listStates(team.id);
    if (!states.some((state) => state.id === patch.stateId)) {
      return "That status does not belong to this team.";
    }
  }

  if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
    const members = await repositories.teams.listMembers(team.id);
    if (!members.some((member) => member.userId === patch.assigneeId)) {
      return "That person is not a member of this team.";
    }
  }

  if (patch.projectId !== undefined && patch.projectId !== null) {
    // One message for all three refusals — see {@link resolveProject}.
    if ((await resolveProject(patch.projectId, team, actor)) === null) {
      return "That project is not in this workspace.";
    }
  }

  if (patch.labelIds !== undefined) {
    const labels = await repositories.labels.listForWorkspace(
      team.workspaceId,
      team.id,
    );
    const usable = new Set(labels.map((label) => label.id));
    if (patch.labelIds.some((id) => !usable.has(id))) {
      return "That label is not available to this team.";
    }
  }

  return null;
}

/** The id shape, checked before it reaches a query that would call it missing. */
export function asIssueId(value: string): IssueId {
  return value;
}
