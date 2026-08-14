// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, type SqlDatabase } from "@/adapters/db";

import {
  addProjectMember,
  addTeamMember,
  changeProjectMemberRole,
  changeTeamMemberRole,
  changeWorkspaceMemberRole,
  leaveTeam,
  leaveWorkspace,
  loadActor,
  removeTeamMember,
  removeWorkspaceMember,
} from "../services/membership";

/**
 * Membership rules against a real Postgres.
 *
 * PGlite rather than a fake, for one specific reason: the rule under test is
 * "the count is still true at commit time", and a fake repository has no commit
 * time. The in-memory adapter the research note describes cannot reproduce
 * Postgres' locking, so a green suite over one would be a false negative of
 * exactly the shape §7.2 warns about.
 *
 * jsdom is off (`@vitest-environment node`): PGlite's WASM build and jose's
 * webapi build both misbehave under it.
 */

const WORKSPACE = "wsp_test";
const OTHER_WORKSPACE = "wsp_other";
const TEAM = "tem_eng";
const PRIVATE_TEAM = "tem_secret";
const PROJECT = "prj_launch";

let db: SqlDatabase;

async function seedUser(id: string, name: string): Promise<void> {
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name)
     values ($1, $2, 'x', $3, $4)`,
    [id, `${id}@example.com`, name, id],
  );
}

async function member(
  userId: string,
  role: string,
  workspaceId: string = WORKSPACE,
): Promise<void> {
  await db.execute(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`,
    [workspaceId, userId, role],
  );
}

async function ownerCount(workspaceId: string = WORKSPACE): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `select count(*)::int as count from workspace_members
      where workspace_id = $1 and role = 'owner'`,
    [workspaceId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function roleOf(userId: string, workspaceId = WORKSPACE): Promise<string | null> {
  const rows = await db.query<{ role: string }>(
    "select role from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, userId],
  );
  return rows[0]?.role ?? null;
}

async function teamRoleOf(teamId: string, userId: string): Promise<string | null> {
  const rows = await db.query<{ role: string }>(
    "select role from team_members where team_id = $1 and user_id = $2",
    [teamId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * One WASM Postgres for the file. Booting one per test would dominate the run,
 * and the per-test cleanup below is cheaper than a boot by two orders of
 * magnitude.
 */
beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/**
 * A workspace with two owners, one admin, one member and one guest.
 *
 * Rebuilt per test rather than rolled back, because the code under test opens
 * its own transactions and a surrounding one would nest into them.
 */
beforeEach(async () => {
  for (const table of [
    "project_members",
    "project_teams",
    "projects",
    "team_members",
    "teams",
    "workspace_members",
    "workspaces",
    "users",
  ]) {
    await db.execute(`delete from ${table}`);
  }

  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Test', 'test')",
    [WORKSPACE],
  );
  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Other', 'other')",
    [OTHER_WORKSPACE],
  );

  await seedUser("usr_owner_a", "Owner A");
  await seedUser("usr_owner_b", "Owner B");
  await seedUser("usr_admin", "Admin");
  await seedUser("usr_member", "Member");
  await seedUser("usr_guest", "Guest");
  await seedUser("usr_outsider", "Outsider");

  await member("usr_owner_a", "owner");
  await member("usr_owner_b", "owner");
  await member("usr_admin", "admin");
  await member("usr_member", "member");
  await member("usr_guest", "guest");

  await db.execute(
    "insert into teams (id, workspace_id, name, key) values ($1, $2, 'Engineering', 'ENG')",
    [TEAM, WORKSPACE],
  );
  await db.execute(
    `insert into teams (id, workspace_id, name, key, private)
     values ($1, $2, 'Secret', 'SEC', true)`,
    [PRIVATE_TEAM, WORKSPACE],
  );
  await db.execute(
    `insert into projects (id, workspace_id, name, slug_id, sort_order)
     values ($1, $2, 'Launch', 'launch', 'a0')`,
    [PROJECT, WORKSPACE],
  );
  await db.execute("insert into project_teams (project_id, team_id) values ($1, $2)", [
    PROJECT,
    TEAM,
  ]);
});

/* ============================================================ last owner = */

describe("the last owner", () => {
  it("cannot be demoted", async () => {
    await db.execute(
      "delete from workspace_members where workspace_id = $1 and user_id = 'usr_owner_b'",
      [WORKSPACE],
    );

    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_owner_a",
        nextRole: "admin",
      },
      db,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.denial.code).toBe("LAST_OWNER");
    expect(await roleOf("usr_owner_a")).toBe("owner");
  });

  it("cannot be removed", async () => {
    await db.execute(
      "delete from workspace_members where workspace_id = $1 and user_id = 'usr_owner_b'",
      [WORKSPACE],
    );

    const result = await removeWorkspaceMember(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_owner_a",
      },
      db,
    );

    expect(result.ok === false && result.denial.code).toBe("LAST_OWNER");
    expect(await ownerCount()).toBe(1);
  });

  it("cannot leave", async () => {
    await db.execute(
      "delete from workspace_members where workspace_id = $1 and user_id = 'usr_owner_b'",
      [WORKSPACE],
    );

    const result = await leaveWorkspace(
      { workspaceId: WORKSPACE, actorId: "usr_owner_a" },
      db,
    );

    expect(result.ok === false && result.denial.code).toBe("LAST_OWNER");
    expect(await ownerCount()).toBe(1);
  });

  it("may be demoted once a second owner exists", async () => {
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_owner_a",
        nextRole: "admin",
      },
      db,
    );

    expect(result.ok).toBe(true);
    expect(await ownerCount()).toBe(1);
  });

  it("is not rescued by a deactivated owner", async () => {
    // `usr_owner_b` exists but cannot sign in, so counting them as an owner
    // would let the workspace lock itself out.
    await db.execute("update users set active = false where id = 'usr_owner_b'");

    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_owner_a",
        nextRole: "admin",
      },
      db,
    );

    expect(result.ok === false && result.denial.code).toBe("LAST_OWNER");
  });
});

/**
 * The bug the spec names: two demotions that each read `count = 2`.
 *
 * Both owners demote themselves at the same instant. Without the workspace-row
 * lock — or, on this engine, without the queue in front of it — both reads see
 * two owners, both checks pass, and the workspace commits its way to zero
 * owners with nobody left who can restore one.
 */
describe("two concurrent demotions", () => {
  it("lets exactly one through", async () => {
    expect(await ownerCount()).toBe(2);

    const [first, second] = await Promise.all([
      changeWorkspaceMemberRole(
        {
          workspaceId: WORKSPACE,
          actorId: "usr_owner_a",
          targetUserId: "usr_owner_a",
          nextRole: "admin",
        },
        db,
      ),
      changeWorkspaceMemberRole(
        {
          workspaceId: WORKSPACE,
          actorId: "usr_owner_b",
          targetUserId: "usr_owner_b",
          nextRole: "admin",
        },
        db,
      ),
    ]);

    const outcomes = [first.ok, second.ok];
    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const loser = first.ok ? second : first;
    expect(loser.ok === false && loser.denial.code).toBe("LAST_OWNER");
    expect(await ownerCount()).toBe(1);
  });

  it("survives a crowd", async () => {
    // Five owners, five simultaneous departures: four leave, the fifth is told
    // why it cannot.
    for (const id of ["usr_owner_c", "usr_owner_d", "usr_owner_e"]) {
      await seedUser(id, id);
      await member(id, "owner");
    }
    expect(await ownerCount()).toBe(5);

    const results = await Promise.all(
      ["usr_owner_a", "usr_owner_b", "usr_owner_c", "usr_owner_d", "usr_owner_e"].map(
        (actorId) => leaveWorkspace({ workspaceId: WORKSPACE, actorId }, db),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(4);
    expect(await ownerCount()).toBe(1);
  });
});

/* ========================================================== escalation === */

describe("nobody may promote above their own role", () => {
  it("stops an admin minting an owner", async () => {
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_admin",
        targetUserId: "usr_member",
        nextRole: "owner",
      },
      db,
    );

    expect(result.ok === false && result.denial.code).toBe(
      "CANNOT_GRANT_ABOVE_OWN_RANK",
    );
    expect(await roleOf("usr_member")).toBe("member");
  });

  it("stops an admin demoting another admin", async () => {
    await seedUser("usr_admin_2", "Admin Two");
    await member("usr_admin_2", "admin");

    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_admin",
        targetUserId: "usr_admin_2",
        nextRole: "member",
      },
      db,
    );

    expect(result.ok === false && result.denial.code).toBe("RANK_NOT_ABOVE_TARGET");
  });

  it("lets an owner promote a member to admin", async () => {
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
        nextRole: "admin",
      },
      db,
    );

    expect(result.ok).toBe(true);
    expect(await roleOf("usr_member")).toBe("admin");
  });

  it("refuses a plain member entirely", async () => {
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_member",
        targetUserId: "usr_guest",
        nextRole: "member",
      },
      db,
    );

    expect(result.ok === false && result.denial.code).toBe("INSUFFICIENT_ROLE");
  });
});

describe("preconditions", () => {
  it("refuses someone with no membership row", async () => {
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_outsider",
        targetUserId: "usr_member",
        nextRole: "admin",
      },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("NOT_A_MEMBER");
  });

  it("refuses a suspended owner", async () => {
    await db.execute("update users set active = false where id = 'usr_owner_a'");
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
        nextRole: "admin",
      },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("MEMBERSHIP_SUSPENDED");
  });

  it("reports a missing workspace as not found, not as a denial", async () => {
    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: "wsp_nope",
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
        nextRole: "admin",
      },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("NOT_FOUND");
  });
});

/* ============================================================== leaving = */

describe("leaving", () => {
  it("lets a member remove themselves", async () => {
    const result = await leaveWorkspace(
      { workspaceId: WORKSPACE, actorId: "usr_member" },
      db,
    );
    expect(result.ok).toBe(true);
    expect(await roleOf("usr_member")).toBeNull();
  });

  it("lets a guest remove themselves", async () => {
    const result = await leaveWorkspace(
      { workspaceId: WORKSPACE, actorId: "usr_guest" },
      db,
    );
    expect(result.ok).toBe(true);
  });

  it("cascades to team and project membership but never to the user", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_member', 'member')",
      [TEAM],
    );
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, 'usr_member', 'member')",
      [PROJECT],
    );

    const result = await removeWorkspaceMember(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
      },
      db,
    );

    expect(result.ok).toBe(true);
    expect(await teamRoleOf(TEAM, "usr_member")).toBeNull();
    const projectRows = await db.query(
      "select 1 from project_members where project_id = $1 and user_id = 'usr_member'",
      [PROJECT],
    );
    expect(projectRows).toHaveLength(0);
    // R11: the person survives, so everything they authored still renders.
    const users = await db.query("select id from users where id = 'usr_member'");
    expect(users).toHaveLength(1);
  });
});

/* ================================================== guests and container = */

describe("guests", () => {
  it("cannot be made a team admin", async () => {
    const result = await addTeamMember(
      {
        teamId: TEAM,
        actorId: "usr_owner_a",
        userId: "usr_guest",
        role: "admin",
      },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("GUEST_CANNOT_HOLD_ROLE");
  });

  it("can be added to a team as a member", async () => {
    const result = await addTeamMember(
      { teamId: TEAM, actorId: "usr_owner_a", userId: "usr_guest", role: "member" },
      db,
    );
    expect(result.ok).toBe(true);
    expect(await teamRoleOf(TEAM, "usr_guest")).toBe("member");
  });

  it("cannot be added to a team by a plain team member", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_member', 'member')",
      [TEAM],
    );
    const result = await addTeamMember(
      { teamId: TEAM, actorId: "usr_member", userId: "usr_guest", role: "member" },
      db,
    );
    // `team.add_guest` is a different row of the matrix, and a team member has
    // no cell in it.
    expect(result.ok === false && result.denial.code).toBe("INSUFFICIENT_ROLE");
  });

  it("loses their container admin roles when demoted to guest", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_member', 'admin')",
      [TEAM],
    );
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, 'usr_member', 'lead')",
      [PROJECT],
    );

    const result = await changeWorkspaceMemberRole(
      {
        workspaceId: WORKSPACE,
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
        nextRole: "guest",
      },
      db,
    );

    expect(result.ok).toBe(true);
    expect(await teamRoleOf(TEAM, "usr_member")).toBe("member");
    const projectRows = await db.query<{ role: string }>(
      "select role from project_members where project_id = $1 and user_id = 'usr_member'",
      [PROJECT],
    );
    expect(projectRows[0]?.role).toBe("member");
  });
});

/* ================================================== teams and projects === */

describe("team membership", () => {
  beforeEach(async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_member', 'admin')",
      [TEAM],
    );
  });

  it("R5 — will not demote the last team admin", async () => {
    const result = await changeTeamMemberRole(
      {
        teamId: TEAM,
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
        nextRole: "member",
      },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("LAST_TEAM_ADMIN");
  });

  it("R5 — will not let the last team admin leave", async () => {
    const result = await leaveTeam({ teamId: TEAM, actorId: "usr_member" }, db);
    expect(result.ok === false && result.denial.code).toBe("LAST_TEAM_ADMIN");
  });

  it("R5 — releases once a second admin exists", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_admin', 'admin')",
      [TEAM],
    );
    const result = await leaveTeam({ teamId: TEAM, actorId: "usr_member" }, db);
    expect(result.ok).toBe(true);
  });

  it("lets a plain team member leave", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_guest', 'member')",
      [TEAM],
    );
    const result = await leaveTeam({ teamId: TEAM, actorId: "usr_guest" }, db);
    expect(result.ok).toBe(true);
  });

  it("stops a plain team member removing somebody else", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_guest', 'member')",
      [TEAM],
    );
    const result = await removeTeamMember(
      { teamId: TEAM, actorId: "usr_guest", targetUserId: "usr_member" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("INSUFFICIENT_ROLE");
  });

  it("refuses to add somebody who is not in the workspace at all", async () => {
    const result = await addTeamMember(
      { teamId: TEAM, actorId: "usr_owner_a", userId: "usr_outsider", role: "member" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("NOT_FOUND");
  });
});

describe("project membership", () => {
  beforeEach(async () => {
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, 'usr_member', 'member')",
      [PROJECT],
    );
  });

  it("fn 12 — a project member may add another member", async () => {
    const result = await addProjectMember(
      {
        projectId: PROJECT,
        actorId: "usr_member",
        userId: "usr_admin",
        role: "member",
      },
      db,
    );
    expect(result.ok).toBe(true);
  });

  it("fn 12 — but may not mint a lead", async () => {
    const result = await addProjectMember(
      { projectId: PROJECT, actorId: "usr_member", userId: "usr_admin", role: "lead" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe(
      "CANNOT_GRANT_ABOVE_OWN_RANK",
    );
  });

  it("fn 12 — and may not add a guest as a lead", async () => {
    const result = await addProjectMember(
      { projectId: PROJECT, actorId: "usr_owner_a", userId: "usr_guest", role: "lead" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("GUEST_CANNOT_HOLD_ROLE");
  });

  it("R6 — a lead may be demoted; there is no last-lead rule", async () => {
    await db.execute(
      "update project_members set role = 'lead' where project_id = $1 and user_id = 'usr_member'",
      [PROJECT],
    );
    const result = await changeProjectMemberRole(
      {
        projectId: PROJECT,
        actorId: "usr_owner_a",
        targetUserId: "usr_member",
        nextRole: "member",
      },
      db,
    );
    expect(result.ok).toBe(true);
  });
});

/* ============================================================= loadActor = */

describe("loadActor", () => {
  it("collects every axis for the workspace, and nothing from another one", async () => {
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ($1, 'usr_member', 'admin')",
      [TEAM],
    );
    await db.execute(
      "insert into project_members (project_id, user_id, role) values ($1, 'usr_member', 'lead')",
      [PROJECT],
    );
    // A team in a different workspace must not leak into this actor.
    await db.execute(
      `insert into teams (id, workspace_id, name, key) values ('tem_far', $1, 'Far', 'FAR')`,
      [OTHER_WORKSPACE],
    );
    await db.execute(
      "insert into team_members (team_id, user_id, role) values ('tem_far', 'usr_member', 'admin')",
    );

    const actor = await loadActor(db, WORKSPACE, "usr_member");

    expect(actor.workspaceRole).toBe("member");
    expect(actor.suspended).toBe(false);
    expect(actor.teamRoles).toStrictEqual({ [TEAM]: "admin" });
    expect(actor.projectRoles).toStrictEqual({ [PROJECT]: "lead" });
  });

  it("returns a null role for a non-member", async () => {
    const actor = await loadActor(db, WORKSPACE, "usr_outsider");
    expect(actor.workspaceRole).toBeNull();
  });
});
