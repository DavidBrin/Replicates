import "server-only";

/**
 * Neon/Postgres persistence for the workspace snapshot.
 *
 * Default deployments never reach this file — `route.ts` short-circuits with
 * 501 unless `DATABASE_URL` is set. When it is set (and the client uses
 * `NEXT_PUBLIC_STORAGE_DRIVER=rest`), these three functions are the whole
 * server store: one JSONB row for the deployment.
 *
 * The driver is imported dynamically so a missing optional dependency cannot
 * break a local/browser-storage build, and so Neon never enters the client
 * bundle.
 *
 * Note: this stores one snapshot for the whole deployment. There is no
 * multi-tenant auth on this path — treat it as a private/demo deploy, or set
 * `WORKSPACE_PERSISTENCE_SECRET` so `/api/workspace` requires a matching
 * `x-workspace-secret` header (enforced in `route.ts`).
 */

import type { WorkspaceSnapshot } from "@/lib/model/types";

/** Fixed primary key for the single-tenant demo snapshot. */
export const WORKSPACE_ROW_ID = "default";

type SqlTagged = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

type NeonModule = {
  neon: (connectionString: string) => SqlTagged;
};

let sqlPromise: Promise<SqlTagged> | null = null;
let schemaReady: Promise<void> | null = null;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for server persistence.");
  }
  return url;
}

async function getSql(): Promise<SqlTagged> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const { neon } = (await import("@neondatabase/serverless")) as NeonModule;
      return neon(requireDatabaseUrl());
    })().catch((error) => {
      // Do not memoize a permanent failure (wrong URL, brief outage).
      sqlPromise = null;
      throw error;
    });
  }
  return sqlPromise;
}

async function ensureSchema(sql: SqlTagged): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS workspaces (
          id   text PRIMARY KEY,
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snap = value as Record<string, unknown>;
  return (
    typeof snap.schemaVersion === "number" &&
    typeof snap.workspace === "object" &&
    snap.workspace !== null &&
    typeof snap.pages === "object" &&
    snap.pages !== null
  );
}

/** Test escape hatch — clears memoized client/schema between cases. */
export function resetPersistenceForTests(): void {
  sqlPromise = null;
  schemaReady = null;
}

export async function readSnapshot(): Promise<WorkspaceSnapshot | null> {
  const sql = await getSql();
  await ensureSchema(sql);

  const rows = await sql`
    SELECT data FROM workspaces WHERE id = ${WORKSPACE_ROW_ID}
  `;
  const data = rows[0]?.data;
  if (data === undefined || data === null) return null;
  // Neon returns jsonb as a parsed object; tolerate a string for drivers
  // that leave JSON as text.
  const parsed =
    typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  if (!isWorkspaceSnapshot(parsed)) {
    throw new Error("Stored workspace row is not a valid WorkspaceSnapshot.");
  }
  return parsed;
}

export async function writeSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  if (!isWorkspaceSnapshot(snapshot)) {
    throw new Error("Refusing to persist a value that is not a WorkspaceSnapshot.");
  }
  const sql = await getSql();
  await ensureSchema(sql);

  // Stringify + `::jsonb` so the parameter is unambiguous across Neon HTTP
  // and drivers that would otherwise treat a plain object as a record.
  const payload = JSON.stringify(snapshot);
  await sql`
    INSERT INTO workspaces (id, data, updated_at)
    VALUES (${WORKSPACE_ROW_ID}, ${payload}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data,
          updated_at = EXCLUDED.updated_at
  `;
}

export async function deleteSnapshot(): Promise<void> {
  const sql = await getSql();
  await ensureSchema(sql);

  await sql`
    DELETE FROM workspaces WHERE id = ${WORKSPACE_ROW_ID}
  `;
}
