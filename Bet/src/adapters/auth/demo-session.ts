/**
 * Demo session `AuthProvider`: a `jose` HS256 JWT carried in an httpOnly
 * cookie. There is no password/OAuth step — signing in as a demo user
 * (`POST /api/session { userId }`) is the whole flow (SPEC §3, "demo user
 * picker"). This adapter's only job is to make that session tamper-evident
 * and expiring, matching the shape a real provider would have.
 *
 * `jose` (not `jsonwebtoken`) specifically because this must also run from
 * `proxy.ts` on the Edge runtime, which has no `node:crypto` — `jose` is
 * built on Web Crypto and works identically in both runtimes (see
 * research/stack.md §3).
 */

import { jwtVerify, SignJWT } from "jose";
import { brand, type UserId } from "@/domain/entities";
import type { AuthProvider } from "@/ports/auth";

export const SESSION_COOKIE_NAME = "bet_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Development-only fallback signing secret, used exclusively when
 * `AUTH_SECRET` is unset AND `NODE_ENV !== "production"`. This constant is
 * committed to source control and is therefore public knowledge — it exists
 * only so `npm run dev` / tests work with zero setup, never to protect
 * anything real. `getSecretKey()` throws instead of using it when
 * `NODE_ENV === "production"` (see below), and prints one `console.warn`
 * per process when it IS used, so an accidental production deploy with no
 * `AUTH_SECRET` fails loudly rather than silently signing tokens with a key
 * anyone can read in this file.
 */
export const DEV_FALLBACK_SECRET =
  "bet-dev-insecure-fallback-secret-do-not-use-in-production-6f2a9c";

let warnedAboutFallback = false;

function encode(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Resolves the HS256 signing key from `AUTH_SECRET`. In production with no
 * secret configured, throws at first use (effectively at startup, since
 * `container.ts` constructs the `AuthProvider` eagerly) rather than quietly
 * signing tokens with a key that's committed to this repo — see
 * `DEV_FALLBACK_SECRET`'s doc comment.
 */
export function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length > 0) {
    return encode(secret);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to start in production without a " +
        "session-signing secret — see .env.example.",
    );
  }
  if (!warnedAboutFallback) {
    console.warn(
      "[demo-session] AUTH_SECRET is not set — signing sessions with a " +
        "well-known, publicly-committed development fallback secret. This " +
        "is fine for local dev only; it must never be reachable in " +
        "production (see getSecretKey in src/adapters/auth/demo-session.ts).",
    );
    warnedAboutFallback = true;
  }
  return encode(DEV_FALLBACK_SECRET);
}

/** Cookie attributes for `bet_session`, shared by the route that sets it
 * (`/api/session`) and the route that clears it. `secure` is only set in
 * production so the cookie still works over plain `http://localhost`. */
export function sessionCookieOptions(): {
  name: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/**
 * `jose` HS256 JWT `AuthProvider`. Stateless — verification is signature +
 * expiry only, no server-side session store (acceptable for a demo app with
 * no real revocation requirement; see README "Known gaps" from Task 14).
 */
export class DemoSessionAuthProvider implements AuthProvider {
  async createSession(userId: UserId): Promise<string> {
    const key = getSecretKey();
    return await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(key);
  }

  async verify(token: string): Promise<{ userId: UserId } | null> {
    if (!token) return null;
    try {
      const key = getSecretKey();
      const { payload } = await jwtVerify(token, key);
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        return null;
      }
      return { userId: brand<"UserId">(payload.sub) };
    } catch {
      // Expired, malformed, or tampered — treat identically to "no
      // session," never throw (callers would otherwise have to distinguish
      // "signed out" from "auth adapter broke," which isn't a distinction
      // any caller needs to make).
      return null;
    }
  }
}
