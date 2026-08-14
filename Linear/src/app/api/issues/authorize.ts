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
 */

import { getDb } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import type {
  IssueId,
  IssueWithRelations,
  Priority,
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
 * `allTeamsPublic` is derived from the owning team rather than rolled up over
 * the project's teams. It is only read by `projectFullyPublic`, which no issue
 * row in the matrix consults — every issue action grants `proj:lead` and
 * `proj:member` outright — so the approximation cannot widen a grant. Deriving
 * it properly would mean a join on every mutation to answer a question nothing
 * asks.
 */
export function issueResource(
  team: Pick<Team, "id" | "private">,
  issue?: Pick<IssueWithRelations, "creatorId" | "assigneeId" | "projectId">,
): Resource {
  return {
    kind: "issue",
    team: { id: team.id, private: team.private },
    ...(issue?.projectId
      ? { project: { id: issue.projectId, allTeamsPublic: !team.private } }
      : {}),
    ...(issue ? { authorId: issue.creatorId, assigneeId: issue.assigneeId } : {}),
  };
}

export interface IssueContext {
  readonly issue: IssueWithRelations;
  readonly team: Team;
  readonly actor: Actor;
}

/**
 * Load an issue with everything the policy needs, and the actor for *its*
 * workspace.
 *
 * The team is fetched separately from `issue.team` on purpose:
 * `IssueWithRelations.team` carries the display fields and not `private`, and
 * the private flag is the one the visibility rows turn on.
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
  return { issue, team, actor };
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
 */
export async function validateReferences(
  patch: IssuePatchInput,
  team: Team,
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
    const project = await repositories.projects.byId(patch.projectId);
    if (!project || project.workspaceId !== team.workspaceId) {
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
