import { withDb } from "../../_lib/boot";
import { json, unauthorized } from "../../_lib/http";
import { CRON_LIMIT, sweep } from "../../_lib/reaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/cron/sweep` — the unbounded version of the lazy reaper's sweeps
 * (SPEC §6.3).
 *
 * Belt and braces for the week nobody visits. Hobby cron fires at most once
 * per day, which is why nothing in the design depends on it (D13) and why
 * this exists anyway: it is free, and once a day is exactly enough to stop a
 * month of silence from leaving a database full of closed lobbies.
 *
 * **`401` without the cron header.** Vercel sets `x-vercel-cron` on its own
 * invocations and strips it from anything inbound, so its presence is the
 * whole authorisation — no shared secret, and therefore no new environment
 * key for S5 to own (§4.16).
 */
export async function GET(request: Request): Promise<Response> {
  return withDb(async () => {
    if (!request.headers.get("x-vercel-cron")) return unauthorized();
    return json({ swept: await sweep(CRON_LIMIT) });
  });
}
