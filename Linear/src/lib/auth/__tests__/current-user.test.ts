// @vitest-environment node
import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, type SqlDatabase } from "@/adapters/db";
import { can } from "@/domain/policy";

import { createSession, sessionCookieName } from "../session";

/**
 * `next/headers` is mocked rather than imported: `cookies()` needs a request
 * scope that only Next can create, and the point of splitting
 * {@link userFromRequest} out was that everything below the cookie is testable
 * without one.
 */
const cookieJar = { value: null as string | null };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.value && name ? { name, value: cookieJar.value } : undefined,
  }),
}));

const { actorFor, currentUser, requireUser, userFromRequest, UnauthenticatedError } =
  await import("../current-user");

const WORKSPACE = "wsp_current";
const TEAM = "tem_current";
const PROJECT = "prj_current";
const USER = "usr_current";

let db: SqlDatabase;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  for (const table of [
    "project_members",
    "project_teams",
    "projects",
    "team_members",
    "teams",
    "workspace_members",
    "workspaces",
    "sessions",
    "users",
  ]) {
    await db.execute(`delete from ${table}`);
  }
  cookieJar.value = null;

  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Current', 'current')",
    [WORKSPACE],
  );
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name, avatar_color)
     values ($1, 'current@example.com', 'x', 'Current User', 'current', '#abcdef')`,
    [USER],
  );
  await db.execute(
    "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')",
    [WORKSPACE, USER],
  );
  await db.execute(
    "insert into teams (id, workspace_id, name, key) values ($1, $2, 'Team', 'TEA')",
    [TEAM, WORKSPACE],
  );
  await db.execute(
    `insert into projects (id, workspace_id, name, slug_id, sort_order)
     values ($1, $2, 'Project', 'project', 'a0')`,
    [PROJECT, WORKSPACE],
  );
});

function requestWith(token: string): Request {
  return new Request("http://localhost/api/anything", {
    headers: { cookie: `${sessionCookieName()}=${token}` },
  });
}

describe("userFromRequest", () => {
  it("resolves the cookie to a user", async () => {
    const session = await createSession(USER, { db });

    const resolved = await userFromRequest(requestWith(session.token), { db });

    expect(resolved?.user).toStrictEqual({
      id: USER,
      email: "current@example.com",
      name: "Current User",
      displayName: "current",
      avatarUrl: null,
      avatarColor: "#abcdef",
    });
  });

  it("reads a deactivated account as signed out, not as a suspended member", async () => {
    const session = await createSession(USER, { db });
    await db.execute("update users set active = false where id = $1", [USER]);

    expect(await userFromRequest(requestWith(session.token), { db })).toBeNull();
  });

  it("returns null for a request with no cookie", async () => {
    const request = new Request("http://localhost/api/anything");
    expect(await userFromRequest(request, { db })).toBeNull();
  });

  it("renews by default, because a route handler can send the cookie back", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set expires_at = now() + interval '1 minute' where id = $1",
      [session.sessionId],
    );

    const resolved = await userFromRequest(requestWith(session.token), { db });
    expect(resolved?.renewedToken).toBeTypeOf("string");
  });
});

describe("currentUser", () => {
  it("reads the cookie jar during a render", async () => {
    const session = await createSession(USER, { db });
    cookieJar.value = session.token;

    const user = await currentUser({ db });
    expect(user?.id).toBe(USER);
  });

  it("is null when there is no cookie", async () => {
    expect(await currentUser({ db })).toBeNull();
  });

  it("never renews, because a render cannot deliver the new cookie", async () => {
    const session = await createSession(USER, { db });
    await db.execute(
      "update sessions set expires_at = now() + interval '1 minute' where id = $1",
      [session.sessionId],
    );
    cookieJar.value = session.token;

    await currentUser({ db });

    // The token in the browser must still work after a render read it.
    const rows = await db.query<{ same: boolean }>(
      "select token_hash = $2 as same from sessions where id = $1",
      [session.sessionId, hashOf(session.token)],
    );
    expect(rows[0]?.same).toBe(true);
  });

  it("throws from requireUser when signed out", async () => {
    await expect(requireUser({ db })).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("actorFor", () => {
  it("assembles all three axes into something can() accepts", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, $2, 'admin')",
      [TEAM, USER],
    );
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, USER],
    );

    const actor = await actorFor(WORKSPACE, USER, { db });

    expect(actor.workspaceRole).toBe("member");
    expect(can(actor, "team.update", { kind: "team", team: { id: TEAM, private: true } })).toBe(
      true,
    );
    expect(
      can(actor, "project.update", {
        kind: "project",
        project: { id: PROJECT, allTeamsPublic: false },
      }),
    ).toBe(true);
  });

  it("returns an anonymous actor rather than null, so can() is still called", async () => {
    const actor = await actorFor(WORKSPACE, null, { db });
    expect(actor.workspaceRole).toBeNull();
    expect(can(actor, "workspace.view", { kind: "workspace" })).toBe(false);
  });

  it("gives a non-member a null role", async () => {
    const actor = await actorFor(WORKSPACE, "usr_stranger", { db });
    expect(actor.workspaceRole).toBeNull();
  });
});

/**
 * Mirrors `session.ts`'s storage format. Written out here rather than exported
 * from there because nothing in the application has any business hashing a
 * session token, and a helper invites one.
 */
function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
