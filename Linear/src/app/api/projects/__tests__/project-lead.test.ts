// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests, type SqlDatabase } from "@/adapters/db";
import {
  createFixture,
  createTestDatabase,
  createUser,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";
import { PATCH as patchProject } from "@/app/api/projects/[id]/route";
import {
  addProjectMember,
  changeProjectMemberRole,
  removeProjectMember,
} from "@/domain/services/membership";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * Who leads a project, written down twice.
 *
 * `projects.lead_id` is a column; `project_members.role = 'lead'` is a row. The
 * column is what every header, card and list renders. The row is what
 * `loadActor` reads and what the permission matrix answers from. Both have to
 * exist — a matrix cannot join a column, a list view cannot afford a per-row
 * lookup — so the only question is whether they can ever disagree.
 *
 * They could, in two directions at once:
 *
 *  - `PATCH /api/projects/{id}` accepted `leadId` as an ordinary field. That
 *    wrote the column and nothing else, under `project.update` — a grant every
 *    project member holds — so a peer could install a lead the matrix had never
 *    granted anything to, and the rank check in footnote 12 never ran.
 *  - the membership service wrote the row and nothing else, so promoting or
 *    removing a lead through the endpoint that *is* gated left the column
 *    naming the previous one, and left two rows claiming the role.
 *
 * Every test here therefore reads **both** stores and asserts on the pair. A
 * test that checked only the column would have passed against the bug in the
 * service; one that checked only the rows would have passed against the bug in
 * the route.
 */

let db: SqlDatabase;
let dispose: () => Promise<void>;
let fixture: Fixture;

/** Two project members who take turns leading. */
let aliceId: string;
let bobId: string;

let projectId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  dispose = setDbForTests(db);
  fixture = await createFixture(db);

  aliceId = await createUser(db, "alice@test.local", "Alice");
  bobId = await createUser(db, "bob@test.local", "Bob");
  for (const userId of [aliceId, bobId]) {
    await fixture.repos.workspaces.addMember(fixture.workspaceId, userId, "member");
  }
}, 60_000);

afterAll(async () => {
  await dispose();
});

/**
 * A fresh project per test.
 *
 * The invariant is about a sequence of writes, so a project carried between
 * tests would make each one depend on the order of the ones before it — and the
 * failure this file exists for is precisely a *stale* value surviving a write.
 */
beforeEach(async () => {
  const project = await fixture.repos.projects.create(
    {
      workspaceId: fixture.workspaceId,
      name: "Launch",
      teamIds: [fixture.teamId],
      memberIds: [aliceId, bobId],
    },
    fixture.ownerId,
  );
  projectId = project.id;
});

/* ================================================================ helpers = */

interface Stores {
  /** `projects.lead_id`, the denormalised column. */
  readonly column: string | null;
  /** Every `project_members` row holding the lead role. */
  readonly rows: string[];
}

/** Both records of the same fact, read straight from the tables. */
async function stores(): Promise<Stores> {
  const project = await fixture.repos.projects.byId(projectId);
  const rows = await db.query<{ user_id: string }>(
    `select user_id from project_members
      where project_id = $1 and role = 'lead'
      order by user_id asc`,
    [projectId],
  );
  return { column: project?.leadId ?? null, rows: rows.map((row) => row.user_id) };
}

/**
 * The assertion this file is about: the two stores name the same lead, and
 * there is at most one of them.
 */
async function expectAgreementOn(userId: string | null): Promise<void> {
  const { column, rows } = await stores();
  expect(rows).toEqual(userId === null ? [] : [userId]);
  expect(column).toBe(userId);
}

/**
 * Replace the project under test with one that already has a lead in *both*
 * stores.
 *
 * `create` is the one path that always wrote both — it inserts `lead_id` and
 * the `lead` membership row in the same statement pair — so a project built
 * this way is the honest starting point for "what happens when the lead goes
 * away". Promoting somebody instead would leave the column empty on the broken
 * code, and a test that starts from an empty column cannot notice a stale one.
 */
async function projectLedByAlice(): Promise<void> {
  const project = await fixture.repos.projects.create(
    {
      workspaceId: fixture.workspaceId,
      name: "Led",
      teamIds: [fixture.teamId],
      leadId: aliceId,
      memberIds: [bobId],
    },
    fixture.ownerId,
  );
  projectId = project.id;
  await expectAgreementOn(aliceId);
}

async function cookie(userId: string): Promise<string> {
  const session = await createSession(userId, { db });
  return `${sessionCookieName()}=${session.token}`;
}

async function patch(userId: string, body: unknown): Promise<Response> {
  return patchProject(
    new Request(`http://x/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: await cookie(userId) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: projectId }) },
  );
}

/* ============================================== the generic field patch === */

describe("PATCH /api/projects/{id}", () => {
  it("refuses a leadId instead of writing half the fact", async () => {
    await changeProjectMemberRole(
      {
        projectId,
        actorId: fixture.ownerId,
        targetUserId: aliceId,
        nextRole: "lead",
      },
      db,
    );

    // A plain project member, holding `project.update` and nothing more.
    const response = await patch(bobId, { leadId: bobId });

    expect(response.status).toBe(400);
    // Not "the write was refused" — the write must not have happened at all,
    // in either store. A 400 beside a changed column is the same bug.
    await expectAgreementOn(aliceId);
  });

  it("refuses it even from the workspace owner, who has the other endpoint", async () => {
    const response = await patch(fixture.ownerId, { leadId: bobId });

    expect(response.status).toBe(400);
    await expectAgreementOn(null);
  });

  it("refuses it alongside fields that would otherwise be written", async () => {
    const response = await patch(fixture.ownerId, {
      name: "Renamed",
      leadId: bobId,
    });

    expect(response.status).toBe(400);
    await expectAgreementOn(null);
    // The rest of the patch is refused with it: a partial application would be
    // the atomicity bug wearing the permission bug's clothes.
    expect((await fixture.repos.projects.byId(projectId))?.name).toBe("Launch");
  });

  it("still writes the fields it does own", async () => {
    const response = await patch(fixture.ownerId, { name: "Renamed" });

    expect(response.status).toBe(200);
    expect((await fixture.repos.projects.byId(projectId))?.name).toBe("Renamed");
  });
});

/* ================================================== the membership path == */

describe("the membership service, which is the one writer", () => {
  it("agrees on both stores when a lead is set", async () => {
    const result = await changeProjectMemberRole(
      {
        projectId,
        actorId: fixture.ownerId,
        targetUserId: aliceId,
        nextRole: "lead",
      },
      db,
    );

    expect(result.ok).toBe(true);
    await expectAgreementOn(aliceId);
  });

  it("agrees on both stores when the lead changes", async () => {
    await changeProjectMemberRole(
      { projectId, actorId: fixture.ownerId, targetUserId: aliceId, nextRole: "lead" },
      db,
    );
    await changeProjectMemberRole(
      { projectId, actorId: fixture.ownerId, targetUserId: bobId, nextRole: "lead" },
      db,
    );

    // The promotion breaks the tie: Bob leads, and Alice is a plain member
    // again rather than a second lead nobody can see in the header.
    await expectAgreementOn(bobId);
    const alice = await db.query<{ role: string }>(
      "select role from project_members where project_id = $1 and user_id = $2",
      [projectId, aliceId],
    );
    expect(alice[0]?.role).toBe("member");
  });

  it("agrees on both stores when the lead is removed", async () => {
    await projectLedByAlice();

    const result = await removeProjectMember(
      { projectId, actorId: fixture.ownerId, targetUserId: aliceId },
      db,
    );

    expect(result.ok).toBe(true);
    await expectAgreementOn(null);
  });

  it("agrees on both stores when the lead leaves of their own accord", async () => {
    await projectLedByAlice();

    // R8: anyone may leave, and the departure is not measured against
    // `project.remove_member`. It still has to take the column with it.
    await removeProjectMember(
      { projectId, actorId: aliceId, targetUserId: aliceId },
      db,
    );

    await expectAgreementOn(null);
  });

  it("agrees on both stores when a lead is demoted to member", async () => {
    await projectLedByAlice();

    await changeProjectMemberRole(
      { projectId, actorId: fixture.ownerId, targetUserId: aliceId, nextRole: "member" },
      db,
    );

    await expectAgreementOn(null);
  });

  it("hands the lead over without leaving the column on the old one", async () => {
    await projectLedByAlice();

    await changeProjectMemberRole(
      { projectId, actorId: fixture.ownerId, targetUserId: bobId, nextRole: "lead" },
      db,
    );

    await expectAgreementOn(bobId);
  });

  it("agrees on both stores when somebody is added straight in as lead", async () => {
    await changeProjectMemberRole(
      { projectId, actorId: fixture.ownerId, targetUserId: aliceId, nextRole: "lead" },
      db,
    );

    const carolId = await createUser(db, "carol@test.local", "Carol");
    await fixture.repos.workspaces.addMember(fixture.workspaceId, carolId, "member");

    const result = await addProjectMember(
      { projectId, actorId: fixture.ownerId, userId: carolId, role: "lead" },
      db,
    );

    expect(result.ok).toBe(true);
    await expectAgreementOn(carolId);
  });

  it("leaves the lead alone when an unrelated member is removed", async () => {
    await changeProjectMemberRole(
      { projectId, actorId: fixture.ownerId, targetUserId: aliceId, nextRole: "lead" },
      db,
    );

    await removeProjectMember(
      { projectId, actorId: fixture.ownerId, targetUserId: bobId },
      db,
    );

    await expectAgreementOn(aliceId);
  });
});

/* ================================================ the storage layer too == */

describe("the repository, which the seed and scripts reach for", () => {
  it("never leaves two rows claiming the role", async () => {
    await fixture.repos.projects.addMember(
      projectId,
      aliceId,
      "lead",
      fixture.ownerId,
    );
    await fixture.repos.projects.addMember(projectId, bobId, "lead", fixture.ownerId);

    await expectAgreementOn(bobId);
  });

  it("clears the column when the lead is demoted through it", async () => {
    await fixture.repos.projects.addMember(
      projectId,
      aliceId,
      "lead",
      fixture.ownerId,
    );
    await fixture.repos.projects.addMember(
      projectId,
      aliceId,
      "member",
      fixture.ownerId,
    );

    await expectAgreementOn(null);
  });

  it("writes the membership row when a patch names a lead", async () => {
    // `update` is no longer reachable with a `leadId` from the API, but the
    // port still declares the field and the seed still writes projects. If it
    // ever runs, it has to leave both stores true.
    await fixture.repos.projects.update(
      projectId,
      { leadId: bobId },
      fixture.ownerId,
    );

    await expectAgreementOn(bobId);
  });
});
