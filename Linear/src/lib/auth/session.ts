import "server-only";

/**
 * Sessions — a signed cookie *and* a row, because either alone is wrong.
 *
 * A stateless JWT cannot be revoked: removing someone from the workspace, or
 * their own "sign out everywhere", leaves every issued token valid until it
 * expires. A pure database session needs a lookup on every request and gives
 * the cookie no integrity of its own. So both: the cookie carries a `jose`-
 * signed JWT whose `jti` names a `sessions` row, and the row is the revocation
 * record. A token whose row is gone, revoked or expired is dead on arrival.
 *
 * ## The row stores a hash, never the token
 *
 * `sessions.token_hash` is `sha256(token)`. A database dump is then a list of
 * digests rather than a set of working cookies — the same reasoning as password
 * storage, minus the need for a slow KDF: the token already has 256 bits of
 * entropy from the signing key, so there is nothing to brute-force.
 *
 * ## `SameSite=Lax`, deliberately not `Strict`
 *
 * An invite link is a cross-site GET: someone clicks `/invite/<token>` from
 * Slack or a mail client, and under `Strict` the browser sends no cookie at
 * all. The signed-in user lands on the invite page as an anonymous visitor,
 * signs in again, and the flow that the whole invitation feature exists for is
 * broken. `Lax` sends the cookie on top-level GET navigations and withholds it
 * on cross-site POSTs, which is the CSRF property that actually matters here.
 *
 * ## Sliding expiry
 *
 * The cookie's lifetime is `config().auth.sessionTtlSeconds` from *last use*,
 * not from sign-in — otherwise the tab someone has had open for a month logs
 * them out mid-sentence. Renewal mints a new token for the same row once the
 * session is past its half-life, so the write happens roughly once per TTL/2
 * rather than on every request.
 */

import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { getDb, type SqlDatabase, type SqlRow } from "@/adapters/db";
import { config } from "@/config/env";
import { randomToken } from "@/lib/ids";
import type { UserId } from "@/domain/entities";

/* ================================================================= keys == */

function signingKey(): Uint8Array {
  return new TextEncoder().encode(config().auth.secret);
}

/** Hex, because the column is `text` and a digest is not a domain value. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * `ID_PREFIXES` has no `ses` entry and should not: a session is not a domain
 * entity, never appears in a URL or a payload, and is only ever read back
 * through the `jti` of a token we signed ourselves. The prefix is here so a row
 * is identifiable at a glance in a diagnostic query.
 */
function newSessionId(): string {
  return `ses_${randomToken(16)}`;
}

/* =============================================================== issuing = */

export interface IssuedSession {
  /** The raw JWT. Returned exactly once; only its hash is stored. */
  readonly token: string;
  readonly sessionId: string;
  readonly userId: UserId;
  readonly expiresAt: Date;
}

/**
 * Open a session for `userId`.
 *
 * `randomBytes` in the payload is not decoration: two sessions minted for the
 * same user in the same second with the same expiry would otherwise produce
 * byte-identical JWTs, and `token_hash` is unique.
 */
export async function createSession(
  userId: UserId,
  options: { readonly userAgent?: string | null; readonly db?: SqlDatabase } = {},
): Promise<IssuedSession> {
  const db = options.db ?? getDb();
  const ttl = config().auth.sessionTtlSeconds;
  const sessionId = newSessionId();
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const token = await signToken(sessionId, userId, expiresAt);

  await db.execute(
    `insert into sessions (id, user_id, token_hash, user_agent, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [
      sessionId,
      userId,
      hashToken(token),
      options.userAgent ?? null,
      expiresAt.toISOString(),
    ],
  );

  return { token, sessionId, userId, expiresAt };
}

async function signToken(
  sessionId: string,
  userId: UserId,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ nonce: randomBytes(9).toString("base64url") })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey());
}

/* =============================================================== reading = */

export interface ResolvedSession {
  readonly sessionId: string;
  readonly userId: UserId;
  readonly expiresAt: Date;
  /**
   * Set when the session was past its half-life and has been extended. The
   * caller must send this to the browser or the next request arrives with a
   * token whose hash is no longer in the table.
   */
  readonly renewedToken?: string;
}

interface SessionRow extends SqlRow {
  readonly id: string;
  readonly user_id: UserId;
  readonly expires_at: string | Date;
}

/**
 * Verify a token and load its row, extending the session if it is due.
 *
 * Returns `null` for every failure — bad signature, expired JWT, missing row,
 * revoked row, expired row. The caller cannot distinguish them, and should not:
 * they all mean "sign in again", and reporting which one is a gift to somebody
 * probing with edited cookies.
 *
 * `renew` defaults to **off**, and that default is the important part. Renewal
 * rotates the token, so the old cookie stops working the moment the row is
 * updated — a caller that cannot put the new cookie on the response would sign
 * the user out by reading their session. Server Components are exactly that
 * caller: Next forbids setting a cookie during render. So route handlers, which
 * own a `Response`, pass `renew: true`; renders read without rotating.
 */
export async function resolveSession(
  token: string | null | undefined,
  options: { readonly db?: SqlDatabase; readonly renew?: boolean } = {},
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const db = options.db ?? getDb();

  let subject: string | undefined;
  let sessionId: string | undefined;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
    });
    subject = payload.sub;
    sessionId = payload.jti;
  } catch {
    // An unverifiable token is indistinguishable from no token at all.
    return null;
  }
  if (!subject || !sessionId) return null;

  // One statement validates, touches and reads: the `where` clause is the
  // revocation and expiry check, so there is no window between deciding the
  // session is live and using it.
  const rows = await db.query<SessionRow>(
    `update sessions set last_used_at = now()
      where token_hash = $1 and id = $2 and user_id = $3
        and revoked_at is null and expires_at > now()
      returning id, user_id, expires_at`,
    [hashToken(token), sessionId, subject],
  );
  const row = rows[0];
  if (!row) return null;

  const expiresAt = new Date(row.expires_at);
  const ttl = config().auth.sessionTtlSeconds;
  const remaining = expiresAt.getTime() - Date.now();
  if (options.renew !== true || remaining > (ttl * 1000) / 2) {
    return { sessionId: row.id, userId: row.user_id, expiresAt };
  }

  const nextExpiry = new Date(Date.now() + ttl * 1000);
  const renewedToken = await signToken(row.id, row.user_id, nextExpiry);
  await db.execute(
    "update sessions set token_hash = $2, expires_at = $3 where id = $1",
    [row.id, hashToken(renewedToken), nextExpiry.toISOString()],
  );

  return {
    sessionId: row.id,
    userId: row.user_id,
    expiresAt: nextExpiry,
    renewedToken,
  };
}

/* ============================================================ revocation = */

/** Sign out. Idempotent: revoking a dead session is a no-op, not an error. */
export async function revokeSession(
  token: string | null | undefined,
  options: { readonly db?: SqlDatabase } = {},
): Promise<boolean> {
  if (!token) return false;
  const db = options.db ?? getDb();
  const changed = await db.execute(
    "update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
    [hashToken(token)],
  );
  return changed > 0;
}

/**
 * Sign out everywhere.
 *
 * The caller for this is not a settings screen — it is removing someone from a
 * workspace or deactivating them. A live cookie survives both otherwise.
 */
export async function revokeSessionsForUser(
  userId: UserId,
  options: { readonly db?: SqlDatabase } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  return db.execute(
    "update sessions set revoked_at = now() where user_id = $1 and revoked_at is null",
    [userId],
  );
}

/** Housekeeping. Nothing schedules this; a deployment may call it opportunistically. */
export async function deleteExpiredSessions(
  options: { readonly db?: SqlDatabase } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  return db.execute("delete from sessions where expires_at < now()");
}

/* =============================================================== cookies = */

export function sessionCookieName(): string {
  return config().auth.cookieName;
}

/**
 * The `Set-Cookie` value for a session.
 *
 * Written by hand rather than through `next/headers`, so that a route handler
 * can be called as a plain function in a test — `cookies()` needs a request
 * scope that only Next can provide.
 */
export function sessionCookie(token: string, maxAgeSeconds?: number): string {
  const { auth, isProduction } = config();
  const parts = [
    `${auth.cookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    // Lax, not Strict — see the note at the top of this file. An invite link is
    // a cross-site GET and Strict drops the cookie on it.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds ?? auth.sessionTtlSeconds}`,
  ];
  // Secure is omitted in development because localhost is http and a Secure
  // cookie there is simply never sent.
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

/** `Max-Age=0` rather than a past `Expires`: no clock skew to get wrong. */
export function clearedSessionCookie(): string {
  const { auth, isProduction } = config();
  const parts = [
    `${auth.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

/** Parse one cookie out of a `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return null;
}

/** The session token carried by a request, if any. */
export function sessionTokenFromRequest(request: Request): string | null {
  return readCookie(request.headers.get("cookie"), sessionCookieName());
}
