import "server-only";

import {
  splitStatements,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlValue,
} from "./driver";

/**
 * The Neon database — the deployed adapter.
 *
 * `@neondatabase/serverless` rather than `pg`, because the deployment target
 * is Vercel, where a function has no long-lived process to hold a TCP pool.
 * Neon's driver speaks HTTP for one-shot statements and WebSocket for
 * transactions, and both survive a serverless invocation's lifecycle. It is
 * imported dynamically so a local process running PGlite never loads it.
 *
 * The SQL that arrives here is the same SQL PGlite runs — same placeholders,
 * same types, same collation. That is the point of choosing an embedded
 * Postgres for local work: this file has no dialect translation in it, because
 * there is no dialect to translate.
 */

/* ---------------------------------------------------------- neon types -- */

interface NeonQueryResult {
  rows: SqlRow[];
  rowCount: number | null;
}

interface NeonClient {
  query(sql: string, params?: readonly SqlValue[]): Promise<NeonQueryResult>;
  release(): void;
}

interface NeonPool {
  query(sql: string, params?: readonly SqlValue[]): Promise<NeonQueryResult>;
  connect(): Promise<NeonClient>;
  end(): Promise<void>;
}

type NeonModule = {
  Pool: new (config: { connectionString: string }) => NeonPool;
  neonConfig: { webSocketConstructor?: unknown; poolQueryViaFetch?: boolean };
};

/* ------------------------------------------------------------ database -- */

export class NeonDatabase implements SqlDatabase {
  readonly engine = "neon" as const;

  #pool: NeonPool | null = null;
  #opening: Promise<NeonPool> | null = null;

  constructor(
    private readonly connectionString: string,
    private readonly schema: string,
  ) {}

  async #open(): Promise<NeonPool> {
    if (this.#pool) return this.#pool;
    this.#opening ??= (async () => {
      const specifier = "@neondatabase/serverless";
      const neon = (await import(
        /* webpackIgnore: true */ specifier
      )) as unknown as NeonModule;

      // Single statements go over HTTP, which costs one round trip instead of
      // a WebSocket handshake. `connect()` still upgrades to a socket, which
      // is what transactions need.
      neon.neonConfig.poolQueryViaFetch = true;

      if (typeof globalThis.WebSocket === "undefined") {
        try {
          const wsSpecifier = "ws";
          const ws = (await import(/* webpackIgnore: true */ wsSpecifier)) as {
            default: unknown;
          };
          neon.neonConfig.webSocketConstructor = ws.default;
        } catch {
          // Left unset: HTTP queries still work, and `transaction` fails with
          // the driver's own message, which names the missing constructor.
        }
      }

      const pool = new neon.Pool({ connectionString: this.connectionString });
      this.#pool = pool;
      return pool;
    })();
    return this.#opening;
  }

  async query<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    const pool = await this.#open();
    const result = await pool.query(sql, params);
    return result.rows as T[];
  }

  async execute(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<number> {
    const pool = await this.#open();
    const result = await pool.query(sql, params);
    return result.rowCount ?? 0;
  }

  /**
   * A real transaction on a dedicated connection.
   *
   * The executor handed to `fn` is bound to that one client, which is what
   * makes the transaction mean anything: issuing the statements through the
   * pool instead would scatter them across connections and commit nothing.
   */
  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const pool = await this.#open();
    const client = await pool.connect();

    const tx: SqlExecutor = {
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params: readonly SqlValue[] = [],
      ) => {
        const result = await client.query(sql, params);
        return result.rows as R[];
      },
      execute: async (sql: string, params: readonly SqlValue[] = []) => {
        const result = await client.query(sql, params);
        return result.rowCount ?? 0;
      },
    };

    try {
      await client.query("begin");
      const result = await fn(tx);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Don't mask the original failure with a rollback failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Apply the schema, one statement per round trip.
   *
   * Every statement is idempotent, so this is safe against a live database. It
   * runs from `scripts/db-push.ts` — invoked by the Vercel build command,
   * where Hobby's single concurrent build makes it race-free and a failure
   * fails the deploy (`research/06-stack-deployment.md` §8). It is never
   * called from a request handler: a serverless function that migrates on
   * first request migrates once per cold start, from however many instances
   * happen to be warming at the time.
   */
  async migrate(): Promise<void> {
    const pool = await this.#open();
    for (const statement of splitStatements(this.schema)) {
      try {
        await pool.query(statement);
      } catch (error) {
        throw new Error(
          `Schema failed on: ${statement.slice(0, 140)}…\n${String(error)}`,
          { cause: error },
        );
      }
    }
  }

  async close(): Promise<void> {
    const pool = this.#pool;
    this.#pool = null;
    this.#opening = null;
    await pool?.end();
  }
}
