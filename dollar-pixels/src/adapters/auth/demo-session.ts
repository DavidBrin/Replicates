import "server-only";

/**
 * Sign-in with nothing but a display name.
 *
 * No password, no email, no verification. The session is a signed JWT in a
 * cookie, which is enough to answer "which pages are mine" and "whose ledger
 * is this" — the only two questions the product actually asks of identity.
 * It is not enough to protect anything valuable, and nothing valuable is
 * behind it: every page is public by design.
 */

import { SignJWT, jwtVerify } from "jose";
import type { AuthProvider, SessionClaims } from "@/ports";

export const SESSION_COOKIE = "dp_session";
const ISSUER = "dollar-pixels";
const TTL = "30d";

export class DemoSessionAuth implements AuthProvider {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async createSession(claims: SessionClaims): Promise<string> {
    return new SignJWT({ handle: claims.handle })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(TTL)
      .sign(this.key);
  }

  async verify(token: string): Promise<SessionClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER });
      const userId = payload.sub;
      const handle = payload.handle;
      if (typeof userId !== "string" || typeof handle !== "string") return null;
      return { userId, handle };
    } catch {
      // An expired, tampered or malformed token is simply "not signed in".
      // Distinguishing the cases would tell an attacker which one they hit.
      return null;
    }
  }
}

/**
 * The signing secret.
 *
 * Falls back to a per-process random value rather than a hardcoded default,
 * because a hardcoded default is a signing key that ships in the repository
 * and lets anyone mint a session on any deployment. The cost of the fallback
 * is that sessions do not survive a restart and do not work across instances,
 * which is the correct trade for a variable someone forgot to set.
 */
export function resolveAuthSecret(env: Record<string, string | undefined>): string {
  const configured = env.AUTH_SECRET?.trim();
  if (configured) return configured;
  return `dev-only-${crypto.randomUUID()}`;
}
