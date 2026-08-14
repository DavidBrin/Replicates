import "server-only";

/**
 * The activity feed.
 *
 * One table, one discriminated JSON payload. The reasoning is in `schema.sql`
 * and `research/03-data-model.md` §5: Linear's own `IssueHistory` grew to ~70
 * paired `from*`/`to*` columns *and* a `changes: JSONObject` escape hatch, and
 * their newer `ProjectHistory` is fully generic. This starts where they ended
 * up.
 *
 * ## The rule that makes an old entry still readable
 *
 * Every payload carries **both the id and the display label** of each side:
 *
 * ```json
 * {"fromId":"sta_…","fromLabel":"Todo","toId":"sta_…","toLabel":"In Progress"}
 * ```
 *
 * The id is what a link needs; the label is what makes the sentence survive.
 * Rename "In Progress" to "Doing" and a feed that resolved names by joining
 * would silently rewrite history — every entry from the last year would claim
 * the issue moved to "Doing". Delete the state and the join returns nothing at
 * all, and the entry renders as "David changed status from Todo to". A
 * denormalised label is a snapshot of what was true when it happened, which is
 * the only thing an audit log is for.
 *
 * The cost is that the payload cannot carry a foreign key, so a referenced id
 * can dangle. For an append-only log that is the right trade — the entry still
 * reads correctly, which is exactly what would be lost by enforcing integrity.
 *
 * ## What is deliberately not implemented
 *
 * `research/03-data-model.md` §5.3 proposes suppressing every change made in
 * the first three minutes after creation, as Linear does. This does not: SPEC
 * §requirement is that *every* issue mutation writes an activity row, and a
 * grace window makes the log a function of wall-clock time, which is
 * untestable without a fake clock in every test that touches an issue. What is
 * implemented is the other suppression rule, and the more important one: an
 * update whose `from` equals its `to` writes nothing, so a form that submits
 * every field on every save does not produce a feed of "changed title from X to
 * X" — that filtering happens in `issues.ts`, at the point where both sides are
 * known.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type {
  Activity,
  ActivityPayload,
  ActivityType,
  IssueId,
} from "@/domain/entities";
import { newId } from "@/lib/ids";
import type {
  ActivityRepository,
  ActivityWithActor,
  RecordActivityInput,
  Tx,
} from "@/ports/repositories";

import { BaseRepository, json, mapUserJson, text, timestamp, userJson } from "./shared";

/**
 * Write one activity row in the caller's transaction.
 *
 * Same shape as `appendChangeEvent`, and for the same reason: an activity row
 * that commits when the mutation it describes does not is a feed entry for
 * something that never happened.
 */
export async function insertActivity(
  tx: SqlExecutor,
  input: RecordActivityInput,
  now: string,
): Promise<Activity> {
  const id = input.id ?? newId("act");
  const createdAt = input.createdAt ?? now;
  await tx.execute(
    `insert into activities (id, issue_id, user_id, type, payload, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      id,
      input.issueId,
      input.userId,
      input.type,
      JSON.stringify(input.payload),
      createdAt,
    ],
  );
  return {
    id,
    issueId: input.issueId,
    userId: input.userId,
    type: input.type,
    payload: input.payload,
    createdAt: timestamp(createdAt),
  };
}

/**
 * The pair a field change is recorded as.
 *
 * Both sides are optional because half of them are genuinely one-sided:
 * assigning an unassigned issue has no `from`, and clearing a project has no
 * `to`. Recording those as empty strings would make the feed say "changed
 * assignee from  to David".
 */
export function change(
  from: { id: string | null; label: string | null } | null,
  to: { id: string | null; label: string | null } | null,
): ActivityPayload {
  return {
    fromId: from?.id ?? null,
    fromLabel: from?.label ?? null,
    toId: to?.id ?? null,
    toLabel: to?.label ?? null,
  };
}

export function mapActivityRow(row: SqlRow): ActivityWithActor {
  return {
    id: text(row, "id"),
    issueId: text(row, "issue_id"),
    userId: text(row, "user_id"),
    type: text(row, "type") as ActivityType,
    payload: json<ActivityPayload>(row["payload"], {}),
    createdAt: timestamp(row["created_at"]),
    user: mapUserJson(row["actor"]),
  };
}

export class SqlActivityRepository
  extends BaseRepository
  implements ActivityRepository
{
  async record(input: RecordActivityInput, tx?: Tx): Promise<Activity> {
    return this.atomically(tx, (executor) =>
      insertActivity(executor, input, this.now()),
    );
  }

  async listForIssue(
    issueId: IssueId,
    options: { limit?: number } = {},
    tx?: Tx,
  ): Promise<ActivityWithActor[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1_000));
    const rows = await this.reader(tx).query(
      `select a.id, a.issue_id, a.user_id, a.type, a.payload, a.created_at,
              ${userJson("u")} as actor
         from activities a
         join users u on u.id = a.user_id
        where a.issue_id = $1
        order by a.created_at asc, a.id asc
        limit $2`,
      [issueId, limit],
    );
    return rows.map(mapActivityRow);
  }
}
