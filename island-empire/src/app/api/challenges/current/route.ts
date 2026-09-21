import { mapsRepository } from "@/adapters/db/mapsRepository";
import { ensureReady } from "@/lib/boot";
import { withErrors } from "@/lib/http";
import { seededChallengePool } from "@/lib/seededLevels";
import { nextMondayUtc, selectWeeklyChallenge, weekKey, weekStartUtc } from "@/lib/weekly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/challenges/current` — this ISO week's three picks (D25, D38).
 *
 * Pure in the sense that matters: nothing is written. The pool is the seeded
 * non-tutorial levels plus every community map; the picks are a function of
 * the week and that pool, recomputed per request.
 */
export async function GET(): Promise<Response> {
  return withErrors(async () => {
    const now = new Date();
    await ensureReady();
    const [seeded, community] = await Promise.all([
      seededChallengePool(),
      mapsRepository().listAll(),
    ]);
    const maps = selectWeeklyChallenge(now, [...seeded, ...community]);
    return Response.json({
      weekKey: weekKey(now),
      weekStart: weekStartUtc(now).toISOString(),
      weekEnd: nextMondayUtc(now).toISOString(),
      maps,
    });
  });
}
