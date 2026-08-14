/**
 * `POST /api/auth/signin`
 *
 * One refusal, one shape, one duration.
 *
 * Every failure here — no such address, wrong password, deactivated account —
 * returns the same status, the same message, and does the same amount of work.
 * That last part is the one people skip: a lookup that misses returns in
 * microseconds while a real comparison spends ~100 ms in scrypt, and the
 * difference is measurable across the internet. It turns the endpoint into a
 * "does this person have an account here?" oracle, which for a workspace tool
 * is a membership disclosure rather than a trivium.
 *
 * `verifyPassword(password, null)` is what keeps the two paths the same length:
 * it derives against a decoy hash rather than returning early.
 */

import { z } from "zod";

import { getDb, type SqlRow } from "@/adapters/db";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import type { UserId } from "@/domain/entities";

const Body = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(256),
});

/** The only thing a failed sign-in ever says. */
const REFUSAL = "Incorrect email or password.";

interface CredentialRow extends SqlRow {
  readonly id: UserId;
  readonly password_hash: string;
  readonly name: string;
  readonly email: string;
  readonly active: boolean;
}

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: REFUSAL }, { status: 401 });
  }
  const { email, password } = parsed.data;
  const db = getDb();

  // `lower(email)` matches the expression the unique index is built on. Any
  // other spelling of the comparison silently stops using it.
  const rows = await db.query<CredentialRow>(
    `select id, password_hash, name, email, active
       from users where lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0] ?? null;

  const matches = await verifyPassword(password, user?.password_hash ?? null);
  // A deactivated account is folded in here rather than checked earlier, so it
  // costs the same as a wrong password and reports the same thing.
  if (!user || !matches || !user.active) {
    return Response.json({ error: REFUSAL }, { status: 401 });
  }

  // The one moment the plaintext exists and the cost parameters can be raised
  // without asking anyone to reset anything.
  if (needsRehash(user.password_hash)) {
    await db.execute("update users set password_hash = $2 where id = $1", [
      user.id,
      await hashPassword(password),
    ]);
  }

  const session = await createSession(user.id, {
    userAgent: request.headers.get("user-agent"),
    db,
  });

  return Response.json(
    { user: { id: user.id, email: user.email, name: user.name } },
    { status: 200, headers: { "Set-Cookie": sessionCookie(session.token) } },
  );
}
