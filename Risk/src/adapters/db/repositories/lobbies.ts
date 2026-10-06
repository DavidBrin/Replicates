import "server-only";

import type { BotTier, PlayerColour, Rules } from "@/engine/types";

import type { SqlExecutor } from "../driver";
import { getDb } from "../index";
import { newLobbyCode } from "./ids";

/**
 * The `lobbies` + `lobby_seats` tables (SPEC §6.2).
 *
 * `lobbies.version` is the `?since=` cursor for polls 1 and 2, bumped by
 * every change through {@link LobbiesRepository.bump}. Nothing else orders a
 * lobby response, so a client that polls with the version it last saw gets a
 * `204` whenever nothing has moved.
 *
 * `lobby_seats` carries the shape constraint that makes "open / human / bot"
 * a real three-state column rather than three nullable ones that can
 * disagree, and a partial unique index gives **one seat per player per
 * lobby** without a handler having to remember.
 */

export type LobbyStatus = "open" | "starting" | "playing" | "closed";
export type SeatKindRow = "open" | "human" | "bot";

export interface LobbyRow {
  readonly code: string;
  readonly hostId: string;
  readonly title: string;
  readonly status: LobbyStatus;
  readonly mapSlug: string;
  readonly maxSeats: number;
  readonly rules: Rules;
  readonly gameId: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface LobbySeatRow {
  readonly seat: number;
  readonly kind: SeatKindRow;
  readonly playerId: string | null;
  readonly displayName: string | null;
  readonly colour: PlayerColour | null;
  readonly tier: BotTier | null;
  readonly ready: boolean;
  readonly online: boolean;
}

export interface LobbyListRow {
  readonly code: string;
  readonly title: string;
  readonly hostName: string;
  readonly mapSlug: string;
  readonly seatsTaken: number;
  readonly maxSeats: number;
  readonly status: "open" | "starting";
}

/** A host-only seat edit: add or remove a bot, or kick the occupant. */
export type SeatPatch =
  | { readonly seat: number; readonly kind: "open" }
  | { readonly seat: number; readonly kind: "bot"; readonly tier: BotTier };

type DbLobby = {
  id: string;
  host_id: string;
  title: string;
  status: string;
  map_id: string;
  max_seats: number;
  settings: unknown;
  game_id: string | null;
  version: string | number;
  updated_at: string | Date;
};

type DbSeat = {
  seat: number;
  kind: string;
  player_id: string | null;
  bot_level: string | null;
  ready: boolean;
  display_name: string | null;
  color: string | null;
  online: boolean | null;
};

/**
 * `jsonb` arrives decoded from both drivers, but a driver that handed back
 * the text form would still round-trip here rather than crashing a poll.
 */
function decodeJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function isoOf(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toLobby(row: DbLobby): LobbyRow {
  return {
    code: row.id,
    hostId: row.host_id,
    title: row.title,
    status: row.status as LobbyStatus,
    mapSlug: row.map_id,
    maxSeats: Number(row.max_seats),
    rules: decodeJson<Rules>(row.settings),
    gameId: row.game_id,
    version: Number(row.version),
    updatedAt: isoOf(row.updated_at),
  };
}

function toSeat(row: DbSeat): LobbySeatRow {
  return {
    seat: Number(row.seat),
    kind: row.kind as SeatKindRow,
    playerId: row.player_id,
    displayName: row.display_name,
    colour: (row.color as PlayerColour | null) ?? null,
    tier: (row.bot_level as BotTier | null) ?? null,
    ready: row.ready === true,
    online: row.online === true,
  };
}

const LOBBY_COLUMNS =
  "id, host_id, title, status, map_id, max_seats, settings, game_id, version, updated_at";

/** How many attempts before a code collision is treated as a real failure. */
const CODE_ATTEMPTS = 12;

export class LobbiesRepository {
  constructor(private readonly db: SqlExecutor) {}

  /**
   * Create a lobby with `maxSeats` rows in `lobby_seats`, the host already in
   * seat 0. The code is retried against the primary key rather than probed
   * first — a `select` then `insert` is a race, and 24⁴ codes make a
   * collision rare enough that a retry loop is the cheap answer.
   */
  async create(input: {
    hostId: string;
    title: string;
    mapSlug: string;
    rules: Rules;
    maxSeats: number;
  }): Promise<LobbyRow> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = newLobbyCode();
      const rows = await this.db.query<DbLobby>(
        `insert into lobbies (id, host_id, title, status, map_id, max_seats, settings)
         values ($1, $2, $3, 'open', $4, $5, $6::jsonb)
         on conflict (id) do nothing
         returning ${LOBBY_COLUMNS}`,
        [code, input.hostId, input.title, input.mapSlug, input.maxSeats, JSON.stringify(input.rules)],
      );
      const row = rows[0];
      if (!row) continue;

      for (let seat = 0; seat < input.maxSeats; seat += 1) {
        if (seat === 0) {
          await this.db.execute(
            `insert into lobby_seats (lobby_id, seat, kind, player_id) values ($1, 0, 'human', $2)`,
            [code, input.hostId],
          );
        } else {
          await this.db.execute(
            `insert into lobby_seats (lobby_id, seat, kind) values ($1, $2, 'open')`,
            [code, seat],
          );
        }
      }
      return toLobby(row);
    }
    throw new Error("could not mint a free lobby code");
  }

  async byCode(code: string): Promise<LobbyRow | null> {
    const rows = await this.db.query<DbLobby>(
      `select ${LOBBY_COLUMNS} from lobbies where id = $1`,
      [code],
    );
    const row = rows[0];
    return row ? toLobby(row) : null;
  }

  /** Lock the lobby row for the duration of the caller's transaction. */
  async byCodeForUpdate(code: string): Promise<LobbyRow | null> {
    const rows = await this.db.query<DbLobby>(
      `select ${LOBBY_COLUMNS} from lobbies where id = $1 for update`,
      [code],
    );
    const row = rows[0];
    return row ? toLobby(row) : null;
  }

  /** Every seat, with the occupant's denormalised name, colour and liveness. */
  async seats(code: string): Promise<LobbySeatRow[]> {
    const rows = await this.db.query<DbSeat>(
      `select ls.seat, ls.kind, ls.player_id, ls.bot_level, ls.ready,
              p.display_name, p.color,
              (p.last_seen_at > now() - interval '45 seconds') as online
         from lobby_seats ls
         left join players p on p.id = ls.player_id
        where ls.lobby_id = $1
        order by ls.seat asc`,
      [code],
    );
    return rows.map(toSeat);
  }

  /** The lobby browser's list (POLL 1): open and starting lobbies only. */
  async listOpen(limit = 50): Promise<LobbyListRow[]> {
    const rows = await this.db.query<{
      id: string;
      title: string;
      host_name: string;
      map_id: string;
      seats_taken: string | number;
      max_seats: number;
      status: string;
    }>(
      `select l.id, l.title, p.display_name as host_name, l.map_id, l.max_seats, l.status,
              (select count(*) from lobby_seats ls
                where ls.lobby_id = l.id and ls.kind <> 'open') as seats_taken
         from lobbies l
         join players p on p.id = l.host_id
        where l.status in ('open','starting')
        order by l.updated_at desc
        limit $1`,
      [limit],
    );
    return rows.map((row) => ({
      code: row.id,
      title: row.title,
      hostName: row.host_name,
      mapSlug: row.map_id,
      seatsTaken: Number(row.seats_taken),
      maxSeats: Number(row.max_seats),
      status: row.status as "open" | "starting",
    }));
  }

  /** Bump `version` and `updated_at`; returns the new version. */
  async bump(code: string): Promise<number> {
    const rows = await this.db.query<{ version: string | number }>(
      `update lobbies set version = version + 1, updated_at = now()
        where id = $1 returning version`,
      [code],
    );
    return Number(rows[0]?.version ?? 0);
  }

  /** The lobby a player is currently seated in, if any. */
  async lobbyOf(playerId: string): Promise<string | null> {
    const rows = await this.db.query<{ lobby_id: string }>(
      `select ls.lobby_id from lobby_seats ls
         join lobbies l on l.id = ls.lobby_id
        where ls.player_id = $1 and l.status in ('open','starting','playing')
        limit 1`,
      [playerId],
    );
    return rows[0]?.lobby_id ?? null;
  }

  /** The lobby a player currently HOSTS, if any — the `409 already hosting`. */
  async hostedBy(playerId: string): Promise<string | null> {
    const rows = await this.db.query<{ id: string }>(
      `select id from lobbies
        where host_id = $1 and status in ('open','starting') limit 1`,
      [playerId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Seat a player. `seat === null` takes the lowest open seat.
   *
   * Returns the seat index, or a reason the request cannot be honoured. The
   * partial unique index is the real fence against a double-join; the
   * `alreadySeated` check exists so the player gets their own seat number
   * back rather than a constraint error.
   */
  async join(
    code: string,
    playerId: string,
    seat: number | null,
  ): Promise<number | "lobbyFull" | "seatTaken" | "alreadySeated"> {
    const existing = await this.db.query<{ seat: number }>(
      "select seat from lobby_seats where lobby_id = $1 and player_id = $2",
      [code, playerId],
    );
    if (existing[0]) return "alreadySeated";

    if (seat === null) {
      const open = await this.db.query<{ seat: number }>(
        `select seat from lobby_seats where lobby_id = $1 and kind = 'open'
          order by seat asc limit 1`,
        [code],
      );
      const first = open[0];
      if (!first) return "lobbyFull";
      seat = Number(first.seat);
    }

    const taken = await this.db.execute(
      `update lobby_seats set kind = 'human', player_id = $3, bot_level = null,
              ready = false, joined_at = now()
        where lobby_id = $1 and seat = $2 and kind = 'open'`,
      [code, seat, playerId],
    );
    if (taken === 0) return "seatTaken";
    return seat;
  }

  /** Vacate every seat this player holds in `code`. Returns the seat, if any. */
  async leave(code: string, playerId: string): Promise<number | null> {
    const rows = await this.db.query<{ seat: number }>(
      `update lobby_seats set kind = 'open', player_id = null, bot_level = null, ready = false
        where lobby_id = $1 and player_id = $2
        returning seat`,
      [code, playerId],
    );
    const row = rows[0];
    return row ? Number(row.seat) : null;
  }

  /** A seated player's own ready flag (never host-only — see §6's `[SPEC]`). */
  async setReady(code: string, playerId: string, ready: boolean): Promise<boolean> {
    const changed = await this.db.execute(
      `update lobby_seats set ready = $3 where lobby_id = $1 and player_id = $2`,
      [code, playerId, ready],
    );
    return changed > 0;
  }

  /** Apply one host-only {@link SeatPatch}. */
  async patchSeat(code: string, patch: SeatPatch, hostId: string): Promise<void> {
    if (patch.kind === "bot") {
      await this.db.execute(
        `update lobby_seats set kind = 'bot', player_id = null, bot_level = $3, ready = true
          where lobby_id = $1 and seat = $2`,
        [code, patch.seat, patch.tier],
      );
      return;
    }
    // Opening a seat kicks whoever is in it — except the host's own seat,
    // which would leave a lobby with no host in it.
    await this.db.execute(
      `update lobby_seats set kind = 'open', player_id = null, bot_level = null, ready = false
        where lobby_id = $1 and seat = $2
          and (player_id is null or player_id <> $3)`,
      [code, patch.seat, hostId],
    );
  }

  async patch(
    code: string,
    fields: { title?: string; mapSlug?: string; rules?: Rules },
  ): Promise<void> {
    if (fields.title !== undefined) {
      await this.db.execute("update lobbies set title = $2 where id = $1", [code, fields.title]);
    }
    if (fields.mapSlug !== undefined) {
      await this.db.execute("update lobbies set map_id = $2 where id = $1", [code, fields.mapSlug]);
    }
    if (fields.rules !== undefined) {
      await this.db.execute("update lobbies set settings = $2::jsonb where id = $1", [
        code,
        JSON.stringify(fields.rules),
      ]);
    }
  }

  async setStatus(code: string, status: LobbyStatus, gameId?: string | null): Promise<void> {
    if (gameId === undefined) {
      await this.db.execute(
        "update lobbies set status = $2, updated_at = now() where id = $1",
        [code, status],
      );
      return;
    }
    await this.db.execute(
      "update lobbies set status = $2, game_id = $3, updated_at = now() where id = $1",
      [code, status, gameId],
    );
  }

  /** Hand the host to the lowest-seated other human, or `null` if none. */
  async handOffHost(code: string, leavingHostId: string): Promise<string | null> {
    const rows = await this.db.query<{ player_id: string }>(
      `select player_id from lobby_seats
        where lobby_id = $1 and kind = 'human' and player_id is not null
          and player_id <> $2
        order by seat asc limit 1`,
      [code, leavingHostId],
    );
    const next = rows[0]?.player_id ?? null;
    if (next) {
      await this.db.execute("update lobbies set host_id = $2 where id = $1", [code, next]);
    }
    return next;
  }
}

export function lobbiesRepository(db: SqlExecutor = getDb()): LobbiesRepository {
  return new LobbiesRepository(db);
}
