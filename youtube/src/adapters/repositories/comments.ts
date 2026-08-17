import "server-only";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "@/adapters/db/driver";
import type { Comment } from "@/domain/types";

import {
  atomically,
  bool,
  first,
  newId,
  nullableNum,
  nullableText,
  nullableTimestamp,
  num,
  text,
  timestamp,
} from "./shared";
// The same validation the video fixture setter uses, from the file that
// explains why a `bigint` column deserves it. One definition rather than two
// that could disagree about whether a count may be fractional.
import { wholeCount } from "./videos";

/**
 * Comments: one level deep, which is YouTube's real model rather than a
 * simplification of it.
 *
 * The schema permits `parent_id` on any comment — it has to, since a reply is a
 * comment — and this file is where the second level is refused. A reply to a
 * reply is re-parented onto the top-level comment and the person being answered
 * is mentioned in the body instead, which is exactly what YouTube does and what
 * the schema's own comment describes.
 *
 * Re-parenting rather than rejecting matters. The UI can only render two
 * levels, so a rejected reply-to-a-reply would be a button that does nothing
 * for the one interaction people use comments for most.
 */

export class VideoNotFoundError extends Error {
  constructor(readonly videoId: string) {
    super(`No such video: ${videoId}`);
    this.name = "VideoNotFoundError";
  }
}

export class CommentsDisabledError extends Error {
  constructor(readonly videoId: string) {
    super(`Comments are turned off on video ${videoId}.`);
    this.name = "CommentsDisabledError";
  }
}

export class CommentNotFoundError extends Error {
  constructor(readonly commentId: string) {
    super(`No such comment: ${commentId}`);
    this.name = "CommentNotFoundError";
  }
}

export interface NewComment {
  readonly videoId: string;
  readonly authorId: string;
  readonly body: string;
  /** The comment being answered — top-level or a reply; both are accepted. */
  readonly parentId?: string | null;
}

/**
 * Post a comment or a reply.
 *
 * Every count this touches is written in the same transaction as the comment
 * itself. A reply that commits while its parent's `reply_count` does not is a
 * thread whose "3 replies" link opens four, and there is no later pass that
 * would find it — both rows look right on their own.
 */
export async function addComment(
  db: SqlDatabase,
  input: NewComment,
  outer?: SqlExecutor,
): Promise<Comment> {
  const id = newId("cm");

  return atomically(db, outer, async (tx) => {
    const videoRows = await tx.query(
      `select comments_enabled from videos where id = $1`,
      [input.videoId],
    );
    const video = first(videoRows);
    if (!video) throw new VideoNotFoundError(input.videoId);
    if (!bool(video, "comments_enabled")) {
      throw new CommentsDisabledError(input.videoId);
    }

    const target = input.parentId
      ? await resolveParent(tx, input.parentId, input.videoId)
      : null;

    const body = target ? mention(input.body, target) : input.body;
    const parentId = target?.topLevelId ?? null;

    const rows = await tx.query(
      `with inserted as (
         insert into comments (id, video_id, author_id, parent_id, body)
         values ($2, $3, $4, $5, $6)
         returning *
       )
       ${commentSelect("inserted")}`,
      // `$1` is the viewer, per the projection's convention. The author is the
      // viewer here, and their reaction to a comment they have just written is
      // necessarily absent — but naming them keeps the convention unbroken
      // rather than leaving a null nobody can explain.
      [input.authorId, id, input.videoId, input.authorId, parentId, body],
    );

    const created = first(rows);
    if (!created) throw new Error(`Comment ${id} vanished between write and read.`);

    if (parentId) {
      await tx.execute(
        `update comments set reply_count = reply_count + 1 where id = $1`,
        [parentId],
      );
    } else {
      await tx.execute(
        `update videos set comment_count = comment_count + 1 where id = $1`,
        [input.videoId],
      );
    }

    return toComment(created);
  });
}

interface ReplyTarget {
  /** Where the reply is actually filed — always a top-level comment. */
  readonly topLevelId: string;
  /** Who is being answered, when that is not the top-level author. */
  readonly addressee: string | null;
}

/**
 * Work out where a reply belongs.
 *
 * `parent.parent_id ?? parent.id` is the whole rule: answering a top-level
 * comment files under it, and answering a reply files under that reply's
 * parent — the grandparent — never under the reply. The alternative, storing
 * the true parent and flattening at read time, keeps a tree in the table that
 * the `comments_parent_idx` partial index does not describe and that no query
 * in this file could page through.
 */
async function resolveParent(
  tx: SqlExecutor,
  parentId: string,
  videoId: string,
): Promise<ReplyTarget> {
  const rows = await tx.query(
    `select c.id, c.parent_id, c.video_id, c.author_id,
            coalesce(ch.handle, u.display_name) as addressee
       from comments c
       join users u on u.id = c.author_id
       left join lateral (
         select handle from channels
          where owner_id = c.author_id
          order by created_at, id limit 1
       ) ch on true
      where c.id = $1`,
    [parentId],
  );

  const parent = first(rows);
  if (!parent) throw new CommentNotFoundError(parentId);
  if (text(parent, "video_id") !== videoId) {
    throw new CommentNotFoundError(parentId);
  }

  const grandparentId = nullableText(parent, "parent_id");
  return {
    topLevelId: grandparentId ?? text(parent, "id"),
    // Only a reply-to-a-reply needs the mention. Answering a top-level comment
    // sits directly under it, so naming its author would be noise.
    addressee: grandparentId ? text(parent, "addressee") : null,
  };
}

/**
 * Prefix `@name ` when the reply is answering another reply.
 *
 * The mention is stored in the body rather than in a column because that is
 * what it is: text the author can edit or delete. A structural "in reply to"
 * field would be a second level of the tree wearing a different hat.
 */
function mention(body: string, target: ReplyTarget): string {
  if (!target.addressee) return body;
  const handle = `@${target.addressee}`;
  return body.startsWith(handle) ? body : `${handle} ${body}`;
}

export async function editComment(
  sql: SqlExecutor,
  id: string,
  body: string,
  viewerId: string | null = null,
): Promise<Comment | null> {
  const rows = await sql.query(
    `with updated as (
       update comments set body = $3, edited_at = now()
        where id = $2
       returning *
     )
     ${commentSelect("updated")}`,
    [viewerId, id, body],
  );
  const row = first(rows);
  return row ? toComment(row) : null;
}

/**
 * Delete a comment, and its replies with it — the foreign key cascades.
 *
 * The counter that has to move depends on which kind it was, so the row is read
 * before it is deleted. Deleting a top-level comment removes its replies too,
 * but `comment_count` only moves by one, because it counts threads.
 */
export async function deleteComment(
  db: SqlDatabase,
  id: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const rows = await tx.query(
      `select video_id, parent_id from comments where id = $1`,
      [id],
    );
    const comment = first(rows);
    if (!comment) return false;

    await tx.execute(`delete from comments where id = $1`, [id]);

    const parentId = nullableText(comment, "parent_id");
    if (parentId) {
      await tx.execute(
        `update comments set reply_count = greatest(reply_count - 1, 0)
          where id = $1`,
        [parentId],
      );
    } else {
      await tx.execute(
        `update videos set comment_count = greatest(comment_count - 1, 0)
          where id = $1`,
        [text(comment, "video_id")],
      );
    }
    return true;
  });
}

/**
 * Pin a comment, unpinning whatever was pinned before.
 *
 * One statement, because "at most one pinned comment per video" is a rule about
 * two rows and a two-statement version has a moment with none pinned and, if it
 * fails between them, a moment with two. The `where` clause touches only the
 * rows that change.
 */
export async function pinComment(
  sql: SqlExecutor,
  id: string,
): Promise<boolean> {
  const changed = await sql.execute(
    `update comments
        set is_pinned = (id = $1)
      where video_id = (select video_id from comments where id = $1)
        and parent_id is null
        and (is_pinned or id = $1)`,
    [id],
  );
  return changed > 0;
}

export async function unpinComment(
  sql: SqlExecutor,
  id: string,
): Promise<boolean> {
  return (
    (await sql.execute(
      `update comments set is_pinned = false where id = $1 and is_pinned`,
      [id],
    )) > 0
  );
}

/** The channel owner's heart. */
export async function setHearted(
  sql: SqlExecutor,
  id: string,
  hearted: boolean,
): Promise<boolean> {
  return (
    (await sql.execute(`update comments set hearted = $2 where id = $1`, [
      id,
      hearted,
    ])) > 0
  );
}

/* ------------------------------------------------------------- fixtures -- */

/**
 * When a comment was written, and how many people liked it.
 *
 * The same category of thing as `stampVideoFixtureFacts` in `videos.ts`, for
 * the same reason: `addComment` stamps `now()` and takes no timestamp, so a
 * seeded thread of forty comments is written inside one millisecond and renders
 * as a conversation that happened instantaneously — every reply "0 seconds ago",
 * and the `newest` sort ordering by the id tiebreak because every `created_at`
 * is equal.
 */
export interface CommentFixtureFacts {
  readonly createdAt?: Date;
  readonly likeCount?: number;
}

/**
 * Write them directly. **For fixtures and corpora, never for a request.**
 *
 * Not a general-purpose comment patch, and the omissions are the point:
 * `body` belongs to {@link editComment}, which also stamps `edited_at` — a
 * comment whose text changed without that stamp is one the UI cannot mark as
 * edited. `reply_count` is maintained by {@link addComment} and
 * {@link deleteComment} in the same transaction as the rows it counts, and
 * setting it here would create the "3 replies" link that opens four.
 *
 * `like_count` *is* here, and is the one to be careful with for the reason
 * `videos.ts` gives at greater length: it is the denormalised total of the
 * `reactions` rows, and a fixture that sets a total without the rows is
 * describing an audience that is not in the corpus. That is a legitimate thing
 * for a corpus to say and a nonsensical thing for a request to say.
 */
export async function stampCommentFixtureFacts(
  sql: SqlExecutor,
  id: string,
  facts: CommentFixtureFacts,
): Promise<boolean> {
  const params: SqlValue[] = [id];
  const assignments: string[] = [];

  if (facts.createdAt !== undefined) {
    params.push(facts.createdAt.toISOString());
    assignments.push(`created_at = $${params.length}::timestamptz`);
  }
  if (facts.likeCount !== undefined) {
    params.push(wholeCount(facts.likeCount, "likeCount"));
    assignments.push(`like_count = $${params.length}`);
  }
  if (assignments.length === 0) return false;

  return (
    (await sql.execute(
      `update comments set ${assignments.join(", ")} where id = $1`,
      params,
    )) > 0
  );
}

/* ----------------------------------------------------------------- reads -- */

export type CommentSort = "top" | "newest";

export interface CommentListOptions {
  readonly sort?: CommentSort;
  readonly viewerId?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * A video's top-level comments.
 *
 * Pinned first in both orders — a pinned comment that sorted to page four would
 * not be pinned to anything. After that, `top` is by likes and `newest` is by
 * time, which are the two orders the UI offers.
 *
 * `top` is an approximation and worth naming as one: YouTube ranks by an
 * engagement score that includes replies and recency, not by likes alone. Likes
 * are the part of that score this schema actually holds, and the ordering is
 * the exact prefix of `comments_video_idx`, so the sort is an index scan rather
 * than a sort of the whole thread.
 */
export async function listComments(
  sql: SqlExecutor,
  videoId: string,
  options: CommentListOptions = {},
): Promise<Comment[]> {
  const { sort = "top", viewerId = null, limit = 20, offset = 0 } = options;

  const order =
    sort === "newest"
      ? "cm.is_pinned desc, cm.created_at desc, cm.id desc"
      : "cm.is_pinned desc, cm.like_count desc, cm.created_at desc, cm.id desc";

  const rows = await sql.query(
    `${commentSelect("comments")}
      where cm.video_id = $2 and cm.parent_id is null
      order by ${order}
      limit $3 offset $4`,
    [viewerId, videoId, limit, offset],
  );
  return rows.map(toComment);
}

/**
 * A thread's replies, oldest first — a reply chain reads as a conversation and
 * a conversation runs forwards.
 */
export async function listReplies(
  sql: SqlExecutor,
  parentId: string,
  options: Omit<CommentListOptions, "sort"> = {},
): Promise<Comment[]> {
  const { viewerId = null, limit = 50, offset = 0 } = options;

  const rows = await sql.query(
    `${commentSelect("comments")}
      where cm.parent_id = $2
      order by cm.created_at, cm.id
      limit $3 offset $4`,
    [viewerId, parentId, limit, offset],
  );
  return rows.map(toComment);
}

export async function getComment(
  sql: SqlExecutor,
  id: string,
  viewerId: string | null = null,
): Promise<Comment | null> {
  const rows = await sql.query(
    `${commentSelect("comments")} where cm.id = $2`,
    [viewerId, id],
  );
  const row = first(rows);
  return row ? toComment(row) : null;
}

export async function countComments(
  sql: SqlExecutor,
  videoId: string,
): Promise<number> {
  const rows = await sql.query(
    `select count(*) as n from comments
      where video_id = $1 and parent_id is null`,
    [videoId],
  );
  const row = first(rows);
  return row ? num(row, "n") : 0;
}

/* ------------------------------------------------------------ projection -- */

/**
 * Author identity and the viewer's own reaction, joined rather than fetched.
 *
 * `$1` is always the viewer, so the fragment can be shared and callers number
 * from `$2` — the same convention the card projection uses, and the same reason:
 * a twenty-comment thread that asked per row for the author and again per row
 * for the reaction is forty-one statements for one panel.
 *
 * The author's name and avatar come from their channel when they have one and
 * from the user row when they do not, because a comment on YouTube is written
 * by a channel. The `lateral` picks the oldest channel: the schema permits a
 * user to own several, and an unordered pick would change the name on a comment
 * between two page loads.
 */
function commentSelect(source: string): string {
  return `
  select cm.id, cm.video_id, cm.parent_id, cm.author_id,
         coalesce(ch.name, u.display_name) as author_name,
         ch.avatar_key as author_avatar_key,
         cm.body, cm.like_count, cm.reply_count, cm.is_pinned, cm.hearted,
         r.value as viewer_reaction,
         cm.created_at, cm.edited_at
    from ${source} cm
    join users u on u.id = cm.author_id
    left join lateral (
      select name, avatar_key from channels
       where owner_id = cm.author_id
       order by created_at, id limit 1
    ) ch on true
    left join reactions r
      on r.target_kind = 'comment' and r.target_id = cm.id and r.user_id = $1`;
}

function toComment(row: SqlRow): Comment {
  const reaction = nullableNum(row, "viewer_reaction");
  return {
    id: text(row, "id"),
    videoId: text(row, "video_id"),
    parentId: nullableText(row, "parent_id"),
    authorId: text(row, "author_id"),
    authorName: text(row, "author_name"),
    authorAvatarKey: nullableText(row, "author_avatar_key"),
    body: text(row, "body"),
    likeCount: num(row, "like_count"),
    replyCount: num(row, "reply_count"),
    isPinned: bool(row, "is_pinned"),
    hearted: bool(row, "hearted"),
    viewerReaction: reaction === null ? null : reaction > 0 ? 1 : -1,
    createdAt: timestamp(row.created_at),
    editedAt: nullableTimestamp(row.edited_at),
  };
}
