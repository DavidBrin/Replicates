// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgliteDatabase } from "@/adapters/db/pglite";
import { SCHEMA_SQL } from "@/adapters/db/schema";
import type { SqlDatabase } from "@/adapters/db/driver";
import { issueFilterSql } from "@/domain/filters";

/**
 * The filter translator, checked two ways.
 *
 * The first half asserts on the generated fragment — that a value never appears
 * in the text, that the placeholder numbering starts where the caller said, that
 * `[null]` becomes `is null`. The second half runs the fragments against a real
 * Postgres, because a `where` clause that is wrong is usually wrong by *parsing*
 * — an `in ()` with no values, a parameter whose type cannot be inferred — and
 * a string comparison cannot see that.
 */

let db: SqlDatabase;

/** Run a filter and return the ids it matched, in a stable order. */
async function run(
  filter: Parameters<typeof issueFilterSql>[0],
): Promise<string[]> {
  const fragment = issueFilterSql(filter, { alias: "i", startIndex: 1 });
  const rows = await db.query<{ id: string }>(
    `select i.id from issues i where ${fragment.text} order by i.id asc`,
    [...fragment.params],
  );
  return rows.map((row) => row.id);
}

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();

  await db.execute(
    `insert into users (id, email, password_hash, name, display_name, avatar_color)
     values ('usr_a','a@x.test','h','Ann','ann','#5e6ad2'),
            ('usr_b','b@x.test','h','Bob','bob','#5e6ad2')`,
  );
  await db.execute(
    `insert into workspaces (id, name, url_key) values ('wsp_1','W','w')`,
  );
  await db.execute(
    `insert into teams (id, workspace_id, name, key) values
       ('tem_1','wsp_1','Eng','ENG'), ('tem_2','wsp_1','Ops','OPS')`,
  );
  await db.execute(
    `insert into workflow_states (id, team_id, name, type, color, position) values
       ('sta_todo','tem_1','Todo','unstarted','#e2e2e2',0),
       ('sta_doing','tem_1','In Progress','started','#f2c94c',1),
       ('sta_done','tem_1','Done','completed','#5e6ad2',2),
       ('sta_ops','tem_2','Todo','unstarted','#e2e2e2',0)`,
  );
  await db.execute(
    `insert into labels (id, workspace_id, team_id, name, color) values
       ('lbl_bug','wsp_1',null,'Bug','#eb5757'),
       ('lbl_ux','wsp_1',null,'UX','#26b5ce')`,
  );
  await db.execute(
    `insert into projects (id, workspace_id, name, slug_id, sort_order)
     values ('prj_1','wsp_1','Sync','sync-1','a0')`,
  );

  // Six issues chosen so every filter below has both a match and a non-match.
  await db.execute(
    `insert into issues (id, team_id, number, title, description, state_id,
                         priority, assignee_id, creator_id, project_id,
                         estimate, due_date, sort_order, created_at, updated_at,
                         archived_at, trashed_at, parent_id)
     values
      ('iss_1','tem_1',1,'Fix the login loop','a bug in auth','sta_todo',1,
        'usr_a','usr_a','prj_1',3,'2026-04-01','a0',
        '2026-03-01T00:00:00Z','2026-03-10T00:00:00Z',null,null,null),
      ('iss_2','tem_1',2,'Unassigned drifting order','','sta_doing',0,
        null,'usr_a',null,null,null,'a1',
        '2026-03-02T00:00:00Z','2026-03-11T00:00:00Z',null,null,null),
      ('iss_3','tem_1',3,'Done and dusted','','sta_done',3,
        'usr_b','usr_b','prj_1',5,'2026-05-01','a2',
        '2026-03-03T00:00:00Z','2026-03-12T00:00:00Z',null,null,null),
      ('iss_4','tem_2',1,'Ops runbook','','sta_ops',2,
        'usr_b','usr_a',null,null,null,'a3',
        '2026-03-04T00:00:00Z','2026-03-13T00:00:00Z',null,null,null),
      ('iss_5','tem_1',4,'Archived work','','sta_todo',4,
        null,'usr_a',null,null,null,'a4',
        '2026-03-05T00:00:00Z','2026-03-14T00:00:00Z',
        '2026-03-15T00:00:00Z',null,null),
      ('iss_6','tem_1',5,'A sub-issue','','sta_todo',2,
        'usr_a','usr_a',null,null,null,'a5',
        '2026-03-06T00:00:00Z','2026-03-15T00:00:00Z',null,null,'iss_1')`,
  );
  await db.execute(
    `insert into issue_labels (issue_id, label_id) values
       ('iss_1','lbl_bug'), ('iss_3','lbl_ux')`,
  );
  await db.execute(
    `insert into issue_subscribers (issue_id, user_id) values ('iss_3','usr_a')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe("the shape of the fragment", () => {
  it("matches everything when nothing but the defaults apply", () => {
    const fragment = issueFilterSql({});
    expect(fragment.params).toEqual([]);
    expect(fragment.text).toContain("i.trashed_at is null");
    expect(fragment.text).toContain("i.archived_at is null");
    expect(fragment.text).toContain("i.parent_id is null");
  });

  it("numbers placeholders from the index the caller asked for", () => {
    const fragment = issueFilterSql(
      { teamIds: ["tem_1", "tem_2"] },
      { startIndex: 4 },
    );
    expect(fragment.text).toContain("i.team_id in ($4, $5)");
    expect(fragment.params).toEqual(["tem_1", "tem_2"]);
  });

  it("honours the alias, and refuses one that is not an identifier", () => {
    expect(issueFilterSql({}, { alias: "iss" }).text).toContain("iss.trashed_at");
    expect(() => issueFilterSql({}, { alias: "i; drop table issues; --" })).toThrow(
      /Unsafe SQL alias/,
    );
  });

  it("never puts a value in the text, only in the params", () => {
    const hostile = "'; drop table issues; --";
    const fragment = issueFilterSql({
      query: hostile,
      teamIds: [hostile],
      priorities: [1],
    });
    expect(fragment.text).not.toContain("drop table");
    expect(fragment.params).toContain(hostile);
  });

  it("treats an explicitly empty set as matching nothing", () => {
    // "state is any of ∅" is false. Widening it back to "no constraint" would
    // make a cleared filter chip silently show the whole workspace.
    expect(issueFilterSql({ stateIds: [] }).text).toContain("false");
  });

  it("drops an out-of-range priority rather than widening the result", () => {
    const fragment = issueFilterSql({ priorities: [9 as 1] });
    expect(fragment.text).toContain("false");
    expect(fragment.params).toEqual([]);
  });
});

describe("against a real database", () => {
  it("hides archived and sub-issues by default, and never shows trashed", async () => {
    expect(await run({})).toEqual(["iss_1", "iss_2", "iss_3", "iss_4"]);
  });

  it("includes archived on request", async () => {
    expect(await run({ includeArchived: true })).toContain("iss_5");
  });

  it("includes sub-issues on request", async () => {
    expect(await run({ includeSubIssues: true })).toContain("iss_6");
  });

  it("ANDs across fields and ORs within one", async () => {
    expect(
      await run({ teamIds: ["tem_1"], priorities: [1, 3] }),
    ).toEqual(["iss_1", "iss_3"]);
  });

  it("finds unassigned issues from `assigneeIds: [null]`", async () => {
    // `assignee_id in (null)` is *unknown*, not true, so the obvious
    // translation of this filter silently matches nothing.
    expect(await run({ assigneeIds: [null] })).toEqual(["iss_2"]);
  });

  it("combines a named assignee with unassigned", async () => {
    expect(await run({ assigneeIds: ["usr_a", null] })).toEqual([
      "iss_1",
      "iss_2",
    ]);
  });

  it("finds issues with no project the same way", async () => {
    expect(await run({ projectIds: [null] })).toEqual(["iss_2", "iss_4"]);
  });

  it("filters by state type through the join", async () => {
    expect(await run({ stateTypes: ["started", "completed"] })).toEqual([
      "iss_2",
      "iss_3",
    ]);
  });

  it("filters by label, and by the absence of one", async () => {
    expect(await run({ labelIds: ["lbl_bug"] })).toEqual(["iss_1"]);
    expect(await run({ notLabelIds: ["lbl_bug"] })).toEqual([
      "iss_2",
      "iss_3",
      "iss_4",
    ]);
  });

  it("filters by subscriber", async () => {
    expect(await run({ subscriberIds: ["usr_a"] })).toEqual(["iss_3"]);
  });

  it("filters by due date, inclusively at both ends", async () => {
    expect(await run({ dueBefore: "2026-04-01" })).toEqual(["iss_1"]);
    expect(await run({ dueAfter: "2026-05-01" })).toEqual(["iss_3"]);
  });

  it("filters by creation and update time", async () => {
    expect(await run({ createdAfter: "2026-03-03T00:00:00Z" })).toEqual([
      "iss_3",
      "iss_4",
    ]);
    expect(await run({ updatedAfter: "2026-03-12T00:00:00Z" })).toEqual([
      "iss_3",
      "iss_4",
    ]);
  });

  it("searches title, description and identifier", async () => {
    expect(await run({ query: "login" })).toEqual(["iss_1"]);
    expect(await run({ query: "bug in auth" })).toEqual(["iss_1"]);
    expect(await run({ query: "eng-2" })).toEqual(["iss_2"]);
  });

  it("treats wildcards in a search term as literal characters", async () => {
    // Without escaping, a query of `%` matches every issue — which reads as
    // "search is broken" rather than as a clever filter.
    expect(await run({ query: "%" })).toEqual([]);
    expect(await run({ query: "_" })).toEqual([]);
  });

  it("survives a search term that is trying to be SQL", async () => {
    expect(await run({ query: "'; drop table issues; --" })).toEqual([]);
    const survived = await db.query<{ n: number }>(
      `select count(*) as n from issues`,
    );
    expect(survived[0]?.n).toBe(6);
  });

  it("matches nothing for an empty set, without a syntax error", async () => {
    // `in ()` does not parse. This is the assertion that catches a translator
    // that emits it.
    expect(await run({ stateIds: [] })).toEqual([]);
    expect(await run({ labelIds: [] })).toEqual([]);
    expect(await run({ assigneeIds: [] })).toEqual([]);
  });
});
