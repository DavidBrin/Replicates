#!/usr/bin/env node
/**
 * Generate `schema.ts` from `schema.sql`.
 *
 * The schema has to exist as a `.sql` file — that is what `psql` takes, what a
 * reviewer wants to read, and what the research notes cite. It also has to
 * exist as a TypeScript module, because reading a file from disk at runtime is
 * exactly the thing that breaks once the server is bundled and deployed: on
 * Vercel the process's working directory is not the repository, and the
 * `.sql` file is not traced into the function unless it is explicitly
 * configured to be.
 *
 * Keeping both by hand would guarantee drift, so the `.sql` is the source and
 * this script derives the module. `schema.test.ts` re-derives it and fails if
 * the committed output disagrees, which makes "I edited the SQL and forgot to
 * regenerate" a red test rather than a schema that silently lags.
 *
 * Run: `npm run build:schema`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "src", "adapters", "db", "schema.sql");
const tsPath = join(here, "..", "src", "adapters", "db", "schema.ts");

/** Escape for a TypeScript template literal. */
export function toModule(sql) {
  const escaped = sql
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  return `// GENERATED FILE — do not edit.
//
// Derived from \`schema.sql\` by \`scripts/build-schema.mjs\`. Edit the SQL and
// run \`npm run build:schema\`; \`schema.test.ts\` fails if the two disagree.
//
// It exists because reading the \`.sql\` from disk at runtime does not survive
// bundling: on Vercel the working directory is not the repository and the file
// is not traced into the function.

/** The complete schema. Idempotent; safe to re-apply to a live database. */
export const SCHEMA_SQL = \`${escaped}\`;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = readFileSync(sqlPath, "utf8");
  writeFileSync(tsPath, toModule(sql), "utf8");
  const lines = sql.split("\n").length;
  console.log(`schema.ts written from schema.sql (${lines} lines)`);
}
