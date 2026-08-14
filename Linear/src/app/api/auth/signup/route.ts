/**
 * `POST /api/auth/signup`
 *
 * Creates an account, opens a session, and — when the request carries an invite
 * token — redeems it in the same call. That last part is what makes an invite
 * link work for someone who has no account yet: the alternative is signing up,
 * losing the token, and staring at an empty workspace list.
 */

import { z } from "zod";

import { getDb } from "@/adapters/db";
import { config } from "@/config/env";
import { explainDenial } from "@/domain/policy";
import { acceptInvite } from "@/lib/auth/invites";
import { hashPassword } from "@/lib/auth/password";
import { createSession, readCookie, sessionCookie } from "@/lib/auth/session";
import { newId } from "@/lib/ids";

/**
 * A twelve-character minimum and no composition rules.
 *
 * Length is the only requirement that survives contact with how people actually
 * choose passwords; "one uppercase, one digit, one symbol" reliably produces
 * `Password1!` and a sticky note. NIST dropped composition rules in SP 800-63B
 * for the same reason. The cap exists because scrypt hashes whatever it is
 * given and a megabyte-long password is a denial-of-service vector.
 */
const Body = z.object({
  email: z.email().max(320),
  password: z.string().min(12).max(256),
  name: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(60).optional(),
  /** Present when the visitor arrived through an invite link. */
  inviteToken: z.string().min(16).max(256).optional(),
});

/** The 15-minute cookie an invite page leaves behind before redirecting here. */
const PENDING_INVITE_COOKIE = "pending_invite";

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid sign-up details.", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const { email, password, name, displayName } = parsed.data;
  const inviteToken =
    parsed.data.inviteToken ??
    readCookie(request.headers.get("cookie"), PENDING_INVITE_COOKIE);

  // A closed workspace still has to let invited people in, or the invitation is
  // not an invitation.
  if (!config().auth.allowOpenSignup && !inviteToken) {
    return Response.json(
      { error: "Sign-ups are invitation-only on this workspace." },
      { status: 403 },
    );
  }

  const db = getDb();

  // Unlike sign-in, this one does tell you the address is taken. It has to: the
  // alternative is pretending to create an account that already exists and
  // handing the visitor a session they cannot have. The enumeration surface is
  // the same as any sign-up form's and is not the one `SPEC.md` §4 guards.
  const existing = await db.query(
    "select 1 from users where lower(email) = lower($1)",
    [email],
  );
  if (existing.length > 0) {
    return Response.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  const userId = newId("usr");
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name)
     values ($1, $2, $3, $4, $5)`,
    [
      userId,
      email,
      await hashPassword(password),
      name,
      (displayName ?? email.split("@")[0] ?? name).toLowerCase(),
    ],
  );

  const session = await createSession(userId, {
    userAgent: request.headers.get("user-agent"),
    db,
  });

  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookie(session.token));

  let joined: { workspaceId: string; role: string } | null = null;
  let inviteError: string | undefined;
  if (inviteToken) {
    const accepted = await acceptInvite({ token: inviteToken, userId }, db);
    if (accepted.ok) {
      joined = { workspaceId: accepted.value.workspaceId, role: accepted.value.role };
    } else {
      // The account is real and the session is live — only the invitation
      // failed, so this is a 201 with a note rather than an error. Making it a
      // failure would leave the visitor with an account they cannot sign into
      // because the form they used is gone.
      inviteError = explainDenial(accepted.denial);
    }
    // The pending-invite cookie has done its job either way; leaving it would
    // re-try the same dead link on the next sign-up from this browser.
    headers.append(
      "Set-Cookie",
      `${PENDING_INVITE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }

  return Response.json(
    { user: { id: userId, email, name }, workspace: joined, inviteError },
    { status: 201, headers },
  );
}
