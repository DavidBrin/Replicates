import { getDb } from "@/adapters/db";
import { playersRepository } from "@/adapters/db/repositories/players";
import type { PlayerColour } from "@/engine/types";

import { clearedCookie, currentPlayer, sessionCookie } from "../_lib/auth";
import { withDb } from "../_lib/boot";
import {
  badRequest,
  conflict,
  issueMessages,
  json,
  noContent,
  readJson,
  unauthorized,
} from "../_lib/http";
import { nameKey, normaliseName, suggestNames } from "../_lib/names";
import { SessionPatchSchema, SessionPostSchema } from "../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/session` — the entire auth system (SPEC §6, §6.1, D17).
 *
 * `POST` claims a display name and mints the cookie; `PATCH` changes colour or
 * name; `DELETE` leaves, clearing the cookie and releasing the name. There
 * are no accounts, no passwords and no library: the server mints the secret,
 * stores `sha256(secret)`, and `localStorage` never holds anything but the
 * display name and colour for first paint.
 */

const COLOURS: readonly PlayerColour[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "black",
  "white",
];

/** A colour for a player who did not pick one, with no modulo bias. */
function anyColour(): PlayerColour {
  const byte = new Uint8Array(1);
  const ceiling = Math.floor(256 / COLOURS.length) * COLOURS.length;
  for (;;) {
    globalThis.crypto.getRandomValues(byte);
    const value = byte[0]!;
    if (value < ceiling) return COLOURS[value % COLOURS.length]!;
  }
}

/**
 * Claim a name.
 *
 * The order is load-bearing: **reap, then insert**. A dead holder is deleted
 * conditionally and atomically (unseen 2 minutes, not seated in a live game,
 * not seated in a lobby), and then the unique index on `name_key` arbitrates
 * the race. Zero rows back means somebody live holds it → `409` with three
 * probed-free suggestions, because we **never silently rename**: the player
 * chose that name and should be told.
 */
export async function POST(request: Request): Promise<Response> {
  return withDb(async () => {
    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");

    const parsed = SessionPostSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("bad display name", { errors: issueMessages(parsed.error) });
    }

    const displayName = normaliseName(parsed.data.displayName);
    const key = nameKey(displayName);
    const players = playersRepository(getDb());

    await players.reapDeadHolder(key);
    const claimed = await players.claim(
      displayName,
      key,
      parsed.data.colour ?? anyColour(),
    );

    if (!claimed) {
      const suggestions = await suggestNames(displayName, (candidate) =>
        players.isNameFree(candidate),
      );
      return conflict("nameTaken", { error: "nameTaken", suggestions });
    }

    return json(
      {
        playerId: claimed.player.id,
        displayName: claimed.player.displayName,
        colour: claimed.player.colour,
      },
      200,
      { "Set-Cookie": sessionCookie(claimed.player.id, claimed.secret) },
    );
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withDb(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();

    const body = await readJson(request);
    if (body === undefined) return badRequest("body must be JSON");
    const parsed = SessionPatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("bad patch", { errors: issueMessages(parsed.error) });
    }

    const players = playersRepository(getDb());
    let updated = player;

    if (parsed.data.displayName !== undefined) {
      const displayName = normaliseName(parsed.data.displayName);
      const key = nameKey(displayName);
      if (key !== player.nameKey) await players.reapDeadHolder(key);
      const renamed = await players.rename(player.id, displayName, key);
      if (!renamed) {
        const suggestions = await suggestNames(displayName, (candidate) =>
          players.isNameFree(candidate),
        );
        return conflict("nameTaken", { error: "nameTaken", suggestions });
      }
      updated = renamed;
    }

    if (parsed.data.colour !== undefined) {
      const recoloured = await players.setColour(player.id, parsed.data.colour);
      if (recoloured) updated = recoloured;
    }

    return json({
      playerId: updated.id,
      displayName: updated.displayName,
      colour: updated.colour,
    });
  });
}

/**
 * Leave. The row is deleted, which releases the name immediately rather than
 * two minutes later — the holder asked to let it go — and the cookie is
 * cleared with the same attributes it was set with, which is what makes a
 * browser actually drop it.
 */
export async function DELETE(request: Request): Promise<Response> {
  return withDb(async () => {
    const player = await currentPlayer(request);
    if (!player) return unauthorized();
    await playersRepository(getDb()).remove(player.id);
    return noContent({ "Set-Cookie": clearedCookie() });
  });
}
