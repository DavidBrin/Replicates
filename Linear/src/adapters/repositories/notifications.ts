import "server-only";

/**
 * The Inbox.
 *
 * ## Self-actions notify nobody
 *
 * {@link SqlNotificationRepository.create} returns `null` rather than inserting
 * when the actor is the recipient. It is a guard every call site would
 * otherwise repeat, and the one time it is forgotten produces an inbox that
 * tells you what you just did — which is the failure mode that makes people
 * stop reading their inbox entirely. Returning `null` instead of throwing keeps
 * the caller's code straight: notifying a set of subscribers that happens to
 * include the actor is the normal case, not an error.
 *
 * ## Snooze is a timestamp, not a state
 *
 * `snoozed_until_at` in the future hides a notification; the same column in the
 * past is simply history. There is no unsnooze job and nothing to run on a
 * schedule — the notification reappears because the comparison in the `where`
 * clause changed its mind, which is the only design that survives a host with
 * no background workers.
 */

import type { SqlRow } from "@/adapters/db/driver";
import type {
  Notification,
  NotificationType,
  Timestamp,
  UserId,
} from "@/domain/entities";
import { newId } from "@/lib/ids";
import {
  type CreateNotificationInput,
  NotFoundError,
  type NotificationRepository,
  type Tx,
} from "@/ports/repositories";

import {
  BaseRepository,
  nullableText,
  nullableTimestamp,
  num,
  Params,
  text,
  timestamp,
} from "./shared";

const NOTIFICATION_COLUMNS = `id, user_id, type, issue_id, comment_id, project_id,
  actor_id, read_at, snoozed_until_at, created_at`;

export function mapNotificationRow(row: SqlRow): Notification {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    type: text(row, "type") as NotificationType,
    issueId: nullableText(row, "issue_id"),
    commentId: nullableText(row, "comment_id"),
    projectId: nullableText(row, "project_id"),
    actorId: text(row, "actor_id"),
    readAt: nullableTimestamp(row["read_at"]),
    snoozedUntilAt: nullableTimestamp(row["snoozed_until_at"]),
    createdAt: timestamp(row["created_at"]),
  };
}

export class SqlNotificationRepository
  extends BaseRepository
  implements NotificationRepository
{
  async create(
    input: CreateNotificationInput,
    tx?: Tx,
  ): Promise<Notification | null> {
    if (input.userId === input.actorId) return null;

    const id = input.id ?? newId("ntf");
    const createdAt = input.createdAt ?? this.now();
    await this.reader(tx).execute(
      `insert into notifications (id, user_id, type, issue_id, comment_id,
                                  project_id, actor_id, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.userId,
        input.type,
        input.issueId ?? null,
        input.commentId ?? null,
        input.projectId ?? null,
        input.actorId,
        createdAt,
      ],
    );
    return {
      id,
      userId: input.userId,
      type: input.type,
      issueId: input.issueId ?? null,
      commentId: input.commentId ?? null,
      projectId: input.projectId ?? null,
      actorId: input.actorId,
      readAt: null,
      snoozedUntilAt: null,
      createdAt: timestamp(createdAt),
    };
  }

  async listForUser(
    userId: UserId,
    options: {
      unreadOnly?: boolean;
      hideSnoozed?: boolean;
      limit?: number;
      offset?: number;
    } = {},
    tx?: Tx,
  ): Promise<Notification[]> {
    const params = new Params();
    const user = params.bind(userId);
    const clauses = [`user_id = ${user}`];
    if (options.unreadOnly === true) clauses.push("read_at is null");
    if (options.hideSnoozed !== false) {
      clauses.push(
        `(snoozed_until_at is null or snoozed_until_at <= ${params.bind(this.now())})`,
      );
    }
    const limit = params.bind(Math.max(1, Math.min(options.limit ?? 100, 500)));
    const offset = params.bind(Math.max(0, options.offset ?? 0));

    const rows = await this.reader(tx).query(
      `select ${NOTIFICATION_COLUMNS} from notifications
        where ${clauses.join(" and ")}
        order by created_at desc, id desc
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return rows.map(mapNotificationRow);
  }

  async unreadCount(userId: UserId, tx?: Tx): Promise<number> {
    const rows = await this.reader(tx).query(
      `select count(*) as unread from notifications
        where user_id = $1 and read_at is null
          and (snoozed_until_at is null or snoozed_until_at <= $2)`,
      [userId, this.now()],
    );
    const row = rows[0];
    return row === undefined ? 0 : num(row, "unread");
  }

  async markRead(
    ids: readonly Notification["id"][],
    userId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.#setRead(ids, userId, this.now(), tx);
  }

  async markUnread(
    ids: readonly Notification["id"][],
    userId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.#setRead(ids, userId, null, tx);
  }

  async markAllRead(userId: UserId, tx?: Tx): Promise<number> {
    return this.reader(tx).execute(
      `update notifications set read_at = $2
        where user_id = $1 and read_at is null`,
      [userId, this.now()],
    );
  }

  async snooze(
    id: Notification["id"],
    until: Timestamp | null,
    userId: UserId,
    tx?: Tx,
  ): Promise<Notification> {
    const executor = this.reader(tx);
    const rows = await executor.query(
      `update notifications set snoozed_until_at = $3
        where id = $1 and user_id = $2
      returning ${NOTIFICATION_COLUMNS}`,
      [id, userId, until],
    );
    const row = rows[0];
    // Scoped by `user_id` as well as `id`, so a stolen notification id from
    // another account updates nothing and reports as missing rather than
    // silently succeeding.
    if (row === undefined) throw new NotFoundError("Notification", id);
    return mapNotificationRow(row);
  }

  async delete(
    id: Notification["id"],
    userId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.reader(tx).execute(
      `delete from notifications where id = $1 and user_id = $2`,
      [id, userId],
    );
  }

  async #setRead(
    ids: readonly Notification["id"][],
    userId: UserId,
    readAt: Timestamp | null,
    tx?: Tx,
  ): Promise<void> {
    if (ids.length === 0) return;
    const params = new Params();
    const user = params.bind(userId);
    const at = params.bind(readAt);
    const list = params.bindAll([...ids]);
    await this.reader(tx).execute(
      `update notifications set read_at = ${at}
        where user_id = ${user} and id in (${list})`,
      params.values,
    );
  }
}
