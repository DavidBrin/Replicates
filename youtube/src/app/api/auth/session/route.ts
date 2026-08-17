import { z } from "zod";

import { database } from "@/adapters/db";
import { createUsersRepository } from "@/adapters/repositories/users";
import {
  clearedSessionCookie,
  createSession,
  requestIsSecure,
  revokeSessionByToken,
  sessionCookie,
  sessionTokenFromRequest,
} from "@/lib/auth";

/**
 * Sign in, and sign out.
 *
 * ## Why this did not exist
 *
 * Every piece of it did. `verifyCredentials` was written and tested,
 * `register` creates a user, a channel and two system playlists atomically,
 * `createSession` mints a row and a JWT, `sessionCookie` builds the `Set-Cookie`
 * with the `SameSite=Lax` reasoning worked out — and **nothing in the
 * application called any of them.** The masthead rendered a Sign in button,
 * `guard.ts` resolved sessions on every request, and there was no route in the
 * app that could produce one, so the product was permanently signed out.
 *
 * That is what made a cluster of other things look broken independently:
 * uploading needs a channel owner, subscribing needs a subscriber, watch
 * history needs someone to attribute it to. Each was recorded as its own gap.
 * They were one gap.
 *
 * ## Why a route handler and not a Server Action
 *
 * A Server Action would be more idiomatic and cannot set a cookie the way this
 * needs to: the action runs during a render pass, and issuing a session is a
 * mutation whose entire output is a `Set-Cookie` header plus a redirect. A
 * route handler owns its response, which is the thing being produced here.
 *
 * ## The refusal is deliberately vague, and deliberately slow
 *
 * "That email and password do not match" for a wrong password *and* for an
 * address with no account. `verifyCredentials` already spends the same time on
 * both — it hashes against a decoy when the row is absent — so the answer
 * neither says nor times which one it was. An endpoint that distinguishes them
 * is an account-enumeration oracle, and the sign-in form is the one place
 * every visitor can reach.
 */

export const runtime = "nodejs";

const Credentials = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = Credentials.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "An email address and a password are required." },
      { status: 400 },
    );
  }

  const db = await database();
  const user = await createUsersRepository(db).verifyCredentials(
    parsed.data.email,
    parsed.data.password,
  );

  if (user === null) {
    return Response.json(
      { error: "That email and password do not match." },
      { status: 401 },
    );
  }

  const issued = await createSession(user.id, { db });

  return Response.json(
    { userId: user.id, displayName: user.displayName },
    {
      status: 200,
      headers: {
        "Set-Cookie": sessionCookie(issued.token, {
          secure: requestIsSecure(request),
        }),
      },
    },
  );
}

/**
 * Sign out: drop the row, then clear the cookie.
 *
 * In that order, and both. Clearing only the cookie leaves a valid session in
 * the database that anyone holding a copy of the token can keep using; dropping
 * only the row leaves the browser presenting a token that resolves to nothing
 * on every request, which works but pays a database read for each one.
 *
 * A `DELETE` with no session is a 204, not a 401. Signing out when you are
 * already signed out is not an error, and answering 401 would make a client
 * that retries on failure loop.
 */
export async function DELETE(request: Request): Promise<Response> {
  const token = sessionTokenFromRequest(request);
  if (token !== null) {
    await revokeSessionByToken(token, { db: await database() });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearedSessionCookie({ secure: requestIsSecure(request) }),
    },
  });
}
