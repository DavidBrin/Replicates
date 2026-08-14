// @vitest-environment node
import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, type SqlDatabase } from "@/adapters/db";
import { config } from "@/config/env";

import {
  clearedSessionCookie,
  createSession,
  deleteExpiredSessions,
  readCookie,
  resolveSession,
  revokeSession,
  revokeSessionsForUser,
  sessionCookie,
  sessionCookieName,
  sessionTokenFromRequest,
} from "../session";

/**
 * Sessions against a real database, because the half of this that matters is
 * the row: revocation, expiry and the sliding renewal are all statements, not
 * token arithmetic.
 *
 * Node environment, not jsdom — jose resolves to its webapi build under jsdom
 * and PGlite's WASM does not load there at all.
 */

const USER = "usr_session_test";

let db: SqlDatabase;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute("delete from sessions");
  await db.execute("delete from users");
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name)
     values ($1, 'session@example.com', 'x', 'Session', 'session')`,
    [USER],
  );
});

describe("createSession", () => {
  it("stores a hash of the token and never the token", async () => {
    const session = await createSession(USER, { db });

    const rows = await db.query<{ token_hash: string; user_id: string }>(
      "select token_hash, user_id from sessions where id = $1",
      [session.sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(USER);
    expect(rows[0]?.token_hash).toBe(
      createHash("sha256").update(session.token).digest("hex"),
    );
    // The row must be useless to somebody holding the database.
    expect(rows[0]?.token_hash).not.toBe(session.token);
  });

  it("issues distinct tokens for two sessions opened in the same tick", async () => {
    // `sessions.token_hash` is unique; two identical JWTs would collide, which
    // is what happens if the payload carries nothing per-session.
    const [first, second] = await Promise.all([
      createSession(USER, { db }),
      createSession(USER, { db }),
    ]);
    expect(first.token).not.toBe(second.token);
  });
});

describe("resolveSession", () => {
  it("returns the user behind a live token", async () => {
    const session = await createSession(USER, { db });
    const resolved = await resolveSession(session.token, { db });
    expect(resolved?.userId).toBe(USER);
    expect(resolved?.sessionId).toBe(session.sessionId);
    expect(resolved?.renewedToken).toBeUndefined();
  });

  it("refuses a token with no row, a tampered token, and nothing at all", async () => {
    const session = await createSession(USER, { db });
    await db.execute("delete from sessions");

    expect(await resolveSession(session.token, { db })).toBeNull();
    expect(await resolveSession("not.a.jwt", { db })).toBeNull();
    expect(await resolveSession(`${session.token}x`, { db })).toBeNull();
    expect(await resolveSession(null, { db })).toBeNull();
    expect(await resolveSession("", { db })).toBeNull();
  });

  it("refuses a revoked session even though the signature is still good", async () => {
    const session = await createSession(USER, { db });
    expect(await revokeSession(session.token, { db })).toBe(true);
    expect(await resolveSession(session.token, { db })).toBeNull();
    // Revoking twice is a no-op rather than an error.
    expect(await revokeSession(session.token, { db })).toBe(false);
  });

  it("refuses a row that has expired, whatever the JWT says", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set expires_at = now() - interval '1 minute' where id = $1",
      [session.sessionId],
    );
    expect(await resolveSession(session.token, { db })).toBeNull();
  });

  it("touches last_used_at", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set last_used_at = now() - interval '1 hour' where id = $1",
      [session.sessionId],
    );
    await resolveSession(session.token, { db });
    const rows = await db.query<{ recent: boolean }>(
      "select last_used_at > now() - interval '1 minute' as recent from sessions where id = $1",
      [session.sessionId],
    );
    expect(rows[0]?.recent).toBe(true);
  });
});

describe("sliding expiry", () => {
  it("rotates the token once the session is past its half-life", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set expires_at = now() + interval '1 minute' where id = $1",
      [session.sessionId],
    );

    const resolved = await resolveSession(session.token, { db, renew: true });
    expect(resolved?.renewedToken).toBeTypeOf("string");
    expect(resolved?.renewedToken).not.toBe(session.token);

    // The rotation is the whole point: the old cookie stops working, the new
    // one works, and it is the same session row.
    expect(await resolveSession(session.token, { db })).toBeNull();
    const withNew = await resolveSession(resolved?.renewedToken ?? "", { db });
    expect(withNew?.sessionId).toBe(session.sessionId);
  });

  it("does not rotate for a caller that cannot send a cookie back", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set expires_at = now() + interval '1 minute' where id = $1",
      [session.sessionId],
    );

    // A render reads without renewing; rotating here would sign the user out.
    const resolved = await resolveSession(session.token, { db });
    expect(resolved?.renewedToken).toBeUndefined();
    expect(await resolveSession(session.token, { db })).not.toBeNull();
  });

  it("leaves a fresh session alone", async () => {
    const session = await createSession(USER, { db });
    const resolved = await resolveSession(session.token, { db, renew: true });
    expect(resolved?.renewedToken).toBeUndefined();
  });
});

describe("bulk revocation", () => {
  it("ends every session a user holds", async () => {
    const first = await createSession(USER, { db });
    const second = await createSession(USER, { db });

    expect(await revokeSessionsForUser(USER, { db })).toBe(2);
    expect(await resolveSession(first.token, { db })).toBeNull();
    expect(await resolveSession(second.token, { db })).toBeNull();
  });

  it("sweeps expired rows", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set expires_at = now() - interval '1 day' where id = $1",
      [session.sessionId],
    );
    expect(await deleteExpiredSessions({ db })).toBe(1);
  });
});

describe("the cookie", () => {
  it("is httpOnly, lax and scoped to the whole site", () => {
    const cookie = sessionCookie("token-value");
    expect(cookie).toContain(`${sessionCookieName()}=token-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${config().auth.sessionTtlSeconds}`);
  });

  it("is SameSite=Lax rather than Strict, so an invite link keeps the session", () => {
    // Strict drops the cookie on a cross-site top-level GET, which is exactly
    // what clicking an invite link from Slack or a mail client is.
    expect(sessionCookie("t")).toContain("SameSite=Lax");
    expect(sessionCookie("t")).not.toContain("SameSite=Strict");
    expect(clearedSessionCookie()).toContain("SameSite=Lax");
  });

  it("omits Secure outside production, where localhost is http", () => {
    expect(config().isProduction).toBe(false);
    expect(sessionCookie("t")).not.toContain("Secure");
  });

  it("clears with Max-Age=0 rather than a past date", () => {
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });
});

describe("reading a cookie off a request", () => {
  it("finds the session among others, and is not fooled by a prefix", () => {
    const name = sessionCookieName();
    const request = new Request("https://example.com", {
      headers: { cookie: `theme=dark; ${name}_other=nope; ${name}=wanted; x=1` },
    });
    expect(sessionTokenFromRequest(request)).toBe("wanted");
  });

  it("returns null when there is no cookie header at all", () => {
    expect(readCookie(null, "anything")).toBeNull();
    expect(sessionTokenFromRequest(new Request("https://example.com"))).toBeNull();
  });
});
