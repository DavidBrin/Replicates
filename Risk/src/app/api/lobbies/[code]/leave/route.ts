import { getDb } from "@/adapters/db";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";

import { currentPlayer, heartbeat } from "../../../_lib/auth";
import { noContent, notFound, unauthorized, withErrors } from "../../../_lib/http";
import { LobbyCodeSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

/**
 * `POST /api/lobbies/:code/leave` — `204` (SPEC §6).
 *
 * The host hands off to the next human by seat order; a lobby whose last
 * human leaves is `closed` immediately rather than waiting for the reaper,
 * because an empty lobby in the browser's list is a dead end somebody will
 * click on.
 *
 * Idempotent: leaving a lobby you are not in is a `204`, not a `404`, so a
 * double-tapped `Leave` does not show an error.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const code = LobbyCodeSchema.safeParse((await context.params).code);
    if (!code.success) return notFound("lobby not found");

    await heartbeat(player);
    const lobbies = lobbiesRepository(getDb());
    const lobby = await lobbies.byCode(code.data);
    if (!lobby) return notFound("lobby not found");

    await lobbies.leave(code.data, player.id);

    if (lobby.hostId === player.id) {
      const next = await lobbies.handOffHost(code.data, player.id);
      if (!next) await lobbies.setStatus(code.data, "closed");
    } else {
      const humans = (await lobbies.seats(code.data)).filter((seat) => seat.kind === "human");
      if (humans.length === 0) await lobbies.setStatus(code.data, "closed");
    }

    await lobbies.bump(code.data);
    return noContent();
  });
}
