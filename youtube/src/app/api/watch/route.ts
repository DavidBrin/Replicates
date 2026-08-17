import { z } from "zod";

import { database } from "@/adapters/db";
import { authorizeVideoAccess } from "@/adapters/repositories/media-access";
import { recordWatch, sessionHasWatched } from "@/adapters/repositories/watch-events";
import { recordWatchProgress } from "@/adapters/repositories/watch-progress";
import { recordView } from "@/adapters/repositories/videos";
import { currentViewerId } from "@/lib/auth/guard";
import { VIEWER_KEY_COOKIE, parseViewerKey } from "@/lib/viewer/session-key";
import { readCookie } from "@/lib/auth/session";
import { countsAsView } from "@/domain/viewing";

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
 *  - **The view** rides with it, for the same once-per-session reason and by
 *    the same rule, so `videos.view_count` and the graph can never disagree
 *    about whether a viewing happened.
 *
 * ## What earns the second and third
 *
 * `countsAsView` — watched seconds, never the position reached. The client
 * reports its own accumulated figure, so it is a client-supplied number that
 * increments a public counter, and that is worth naming rather than glossing:
 * it is forgeable. It is also forgeable in the real product, and the honest
 * mitigations are rate limiting and fraud analysis rather than a smarter
 * threshold. What is enforced here is the shape — finite, non-negative, and
 * never more than the video's own duration — so that a single report cannot
 * claim a year of viewing, and the once-per-session gate means repeating the
 * request cannot inflate anything at all.
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
  /** Zero while the player has no metadata yet; completion is then impossible. */
  durationSeconds: z.number().finite().min(0),
  reason: z.enum(["tick", "pause", "seek", "ended", "unload"]).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const viewerId = await currentViewerId(request);

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
  const key = parseViewerKey(
    readCookie(request.headers.get("cookie"), VIEWER_KEY_COOKIE),
  );

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

  /**
   * The claim is capped at the video's own length.
   *
   * `watchedSeconds` accumulates forward movement, so a legitimate rewatch
   * within one page view genuinely can exceed the duration — but only the
   * threshold comparison reads it, and it is already met. Capping costs a
   * truthful report nothing and takes the ceiling off a dishonest one.
   */
  const watchedSeconds =
    report.durationSeconds > 0
      ? Math.min(report.watchedSeconds, report.durationSeconds)
      : report.watchedSeconds;

  const at = new Date();
  const db = await database();

  const progress = await recordWatchProgress(db, {
    userId: viewerId,
    videoId: report.videoId,
    positionSeconds: report.positionSeconds,
    watchedSeconds,
    durationSeconds: report.durationSeconds,
    reason: report.reason,
    at,
  });

  let recorded = false;
  if (
    key !== null &&
    countsAsView({ watchedSeconds, durationSeconds: report.durationSeconds }) &&
    !(await sessionHasWatched(db, key.value, report.videoId))
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
    // `newToSession` is false when a concurrent request won the race that
    // `sessionHasWatched` cannot close. The view rides on the same flag, so the
    // counter moves exactly as often as the graph does.
    recorded = result.newToSession;
    if (recorded) await recordView(db, report.videoId);
  }

  return Response.json({
    /** `"anonymous"` for a signed-out viewer — a stated outcome, not an error. */
    progress: progress.outcome,
    /** True only on the report that turned this viewing into a view. */
    viewRecorded: recorded,
  });
}
