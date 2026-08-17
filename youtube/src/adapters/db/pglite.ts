import "server-only";

import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

import { SCHEMA_SQL } from "./schema.generated";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "./driver";

/**
 * Postgres compiled to WebAssembly, running in this process.
 *
 * Same parser, same planner, same collation as the Neon deployment. A fresh
 * clone runs with no service to install and no container, and the local suite
 * still exercises the semantics the deployed engine has.
 *
 * The import is through a variable specifier so that no bundler follows it —
 * PGlite ships a multi-megabyte WASM payload that does not survive being
 * traced and re-bundled, and `serverExternalPackages` in `next.config.ts`
 * covers the case where that indirection is ever simplified away.
 */

type PGliteInstance = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
};

const PGLITE_SPECIFIER = "@electric-sql/pglite";

async function loadPGlite(dataDir: string): Promise<PGliteInstance> {
  const mod = (await import(/* webpackIgnore: true */ PGLITE_SPECIFIER)) as {
    PGlite: new (dataDir?: string) => PGliteInstance;
  };

  if (dataDir === ":memory:") return new mod.PGlite(undefined);

  /**
   * Create the directory first, because PGlite will not.
   *
   * Its node filesystem backend calls a plain `mkdirSync` — not a recursive
   * one — so a `dataDir` whose *parent* is missing fails with `ENOENT` before
   * a single statement runs. The default is `.data/db` and `.data` is
   * gitignored, so this is the state of every fresh clone: the exact path that
   * `pnpm install && pnpm dev` takes, and the exact promise this project makes
   * about booting against an empty environment.
   *
   * It presented as 32 unrelated route tests failing at once, which is how
   * long it took to notice that nothing had ever created the directory — the
   * suites that pass use `:memory:`, and the developer machine that first ran
   * it had a `.data` left over from an earlier experiment.
   */
  await mkdir(dataDir, { recursive: true });
  return new mod.PGlite(dataDir);
}

/**
 * PGlite is single-connection and serialises internally, but it does not
 * serialise *across awaits*. Two repository calls interleaved by the event
 * loop can therefore both be inside `begin` at once, and the second `commit`
 * fails with "no transaction in progress" — or worse, one caller's rollback
 * discards the other's writes.
 *
 * A promise chain is the whole fix: every transaction queues behind the last.
 * Neon needs nothing like it because each transaction there has its own
 * connection.
 */
class TransactionQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    // Swallow on the chain only — the caller still sees the rejection.
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

class PGliteDatabase implements SqlDatabase {
  private readonly queue = new TransactionQueue();

  constructor(private readonly db: PGliteInstance) {}

  async query<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    const result = await this.db.query<T>(sql, [...params]);
    return result.rows;
  }

  async execute(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<number> {
    const result = await this.db.query(sql, [...params]);
    return result.affectedRows ?? 0;
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      await this.db.query("begin");
      try {
        const out = await fn(this);
        await this.db.query("commit");
        return out;
      } catch (error) {
        await this.db.query("rollback").catch(() => {
          /* The original error is the interesting one. */
        });
        throw error;
      }
    });
  }

  /**
   * Apply the schema, rebuilding the database when the schema has changed.
   *
   * `schema.sql` is written entirely in `create table if not exists` form,
   * which makes re-applying it free — and which means an **existing** database
   * never gains a column added since it was created. The statement succeeds,
   * reports nothing, and leaves a table one column short of what every query
   * now expects.
   *
   * That is not hypothetical: it is how this application started answering
   * `column ch.verified does not exist` on every feed while all 1,800 tests
   * stayed green. The tests never see it because each one builds a database
   * from nothing; only a developer with a `.data/` older than the last schema
   * change does.
   *
   * So the schema is fingerprinted. A changed fingerprint drops and rebuilds,
   * which is safe here for a specific reason rather than by assumption:
   * `.data/` is gitignored, disposable, and reproducible with `pnpm seed`. It
   * holds a demo corpus, never anything a person authored.
   *
   * **PGlite only.** Neon's implementation deliberately refuses instead — a
   * deployed database with real rows in it needs a migration, and a tool that
   * would drop it is worse than no tool at all.
   */
  async migrate(): Promise<void> {
    const schema = await readSchema();
    const fingerprint = createHash("sha256")
      .update(schema)
      .digest("hex")
      .slice(0, 32);

    await this.db.exec(
      `create table if not exists schema_meta (
         id          integer primary key check (id = 1),
         fingerprint text not null
       );`,
    );

    const rows = await this.db.query<{ fingerprint: string }>(
      "select fingerprint from schema_meta where id = 1",
    );
    const stored = rows.rows[0]?.fingerprint;

    if (stored !== undefined && stored !== fingerprint) {
      console.warn(
        `[db] schema changed (${stored} → ${fingerprint}); rebuilding the ` +
          `local database. Run \`pnpm seed\` to repopulate it.`,
      );
      // `cascade` because every table has foreign keys into another; dropping
      // the schema and recreating it is the only ordering-free way to do this.
      await this.db.exec("drop schema public cascade; create schema public;");
      await this.db.exec(
        `create table if not exists schema_meta (
           id          integer primary key check (id = 1),
           fingerprint text not null
         );`,
      );
    }

    await this.db.exec(schema);
    await this.db.query(
      `insert into schema_meta (id, fingerprint) values (1, $1)
         on conflict (id) do update set fingerprint = excluded.fingerprint`,
      [fingerprint],
    );
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * The schema, as a module rather than a file read.
 *
 * This used to be `readFile(fileURLToPath(new URL("./schema.sql",
 * import.meta.url)))`, which works under Node, under Vitest, and under
 * `node --experimental-strip-types` — and fails under the bundler the
 * application actually runs on, for two independent reasons:
 *
 *   1. Turbopack's `URL` is from a different realm than the one
 *      `fileURLToPath` type-checks, so the call throws
 *      `ERR_INVALID_ARG_TYPE: Received an instance of URL` and every
 *      database-backed route 500s.
 *   2. A `.sql` file is not an import, so nothing traces it into a serverless
 *      bundle — it would simply be absent from a deployment.
 *
 * A suite of 1,814 tests did not catch either, because every test imports this
 * module directly and never crosses the bundler. That is the lesson worth
 * keeping: unit tests cannot see a packaging failure, and only booting the
 * built application can.
 *
 * `schema.sql` remains the source of truth; `prebuild` regenerates the module
 * from it so the two cannot drift.
 */
export async function readSchema(): Promise<string> {
  return SCHEMA_SQL;
}

export async function createPGliteDatabase(
  dataDir: string,
): Promise<SqlDatabase> {
  return new PGliteDatabase(await loadPGlite(dataDir));
}
