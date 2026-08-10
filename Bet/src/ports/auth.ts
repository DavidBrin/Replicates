/**
 * Session/auth port. The domain and route handlers depend only on this
 * interface; `src/adapters/auth/demo-session.ts` is the one (demo-grade)
 * implementation today, swappable later for a real provider (Auth.js,
 * Clerk, …) without touching call sites — only `src/lib/container.ts`, the
 * single place that constructs adapters, would change.
 */

import type { UserId } from "@/domain/entities";

export interface AuthProvider {
  /** Issues a signed session token for `userId`. Callers wrap this in the
   * `bet_session` cookie (see demo-session.ts for cookie attributes). */
  createSession(userId: UserId): Promise<string>;
  /** Verifies a session token. Returns `null` for anything invalid —
   * missing, malformed, expired, or tampered — never throws; a bad token
   * is exactly as valid as no token at all (treat as signed-out). */
  verify(token: string): Promise<{ userId: UserId } | null>;
}
