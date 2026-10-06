"use client";

/**
 * Creating an online lobby from the setup store (D115).
 *
 * `lobbyChoice` turns what `/new/map` and `/new/rules` wrote into the body `POST /api/lobbies`
 * takes; `createLobby` posts it and fills in the bot seats. It is called from `/new/rules`' BATTLE
 * when the mode is online — the lobby browser's `Create` only starts that flow.
 */
import { PLAYABLE_MAP_SLUGS } from "@/components/online/maps";
import {
  DEFAULT_RULES,
  MAX_SEATS,
  TURN_SECONDS,
  type BotTier,
  type Rules,
} from "@/engine/types";
import type { SessionConfigState } from "@/game/sessionConfig";

const ONLINE_RULES: Rules = { ...DEFAULT_RULES, turnSeconds: TURN_SECONDS[1] };

const DEFAULT_MAP_SLUG = PLAYABLE_MAP_SLUGS[0] ?? "classic-world";

/** What `Create` posts, assembled from the setup store or from the defaults. */
export interface LobbyChoice {
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly maxSeats: number;
  /** Bot seat rows to fill in once the lobby exists, by lobby seat index. */
  readonly bots: readonly { readonly seat: number; readonly tier: BotTier }[];
}

/**
 * The lobby the player actually asked for (SPEC §7, §5.1).
 *
 * `/lobby` is the end of the **Online setup flow**, not a separate entrance:
 * `/new` writes `mode: "online"`, `/new/map` writes the `MapSource`,
 * `/new/rules` writes the `Rules` and the seat rows, and BATTLE sets `ready`
 * and routes here. Posting a hard-coded `classic-world`, `DEFAULT_RULES` and
 * six seats threw all three away — the player picked Fog of War on a 4-seat
 * Europe board and got a 6-seat classic world with fog off.
 *
 * Three narrowings, each for a reason the server would otherwise enforce the
 * hard way:
 *
 * - **A generated map cannot be hosted.** A `random` source exists only in
 *   this browser's store; the authority loads a board by slug (`MapSlugSchema`
 *   refuses anything else) and the other five players have no way to receive
 *   one. So a random source falls back to the default slug rather than
 *   failing `create` with a `400`.
 * - **A fixture slug is never offered**, per D39, so one in the store is
 *   treated as nothing chosen.
 * - **An online game always has a turn timer** (R79): a `null` `turnSeconds`
 *   is offline's value and would leave a disconnected seat stalling the table
 *   forever, so it becomes §7's 90 s default.
 *
 * Seat rows become `maxSeats`, and each **bot** row becomes a bot seat in the
 * room — `POST /api/lobbies` has no seat argument, so they are filled in with
 * the same `PATCH … { seats }` the host's own "Add a bot…" uses. Seat 0 is
 * always the host, so a bot row there is dropped rather than overwriting them.
 */
export function lobbyChoice(state: SessionConfigState): LobbyChoice {
  if (state.mode !== "online" || !state.ready) {
    return { mapSlug: DEFAULT_MAP_SLUG, rules: ONLINE_RULES, maxSeats: MAX_SEATS, bots: [] };
  }

  const chosen = state.source?.kind === "slug" ? state.source.slug : null;
  const mapSlug =
    chosen !== null && PLAYABLE_MAP_SLUGS.includes(chosen) ? chosen : DEFAULT_MAP_SLUG;

  const rules: Rules = {
    ...state.rules,
    turnSeconds: state.rules.turnSeconds ?? TURN_SECONDS[1],
  };

  const maxSeats = Math.max(2, Math.min(MAX_SEATS, state.seats.length));
  const bots = state.seats
    .map((seat, index) => ({ seat: index, tier: seat.tier ?? rules.aiDifficulty, kind: seat.kind }))
    .filter((row) => row.kind === "bot" && row.seat > 0 && row.seat < maxSeats)
    .map((row) => ({ seat: row.seat, tier: row.tier }));

  return { mapSlug, rules, maxSeats, bots };
}


export type CreateLobbyResult = { readonly code: string } | { readonly error: string };

/**
 * `POST /api/lobbies` from the store, then the bot rows in one `PATCH`. A `409` means the player
 * already hosts a room, and the right answer is that room's code rather than a refusal. A failed
 * bot `PATCH` is not worth refusing the lobby over: the room is live and its host controls can add
 * the same bots by hand.
 */
export async function createLobby(
  state: SessionConfigState,
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateLobbyResult> {
  const choice = lobbyChoice(state);
  const response = await fetchImpl("/api/lobbies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ title, mapSlug: choice.mapSlug, rules: choice.rules, maxSeats: choice.maxSeats }),
  });
  if (response.status === 409) {
    const body = (await response.json()) as { code?: string };
    if (body.code) return { code: body.code };
  }
  if (!response.ok) return { error: "Could not create a lobby." };
  const { code } = (await response.json()) as { code: string };
  if (choice.bots.length > 0) {
    await fetchImpl(`/api/lobbies/${code}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        seats: choice.bots.map((bot) => ({ seat: bot.seat, kind: "bot", tier: bot.tier })),
      }),
    }).catch(() => undefined);
  }
  return { code };
}
