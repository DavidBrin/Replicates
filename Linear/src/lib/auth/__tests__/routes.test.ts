// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, setDbForTests } from "@/adapters/db";
import { POST as signin } from "@/app/api/auth/signin/route";
import { POST as signout } from "@/app/api/auth/signout/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as acceptInviteRoute } from "@/app/api/invites/accept/route";

import { createInvite } from "../invites";
import { resetAuthRateLimitForTests } from "../rate-limit";
import { sessionCookieName } from "../session";

/**
 * The four public auth endpoints, called as the plain functions they are.
 *
 * No HTTP server and no mocking of the database: the handlers take a `Request`
 * and return a `Response`, so a test can hand them one. What is being checked
 * is the part that only exists at this layer — status codes, cookies, and the
 * promise that a failed sign-in says the same thing whatever went wrong.
 */

const WORKSPACE = "wsp_routes";
const TEAM = "tem_routes";
const OWNER = "usr_routes_owner";

let dispose: () => Promise<void>;
let db: PgliteDatabase;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  dispose = setDbForTests(db);
}, 60_000);

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  // The limiter's budgets live on `globalThis`, so they survive between tests
  // in this file the way they survive between requests in a process. Without
  // this the suite starts asserting on the limiter instead of on the route —
  // sign-up's per-email budget is five, and the fixtures here spend more than
  // that before the interesting assertion runs.
  resetAuthRateLimitForTests();

  for (const table of [
    "invites",
    "team_members",
    "teams",
    "workspace_members",
    "workspaces",
    "sessions",
    "users",
  ]) {
    await db.execute(`delete from ${table}`);
  }
  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Routes', 'routes')",
    [WORKSPACE],
  );
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name)
     values ($1, 'owner@example.com', 'x', 'Owner', 'owner')`,
    [OWNER],
  );
  await db.execute(
    "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
    [WORKSPACE, OWNER],
  );
  await db.execute(
    "insert into teams (id, workspace_id, name, key) values ($1, $2, 'Routes', 'RTE')",
    [TEAM, WORKSPACE],
  );
});

function post(url: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = cookie;
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** The session cookie as a browser would send it back. */
function sessionCookieFrom(response: Response): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    if (pair?.startsWith(`${sessionCookieName()}=`)) return pair;
  }
  return null;
}

const CREDENTIALS = {
  email: "newcomer@example.com",
  password: "a sufficiently long password",
  name: "Newcomer",
};

/* ================================================================ signup = */

describe("POST /api/auth/signup", () => {
  it("creates the account and signs them in", async () => {
    const response = await signup(post("/api/auth/signup", CREDENTIALS));

    expect(response.status).toBe(201);
    const cookie = sessionCookieFrom(response);
    expect(cookie).not.toBeNull();

    const rows = await db.query<{ password_hash: string; display_name: string }>(
      "select password_hash, display_name from users where lower(email) = 'newcomer@example.com'",
    );
    expect(rows).toHaveLength(1);
    // The password is hashed, and the hash is not the password.
    expect(rows[0]?.password_hash).toContain("scrypt:");
    expect(rows[0]?.password_hash).not.toContain(CREDENTIALS.password);
    expect(rows[0]?.display_name).toBe("newcomer");
  });

  it("rejects a password nobody should be allowed to choose", async () => {
    const response = await signup(
      post("/api/auth/signup", { ...CREDENTIALS, password: "short" }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a duplicate address, case-insensitively", async () => {
    await signup(post("/api/auth/signup", CREDENTIALS));
    const response = await signup(
      post("/api/auth/signup", { ...CREDENTIALS, email: "NewComer@Example.com" }),
    );
    expect(response.status).toBe(409);
  });

  it("redeems an invite token carried through the form", async () => {
    const invite = await createInvite(
      { workspaceId: WORKSPACE, actorId: OWNER, role: "member", teamIds: [TEAM] },
      db,
    );
    if (!invite.ok) throw new Error("setup failed");

    const response = await signup(
      post("/api/auth/signup", { ...CREDENTIALS, inviteToken: invite.value.token }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspace: { role: string } | null };
    expect(body.workspace?.role).toBe("member");

    const teams = await db.query("select 1 from team_members where team_id = $1", [
      TEAM,
    ]);
    expect(teams).toHaveLength(1);
  });

  it("redeems an invite token left in the pending cookie by the invite page", async () => {
    const invite = await createInvite(
      { workspaceId: WORKSPACE, actorId: OWNER, role: "guest" },
      db,
    );
    if (!invite.ok) throw new Error("setup failed");

    const response = await signup(
      post(
        "/api/auth/signup",
        CREDENTIALS,
        `pending_invite=${invite.value.token}`,
      ),
    );

    const body = (await response.json()) as { workspace: { role: string } | null };
    expect(body.workspace?.role).toBe("guest");
    // …and the cookie is cleared, so the dead link is not retried.
    expect(
      response.headers.getSetCookie().some((header) => header.includes("pending_invite=;")),
    ).toBe(true);
  });

  it("still creates the account when the invitation turns out to be dead", async () => {
    const response = await signup(
      post("/api/auth/signup", { ...CREDENTIALS, inviteToken: "x".repeat(43) }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { inviteError?: string };
    expect(body.inviteError).toBeTypeOf("string");
    expect(sessionCookieFrom(response)).not.toBeNull();
  });
});

/* ================================================================ signin = */

describe("POST /api/auth/signin", () => {
  beforeEach(async () => {
    await signup(post("/api/auth/signup", CREDENTIALS));
  });

  it("signs a real user in", async () => {
    const response = await signin(
      post("/api/auth/signin", {
        email: CREDENTIALS.email,
        password: CREDENTIALS.password,
      }),
    );

    expect(response.status).toBe(200);
    expect(sessionCookieFrom(response)).not.toBeNull();
  });

  it("says exactly the same thing for a wrong password and an unknown address", async () => {
    const wrongPassword = await signin(
      post("/api/auth/signin", {
        email: CREDENTIALS.email,
        password: "definitely not the password",
      }),
    );
    const unknownEmail = await signin(
      post("/api/auth/signin", {
        email: "nobody@example.com",
        password: CREDENTIALS.password,
      }),
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Byte-for-byte identical: the body is the whole answer, and any difference
    // in it makes the endpoint a membership oracle.
    expect(await wrongPassword.text()).toBe(await unknownEmail.text());
    expect(wrongPassword.headers.getSetCookie()).toStrictEqual([]);
  });

  it("gives a deactivated account the same refusal", async () => {
    await db.execute("update users set active = false where lower(email) = $1", [
      CREDENTIALS.email,
    ]);
    const response = await signin(
      post("/api/auth/signin", {
        email: CREDENTIALS.email,
        password: CREDENTIALS.password,
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: "Incorrect email or password.",
    });
  });

  it("answers a malformed body with the same refusal, not a validation dump", async () => {
    const response = await signin(post("/api/auth/signin", { email: "nope" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: "Incorrect email or password.",
    });
  });
});

/* =============================================================== signout = */

describe("POST /api/auth/signout", () => {
  it("revokes the row as well as clearing the cookie", async () => {
    const signedUp = await signup(post("/api/auth/signup", CREDENTIALS));
    const cookie = sessionCookieFrom(signedUp);
    expect(cookie).not.toBeNull();

    const response = await signout(post("/api/auth/signout", {}, cookie ?? ""));

    expect(response.status).toBe(200);
    expect(
      response.headers.getSetCookie().some((header) => header.includes("Max-Age=0")),
    ).toBe(true);
    const rows = await db.query<{ revoked: boolean }>(
      "select revoked_at is not null as revoked from sessions",
    );
    expect(rows[0]?.revoked).toBe(true);
  });

  it("is a 200 even with no session, so a replay learns nothing", async () => {
    const response = await signout(post("/api/auth/signout", {}));
    expect(response.status).toBe(200);
  });
});

/* ========================================================= invite accept = */

describe("POST /api/invites/accept", () => {
  async function signedInCookie(): Promise<string> {
    const response = await signup(post("/api/auth/signup", CREDENTIALS));
    const cookie = sessionCookieFrom(response);
    if (!cookie) throw new Error("no session cookie");
    return cookie;
  }

  it("needs a session", async () => {
    const response = await acceptInviteRoute(
      post("/api/invites/accept", { token: "x".repeat(43) }),
    );
    expect(response.status).toBe(401);
  });

  it("joins the workspace", async () => {
    const cookie = await signedInCookie();
    const invite = await createInvite(
      { workspaceId: WORKSPACE, actorId: OWNER, role: "member", teamIds: [TEAM] },
      db,
    );
    if (!invite.ok) throw new Error("setup failed");

    const response = await acceptInviteRoute(
      post("/api/invites/accept", { token: invite.value.token }, cookie),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspaceId: WORKSPACE,
      role: "member",
      teamIds: [TEAM],
      alreadyMember: false,
    });
  });

  it("is 410 on a second use and 404 on a token that never existed", async () => {
    const cookie = await signedInCookie();
    const invite = await createInvite(
      { workspaceId: WORKSPACE, actorId: OWNER, role: "member" },
      db,
    );
    if (!invite.ok) throw new Error("setup failed");

    await acceptInviteRoute(
      post("/api/invites/accept", { token: invite.value.token }, cookie),
    );
    const reused = await acceptInviteRoute(
      post("/api/invites/accept", { token: invite.value.token }, cookie),
    );
    const unknown = await acceptInviteRoute(
      post("/api/invites/accept", { token: "y".repeat(43) }, cookie),
    );

    expect(reused.status).toBe(410);
    // A token that matches nothing is indistinguishable from a deleted one.
    expect(unknown.status).toBe(404);
  });
});
