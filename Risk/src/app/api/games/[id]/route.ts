import { config } from "@/config/env";

import { currentPlayer, heartbeat } from "../../_lib/auth";
import { pollGame, reclaimSeat, runLazyTick } from "../../_lib/gameService";
import {
  forbidden,
  intParam,
  json,
  noContent,
  notFound,
  unauthorized,
  withErrors,
} from "../../_lib/http";
import { maybeSweep } from "../../_lib/reaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * POLL 3 — `GET /api/games/:id?since=<seq>&chatSince=<id>` (SPEC §6).
 *
 * One invocation does five jobs: stamps the caller's presence, runs the lazy
 * tick (a bot's turn, an expired deadline, a seat takeover), returns the
 * action delta or a snapshot, returns the other seats' presence and the turn
 * deadline, and returns chat since the client's last id. **That folding is
 * what makes the budget work** (D12).
 *
 * `ETag: W/"<seq>"` plus `If-None-Match` make the `204` path a string
 * compare, and the `204` path is the common case and the whole cost argument.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const started = Date.now();
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const { id } = await context.params;
    if (!id || id.length > 64) return notFound("game not found");

    const url = new URL(request.url);
    const sinceParam = intParam(url, "since", 0);
    const chatSince = intParam(url, "chatSince", 0);
    // `If-None-Match: W/"12"` is the same statement as `?since=12`; the
    // larger of the two wins so a client that sends both is not served a
    // snapshot it already has.
    const since = Math.max(sinceParam, etagSeq(request.headers.get("if-none-match")));

    await heartbeat(player);
    // The returning player's seat flips back BEFORE the tick, so one poll
    // both reclaims the seat and sees the game move on (§5.6).
    await reclaimSeat(id, player.id);
    await runLazyTick(id);
    await maybeSweep();

    const result = await pollGame({ gameId: id, playerId: player.id, since, chatSince });

    switch (result.kind) {
      case "notFound":
        return notFound("game not found");
      case "notSeated":
        return forbidden("not seated in that game");
      case "unchanged":
        return noContent(timing(started, { ETag: `W/"${result.seq}"` }));
      case "body":
        return json(result.body, 200, timing(started, { ETag: `W/"${result.seq}"` }));
    }
  });
}

/** The `seq` inside a weak ETag, or 0 when the header is absent or odd. */
function etagSeq(header: string | null): number {
  if (!header) return 0;
  const match = /^W\/"(\d+)"$/.exec(header.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * A dev-only `Server-Timing` header, which is what T12 reads over 200 driven
 * polls: the `204` path must stay under ~5 ms. It is omitted in production so
 * the cost measurement cannot itself become a cost.
 */
function timing(started: number, headers: Record<string, string>): Record<string, string> {
  if (config().isProduction) return headers;
  return { ...headers, "Server-Timing": `poll;dur=${Date.now() - started}` };
}
