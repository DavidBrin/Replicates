import { getDb } from "@/adapters/db";
import { GamesRepository } from "@/adapters/db/repositories/games";
import { riskDebugEnabled } from "@/net/debugFlag";

import { currentPlayer, heartbeat } from "../../../_lib/auth";
import { rawLog, submitAction } from "../../../_lib/gameService";
import {
  badRequest,
  conflict,
  forbidden,
  intParam,
  issueMessages,
  json,
  notFound,
  readJson,
  unauthorized,
  unprocessable,
  withErrors,
} from "../../../_lib/http";
import { ActionPostSchema } from "../../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `POST /api/games/:id/actions` — the append path (SPEC §5.5, §6).
 *
 * The body is the two-member union §5.5 specifies: `kind: "action"` for every
 * non-dice action, already applied optimistically by the client, and
 * `kind: "intent"` for an attack, which is **never** applied optimistically
 * because the client must not predict dice. A `kind: "action"` body carrying
 * an `ATTACK` is `422 { code: "illegalAction" }`: dice are the authority's to
 * roll.
 *
 * The response is `{ seq, actions: [theOneJustApplied] }`, so the submitter
 * needs no extra poll to see its own confirmed move — and a retry with the
 * same `clientActionId` gets `200` with the already-recorded action, which
 * makes it indistinguishable from a slow success (D15).
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const { id } = await context.params;
    if (!id || id.length > 64) return notFound("game not found");

    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");
    const parsed = ActionPostSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("bad action", { errors: issueMessages(parsed.error) });
    }

    await heartbeat(player);
    const result = await submitAction(id, player.id, parsed.data);

    switch (result.kind) {
      case "ok":
        return json({ seq: result.seq, actions: result.actions });
      case "notFound":
        return notFound("game not found");
      case "notSeated":
        return forbidden("not seated in that game");
      case "notYourTurn":
        return conflict("notYourTurn");
      case "finished":
        return conflict("gameFinished");
      case "illegalAction":
        return unprocessable("illegalAction", "the authority rolls the dice");
      case "ruleError":
        return unprocessable(result.code);
    }
  });
}

/**
 * `GET /api/games/:id/actions?from=<seq>` — **debug only** (SPEC §6, F37).
 *
 * The determinism proof's only door. POLL 3 returns the caller's fog view,
 * which is exactly what a replay check must not be given, so T10.1 reads the
 * log as stored here: unmasked payloads, every `state_hash`, and the
 * `GAME_STARTED` row **with `games.seed` still absent from it** — the seed is
 * a column and never a payload field (D5), so there is nothing to strip and
 * nothing that can leak.
 *
 * Gated on `NEXT_PUBLIC_RISK_DEBUG === "1"` and `404` otherwise, so it does
 * not exist in production; it still requires a cookie and a seat in the game.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return withErrors(async () => {
    if (!riskDebugEnabled()) return notFound("not found");

    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const { id } = await context.params;
    if (!id || id.length > 64) return notFound("game not found");

    const games = new GamesRepository(getDb());
    if (!(await games.head(id))) return notFound("game not found");
    if ((await games.seatOf(id, player.id)) === null) {
      return forbidden("not seated in that game");
    }

    const from = intParam(new URL(request.url), "from", 0);
    return json({ actions: await rawLog(id, from) });
  });
}
