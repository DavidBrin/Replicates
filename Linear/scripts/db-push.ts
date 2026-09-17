#!/usr/bin/env node
/**
 * Apply `schema.sql` to whichever database is configured.
 *
 * Run by `npm run db:push` and by the Vercel build command, where it runs
 * against Neon before the deployment goes live. Every statement in the schema
 * is idempotent, so applying it on every deploy is safe — and doing it in the
 * build rather than on first request matters: Hobby builds one deployment at a
 * time, which makes this race-free, while a function that migrates on cold
 * start migrates once per instance from however many happen to be warming.
 *
 * ## Why this does not reuse `adapters/db`
 *
 * It would be the obvious thing, and it does not work. `package.json` runs this
 * with `node --experimental-strip-types`, which erases types and refuses
 * anything that needs code generation. Two things in that path are exactly
 * that:
 *
 * - `PgliteDatabase` and `NeonDatabase` use TypeScript **parameter properties**
 *   (`constructor(private readonly dataDir: string)`). Node rejects them
 *   outright: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
 * - Every module under `adapters/db` starts with `import "server-only"`, whose
 *   package resolves — under any condition except React's `react-server` — to a
 *   file that throws on import. That guard is right for the bundler and fatal
 *   for a plain Node process.
 *
 * So this script talks to the two drivers directly, and reads `schema.sql` off
 * disk rather than importing the generated `schema.ts`. Reading the file is
 * what the *runtime* cannot do — on Vercel the function's working directory is
 * not the repository — but this runs during the build, in the checkout, where
 * the file is right there. It also removes a resolution problem that has no
 * clean answer: Node's ESM loader requires the `.ts` extension on a relative
 * import, and `tsc` rejects one unless `allowImportingTsExtensions` is set.
 *
 * The schema is executed as **one script** rather than statement by statement.
 * Both drivers accept that (PGlite's `exec`, and the simple query protocol over
 * Neon's WebSocket), and it avoids carrying a second copy of the statement
 * splitter that lives behind `server-only` in `driver.ts`. The cost is that an
 * error names a position rather than a statement, which {@link report} turns
 * back into a line and its surrounding text.
 */

import { readFileSync } from "node:fs";

const SCHEMA_SQL = readFileSync(
  new URL("../src/adapters/db/schema.sql", import.meta.url),
  "utf8",
);

/**
 * The only place outside `src/config/env.ts` that reads the environment.
 *
 * That rule is scoped to `src/` — a build script has no `config()` available to
 * it, for the reasons above. The three variables read here are the same three
 * with the same meanings, and the production guard is repeated verbatim
 * because it is the one that matters: PGlite's storage does not survive a
 * serverless invocation, so a deployment that fell back to it would serve
 * traffic while forgetting every write.
 */
interface Target {
  readonly driver: "pglite" | "neon";
  readonly url: string | undefined;
  readonly dataDir: string;
}

function resolveTarget(): Target {
  const url = process.env["DATABASE_URL"]?.trim() || undefined;
  const requested = process.env["DB_DRIVER"]?.trim().toLowerCase();
  const driver = requested ?? (url ? "neon" : "pglite");

  if (driver !== "pglite" && driver !== "neon") {
    throw new Error(`DB_DRIVER must be pglite or neon, got "${requested}"`);
  }
  if (driver === "neon" && !url) {
    throw new Error("DB_DRIVER=neon requires DATABASE_URL");
  }
  if (driver === "pglite" && process.env["NODE_ENV"] === "production") {
    throw new Error(
      "DB_DRIVER=pglite cannot be used in production: its storage does not " +
        "survive a serverless invocation. Set DATABASE_URL.",
    );
  }

  return {
    driver,
    url,
    dataDir: process.env["DB_DATA_DIR"]?.trim() || ".data/linear",
  };
}

/* ------------------------------------------------------------- drivers -- */

interface PgliteLike {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

async function applyToPglite(dataDir: string): Promise<void> {
  const { PGlite } = (await import("@electric-sql/pglite")) as unknown as {
    PGlite: new (dataDir?: string) => PgliteLike;
  };
  const db = dataDir === ":memory:" ? new PGlite() : new PGlite(dataDir);
  try {
    await db.exec(SCHEMA_SQL);
  } finally {
    await db.close();
  }
}

interface NeonClientLike {
  query(sql: string): Promise<unknown>;
  release(): void;
}

interface NeonPoolLike {
  connect(): Promise<NeonClientLike>;
  end(): Promise<void>;
}

async function applyToNeon(connectionString: string): Promise<void> {
  const neon = (await import("@neondatabase/serverless")) as unknown as {
    Pool: new (config: { connectionString: string }) => NeonPoolLike;
    neonConfig: { webSocketConstructor?: unknown };
  };

  if (typeof globalThis.WebSocket === "undefined") {
    // Node has had a global WebSocket since 22, so this is a fallback for a
    // build image running something older rather than the expected path.
    // Specifier is a variable so `tsc` does not look for a `ws` package
    // that this project does not declare (same pattern as adapters/db/neon.ts).
    const wsSpecifier = "ws";
    const ws = (await import(/* webpackIgnore: true */ wsSpecifier)) as {
      default: unknown;
    };
    neon.neonConfig.webSocketConstructor = ws.default;
  }

  const pool = new neon.Pool({ connectionString });
  try {
    // A pooled `query()` would go over HTTP, which takes one statement. A
    // connection is a real Postgres session, and the simple query protocol
    // accepts the whole script.
    const client = await pool.connect();
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/* --------------------------------------------------------------- error -- */

/**
 * Turn a Postgres error into something that points at the schema.
 *
 * Postgres reports a character offset into the statement it was given; since
 * the statement is the whole file, that offset is a line number in
 * `schema.sql`. Printing the line and its neighbours is the difference between
 * "syntax error at or near ..." and knowing which `create table` broke.
 */
function report(error: unknown): string {
  const position = Number(
    (error as { position?: string | number } | null)?.position ?? Number.NaN,
  );
  const message = error instanceof Error ? error.message : String(error);
  if (!Number.isFinite(position)) return message;

  const upTo = SCHEMA_SQL.slice(0, position);
  const line = upTo.split("\n").length;
  const lines = SCHEMA_SQL.split("\n");
  const context = lines
    .slice(Math.max(0, line - 3), line + 2)
    .map((text, index) => `  ${Math.max(1, line - 2) + index} | ${text}`)
    .join("\n");
  return `${message}\n\nschema.sql:${line}\n${context}`;
}

/* ---------------------------------------------------------------- main -- */

async function main(): Promise<void> {
  const target = resolveTarget();
  const label =
    target.driver === "neon"
      ? // Never the connection string: it carries a password, and this output
        // goes into a build log that is retained and shared.
        "neon"
      : `pglite (${target.dataDir})`;

  process.stdout.write(`Applying schema to ${label}…\n`);
  const started = Date.now();

  try {
    if (target.driver === "neon") {
      await applyToNeon(target.url as string);
    } else {
      await applyToPglite(target.dataDir);
    }
  } catch (error) {
    process.stderr.write(`Schema failed.\n${report(error)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Schema applied in ${Date.now() - started}ms.\n`);
}

await main();
