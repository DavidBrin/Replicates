/**
 * `GET|PATCH|DELETE /api/workspaces/{id}/members`
 *
 * Workspace membership. Every mutation goes through
 * `domain/services/membership.ts` rather than the repository, because the rules
 * that matter here are *counts at commit time* — the last owner, an actor's
 * rank against their target — and those are only true inside the transaction
 * that takes the workspace row lock. A handler that called
 * `workspaces.setMemberRole` directly would enforce the storage invariant and
 * none of the authorization.
 *
 * The read is gated separately from the writes, and more loosely: the matrix
 * grants `workspace.view_members` to plain members (row 5). What a plain member
 * cannot reach is the *administration screen*, which is a page-level decision
 * in `app/[workspace]/settings/members/page.tsx` — see the note there about why
 * a read-only members table is worse than no members table.
 */

import { z } from "zod";

import {
  accessForWorkspace,
  badRequest,
  denialResponse,
  forbidden,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
} from "@/components/members/workspace-access";
import { WORKSPACE_ROLES } from "@/domain/entities";
import { can } from "@/domain/policy";
import {
  changeWorkspaceMemberRole,
  removeWorkspaceMember,
} from "@/domain/services/membership";

const RoleChange = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(WORKSPACE_ROLES),
});

const Removal = z.object({
  userId: z.string().min(1).max(64),
});

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const { id } = await context.params;
  const access = await accessForWorkspace(session.user, id);
  if (!access) return notFoundResponse("workspace", headers);

  if (!can(access.actor, "workspace.view_members", { kind: "member" })) {
    return forbidden("workspace.view_members", headers);
  }

  const members = await access.repos.workspaces.listMembers(access.workspace.id);
  return Response.json(
    {
      members: members.map((member) => ({
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        email: member.user.email,
        name: member.user.name,
        displayName: member.user.displayName,
        avatarUrl: member.user.avatarUrl,
        avatarColor: member.user.avatarColor,
        active: member.user.active,
      })),
    },
    { headers },
  );
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const { id } = await context.params;
  const access = await accessForWorkspace(session.user, id);
  if (!access) return notFoundResponse("workspace", headers);

  const parsed = RoleChange.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid role change.", headers);

  // Checked here *and* again inside the transaction. This one produces the
  // right status code from a resource the handler can see; the one under the
  // lock is the one that is actually authoritative, because the actor's own
  // role may have changed between the two.
  if (!can(access.actor, "member.change_role", { kind: "member" })) {
    return forbidden("member.change_role", headers);
  }

  const result = await changeWorkspaceMemberRole(
    {
      workspaceId: access.workspace.id,
      actorId: access.user.id,
      targetUserId: parsed.data.userId,
      nextRole: parsed.data.role,
    },
    access.db,
  );

  if (!result.ok) return denialResponse(result.denial, headers);
  return Response.json({ role: result.value.role }, { headers });
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const { id } = await context.params;
  const access = await accessForWorkspace(session.user, id);
  if (!access) return notFoundResponse("workspace", headers);

  const parsed = Removal.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid removal.", headers);

  // Leaving and being removed are different questions with different rows in
  // the matrix (11 and 9), and the service picks between them by comparing the
  // target with the actor. Asking the wrong one here would refuse a guest their
  // own departure.
  const isSelf = parsed.data.userId === access.user.id;
  const action = isSelf ? "member.leave" : "member.remove";
  if (!can(access.actor, action, { kind: "member" })) {
    return forbidden(action, headers);
  }

  const result = await removeWorkspaceMember(
    {
      workspaceId: access.workspace.id,
      actorId: access.user.id,
      targetUserId: parsed.data.userId,
    },
    access.db,
  );

  if (!result.ok) return denialResponse(result.denial, headers);
  return Response.json({ removed: result.value.removed }, { headers });
}
