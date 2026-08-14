// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setDbForTests, type SqlDatabase } from "@/adapters/db";
import {
  createFixture,
  createTestDatabase,
  createUser,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";
import {
  GET as listIssues,
  POST as createIssue,
} from "@/app/api/issues/route";
import {
  DELETE as deleteIssue,
  PATCH as patchIssue,
} from "@/app/api/issues/[id]/route";
import { POST as reorderIssue } from "@/app/api/issues/reorder/route";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * The issue routes' authorization, against a real database.
 *
 * Every case here is a **status-code** assertion paired with a **body**
 * assertion, and the pairing is the point. The defects these cover were not
 * missing permissions — every one of them refused the write. They were
 * *disclosures*: a refusal that says 403 where a stranger's id would say 404, or
 * a success that hands back a row nobody checked. So each test pins the status
 * a caller may not distinguish from the one next to it, and then pins that the
 * leaked field is nowhere in the response.
 *
 * The database is real (PGlite with `schema.sql`) and so are the sessions —
 * nothing is mocked, because the thing under test is what the policy computes
 * from genuine membership rows.
 *
 * ## The cast
 *
 * `createFixture` supplies Acme with a public team (ENG), an owner, a member in
 * ENG and a workspace guest in nothing. Added here:
 *
 * - **outsider** — a full workspace *member* who is in no team at all. The
 *   interesting actor for a visibility test: they pass every "are you in this
 *   workspace" check and must still be refused, and refused the same way a
 *   nonexistent row is.
 * - **SEC** — a private team, with an issue in it.
 * - **Website Redesign** — a project inside SEC with the guest added to it, so
 *   `proj:member` is the only grant the guest holds (D8, D22).
 * - **Secret Plans** — a second project inside SEC with nobody added, which is
 *   what a project reference must not be able to reach.
 * - **Hidden** — a second workspace nobody in the cast belongs to.
 */

let db: SqlDatabase;
let dispose: () => Promise<void>;
let fixture: Fixture;

let outsiderId: string;
let secTeamId: string;
let publicIssueId: string;
let privateIssueId: string;
let projectIssueId: string;
let openProjectId: string;
let secretProjectId: string;

const PRIVATE_TITLE = "Private work";
const PRIVATE_DESCRIPTION = "the private description";
const SECRET_PROJECT_NAME = "Secret Plans";

beforeAll(async () => {
  db = await createTestDatabase();
  dispose = setDbForTests(db);
  fixture = await createFixture(db);

  outsiderId = await createUser(db, "outsider@test.local", "Outsider");
  await fixture.repos.workspaces.addMember(
    fixture.workspaceId,
    outsiderId,
    "member",
  );

  const sec = await fixture.repos.teams.create(
    {
      workspaceId: fixture.workspaceId,
      name: "Secrets",
      key: "SEC",
      private: true,
    },
    fixture.ownerId,
  );
  secTeamId = sec.id;

  const openProject = await fixture.repos.projects.create(
    {
      workspaceId: fixture.workspaceId,
      name: "Website Redesign",
      teamIds: [sec.id],
    },
    fixture.ownerId,
  );
  openProjectId = openProject.id;
  await fixture.repos.projects.addMember(
    openProject.id,
    fixture.guestId,
    "member",
    fixture.ownerId,
  );

  const secretProject = await fixture.repos.projects.create(
    {
      workspaceId: fixture.workspaceId,
      name: SECRET_PROJECT_NAME,
      teamIds: [sec.id],
    },
    fixture.ownerId,
  );
  secretProjectId = secretProject.id;

  const publicIssue = await fixture.repos.issues.create(
    { teamId: fixture.teamId, title: "Public work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  publicIssueId = publicIssue.id;

  const privateIssue = await fixture.repos.issues.create(
    {
      teamId: sec.id,
      title: PRIVATE_TITLE,
      description: PRIVATE_DESCRIPTION,
      creatorId: fixture.ownerId,
    },
    fixture.ownerId,
  );
  privateIssueId = privateIssue.id;

  const projectIssue = await fixture.repos.issues.create(
    {
      teamId: sec.id,
      title: "Redesign the header",
      creatorId: fixture.ownerId,
      projectId: openProject.id,
    },
    fixture.ownerId,
  );
  projectIssueId = projectIssue.id;

  const stranger = await createUser(db, "stranger@test.local", "Stranger");
  await fixture.repos.workspaces.create({
    name: "Hidden",
    urlKey: "hidden",
    ownerId: stranger,
  });
}, 60_000);

afterAll(async () => {
  await dispose();
});

/* ================================================================ helpers = */

async function cookie(userId: string): Promise<string> {
  const session = await createSession(userId, { db });
  return `${sessionCookieName()}=${session.token}`;
}

async function post(
  handler: (request: Request) => Promise<Response>,
  url: string,
  userId: string,
  body: unknown,
): Promise<Response> {
  return handler(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await cookie(userId) },
      body: JSON.stringify(body),
    }),
  );
}

async function patch(
  id: string,
  userId: string,
  body: unknown,
): Promise<Response> {
  return patchIssue(
    new Request(`http://x/api/issues/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: await cookie(userId) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function remove(id: string, userId: string): Promise<Response> {
  return deleteIssue(
    new Request(`http://x/api/issues/${id}`, {
      method: "DELETE",
      headers: { cookie: await cookie(userId) },
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function get(userId: string, query: string): Promise<Response> {
  return listIssues(
    new Request(`http://x/api/issues?${query}`, {
      headers: { cookie: await cookie(userId) },
    }),
  );
}

/** The whole response, as one string to search for things that must not be in it. */
async function bodyText(response: Response): Promise<string> {
  return response.text();
}

/* ================================================== 1 — idempotent replay = */

describe("POST /api/issues — the idempotency replay", () => {
  it("does not hand back an issue the caller did not create", async () => {
    // The member may create in ENG, and mints the issue id themselves. Naming
    // an id that already exists in a team they cannot see must not turn the
    // create into a read of that row.
    const response = await post(createIssue, "http://x/api/issues", fixture.memberId, {
      id: privateIssueId,
      teamId: fixture.teamId,
      title: "A retry, allegedly",
    });

    expect(response.status).toBe(404);
    const text = await bodyText(response);
    expect(text).not.toContain(PRIVATE_TITLE);
    expect(text).not.toContain(PRIVATE_DESCRIPTION);
    expect(text).not.toContain(secTeamId);

    // …and the row it named is untouched.
    const stored = await fixture.repos.issues.byId(privateIssueId);
    expect(stored?.title).toBe(PRIVATE_TITLE);
  });

  it("does not hand back an issue of the caller's in another team", async () => {
    // Same creator, wrong container: the id was authorized against ENG, so a row
    // living somewhere else is not the request being retried.
    const owned = await fixture.repos.issues.create(
      { teamId: secTeamId, title: "Owner's private note", creatorId: fixture.ownerId },
      fixture.ownerId,
    );

    const response = await post(createIssue, "http://x/api/issues", fixture.ownerId, {
      id: owned.id,
      teamId: fixture.teamId,
      title: "A retry, allegedly",
    });

    expect(response.status).toBe(404);
    expect(await bodyText(response)).not.toContain("Owner's private note");
  });

  it("still replays the caller's own retry into the same team", async () => {
    // The behaviour the scoping must not cost: a timeout, a double-submit or an
    // offline replay names an id that now exists and gets the row, not a 409 and
    // not a second issue.
    const body = {
      id: "iss_replay_case",
      teamId: fixture.teamId,
      title: "Filed once",
    };

    const first = await post(createIssue, "http://x/api/issues", fixture.memberId, body);
    const second = await post(createIssue, "http://x/api/issues", fixture.memberId, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject(await first.json());
  });
});

/* ================================================= 2 — workspace existence */

describe("GET /api/issues — the workspace key", () => {
  it("answers a real workspace the caller is not in exactly as it answers a fake one", async () => {
    const real = await get(outsiderId, "workspace=hidden");
    const fake = await get(outsiderId, "workspace=no-such-workspace");

    expect(real.status).toBe(404);
    expect(fake.status).toBe(404);
    // Byte-identical, because any difference is the oracle: guessing url keys
    // against this endpoint would otherwise enumerate every workspace on the
    // host from any signed-in account.
    expect(await bodyText(real)).toBe(await bodyText(fake));
  });

  it("still lists for a member of the workspace", async () => {
    const response = await get(fixture.memberId, "workspace=acme");
    expect(response.status).toBe(200);
  });
});

/* ============================================ 3 — the mutation entry points */

describe("PATCH, DELETE and reorder on an issue the actor cannot view", () => {
  const cases: readonly (readonly [string, (id: string) => Promise<Response>])[] = [
    ["PATCH", (id) => patch(id, outsiderId, { title: "mine now" })],
    ["DELETE", (id) => remove(id, outsiderId)],
    [
      "reorder",
      (id) =>
        post(reorderIssue, "http://x/api/issues/reorder", outsiderId, {
          id,
          beforeKey: null,
          afterKey: null,
        }),
    ],
  ];

  for (const [name, send] of cases) {
    it(`${name} answers 404 for a real hidden issue and for a fabricated id alike`, async () => {
      // The outsider is a full workspace member, so they clear every membership
      // gate before this one. A 403 here — which is what the pre-fix handlers
      // returned — announces that `iss_…` is a real issue in a team they have
      // never been told about.
      const real = await send(privateIssueId);
      const fake = await send("iss_does_not_exist");

      expect(real.status).toBe(404);
      expect(fake.status).toBe(404);
      const text = await bodyText(real);
      expect(text).toBe(await bodyText(fake));
      expect(text).not.toContain(PRIVATE_TITLE);
    });
  }

  it("leaves the issue alone", async () => {
    const stored = await fixture.repos.issues.byId(privateIssueId);
    expect(stored?.title).toBe(PRIVATE_TITLE);
    expect(stored?.archivedAt).toBeNull();
  });

  it("still lets a team member edit their team's issue", async () => {
    const response = await patch(publicIssueId, fixture.memberId, {
      title: "Public work, revised",
    });
    expect(response.status).toBe(200);
  });
});

/* ================================================== 3b — the reorder gate = */

describe("reordering by bundling it with an ordinary edit", () => {
  /**
   * `issue.reorder` has no `ws:member` row; `issue.update_own` grants one via
   * `authorInPublicTeam`. A workspace member who authored an issue in a public
   * team therefore sits exactly between the two, which is what makes the gap
   * testable: the route asked for `issue.reorder` only when `sortOrder` arrived
   * *alone*, and `authorize` is OR, so adding any second field downgraded the
   * requirement to the grant this actor happens to have.
   *
   * The position is not a field of the issue the way its title is — there is
   * one global order and moving a row edits everyone's view of the list.
   */
  let ownIssueId: string;

  beforeAll(async () => {
    const created = await post(createIssue, "http://x/api/issues", outsiderId, {
      teamId: fixture.teamId,
      title: "Filed by a workspace member",
    });
    expect(created.status).toBe(201);
    ownIssueId = ((await created.json()) as { issue: { id: string } }).issue.id;
  });

  it("refuses a bare reorder", async () => {
    const response = await patch(ownIssueId, outsiderId, { sortOrder: "a1" });
    expect(response.status).toBe(403);
  });

  it("refuses the same reorder smuggled beside an allowed field", async () => {
    const response = await patch(ownIssueId, outsiderId, {
      title: "Filed by a workspace member",
      sortOrder: "a1",
    });
    expect(response.status).toBe(403);
  });

  it("leaves the order untouched when it refuses", async () => {
    const stored = await fixture.repos.issues.byId(ownIssueId);
    expect(stored?.sortOrder).not.toBe("a1");
  });

  it("still allows the edit the actor is entitled to", async () => {
    const response = await patch(ownIssueId, outsiderId, {
      title: "Retitled by its author",
    });
    expect(response.status).toBe(200);
  });
});

/* ================================================ 4 — the create pre-gate = */

describe("POST /api/issues — the team gate", () => {
  it("lets a project member file into their project's team (D22)", async () => {
    // The guest holds no role in SEC at all. `proj:member` on Website Redesign
    // is the entire grant, and rows 39/41 of the matrix say it is enough — which
    // the old `canViewTeam` pre-gate refused before the matrix was consulted.
    const response = await post(createIssue, "http://x/api/issues", fixture.guestId, {
      teamId: secTeamId,
      projectId: openProjectId,
      title: "Added by a project member",
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as { issue: { projectId: string } };
    expect(created.issue.projectId).toBe(openProjectId);
  });

  it("answers 404, not 403, for a team the caller cannot see", async () => {
    // Without the project, the guest has nothing. So does the outsider, who is a
    // workspace member — and neither may learn that SEC exists.
    const guestAttempt = await post(
      createIssue,
      "http://x/api/issues",
      fixture.guestId,
      { teamId: secTeamId, title: "Filed blind" },
    );
    const outsiderAttempt = await post(
      createIssue,
      "http://x/api/issues",
      outsiderId,
      { teamId: secTeamId, title: "Filed blind" },
    );
    const fakeTeam = await post(createIssue, "http://x/api/issues", outsiderId, {
      teamId: "tem_does_not_exist",
      title: "Filed blind",
    });

    expect(guestAttempt.status).toBe(404);
    expect(outsiderAttempt.status).toBe(404);
    expect(fakeTeam.status).toBe(404);
    expect(await bodyText(outsiderAttempt)).toBe(await bodyText(fakeTeam));
  });

  it("still lets a team member file into their own team", async () => {
    const response = await post(createIssue, "http://x/api/issues", fixture.memberId, {
      teamId: fixture.teamId,
      title: "Ordinary work",
    });
    expect(response.status).toBe(201);
  });
});

/* ============================================== 5 — the project reference = */

describe("the projectId a write may name", () => {
  it("refuses a project the actor may not view, and does not name it", async () => {
    // The guest may edit this issue — `proj:member` on Website Redesign — and
    // Secret Plans is in the same workspace, which used to be the whole test.
    // Attaching it would have put its name in the response.
    const response = await patch(projectIssueId, fixture.guestId, {
      projectId: secretProjectId,
    });

    expect(response.status).toBe(400);
    const text = await bodyText(response);
    expect(text).not.toContain(SECRET_PROJECT_NAME);
    expect(text).not.toContain(secretProjectId);

    const stored = await fixture.repos.issues.byId(projectIssueId);
    expect(stored?.projectId).toBe(openProjectId);
  });

  it("refuses it on create too, in the same words a nonexistent project gets", async () => {
    const hidden = await post(createIssue, "http://x/api/issues", fixture.guestId, {
      teamId: secTeamId,
      projectId: secretProjectId,
      title: "Filed into a project I cannot see",
    });
    const missing = await post(createIssue, "http://x/api/issues", fixture.guestId, {
      teamId: secTeamId,
      projectId: "prj_does_not_exist",
      title: "Filed into nothing",
    });

    expect(hidden.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await bodyText(hidden)).toBe(await bodyText(missing));
  });

  it("still allows a project the actor is entitled to name", async () => {
    const response = await patch(projectIssueId, fixture.ownerId, {
      projectId: secretProjectId,
    });
    expect(response.status).toBe(200);

    // Put it back, so the assertions above stay independent of order.
    await patch(projectIssueId, fixture.ownerId, { projectId: openProjectId });
  });
});
