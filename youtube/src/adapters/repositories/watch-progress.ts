import "server-only";

import type { SqlExecutor } from "@/adapters/db/driver";

import type { WatchProgress } from "./history";
import { first, num, text, timestamp } from "./shared";

/**
 * Where playback resumes, and the red bar under the thumbnail.
 *
 * `history.ts` reads `watch_progress` from four surfaces — the history page,
 * the "Continue watching" shelf, the watch page's resume position and every
 * feed card's progress bar — and until this file existed nothing wrote it. The
 * seed script had to insert the rows with raw SQL, which is the honest signal
 * that a table has a read path and no write path.
 *
 * `watch_events` is emphatically not this table, and the schema says so: one is
 * an append-only log the recommender consumes, the other is a single
 * overwritten row per viewer per video. `watch-events.ts` owns that one. A watch
 * touches both, and the two calls are deliberately separate because they answer
 * to different rules — one event per watch versus at most one write every few
 * seconds.
 *
 * ## Throttling, and why it is enforced here rather than in the player
 *
 * `timeupdate` fires between roughly 4 and 66 times a second (MDN puts the rate
 * at 4–66 Hz, load-dependent), so a naive `onTimeUpdate={save}` is up to 66
 * writes per second per viewer. The rule below is applied *in the statement*,
 * against the stored row, rather than in a component's `useRef`:
 *
 *   - it cannot be bypassed by a second tab playing the same video, by a client
 *     that reloads mid-playback and loses its in-memory timer, or by a caller
 *     that simply forgets;
 *   - it costs no extra round trip, because the read it needs is the row the
 *     write already conflicts on.
 *
 * What it does *not* do is stop the request from being made. A client-side
 * timer that only calls this every few seconds is still worth having and
 * belongs beside the player — but it is an optimisation on top of this rule,
 * not the rule, and if the two ever disagree this one is what the database
 * obeys.
 */

/**
 * At most one write every five seconds per viewer per video.
 *
 * **Assumed, not measured** — this is a judgement about two costs, and the
 * numbers on both sides are ours to choose:
 *
 *   - A crash, a closed laptop or a killed tab loses at most one interval of
 *     position. Five seconds of a video is inside what a viewer would scrub
 *     past without noticing; thirty would not be.
 *   - Five seconds caps a viewer at 12 writes a minute instead of up to 3,960.
 *
 * The interval is also what makes the *progress bar* honest without making it
 * expensive: at five seconds, a card's red bar is never more than five seconds
 * of the video stale, which on a 300px card of a ten-minute video is under
 * three pixels.
 */
export const PROGRESS_WRITE_INTERVAL_MS = 5_000;

/**
 * …and only if the position actually moved by a second.
 *
 * The interval alone would still write every five seconds while a video sits
 * paused, or buffers, or plays at 0.1× — none of which changes where the viewer
 * would resume. A second is chosen rather than something larger because at
 * normal speed the position moves five seconds per interval, so the threshold
 * never delays an ordinary write; it only removes the ones that would store a
 * number nobody could tell from the one already there.
 *
 * Both conditions must hold. `or` would reinstate exactly the paused-player
 * writes this exists to remove.
 */
export const PROGRESS_MOVEMENT_THRESHOLD_SECONDS = 1;

/**
 * The last 5% of the timeline counts as having reached the end.
 *
 * Not `position === duration`: outros, end cards and the fact that a player's
 * final `timeupdate` usually lands short of the duration mean an exact
 * comparison marks almost nothing complete.
 */
export const COMPLETION_POSITION_FRACTION = 0.95;

/**
 * …and having actually watched 60% of it.
 *
 * **This is the rule that keeps `watched_seconds` meaning what the schema says
 * it means.** `watch_events.watched_seconds` is "seconds actually watched, not
 * the position reached", and the comment above it is explicit that a seek to
 * the end is not a view. Completion derived from position alone would
 * contradict that from the other side of the same fact: drag the scrubber to
 * the end of an hour-long video and it disappears from "Continue watching" as
 * though it had been watched, and the recommender and the shelf then disagree
 * about the same event.
 *
 * 60% is a judgement, stated as one. It has to clear a scrub (which contributes
 * effectively nothing) by a wide margin while tolerating the two things people
 * legitimately skip — a sponsor read and a long intro. The cost of being wrong
 * is small and symmetric: too strict leaves a finished video on the shelf, too
 * loose drops an unfinished one off it.
 */
export const COMPLETION_MIN_WATCHED_FRACTION = 0.6;

/**
 * Why the position is being reported. Everything except `tick` flushes.
 *
 * A tick is the periodic `timeupdate`, and is the only reason the throttle
 * applies to. The other four are moments where the *next* position may never
 * arrive — the tab is closing, the viewer has stopped, the timeline has jumped —
 * so deferring the write to the next interval is how the last five seconds of a
 * session get lost.
 */
export type ProgressReason = "tick" | "pause" | "seek" | "ended" | "unload";

export interface ProgressUpdate {
  /** `null` for a signed-out viewer. See {@link recordWatchProgress}. */
  readonly userId: string | null;
  readonly videoId: string;
  /** The playhead. Clamped into the video's timeline. */
  readonly positionSeconds: number;
  /**
   * Seconds of the video actually played since the viewer opened it — the sum
   * of the playhead's forward movement while playing, not `at - openedAt` and
   * not the position. A seek contributes nothing to it, which is the entire
   * reason it is a separate number.
   */
  readonly watchedSeconds: number;
  /** Zero when the player does not know yet; completion is then impossible. */
  readonly durationSeconds: number;
  readonly reason?: ProgressReason;
  /**
   * Required, and deliberately not defaulted to `now()`.
   *
   * The same argument `watch-events.ts` makes for `watchedAt`: a write path that
   * stamps its own time cannot be tested deterministically, and here it would
   * also make the throttle untestable, since the rule is an arithmetic
   * comparison against this value. It must be *one* clock — the server's — for
   * every viewer, so that two devices with skewed clocks cannot make one
   * another's writes look stale.
   */
  readonly at: Date;
}

export type ProgressOutcome =
  | "written"
  | "throttled"
  /** No row was written and none could be; see {@link recordWatchProgress}. */
  | "anonymous";

export interface ProgressWrite {
  readonly outcome: ProgressOutcome;
  /** The row as it now stands. `null` when nothing was written. */
  readonly progress: WatchProgress | null;
}

/**
 * Has this viewer finished the video?
 *
 * Both halves are required, and the second is the one that is easy to leave
 * out. See {@link COMPLETION_MIN_WATCHED_FRACTION}.
 *
 * A video of unknown duration is never complete. The progressive fallback path
 * can produce a zero here, and a division by it would make every such video
 * either always or never finished depending on which way the comparison fell.
 */
export function isWatchCompleted(input: {
  readonly positionSeconds: number;
  readonly watchedSeconds: number;
  readonly durationSeconds: number;
}): boolean {
  if (!(input.durationSeconds > 0)) return false;
  return (
    input.positionSeconds >=
      input.durationSeconds * COMPLETION_POSITION_FRACTION &&
    input.watchedSeconds >=
      input.durationSeconds * COMPLETION_MIN_WATCHED_FRACTION
  );
}

/**
 * The upsert, and the throttle, in one statement.
 *
 * Four clauses, and each one is load-bearing:
 *
 * 1. **`excluded.updated_at >= watch_progress.updated_at`** — nothing may
 *    rewind the row. An `unload` beacon is sent as the tab closes and can
 *    arrive *after* the next page's first tick; without this, closing a video
 *    and opening it again resumes at the position the old page was at.
 * 2. **the flush flag** — a pause, seek, end or unload writes regardless. These
 *    are the moments after which there may be no next report at all.
 * 3. **the interval and the movement threshold, together** — the periodic case.
 * 4. **`excluded.completed and not watch_progress.completed`** — a tick that
 *    *becomes* complete is never throttled. Completion is a state change rather
 *    than a position, and deferring it to the next interval would leave a video
 *    the viewer finished sitting on the "Continue watching" shelf until they
 *    opened it again.
 *
 * A first write is an insert and no `where` applies to it, so the row — and
 * therefore the red bar — appears on the first report rather than five seconds
 * in.
 */
const UPSERT = `
  insert into watch_progress
    (user_id, video_id, position_seconds, completed, updated_at)
  values ($1, $2, $3, $4, $5)
  on conflict (user_id, video_id) do update
     set position_seconds = excluded.position_seconds,
         completed        = excluded.completed,
         updated_at       = excluded.updated_at
   where excluded.updated_at >= watch_progress.updated_at
     and (
       -- Cast explicitly: a parameter standing alone as a boolean expression
       -- leaves its type to be inferred from context, and the two drivers do
       -- not have to agree about how much context that is.
       $6::boolean
       or (excluded.completed and not watch_progress.completed)
       or (
         watch_progress.updated_at
           <= excluded.updated_at - interval '${PROGRESS_WRITE_INTERVAL_MS} milliseconds'
         and abs(excluded.position_seconds - watch_progress.position_seconds)
           >= ${PROGRESS_MOVEMENT_THRESHOLD_SECONDS}
       )
     )
  returning video_id, position_seconds, completed, updated_at`;

/**
 * Record where a viewer is in a video.
 *
 * **A signed-out viewer gets `"anonymous"` and no statement is issued.** The
 * table's primary key is `(user_id, video_id)` and `user_id` references
 * `users` — there is nowhere to put an anonymous position, and inventing one
 * (keyed by the session cookie, say) would be a second progress table with
 * different retention, different privacy and no read path. Throwing was the
 * alternative and is worse: the watch page is reachable while signed out, so
 * every player would need the branch instead, and one that forgot it would
 * throw on the ordinary case rather than the exceptional one. `history.ts`
 * already answers `null` and `[]` to the same question for the same reason.
 *
 * What a signed-out viewer *does* still get is the recommender: `recordWatch`
 * keys `watch_events` and the co-visitation graph on `session_key`, which is a
 * cookie rather than an identity. So the watch counts, and only the resume
 * position is lost — which is the honest consequence of not having an account.
 */
export async function recordWatchProgress(
  sql: SqlExecutor,
  update: ProgressUpdate,
): Promise<ProgressWrite> {
  if (!update.userId) return { outcome: "anonymous", progress: null };

  const durationSeconds = finite(update.durationSeconds, "durationSeconds");
  const watchedSeconds = Math.max(
    0,
    finite(update.watchedSeconds, "watchedSeconds"),
  );
  // Clamped rather than rejected: a player reporting a position a few
  // milliseconds past its own duration is routine, and a position past the end
  // would make `listContinueWatching`'s `position_seconds > 0` filter true for
  // a video that cannot be resumed.
  const positionSeconds = clamp(
    finite(update.positionSeconds, "positionSeconds"),
    durationSeconds,
  );

  const completed = isWatchCompleted({
    positionSeconds,
    watchedSeconds,
    durationSeconds,
  });

  const rows = await sql.query(UPSERT, [
    update.userId,
    update.videoId,
    positionSeconds,
    completed,
    update.at.toISOString(),
    (update.reason ?? "tick") !== "tick",
  ]);

  const row = first(rows);
  if (!row) return { outcome: "throttled", progress: null };

  return {
    outcome: "written",
    progress: {
      videoId: text(row, "video_id"),
      positionSeconds: num(row, "position_seconds"),
      completed: row.completed === true,
      updatedAt: timestamp(row.updated_at),
    },
  };
}

/**
 * Forget a video's progress — the "Remove from Continue watching" affordance.
 *
 * A delete rather than a reset to zero, because the two are different states
 * that `history.ts` distinguishes: `VideoCard.watchedSeconds` is `null` for a
 * video never started and `0` for one seeked back to the beginning, and only one
 * of those draws no bar.
 */
export async function clearWatchProgress(
  sql: SqlExecutor,
  userId: string | null,
  videoId: string,
): Promise<boolean> {
  if (!userId) return false;
  return (
    (await sql.execute(
      `delete from watch_progress where user_id = $1 and video_id = $2`,
      [userId, videoId],
    )) > 0
  );
}

/**
 * A number, or a `TypeError` naming the field.
 *
 * `NaN` is what a media element reports for `currentTime` and `duration` before
 * metadata loads, and `double precision` accepts it — Postgres stores a literal
 * NaN, every comparison against it is false, and the row silently stops
 * updating for that viewer forever. `shared.num` throws on the read side for the
 * same class of reason.
 */
function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `watch progress ${field} must be a finite number, got ${String(value)}`,
    );
  }
  return value;
}

function clamp(positionSeconds: number, durationSeconds: number): number {
  if (positionSeconds < 0) return 0;
  // A zero duration means the player does not know it yet, not that the video
  // is zero seconds long, so there is nothing to clamp against.
  if (durationSeconds > 0 && positionSeconds > durationSeconds) {
    return durationSeconds;
  }
  return positionSeconds;
}
