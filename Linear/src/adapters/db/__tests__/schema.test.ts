// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { splitStatements } from "../driver";
import { PgliteDatabase } from "../pglite";
import { SCHEMA_SQL } from "../schema";
import { toModule } from "../../../../scripts/build-schema.mjs";

/**
 * The schema's own tests.
 *
 * Two jobs. The first is a drift guard: `schema.ts` is generated from
 * `schema.sql`, and nothing stops someone editing the SQL and forgetting to
 * regenerate — which would leave the deployed schema silently one revision
 * behind the file everyone reads. Re-deriving here turns that into a red test.
 *
 * The second is that the schema actually applies. It is not obvious: the file
 * is written for Postgres and applied by an embedded WASM build of it, and the
 * three extensions the research lane's draft assumed (`citext`, `pgcrypto`,
 * `pg_trgm`) are not in PGlite's bundle at all.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "schema.sql");
const tsPath = join(here, "..", "schema.ts");

describe("generated module", () => {
  it("matches schema.sql", () => {
    const expected = toModule(readFileSync(sqlPath, "utf8"));
    const actual = readFileSync(tsPath, "utf8");
    expect(
      actual,
      "schema.ts is stale — run `npm run build:schema`",
    ).toBe(expected);
  });

  it("round-trips the SQL through template-literal escaping", () => {
    // Backticks and `${` in the SQL would otherwise terminate the literal or
    // interpolate. The schema has neither today; this fails the moment one is
    // added without the escaping keeping up.
    expect(SCHEMA_SQL).toContain("create table if not exists issues");
    expect(SCHEMA_SQL).not.toContain("\\`");
  });
});

describe("applying the schema", () => {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);

  afterAll(async () => {
    await db.close();
  });

  it("applies to a fresh database", async () => {
    await db.migrate();
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    expect(tables.length).toBeGreaterThanOrEqual(24);
    const names = tables.map((row) => row.table_name);
    for (const required of [
      "users",
      "workspaces",
      "workspace_members",
      "teams",
      "team_members",
      "workflow_states",
      "issues",
      "issue_labels",
      "projects",
      "project_members",
      "comments",
      "activities",
      "notifications",
      "change_events",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("is idempotent", async () => {
    // The Vercel build command applies it on every deploy, so a second run
    // against a populated database must be a no-op rather than an error.
    await expect(db.migrate()).resolves.toBeUndefined();
    await expect(db.migrate()).resolves.toBeUndefined();
  });

  it("splits into the statements it looks like it has", () => {
    const statements = splitStatements(SCHEMA_SQL);
    // Semicolons inside comments and inside the `do $$ … $$` enum guards must
    // not split a statement in half.
    expect(statements.length).toBeGreaterThan(60);
    expect(statements.every((s) => s.trim().length > 0)).toBe(true);
    const enumGuards = statements.filter((s) => s.includes("create type"));
    expect(enumGuards.length).toBe(9);
    for (const guard of enumGuards) {
      expect(guard).toContain("exception when duplicate_object");
    }
  });

  it("enforces the per-team issue number uniqueness", async () => {
    await db.query(
      `insert into users (id, email, password_hash, name, display_name)
       values ('usr_1','a@b.c','x','A','a') on conflict do nothing`,
    );
    await db.query(
      `insert into workspaces (id, name, url_key)
       values ('wsp_1','W','w') on conflict do nothing`,
    );
    await db.query(
      `insert into teams (id, workspace_id, name, key)
       values ('tem_1','wsp_1','T','ENG') on conflict do nothing`,
    );
    await db.query(
      `insert into workflow_states (id, team_id, name, type, color)
       values ('sta_1','tem_1','Todo','unstarted','#8a8f98')
       on conflict do nothing`,
    );

    const insert = (id: string, number: number) =>
      db.query(
        `insert into issues (id, team_id, number, title, state_id, creator_id, sort_order)
         values ($1,'tem_1',$2,'t','sta_1','usr_1','a0')`,
        [id, number],
      );

    await insert("iss_1", 1);
    await expect(insert("iss_2", 1)).rejects.toThrow();
  });

  /**
   * The one join where two independent foreign keys are not enough.
   *
   * `project_teams.project_id` and `.team_id` are each satisfied by a row from
   * any workspace, so the pair is a legal row as far as either constraint can
   * see — and an attached team decides who may read the project, which makes a
   * cross-workspace attachment a tenancy breach rather than a stray row. The
   * route refuses it too; this asserts the *data* cannot hold it even if some
   * future call site forgets.
   */
  it("refuses a project_teams row that crosses a workspace boundary", async () => {
    await db.query(
      `insert into workspaces (id, name, url_key)
       values ('wsp_2','W2','w2') on conflict do nothing`,
    );
    await db.query(
      `insert into teams (id, workspace_id, name, key)
       values ('tem_2','wsp_2','Other','OTH') on conflict do nothing`,
    );
    await db.query(
      `insert into projects (id, workspace_id, name, slug_id, sort_order)
       values ('prj_1','wsp_1','P','p','a0') on conflict do nothing`,
    );

    await expect(
      db.query(
        `insert into project_teams (project_id, team_id) values ('prj_1','tem_2')`,
      ),
    ).rejects.toThrow();

    // …and the same-workspace row is accepted, with the workspace derived
    // rather than supplied: the repository's insert names two columns.
    await db.query(
      `insert into project_teams (project_id, team_id) values ('prj_1','tem_1')`,
    );
    const rows = await db.query<{ workspace_id: string }>(
      `select workspace_id from project_teams where project_id = 'prj_1'`,
    );
    expect(rows).toStrictEqual([{ workspace_id: "wsp_1" }]);
  });

  it("keeps order keys byte-ordered under the declared collation", async () => {
    // The value of this assertion is limited and worth being honest about:
    // PGlite's default collation is already byte-wise, so this passes here
    // whether or not the column declares `collate "C"`. Postgres' default ICU
    // collation is not, and would sort `Zz` last. The declaration on the
    // column is what makes the deployed engine agree with this result.
    await db.query(`create temp table k (v text collate "C")`);
    await db.query(`insert into k (v) values ('Zz'),('a0'),('a1'),('b00')`);
    const rows = await db.query<{ v: string }>(`select v from k order by v`);
    expect(rows.map((r) => r.v)).toEqual(["Zz", "a0", "a1", "b00"]);
  });

  it("refuses a colour that is not six hex digits", async () => {
    // The second of the two enforcements. The API validates colours
    // (`domain/color.ts`), and this constraint is what holds when a future
    // call site forgets to — the reason the rule is written down twice.
    //
    // Asserted by an insert that must actually be rejected: a `check` that was
    // never added, or added against the wrong column, leaves a migration just
    // as green as one that works.
    await db.query(
      `insert into workspaces (id, name, url_key) values ('wsp_c','C','c')
       on conflict do nothing`,
    );

    await expect(
      db.query(
        `insert into teams (id, workspace_id, name, key, color)
         values ('tem_c','wsp_c','Colour','CLR','url(//attacker.example/x)')`,
      ),
      "a url() payload must not be storable as a colour",
    ).rejects.toThrow();

    // Named colours and shorthand are refused too — they are valid CSS, which
    // is exactly the point: the rule is a whitelist of one shape, not a list
    // of dangerous forms to keep up to date.
    for (const bad of ["red", "#fff", "var(--bg-app)"]) {
      await expect(
        db.query(
          `insert into teams (id, workspace_id, name, key, color)
           values ('tem_bad','wsp_c','Bad','BAD',$1)`,
          [bad],
        ),
      ).rejects.toThrow();
    }

    // …and a real colour still goes in, so the constraint is not simply
    // rejecting everything.
    await db.query(
      `insert into teams (id, workspace_id, name, key, color)
       values ('tem_ok','wsp_c','Okay','OKY','#5e6ad2')`,
    );
    const rows = await db.query<{ color: string }>(
      `select color from teams where id = 'tem_ok'`,
    );
    expect(rows).toStrictEqual([{ color: "#5e6ad2" }]);
  });
});
