import "server-only";

import { createHash } from "node:crypto";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "./driver";
import { readSchema } from "./pglite";

/**
 * Neon — serverless Postgres, for the deployed application.
 *
 * Two clients, and the distinction matters. `neon()` issues each statement
 * over HTTP, which is stateless and therefore cannot hold a transaction open;
 * `Pool` speaks the wire protocol over a WebSocket and can. Simple reads take
 * the HTTP path because it has no connection to establish, and anything
 * transactional takes the pool.
 *
 * ## The split is safe here, and it is not obviously safe
 *
 * Because `query()` goes over HTTP and `execute()` over the pool, a
 * read-then-write pair outside a transaction runs on two different sessions.
 * That is fine for this application only because nothing here depends on
 * session-scoped state — no temporary tables, no advisory locks, no
 * `set local`. Both paths autocommit, so a committed write is visible to a
 * later read on either. Anyone introducing session state must stop using this
 * split, and the fact that it would keep working under PGlite — which has one
 * session for everything — is exactly why this warning is written down.
 *
 * ## `bigint` arrives as a string unless told otherwise
 *
 * MEASURED, and it is the kind of difference that only fails in production.
 * `node-postgres` and Neon's driver hand back `int8` (and therefore every
 * `count(*)`) as a **string**, because a 64-bit integer does not fit in a
 * JavaScript number. PGlite hands back a number. So `row.view_count + 1`
 * yields `2` locally and `"11"` on Neon, and `order by` on a mapped value
 * sorts lexically.
 *
 * The parsers below make both engines agree. They are deliberately not a bare
 * `Number()`: a value past `Number.MAX_SAFE_INTEGER` cannot round-trip, and
 * silently losing precision on a view count is worse than refusing it. No
 * counter in this schema will realistically reach 2^53, which is precisely why
 * a throw there is safe and a truncation would go unnoticed.
 */

const NEON_SPECIFIER = "@neondatabase/serverless";

type NeonQueryFn = (
  sql: string,
  params?: unknown[],
) => Promise<Record<string, unknown>[]>;

type PoolClient = {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
};

type NeonPool = {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
};

/** Postgres type OIDs whose default text parsing disagrees with PGlite's. */
const OID = {
  INT8: 20,
  NUMERIC: 1700,
} as const;

/**
 * `int8` → number, refusing anything that cannot round-trip.
 *
 * Exported so the test suite can assert the boundary rather than trusting it.
 */
export function parseInt8(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `bigint ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
        `represented without loss. A counter in this schema reaching 2^53 ` +
        `means something is wrong upstream of this parser.`,
    );
  }
  return n;
}

async function loadNeon(connectionString: string): Promise<{
  sql: NeonQueryFn;
  pool: NeonPool;
}> {
  const mod = (await import(/* webpackIgnore: true */ NEON_SPECIFIER)) as {
    neon: (url: string, opts?: { fullResults?: boolean }) => unknown;
    Pool: new (config: { connectionString: string }) => NeonPool;
    types?: {
      setTypeParser: (oid: number, parser: (v: string) => unknown) => void;
    };
  };

  /**
   * Registered on the module's shared type registry, so both the HTTP client
   * and the pool inherit it. Registering per-client would leave whichever path
   * was configured second still returning strings, which is the same bug in a
   * harder-to-find place.
   */
  mod.types?.setTypeParser(OID.INT8, (v) => parseInt8(v));
  mod.types?.setTypeParser(OID.NUMERIC, (v) => Number(v));

  const sql = mod.neon(connectionString) as NeonQueryFn;
  return { sql, pool: new mod.Pool({ connectionString }) };
}

class NeonDatabase implements SqlDatabase {
  constructor(
    private readonly sql: NeonQueryFn,
    private readonly pool: NeonPool,
  ) {}

  async query<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    return (await this.sql(sql, [...params])) as T[];
  }

  async execute(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, [...params]);
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const executor: SqlExecutor = {
      query: async <R extends SqlRow>(
        sql: string,
        params: readonly SqlValue[] = [],
      ) => (await client.query(sql, [...params])).rows as R[],
      execute: async (sql: string, params: readonly SqlValue[] = []) =>
        (await client.query(sql, [...params])).rowCount ?? 0,
    };

    try {
      await client.query("begin");
      const out = await fn(executor);
      await client.query("commit");
      return out;
    } catch (error) {
      await client.query("rollback").catch(() => {
        /* The original error is the interesting one. */
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Apply the schema, and **refuse** rather than rebuild when it has drifted.
   *
   * The PGlite adapter fingerprints the schema and drops the database when it
   * changes, which is right for a disposable local corpus that `pnpm seed`
   * regenerates. Doing the same here would delete a deployment's real data to
   * save someone writing an `alter table`, so this side stops and says so.
   *
   * The asymmetry is the point. `create table if not exists` is silent about a
   * column added after a table was created, so without a check a deployment
   * would start answering `column … does not exist` on every query against the
   * changed table — which is exactly how the local database failed, and the
   * only reason that was survivable there is that nothing in it was authored
   * by a person.
   */
  async migrate(): Promise<void> {
    const schema = await readSchema();
    const fingerprint = createHash("sha256")
      .update(schema)
      .digest("hex")
      .slice(0, 32);

    const client = await this.pool.connect();
    try {
      await client.query(
        `create table if not exists schema_meta (
           id          integer primary key check (id = 1),
           fingerprint text not null
         );`,
      );
      const existing = await client.query(
        "select fingerprint from schema_meta where id = 1",
      );
      const stored = existing.rows[0]?.fingerprint as string | undefined;

      if (stored !== undefined && stored !== fingerprint) {
        throw new Error(
          `The schema has changed since this database was created ` +
            `(${stored} → ${fingerprint}), and \`create table if not exists\` ` +
            `will not add a column to a table that already exists. Write a ` +
            `migration for the difference and apply it, then update ` +
            `schema_meta.fingerprint. This adapter will not rebuild a ` +
            `deployed database.`,
        );
      }

      await client.query(schema);
      await client.query(
        `insert into schema_meta (id, fingerprint) values (1, $1)
           on conflict (id) do update set fingerprint = excluded.fingerprint`,
        [fingerprint],
      );
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createNeonDatabase(
  connectionString: string,
): Promise<SqlDatabase> {
  const { sql, pool } = await loadNeon(connectionString);
  return new NeonDatabase(sql, pool);
}
