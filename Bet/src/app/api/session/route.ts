import type { NextRequest } from "next/server";
import { z } from "zod";
import { brand } from "@/domain/entities";
import { sessionCookieOptions } from "@/adapters/auth/demo-session";
import { getContainer } from "@/lib/container";
import { handler, jsonOk, parseBody, throwApp } from "@/lib/http";

const signInSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

/**
 * `POST /api/session { userId }` — the whole "sign in" flow for this demo
 * app (SPEC §3.2): no password, just pick one of the seeded demo users.
 * Sets the `bet_session` cookie on success.
 */
export const POST = handler(async (req: NextRequest) => {
  const { userId } = await parseBody(req, signInSchema);
  const { store, auth } = await getContainer();

  const user = await store.users.findById(brand(userId));
  if (!user) {
    return throwApp({ code: "not_found", message: "No such demo user." });
  }

  const token = await auth.createSession(user.id);
  const res = jsonOk({ user });
  const cookie = sessionCookieOptions();
  res.cookies.set(cookie.name, token, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });
  return res;
});

/** `DELETE /api/session` — sign out. Idempotent: clearing an absent cookie
 * is still a success, no auth check required to sign out. */
export const DELETE = handler(async () => {
  const res = jsonOk({ signedOut: true });
  const cookie = sessionCookieOptions();
  res.cookies.set(cookie.name, "", {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path: cookie.path,
    maxAge: 0,
  });
  return res;
});
