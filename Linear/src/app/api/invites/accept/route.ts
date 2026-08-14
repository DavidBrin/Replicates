/**
 * `POST /api/invites/accept`
 *
 * Redeems an invite link for the signed-in user. Signing up through a link is
 * the other half and lives in the sign-up handler, which passes the same token
 * to the same function.
 *
 * The status codes are the part worth reading. Following the rule in
 * `research/05-oss-architecture.md` §3.6, the *route* decides 403 versus 404,
 * not the policy: a token that matches nothing is a 404 with a generic message,
 * because anything more specific turns this endpoint into a way to test guesses.
 * A token whose row we found is a different situation — the caller demonstrably
 * holds it — so "expired" and "already used" are said plainly. Telling someone
 * why their own link is dead leaks nothing and is the difference between a
 * usable product and a shrug.
 */

import { z } from "zod";

import { getDb } from "@/adapters/db";
import { explainDenial, type Denial } from "@/domain/policy";
import { userFromRequest } from "@/lib/auth/current-user";
import { acceptInvite } from "@/lib/auth/invites";
import { sessionCookie } from "@/lib/auth/session";

const Body = z.object({
  token: z.string().min(16).max(256),
});

function statusFor(denial: Denial): number {
  switch (denial.code) {
    case "INVITE_INVALID":
      // Indistinguishable from a link that never existed, on purpose.
      return 404;
    case "INVITE_EXPIRED":
    case "INVITE_ALREADY_USED":
      return 410;
    case "NOT_FOUND":
      return 404;
    default:
      return 403;
  }
}

export async function POST(request: Request): Promise<Response> {
  const db = getDb();

  const session = await userFromRequest(request, { db });
  if (!session) {
    return Response.json(
      { error: "Sign in to accept this invitation." },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid invitation." }, { status: 400 });
  }

  const headers = new Headers();
  // A sliding renewal that the handler does not forward is a sign-out, so this
  // goes on every response the handler can produce from here on.
  if (session.renewedToken) {
    headers.append("Set-Cookie", sessionCookie(session.renewedToken));
  }

  const result = await acceptInvite(
    { token: parsed.data.token, userId: session.user.id },
    db,
  );

  if (!result.ok) {
    return Response.json(
      { error: explainDenial(result.denial), code: result.denial.code },
      { status: statusFor(result.denial), headers },
    );
  }

  return Response.json(
    {
      workspaceId: result.value.workspaceId,
      role: result.value.role,
      teamIds: result.value.teamIds,
      alreadyMember: result.value.alreadyMember,
    },
    { status: 200, headers },
  );
}
