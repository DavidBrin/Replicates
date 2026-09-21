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
 * Drift guard and "does it apply": `schema.ts` is generated from
 * `schema.sql`, and nothing but this test stops an edit to the SQL from
 * leaving the deployed schema one revision behind.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "schema.sql");
const tsPath = join(here, "..", "schema.ts");

describe("generated module", () => {
  it("matches schema.sql", () => {
    const expected = toModule(readFileSync(sqlPath, "utf8"));
    const actual = readFileSync(tsPath, "utf8");
    expect(actual, "schema.ts is stale — run `pnpm run build:schema`").toBe(expected);
  });

  it("round-trips the SQL through template-literal escaping", () => {
    expect(SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS maps");
    expect(SCHEMA_SQL).not.toContain("\\`");
  });
});

describe("applying the schema", () => {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);

  afterAll(async () => {
    await db.close();
  });

  it("applies to a fresh database and creates exactly the maps table", async () => {
    await db.migrate();
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    // D38: no challenge_records, no per-week row — maps is the only table.
    expect(tables.map((row) => row.table_name)).toEqual(["maps"]);
  });

  it("has the columns the repository writes", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'maps' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "name",
      "author",
      "definition",
      "players",
      "width",
      "height",
      "biome",
      "created_at",
    ]);
  });

  it("is idempotent", async () => {
    await expect(db.migrate()).resolves.toBeUndefined();
    await expect(db.migrate()).resolves.toBeUndefined();
  });

  it("adds biome to a table created before the column existed", async () => {
    const legacy = new PgliteDatabase(
      ":memory:",
      `create table maps (id text primary key, name text not null, author text not null,
        definition jsonb not null, players integer not null, width integer not null,
        height integer not null, created_at timestamptz not null default now());`,
    );
    try {
      await legacy.migrate();
      await legacy.execute(
        `insert into maps (id, name, author, definition, players, width, height)
         values ('old', 'Old', 'a', '{}'::jsonb, 2, 6, 6)`,
      );
      const upgraded = new PgliteDatabase(":memory:", SCHEMA_SQL);
      void upgraded;
      for (const statement of splitStatements(SCHEMA_SQL)) {
        await legacy.execute(statement);
      }
      const rows = await legacy.query<{ biome: string }>("select biome from maps where id = 'old'");
      expect(rows).toEqual([{ biome: "grass" }]);
    } finally {
      await legacy.close();
    }
  });

  it("splits into the statements it looks like it has", () => {
    const statements = splitStatements(SCHEMA_SQL);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/CREATE TABLE IF NOT EXISTS maps/);
  });
});
