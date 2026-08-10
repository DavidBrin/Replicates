import "server-only";

/**
 * Resolves the signed-in `User` from within a Server Component (`(app)`'s
 * layout/pages), which never sees a `Request` object the way a Route
 * Handler does. `requireUser`/`getActor` (container.ts) are `Request`-
 * shaped by design (G8: routes are tested by calling handlers directly with
 * a plain `Request`), so this module reads the session cookie via
 * `next/headers` and re-verifies it through the same `AuthProvider` — never
 * a second auth implementation.
 *
 * SECURITY (mirrors container.ts's `getActor` comment and proxy.ts's own
 * note): `proxy.ts` already redirects an unauthenticated `/app/**` request
 * before any Server Component here would even render, but that's a
 * redirect *convenience*, not the security boundary. `requireCurrentUser`
 * independently re-verifies the cookie's signature and expiry (via
 * `auth.verify`) and redirects to `/signin` itself if it's missing or
 * invalid, so this module never assumes the proxy already did the check.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/adapters/auth/demo-session";
import { getContainer } from "@/lib/container";
import type { User } from "@/domain/entities";

/** Returns the signed-in user, or `null` if signed out / the session is
 * invalid. Never throws, never redirects — for pages that render
 * differently when signed out. */
export async function currentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const { auth, store } = await getContainer();
  const verified = await auth.verify(token);
  if (!verified) return null;

  const user = await store.users.findById(verified.userId);
  return user ?? null;
}

/** Returns the signed-in user, redirecting to `/signin` (defense in depth
 * alongside `proxy.ts`) when there is none. Every `(app)` Server Component
 * that needs "who is this" calls this rather than re-deriving the session
 * itself. */
export async function requireCurrentUser(): Promise<User> {
  const user = await currentUser();
  if (!user) {
    redirect("/signin");
  }
  return user;
}
