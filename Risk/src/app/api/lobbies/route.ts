import { getDb } from "@/adapters/db";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";

import { currentPlayer, heartbeat } from "../_lib/auth";
import { withDb } from "../_lib/boot";
import {
  badRequest,
  conflict,
  issueMessages,
  json,
  readJson,
  unauthorized,
} from "../_lib/http";
import { LobbyCreateSchema } from "../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/lobbies` — create a lobby, `201 { code }` (SPEC §6).
 *
 * `409 already hosting`: one lobby per host. Without it, a host who reloads
 * the create screen leaves a trail of empty lobbies in everyone else's
 * browser until the reaper closes them twenty minutes later.
 *
 * The host takes seat 0 and the remaining `maxSeats - 1` rows are created
 * `open`, so a lobby always has a full set of seat rows and `join` is an
 * `update`, never an `insert` that has to invent a seat index.
 */
export async function POST(request: Request): Promise<Response> {
  return withDb(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");
    const parsed = LobbyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("bad lobby", { errors: issueMessages(parsed.error) });
    }

    await heartbeat(player);
    const lobbies = lobbiesRepository(getDb());

    const hosting = await lobbies.hostedBy(player.id);
    if (hosting) return conflict("alreadyHosting", { code: hosting });

    const lobby = await lobbies.create({
      hostId: player.id,
      title: parsed.data.title,
      mapSlug: parsed.data.mapSlug,
      rules: parsed.data.rules,
      maxSeats: parsed.data.maxSeats,
    });
    return json({ code: lobby.code }, 201);
  });
}
