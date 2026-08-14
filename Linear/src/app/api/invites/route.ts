/**
 * `POST|DELETE /api/invites`
 *
 * Minting and revoking invitations. Accepting one is `/api/invites/accept`,
 * which the auth slice owns — the two halves are deliberately separate because
 * only this one requires a signed-in principal with a role.
 *
 * ## The response carries the token, exactly once
 *
 * `lib/auth/invites.ts` stores `sha256(token)` and returns the plaintext to its
 * caller and to nobody else, ever again. So this handler is the only place that
 * can turn it into a URL, and the UI is the only place that can show it. There
 * is no "resend" endpoint and there cannot be one: the alternative is storing a
 * reversible copy, which turns the invites table back into a set of live
 * credentials (`DECISIONS.md` D11).
 *
 * The URL is built from the request's own origin rather than a configured base
 * URL, because there is no configured base URL — the app runs on localhost, on
 * a preview deployment and on production, and a link that points at the wrong
 * one of those is worse than no link.
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
import { createInvite, revokeInvite } from "@/lib/auth/invites";

const CreateBody = z.object({
  workspaceId: z.string().min(1).max(64),
  role: z.enum(WORKSPACE_ROLES),
  email: z.string().email().max(320).nullable().optional(),
  teamIds: z.array(z.string().min(1).max(64)).max(50).optional(),
});

const RevokeBody = z.object({
  workspaceId: z.string().min(1).max(64),
  inviteId: z.string().min(1).max(64),
});

export async function POST(request: Request): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const parsed = CreateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid invitation.", headers);

  const access = await accessForWorkspace(session.user, parsed.data.workspaceId);
  if (!access) return notFoundResponse("workspace", headers);

  if (!can(access.actor, "member.invite", { kind: "invite" })) {
    return forbidden("member.invite", headers);
  }

  const result = await createInvite(
    {
      workspaceId: access.workspace.id,
      actorId: access.user.id,
      role: parsed.data.role,
      email: parsed.data.email ?? null,
      teamIds: parsed.data.teamIds ?? [],
    },
    access.db,
  );

  if (!result.ok) return denialResponse(result.denial, headers);

  const url = new URL(`/invite/${result.value.token}`, request.url).toString();
  return Response.json(
    {
      url,
      invite: {
        id: result.value.invite.id,
        email: result.value.invite.email,
        role: result.value.invite.role,
        teamIds: result.value.invite.teamIds,
        expiresAt: result.value.invite.expiresAt.toISOString(),
      },
    },
    { status: 201, headers },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const parsed = RevokeBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid revocation.", headers);

  const access = await accessForWorkspace(session.user, parsed.data.workspaceId);
  if (!access) return notFoundResponse("workspace", headers);

  // No `can()` call here on purpose: footnote 5 makes revocation depend on who
  // *created* the invite, and the invite row is only read inside
  // `revokeInvite`'s transaction. Pre-checking with the author unknown would
  // either refuse a member their own invitation or grant them everyone's.
  const result = await revokeInvite(
    { inviteId: parsed.data.inviteId, actorId: access.user.id },
    access.db,
  );

  if (!result.ok) return denialResponse(result.denial, headers);
  return Response.json({ revoked: result.value.revoked }, { headers });
}
