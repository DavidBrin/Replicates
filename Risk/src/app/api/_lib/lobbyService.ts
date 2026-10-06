import "server-only";

import { getDb } from "@/adapters/db";
import { ChatRepository } from "@/adapters/db/repositories/chat";
import { LobbiesRepository, type LobbyListRow } from "@/adapters/db/repositories/lobbies";
import { PlayersRepository } from "@/adapters/db/repositories/players";
import type { BotTier, PlayerColour, Rules } from "@/engine/types";
import type { ChatLine } from "@/ports/sync";

import { createGame } from "./gameService";

/**
 * POLL 1 and POLL 2's bodies, and the `start` transition (SPEC §6, §7).
 *
 * Three poll endpoints and no fourth: one per screen, each returning
 * everything that screen shows. Chat is never its own poll and presence is
 * never its own request — that folding is what makes the invocation budget
 * work (D12).
 */

/** POLL 1 — `GET /api/lobby?since=<version>`. */
export interface LobbyBrowse {
  version: number;
  players: { id: string; displayName: string; colour: PlayerColour; online: boolean }[];
  lobbies: LobbyListRow[];
  chat: ChatLine[];
  you: { playerId: string; displayName: string; colour: PlayerColour };
}

/** POLL 2 — `GET /api/lobbies/:code?since=<version>`. */
export interface LobbyRoom {
  version: number;
  code: string;
  title: string;
  hostId: string;
  status: "open" | "starting" | "playing" | "closed";
  mapSlug: string;
  rules: Rules;
  maxSeats: number;
  gameId: string | null;
  seats: {
    seat: number;
    kind: "open" | "human" | "bot";
    playerId: string | null;
    displayName: string | null;
    colour: PlayerColour | null;
    tier: BotTier | null;
    ready: boolean;
    online: boolean;
  }[];
  chat: ChatLine[];
}

/**
 * POLL 1's `?since=` cursor.
 *
 * Polls 2 and 3 have one row to read a version off (`lobbies.version`,
 * `games.seq`); the lobby *browser* has none, because it shows three
 * independent things. So its cursor is those three packed into one safe
 * integer: the sum of every listed lobby's `version` (any edit to any lobby
 * bumps one of them), the newest global chat id, and how many players are
 * currently visible.
 *
 * The fields are masked to 26 / 13 / 13 bits and packed below 2⁵², so the
 * whole thing stays an exact `Number`. A mask collision would need one of the
 * three to jump by its full modulus between two polls five seconds apart —
 * 67 million lobby edits, or 8,192 chat lines — which is not a case worth
 * widening the cursor for.
 */
export function packBrowseVersion(
  lobbyVersionSum: number,
  newestChatId: number,
  onlineCount: number,
): number {
  const lobbies = lobbyVersionSum % 2 ** 26;
  const chat = newestChatId % 2 ** 13;
  const players = Math.min(onlineCount, 2 ** 13 - 1);
  return lobbies * 2 ** 26 + chat * 2 ** 13 + players;
}

export async function lobbyBrowse(
  you: { id: string; displayName: string; colour: PlayerColour },
  chatSince: number,
): Promise<LobbyBrowse> {
  const db = getDb();
  const lobbies = new LobbiesRepository(db);
  const players = new PlayersRepository(db);

  const [list, online, chat, sums] = await Promise.all([
    lobbies.listOpen(),
    players.online(),
    new ChatRepository(db).since("global", null, chatSince),
    db.query<{ lobby_sum: string | number | null; chat_max: string | number | null }>(
      `select (select coalesce(sum(version), 0) from lobbies
                where status in ('open','starting')) as lobby_sum,
              (select coalesce(max(id), 0) from chat_messages
                where scope = 'global') as chat_max`,
    ),
  ]);

  const lobbySum = Number(sums[0]?.lobby_sum ?? 0);
  const chatMax = Number(sums[0]?.chat_max ?? 0);

  return {
    version: packBrowseVersion(lobbySum, chatMax, online.length),
    players: online,
    lobbies: list,
    chat,
    you: { playerId: you.id, displayName: you.displayName, colour: you.colour },
  };
}

export async function lobbyRoom(code: string, chatSince: number): Promise<LobbyRoom | null> {
  const db = getDb();
  const lobbies = new LobbiesRepository(db);
  const lobby = await lobbies.byCode(code);
  if (!lobby) return null;

  const [seats, chat] = await Promise.all([
    lobbies.seats(code),
    new ChatRepository(db).since("lobby", code, chatSince),
  ]);

  return {
    version: lobby.version,
    code: lobby.code,
    title: lobby.title,
    hostId: lobby.hostId,
    status: lobby.status,
    mapSlug: lobby.mapSlug,
    rules: lobby.rules,
    maxSeats: lobby.maxSeats,
    gameId: lobby.gameId,
    seats: seats.map((seat) => ({
      seat: seat.seat,
      kind: seat.kind,
      playerId: seat.playerId,
      displayName: seat.displayName,
      colour: seat.colour,
      tier: seat.tier,
      ready: seat.ready,
      online: seat.online,
    })),
    chat,
  };
}

/* ---------------------------------------------------------------- start -- */

export type StartResult =
  | { readonly kind: "started"; readonly gameId: string }
  | { readonly kind: "notFound" }
  | { readonly kind: "notHost" }
  | { readonly kind: "alreadyStarted" }
  | { readonly kind: "needTwoSeats" }
  | { readonly kind: "notAllReady" };

/** The nine player colours, in the order an unset seat takes them. */
const COLOUR_ORDER: readonly PlayerColour[] = [
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

/**
 * `POST /api/lobbies/:code/start` — host only.
 *
 * The occupied seats are **compacted to 0..n-1** before the game is created:
 * `Seat` is an index into `GameState.seats` and the engine's `turnOrder`
 * excludes nothing, so a lobby with seats 0, 2 and 5 taken has to become a
 * three-seat game rather than a six-seat game with three holes in it.
 *
 * Two seats are taken from a colour it has not used, in {@link COLOUR_ORDER},
 * when the occupant has no colour of their own — two seats sharing a colour
 * would make the board unreadable, and the roster's owner-colour stroke is the
 * only thing identifying a capsule.
 */
export async function startLobby(code: string, playerId: string): Promise<StartResult> {
  const db = getDb();
  const lobbies = new LobbiesRepository(db);

  const lobby = await lobbies.byCode(code);
  if (!lobby) return { kind: "notFound" };
  if (lobby.hostId !== playerId) return { kind: "notHost" };
  if (lobby.status !== "open") {
    return lobby.gameId ? { kind: "alreadyStarted" } : { kind: "alreadyStarted" };
  }

  const seats = (await lobbies.seats(code)).filter((seat) => seat.kind !== "open");
  if (seats.length < 2) return { kind: "needTwoSeats" };
  if (seats.some((seat) => seat.kind === "human" && !seat.ready)) {
    return { kind: "notAllReady" };
  }

  const used = new Set<PlayerColour>();
  const assigned = seats
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((seat, index) => {
      let colour = seat.colour;
      if (colour === null || used.has(colour)) {
        colour = COLOUR_ORDER.find((candidate) => !used.has(candidate)) ?? "red";
      }
      used.add(colour);
      return {
        seat: index,
        kind: seat.kind === "bot" ? ("bot" as const) : ("human" as const),
        playerId: seat.kind === "bot" ? null : seat.playerId,
        tier: seat.kind === "bot" ? (seat.tier ?? lobby.rules.aiDifficulty) : null,
        displayName: seat.displayName ?? `Bot ${index + 1}`,
        colour,
      };
    });

  // `starting` first, so a second `BATTLE` press from the same host finds the
  // lobby already past `open` and answers `409` rather than creating a second
  // game out of one lobby.
  await lobbies.setStatus(code, "starting");
  try {
    const gameId = await createGame({
      lobbyId: code,
      mapSlug: lobby.mapSlug,
      rules: lobby.rules,
      seats: assigned,
    });
    await lobbies.setStatus(code, "playing", gameId);
    await lobbies.bump(code);
    return { kind: "started", gameId };
  } catch (error) {
    await lobbies.setStatus(code, "open");
    await lobbies.bump(code);
    throw error;
  }
}
