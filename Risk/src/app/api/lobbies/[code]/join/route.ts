import { getDb } from "@/adapters/db";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";

import { currentPlayer, heartbeat } from "../../../_lib/auth";
import { withDb } from "../../../_lib/boot";
import {
  badRequest,
  conflict,
  issueMessages,
  json,
  notFound,
  readJson,
  unauthorized,
} from "../../../_lib/http";
import { lobbyRoom } from "../../../_lib/lobbyService";
import { LobbyCodeSchema, LobbyJoinSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

/**
 * `POST /api/lobbies/:code/join` — `200 { seat, …POLL 2 }` (SPEC §6).
 *
 * `seat` omitted takes the lowest open seat, which is what the browser's
 * `Join` button sends; a named seat is the room screen's seat row. The three
 * `409` reasons are distinct on purpose: `lobbyFull` and `seatTaken` need
 * different copy, and `alreadySeated` is not an error the player caused —
 * it is a second tab, and the response still carries their seat.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return withDb(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const code = LobbyCodeSchema.safeParse((await context.params).code);
    if (!code.success) return notFound("lobby not found");

    const raw = await readJson(request);
    const parsed = LobbyJoinSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest("bad seat", { errors: issueMessages(parsed.error) });
    }

    await heartbeat(player);
    const lobbies = lobbiesRepository(getDb());
    const lobby = await lobbies.byCode(code.data);
    if (!lobby) return notFound("lobby not found");
    if (lobby.status !== "open") return conflict("gameAlreadyStarted");

    // `join` carries the `status = 'open'` fence in the seat-taking statement
    // itself: the check above is a read, and a `BATTLE` press landing between
    // the two would otherwise seat somebody in a lobby that is already
    // dealing a board — they would hold a lobby seat in a game that does not
    // have one for them.
    const seat = await lobbies.join(code.data, player.id, parsed.data.seat ?? null);
    if (typeof seat === "string") {
      if (seat === "gameAlreadyStarted") return conflict("gameAlreadyStarted");
      if (seat === "alreadySeated") {
        const existing = (await lobbies.seats(code.data)).find(
          (row) => row.playerId === player.id,
        );
        return conflict(seat, { error: seat, seat: existing?.seat ?? null });
      }
      return conflict(seat, { error: seat });
    }

    await lobbies.bump(code.data);
    const room = await lobbyRoom(code.data, 0);
    if (!room) return notFound("lobby not found");
    return json({ seat, ...room }, 200, { ETag: `W/"${room.version}"` });
  });
}
