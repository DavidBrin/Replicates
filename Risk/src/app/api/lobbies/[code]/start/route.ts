import { currentPlayer, heartbeat } from "../../../_lib/auth";
import {
  conflict,
  forbidden,
  json,
  notFound,
  unauthorized,
  withErrors,
} from "../../../_lib/http";
import { startLobby } from "../../../_lib/lobbyService";
import { LobbyCodeSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

/**
 * `POST /api/lobbies/:code/start` — host only, `201 { gameId }` (SPEC §6).
 *
 * `BATTLE` is enabled at **two or more occupied seats and all human seats
 * ready**; the two `409` reasons say which of the two failed, because
 * "needTwoSeats" and "notAllReady" are different things for the host to do
 * about it.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const code = LobbyCodeSchema.safeParse((await context.params).code);
    if (!code.success) return notFound("lobby not found");

    await heartbeat(player);
    const result = await startLobby(code.data, player.id);

    switch (result.kind) {
      case "started":
        return json({ gameId: result.gameId }, 201);
      case "notFound":
        return notFound("lobby not found");
      case "notHost":
        return forbidden("not the host");
      case "alreadyStarted":
        return conflict("gameAlreadyStarted");
      case "needTwoSeats":
        return conflict("needTwoSeats", { error: "needTwoSeats" });
      case "notAllReady":
        return conflict("notAllReady", { error: "notAllReady" });
    }
  });
}
