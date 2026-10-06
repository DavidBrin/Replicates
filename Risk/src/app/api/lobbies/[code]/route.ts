import { getDb } from "@/adapters/db";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";

import { currentPlayer, heartbeat } from "../../_lib/auth";
import {
  badRequest,
  conflict,
  forbidden,
  intParam,
  issueMessages,
  json,
  noContent,
  notFound,
  unauthorized,
  readJson,
  withErrors,
} from "../../_lib/http";
import { lobbyRoom } from "../../_lib/lobbyService";
import { LobbyCodeSchema, LobbyPatchSchema } from "../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

/**
 * POLL 2 — `GET /api/lobbies/:code?since=<version>` (SPEC §6).
 *
 * Seats, settings, lobby chat and the caller's heartbeat in one invocation.
 * `lobbies.version` is the cursor: every change bumps it, so a `204` means
 * "nothing in this room has moved" rather than "nothing interesting".
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const code = LobbyCodeSchema.safeParse((await context.params).code);
    if (!code.success) return notFound("lobby not found");

    const url = new URL(request.url);
    const since = intParam(url, "since", 0);
    const chatSince = intParam(url, "chatSince", 0);

    await heartbeat(player);

    const body = await lobbyRoom(code.data, chatSince);
    if (!body) return notFound("lobby not found");
    if (since !== 0 && body.version === since && body.chat.length === 0) {
      return noContent({ ETag: `W/"${body.version}"` });
    }
    return json(body, 200, { ETag: `W/"${body.version}"` });
  });
}

/**
 * `PATCH /api/lobbies/:code` — host only (SPEC §6).
 *
 * Title, map, rules and `SeatPatch[]` (add or remove a bot, kick an
 * occupant). **`ready` is deliberately not here**: §6 folds it into this
 * host-only patch, which cannot be right — a player's own ready flag is
 * theirs to set — so it lives at `POST …/ready` instead and this route
 * refuses to touch it.
 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const code = LobbyCodeSchema.safeParse((await context.params).code);
    if (!code.success) return notFound("lobby not found");

    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");
    const parsed = LobbyPatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("bad patch", { errors: issueMessages(parsed.error) });
    }

    await heartbeat(player);
    const lobbies = lobbiesRepository(getDb());
    const lobby = await lobbies.byCode(code.data);
    if (!lobby) return notFound("lobby not found");
    if (lobby.hostId !== player.id) return forbidden("not the host");
    if (lobby.status !== "open") return conflict("gameAlreadyStarted");

    await lobbies.patch(code.data, {
      ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
      ...(parsed.data.mapSlug === undefined ? {} : { mapSlug: parsed.data.mapSlug }),
      ...(parsed.data.rules === undefined ? {} : { rules: parsed.data.rules }),
    });
    for (const seat of parsed.data.seats ?? []) {
      if (seat.seat >= lobby.maxSeats) continue;
      await lobbies.patchSeat(code.data, seat, lobby.hostId);
    }
    await lobbies.bump(code.data);

    const updated = await lobbyRoom(code.data, 0);
    if (!updated) return notFound("lobby not found");
    return json(updated, 200, { ETag: `W/"${updated.version}"` });
  });
}
