/**
 * "Pause watch history" — the preference, and why it is a cookie.
 *
 * The control existed and set a notice reading *"Pausing history is not wired
 * up yet — recording is unchanged"*, which was honest and still a dead button.
 * It became implementable the moment `POST /api/watch` existed, because a pause
 * only means anything once something is recording.
 *
 * ## A cookie rather than a column
 *
 * `users` has no preferences column and the pause has to work for a signed-out
 * viewer too — `watch_events.user_id` is nullable and a signed-out watch is
 * recorded against the viewing key, so a preference that only signed-in
 * accounts could express would leave the larger half of the recording
 * unpausable. Adding a column would also make the preference outlive the
 * browser it was set in, which is the opposite of what someone pausing history
 * on a shared machine is asking for.
 *
 * So: one cookie, read by the route that records. It is not a security
 * boundary — clearing it resumes recording, which is exactly the Resume button
 * — and it carries no information about the viewer beyond the fact that they
 * pressed pause.
 *
 * ## What it does and does not stop
 *
 * It stops `watch_events`, `watch_progress` and the view count, because those
 * are the record of what *this viewer* watched. It does not retroactively
 * remove anything — `clearHistory` is the separate control for that, and
 * conflating the two would mean a pause silently deleted a year of history.
 *
 * Not `HttpOnly`: the history page reads it during render through `cookies()`,
 * but the toggle also has to reflect the press immediately, and a preference
 * with no secret in it gains nothing from being hidden from scripts.
 */

export const HISTORY_PAUSED_COOKIE = "yt_history_paused";

/**
 * A year.
 *
 * Long, because a pause the browser forgets after a session is a pause that
 * silently stops being one — and the failure is invisible, since resuming looks
 * identical to never having paused.
 */
export const HISTORY_PAUSED_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Is history paused for this request?
 *
 * Exactly `"1"`, not "any truthy value". The cookie is written only by this
 * module, so anything else is either stale from an older format or forged, and
 * *recording* is the safe default of the two — a viewer who believes they are
 * paused and is not has been misled, but a viewer whose history silently stops
 * because a cookie got mangled has lost data with no signal at all. The visible
 * state comes from the same function, so the two can never disagree.
 */
export function historyIsPaused(cookieValue: string | null | undefined): boolean {
  return cookieValue === "1";
}

/** The `Set-Cookie` for a toggle. `paused: false` clears it. */
export function historyPausedCookie(options: {
  readonly paused: boolean;
  readonly secure: boolean;
}): string {
  const parts = [
    `${HISTORY_PAUSED_COOKIE}=${options.paused ? "1" : ""}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${options.paused ? HISTORY_PAUSED_MAX_AGE_SECONDS : 0}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
