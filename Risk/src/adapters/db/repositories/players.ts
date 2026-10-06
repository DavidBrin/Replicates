import "server-only";

import type { PlayerColour } from "@/engine/types";

import type { SqlExecutor } from "../driver";
import { getDb } from "../index";
import { newPlayerId, newSecret, secretMatches, sha256Hex } from "./ids";

/**
 * The `players` table (SPEC §6.1, §6.2) — the whole "temporary account".
 *
 * A name is held **only while its owner is live**: free two minutes after
 * they leave, unless they are seated in a lobby or a live game, in which case
 * they are never reaped. That rule lives in one SQL statement
 * ({@link PlayersRepository.reapDeadHolder}) rather than in a handler,
 * because it has to be atomic with the insert that takes the name.
 *
 * Presence is a column on this table, not a second table: an account whose
 * whole lifetime is the session would give a presence row the same lifetime,
 * one more write per poll and one more join per read (§6.2).
 */

export interface PlayerRow {
  readonly id: string;
  readonly displayName: string;
  readonly nameKey: string;
  readonly colour: PlayerColour;
  readonly lastSeenAt: string;
}

/** What `POST /api/session` hands back: the row plus the one-time secret. */
export interface ClaimedPlayer {
  readonly player: PlayerRow;
  readonly secret: string;
}

type DbPlayer = {
  id: string;
  display_name: string;
  name_key: string;
  color: string;
  secret_hash: string;
  last_seen_at: string | Date;
};

function isoOf(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toRow(row: DbPlayer): PlayerRow {
  return {
    id: row.id,
    displayName: row.display_name,
    nameKey: row.name_key,
    colour: row.color as PlayerColour,
    lastSeenAt: isoOf(row.last_seen_at),
  };
}

const COLUMNS = "id, display_name, name_key, color, secret_hash, last_seen_at";

export class PlayersRepository {
  constructor(private readonly db: SqlExecutor) {}

  /**
   * Conditionally and atomically delete a dead holder of `nameKey`.
   *
   * Three conditions, all required: unseen for two minutes, not seated in a
   * game whose status is `playing`, and not seated in any lobby. A player
   * sitting in a live game is never reaped however long they have been away,
   * because their seat still refers to them.
   */
  async reapDeadHolder(nameKey: string): Promise<number> {
    return this.db.execute(
      `delete from players p
        where p.name_key = $1
          and p.last_seen_at < now() - interval '2 minutes'
          and not exists (select 1 from game_players gp join games g on g.id = gp.game_id
                           where gp.player_id = p.id and g.status = 'playing')
          and not exists (select 1 from lobby_seats ls where ls.player_id = p.id)`,
      [nameKey],
    );
  }

  /**
   * Take `displayName`, or report it held.
   *
   * The unique index on `name_key` arbitrates the race: `on conflict do
   * nothing returning id` gives zero rows exactly when someone live already
   * holds it, which is the `409` the route turns into suggestions.
   */
  async claim(
    displayName: string,
    nameKey: string,
    colour: PlayerColour,
  ): Promise<ClaimedPlayer | null> {
    const id = newPlayerId();
    const secret = newSecret();
    const rows = await this.db.query<DbPlayer>(
      `insert into players (id, display_name, name_key, secret_hash, color)
       values ($1, $2, $3, $4, $5)
       on conflict (name_key) do nothing
       returning ${COLUMNS}`,
      [id, displayName, nameKey, sha256Hex(secret), colour],
    );
    const row = rows[0];
    return row ? { player: toRow(row), secret } : null;
  }

  /** Is `nameKey` free right now? Used to probe suggestions. */
  async isNameFree(nameKey: string): Promise<boolean> {
    const rows = await this.db.query<{ one: number }>(
      "select 1 as one from players where name_key = $1",
      [nameKey],
    );
    return rows.length === 0;
  }

  async byId(id: string): Promise<PlayerRow | null> {
    const rows = await this.db.query<DbPlayer>(
      `select ${COLUMNS} from players where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toRow(row) : null;
  }

  /**
   * Authenticate a cookie's two halves.
   *
   * The hash compare is constant time ({@link secretMatches}); a missing row
   * and a wrong secret are the same answer, so neither leaks which it was.
   */
  async authenticate(id: string, secret: string): Promise<PlayerRow | null> {
    const rows = await this.db.query<DbPlayer>(
      `select ${COLUMNS} from players where id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return secretMatches(secret, row.secret_hash) ? toRow(row) : null;
  }

  /** The presence heartbeat. Ridden by every poll; never its own request. */
  async touch(id: string): Promise<void> {
    await this.db.execute("update players set last_seen_at = now() where id = $1", [id]);
  }

  /**
   * Stamp the player's seat **in one game**, for the away sweep (§5.6).
   *
   * One game, never all of them. The seat stamp is what says "this seat's
   * owner is at the board", and the away takeover, the reclaim and POLL 3's
   * `presence` all read it — so a player sitting in the lobby browser, or
   * polling game A, must not keep their seat in game B looking live. Stamping
   * every seat made the two-minute away rule unreachable for anybody with a
   * second tab open.
   */
  async touchSeat(id: string, gameId: string): Promise<void> {
    await this.db.execute(
      `update game_players set last_seen_at = now()
        where player_id = $1 and game_id = $2`,
      [id, gameId],
    );
  }

  async setColour(id: string, colour: PlayerColour): Promise<PlayerRow | null> {
    const rows = await this.db.query<DbPlayer>(
      `update players set color = $2 where id = $1 returning ${COLUMNS}`,
      [id, colour],
    );
    const row = rows[0];
    return row ? toRow(row) : null;
  }

  /** Rename, or `null` when the new `name_key` is held by somebody else. */
  async rename(id: string, displayName: string, nameKey: string): Promise<PlayerRow | null> {
    const held = await this.db.query<{ id: string }>(
      "select id from players where name_key = $1 and id <> $2",
      [nameKey, id],
    );
    if (held.length > 0) return null;
    const rows = await this.db.query<DbPlayer>(
      `update players set display_name = $2, name_key = $3 where id = $1 returning ${COLUMNS}`,
      [id, displayName, nameKey],
    );
    const row = rows[0];
    return row ? toRow(row) : null;
  }

  async remove(id: string): Promise<void> {
    await this.db.execute("delete from players where id = $1", [id]);
  }

  /**
   * The lobby browser's online-players column (POLL 1).
   *
   * Seen in the last 5 minutes, flagged `online` inside 45 seconds. A 45 s
   * window against a ≤15 s poll means two missed polls before you look
   * offline — tolerant of a slow network, tight enough to be truthful.
   */
  async online(limit = 100): Promise<
    { id: string; displayName: string; colour: PlayerColour; online: boolean }[]
  > {
    const rows = await this.db.query<{
      id: string;
      display_name: string;
      color: string;
      online: boolean;
    }>(
      `select id, display_name, color,
              (last_seen_at > now() - interval '45 seconds') as online
         from players
        where last_seen_at > now() - interval '5 minutes'
        order by last_seen_at desc
        limit $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      colour: row.color as PlayerColour,
      online: row.online === true,
    }));
  }
}

export function playersRepository(db: SqlExecutor = getDb()): PlayersRepository {
  return new PlayersRepository(db);
}
