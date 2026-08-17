// @vitest-environment node

/**
 * `node`, not jsdom. `jose` resolves to its webapi build under jsdom and then
 * finds a `crypto` global that jsdom implements only partially; the symptom is
 * a signature failure inside `jwtVerify`, which reads as a bug in this file.
 *
 * These suites run against a real PGlite instance for the same reason the
 * repository suites do: the interesting half of a session is the row, and a
 * mocked database cannot fail to find a row that was deleted.
 */

import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestUser,
  setupTestDatabase,
} from "@/adapters/repositories/__tests__/harness";
import { config, resetConfigForTests } from "@/config/env";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearedSessionCookie,
  createSession,
  deleteExpiredSessions,
  readCookie,
  resolveSession,
  revokeSession,
  revokeSessionByToken,
  revokeSessionsForUser,
  sessionCookie,
  sessionTokenFromRequest,
} from "../session";

const t = setupTestDatabase();

function signingKey(): Uint8Array {
  return new TextEncoder().encode(config().env.AUTH_SECRET);
}

/**
 * A token this application would accept the signature of, with whatever claims
 * the test wants.
 *
 * Needed because several of the properties worth checking are about what
 * happens when the *signature is valid and something else is wrong* — an `exp`
 * in the past, a `sub` naming a different user. Producing those through
 * `createSession` is impossible by construction, which is the point.
 */
async function signAs(claims: {
  jti: string;
  sub: string;
  expiresInSeconds: number;
  key?: Uint8Array;
}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + claims.expiresInSeconds,
    )
    .sign(claims.key ?? signingKey());
}

describe("createSession", () => {
  it("writes a row and returns a token that resolves back to it", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    const rows = await t.db.query<{ id: string; user_id: string }>(
      "select id, user_id from sessions",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(issued.sessionId);
    expect(rows[0]?.user_id).toBe(user.id);

    const resolved = await resolveSession(issued.token, { db: t.db });
    expect(resolved).toEqual({
      sessionId: issued.sessionId,
      userId: user.id,
      expiresAt: expect.any(Date),
    });
  });

  it("never lets the token outlive its row", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    const rows = await t.db.query<{ expires_at: Date | string }>(
      "select expires_at from sessions where id = $1",
      [issued.sessionId],
    );
    const rowExpiry = new Date(rows[0]?.expires_at ?? 0).getTime();
    expect(rowExpiry).toBe(issued.expiresAt.getTime());

    // `exp` is a NumericDate — whole seconds — so it is the row's expiry
    // *floored*. That direction matters: a token that rounded up would be
    // accepted by `jwtVerify` for up to a second after its row had gone, and
    // the row is the revocation record.
    const payload = JSON.parse(
      Buffer.from(issued.token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp: number };
    expect(payload.exp * 1000).toBeLessThanOrEqual(rowExpiry);
    expect(rowExpiry - payload.exp * 1000).toBeLessThan(1000);

    expect(issued.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + (SESSION_TTL_SECONDS - 60) * 1000,
    );
  });

  it("issues two distinct tokens for two sessions of one user", async () => {
    const user = await createTestUser(t.db);
    const a = await createSession(user.id, { db: t.db });
    const b = await createSession(user.id, { db: t.db });

    expect(a.token).not.toBe(b.token);
    expect(a.sessionId).not.toBe(b.sessionId);
    await expect(resolveSession(a.token, { db: t.db })).resolves.not.toBeNull();
    await expect(resolveSession(b.token, { db: t.db })).resolves.not.toBeNull();
  });
});

describe("resolveSession", () => {
  it("returns null for no token at all", async () => {
    await expect(resolveSession(null, { db: t.db })).resolves.toBeNull();
    await expect(resolveSession(undefined, { db: t.db })).resolves.toBeNull();
    await expect(resolveSession("", { db: t.db })).resolves.toBeNull();
    await expect(resolveSession("not.a.jwt", { db: t.db })).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const user = await createTestUser(t.db);
    const { token } = await createSession(user.id, { db: t.db });

    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    decoded["sub"] = "usr_someone_else";
    const forged = [
      header,
      Buffer.from(JSON.stringify(decoded)).toString("base64url"),
      signature,
    ].join(".");

    expect(forged).not.toBe(token);
    await expect(resolveSession(forged, { db: t.db })).resolves.toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const user = await createTestUser(t.db);
    const { sessionId } = await createSession(user.id, { db: t.db });

    const forged = await signAs({
      jti: sessionId,
      sub: user.id,
      expiresInSeconds: 3600,
      key: new TextEncoder().encode("a".repeat(64)),
    });

    await expect(resolveSession(forged, { db: t.db })).resolves.toBeNull();
  });

  /**
   * The property that justifies keeping a row at all: a perfectly valid,
   * unexpired, correctly signed token stops working the moment its row is gone.
   */
  it("rejects a valid signature over a revoked row", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });
    await expect(
      resolveSession(issued.token, { db: t.db }),
    ).resolves.not.toBeNull();

    await expect(revokeSession(issued.sessionId, { db: t.db })).resolves.toBe(
      true,
    );

    await expect(resolveSession(issued.token, { db: t.db })).resolves.toBeNull();
  });

  it("rejects a token whose row has expired, even while the token has not", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    // Only the row is aged. The JWT still has 30 days of `exp` on it, so this
    // fails on the database's expiry check or it does not fail at all.
    await t.db.execute(
      "update sessions set expires_at = now() - interval '1 second' where id = $1",
      [issued.sessionId],
    );

    await expect(resolveSession(issued.token, { db: t.db })).resolves.toBeNull();
  });

  it("rejects an expired token whose row is still live", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    const stale = await signAs({
      jti: issued.sessionId,
      sub: user.id,
      expiresInSeconds: -60,
    });

    await expect(resolveSession(stale, { db: t.db })).resolves.toBeNull();
    // …and the row it names is genuinely still usable, so the rejection came
    // from the token rather than from the row having gone.
    await expect(
      resolveSession(issued.token, { db: t.db }),
    ).resolves.not.toBeNull();
  });

  it("rejects a token whose subject is not the row's owner", async () => {
    const owner = await createTestUser(t.db, { email: "owner@test.local" });
    const other = await createTestUser(t.db, { email: "other@test.local" });
    const issued = await createSession(owner.id, { db: t.db });

    const mismatched = await signAs({
      jti: issued.sessionId,
      sub: other.id,
      expiresInSeconds: 3600,
    });

    await expect(resolveSession(mismatched, { db: t.db })).resolves.toBeNull();
  });
});

describe("revocation", () => {
  it("is idempotent", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    await expect(revokeSession(issued.sessionId, { db: t.db })).resolves.toBe(true);
    await expect(revokeSession(issued.sessionId, { db: t.db })).resolves.toBe(false);
  });

  it("signs out everywhere for one user without touching anybody else", async () => {
    const ada = await createTestUser(t.db, { email: "ada@test.local" });
    const grace = await createTestUser(t.db, { email: "grace@test.local" });

    const adaPhone = await createSession(ada.id, { db: t.db });
    const adaLaptop = await createSession(ada.id, { db: t.db });
    const graceLaptop = await createSession(grace.id, { db: t.db });

    await expect(revokeSessionsForUser(ada.id, { db: t.db })).resolves.toBe(2);

    await expect(resolveSession(adaPhone.token, { db: t.db })).resolves.toBeNull();
    await expect(resolveSession(adaLaptop.token, { db: t.db })).resolves.toBeNull();
    await expect(
      resolveSession(graceLaptop.token, { db: t.db }),
    ).resolves.not.toBeNull();
  });

  /**
   * A sign-out endpoint that trusted the `jti` it was handed would be a way to
   * log out any user whose session id had ever appeared in a log line.
   */
  it("will not revoke a session named by an unverifiable token", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    const forged = await signAs({
      jti: issued.sessionId,
      sub: user.id,
      expiresInSeconds: 3600,
      key: new TextEncoder().encode("b".repeat(64)),
    });

    await expect(revokeSessionByToken(forged, { db: t.db })).resolves.toBe(false);
    await expect(
      resolveSession(issued.token, { db: t.db }),
    ).resolves.not.toBeNull();
  });

  it("revokes the session a real token names", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    await expect(revokeSessionByToken(issued.token, { db: t.db })).resolves.toBe(
      true,
    );
    await expect(resolveSession(issued.token, { db: t.db })).resolves.toBeNull();
  });

  it("sweeps only the expired rows", async () => {
    const user = await createTestUser(t.db);
    const live = await createSession(user.id, { db: t.db });
    const dead = await createSession(user.id, { db: t.db });
    await t.db.execute(
      "update sessions set expires_at = now() - interval '1 day' where id = $1",
      [dead.sessionId],
    );

    await expect(deleteExpiredSessions({ db: t.db })).resolves.toBe(1);
    await expect(
      resolveSession(live.token, { db: t.db }),
    ).resolves.not.toBeNull();
  });
});

/**
 * `NODE_ENV` is declared read-only on `ProcessEnv`, which is a sound rule for
 * application code and an obstacle here — whether `Secure` is set is a decision
 * `config()` makes from exactly this variable, so the only way to test both
 * branches is to move it. Assigned through the object rather than the property
 * so the cast is one narrow line rather than an `as never` at each use.
 */
function setNodeEnv(value: "test" | "production"): void {
  Object.assign(process.env, { NODE_ENV: value });
}

describe("the cookie", () => {
  afterEach(() => {
    delete process.env["E2E_ALLOW_PGLITE_PRODUCTION_BUILD"];
    delete process.env["AUTH_SECRET"];
    setNodeEnv("test");
    resetConfigForTests();
  });

  it("is httpOnly, Lax, and scoped to the whole site", () => {
    const cookie = sessionCookie("a.b.c");
    expect(cookie).toContain(`${SESSION_COOKIE}=a.b.c`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
  });

  it("omits Secure in development, because localhost is http", () => {
    expect(sessionCookie("a.b.c")).not.toContain("Secure");
  });

  it("sets Secure in production", () => {
    setNodeEnv("production");
    // The two flags `config()` needs to accept a production run backed by
    // PGlite and the filesystem, which is what the e2e build does.
    process.env["E2E_ALLOW_PGLITE_PRODUCTION_BUILD"] = "true";
    process.env["AUTH_SECRET"] = "x".repeat(48);
    resetConfigForTests();

    expect(sessionCookie("a.b.c")).toContain("Secure");
  });

  it("clears with Max-Age=0 rather than a past date", () => {
    const cookie = clearedSessionCookie();
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).not.toContain("Expires");
  });
});

describe("reading the cookie back", () => {
  it("finds the session among other cookies", () => {
    const header = `theme=dark; ${SESSION_COOKIE}=a.b.c; consent=1`;
    expect(readCookie(header, SESSION_COOKIE)).toBe("a.b.c");
    expect(readCookie(header, "theme")).toBe("dark");
    expect(readCookie(header, "absent")).toBeNull();
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
  });

  it("does not match a cookie whose name merely ends with the same text", () => {
    expect(readCookie(`not_${SESSION_COOKIE}=nope`, SESSION_COOKIE)).toBeNull();
  });

  it("pulls the token off a Request", () => {
    const request = new Request("https://example.test/watch", {
      headers: { cookie: `${SESSION_COOKIE}=a.b.c` },
    });
    expect(sessionTokenFromRequest(request)).toBe("a.b.c");
    expect(
      sessionTokenFromRequest(new Request("https://example.test/watch")),
    ).toBeNull();
  });
});
