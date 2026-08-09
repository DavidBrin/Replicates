import "server-only";

/**
 * The seam where a real database plugs in.
 *
 * Left unimplemented on purpose. The default deployment never reaches this
 * file — `route.ts` short-circuits with 501 unless `DATABASE_URL` is set — so
 * shipping it empty keeps the zero-configuration promise intact while making
 * the upgrade path a single file rather than an architecture change.
 *
 * A Neon/Postgres implementation is roughly:
 *
 *   import { neon } from "@neondatabase/serverless";
 *   const sql = neon(process.env.DATABASE_URL!);
 *
 *   export async function readSnapshot() {
 *     const rows = await sql`SELECT data FROM workspaces WHERE id = ${WORKSPACE_ROW_ID}`;
 *     return rows[0]?.data ?? null;
 *   }
 *
 *   export async function writeSnapshot(snapshot: WorkspaceSnapshot) {
 *     await sql`INSERT INTO workspaces (id, data) VALUES (${WORKSPACE_ROW_ID}, ${snapshot})
 *               ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
 *   }
 *
 * Note that this stores one snapshot for the whole deployment. A multi-tenant
 * version would key the row by an authenticated user or workspace id — that
 * is the point at which you would also want authentication, which this clone
 * deliberately does not implement.
 */

import type { WorkspaceSnapshot } from "@/lib/model/types";

const UNIMPLEMENTED =
  "Server persistence is enabled (DATABASE_URL is set) but src/app/api/workspace/persistence.ts has no implementation.";

export async function readSnapshot(): Promise<WorkspaceSnapshot | null> {
  throw new Error(UNIMPLEMENTED);
}

export async function writeSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  void snapshot;
  throw new Error(UNIMPLEMENTED);
}

export async function deleteSnapshot(): Promise<void> {
  throw new Error(UNIMPLEMENTED);
}
