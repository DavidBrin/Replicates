import "server-only";

import type { SqlDatabase, SqlExecutor } from "@/adapters/db/driver";
import type { VideoCard } from "@/domain/types";
import { dayKeyInZone, formatDayHeading } from "@/domain/format";

import { first, nullableNum, num, placeholders, text, timestamp } from "./shared";
import { toCard } from "./videos";

/**
 * What the viewer has watched, and where they left off. Read side only — the
 * write path belongs to `watch-events.ts`.
 *
 * Two tables, and the schema is emphatic that they are not the same thing.
 * `watch_events` is an append-only log and is the history page's source;
 * `watch_progress` is one overwritten row per viewer per video and is where
 * playback resumes. Reading history from `watch_progress` would be the obvious
 * shortcut and would quietly collapse a week of daily rewatches into one entry
 * dated today.
 */

/** One day's worth of history, as the page groups it. */
export interface HistoryDay {
  /** `2026-08-16` in the viewer's zone — stable, sortable, and a React key. */
  readonly dayKey: string;
  /** `Today`, `Yesterday`, or `16 August 2026`. */
  readonly heading: string;
  readonly items: VideoCard[];
}

export interface HistoryOptions {
  /**
   * How many *events* to read, not how many cards come back: a video watched
   * three times in a day is three events and one card. Over-reading slightly is
   * the cost of grouping in the viewer's own zone rather than in UTC.
   */
  readonly limit?: number;
  /** IANA zone. See {@link listHistory} for why this is not simply UTC. */
  readonly timeZone?: string;
  /** For "now" in the `Today`/`Yesterday` headings; a parameter so tests can fix it. */
  readonly now?: Date;
}

/**
 * The history page.
 *
 * Grouped in TypeScript rather than by `date_trunc`, and the reason is the
 * viewer's clock. A watch at 23:30 in New York is 03:30 the next day in UTC, so
 * a SQL `date_trunc('day', watched_at)` files half of everyone's evening under
 * tomorrow. Doing it in SQL *correctly* would mean `at time zone $2` with an
 * IANA name, which depends on the engine having the full tz database — true of
 * Neon, not something PGlite's base bundle promises. Grouping here needs
 * neither, and `Intl` is in both runtimes already.
 *
 * A video watched more than once in one day appears once in that day, at its
 * most recent time, which is what YouTube does. It reappears under each
 * subsequent day it was watched.
 *
 * A signed-out viewer has no history. Returning empty rather than throwing is
 * the honest answer: the page is reachable while signed out and shows a
 * sign-in prompt beside an empty list, not an error.
 */
export async function listHistory(
  sql: SqlExecutor,
  viewerId: string | null,
  options: HistoryOptions = {},
): Promise<HistoryDay[]> {
  const { limit = 200, timeZone = "UTC", now = new Date() } = options;
  if (!viewerId) return [];

  const rows = await sql.query(
    `select v.id, v.title, v.channel_id,
            c.name       as channel_name,
            c.handle     as channel_handle,
            c.avatar_key as channel_avatar_key,
            c.verified   as channel_verified,
            v.thumbnail_key, v.preview_key, v.duration_seconds,
            v.view_count, v.published_at, v.is_short,
            wp.position_seconds as watched_seconds,
            we.watched_at
       from watch_events we
       join videos v on v.id = we.video_id
       join channels c on c.id = v.channel_id
       left join watch_progress wp
         on wp.video_id = v.id and wp.user_id = $1
      where we.user_id = $1
      order by we.watched_at desc, we.id desc
      limit $2`,
    [viewerId, limit],
  );

  const days: HistoryDay[] = [];
  const byKey = new Map<string, { day: HistoryDay; seen: Set<string> }>();

  for (const row of rows) {
    const watchedAt = timestamp(row.watched_at);
    const dayKey = dayKeyInZone(watchedAt, timeZone);

    let group = byKey.get(dayKey);
    if (!group) {
      const day: HistoryDay = {
        dayKey,
        heading: formatDayHeading(watchedAt, now, timeZone),
        items: [],
      };
      group = { day, seen: new Set() };
      byKey.set(dayKey, group);
      // The rows arrive newest first, so pushing preserves that order and no
      // sort is needed after the loop.
      days.push(day);
    }

    const videoId = text(row, "id");
    if (group.seen.has(videoId)) continue;
    group.seen.add(videoId);
    group.day.items.push(toCard(row));
  }

  return days;
}

/**
 * The "Continue watching" shelf: started, not finished, most recent first.
 *
 * From `watch_progress` rather than from the event log, because the question is
 * about current state — a video finished yesterday should not reappear because
 * it was also started last week. The order matches
 * `watch_progress_recent_idx (user_id, updated_at desc, video_id desc)` exactly,
 * tiebreaker included: PGlite's `now()` stops at the millisecond, so
 * `updated_at desc` alone is a total order on Neon and an arbitrary one here.
 */
export async function listContinueWatching(
  sql: SqlExecutor,
  viewerId: string | null,
  options: { readonly limit?: number } = {},
): Promise<VideoCard[]> {
  if (!viewerId) return [];

  const rows = await sql.query(
    `select v.id, v.title, v.channel_id,
            c.name       as channel_name,
            c.handle     as channel_handle,
            c.avatar_key as channel_avatar_key,
            c.verified   as channel_verified,
            v.thumbnail_key, v.preview_key, v.duration_seconds,
            v.view_count, v.published_at, v.is_short,
            wp.position_seconds as watched_seconds
       from watch_progress wp
       join videos v on v.id = wp.video_id
       join channels c on c.id = v.channel_id
      where wp.user_id = $1
        and not wp.completed
        and wp.position_seconds > 0
      order by wp.updated_at desc, wp.video_id desc
      limit $2`,
    [viewerId, options.limit ?? 20],
  );
  return rows.map(toCard);
}

export interface WatchProgress {
  readonly videoId: string;
  readonly positionSeconds: number;
  readonly completed: boolean;
  readonly updatedAt: Date;
}

/** Where the player resumes. `null` for a video this viewer has never opened. */
export async function getWatchProgress(
  sql: SqlExecutor,
  viewerId: string | null,
  videoId: string,
): Promise<WatchProgress | null> {
  if (!viewerId) return null;

  const rows = await sql.query(
    `select video_id, position_seconds, completed, updated_at
       from watch_progress
      where user_id = $1 and video_id = $2`,
    [viewerId, videoId],
  );

  const row = first(rows);
  return row
    ? {
        videoId: text(row, "video_id"),
        positionSeconds: num(row, "position_seconds"),
        completed: row.completed === true,
        updatedAt: timestamp(row.updated_at),
      }
    : null;
}

/**
 * Resume positions for a page of videos, in one query.
 *
 * The feed projections join `watch_progress` themselves and do not need this.
 * It exists for the surfaces that get their cards from somewhere else — a
 * search result, a recommender's ranked list — and would otherwise ask per row.
 *
 * A video the viewer has never started is absent from the map rather than
 * present with `0`, which is the same distinction `VideoCard.watchedSeconds`
 * draws and for the same reason.
 */
export async function getWatchPositions(
  sql: SqlExecutor,
  viewerId: string | null,
  videoIds: readonly string[],
): Promise<Map<string, number>> {
  const positions = new Map<string, number>();
  if (!viewerId || videoIds.length === 0) return positions;

  const rows = await sql.query(
    `select video_id, position_seconds from watch_progress
      where user_id = $1 and video_id in (${placeholders(videoIds.length, 2)})`,
    [viewerId, ...videoIds],
  );

  for (const row of rows) {
    const seconds = nullableNum(row, "position_seconds");
    if (seconds !== null) positions.set(text(row, "video_id"), seconds);
  }
  return positions;
}

/** What {@link clearHistory} removed. */
export interface HistoryCleared {
  readonly events: number;
  readonly progress: number;
}

/**
 * Delete this viewer's watch history — the "Clear all watch history" control.
 *
 * A write, in the read-side file, and that is deliberate rather than sloppy:
 * this is the *inverse* of the two reads above and has to stay beside them. If
 * it lived in `watch-events.ts` it would sit next to `recordWatch`, whose whole
 * subject is the co-visitation graph — and the first question anyone would ask
 * of it there is "does this rebuild the graph?", which is exactly the question
 * this function answers no to.
 *
 * ## The co-visitation graph is deliberately not touched
 *
 * `session_videos`, `video_session_counts`, `covisitation` and `related_videos`
 * are all left alone. That is a decision worth stating, because "delete my
 * history" plausibly means "and unlearn what you learned from it".
 *
 * It does not, for two reasons. The graph is keyed on `session_key`, which is a
 * cookie and not an identity — so there is nothing in it that identifies this
 * viewer to delete. And the counters are aggregates that many sessions have
 * contributed to: decrementing one viewer's contribution would mean either
 * storing who contributed what (which is a *more* detailed record of viewing
 * than the one being deleted) or corrupting counts that other people's
 * recommendations depend on. What the viewer gets back is the honest promise:
 * the record of what they watched is gone, and the aggregate statistics it
 * contributed to are not personally identifying and remain.
 *
 * ## One transaction
 *
 * The log and the positions go together. Clearing one and failing on the other
 * leaves a viewer whose history page is empty and whose Continue watching shelf
 * is not — which reads as the deletion having half-worked, and is the version
 * of this bug that gets reported as "it came back".
 */
export async function clearHistory(
  db: SqlDatabase,
  viewerId: string,
): Promise<HistoryCleared> {
  return db.transaction(async (tx) => {
    const events = await tx.execute(`delete from watch_events where user_id = $1`, [
      viewerId,
    ]);
    const progress = await tx.execute(`delete from watch_progress where user_id = $1`, [
      viewerId,
    ]);
    return { events, progress };
  });
}
