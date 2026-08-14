// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, setDbForTests } from "@/adapters/db";
import { GET as search } from "@/app/api/search/route";
import type { SearchResponse } from "@/components/search/query";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * `/api/search`, called as the plain function it is, against a real PGlite.
 *
 * The claim under test is the one that cannot be checked any other way: **a
 * guest must never see an issue from a team they are not in**, and the check
 * has to survive the query, the limit and the ranking rather than being applied
 * to a page of results that was already wrong.
 *
 * No mocked database and no mocked policy. A mock here would assert that the
 * handler called `can()`, which is a restatement of the implementation; what
 * matters is whether an outsider's search comes back empty when the SQL, the
 * policy table and the workspace's shape are all real.
 *
 * The fixture deliberately mirrors the seed's shape — a public Engineering, a
 * private Design, a guest in exactly one of them — because that is the shape
 * the e2e permission journey drives.
 */

const WORKSPACE = "wsp_search";
const ENG = "tem_search_eng";
const DES = "tem_search_des";
const OWNER = "usr_search_owner";
const GUEST = "usr_search_guest";
const OUTSIDER = "usr_search_outsider";

let db: PgliteDatabase;
let dispose: () => Promise<void>;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  dispose = setDbForTests(db);

  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Search', 'search')",
    [WORKSPACE],
  );

  for (const [id, email, name] of [
    [OWNER, "owner@search.test", "Owner"],
    [GUEST, "guest@search.test", "Guest"],
    [OUTSIDER, "outsider@search.test", "Outsider"],
  ] as const) {
    await db.execute(
      `insert into users (id, email, password_hash, name, display_name)
       values ($1, $2, 'x', $3, lower($3))`,
      [id, email, name],
    );
  }

  await db.execute(
    `insert into workspace_members (workspace_id, user_id, role)
     values ($1, $2, 'owner'), ($1, $3, 'guest')`,
    [WORKSPACE, OWNER, GUEST],
  );
  // The outsider has an account and no membership: `can()` denies by
  // precondition, and the route must answer the same as for a bad workspace.

  await db.execute(
    `insert into teams (id, workspace_id, name, key, private) values
       ($1, $3, 'Engineering', 'ENG', false),
       ($2, $3, 'Design', 'DES', true)`,
    [ENG, DES, WORKSPACE],
  );
  // The guest is in Design only — the private team. So Engineering, which a
  // *member* would see freely, is exactly what they must not see.
  await db.execute(
    "insert into team_members (team_id, user_id, role) values ($1, $2, 'member')",
    [DES, GUEST],
  );

  for (const [teamId, name] of [
    [ENG, "eng"],
    [DES, "des"],
  ] as const) {
    await db.execute(
      `insert into workflow_states (id, team_id, name, type, color, position)
       values ($1, $2, 'Todo', 'unstarted', '#8a8f98', 1)`,
      [`sta_${name}`, teamId],
    );
  }

  await db.execute(
    `insert into issues (id, team_id, number, title, state_id, creator_id, sort_order)
     values
       ('iss_eng_1', $1, 12, 'Cursor drift in the engineering sync', 'sta_eng', $3, 'a0'),
       ('iss_des_1', $2, 3,  'Cursor drift in the design tokens',    'sta_des', $3, 'a0')`,
    [ENG, DES, OWNER],
  );

  await db.execute(
    `insert into projects (id, workspace_id, name, slug_id, summary, sort_order)
     values ('prj_1', $1, 'Realtime Sync', 'realtime-sync-1', 'Cursor drift work', 'a0')`,
    [WORKSPACE],
  );
  await db.execute(
    "insert into project_teams (project_id, team_id) values ('prj_1', $1)",
    [ENG],
  );
}, 60_000);

afterAll(async () => {
  await dispose();
});

/** A GET carrying a real session cookie for `userId`. */
async function get(userId: string, params: Record<string, string>): Promise<Response> {
  const session = await createSession(userId, { db });
  const query = new URLSearchParams({ workspace: "search", ...params });
  return search(
    new Request(`http://localhost/api/search?${query.toString()}`, {
      headers: { cookie: `${sessionCookieName()}=${session.token}` },
    }),
  );
}

async function titles(userId: string, q: string, extra: Record<string, string> = {}) {
  const response = await get(userId, { q, ...extra });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as SearchResponse;
  return payload.groups.flatMap((group) =>
    group.results.map((result) => result.title),
  );
}

/* ============================================================== scoping == */

describe("permission scoping", () => {
  it("shows an owner both teams' issues", () => {
    // The control. Without it, an all-deny bug would make every other
    // assertion in this file pass.
    return expect(titles(OWNER, "cursor drift")).resolves.toEqual(
      expect.arrayContaining([
        "Cursor drift in the engineering sync",
        "Cursor drift in the design tokens",
      ]),
    );
  });

  it("never shows a guest an issue from a team they are not in", async () => {
    const found = await titles(GUEST, "cursor drift");
    expect(found).toContain("Cursor drift in the design tokens");
    expect(found).not.toContain("Cursor drift in the engineering sync");
  });

  it("hides it from a guest searching by its exact identifier too", async () => {
    // The path most likely to bypass a team filter: the identifier branch is a
    // separate `or` clause, and it must sit inside the same team restriction.
    const found = await titles(GUEST, "ENG-12");
    expect(found).toEqual([]);
  });

  it("hides it from a guest searching by bare number within their own team", async () => {
    const found = await titles(GUEST, "12", { team: "ENG" });
    expect(found).toEqual([]);
  });

  it("lets a guest resolve a bare number inside a team they are in", async () => {
    const found = await titles(GUEST, "3", { team: "DES" });
    expect(found).toEqual(["Cursor drift in the design tokens"]);
  });

  it("answers 404 to someone with an account and no membership", async () => {
    // `assemble` in `workspace-access.ts` refuses a non-member outright, so an
    // outsider's search is indistinguishable from a typo'd workspace key —
    // a 403 here would confirm that this workspace exists.
    const response = await get(OUTSIDER, { q: "cursor" });
    expect(response.status).toBe(404);
  });

  it("hides a project reached only through a private team", async () => {
    // The project is attached to Engineering, which the guest cannot see, so
    // footnote 11's roll-up denies it.
    const owner = await titles(OWNER, "Realtime");
    expect(owner).toContain("Realtime Sync");

    const guest = await titles(GUEST, "Realtime");
    expect(guest).toEqual([]);
  });

  it("refuses an anonymous request", async () => {
    const response = await search(
      new Request("http://localhost/api/search?workspace=search&q=cursor"),
    );
    expect(response.status).toBe(401);
  });

  it("answers 404 for a workspace that does not exist", async () => {
    // Indistinguishable from "you are not a member", so the endpoint cannot be
    // used to enumerate workspace keys.
    const session = await createSession(OWNER, { db });
    const response = await search(
      new Request("http://localhost/api/search?workspace=nope&q=cursor", {
        headers: { cookie: `${sessionCookieName()}=${session.token}` },
      }),
    );
    expect(response.status).toBe(404);
  });
});

/* ============================================================== ranking == */

describe("results", () => {
  it("groups issues and projects separately", async () => {
    const response = await get(OWNER, { q: "sync" });
    const payload = (await response.json()) as SearchResponse;
    expect(payload.groups.map((group) => group.type)).toEqual(["issue", "project"]);
  });

  it("puts an exact identifier hit first", async () => {
    const found = await titles(OWNER, "ENG-12");
    expect(found[0]).toBe("Cursor drift in the engineering sync");
  });

  it("accepts the dashless identifier shorthand", async () => {
    const found = await titles(OWNER, "eng12");
    expect(found).toContain("Cursor drift in the engineering sync");
  });

  it("returns an empty result set for a query below the threshold", async () => {
    const response = await get(OWNER, { q: "c" });
    const payload = (await response.json()) as SearchResponse;
    expect(payload.groups).toEqual([]);
  });

  it("matches a project by its summary as well as its name", async () => {
    const found = await titles(OWNER, "Cursor drift work");
    expect(found).toContain("Realtime Sync");
  });

  it("treats a typed percent sign as a character, not a wildcard", async () => {
    const found = await titles(OWNER, "100%");
    expect(found).toEqual([]);
  });
});
