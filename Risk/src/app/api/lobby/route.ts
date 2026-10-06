import { currentPlayer, heartbeat } from "../_lib/auth";
import { withDb } from "../_lib/boot";
import { intParam, json, noContent, unauthorized } from "../_lib/http";
import { lobbyBrowse } from "../_lib/lobbyService";
import { maybeSweep } from "../_lib/reaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POLL 1 — `GET /api/lobby?since=<version>` (SPEC §6).
 *
 * The lobby browser's single poll: online players, open lobbies, global chat,
 * **and** the caller's presence heartbeat, in one invocation. A design with a
 * separate presence poll would cost three times the invocations for no added
 * capability, and invocations are one of the two co-binding Hobby limits
 * (D12).
 *
 * This is also where the lazy reaper rides: once per ~60 s per process, with
 * a `limit` on every statement.
 */
export async function GET(request: Request): Promise<Response> {
  return withDb(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const url = new URL(request.url);
    const since = intParam(url, "since", 0);
    const chatSince = intParam(url, "chatSince", 0);

    await heartbeat(player);
    await maybeSweep();

    const body = await lobbyBrowse(
      { id: player.id, displayName: player.displayName, colour: player.colour },
      chatSince,
    );
    if (since !== 0 && body.version === since && body.chat.length === 0) {
      return noContent({ ETag: `W/"${body.version}"` });
    }
    return json(body, 200, { ETag: `W/"${body.version}"` });
  });
}
