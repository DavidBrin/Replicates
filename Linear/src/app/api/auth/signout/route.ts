/**
 * `POST /api/auth/signout`
 *
 * Revokes the row *and* clears the cookie. Clearing the cookie alone is the
 * common half-measure: the token stays valid, so anything that captured it —
 * a shared machine's history, a proxy log — can still use it. Revoking alone
 * leaves the browser sending a dead cookie on every request.
 *
 * `POST`, not `GET`, so that a `<img src="/api/auth/signout">` on another site
 * cannot sign people out. Combined with `SameSite=Lax` — which withholds the
 * cookie on cross-site POSTs — a forged request arrives with no session to
 * revoke.
 *
 * Always 200. There is no failure mode a caller can act on, and reporting
 * "there was no session" tells an attacker whether the cookie they replayed was
 * live.
 */

import { getDb } from "@/adapters/db";
import {
  clearedSessionCookie,
  revokeSession,
  sessionTokenFromRequest,
} from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  await revokeSession(sessionTokenFromRequest(request), { db: getDb() });

  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": clearedSessionCookie() } },
  );
}
