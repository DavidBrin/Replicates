/**
 * `POST|PATCH|DELETE /api/teams/{id}/members`
 *
 * Team membership, entirely through `domain/services/membership.ts`.
 *
 * Nothing here picks between `team.add_member` and `team.add_guest`, counts
 * team admins, or checks that a guest is not being made one. All three depend
 * on facts read inside the transaction — the target's *workspace* role, the
 * current admin count — and a handler that pre-computed them would be checking
 * a snapshot from before the lock. `addTeamMember` and friends do the whole
 * decision under `select … for update` on the team row, which is the only place
 * the numbers are still true when the write happens.
 *
 * What the handler still owns is the 404-versus-403 split, because only it
 * knows whether the actor can see the team at all.
 */

import { z } from "zod";

import { getRepositories } from "@/adapters/repositories";
import {
  accessForWorkspace,
  badRequest,
  canOnTeam,
  denialResponse,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
  type RequestSession,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import { TEAM_ROLES, type Team } from "@/domain/entities";
import {
  addTeamMember,
  changeTeamMemberRole,
  removeTeamMember,
} from "@/domain/services/membership";

const Add = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(TEAM_ROLES).optional(),
});

const Change = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(TEAM_ROLES),
});

const Remove = z.object({
  userId: z.string().min(1).max(64),
});

type Context = { params: Promise<{ id: string }> };

type Resolved =
  | {
      readonly ok: true;
      readonly access: WorkspaceAccess;
      readonly team: Team;
      readonly headers: Headers;
    }
  | { readonly ok: false; readonly response: Response };

/**
 * Resolve the team and prove the actor can see it — and no more than that.
 *
 * The *action* check is deliberately absent: which action a membership change
 * needs depends on the target's workspace role (row 20 versus row 21), which
 * the service reads under the lock. Asking a second, weaker question here would
 * be a check that looks like enforcement and is not.
 */
async function resolve(
  session: RequestSession,
  context: Context,
): Promise<Resolved> {
  const { headers } = session;
  const { id } = await context.params;

  const team = await getRepositories().teams.byId(id);
  if (!team) return { ok: false, response: notFoundResponse("team", headers) };

  const access = await accessForWorkspace(session.user, team.workspaceId);
  if (!access) return { ok: false, response: notFoundResponse("team", headers) };

  const visible = canOnTeam(
    access.actor,
    team.private ? "team.view_private" : "team.view",
    team,
  );
  if (!visible) {
    return { ok: false, response: notFoundResponse("team", headers) };
  }

  return { ok: true, access, team, headers };
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const resolved = await resolve(session, context);
  if (!resolved.ok) return resolved.response;

  const parsed = Add.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid membership.", resolved.headers);

  const result = await addTeamMember(
    {
      teamId: resolved.team.id,
      actorId: resolved.access.user.id,
      userId: parsed.data.userId,
      role: parsed.data.role ?? "member",
    },
    resolved.access.db,
  );

  if (!result.ok) return denialResponse(result.denial, resolved.headers);
  return Response.json(
    { added: result.value.added, userId: parsed.data.userId },
    { status: 201, headers: resolved.headers },
  );
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const resolved = await resolve(session, context);
  if (!resolved.ok) return resolved.response;

  const parsed = Change.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid role change.", resolved.headers);

  const result = await changeTeamMemberRole(
    {
      teamId: resolved.team.id,
      actorId: resolved.access.user.id,
      targetUserId: parsed.data.userId,
      nextRole: parsed.data.role,
    },
    resolved.access.db,
  );

  if (!result.ok) return denialResponse(result.denial, resolved.headers);
  return Response.json({ role: result.value.role }, { headers: resolved.headers });
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();

  const resolved = await resolve(session, context);
  if (!resolved.ok) return resolved.response;

  const parsed = Remove.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid removal.", resolved.headers);

  const result = await removeTeamMember(
    {
      teamId: resolved.team.id,
      actorId: resolved.access.user.id,
      targetUserId: parsed.data.userId,
    },
    resolved.access.db,
  );

  if (!result.ok) return denialResponse(result.denial, resolved.headers);
  return Response.json(
    { removed: result.value.removed },
    { headers: resolved.headers },
  );
}
