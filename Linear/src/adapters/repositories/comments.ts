import "server-only";

/**
 * Comments and reactions.
 *
 * ## Threads are one level deep, deliberately
 *
 * Replying to a reply attaches to the *thread root*, not to the reply — which
 * is what Linear does, and what keeps rendering a thread a single pass over a
 * flat list rather than a recursive component with an indentation budget. The
 * flattening happens on write ({@link SqlCommentRepository.create} resolves a
 * reply's parent to its own parent), so a client that posts a reply to a reply
 * gets back a comment already in the right place instead of a tree that renders
 * differently after a refresh.
 *
 * ## No activity rows
 *
 * `ACTIVITY_TYPES` has no comment event: in Linear the discussion and the
 * property-change feed are interleaved on read, not stored as one stream. So a
 * comment writes a change event — clients still converge — and nothing in
 * `activities`.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type { CommentId, IssueId, Reaction, UserId } from "@/domain/entities";
import { newId } from "@/lib/ids";
import {
  type CommentRepository,
  type CommentWithAuthor,
  ConflictError,
  type CreateCommentInput,
  NotFoundError,
  type Tx,
} from "@/ports/repositories";

import { appendChangeEvent } from "./changefeed";
import {
  BaseRepository,
  json,
  mapReactionRow,
  mapUserJson,
  nullableText,
  nullableTimestamp,
  text,
  timestamp,
  userJson,
} from "./shared";

const COMMENT_SELECT = `
  c.id, c.issue_id, c.user_id, c.body, c.parent_id,
  c.created_at, c.updated_at, c.edited_at,
  ${userJson("u")} as author,
  coalesce((
    select json_agg(json_build_object(
      'id', rn.id, 'commentId', rn.comment_id, 'issueId', rn.issue_id,
      'userId', rn.user_id, 'emoji', rn.emoji, 'createdAt', rn.created_at
    ) order by rn.created_at)
      from reactions rn where rn.comment_id = c.id
  ), '[]'::json) as reactions
`;

interface ReactionJson {
  id: string;
  commentId: string | null;
  issueId: string | null;
  userId: string;
  emoji: string;
  createdAt: string;
}

function mapCommentRow(row: SqlRow): CommentWithAuthor {
  const author = mapUserJson(row["author"]);
  if (author === null) {
    // `comments.user_id` is `not null` with a cascade, so a comment without an
    // author cannot exist. If it somehow does, the row is corrupt and saying so
    // beats rendering a comment attributed to nobody.
    throw new TypeError(`Comment ${text(row, "id")} has no author`);
  }
  return {
    id: text(row, "id"),
    issueId: text(row, "issue_id"),
    userId: text(row, "user_id"),
    body: text(row, "body"),
    parentId: nullableText(row, "parent_id"),
    createdAt: timestamp(row["created_at"]),
    updatedAt: timestamp(row["updated_at"]),
    editedAt: nullableTimestamp(row["edited_at"]),
    user: author,
    reactions: json<ReactionJson[]>(row["reactions"], []).map((raw) => ({
      id: raw.id,
      commentId: raw.commentId,
      issueId: raw.issueId,
      userId: raw.userId,
      emoji: raw.emoji,
      createdAt: timestamp(raw.createdAt),
    })),
  };
}

export class SqlCommentRepository
  extends BaseRepository
  implements CommentRepository
{
  async create(input: CreateCommentInput, tx?: Tx): Promise<CommentWithAuthor> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("cmt");
      const now = this.now();
      const parentId = await this.#threadRoot(t, input.parentId ?? null);

      await t.execute(
        `insert into comments (id, issue_id, user_id, body, parent_id,
                               created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$6)`,
        [id, input.issueId, input.userId, input.body, parentId, now],
      );
      // Commenting subscribes you. Anyone who has said something on an issue
      // wants to hear the reply, and this is where Linear puts that rule too.
      await t.execute(
        `insert into issue_subscribers (issue_id, user_id, subscribed_at)
         values ($1,$2,$3) on conflict do nothing`,
        [input.issueId, input.userId, now],
      );

      await appendChangeEvent(t, {
        workspaceId: await this.#workspaceOf(t, input.issueId),
        entity: "comment",
        entityId: id,
        action: "create",
        actorId: input.userId,
        payload: { issueId: input.issueId, parentId },
      });
      return this.#require(t, id);
    });
  }

  async byId(id: CommentId, tx?: Tx): Promise<CommentWithAuthor | null> {
    const rows = await this.reader(tx).query(
      `select ${COMMENT_SELECT}
         from comments c join users u on u.id = c.user_id
        where c.id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapCommentRow(row);
  }

  async listForIssue(issueId: IssueId, tx?: Tx): Promise<CommentWithAuthor[]> {
    const rows = await this.reader(tx).query(
      `select ${COMMENT_SELECT}
         from comments c join users u on u.id = c.user_id
        where c.issue_id = $1
        order by c.created_at asc, c.id asc`,
      [issueId],
    );
    return rows.map(mapCommentRow);
  }

  async update(
    id: CommentId,
    body: string,
    actorId: UserId,
    tx?: Tx,
  ): Promise<CommentWithAuthor> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      if (before.body === body) return before;
      const now = this.now();
      await t.execute(
        `update comments set body = $2, updated_at = $3, edited_at = $3
          where id = $1`,
        [id, body, now],
      );
      await appendChangeEvent(t, {
        workspaceId: await this.#workspaceOf(t, before.issueId),
        entity: "comment",
        entityId: id,
        action: "update",
        actorId,
        payload: { issueId: before.issueId },
      });
      return this.#require(t, id);
    });
  }

  async delete(id: CommentId, actorId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.byId(id, t);
      if (before === null) return;
      // Replies cascade with their root: `comments.parent_id` is `on delete
      // cascade`, which is right here — a thread whose opening comment is gone
      // is a conversation with no subject.
      await t.execute(`delete from comments where id = $1`, [id]);
      await appendChangeEvent(t, {
        workspaceId: await this.#workspaceOf(t, before.issueId),
        entity: "comment",
        entityId: id,
        action: "delete",
        actorId,
        payload: { issueId: before.issueId },
      });
    });
  }

  /* --------------------------------------------------------- reactions -- */

  async addReaction(
    target: { commentId?: CommentId; issueId?: IssueId },
    userId: UserId,
    emoji: string,
    tx?: Tx,
  ): Promise<Reaction> {
    const commentId = target.commentId ?? null;
    const issueId = target.issueId ?? null;
    if ((commentId === null) === (issueId === null)) {
      // The schema's `check ((comment_id is null) <> (issue_id is null))` says
      // the same thing; catching it here names the argument instead of the
      // constraint.
      throw new ConflictError("A reaction targets exactly one of a comment or an issue");
    }

    return this.atomically(tx, async (t) => {
      const id = newId("rct");
      const now = this.now();
      const rows = await t.query(
        `insert into reactions (id, comment_id, issue_id, user_id, emoji, created_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict do nothing
         returning id, comment_id, issue_id, user_id, emoji, created_at`,
        [id, commentId, issueId, userId, emoji, now],
      );
      const row = rows[0];
      if (row === undefined) {
        // Already reacted with this emoji. Idempotent rather than an error —
        // a double-tap on a phone should not produce a red toast.
        const existing = await t.query(
          `select id, comment_id, issue_id, user_id, emoji, created_at
             from reactions
            where user_id = $1 and emoji = $2
              and comment_id is not distinct from $3
              and issue_id is not distinct from $4`,
          [userId, emoji, commentId, issueId],
        );
        const found = existing[0];
        if (found === undefined) throw new ConflictError("Reaction could not be stored");
        return mapReactionRow(found);
      }

      const resolvedIssueId =
        commentId === null ? issueId : await this.#issueOfComment(t, commentId);
      await appendChangeEvent(t, {
        workspaceId: await this.#workspaceOf(t, resolvedIssueId),
        entity: "reaction",
        entityId: id,
        action: "create",
        actorId: userId,
        payload: { commentId, issueId: resolvedIssueId, emoji },
      });
      return mapReactionRow(row);
    });
  }

  async removeReaction(id: Reaction["id"], userId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const rows = await t.query(
        `select id, comment_id, issue_id, user_id, emoji, created_at
           from reactions where id = $1 and user_id = $2`,
        [id, userId],
      );
      const row = rows[0];
      if (row === undefined) return;
      const reaction = mapReactionRow(row);
      await t.execute(`delete from reactions where id = $1`, [id]);

      const { commentId: reactedComment } = reaction;
      const resolvedIssueId =
        reactedComment === null
          ? reaction.issueId
          : await this.#issueOfComment(t, reactedComment);
      await appendChangeEvent(t, {
        workspaceId: await this.#workspaceOf(t, resolvedIssueId),
        entity: "reaction",
        entityId: id,
        action: "delete",
        actorId: userId,
        payload: { commentId: reaction.commentId, issueId: resolvedIssueId },
      });
    });
  }

  /* ----------------------------------------------------------- helpers -- */

  async #require(t: SqlExecutor, id: CommentId): Promise<CommentWithAuthor> {
    const comment = await this.byId(id, t);
    if (comment === null) throw new NotFoundError("Comment", id);
    return comment;
  }

  /** Flatten a reply-to-a-reply onto the thread it belongs to. */
  async #threadRoot(
    t: SqlExecutor,
    parentId: CommentId | null,
  ): Promise<CommentId | null> {
    if (parentId === null) return null;
    const rows = await t.query(`select id, parent_id from comments where id = $1`, [
      parentId,
    ]);
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("Comment", parentId);
    return nullableText(row, "parent_id") ?? text(row, "id");
  }

  async #issueOfComment(t: SqlExecutor, commentId: CommentId): Promise<IssueId> {
    const rows = await t.query(`select issue_id from comments where id = $1`, [
      commentId,
    ]);
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("Comment", commentId);
    return text(row, "issue_id");
  }

  async #workspaceOf(t: SqlExecutor, issueId: IssueId | null): Promise<string> {
    if (issueId === null) {
      throw new ConflictError("A reaction must resolve to an issue");
    }
    const rows = await t.query(
      `select t.workspace_id from issues i join teams t on t.id = i.team_id
        where i.id = $1`,
      [issueId],
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("Issue", issueId);
    return text(row, "workspace_id");
  }
}
