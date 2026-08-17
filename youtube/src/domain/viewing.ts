/**
 * When a watch becomes a view.
 *
 * One rule, in one place, because three things key off it and they must not
 * disagree: `videos.view_count`, the `watch_events` log the history page reads,
 * and the co-visitation graph. A viewer who opened a video and closed it in two
 * seconds must not appear in any of the three; a viewer who watched it must
 * appear in all three, once.
 *
 * ## The threshold is a judgement, and is stated as one
 *
 * No capture in `research/` measures it — a view threshold is a server-side
 * policy and nothing observable from a browser reveals it. The product's is
 * widely reported as "about 30 seconds" and has never been published. So 30
 * seconds is taken as the figure, and what matters here is the second half of
 * the rule rather than the number itself.
 *
 * **A fixed 30 seconds cannot be the whole rule, because Shorts exist.** A
 * 15-second short can never be watched for 30 seconds, so a flat threshold
 * gives the entire Shorts corpus a permanent view count of zero and contributes
 * nothing to the recommender from the surface with the most watches. Hence the
 * floor: half the video, whichever is smaller. A 15-second short counts at 7.5
 * seconds; a ten-minute video still needs its 30.
 *
 * ## Watched, not reached
 *
 * The input is `watchedSeconds` — the sum of the playhead's forward movement
 * while playing — and never the position. `watch_events.watched_seconds` says
 * so in the schema (*"Seconds actually watched, not the position reached. A
 * seek to the end is not a view"*), and this is the function that makes the
 * statement true rather than aspirational. Dragging the scrubber to the end
 * moves the position to the duration and `watchedSeconds` not at all.
 *
 * `watch-progress.ts` makes the same distinction for completion, with a
 * different threshold and for a different purpose: completion asks "is this
 * finished, should it leave Continue watching", and a view asks "did this
 * happen at all". They are deliberately not the same number.
 */

/**
 * At most one write every five seconds per viewer per video.
 *
 * Lives here rather than in `adapters/repositories/watch-progress.ts`, which
 * re-exports it, for one reason: **the reporter and the repository have to
 * agree on it and they are on opposite sides of the client boundary.** The
 * repository imports `server-only`, so a client module cannot reach it, and the
 * alternative to moving the constant was a second copy in the browser — which
 * is a throttle that drifts out of step with the throttle it exists to match,
 * and drifts silently, because either number alone produces a plausible-looking
 * write rate.
 *
 * **Assumed, not measured** — a judgement about two costs, and the numbers on
 * both sides are ours to choose:
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

/** The flat threshold, in seconds. See the header: assumed, not measured. */
export const VIEW_MIN_WATCHED_SECONDS = 30;

/**
 * …and the fraction that overrides it for anything shorter.
 *
 * Half, so that the two rules meet at a 60-second video — the shortest length
 * for which the flat threshold is reachable at all.
 */
export const VIEW_MIN_WATCHED_FRACTION = 0.5;

/**
 * How long this video must be watched before the watch counts.
 *
 * A video of unknown duration (the progressive fallback can report zero until
 * metadata arrives) gets the flat threshold rather than a fraction of zero,
 * which would make every such video count on its first tick.
 */
export function viewThresholdSeconds(durationSeconds: number): number {
  if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
    return VIEW_MIN_WATCHED_SECONDS;
  }
  return Math.min(
    VIEW_MIN_WATCHED_SECONDS,
    durationSeconds * VIEW_MIN_WATCHED_FRACTION,
  );
}

/** Has this watch earned a view? */
export function countsAsView(input: {
  readonly watchedSeconds: number;
  readonly durationSeconds: number;
}): boolean {
  const watched = input.watchedSeconds;
  if (!Number.isFinite(watched) || watched <= 0) return false;
  return watched >= viewThresholdSeconds(input.durationSeconds);
}
