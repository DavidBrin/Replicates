import "server-only";

import type { SqlDatabase, SqlExecutor } from "@/adapters/db/driver";

import { setLikedMembership } from "./playlists";
import {
  atomically,
  first,
  nullableNum,
  num,
  placeholders,
  text,
} from "./shared";

/**
 * Likes and dislikes, on videos and on comments, through one table.
 *
 * The rule the schema states — a person holds at most one opinion about one
 * thing — is what makes every transition below a single write. Switching from
 * like to dislike is an `update`, not a delete and an insert: the two-statement
 * version has a window in which the person holds no opinion, and anything
 * counting in that window (which is to say, the counter update that follows)
 * reads a state that never existed.
 *
 * The counts on the target are maintained here rather than counted on read.
 * That is the opposite of the choice made for subscriber counts, and for the
 * opposite reason: a like count is written far more often than a subscriber
 * count and read on every card, and nobody can audit it against a list.
 */

export type ReactionValue = 1 | -1;
/** What the viewer holds now — `null` once they have taken it back. */
export type ReactionState = ReactionValue | null;

export interface VideoReaction {
  readonly viewerReaction: ReactionState;
  readonly likeCount: number;
  readonly dislikeCount: number;
}

export interface CommentReaction {
  readonly viewerReaction: ReactionState;
  readonly likeCount: number;
}

export class ReactionTargetNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`No such ${kind}: ${id}`);
    this.name = "ReactionTargetNotFoundError";
  }
}

/**
 * The whole state machine, in one statement.
 *
 * `prior` reads the reaction as it stood before this command; `removed` handles
 * the toggle — pressing like while already liking takes it back; `upserted`
 * handles everything else, and is skipped entirely when `removed` fired, so the
 * insert never races the delete it would otherwise have to see.
 *
 * All three common table expressions share one snapshot, which is exactly what
 * makes `prior` trustworthy: it reports the value the row held before this
 * statement touched it, whatever the other two go on to do. Reading it in a
 * separate `select` first would give the same answer under PGlite, which
 * serialises everything, and a stale one under Neon the moment two tabs are
 * open on the same video.
 */
const TRANSITION = `
  with prior as (
    select value from reactions
     where user_id = $1 and target_kind = $2 and target_id = $3
  ), removed as (
    delete from reactions
     where user_id = $1 and target_kind = $2 and target_id = $3 and value = $4
    returning value
  ), upserted as (
    insert into reactions (user_id, target_kind, target_id, value)
    select $1, $2, $3, $4 where not exists (select 1 from removed)
    on conflict (user_id, target_kind, target_id)
      do update set value = excluded.value, created_at = now()
    returning value
  )
  select (select value from prior)    as prior_value,
         (select value from upserted) as new_value`;

interface Transition {
  readonly prior: ReactionState;
  readonly next: ReactionState;
  readonly likeDelta: number;
  readonly dislikeDelta: number;
}

async function applyTransition(
  tx: SqlExecutor,
  userId: string,
  kind: "video" | "comment",
  targetId: string,
  value: ReactionValue,
): Promise<Transition> {
  const rows = await tx.query(TRANSITION, [userId, kind, targetId, value]);
  const row = first(rows) ?? {};

  const prior = toState(nullableNum(row, "prior_value"));
  const next = toState(nullableNum(row, "new_value"));

  return {
    prior,
    next,
    likeDelta: countOf(next, 1) - countOf(prior, 1),
    dislikeDelta: countOf(next, -1) - countOf(prior, -1),
  };
}

function toState(value: number | null): ReactionState {
  if (value === null) return null;
  return value > 0 ? 1 : -1;
}

function countOf(state: ReactionState, value: ReactionValue): number {
  return state === value ? 1 : 0;
}

/**
 * Like or dislike a video.
 *
 * The liked playlist is written inside the same transaction, from the same
 * transition, because those two are one fact recorded twice. If the counter
 * update commits and the playlist write does not, the video's like button is
 * lit and the playlist that is supposed to list it is empty — and nothing will
 * ever notice, because both halves look internally consistent.
 *
 * `greatest(…, 0)` on the counters is not defensive decoration. A count that
 * goes negative — through a row deleted outside this path, say — renders as
 * `-1 likes` on a card, and the floor turns a wrong number into a merely stale
 * one.
 */
export async function reactToVideo(
  db: SqlDatabase,
  userId: string,
  videoId: string,
  value: ReactionValue,
  outer?: SqlExecutor,
): Promise<VideoReaction> {
  return atomically(db, outer, async (tx) => {
    const transition = await applyTransition(tx, userId, "video", videoId, value);

    const rows = await tx.query(
      `update videos
          set like_count    = greatest(like_count + $2, 0),
              dislike_count = greatest(dislike_count + $3, 0)
        where id = $1
       returning like_count, dislike_count`,
      [videoId, transition.likeDelta, transition.dislikeDelta],
    );

    const row = first(rows);
    // Nothing was updated, so the video does not exist. Throwing rolls the
    // reaction back — `reactions` has no foreign key to `videos` (it cannot,
    // being polymorphic), so this is the only thing standing between a typo in
    // a route and an orphaned row nobody can see or clear.
    if (!row) throw new ReactionTargetNotFoundError("video", videoId);

    if (transition.prior === 1 && transition.next !== 1) {
      await setLikedMembership(tx, userId, videoId, false);
    } else if (transition.prior !== 1 && transition.next === 1) {
      await setLikedMembership(tx, userId, videoId, true);
    }

    return {
      viewerReaction: transition.next,
      likeCount: num(row, "like_count"),
      dislikeCount: num(row, "dislike_count"),
    };
  });
}

/**
 * Like or dislike a comment.
 *
 * A dislike is stored but not counted, because `comments` has no
 * `dislike_count` column and YouTube shows no such number. Storing it anyway is
 * what keeps the toggle honest — without the row, disliking a comment and then
 * pressing dislike again would have nothing to take back.
 */
export async function reactToComment(
  db: SqlDatabase,
  userId: string,
  commentId: string,
  value: ReactionValue,
  outer?: SqlExecutor,
): Promise<CommentReaction> {
  return atomically(db, outer, async (tx) => {
    const transition = await applyTransition(
      tx,
      userId,
      "comment",
      commentId,
      value,
    );

    const rows = await tx.query(
      `update comments
          set like_count = greatest(like_count + $2, 0)
        where id = $1
       returning like_count`,
      [commentId, transition.likeDelta],
    );

    const row = first(rows);
    if (!row) throw new ReactionTargetNotFoundError("comment", commentId);

    return {
      viewerReaction: transition.next,
      likeCount: num(row, "like_count"),
    };
  });
}

export async function getViewerReaction(
  sql: SqlExecutor,
  userId: string | null,
  kind: "video" | "comment",
  targetId: string,
): Promise<ReactionState> {
  if (!userId) return null;
  const rows = await sql.query(
    `select value from reactions
      where user_id = $1 and target_kind = $2 and target_id = $3`,
    [userId, kind, targetId],
  );
  const row = first(rows);
  return row ? toState(nullableNum(row, "value")) : null;
}

/**
 * The viewer's reactions to a page of targets, in one query.
 *
 * The watch page's sidebar and the comment list both render a like button per
 * row, and asking per row is the same N+1 the feed projection exists to avoid.
 */
export async function getViewerReactions(
  sql: SqlExecutor,
  userId: string | null,
  kind: "video" | "comment",
  targetIds: readonly string[],
): Promise<Map<string, ReactionValue>> {
  const found = new Map<string, ReactionValue>();
  if (!userId || targetIds.length === 0) return found;

  const rows = await sql.query(
    `select target_id, value from reactions
      where user_id = $1 and target_kind = $2
        and target_id in (${placeholders(targetIds.length, 3)})`,
    [userId, kind, ...targetIds],
  );

  for (const row of rows) {
    const state = toState(nullableNum(row, "value"));
    if (state !== null) found.set(text(row, "target_id"), state);
  }
  return found;
}
