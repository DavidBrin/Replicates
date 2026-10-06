import { currentPlayer, heartbeat } from "../../../_lib/auth";
import { resignSeat } from "../../../_lib/gameService";
import {
  conflict,
  forbidden,
  json,
  notFound,
  unauthorized,
  unprocessable,
  withErrors,
} from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `POST /api/games/:id/resign` — `200 { seq, actions: [SEAT_TO_BOT] }`
 * (SPEC §6, D76).
 *
 * Resigning is not a separate elimination path: the seat keeps its
 * territories and cards and a bot plays it from then on, through the same
 * transition as an away takeover. Neutralising the territories was considered
 * and rejected — it hands a free continent to whichever neighbour is closest,
 * so resigning becomes a weapon against a specific opponent.
 *
 * `reason: "resigned"` is the one takeover that is **never reclaimable**
 * (R82), which is why it is its own enum member rather than sharing
 * `"away"`.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const { id } = await context.params;
    if (!id || id.length > 64) return notFound("game not found");

    await heartbeat(player);
    const result = await resignSeat(id, player.id);

    switch (result.kind) {
      case "ok":
        return json({ seq: result.seq, actions: result.actions });
      case "notFound":
        return notFound("game not found");
      case "notSeated":
        return forbidden("not seated in that game");
      case "finished":
        return conflict("gameFinished");
      case "notYourTurn":
        // Resigning does not need to be your turn, so this cannot happen —
        // but a `switch` that silently falls through is how a 500 becomes a
        // blank screen.
        return conflict("notYourTurn");
      case "illegalAction":
        return unprocessable("illegalAction");
      case "ruleError":
        return unprocessable(result.code);
    }
  });
}
