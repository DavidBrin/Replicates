import "server-only";

/**
 * Sessions — a signed cookie *and* a row, because either alone is wrong.
 *
 * A stateless JWT cannot be revoked. "Sign out", "sign out everywhere", and
 * deleting an account all leave every issued token valid until it expires, and
 * the only honest mitigation is a short expiry, which is the same as saying
 * users get signed out constantly. A pure database session solves revocation
 * and gives the cookie no integrity of its own: the browser then holds a bare
 * primary key, and anything that leaks one row id — a log line, a referrer, a
 * screenshot — is a working credential.
 *
 * So both. The cookie carries a `jose`-signed JWT whose `jti` names a `sessions`
 * row and whose `sub` names the user; the row is the revocation record.
 * {@link resolveSession} checks the signature *and* reads the row, and a valid
 * signature over a row that has been deleted is not a session.
 *
 * ## What this schema does and does not give us
 *
 * `sessions` is `(id, user_id, expires_at, created_at)`. There is no
 * `token_hash` column and no `revoked_at`, and both absences are load-bearing
 * for the design below:
 *
 * - **Revocation is a `delete`, not a flag.** With nothing to mark, the row's
 *   existence *is* the grant. This is strictly simpler and loses only the
 *   forensic record of when a session ended, which nothing here reads.
 * - **There is no sliding expiry and no token rotation.** Rotation exists to
 *   invalidate the old token when the row is extended, and that only means
 *   anything if the row remembers which token it belongs to. Here it does not,
 *   so two tokens minted for the same row are both valid until the row expires
 *   — which makes rotation unimplementable and, usefully, makes the concurrent
 *   renewal race that rotation is prone to impossible. The trade is a fixed
 *   {@link SESSION_TTL_SECONDS} from sign-in rather than from last use.
 *
 * ## `SameSite=Lax`, deliberately not `Strict`
 *
 * A share link is the whole point of a video site: someone opens
 * `/watch?v=…` from a chat client or a search result, and that is a cross-site
 * top-level GET. Under `Strict` the browser sends no cookie at all, so a
 * signed-in viewer lands on their own site signed out — no subscriptions, no
 * watch history, no resume position — and the most common way anyone arrives
 * here is also the one way that looks broken. `Lax` sends the cookie on
 * top-level GET navigations and withholds it on cross-site POSTs, which is the
 * CSRF property that actually matters.
 */

import { randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { database } from "@/adapters/db";
import type { SqlDatabase, SqlExecutor, SqlRow } from "@/adapters/db/driver";
import { config } from "@/config/env";

/* ================================================================ shape == */

/** Thirty days. YouTube's own session outlives any single sitting by a lot. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The cookie's name.
 *
 * Not `session`: a development machine serves several of these clones from
 * `localhost` on different ports, cookies are not port-scoped, and a shared
 * name means signing into one signs you out of another with a token the other
 * cannot verify. A prefix is one word and removes an entire afternoon.
 */
export const SESSION_COOKIE = "yt_session";

export interface IssuedSession {
  /** The JWT to put in the cookie. */
  readonly token: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

interface SessionOptions {
  /** Defaults to the process-wide handle. Tests pass their own. */
  readonly db?: SqlDatabase | SqlExecutor;
}

/* ================================================================= keys == */

function signingKey(): Uint8Array {
  return new TextEncoder().encode(config().env.AUTH_SECRET);
}

async function executor(options: SessionOptions): Promise<SqlExecutor> {
  return options.db ?? (await database());
}

/* ============================================================== issuing == */

/**
 * Open a session for `userId`.
 *
 * The row is written before the token is returned, so there is no window in
 * which a caller holds a token whose row does not exist yet. The reverse order
 * would produce a cookie that fails its very first verification if the insert
 * lost a race with the redirect.
 *
 * `nonce` is not decoration. Two sessions minted for one user inside the same
 * second, with the same expiry, would otherwise differ only by `jti` — which is
 * enough here, but the nonce makes token equality meaningless in general and
 * costs nine bytes.
 */
export async function createSession(
  userId: string,
  options: SessionOptions & { readonly ttlSeconds?: number } = {},
): Promise<IssuedSession> {
  const db = await executor(options);
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const sessionId = `ses_${randomBytes(16).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await db.execute(
    "insert into sessions (id, user_id, expires_at) values ($1, $2, $3)",
    [sessionId, userId, expiresAt.toISOString()],
  );

  const token = await new SignJWT({
    nonce: randomBytes(9).toString("base64url"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt()
    // Seconds, floored — `exp` is a NumericDate, and a fractional one is
    // rejected by some verifiers even where jose tolerates it.
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey());

  return { token, sessionId, userId, expiresAt };
}

/* ============================================================== reading == */

interface SessionRow extends SqlRow {
  readonly id: string;
  readonly user_id: string;
  readonly expires_at: string | Date;
}

/**
 * Verify a token and load its row.
 *
 * Returns `null` for every failure — no token, bad signature, wrong algorithm,
 * expired JWT, missing row, expired row, `sub` that disagrees with the row.
 * The caller cannot tell them apart and should not be able to: they all mean
 * "sign in again", and reporting which one is a gift to somebody probing with
 * edited cookies.
 *
 * `algorithms: ["HS256"]` is not a default worth trusting to a library version
 * bump. Verifying with whatever algorithm the *token's own header* names is the
 * classic JWT break, and pinning it is one line.
 *
 * The `where` clause carries the expiry and the user check rather than a
 * JavaScript comparison after the read, so the database's clock decides — the
 * same clock that wrote `now()` into the row — and there is no window between
 * deciding the session is live and using it.
 */
export async function resolveSession(
  token: string | null | undefined,
  options: SessionOptions = {},
): Promise<ResolvedSession | null> {
  if (!token) return null;

  let sessionId: string | undefined;
  let subject: string | undefined;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
    });
    sessionId = payload.jti;
    subject = payload.sub;
  } catch {
    // An unverifiable token is indistinguishable from no token at all.
    return null;
  }
  if (!sessionId || !subject) return null;

  const db = await executor(options);
  const rows = await db.query<SessionRow>(
    `select id, user_id, expires_at from sessions
      where id = $1 and user_id = $2 and expires_at > now()`,
    [sessionId, subject],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.id,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at),
  };
}

/* =========================================================== revocation == */

/** Sign out one session. Idempotent: revoking a dead session is `false`, not an error. */
export async function revokeSession(
  sessionId: string,
  options: SessionOptions = {},
): Promise<boolean> {
  const db = await executor(options);
  return (
    (await db.execute("delete from sessions where id = $1", [sessionId])) > 0
  );
}

/**
 * Sign out the session a request is carrying.
 *
 * The token is *verified* before its `jti` is used, and that is the whole
 * reason this exists rather than the route reading `jti` itself: an unverified
 * `jti` is an attacker-chosen row id, and a sign-out endpoint that deletes it
 * would let anyone log anyone else out by guessing — or by replaying a session
 * id seen in a log.
 */
export async function revokeSessionByToken(
  token: string | null | undefined,
  options: SessionOptions = {},
): Promise<boolean> {
  const session = await resolveSession(token, options);
  if (!session) return false;
  return revokeSession(session.sessionId, options);
}

/**
 * Sign out everywhere.
 *
 * The caller is not only a settings screen. Deleting an account, or a password
 * change after a compromise, has to reach every device, and this is the one
 * operation a stateless JWT cannot express at all.
 */
export async function revokeSessionsForUser(
  userId: string,
  options: SessionOptions = {},
): Promise<number> {
  const db = await executor(options);
  return db.execute("delete from sessions where user_id = $1", [userId]);
}

/**
 * Housekeeping. Nothing schedules this.
 *
 * Expired rows are already inert — {@link resolveSession} will not match them —
 * so this is about the table not growing without bound, and a deployment may
 * call it opportunistically. `sessions_expiry_idx` is what makes it cheap.
 */
export async function deleteExpiredSessions(
  options: SessionOptions = {},
): Promise<number> {
  const db = await executor(options);
  return db.execute("delete from sessions where expires_at <= now()");
}

/* ============================================================== cookies == */

/**
 * The `Set-Cookie` value for a session.
 *
 * Built by hand rather than through `next/headers`, so a route handler can be
 * called as a plain function in a test: `cookies()` needs a request scope only
 * Next can provide, and a session module that cannot be tested outside the
 * framework is a session module that does not get tested.
 */
/**
 * `Secure` is decided by the **request**, not by `NODE_ENV`.
 *
 * It was `config().isProduction`, guarded by a comment that got the mechanism
 * exactly right — "localhost is http, and a `Secure` cookie there is simply
 * never sent, which presents as 'sign-in does nothing'" — and drew the wrong
 * line. `isProduction` is true for any *production build*, including
 * `next start` on `http://localhost`, which is precisely what the e2e suite
 * runs. So the cookie came back with `Secure`, Chromium dropped it, and
 * signing in did nothing: the predicted failure, in the one configuration
 * nobody had exercised.
 *
 * The property that matters is the scheme the response is travelling over, and
 * that is knowable per request. A real https deployment still gets `Secure`;
 * an http origin does not, whether the build is a production one or not.
 *
 * The parameter is required rather than defaulted, so a new call site has to
 * decide rather than inherit a default that is right in one deployment.
 */
export function sessionCookie(
  token: string,
  options: { readonly secure: boolean; readonly maxAgeSeconds?: number },
): string {
  return buildCookie(
    token,
    options.maxAgeSeconds ?? SESSION_TTL_SECONDS,
    options.secure,
  );
}

/** `Max-Age=0` rather than a past `Expires`: no clock skew to get wrong. */
export function clearedSessionCookie(options: { readonly secure: boolean }): string {
  return buildCookie("", 0, options.secure);
}

/**
 * Whether a request arrived over TLS.
 *
 * `x-forwarded-proto` first, because on Vercel — and behind any reverse proxy
 * — the origin server is spoken to over http and the URL alone would say
 * `http:` for a page the visitor loaded over https.
 *
 * The header is attacker-controllable in principle. Here it can only ever
 * *add* `Secure` to a cookie, which fails closed: the worst a forged header
 * achieves is a cookie the forger's own browser then refuses to send.
 */
export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded !== null) return forwarded.split(",")[0]?.trim() === "https";
  return new URL(request.url).protocol === "https:";
}

function buildCookie(
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    // See the note at the top of the file: `Strict` would drop the cookie on
    // exactly the cross-site GET that a shared video link is.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Parse one cookie out of a `Cookie` header.
 *
 * `decodeURIComponent` **throws** on a malformed escape — a bare `%`, or `%zz`
 * — rather than returning anything. This function is called on the way in to
 * every authenticated route, before any handler runs, so an unhandled throw
 * here turns `Cookie: yt_session=%` into a 500 on a request that should simply
 * have been treated as signed out. It is trivially reachable by anyone, needs
 * no session, and would look like a server fault rather than a bad request.
 *
 * A cookie that cannot be decoded is not a token, so the answer is `null`:
 * exactly what an absent cookie gives, and the same path a forged or expired
 * one already takes.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** The session token a request is carrying, if any. */
export function sessionTokenFromRequest(request: Request): string | null {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE);
}
