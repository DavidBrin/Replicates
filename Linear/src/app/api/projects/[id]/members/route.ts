/**
 * `POST|PATCH|DELETE /api/projects/{id}/members`
 *
 * The deviation from Linear, as an endpoint.
 *
 * In Linear, adding somebody to a project is a notification preference. Here it
 * grants edit on the project and its issues (`SPEC.md` §4, `DECISIONS.md` D8),
 * so this is a *privilege* endpoint and it is written like one: every mutation
 * goes through `domain/services/membership.ts`, which re-reads the actor under
 * a lock on the project row and applies R1 and R7 to the transition. The
 * repository's `addMember` is not called from here at all — it stores a
 * membership and asks nobody's permission, which is the correct division of
 * labour and the wrong thing for a route handler to reach for.
 *
 * `project.add_member` is granted to `proj:member` (row 33) — a project member
 * may bring in another project member. `project.remove_member` and
 * `project.change_member_role` are not (rows 34 and 35): pulling somebody out
 * takes away access, which is a lead's decision, not a peer's.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import {
  accessForWorkspace,
  badRequest,
  canOnProject,
  denialResponse,
  forbidden,
  notFoundResponse,
  projectScope,
  sessionForRequest,
  unauthorized,
  type ProjectScope,
  type RequestSession,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import { PROJECT_ROLES, type ProjectId } from "@/domain/entities";
import type { Action } from "@/domain/policy";
import {
  addProjectMember,
  changeProjectMemberRole,
  removeProjectMember,
} from "@/domain/services/membership";

const Add = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(PROJECT_ROLES).optional(),
});

const Change = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(PROJECT_ROLES),
});

const Remove = z.object({
  userId: z.string().min(1).max(64),
});

type Context = { params: Promise<{ id: string }> };

type Authorized =
  | {
      readonly ok: true;
      readonly access: WorkspaceAccess;
      readonly projectId: ProjectId;
      readonly scope: ProjectScope;
      readonly headers: Headers;
    }
  | { readonly ok: false; readonly response: Response };

/**
 * The session is a parameter rather than something this resolves itself.
 *
 * `DELETE` has to know who the actor is *before* it knows which permission to
 * ask for — leaving is a different row of the matrix from being removed — and
 * resolving the session twice would renew the sliding cookie twice, issuing a
 * token the response then has to choose between.
 */
async function authorize(
  session: RequestSession,
  context: Context,
  action: Action,
): Promise<Authorized> {
  const { headers } = session;

  const { id } = await context.params;
  const project = await getRepositories().projects.byId(id);
  if (!project) return { ok: false, response: notFoundResponse("project", headers) };

  const access = await accessForWorkspace(session.user, project.workspaceId);
  if (!access) {
    return { ok: false, response: notFoundResponse("project", headers) };
  }

  const scope = await projectScope(access.repos, project.id);
  if (!canOnProject(access.actor, action, project.id, scope)) {
    const visible = canOnProject(access.actor, "project.view", project.id, scope);
    return {
      ok: false,
      response: visible
        ? forbidden(action, headers)
        : notFoundResponse("project", headers),
    };
  }

  return { ok: true, access, projectId: project.id, scope, headers };
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const auth = await authorize(session, context, "project.add_member");
  if (!auth.ok) return auth.response;

  const parsed = Add.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid membership.", auth.headers);

  const result = await addProjectMember(
    {
      projectId: auth.projectId,
      actorId: auth.access.user.id,
      userId: parsed.data.userId,
      role: parsed.data.role ?? "member",
    },
    auth.access.db,
  );

  if (!result.ok) return denialResponse(result.denial, auth.headers);
  return Response.json(
    { added: result.value.added, userId: parsed.data.userId },
    { status: 201, headers: auth.headers },
  );
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const auth = await authorize(session, context, "project.change_member_role");
  if (!auth.ok) return auth.response;

  const parsed = Change.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid role change.", auth.headers);

  const result = await changeProjectMemberRole(
    {
      projectId: auth.projectId,
      actorId: auth.access.user.id,
      targetUserId: parsed.data.userId,
      nextRole: parsed.data.role,
    },
    auth.access.db,
  );

  if (!result.ok) return denialResponse(result.denial, auth.headers);
  return Response.json({ role: result.value.role }, { headers: auth.headers });
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const parsed = Remove.safeParse(await request.json().catch(() => null));

  // Leaving a project is always allowed (R8), so the permission asked for
  // depends on who the target is. Getting this the wrong way round would refuse
  // a project member their own departure — a bug with no error message, because
  // the refusal would look like a correct answer to a different question.
  const isSelf = parsed.success && parsed.data.userId === session.user.id;

  const auth = await authorize(
    session,
    context,
    isSelf ? "project.view" : "project.remove_member",
  );
  if (!auth.ok) return auth.response;
  if (!parsed.success) return badRequest("Invalid removal.", auth.headers);

  const result = await removeProjectMember(
    {
      projectId: auth.projectId,
      actorId: auth.access.user.id,
      targetUserId: parsed.data.userId,
    },
    auth.access.db,
  );

  if (!result.ok) return denialResponse(result.denial, auth.headers);
  return Response.json({ removed: result.value.removed }, { headers: auth.headers });
}
