// @vitest-environment node

/**
 * `node`, not jsdom, for the same reason `session.test.ts` says: `jose`
 * resolves to its webapi build under jsdom and then finds a partially
 * implemented `crypto` global, and the symptom is a signature failure that
 * reads as a bug in the module under test.
 *
 * The predicates below are pure and could have been tested without a database.
 * They are tested beside a real one anyway, because the interesting half of
 * `currentSession` is that a revoked session stops resolving — and a mocked
 * database cannot fail to find a row that was deleted.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestUser,
  setupTestDatabase,
} from "@/adapters/repositories/__tests__/harness";
import { resetConfigForTests } from "@/config/env";
import type { VisibleResource } from "../guard";
import {
  PrivateMediaNotEnforceableError,
  assertPrivateMediaIsEnforceable,
  currentSession,
  currentViewerId,
  mayViewMedia,
  mayWriteMedia,
  needsViewerIdentity,
} from "../guard";
import { SESSION_COOKIE, createSession, revokeSession } from "../session";

const t = setupTestDatabase();

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  resetConfigForTests();
});

/** A request carrying whatever `Cookie` header the test wants, or none. */
function requestWith(cookie?: string): Request {
  return new Request("http://localhost/api/media/videos/v1/master.m3u8", {
    headers: cookie === undefined ? {} : { cookie },
  });
}

/* ============================================================= identity == */

describe("currentSession", () => {
  it("is null when the request carries no cookie at all", async () => {
    expect(await currentSession(requestWith(), { db: t.db })).toBeNull();
  });

  it("is null for a cookie that is not one of ours", async () => {
    const session = await currentSession(
      requestWith("some_other_app=abc; unrelated=1"),
      { db: t.db },
    );
    expect(session).toBeNull();
  });

  it("is null for a token that does not verify", async () => {
    const session = await currentSession(
      requestWith(`${SESSION_COOKIE}=not.a.jwt`),
      { db: t.db },
    );
    expect(session).toBeNull();
  });

  it("resolves the session a valid cookie names", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });

    const session = await currentSession(
      requestWith(`${SESSION_COOKIE}=${issued.token}`),
      { db: t.db },
    );
    expect(session?.userId).toBe(user.id);
    expect(session?.sessionId).toBe(issued.sessionId);
  });

  /**
   * The whole reason a session is a row as well as a signature. The token is
   * still perfectly valid here — only the row is gone.
   */
  it("stops resolving once the session row is revoked", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });
    const request = requestWith(`${SESSION_COOKIE}=${issued.token}`);

    expect(await currentSession(request, { db: t.db })).not.toBeNull();
    await revokeSession(issued.sessionId, { db: t.db });
    expect(await currentSession(request, { db: t.db })).toBeNull();
  });

  /**
   * Session state is read, never written, on this path. The TTL is a fixed
   * thirty days from sign-in and there is no sliding expiry, so there is no
   * renewed cookie for a route handler to forward — which is worth asserting
   * because "resolve the session" in most codebases also means "and re-issue
   * it", and a handler written against that assumption would drop a
   * `Set-Cookie` this returns and never notice.
   */
  it("hands back nothing a route handler would have to set", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });
    const session = await currentSession(
      requestWith(`${SESSION_COOKIE}=${issued.token}`),
      { db: t.db },
    );
    expect(Object.keys(session ?? {}).sort()).toEqual([
      "expiresAt",
      "sessionId",
      "userId",
    ]);
  });
});

describe("currentViewerId", () => {
  it("is null when nobody is signed in", async () => {
    expect(await currentViewerId(requestWith(), { db: t.db })).toBeNull();
  });

  it("is the signed-in user's id", async () => {
    const user = await createTestUser(t.db);
    const issued = await createSession(user.id, { db: t.db });
    const viewer = await currentViewerId(
      requestWith(`${SESSION_COOKIE}=${issued.token}`),
      { db: t.db },
    );
    expect(viewer).toBe(user.id);
  });
});

/* ============================================================ viewing == */

const OWNER = "usr_owner";
const STRANGER = "usr_stranger";

describe("mayViewMedia", () => {
  it("serves a public video to a signed-out caller", () => {
    expect(
      mayViewMedia({ ownerId: OWNER, visibility: "public" }, null),
    ).toBe(true);
  });

  /**
   * Unlisted behaves exactly like public *at this layer*, and that is the
   * distinction the whole design turns on rather than an inconsistency. See
   * the note on the function itself.
   */
  it("serves an unlisted video to a signed-out caller", () => {
    expect(
      mayViewMedia({ ownerId: OWNER, visibility: "unlisted" }, null),
    ).toBe(true);
  });

  it("refuses a private video to a signed-out caller", () => {
    expect(
      mayViewMedia({ ownerId: OWNER, visibility: "private" }, null),
    ).toBe(false);
  });

  it("serves a private video to the owning channel's owner", () => {
    expect(
      mayViewMedia({ ownerId: OWNER, visibility: "private" }, OWNER),
    ).toBe(true);
  });

  it("refuses a private video to a signed-in non-owner", () => {
    expect(
      mayViewMedia({ ownerId: OWNER, visibility: "private" }, STRANGER),
    ).toBe(false);
  });
});

describe("needsViewerIdentity", () => {
  it.each([
    ["public", false],
    ["unlisted", false],
    ["private", true],
  ] as const)("is %s → %s", (visibility, expected) => {
    expect(needsViewerIdentity({ ownerId: OWNER, visibility })).toBe(expected);
  });
});

/* ============================================================= writing == */

describe("mayWriteMedia", () => {
  it("refuses a signed-out caller", () => {
    expect(mayWriteMedia({ ownerId: OWNER }, null)).toBe(false);
  });

  it("refuses a signed-in caller who does not own the resource", () => {
    expect(mayWriteMedia({ ownerId: OWNER }, STRANGER)).toBe(false);
  });

  it("permits the owner", () => {
    expect(mayWriteMedia({ ownerId: OWNER }, OWNER)).toBe(true);
  });

  /**
   * Visibility is not part of the write rule and must not become part of it:
   * a public video's segments are no more writable by a stranger than a
   * private one's. The parameter type already says so — `OwnedResource` has no
   * `visibility` to read, and passing a literal that carries one is a compile
   * error — so these go through a variable to make the runtime claim as well.
   */
  it("does not consult visibility", () => {
    const openly: VisibleResource = { ownerId: OWNER, visibility: "public" };
    const secretly: VisibleResource = { ownerId: OWNER, visibility: "private" };
    expect(mayWriteMedia(openly, STRANGER)).toBe(false);
    expect(mayWriteMedia(secretly, OWNER)).toBe(true);
  });
});

/* ================================================ the R2 public-URL case == */

/**
 * One function with the public domain as a parameter, rather than two that
 * differ by a `delete`: the whole point of these two configurations is that
 * they are identical apart from that one variable, and building them
 * separately would let them drift into differing in some other way too.
 */
function useR2(publicBaseUrl?: string): void {
  process.env = {
    ...savedEnv,
    BLOB_DRIVER: "r2",
    R2_ACCOUNT_ID: "acct123",
    R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
    R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    R2_BUCKET: "media",
    ...(publicBaseUrl === undefined ? {} : { R2_PUBLIC_BASE_URL: publicBaseUrl }),
  };
  resetConfigForTests();
}

function useR2WithPublicDomain(): void {
  useR2("https://media.example.com");
}

function useR2WithoutPublicDomain(): void {
  useR2();
}

describe("assertPrivateMediaIsEnforceable", () => {
  beforeEach(() => {
    process.env = { ...savedEnv };
    resetConfigForTests();
  });

  it("is satisfied by the filesystem driver", () => {
    expect(() => assertPrivateMediaIsEnforceable()).not.toThrow();
  });

  it("is satisfied by R2 with no public domain in front of it", () => {
    useR2WithoutPublicDomain();
    expect(() => assertPrivateMediaIsEnforceable()).not.toThrow();
  });

  /**
   * The configuration this exists for. Past a public base URL the bytes are
   * served from a domain this process is not in the path of, so the check the
   * media route performs is decorative — and a decorative check is worse than
   * an absent one, because it produces a false belief.
   */
  it("refuses R2 behind a public domain", () => {
    useR2WithPublicDomain();
    expect(() => assertPrivateMediaIsEnforceable()).toThrow(
      PrivateMediaNotEnforceableError,
    );
  });

  it("names both settings so the fix is obvious from the log", () => {
    useR2WithPublicDomain();
    let message = "";
    try {
      assertPrivateMediaIsEnforceable();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("R2_PUBLIC_BASE_URL");
    expect(message).toContain("private");
  });
});

describe("mayViewMedia under a public R2 domain", () => {
  beforeEach(() => {
    process.env = { ...savedEnv };
    resetConfigForTests();
  });

  /**
   * A predicate whose answer cannot be enforced does not return `false`; it
   * throws. Returning `false` would hide the video from its own owner while
   * the world went on reading it from the bucket, which is the worst of both
   * outcomes.
   */
  it("throws rather than answering for a private video", () => {
    useR2WithPublicDomain();
    expect(() =>
      mayViewMedia({ ownerId: OWNER, visibility: "private" }, OWNER),
    ).toThrow(PrivateMediaNotEnforceableError);
  });

  /**
   * Public and unlisted are unaffected, and that is the point of the
   * distinction: an unlisted video is a capability URL by design, so a public
   * bucket serves it exactly as intended. Only `private` claims something the
   * bucket cannot honour.
   */
  it.each(["public", "unlisted"] as const)(
    "still serves a %s video",
    (visibility) => {
      useR2WithPublicDomain();
      expect(mayViewMedia({ ownerId: OWNER, visibility }, null)).toBe(true);
    },
  );

  it("does not interfere with the write rule", () => {
    useR2WithPublicDomain();
    expect(mayWriteMedia({ ownerId: OWNER }, OWNER)).toBe(true);
  });
});
