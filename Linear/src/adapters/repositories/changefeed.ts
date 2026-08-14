import "server-only";

/**
 * The changefeed — an append-only log with one monotonic sequence per
 * workspace, polled by clients on a 15-second cursor.
 *
 * ## Why the writes go through a bare function
 *
 * Every mutating repository appends here, and every one of those appends has to
 * land in the *same transaction* as the write it describes. A repository that
 * held a `ChangefeedRepository` and called `append(input)` without an executor
 * would open its own transaction and commit an event for a write that might
 * still roll back — a client would then poll, see `issue updated`, refetch, and
 * get the old row. {@link appendChangeEvent} takes the executor first and has
 * nowhere to get one from, so that mistake does not compile.
 *
 * {@link SqlChangefeedRepository} is the read side plus a public `append` for
 * the few callers outside a repository.
 *
 * ## Why `seq` and not a timestamp
 *
 * Two events written in the same millisecond are indistinguishable by
 * `created_at`, and a cursor of "everything after time T" either replays one or
 * loses one depending on which side of the comparison is inclusive. `bigserial`
 * gives a total order the client can page through exactly once. It is allocated
 * globally rather than per workspace — the sequence is shared, so one
 * workspace's numbers have gaps where another's events fell — which costs
 * nothing, because a cursor only ever needs to be monotonic within the
 * workspace it is polling.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type { WorkspaceId } from "@/domain/entities";
import type {
  AppendChangeInput,
  ChangeAction,
  ChangeEntity,
  ChangeEvent,
  ChangefeedRepository,
  Tx,
} from "@/ports/repositories";

import { BaseRepository, json, num, nullableText, text, timestamp } from "./shared";

/** How many events one poll may return. A client behind by more catches up over several. */
const DEFAULT_BATCH = 500;

/**
 * Append one event, in the caller's transaction.
 *
 * Returns the assigned sequence so a caller that just mutated something can
 * hand the client a cursor it is already up to date with, rather than making it
 * poll to discover its own write.
 */
export async function appendChangeEvent(
  tx: SqlExecutor,
  input: AppendChangeInput,
): Promise<ChangeEvent> {
  const rows = await tx.query(
    `insert into change_events (workspace_id, entity, entity_id, action, actor_id, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning seq, workspace_id, entity, entity_id, action, actor_id, payload, created_at`,
    [
      input.workspaceId,
      input.entity,
      input.entityId,
      input.action,
      input.actorId ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  const row = rows[0];
  if (row === undefined) {
    // `insert … returning` produces a row or throws; a silent zero-row result
    // would mean the statement was rewritten by a rule, which this schema has
    // none of. Failing loudly beats returning a fabricated sequence.
    throw new Error("change_events insert returned no row");
  }
  return mapChangeEvent(row);
}

export function mapChangeEvent(row: SqlRow): ChangeEvent {
  return {
    seq: num(row, "seq"),
    workspaceId: text(row, "workspace_id"),
    entity: text(row, "entity") as ChangeEntity,
    entityId: text(row, "entity_id"),
    action: text(row, "action") as ChangeAction,
    actorId: nullableText(row, "actor_id"),
    payload: json<Record<string, unknown>>(row["payload"], {}),
    createdAt: timestamp(row["created_at"]),
  };
}

export class SqlChangefeedRepository
  extends BaseRepository
  implements ChangefeedRepository
{
  async append(input: AppendChangeInput, tx?: Tx): Promise<ChangeEvent> {
    return this.atomically(tx, (executor) => appendChangeEvent(executor, input));
  }

  async since(
    workspaceId: WorkspaceId,
    seq: number,
    options: { limit?: number } = {},
    tx?: Tx,
  ): Promise<ChangeEvent[]> {
    const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_BATCH, 2_000));
    const rows = await this.reader(tx).query(
      `select seq, workspace_id, entity, entity_id, action, actor_id, payload, created_at
         from change_events
        where workspace_id = $1 and seq > $2
        order by seq asc
        limit $3`,
      [workspaceId, seq, limit],
    );
    return rows.map(mapChangeEvent);
  }

  async latestSeq(workspaceId: WorkspaceId, tx?: Tx): Promise<number> {
    const rows = await this.reader(tx).query(
      `select coalesce(max(seq), 0) as seq from change_events where workspace_id = $1`,
      [workspaceId],
    );
    const row = rows[0];
    return row === undefined ? 0 : num(row, "seq");
  }
}
