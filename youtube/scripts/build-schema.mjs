#!/usr/bin/env node
/**
 * Compile `schema.sql` into a TypeScript module.
 *
 * The schema used to be read at runtime with
 * `readFile(fileURLToPath(new URL("./schema.sql", import.meta.url)))`. That
 * works under Node, under Vitest, and under `node --experimental-strip-types`
 * — which is why a suite of 1,814 tests never noticed it was broken — and it
 * fails under the bundler the application actually runs on, in two separate
 * ways:
 *
 *   1. **Turbopack.** Its `URL` comes from a different realm than the one
 *      `fileURLToPath` type-checks against, so the call throws
 *      `ERR_INVALID_ARG_TYPE: Received an instance of URL` before a statement
 *      runs. Every database-backed route 500s. The tests miss it because they
 *      import the module directly and never go through the bundler.
 *   2. **Deployment.** A `.sql` file is not an import, so nothing traces it
 *      into a serverless bundle. Even with the realm problem fixed, the file
 *      would simply not be there.
 *
 * Generating a module solves both, because a module is something every
 * bundler already knows how to follow. The generated file is committed so a
 * fresh clone needs no build step before its first test run, and `prebuild`
 * regenerates it so it cannot drift from the `.sql` that remains the source of
 * truth.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = fileURLToPath(new URL("src/adapters/db/schema.sql", root));
const target = fileURLToPath(new URL("src/adapters/db/schema.generated.ts", root));

const sql = await readFile(source, "utf8");

// A backtick or a `${` in the SQL would end the template literal early. None
// appear today, and escaping is cheaper than a generated file that silently
// stops being valid TypeScript the day someone writes one.
const escaped = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const output = `// GENERATED FILE — do not edit.
//
// Written by \`scripts/build-schema.mjs\` from \`src/adapters/db/schema.sql\`,
// which is the source of truth. Regenerate with \`pnpm run build:schema\`;
// \`prebuild\` does it automatically so a deployment cannot ship a stale copy.
//
// This exists because the schema cannot be read from disk at runtime — see the
// generator's header for the two independent reasons why.

export const SCHEMA_SQL = \`${escaped}\`;
`;

await writeFile(target, output, "utf8");

const statements = sql.split(";").filter((s) => s.trim().length > 0).length;
console.log(
  `build-schema: ${sql.length} bytes, ~${statements} statements → src/adapters/db/schema.generated.ts`,
);
