import "server-only";

import {
  splitStatements,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlValue,
} from "./driver";

/**
 * The embedded-Postgres database — the local and default adapter.
 *
 * PGlite is Postgres itself compiled to WebAssembly: the same parser, the same
 * planner, the same collation rules. That is the whole reason it is here.
 * A fresh clone runs `npm install && npm run dev` and gets a database with no
 * service to install and no container to start, while the SQL it exercises is
 * the SQL Neon will run — including the `collate "C"` behaviour that manual
 * ordering depends on, which a SQLite stand-in could not reproduce
 * (`research/06-stack-deployment.md` §4).
 *
 * Two constraints follow from it being embedded, and both shape this file:
 *
 * - **One connection.** PGlite is a single-writer, in-process database. Two
 *   OS processes opening the same `dataDir` can corrupt the WAL, so the test
 *   suite uses in-memory instances rather than sharing a file, and the handle
 *   is memoised per process.
 * - **It is loaded dynamically**, through a variable specifier, so no bundler
 *   follows it and a deployment running Neon never pays for the ~3 MB WASM.
 */

/* -------------------------------------------------------------- pglite -- */

/** The subset of `@electric-sql/pglite` this adapter uses. */
interface PGliteResults<T> {
  rows: T[];
  affectedRows?: number;
}

interface PGliteInstance {
  query<T = SqlRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PGliteResults<T>>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

type PGliteCtor = new (
  dataDir?: string,
  options?: Record<string, unknown>,
) => PGliteInstance;

async function loadPGlite(): Promise<PGliteCtor> {
  const specifier = "@electric-sql/pglite";
  const mod = (await import(/* webpackIgnore: true */ specifier)) as {
    PGlite: PGliteCtor;
  };
  return mod.PGlite;
}

/* ------------------------------------------------------------ database -- */

export class PgliteDatabase implements SqlDatabase {
  readonly engine = "pglite" as const;

  #db: PGliteInstance | null = null;
  #opening: Promise<PGliteInstance> | null = null;
  #depth = 0;

  /**
   * @param dataDir A directory to persist into, or `":memory:"` for a database
   *   that dies with the process. The unit suite passes `:memory:` so runs
   *   cannot leak state into each other; the dev server passes a path so a
   *   restart does not lose the workspace you were just looking at.
   */
  constructor(
    private readonly dataDir: string,
    private readonly schema: string,
  ) {}

  /**
   * Open on first use rather than in the constructor.
   *
   * Next evaluates a module graph more than once in development, and an
   * instance opened at construction would spin up a second WASM Postgres per
   * evaluation. The promise is memoised so two concurrent first requests share
   * one boot rather than racing to create two.
   */
  async #open(): Promise<PGliteInstance> {
    if (this.#db) return this.#db;
    this.#opening ??= (async () => {
      const PGlite = await loadPGlite();

      let db: PGliteInstance;
      if (this.dataDir === ":memory:") {
        db = new PGlite();
      } else {
        // PGlite creates its own data directory but not the parents of it, so
        // a default of `.data/linear` fails with ENOENT on a fresh clone —
        // where `.data` is gitignored and therefore never exists. The failure
        // surfaces on the first query rather than at boot, which makes it read
        // like a broken sign-in rather than a missing directory.
        const { mkdir } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        await mkdir(dirname(this.dataDir), { recursive: true });
        db = new PGlite(this.dataDir);
      }

      this.#db = db;
      return db;
    })();
    return this.#opening;
  }

  async query<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    const db = await this.#open();
    const result = await db.query<T>(sql, params);
    return result.rows;
  }

  async execute(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<number> {
    const db = await this.#open();
    const result = await db.query(sql, params);
    return result.affectedRows ?? 0;
  }

  /**
   * Transactions are serialised, and that is not an optimisation.
   *
   * PGlite is single-connection. Two *independent* `transaction()` calls
   * therefore cannot run concurrently the way they would on Neon — they would
   * interleave their statements inside one physical transaction, and whichever
   * rolled back would discard the other's committed work. Worse, a naive
   * depth counter does not even detect it: the first caller awaits `begin`,
   * and while it is suspended the second sees `depth === 0` and issues its own
   * `begin`, so both believe they own the transaction.
   *
   * The queue below makes independent transactions wait for each other, which
   * is the only behaviour that matches Postgres' *semantics* on an engine that
   * cannot match its concurrency. It is also what makes the last-owner
   * concurrency test meaningful: without it, two simultaneous demotions both
   * read `count = 2` and both commit.
   *
   * Nested calls are the exception — they join the transaction already in
   * flight rather than deadlocking behind it, so a repository method that
   * takes an optional executor works in both positions. The depth counter is
   * incremented *synchronously* for exactly the reason above.
   */
  #queue: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    // A nested call is already inside the outer transaction; joining it must
    // not queue behind the very transaction it is running in.
    if (this.#depth > 0) {
      this.#depth += 1;
      try {
        return await fn(this);
      } finally {
        this.#depth -= 1;
      }
    }

    const run = this.#queue.then(
      () => this.#runTransaction(fn),
      () => this.#runTransaction(fn),
    );
    // The queue must not reject, or one failed transaction would poison every
    // later one. The caller still sees the rejection through `run`.
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #runTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const db = await this.#open();
    await db.query("begin");
    this.#depth = 1;
    try {
      const result = await fn(this);
      await db.query("commit");
      return result;
    } catch (error) {
      try {
        await db.query("rollback");
      } catch {
        // A rollback that fails because the transaction is already gone must
        // not mask the error that got us here.
      }
      throw error;
    } finally {
      this.#depth = 0;
    }
  }

  async migrate(): Promise<void> {
    const db = await this.#open();
    for (const statement of splitStatements(this.schema)) {
      try {
        await db.exec(statement);
      } catch (error) {
        throw new Error(
          `Schema failed on: ${statement.slice(0, 140)}…\n${String(error)}`,
          { cause: error },
        );
      }
    }
  }

  async close(): Promise<void> {
    const db = this.#db;
    this.#db = null;
    this.#opening = null;
    await db?.close();
  }
}
