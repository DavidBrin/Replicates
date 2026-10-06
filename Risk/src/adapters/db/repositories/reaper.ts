import "server-only";

import type { SqlExecutor } from "../driver";
import { getDb } from "../index";

/**
 * The lazy reaper's SQL (SPEC §6.3).
 *
 * Garbage collection rides the polls — once per ~60 s per process, and with a
 * `limit` on every statement so no single request can be slow. Postgres has
 * no `update … limit`, so each sweep bounds itself with
 * `where id in (select … limit n)`; that is the only reason these look more
 * elaborate than the rules they implement.
 *
 * `GET /api/cron/sweep` runs the same functions with a much larger limit —
 * the belt-and-braces pass for the week nobody visits.
 */

export interface SweepCounts {
  staleLobbies: number;
  abandonedGames: number;
  oldGames: number;
  deadPlayers: number;
  oldChat: number;
}

export class ReaperRepository {
  constructor(private readonly db: SqlExecutor) {}

  /** `status='open'` and untouched for 20 minutes → `closed`. */
  async closeStaleLobbies(limit: number): Promise<number> {
    return this.db.execute(
      `update lobbies set status = 'closed'
        where id in (
          select id from lobbies
           where status = 'open' and updated_at < now() - interval '20 minutes'
           order by updated_at asc limit $1)`,
      [limit],
    );
  }

  /**
   * Every human seat unseen for 30 minutes → `abandoned`.
   *
   * A seat with `last_seen_at is null` has never polled, which counts as
   * away; a game with no human seats at all is not abandoned by this rule —
   * it is a bot-only game and `not exists` would wrongly catch it, so the
   * `exists` clause requires at least one human seat.
   */
  async abandonDeadGames(limit: number): Promise<number> {
    return this.db.execute(
      `update games set status = 'abandoned', updated_at = now()
        where id in (
          select g.id from games g
           where g.status = 'playing'
             and exists (select 1 from game_players gp
                          where gp.game_id = g.id and gp.kind = 'human')
             and not exists (select 1 from game_players gp
                              where gp.game_id = g.id and gp.kind = 'human'
                                and gp.last_seen_at is not null
                                and gp.last_seen_at > now() - interval '30 minutes')
           order by g.updated_at asc limit $1)`,
      [limit],
    );
  }

  /** Finished or abandoned for 7 days → delete; the log cascades. */
  async deleteOldGames(limit: number): Promise<number> {
    return this.db.execute(
      `delete from games where id in (
         select id from games
          where status in ('finished','abandoned')
            and updated_at < now() - interval '7 days'
          order by updated_at asc limit $1)`,
      [limit],
    );
  }

  /** Unseen for 24 h with no live game or lobby seat → delete. */
  async deleteDeadPlayers(limit: number): Promise<number> {
    return this.db.execute(
      `delete from players where id in (
         select p.id from players p
          where p.last_seen_at < now() - interval '24 hours'
            and not exists (select 1 from game_players gp join games g on g.id = gp.game_id
                             where gp.player_id = p.id and g.status = 'playing')
            and not exists (select 1 from lobby_seats ls where ls.player_id = p.id)
          order by p.last_seen_at asc limit $1)`,
      [limit],
    );
  }

  /** Chat older than 7 days → delete. */
  async deleteOldChat(limit: number): Promise<number> {
    return this.db.execute(
      `delete from chat_messages where id in (
         select id from chat_messages
          where created_at < now() - interval '7 days'
          order by id asc limit $1)`,
      [limit],
    );
  }

  /**
   * Games whose log has run `> behind` actions past their snapshot.
   *
   * The append path writes `snapshot_seq = seq` every time, so compaction
   * only ever has work after a tick that appended several actions under one
   * lease — which is exactly the case the `since < snapshot_seq` poll branch
   * exists for.
   */
  async compactionCandidates(behind: number, limit: number): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `select id from games
        where status = 'playing' and seq - snapshot_seq > $1
        order by seq - snapshot_seq desc limit $2`,
      [behind, limit],
    );
    return rows.map((row) => row.id);
  }
}

export function reaperRepository(db: SqlExecutor = getDb()): ReaperRepository {
  return new ReaperRepository(db);
}
