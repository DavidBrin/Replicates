import { getDb } from "@/adapters/db";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";

import { currentPlayer, heartbeat } from "../../../_lib/auth";
import {
  badRequest,
  issueMessages,
  json,
  notFound,
  readJson,
  unauthorized,
  withErrors,
} from "../../../_lib/http";
import { lobbyRoom } from "../../../_lib/lobbyService";
import { LobbyCodeSchema, LobbyReadySchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

/**
 * `POST /api/lobbies/:code/ready` — `200` POLL 2 body (SPEC §6, **[SPEC]**).
 *
 * **Any seated player sets their own flag.** §6's table folded `ready` into
 * the host-only `PATCH`, which cannot be right: `I'M READY` is on everybody's
 * screen, and a host who could flip somebody else's flag could start a game
 * the other player had not agreed to.
 *
 * There is deliberately **no ready-check timer** — RGD's ten-second check is
 * a source of complaints (§7's `[ours]`).
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const code = LobbyCodeSchema.safeParse((await context.params).code);
    if (!code.success) return notFound("lobby not found");

    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");
    const parsed = LobbyReadySchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("bad ready flag", { errors: issueMessages(parsed.error) });
    }

    await heartbeat(player);
    const lobbies = lobbiesRepository(getDb());
    const lobby = await lobbies.byCode(code.data);
    if (!lobby) return notFound("lobby not found");

    const changed = await lobbies.setReady(code.data, player.id, parsed.data.ready);
    if (!changed) return notFound("not seated in that lobby");
    await lobbies.bump(code.data);

    const room = await lobbyRoom(code.data, 0);
    if (!room) return notFound("lobby not found");
    return json(room, 200, { ETag: `W/"${room.version}"` });
  });
}
