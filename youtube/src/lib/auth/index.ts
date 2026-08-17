import "server-only";

/**
 * Identity: what a password is worth and what a cookie proves.
 *
 * Two modules with one seam between them, and the seam is deliberate. Hashing
 * knows nothing about sessions, sessions know nothing about hashing, and
 * neither knows what a user *is* — that belongs to
 * `adapters/repositories/users.ts`, which is the only place the two meet.
 *
 * Re-exported from one file so that a route handler writes a single import for
 * the whole sign-in flow, and so that the boundary of this slice is one name
 * rather than two paths a caller has to know the shape of.
 */

export {
  DerivationOverloadedError,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";

export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearedSessionCookie,
  createSession,
  deleteExpiredSessions,
  readCookie,
  requestIsSecure,
  resolveSession,
  revokeSession,
  revokeSessionByToken,
  revokeSessionsForUser,
  sessionCookie,
  sessionTokenFromRequest,
} from "./session";

export type { IssuedSession, ResolvedSession } from "./session";
