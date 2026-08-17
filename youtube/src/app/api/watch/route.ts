import { z } from "zod";

import { database } from "@/adapters/db";
import { authorizeVideoAccess } from "@/adapters/repositories/media-access";
import {
  recordWatch,
  sessionHasLoggedWatch,
} from "@/adapters/repositories/watch-events";
import { recordWatchProgress } from "@/adapters/repositories/watch-progress";
import { videoDurationSeconds } from "@/adapters/repositories/videos";
import { crossOriginRefusal, isSameOrigin } from "@/lib/http/same-origin";
import { currentViewerId } from "@/lib/auth/guard";
import { VIEWER_KEY_COOKIE, parseViewerKey } from "@/lib/viewer/session-key";
import { readCookie } from "@/lib/auth/session";
import { countsAsView } from "@/domain/viewing";
import {
  HISTORY_PAUSED_COOKIE,
  historyIsPaused,
} from "@/lib/viewer/history-pause";

/**
 * Where a viewer is in a video, and — once — that they watched it.
 *
 * This is the endpoint three finished-and-unwired subsystems were waiting for.
 * `recordWatchProgress`, `recordWatch` and `recordView` were all written,
 * tested and called by nothing, so the red resume bar never appeared, Continue
 * watching was always empty, the history page showed only what the seed put
 * there, every view count was frozen at its seeded value, and the co-visitation
 * graph could not learn anything from anyone using the application. One missing
 * route, five features that looked like five separate gaps.
 *
 * ## The three writes are not on the same schedule, and that is the design
 *
 * The reporter posts every few seconds. Only the first of these is cheap:
 *
 *  - **Progress** is an upsert of one row, throttled inside the repository by
 *    `PROGRESS_WRITE_INTERVAL_MS`, and happens on every report. Signed-out
 *    viewers get `"anonymous"` and no statement — `watch_progress` is keyed by
 *    user and there is nowhere to put an anonymous position.
 *  - **The watch event** is a transaction that appends to a log, moves session
 *    counters, upserts one pair per video already in the session and then
 *    rebuilds the affected neighbour lists. Running that per tick would be a
 *    hundred-plus graph refreshes per video and a history page full of
 *    duplicates of one viewing. It runs **once per session per video**, gated
 *    by {@link sessionHasWatched}.
 *  - **The view** rides with it — inside the same transaction, so
 *    `videos.view_count` and the graph cannot disagree about whether a viewing
 *    happened even if the process dies between them.
 *
 * ## What earns the second and third
 *
 * `countsAsView` — watched seconds, never the position reached.
 *
 * **The duration is the database's, never the request's.** That is the one
 * thing here that is a security property rather than a correctness one. The
 * body carried a `durationSeconds` and the threshold read it, which made view
 * inflation a two-line request:
 *
 * ```
 * {"videoId":"…","watchedSeconds":0.5,"durationSeconds":1}
 * ```
 *
 * `viewThresholdSeconds(1)` is 0.5, so half a second bought a view of a
 * ten-minute video — and the "cap the claim at the video's own length" guard
 * capped it at the length the attacker had just supplied, so both halves of the
 * defence were reading the attacker's number. The client's figure is now used
 * for nothing at all; the field stays in the body only because the reporter
 * sends it and rejecting it would be a 400 for an honest client.
 *
 * `watchedSeconds` is still the client's, and still forgeable — it has to be,
 * since only the browser can measure it. What bounds it is that it is capped at
 * the *real* duration, that a view is once per session per video, and that the
 * session is a cookie this application issued. Beyond that the honest
 * mitigations are rate limiting and fraud analysis, which this build does not
 * have and which are named here rather than implied.
 *
 * ## Why the video is authorised
 *
 * A private video's id is otherwise a working oracle: posting a watch for one
 * would move a counter its owner can see, and would enter it into the co-
 * visitation graph, where it could surface as a related video on a public page.
 * `authorizeVideoAccess` collapses "not yours" into the same 404 as "no such
 * video", as everywhere else.
 */

const WatchBody = z.object({
  videoId: z.string().min(1),
  /** The playhead. Clamped into the timeline by the repository. */
  positionSeconds: z.number().finite().min(0),
  /** Forward playhead movement while playing — never the position. */
  watchedSeconds: z.number().finite().min(0),
  /**
   * Ignored. Kept in the schema because the reporter sends it and a 400 for an
   * honest client would be worse than accepting a field and not reading it —
   * see the header for what happened when this *was* read.
   */
  durationSeconds: z.number().finite().min(0),
  reason: z.enum(["tick", "pause", "seek", "ended", "unload"]).optional(),
});

export async function POST(request: Request): Promise<Response> {
  // A cross-site page can still *deliver* a POST under `SameSite=Lax`, and this
  // one moves a public counter. See `lib/http/same-origin.ts`.
  if (!isSameOrigin(request)) return crossOriginRefusal();

  const viewerId = await currentViewerId(request);
  const cookies = request.headers.get("cookie");

  /**
   * "Pause watch history", honoured before anything is read or written.
   *
   * Before the authorisation check too, which is the ordering worth stating: a
   * paused viewer's request must not distinguish a private video from a
   * missing one, because that would make the pause a slightly quieter oracle
   * rather than no oracle. Nothing about this response depends on the video.
   */
  if (historyIsPaused(readCookie(cookies, HISTORY_PAUSED_COOKIE))) {
    return Response.json({ progress: "paused", viewRecorded: false });
  }

  /**
   * The session key, from the cookie the middleware issues.
   *
   * Refused rather than invented when it is absent. A key minted here would be
   * new on every request, which is the failure the watch page's old comment
   * predicted — "one session per page load" — and it would be worse than
   * recording nothing, because a graph built from single-video sessions has no
   * pairs at all and yet looks populated. In practice the middleware has
   * already put one on every request that can reach this route; the branch
   * exists for a client that strips cookies, and its honest answer is that this
   * viewing cannot be attributed.
   */
  const key = parseViewerKey(readCookie(cookies, VIEWER_KEY_COOKIE));

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = WatchBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Expected a watch report.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const report = parsed.data;

  if ((await authorizeVideoAccess(report.videoId, viewerId)) === null) {
    return Response.json({ error: "No such video." }, { status: 404 });
  }

  const db = await database();

  /**
   * The duration, from the database. See the header for what reading the
   * request's copy cost.
   *
   * A second query on a path that runs every few seconds, and worth it: it is
   * one indexed lookup of one column, and the alternative is a public counter
   * an attacker controls the threshold of.
   */
  const durationSeconds = await videoDurationSeconds(db, report.videoId);
  if (durationSeconds === null) {
    // Deleted between the authorisation check and here. Same answer as a video
    // that never existed, for the same reason.
    return Response.json({ error: "No such video." }, { status: 404 });
  }

  /**
   * The claim is capped at the video's real length.
   *
   * `watchedSeconds` accumulates forward movement, so a legitimate rewatch
   * within one page view genuinely can exceed the duration — but only the
   * threshold comparison reads it, and it is already met. Capping costs a
   * truthful report nothing and takes the ceiling off a dishonest one.
   */
  const watchedSeconds =
    durationSeconds > 0
      ? Math.min(report.watchedSeconds, durationSeconds)
      : report.watchedSeconds;

  const at = new Date();

  const progress = await recordWatchProgress(db, {
    userId: viewerId,
    videoId: report.videoId,
    positionSeconds: report.positionSeconds,
    watchedSeconds,
    durationSeconds,
    reason: report.reason,
    at,
  });

  let recorded = false;
  if (
    key !== null &&
    countsAsView({ watchedSeconds, durationSeconds }) &&
    !(await sessionHasLoggedWatch(db, key.value, report.videoId))
  ) {
    const result = await recordWatch(
      {
        sessionKey: key.value,
        videoId: report.videoId,
        userId: viewerId,
        watchedSeconds,
        watchedAt: at,
      },
      db,
    );
    // `newToSession` is false when a concurrent request won the race this gate
    // cannot close, and when the viewer cleared their history and rewatched in
    // the same session — the log row is gone, so the watch is recorded again,
    // and the membership row is still there, so the counter correctly is not
    // moved twice. `recordWatch` bumps the counter itself, in its transaction.
    recorded = result.newToSession;
  }

  return Response.json({
    /** `"anonymous"` for a signed-out viewer — a stated outcome, not an error. */
    progress: progress.outcome,
    /** True only on the report that turned this viewing into a view. */
    viewRecorded: recorded,
  });
}
