import "server-only";

import type { BotTier, GameState, PlayerColour, Rules, SeatKind, Standing } from "@/engine/types";
import type { PresenceRow } from "@/ports/sync";

import type { SqlExecutor } from "../driver";
import { getDb } from "../index";

/**
 * The `games` + `game_players` tables (SPEC §6.2).
 *
 * Two things in here carry the whole sync design:
 *
 * - **`seq` duplicates `max(game_actions.seq)` deliberately.** The poll's hot
 *   path is "has anything happened since n", and one indexed row answers it;
 *   `max()` over the log does not. It is maintained inside the appending
 *   transaction, so it cannot drift.
 * - **`seed` never leaves this file.** It is read by the tick and the submit
 *   handler to build an `Rng`, and it is absent from every row shape this
 *   module hands back except {@link GameSecretRow}, which no response
 *   serialiser can reach because no route returns it (D5).
 */

export type GameStatus = "playing" | "finished" | "abandoned";

/** The cheap one-statement read the poll's fast path makes. */
export interface GameHeadRow {
  readonly id: string;
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly status: GameStatus;
  readonly seq: number;
  readonly snapshotSeq: number;
  readonly currentSeat: number;
  readonly phase: string;
  readonly turnDeadline: string | null;
  readonly tickLease: string | null;
  readonly winnerSeat: number | null;
}

/** The head plus everything a fold needs. `seed` is on this shape alone. */
export interface GameSecretRow extends GameHeadRow {
  readonly seed: string;
  readonly snapshot: GameState;
  readonly stateHash: string;
  readonly botMemory: Record<string, { grudge: number[] }>;
}

export interface GamePlayerRow {
  readonly seat: number;
  readonly kind: SeatKind;
  readonly playerId: string | null;
  readonly tier: BotTier | null;
  readonly displayName: string;
  readonly colour: PlayerColour;
  readonly standing: Standing;
  readonly missedTurns: number;
  readonly lastSeenAt: string | null;
}

export interface GameSeatInput {
  readonly seat: number;
  readonly kind: SeatKind;
  readonly playerId: string | null;
  readonly tier: BotTier | null;
  readonly displayName: string;
  readonly colour: PlayerColour;
}

/** Everything the appending transaction writes back onto the games row. */
export interface GameCommit {
  readonly seq: number;
  readonly snapshot: GameState;
  readonly snapshotSeq: number;
  readonly stateHash: string;
  readonly currentSeat: number;
  readonly phase: string;
  /** Seconds from `now()`, computed by the database; `null` clears the timer. */
  readonly turnSeconds: number | null;
  /**
   * Whether this commit starts a new seat's turn (§5.6).
   *
   * The turn timer belongs to **a turn**, not to a write, so a commit in the
   * middle of one leaves `turn_deadline` exactly where it was. Renewing it on
   * every commit — which is what this did — means a seat can hold the board
   * forever by drafting one troop every eighty seconds: each append pushes
   * its own deadline out and the timer never fires.
   *
   * The deadline is also renewed when the row currently has none, which is
   * the game's first commit and the resume after a bot turn or a reclaim: a
   * `null` deadline means nobody was on the clock, so whoever is now gets a
   * full one.
   */
  readonly renewDeadline: boolean;
  readonly status: GameStatus;
  readonly winnerSeat: number | null;
  readonly botMemory: Record<string, { grudge: number[] }>;
}

type DbHead = {
  id: string;
  map_id: string;
  rules: unknown;
  status: string;
  seq: string | number;
  snapshot_seq: string | number;
  current_seat: number;
  phase: string;
  turn_deadline: string | Date | null;
  tick_lease: string | Date | null;
  winner_seat: number | null;
};

type DbSecret = DbHead & {
  seed: string;
  snapshot: unknown;
  state_hash: string;
  bot_memory: unknown;
};

type DbPlayer = {
  seat: number;
  kind: string;
  player_id: string | null;
  bot_level: string | null;
  display_name: string;
  color: string;
  standing: string;
  missed_turns: number;
  last_seen_at: string | Date | null;
};

function decodeJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function isoOrNull(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toHead(row: DbHead): GameHeadRow {
  return {
    id: row.id,
    mapSlug: row.map_id,
    rules: decodeJson<Rules>(row.rules),
    status: row.status as GameStatus,
    seq: Number(row.seq),
    snapshotSeq: Number(row.snapshot_seq),
    currentSeat: Number(row.current_seat),
    phase: row.phase,
    turnDeadline: isoOrNull(row.turn_deadline),
    tickLease: isoOrNull(row.tick_lease),
    winnerSeat: row.winner_seat === null ? null : Number(row.winner_seat),
  };
}

function toSecret(row: DbSecret): GameSecretRow {
  return {
    ...toHead(row),
    seed: row.seed,
    snapshot: decodeJson<GameState>(row.snapshot),
    stateHash: row.state_hash,
    botMemory: decodeJson<Record<string, { grudge: number[] }>>(row.bot_memory) ?? {},
  };
}

function toPlayer(row: DbPlayer): GamePlayerRow {
  return {
    seat: Number(row.seat),
    kind: row.kind as SeatKind,
    playerId: row.player_id,
    tier: (row.bot_level as BotTier | null) ?? null,
    displayName: row.display_name,
    colour: row.color as PlayerColour,
    standing: row.standing as Standing,
    missedTurns: Number(row.missed_turns),
    lastSeenAt: isoOrNull(row.last_seen_at),
  };
}

const HEAD_COLUMNS =
  "id, map_id, rules, status, seq, snapshot_seq, current_seat, phase, turn_deadline, tick_lease, winner_seat";
const SECRET_COLUMNS = `${HEAD_COLUMNS}, seed, snapshot, state_hash, bot_memory`;

export class GamesRepository {
  constructor(private readonly db: SqlExecutor) {}

  async create(input: {
    id: string;
    lobbyId: string | null;
    mapSlug: string;
    rules: Rules;
    seed: string;
    snapshot: GameState;
    /** `seq` and `snapshot_seq` are both 1: the snapshot IS the state after
     *  `GAME_STARTED`, which is appended in the same transaction. */
    seq: number;
    snapshotSeq: number;
    stateHash: string;
    currentSeat: number;
    phase: string;
    turnSeconds: number | null;
    seats: readonly GameSeatInput[];
  }): Promise<void> {
    await this.db.execute(
      `insert into games
         (id, lobby_id, map_id, rules, seed, status, seq, snapshot, snapshot_seq,
          state_hash, current_seat, phase, turn_deadline)
       values ($1, $2, $3, $4::jsonb, $5, 'playing', $11, $6::jsonb, $12, $7, $8, $9,
               case when $10::int is null then null else now() + ($10::int * interval '1 second') end)`,
      [
        input.id,
        input.lobbyId,
        input.mapSlug,
        JSON.stringify(input.rules),
        input.seed,
        JSON.stringify(input.snapshot),
        input.stateHash,
        input.currentSeat,
        input.phase,
        input.turnSeconds,
        input.seq,
        input.snapshotSeq,
      ],
    );
    for (const seat of input.seats) {
      await this.db.execute(
        `insert into game_players
           (game_id, seat, kind, player_id, bot_level, display_name, color, standing, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'active',
                 case when $4::text is null then null else now() end)`,
        [
          input.id,
          seat.seat,
          seat.kind,
          seat.playerId,
          seat.tier,
          seat.displayName,
          seat.colour,
        ],
      );
    }
  }

  /** The poll's fast path: one indexed row, no snapshot, no seed. */
  async head(id: string): Promise<GameHeadRow | null> {
    const rows = await this.db.query<DbHead>(
      `select ${HEAD_COLUMNS} from games where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toHead(row) : null;
  }

  /** The fold's read. Only ever called inside a transaction or a tick. */
  async secret(id: string): Promise<GameSecretRow | null> {
    const rows = await this.db.query<DbSecret>(
      `select ${SECRET_COLUMNS} from games where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toSecret(row) : null;
  }

  /**
   * `select … for update` — the fence that stops a double-clicked Attack
   * racing two inserts for `seq + 1` (§5.5). The second submitter blocks,
   * re-reads, and finds the first action already there.
   */
  async secretForUpdate(id: string): Promise<GameSecretRow | null> {
    const rows = await this.db.query<DbSecret>(
      `select ${SECRET_COLUMNS} from games where id = $1 for update`,
      [id],
    );
    const row = rows[0];
    return row ? toSecret(row) : null;
  }

  async commit(id: string, commit: GameCommit): Promise<void> {
    await this.db.execute(
      `update games set
         seq = $2, snapshot = $3::jsonb, snapshot_seq = $4, state_hash = $5,
         current_seat = $6, phase = $7,
         turn_deadline = case
           when $8::int is null then null
           when $12::boolean or turn_deadline is null
             then now() + ($8::int * interval '1 second')
           else turn_deadline end,
         status = $9, winner_seat = $10, bot_memory = $11::jsonb,
         tick_lease = null, updated_at = now()
       where id = $1`,
      [
        id,
        commit.seq,
        JSON.stringify(commit.snapshot),
        commit.snapshotSeq,
        commit.stateHash,
        commit.currentSeat,
        commit.phase,
        commit.turnSeconds,
        commit.status,
        commit.winnerSeat,
        JSON.stringify(commit.botMemory),
        commit.renewDeadline,
      ],
    );
  }

  /**
   * Take the tick lease, or report that another poll already holds it.
   *
   * A conditional `update … returning` rather than a lock: a loser can answer
   * immediately from the log instead of blocking, which is the whole point of
   * a lease over `for update` on this path (§5.6).
   */
  async takeTickLease(id: string, seconds = 10): Promise<number | null> {
    const rows = await this.db.query<{ seq: string | number }>(
      `update games set tick_lease = now() + ($2::int * interval '1 second')
        where id = $1 and (tick_lease is null or tick_lease < now())
        returning seq`,
      [id, seconds],
    );
    const row = rows[0];
    return row ? Number(row.seq) : null;
  }

  async releaseTickLease(id: string): Promise<void> {
    await this.db.execute("update games set tick_lease = null where id = $1", [id]);
  }

  /** Only the snapshot — the reaper's compaction path. */
  async rewriteSnapshot(
    id: string,
    snapshot: GameState,
    snapshotSeq: number,
    stateHash: string,
  ): Promise<void> {
    await this.db.execute(
      `update games set snapshot = $2::jsonb, snapshot_seq = $3, state_hash = $4
        where id = $1`,
      [id, JSON.stringify(snapshot), snapshotSeq, stateHash],
    );
  }

  async players(id: string): Promise<GamePlayerRow[]> {
    const rows = await this.db.query<DbPlayer>(
      `select seat, kind, player_id, bot_level, display_name, color, standing,
              missed_turns, last_seen_at
         from game_players where game_id = $1 order by seat asc`,
      [id],
    );
    return rows.map(toPlayer);
  }

  async seatOf(id: string, playerId: string): Promise<number | null> {
    const rows = await this.db.query<{ seat: number }>(
      "select seat from game_players where game_id = $1 and player_id = $2",
      [id, playerId],
    );
    const row = rows[0];
    return row ? Number(row.seat) : null;
  }

  /** POLL 3's `presence`, straight off the seat rows. */
  async presence(id: string): Promise<PresenceRow[]> {
    const rows = await this.db.query<{
      seat: number;
      standing: string;
      missed_turns: number;
      online: boolean | null;
    }>(
      `select seat, standing, missed_turns,
              (kind = 'human' and last_seen_at is not null
                 and last_seen_at > now() - interval '45 seconds') as online
         from game_players where game_id = $1 order by seat asc`,
      [id],
    );
    return rows.map((row) => ({
      seat: Number(row.seat),
      standing: row.standing as Standing,
      online: row.online === true,
      missedTurns: Number(row.missed_turns),
    }));
  }

  async touchSeat(id: string, playerId: string): Promise<void> {
    await this.db.execute(
      "update game_players set last_seen_at = now() where game_id = $1 and player_id = $2",
      [id, playerId],
    );
  }

  async setSeatKind(
    id: string,
    seat: number,
    kind: SeatKind,
    standing: Standing,
    tier: BotTier | null,
  ): Promise<void> {
    await this.db.execute(
      `update game_players set kind = $3, standing = $4, bot_level = $5
        where game_id = $1 and seat = $2`,
      [id, seat, kind, standing, tier],
    );
  }

  async setMissedTurns(id: string, seat: number, missedTurns: number): Promise<void> {
    await this.db.execute(
      "update game_players set missed_turns = $3 where game_id = $1 and seat = $2",
      [id, seat, missedTurns],
    );
  }

  async setStanding(id: string, seat: number, standing: Standing): Promise<void> {
    await this.db.execute(
      "update game_players set standing = $3 where game_id = $1 and seat = $2",
      [id, seat, standing],
    );
  }

  /** `true` while the seat is a human whose account was seen inside `seconds`. */
  async seatIsLiveHuman(id: string, seat: number, seconds = 120): Promise<boolean> {
    const rows = await this.db.query<{ live: boolean }>(
      `select (kind = 'human' and standing = 'active' and last_seen_at is not null
                 and last_seen_at > now() - ($3::int * interval '1 second')) as live
         from game_players where game_id = $1 and seat = $2`,
      [id, seat, seconds],
    );
    return rows[0]?.live === true;
  }
}

export function gamesRepository(db: SqlExecutor = getDb()): GamesRepository {
  return new GamesRepository(db);
}
