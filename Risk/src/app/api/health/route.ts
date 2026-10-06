import { getDb } from "@/adapters/db";

import { ensureSchema } from "../_lib/boot";
import { json, jsonError } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/health` — `200 { ok: true }` after one `select 1`, `503` on a
 * driver error (SPEC §6).
 *
 * One statement, not a count or a schema check: this answers "can this
 * function reach the database at all", which on Neon's free tier is also the
 * cheapest way to wake a suspended compute before the first player arrives.
 */
export async function GET(): Promise<Response> {
  try {
    // The schema too, not just the connection: on a fresh local clone this is
    // often the first request anything makes, and a health check that says
    // `ok` over an empty database is worse than useless.
    await ensureSchema();
    await getDb().query("select 1 as ok");
    return json({ ok: true });
  } catch (error) {
    console.error("[health]", error);
    return jsonError(503, "database unavailable");
  }
}
