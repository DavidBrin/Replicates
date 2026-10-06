import { getDb } from "@/adapters/db";
import { chatRepository } from "@/adapters/db/repositories/chat";
import { GamesRepository } from "@/adapters/db/repositories/games";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";

import { DIALOG_LINES } from "@/content/dialog";

import { currentPlayer, heartbeat } from "../_lib/auth";
import { withDb } from "../_lib/boot";
import { alliesOf } from "../_lib/gameService";
import {
  badRequest,
  forbidden,
  issueMessages,
  json,
  readJson,
  unauthorized,
  unprocessable,
} from "../_lib/http";
import { ChatPostSchema } from "../_lib/schemas";

/** Lines 28 and 29: offered only while an alliance is active (R80, §7.3). */
const ALLY_ONLY = new Set(DIALOG_LINES.filter((line) => line.allyOnly).map((line) => line.id));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/chat` — the single chat write (SPEC §5.9, §6).
 *
 * `ChatSend` is `{ lineId }` **or** `{ emoji }`, exactly one, and never free
 * text: the client sends an *index* into the 42-line roster or one of the
 * eight glyph ids, and `chat_messages` has no `body` column at all. There is
 * therefore no free-text path anywhere in the app, by construction rather
 * than by validation (D41).
 *
 * Reads ride one of the three polls — chat is never its own poll.
 *
 * `403 not in that scope`: a lobby line requires a seat in that lobby and a
 * game line a seat in that game, so a code guessed from the browser's list
 * does not buy a voice in somebody else's room.
 */
export async function POST(request: Request): Promise<Response> {
  return withDb(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");
    const parsed = ChatPostSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("unknown line or emoji", { errors: issueMessages(parsed.error) });
    }

    await heartbeat(player);
    const db = getDb();
    const scopeId = parsed.data.scopeId ?? null;

    if (parsed.data.scope === "lobby") {
      const seats = await lobbiesRepository(db).seats(scopeId ?? "");
      if (!seats.some((seat) => seat.playerId === player.id)) {
        return forbidden("not in that lobby");
      }
    }
    if (parsed.data.scope === "game") {
      const seat = await new GamesRepository(db).seatOf(scopeId ?? "", player.id);
      if (seat === null) return forbidden("not in that game");

      // R80 — lines 28 and 29 are unlocked by an active alliance and by
      // nothing else. The client only offers them to an allied seat, which is
      // a presentation rule; without this they are a hand-rolled POST away,
      // and "Sorry, I need to attack your territory." sent to somebody you
      // have no pact with is exactly the social lever alliances are for.
      const lineId = parsed.data.lineId;
      if (lineId !== undefined && ALLY_ONLY.has(lineId)) {
        const allies = await alliesOf(scopeId ?? "", seat);
        if (allies === null || allies.length === 0) {
          return unprocessable("illegalAction", "that line needs an active alliance (R80)");
        }
      }
    }

    const id = await chatRepository(db).post({
      scope: parsed.data.scope,
      scopeId: parsed.data.scope === "global" ? null : scopeId,
      playerId: player.id,
      displayName: player.displayName,
      lineId: parsed.data.lineId ?? null,
      emoji: parsed.data.emoji ?? null,
    });
    return json({ id }, 201);
  });
}
