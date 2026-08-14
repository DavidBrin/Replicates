// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, setDbForTests } from "@/adapters/db";
import { POST as aiRoute } from "@/app/api/ai/route";
import {
  DELETE as revokeInviteRoute,
  POST as createInviteRoute,
} from "@/app/api/invites/route";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import {
  DELETE as deleteProjectRoute,
  PATCH as patchProjectRoute,
  POST as projectCommandRoute,
} from "@/app/api/projects/[id]/route";
import {
  DELETE as removeProjectMemberRoute,
  PATCH as changeProjectMemberRoute,
  POST as addProjectMemberRoute,
} from "@/app/api/projects/[id]/members/route";
import { POST as createTeamRoute } from "@/app/api/teams/route";
import {
  DELETE as deleteTeamRoute,
  PATCH as patchTeamRoute,
  POST as teamCommandRoute,
} from "@/app/api/teams/[id]/route";
import {
  DELETE as removeTeamMemberRoute,
  PATCH as changeTeamMemberRoute,
  POST as addTeamMemberRoute,
} from "@/app/api/teams/[id]/members/route";
import {
  DELETE as removeWorkspaceMemberRoute,
  GET as listWorkspaceMembersRoute,
  PATCH as changeWorkspaceMemberRoute,
} from "@/app/api/workspaces/[id]/members/route";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * Every route handler in this slice, asked the question the whole slice exists
 * to answer: **does it refuse the wrong person?**
 *
 * Handlers are plain functions from `Request` to `Response`, so there is no HTTP
 * server here and no mocking of the database — a real PGlite instance with the
 * real schema, real session cookies, and the real membership service running
 * its real transactions. What is under test is the layer only this file covers:
 * the status code, and the fact that a `can()` call happened at all.
 *
 * ## Why the assertions are on status codes and rows, not on calls
 *
 * A test that asserts `can` was called with certain arguments passes against a
 * handler that ignores the answer. Each case below drives the endpoint as the
 * unauthorised actor and then checks that **the database did not change** —
 * which is the only formulation a broken check cannot satisfy.
 *
 * ## The 404-vs-403 split is deliberate and is asserted
 *
 * A guest who cannot see a project gets 404 and not 403, because a 403 confirms
 * that the id resolves to something (`SPEC.md` §4: nothing outside a guest's
 * memberships is *discoverable*). Both are ≥ 400, which is what the e2e suite
 * checks; the distinction is checked here, where it can be stated precisely.
 */

const WORKSPACE = "wsp_slice_members";
const OTHER_WORKSPACE = "wsp_slice_other";
const TEAM = "tem_slice_eng";
const PRIVATE_TEAM = "tem_slice_des";
const PROJECT = "prj_slice_site";
const FOREIGN_PROJECT = "prj_slice_foreign";

const OWNER = "usr_slice_owner";
const ADMIN = "usr_slice_admin";
const MEMBER = "usr_slice_member";
const GUEST = "usr_slice_guest";
const OUTSIDER = "usr_slice_outsider";

let db: PgliteDatabase;
let dispose: () => Promise<void>;
const cookies = new Map<string, string>();

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  dispose = setDbForTests(db);
}, 60_000);

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  for (const table of [
    "project_members",
    "project_teams",
    "project_milestones",
    "project_updates",
    "projects",
    "issues",
    "workflow_states",
    "labels",
    "invites",
    "team_members",
    "teams",
    "workspace_members",
    "workspaces",
    "sessions",
    "users",
    "change_events",
  ]) {
    await db.execute(`delete from ${table}`);
  }
  cookies.clear();

  for (const [id, email, name] of [
    [OWNER, "owner@slice.test", "Owner"],
    [ADMIN, "admin@slice.test", "Admin"],
    [MEMBER, "member@slice.test", "Member"],
    [GUEST, "guest@slice.test", "Guest"],
    [OUTSIDER, "outsider@slice.test", "Outsider"],
  ] as const) {
    await db.execute(
      `insert into users (id, email, password_hash, name, display_name)
       values ($1, $2, 'x', $3, $4)`,
      [id, email, name, name.toLowerCase()],
    );
    const session = await createSession(id, { db });
    cookies.set(id, `${sessionCookieName()}=${session.token}`);
  }

  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Slice', 'slice')",
    [WORKSPACE],
  );
  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Other', 'other')",
    [OTHER_WORKSPACE],
  );

  for (const [user, role] of [
    [OWNER, "owner"],
    [ADMIN, "admin"],
    [MEMBER, "member"],
    [GUEST, "guest"],
  ] as const) {
    await db.execute(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)",
      [WORKSPACE, user, role],
    );
  }

  await db.execute(
    `insert into teams (id, workspace_id, name, key, private) values ($1, $2, 'Engineering', 'ENG', false)`,
    [TEAM, WORKSPACE],
  );
  await db.execute(
    `insert into teams (id, workspace_id, name, key, private) values ($1, $2, 'Design', 'DES', true)`,
    [PRIVATE_TEAM, WORKSPACE],
  );
  await db.execute(
    "insert into team_members (team_id, user_id, role) values ($1, $2, 'admin')",
    [TEAM, OWNER],
  );
  await db.execute(
    "insert into team_members (team_id, user_id, role) values ($1, $2, 'member')",
    [TEAM, MEMBER],
  );

  await db.execute(
    `insert into projects (id, workspace_id, name, slug_id, sort_order)
     values ($1, $2, 'Website redesign', 'website-redesign', 'a0')`,
    [PROJECT, WORKSPACE],
  );
  await db.execute(
    "insert into project_teams (project_id, team_id) values ($1, $2)",
    [PROJECT, TEAM],
  );
  // A project in a workspace nobody here belongs to. Cross-workspace isolation
  // is the failure that never shows up in a single-tenant fixture.
  await db.execute(
    `insert into projects (id, workspace_id, name, slug_id, sort_order)
     values ($1, $2, 'Elsewhere', 'elsewhere', 'a0')`,
    [FOREIGN_PROJECT, OTHER_WORKSPACE],
  );
  await db.execute(
    "insert into project_members (project_id, user_id, role) values ($1, $2, 'lead')",
    [PROJECT, OWNER],
  );
});

/* =============================================================== helpers = */

function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options: { as?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const cookie = options.as === undefined ? undefined : cookies.get(options.as);
  if (cookie) headers["cookie"] = cookie;
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function params<T extends Record<string, string>>(
  value: T,
): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

async function roleOf(userId: string): Promise<string | undefined> {
  const rows = await db.query<{ role: string }>(
    "select role from workspace_members where workspace_id = $1 and user_id = $2",
    [WORKSPACE, userId],
  );
  return rows[0]?.role;
}

async function projectMemberIds(): Promise<string[]> {
  const rows = await db.query<{ user_id: string }>(
    "select user_id from project_members where project_id = $1 order by user_id",
    [PROJECT],
  );
  return rows.map((row) => row.user_id);
}

async function projectName(): Promise<string | undefined> {
  const rows = await db.query<{ name: string }>(
    "select name from projects where id = $1",
    [PROJECT],
  );
  return rows[0]?.name;
}

/* ============================================ workspace member endpoints = */

describe("PATCH /api/workspaces/{id}/members", () => {
  it("refuses an anonymous caller with 401", async () => {
    const response = await changeWorkspaceMemberRoute(
      request("PATCH", `/api/workspaces/${WORKSPACE}/members`, {
        body: { userId: MEMBER, role: "admin" },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(401);
    expect(await roleOf(MEMBER)).toBe("member");
  });

  it("refuses a plain member with 403 and changes nothing", async () => {
    const response = await changeWorkspaceMemberRoute(
      request("PATCH", `/api/workspaces/${WORKSPACE}/members`, {
        as: MEMBER,
        body: { userId: GUEST, role: "admin" },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(403);
    expect(await roleOf(GUEST)).toBe("guest");
  });

  it("refuses somebody who is not in the workspace at all with 404", async () => {
    const response = await changeWorkspaceMemberRoute(
      request("PATCH", `/api/workspaces/${WORKSPACE}/members`, {
        as: OUTSIDER,
        body: { userId: MEMBER, role: "admin" },
      }),
      params({ id: WORKSPACE }),
    );
    // 404, not 403: an outsider must not learn that this workspace id resolves.
    expect(response.status).toBe(404);
    expect(await roleOf(MEMBER)).toBe("member");
  });

  it("lets an admin promote a member", async () => {
    const response = await changeWorkspaceMemberRoute(
      request("PATCH", `/api/workspaces/${WORKSPACE}/members`, {
        as: ADMIN,
        body: { userId: MEMBER, role: "admin" },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(200);
    expect(await roleOf(MEMBER)).toBe("admin");
  });

  it("refuses to demote the last owner, with the code the UI phrases", async () => {
    const response = await changeWorkspaceMemberRoute(
      request("PATCH", `/api/workspaces/${WORKSPACE}/members`, {
        as: OWNER,
        body: { userId: OWNER, role: "admin" },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "LAST_OWNER" });
    expect(await roleOf(OWNER)).toBe("owner");
  });

  it("allows the demotion once a second owner exists", async () => {
    await db.execute(
      "update workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2",
      [WORKSPACE, ADMIN],
    );
    const response = await changeWorkspaceMemberRoute(
      request("PATCH", `/api/workspaces/${WORKSPACE}/members`, {
        as: OWNER,
        body: { userId: OWNER, role: "admin" },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(200);
    expect(await roleOf(OWNER)).toBe("admin");
  });
});

describe("DELETE /api/workspaces/{id}/members", () => {
  it("refuses a plain member removing somebody else", async () => {
    const response = await removeWorkspaceMemberRoute(
      request("DELETE", `/api/workspaces/${WORKSPACE}/members`, {
        as: MEMBER,
        body: { userId: GUEST },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(403);
    expect(await roleOf(GUEST)).toBe("guest");
  });

  it("lets anybody leave, including a guest", async () => {
    const response = await removeWorkspaceMemberRoute(
      request("DELETE", `/api/workspaces/${WORKSPACE}/members`, {
        as: GUEST,
        body: { userId: GUEST },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(200);
    expect(await roleOf(GUEST)).toBeUndefined();
  });

  it("refuses the last owner's own departure", async () => {
    const response = await removeWorkspaceMemberRoute(
      request("DELETE", `/api/workspaces/${WORKSPACE}/members`, {
        as: OWNER,
        body: { userId: OWNER },
      }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "LAST_OWNER" });
    expect(await roleOf(OWNER)).toBe("owner");
  });
});

describe("GET /api/workspaces/{id}/members", () => {
  it("serves the roster to a plain member — the list is not the privilege", async () => {
    const response = await listWorkspaceMembersRoute(
      request("GET", `/api/workspaces/${WORKSPACE}/members`, { as: MEMBER }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { members: unknown[] };
    expect(body.members).toHaveLength(4);
  });

  it("refuses a guest", async () => {
    const response = await listWorkspaceMembersRoute(
      request("GET", `/api/workspaces/${WORKSPACE}/members`, { as: GUEST }),
      params({ id: WORKSPACE }),
    );
    expect(response.status).toBe(403);
  });
});

/* ============================================================== invites = */

describe("/api/invites", () => {
  it("refuses a plain member under the default adminsOnly policy", async () => {
    const response = await createInviteRoute(
      request("POST", "/api/invites", {
        as: MEMBER,
        body: { workspaceId: WORKSPACE, role: "member" },
      }),
    );
    expect(response.status).toBe(403);
    const rows = await db.query("select 1 from invites");
    expect(rows).toHaveLength(0);
  });

  it("refuses an admin minting an owner invite", async () => {
    const response = await createInviteRoute(
      request("POST", "/api/invites", {
        as: ADMIN,
        body: { workspaceId: WORKSPACE, role: "owner" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "CANNOT_GRANT_ABOVE_OWN_RANK",
    });
  });

  it("returns a link containing the token exactly once", async () => {
    const response = await createInviteRoute(
      request("POST", "/api/invites", {
        as: ADMIN,
        body: {
          workspaceId: WORKSPACE,
          role: "member",
          email: "newcomer@slice.test",
        },
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { url: string };
    expect(body.url).toContain("/invite/");

    const token = new URL(body.url).pathname.split("/").pop() ?? "";
    expect(token.length).toBeGreaterThan(20);

    // Only the digest is stored, which is the whole point of the trade.
    const rows = await db.query<{ token_hash: string }>(
      "select token_hash from invites",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(token);
  });

  it("lets the author of an invite revoke it and refuses a stranger", async () => {
    const created = await createInviteRoute(
      request("POST", "/api/invites", {
        as: ADMIN,
        body: { workspaceId: WORKSPACE, role: "member" },
      }),
    );
    const { invite } = (await created.json()) as { invite: { id: string } };

    const refused = await revokeInviteRoute(
      request("DELETE", "/api/invites", {
        as: MEMBER,
        body: { workspaceId: WORKSPACE, inviteId: invite.id },
      }),
    );
    expect(refused.status).toBe(403);

    const allowed = await revokeInviteRoute(
      request("DELETE", "/api/invites", {
        as: ADMIN,
        body: { workspaceId: WORKSPACE, inviteId: invite.id },
      }),
    );
    expect(allowed.status).toBe(200);
    const rows = await db.query<{ status: string }>(
      "select status from invites where id = $1",
      [invite.id],
    );
    expect(rows[0]?.status).toBe("revoked");
  });
});

/* ============================================================= projects = */

describe("/api/projects", () => {
  it("refuses a guest creating a project in a team they are not in", async () => {
    const response = await createProjectRoute(
      request("POST", "/api/projects", {
        as: GUEST,
        body: { workspaceId: WORKSPACE, name: "Sneaky", teamIds: [TEAM] },
      }),
    );
    expect(response.status).toBe(403);
    const rows = await db.query("select 1 from projects where name = 'Sneaky'");
    expect(rows).toHaveLength(0);
  });

  it("lets a team member create one in their own team", async () => {
    const response = await createProjectRoute(
      request("POST", "/api/projects", {
        as: MEMBER,
        body: { workspaceId: WORKSPACE, name: "Fresh", teamIds: [TEAM] },
      }),
    );
    expect(response.status).toBe(201);
  });
});

describe("PATCH /api/projects/{id}", () => {
  it("hides the project from a non-member with 404, not 403", async () => {
    const response = await patchProjectRoute(
      request("PATCH", `/api/projects/${PROJECT}`, {
        as: GUEST,
        body: { name: "Renamed by a stranger" },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(404);
    expect(await projectName()).toBe("Website redesign");
  });

  it("grants edit to a project member — the deviation, in one assertion", async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, GUEST],
    );
    const response = await patchProjectRoute(
      request("PATCH", `/api/projects/${PROJECT}`, {
        as: GUEST,
        body: { name: "Renamed by a project member" },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(200);
    expect(await projectName()).toBe("Renamed by a project member");
  });

  it("takes the grant away again when the membership goes", async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, GUEST],
    );
    await db.execute(
      "delete from project_members where project_id = $1 and user_id = $2",
      [PROJECT, GUEST],
    );
    const response = await patchProjectRoute(
      request("PATCH", `/api/projects/${PROJECT}`, {
        as: GUEST,
        body: { name: "Renamed after removal" },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(404);
    expect(await projectName()).toBe("Website redesign");
  });

  it("refuses a workspace owner reaching a project in another workspace", async () => {
    const response = await patchProjectRoute(
      request("PATCH", `/api/projects/${FOREIGN_PROJECT}`, {
        as: OWNER,
        body: { name: "Reached across the tenancy boundary" },
      }),
      params({ id: FOREIGN_PROJECT }),
    );
    expect(response.status).toBe(404);
    const rows = await db.query<{ name: string }>(
      "select name from projects where id = $1",
      [FOREIGN_PROJECT],
    );
    expect(rows[0]?.name).toBe("Elsewhere");
  });

  it("does not accept health — that is what posting an update is for", async () => {
    await patchProjectRoute(
      request("PATCH", `/api/projects/${PROJECT}`, {
        as: OWNER,
        body: { health: "offTrack" },
      }),
      params({ id: PROJECT }),
    );
    const rows = await db.query<{ health: string | null }>(
      "select health from projects where id = $1",
      [PROJECT],
    );
    expect(rows[0]?.health).toBeNull();
  });

  it("writes health when an update is posted", async () => {
    const response = await projectCommandRoute(
      request("POST", `/api/projects/${PROJECT}`, {
        as: OWNER,
        body: { action: "postUpdate", body: "Behind on the audit.", health: "atRisk" },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(201);
    const rows = await db.query<{ health: string | null }>(
      "select health from projects where id = $1",
      [PROJECT],
    );
    expect(rows[0]?.health).toBe("atRisk");
  });

  it("refuses deletion by a project member, who is not a lead", async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, GUEST],
    );
    const response = await deleteProjectRoute(
      request("DELETE", `/api/projects/${PROJECT}`, { as: GUEST }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(403);
    expect(await projectName()).toBe("Website redesign");
  });
});

describe("/api/projects/{id}/members", () => {
  it("refuses a non-member adding somebody, with 404", async () => {
    const response = await addProjectMemberRoute(
      request("POST", `/api/projects/${PROJECT}/members`, {
        as: GUEST,
        body: { userId: MEMBER },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(404);
    expect(await projectMemberIds()).toStrictEqual([OWNER]);
  });

  it("lets a lead add somebody, including a guest", async () => {
    const response = await addProjectMemberRoute(
      request("POST", `/api/projects/${PROJECT}/members`, {
        as: OWNER,
        body: { userId: GUEST },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(201);
    expect(await projectMemberIds()).toContain(GUEST);
  });

  it("refuses making a guest the lead of a project", async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, GUEST],
    );
    const response = await changeProjectMemberRoute(
      request("PATCH", `/api/projects/${PROJECT}/members`, {
        as: OWNER,
        body: { userId: GUEST, role: "lead" },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "GUEST_CANNOT_HOLD_ROLE",
    });
  });

  it("refuses a plain project member removing a peer, but allows them to leave", async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, GUEST],
    );
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, MEMBER],
    );

    const refused = await removeProjectMemberRoute(
      request("DELETE", `/api/projects/${PROJECT}/members`, {
        as: GUEST,
        body: { userId: MEMBER },
      }),
      params({ id: PROJECT }),
    );
    expect(refused.status).toBe(403);
    expect(await projectMemberIds()).toContain(MEMBER);

    const left = await removeProjectMemberRoute(
      request("DELETE", `/api/projects/${PROJECT}/members`, {
        as: GUEST,
        body: { userId: GUEST },
      }),
      params({ id: PROJECT }),
    );
    expect(left.status).toBe(200);
    expect(await projectMemberIds()).not.toContain(GUEST);
  });

  it("lets a lead remove somebody, revoking the grant", async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, $2, 'member')",
      [PROJECT, GUEST],
    );
    const response = await removeProjectMemberRoute(
      request("DELETE", `/api/projects/${PROJECT}/members`, {
        as: OWNER,
        body: { userId: GUEST },
      }),
      params({ id: PROJECT }),
    );
    expect(response.status).toBe(200);
    expect(await projectMemberIds()).toStrictEqual([OWNER]);
  });
});

/* ================================================================ teams = */

describe("/api/teams", () => {
  it("refuses a guest creating a team", async () => {
    const response = await createTeamRoute(
      request("POST", "/api/teams", {
        as: GUEST,
        body: { workspaceId: WORKSPACE, name: "Guest Team" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("refuses a member creating a private team, while allowing a public one", async () => {
    const priv = await createTeamRoute(
      request("POST", "/api/teams", {
        as: MEMBER,
        body: { workspaceId: WORKSPACE, name: "Secret", private: true },
      }),
    );
    expect(priv.status).toBe(403);

    const open = await createTeamRoute(
      request("POST", "/api/teams", {
        as: MEMBER,
        body: { workspaceId: WORKSPACE, name: "Platform" },
      }),
    );
    expect(open.status).toBe(201);
  });
});

describe("PATCH /api/teams/{id}", () => {
  it("refuses a plain team member changing settings", async () => {
    const response = await patchTeamRoute(
      request("PATCH", `/api/teams/${TEAM}`, {
        as: MEMBER,
        body: { name: "Renamed" },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(403);
  });

  it("hides a private team the actor is not in behind a 404", async () => {
    const response = await patchTeamRoute(
      request("PATCH", `/api/teams/${PRIVATE_TEAM}`, {
        as: MEMBER,
        body: { name: "Renamed" },
      }),
      params({ id: PRIVATE_TEAM }),
    );
    expect(response.status).toBe(404);
  });

  it("refuses a key that is already taken with a 409", async () => {
    const response = await patchTeamRoute(
      request("PATCH", `/api/teams/${TEAM}`, {
        as: OWNER,
        body: { key: "DES" },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(409);
  });

  it("lets a workspace admin rename a team", async () => {
    const response = await patchTeamRoute(
      request("PATCH", `/api/teams/${TEAM}`, {
        as: ADMIN,
        body: { name: "Platform" },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(200);
  });
});

describe("workflow states", () => {
  async function seedStates(): Promise<{ done: string; alsoDone: string }> {
    await db.execute(
      `insert into workflow_states (id, team_id, name, type, color, position)
       values ('sta_todo', $1, 'Todo', 'unstarted', '#e2e2e2', 0),
              ('sta_done', $1, 'Done', 'completed', '#5e6ad2', 1),
              ('sta_shipped', $1, 'Shipped', 'completed', '#5e6ad2', 2)`,
      [TEAM],
    );
    return { done: "sta_done", alsoDone: "sta_shipped" };
  }

  it("refuses deleting the only state of a type", async () => {
    await db.execute(
      `insert into workflow_states (id, team_id, name, type, color, position)
       values ('sta_only', $1, 'Todo', 'unstarted', '#e2e2e2', 0)`,
      [TEAM],
    );
    const response = await teamCommandRoute(
      request("POST", `/api/teams/${TEAM}`, {
        as: OWNER,
        body: { action: "deleteState", stateId: "sta_only" },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(409);
    const rows = await db.query("select 1 from workflow_states where id = 'sta_only'");
    expect(rows).toHaveLength(1);
  });

  it("refuses deleting a state that still holds issues", async () => {
    const { done } = await seedStates();
    await db.execute(
      `insert into issues (id, team_id, number, title, state_id, creator_id, sort_order)
       values ('iss_slice_1', $1, 1, 'Held', $2, $3, 'a0')`,
      [TEAM, done, OWNER],
    );

    const response = await teamCommandRoute(
      request("POST", `/api/teams/${TEAM}`, {
        as: OWNER,
        body: { action: "deleteState", stateId: done },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("1 issue");
    const rows = await db.query("select 1 from workflow_states where id = $1", [done]);
    expect(rows).toHaveLength(1);
  });

  it("deletes an empty state that is not the last of its type", async () => {
    const { alsoDone } = await seedStates();
    const response = await teamCommandRoute(
      request("POST", `/api/teams/${TEAM}`, {
        as: OWNER,
        body: { action: "deleteState", stateId: alsoDone },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(200);
    const rows = await db.query("select 1 from workflow_states where id = $1", [
      alsoDone,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("refuses a plain team member managing states", async () => {
    await seedStates();
    const response = await teamCommandRoute(
      request("POST", `/api/teams/${TEAM}`, {
        as: MEMBER,
        body: { action: "createState", name: "Blocked", type: "started", color: "#f2c94c" },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(403);
  });

  it("lets a team member create a label but not delete one", async () => {
    const created = await teamCommandRoute(
      request("POST", `/api/teams/${TEAM}`, {
        as: MEMBER,
        body: { action: "createLabel", name: "Flaky", color: "#eb5757" },
      }),
      params({ id: TEAM }),
    );
    expect(created.status).toBe(201);
    const { label } = (await created.json()) as { label: { id: string } };

    const refused = await teamCommandRoute(
      request("POST", `/api/teams/${TEAM}`, {
        as: MEMBER,
        body: { action: "deleteLabel", labelId: label.id },
      }),
      params({ id: TEAM }),
    );
    expect(refused.status).toBe(403);
    const rows = await db.query("select 1 from labels where id = $1", [label.id]);
    expect(rows).toHaveLength(1);
  });
});

describe("DELETE /api/teams/{id}", () => {
  it("refuses a plain team member", async () => {
    const response = await deleteTeamRoute(
      request("DELETE", `/api/teams/${TEAM}`, { as: MEMBER }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(403);
    const rows = await db.query("select 1 from teams where id = $1", [TEAM]);
    expect(rows).toHaveLength(1);
  });
});

describe("/api/teams/{id}/members", () => {
  it("hides a public team from a guest who was never added to it", async () => {
    // 404 rather than 403, and that is the stricter answer: `team.view` denies
    // `ws:guest` outright (row 14), so a guest has no way to learn that a team
    // they are not in exists at all.
    const response = await addTeamMemberRoute(
      request("POST", `/api/teams/${TEAM}/members`, {
        as: GUEST,
        body: { userId: GUEST },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(404);
    const rows = await db.query(
      "select 1 from team_members where team_id = $1 and user_id = $2",
      [TEAM, GUEST],
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses making a guest a team admin", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, $2, 'member')",
      [TEAM, GUEST],
    );
    const response = await changeTeamMemberRoute(
      request("PATCH", `/api/teams/${TEAM}/members`, {
        as: OWNER,
        body: { userId: GUEST, role: "admin" },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "GUEST_CANNOT_HOLD_ROLE",
    });
  });

  it("refuses removing the last team admin", async () => {
    const response = await removeTeamMemberRoute(
      request("DELETE", `/api/teams/${TEAM}/members`, {
        as: OWNER,
        body: { userId: OWNER },
      }),
      params({ id: TEAM }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "LAST_TEAM_ADMIN" });
  });

  it("hides a private team from a workspace member entirely", async () => {
    const response = await addTeamMemberRoute(
      request("POST", `/api/teams/${PRIVATE_TEAM}/members`, {
        as: MEMBER,
        body: { userId: MEMBER },
      }),
      params({ id: PRIVATE_TEAM }),
    );
    expect(response.status).toBe(404);
  });
});

/* =================================================================== ai = */

describe("POST /api/ai", () => {
  it("refuses an anonymous caller", async () => {
    const response = await aiRoute(
      request("POST", "/api/ai", {
        body: { workspaceId: WORKSPACE, task: "summarize", input: "hello" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses somebody who is not in the workspace", async () => {
    const response = await aiRoute(
      request("POST", "/api/ai", {
        as: OUTSIDER,
        body: { workspaceId: WORKSPACE, task: "summarize", input: "hello" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("answers a member with a rendered 'not configured' rather than an error", async () => {
    const response = await aiRoute(
      request("POST", "/api/ai", {
        as: MEMBER,
        body: { workspaceId: WORKSPACE, task: "summarize", input: "hello" },
      }),
    );
    // 200 on purpose: an unconfigured deployment is the default state of a
    // fresh clone, and the panel renders the explanation.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: "unconfigured",
    });
  });
});
