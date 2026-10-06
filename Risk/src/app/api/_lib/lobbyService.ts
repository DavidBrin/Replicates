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
 * bumps one of them), the newest global chat id, and {@link presenceHash} over
 * the visible players.
 *
 * The third field is a **hash and not a count**: the body carries one
 * `online` flag per player, and a count cannot see a change in them. One
 * player going offline as another arrives leaves the count where it was, so
 * every client answered `204` and kept showing both as online until something
 * else moved.
 *
 * The fields are masked to 26 / 13 / 13 bits and packed below 2⁵², so the
 * whole thing stays an exact `Number`. A mask collision would need one of the
 * three to jump by its full modulus between two polls five seconds apart —
 * 67 million lobby edits, or 8,192 chat lines — which is not a case worth
 * widening the cursor for. The presence field is the one that can genuinely
 * collide, at 1 in 8,192 per change; a collision costs one missed presence
 * update, which the next change corrects.
 */
export function packBrowseVersion(
  lobbyVersionSum: number,
  newestChatId: number,
  presence: number,
): number {
  const lobbies = lobbyVersionSum % 2 ** 26;
  const chat = newestChatId % 2 ** 13;
  const players = Math.abs(Math.trunc(presence)) % 2 ** 13;
  return lobbies * 2 ** 26 + chat * 2 ** 13 + players;
}

/**
 * A 13-bit digest of `(id, online)` pairs — the presence half of a poll's
 * cursor (§6).
 *
 * FNV-1a over the pairs in the order given. The *identity* of who is online
 * has to be in it and not merely the count: an arrival and a departure in the
 * same interval cancel out in a count, and the two polls that carry presence
 * flags would then both answer `204` while showing the wrong roster.
 */
export function presenceHash(
  rows: readonly { readonly id: string; readonly online: boolean }[],
): number {
  let hash = 0x811c9dc5;
  for (const row of rows) {
    for (const text of [row.id, row.online ? "1" : "0", "\u0000"]) {
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
  }
  return hash % 2 ** 13;
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
    version: packBrowseVersion(lobbySum, chatMax, presenceHash(online)),
    players: online,
    lobbies: list,
    chat,
    you: { playerId: you.id, displayName: you.displayName, colour: you.colour },
  };
}

/**
 * POLL 2's `?since=` cursor: the lobby's `version` in the high bits, its
 * seats' presence in the low 13.
 *
 * The version keeps the high bits so the cursor stays monotonic in it — an
 * edit always produces a larger number than the one before it, whatever the
 * presence digest does.
 */
export function packRoomVersion(version: number, presence: number): number {
  return version * 2 ** 13 + (Math.abs(Math.trunc(presence)) % 2 ** 13);
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
    // `lobbies.version` alone is not POLL 2's cursor: the body carries one
    // `online` flag per seat, read from the occupant's heartbeat rather than
    // from the lobby row, so a player going offline changes the response
    // without bumping `version` — and every client answered `204` and went on
    // showing them as present. The seat presence is folded in the same way
    // POLL 1 folds its player list, and the lobby's own version keeps the
    // high bits, so the cursor still only ever moves forward when a lobby is
    // edited.
    version: packRoomVersion(
      lobby.version,
      presenceHash(
        seats.map((seat) => ({ id: seat.playerId ?? `#${seat.seat}`, online: seat.online })),
      ),
    ),
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

  /*
   * One transaction, and the `open → starting` flip is a **compare-and-set**
   * inside it (`LobbiesRepository.claimForStart`). A read-then-write could not
   * do the job: two `BATTLE` presses — a double click, or the host's two tabs
   * — both read `open` and both went on to `createGame`, so one lobby became
   * two boards seating the same players, and `lobbies.game_id` pointed at
   * whichever finished last while the other game sat orphaned with live
   * seats in it. Exactly one press gets a row back from the update; the loser
   * answers `409` having created nothing.
   *
   * The seat checks stay in front of the flip so a `needTwoSeats` press does
   * not have to be rolled back, and `createGame`'s own transaction nests into
   * this one (`SqlDatabase.transaction`), which is what makes the game, the
   * opening action and the lobby's `playing` status one atomic write.
   */
  return db.transaction(async (tx): Promise<StartResult> => {
    const lobbies = new LobbiesRepository(tx);

    const lobby = await lobbies.byCode(code);
    if (!lobby) return { kind: "notFound" };
    if (lobby.hostId !== playerId) return { kind: "notHost" };
    if (lobby.status !== "open") return { kind: "alreadyStarted" };

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

    const claimed = await lobbies.claimForStart(code);
    if (!claimed) return { kind: "alreadyStarted" };

    const gameId = await createGame(
      {
        lobbyId: code,
        mapSlug: claimed.mapSlug,
        rules: claimed.rules,
        seats: assigned,
      },
      tx,
    );
    await lobbies.setStatus(code, "playing", gameId);
    await lobbies.bump(code);
    return { kind: "started", gameId };
  });
}
