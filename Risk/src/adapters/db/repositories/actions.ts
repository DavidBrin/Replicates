import "server-only";

import type { Action, Seat } from "@/engine/types";
import type { LoggedAction } from "@/ports/sync";

import type { SqlExecutor } from "../driver";
import { getDb } from "../index";

/**
 * The `game_actions` log (SPEC §6.2) — append-only, contiguous `seq` from 1.
 *
 * Two behaviours here are load-bearing rather than convenience:
 *
 * - **`append` reports a duplicate instead of throwing.** Postgres raises
 *   `23505` on the partial unique index over `(game_id, client_action_id)`
 *   when a retried POST arrives; the caller answers `200` with the
 *   already-recorded row, which makes a retry indistinguishable from a slow
 *   success (D15).
 * - **the payload carries the action verbatim**, including every
 *   server-rolled value (dice, the deal, a drawn card). `type` and `seat` are
 *   duplicated into columns only so the log can be filtered without decoding
 *   `jsonb`; the payload is the truth on read.
 */

/** Postgres' unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

export interface AppendInput {
  readonly gameId: string;
  readonly seq: number;
  readonly action: Action;
  readonly actor: "human" | "bot" | "server";
  readonly clientActionId: string | null;
  readonly stateHash: string;
}

export type AppendResult =
  | { readonly kind: "appended"; readonly logged: LoggedAction }
  | { readonly kind: "duplicate"; readonly logged: LoggedAction };

type DbAction = {
  seq: string | number;
  seat: number;
  payload: unknown;
  actor: string;
  client_action_id: string | null;
  state_hash: string;
};

function decodeJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function toLogged(row: DbAction): LoggedAction {
  return {
    seq: Number(row.seq),
    seat: Number(row.seat) as Seat,
    action: decodeJson<Action>(row.payload),
    actor: row.actor as LoggedAction["actor"],
    clientActionId: row.client_action_id,
    stateHash: row.state_hash,
  };
}

/** Does this error carry the given SQLSTATE, whichever driver raised it? */
export function isSqlState(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === code) return true;
  // PGlite wraps the server error; the cause carries the code.
  if (typeof candidate.cause === "object" && candidate.cause !== null) {
    return (candidate.cause as { code?: unknown }).code === code;
  }
  return false;
}

const COLUMNS = "seq, seat, payload, actor, client_action_id, state_hash";

export class ActionsRepository {
  constructor(private readonly db: SqlExecutor) {}

  /**
   * Append one row at `seq`.
   *
   * A `23505` on the idempotency index means the same `clientActionId` is
   * already recorded; the existing row is read back and returned so the
   * caller can answer `200` with it. A `23505` on the primary key — two
   * writers racing for the same `seq` — is a different bug and is rethrown,
   * because `select … for update` is supposed to make it impossible.
   */
  async append(input: AppendInput): Promise<AppendResult> {
    try {
      const rows = await this.db.query<DbAction>(
        `insert into game_actions
           (game_id, seq, seat, type, payload, actor, client_action_id, state_hash)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         returning ${COLUMNS}`,
        [
          input.gameId,
          input.seq,
          input.action.seat,
          input.action.type,
          JSON.stringify(input.action),
          input.actor,
          input.clientActionId,
          input.stateHash,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("append returned no row");
      return { kind: "appended", logged: toLogged(row) };
    } catch (error) {
      if (!isSqlState(error, UNIQUE_VIOLATION) || input.clientActionId === null) throw error;
      const existing = await this.byClientActionId(input.gameId, input.clientActionId);
      if (!existing) throw error;
      return { kind: "duplicate", logged: existing };
    }
  }

  async byClientActionId(gameId: string, clientActionId: string): Promise<LoggedAction | null> {
    const rows = await this.db.query<DbAction>(
      `select ${COLUMNS} from game_actions
        where game_id = $1 and client_action_id = $2`,
      [gameId, clientActionId],
    );
    const row = rows[0];
    return row ? toLogged(row) : null;
  }

  /** Every action with `seq > from`, in order. The poll's delta. */
  async since(gameId: string, from: number, limit = 500): Promise<LoggedAction[]> {
    const rows = await this.db.query<DbAction>(
      `select ${COLUMNS} from game_actions
        where game_id = $1 and seq > $2
        order by seq asc limit $3`,
      [gameId, from, limit],
    );
    return rows.map(toLogged);
  }

  /** Every action with `from < seq <= to`. The fold from a snapshot. */
  async between(gameId: string, from: number, to: number): Promise<LoggedAction[]> {
    const rows = await this.db.query<DbAction>(
      `select ${COLUMNS} from game_actions
        where game_id = $1 and seq > $2 and seq <= $3
        order by seq asc`,
      [gameId, from, to],
    );
    return rows.map(toLogged);
  }

  /** `max(seq)` — the invariant check `games.seq` is supposed to mirror. */
  async maxSeq(gameId: string): Promise<number> {
    const rows = await this.db.query<{ max: string | number | null }>(
      "select coalesce(max(seq), 0) as max from game_actions where game_id = $1",
      [gameId],
    );
    return Number(rows[0]?.max ?? 0);
  }
}

export function actionsRepository(db: SqlExecutor = getDb()): ActionsRepository {
  return new ActionsRepository(db);
}
