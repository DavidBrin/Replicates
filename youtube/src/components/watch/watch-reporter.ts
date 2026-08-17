"use client";

import { useCallback, useEffect, useRef } from "react";

import { PROGRESS_WRITE_INTERVAL_MS } from "@/domain/viewing";

/**
 * Telling the server what was actually watched.
 *
 * The client half of `POST /api/watch`. Its whole job is to turn a stream of
 * `timeupdate` positions into the one number the server cannot derive:
 * **seconds actually watched**, as opposed to the position reached.
 *
 * The schema is emphatic about the difference — *"Seconds actually watched, not
 * the position reached. A seek to the end is not a view"* — and the difference
 * can only be measured here. The server sees a position and a timestamp per
 * request; from those alone a viewer who dragged the scrubber to the end is
 * indistinguishable from one who watched to the end.
 *
 * ## Accumulating from positions alone
 *
 * {@link accumulateWatched} adds a step only when the playhead moved forward by
 * a plausible amount. That single rule covers every case without the hook
 * having to track play state at all:
 *
 *  - **Seek backward**: a negative delta, rejected — and the rewatched span
 *    then accumulates again as it plays, which is correct. Watching the same
 *    ten seconds three times is thirty seconds of watching.
 *  - **Playback rate**: 2× halves the wall-clock cost of a second of video and
 *    this counts the video's seconds, which is what the column is.
 *
 * ## The rule needs the element's state as well as its position
 *
 * The two cases the delta alone gets wrong are both about a playhead that moved
 * without anyone watching:
 *
 *  - **A seek of less than the ceiling.** A four-second nudge is
 *    indistinguishable from four seconds of playback if all you have is two
 *    positions. `Player` reports the seek *before* the position it lands on, so
 *    the baseline moves to the destination and the next step is measured from
 *    there — the jump contributes nothing whatever its size, and the ceiling is
 *    left to do the one job it is good at.
 *  - **Scrubbing while paused.** `timeupdate` does not fire, but `seeked` does,
 *    and it carries a position — so a viewer dragging through a paused video
 *    accumulated its whole length in four-second bites. Nothing accumulates
 *    unless the element says it is playing.
 *
 * Both arrive through {@link UseWatchReporterOptions} as playback *moments*,
 * which is the same channel that carries the flushes below.
 *
 * ## The ceiling is a real trade-off, stated
 *
 * {@link MAX_STEP_SECONDS} has to be above the largest legitimate gap between
 * two `timeupdate` events and below the smallest seek worth excluding, and
 * those two ranges very nearly touch. `timeupdate` fires about four times a
 * second while visible, but a **backgrounded tab throttles it** — audio keeps
 * playing while the events arrive a second or more apart — so a tight ceiling
 * would silently stop counting for anyone listening in another tab, which is a
 * large and entirely legitimate share of watching.
 *
 * Four seconds is chosen to survive that throttling. The cost is that a seek of
 * under four seconds is counted as watched. That is deliberate and cheap: the
 * view threshold is thirty seconds, so it would take eight consecutive short
 * scrubs to manufacture one view, and a viewer nudging back and forth by three
 * seconds is, in any ordinary sense, watching.
 *
 * ## Flushing
 *
 * A tick every `PROGRESS_WRITE_INTERVAL_MS` is not enough on its own: the last
 * report before a viewer navigates away is the one that carries the watch over
 * the threshold, and it is exactly the one a periodic timer misses.
 *
 * `visibilitychange` → hidden is the flush that matters, and `pagehide` backs
 * it up. **`beforeunload` is deliberately not used** — it is unreliable on
 * mobile, where a tab is frequently discarded without it ever firing, and using
 * it suppresses the back/forward cache on some browsers, so it costs a real
 * feature to catch a case `visibilitychange` already catches.
 *
 * `pause`, `seek` and `ended` flush too, and that is not decoration: the
 * `reason` field carried all five values from the start and only two were ever
 * sent. An eight-second watch of a fifteen-second short reports one five-second
 * tick and then stops — below the 7.5-second threshold — so the view existed
 * only if the viewer happened to close the tab afterwards. The moment the
 * player stops is the moment the figure is final.
 *
 * `keepalive: true` on the fetch is what lets that final request outlive the
 * document. Without it the browser cancels in-flight requests on navigation and
 * the flush is lost precisely when it was needed.
 */

/** See the header: sized for a throttled background tab, not for a seek. */
export const MAX_STEP_SECONDS = 4;

export interface WatchReport {
  readonly videoId: string;
  readonly positionSeconds: number;
  readonly watchedSeconds: number;
  readonly durationSeconds: number;
  readonly reason: "tick" | "pause" | "seek" | "ended" | "unload";
}

/**
 * How much of the step between two positions counts as watched.
 *
 * Pure, exported and tested directly, because every property above is a
 * property of this function and none of them is observable from the hook
 * without a media element and a clock.
 */
export function accumulateWatched(
  previousSeconds: number,
  nextSeconds: number,
  maxStepSeconds: number = MAX_STEP_SECONDS,
): number {
  if (!Number.isFinite(previousSeconds) || !Number.isFinite(nextSeconds)) return 0;
  const step = nextSeconds - previousSeconds;
  if (step <= 0 || step > maxStepSeconds) return 0;
  return step;
}

export interface UseWatchReporterOptions {
  readonly videoId: string;
  /** From the video row. Zero is legitimate and means "not known yet". */
  readonly durationSeconds: number;
  /** Test seam. Defaults to `POST /api/watch`. */
  readonly send?: (report: WatchReport) => void;
}

/** What {@link useWatchReporter} hands back. Both go to `<Player>`. */
export interface WatchReporter {
  /** `<Player onTimeUpdate>`. */
  readonly onTimeUpdate: (seconds: number) => void;
  /** `<Player onPlaybackMoment>`. */
  readonly onPlaybackMoment: (moment: {
    readonly reason: "play" | "pause" | "seek" | "ended";
    readonly positionSeconds: number;
    readonly playing: boolean;
  }) => void;
}

/**
 * Returns the `onTimeUpdate` handler to hand to `<Player>`.
 *
 * Everything is a ref rather than state. Nothing here renders — a re-render per
 * `timeupdate` would be four a second on a page carrying a comment thread — and
 * the flush listeners must read the *current* accumulation rather than the one
 * captured when they were attached, which is the bug a state-based version has
 * and does not show until someone watches for longer than one render.
 */
export function useWatchReporter({
  videoId,
  durationSeconds,
  send,
}: UseWatchReporterOptions): WatchReporter {
  const positionRef = useRef(0);
  const watchedRef = useRef(0);
  /**
   * When the throttle last fired. Zero means "not yet", and the first
   * `timeupdate` seeds it rather than reporting.
   *
   * Initialising this to zero and comparing against it directly made
   * `Date.now() - 0 >= PROGRESS_WRITE_INTERVAL_MS` true on the very first
   * event, so every page load posted within a quarter of a second of playback
   * starting and the throttle had no effect on the first report. Seeding it
   * from the first event rather than from mount is also the more correct of the
   * two fixes: the interval should measure from when playback began, not from
   * when React rendered.
   */
  const lastSentAtRef = useRef(0);
  /**
   * What the server was last told, so a flush that would repeat it is skipped.
   *
   * Both numbers, not just the watched total. A viewer who opens a video and
   * scrubs without playing changes the position and nothing else, and that is a
   * resume position worth storing; a viewer who opens a video and leaves
   * changes neither, and that must not cost a request. Starting both at zero —
   * rather than at a sentinel meaning "never sent" — is what makes the second
   * case silent.
   */
  const lastSentWatchedRef = useRef(0);
  const lastSentPositionRef = useRef(0);
  /**
   * Whether the element is playing.
   *
   * Starts false: nothing has told us otherwise, and counting before the first
   * `play` would mean a viewer scrubbing a video they never started still
   * accrues watched time.
   *
   * There is deliberately no companion "we just seeked" flag. One was written
   * and mutation testing showed it could not fail a test: the seek handler
   * already moves the baseline to the destination, which is what stops the jump
   * being counted, and a flag on top of that discards the first *genuine* step
   * after the seek as well. A guard that only ever removes correct data is
   * worse than no guard.
   */
  const playingRef = useRef(false);

  // The identity the listeners read. Kept in refs so that attaching them once
  // is correct even as the props change.
  const videoIdRef = useRef(videoId);
  const durationRef = useRef(durationSeconds);
  const sendRef = useRef(send);
  useEffect(() => {
    videoIdRef.current = videoId;
    durationRef.current = durationSeconds;
    sendRef.current = send;
  }, [videoId, durationSeconds, send]);

  const report = useCallback((reason: WatchReport["reason"]): void => {
    // Nothing has moved since the last report: a flush here would be a request
    // that tells the server what it already knows. `pagehide` and
    // `visibilitychange` both fire for one tab switch, so without this every
    // switch away costs two identical requests.
    if (
      watchedRef.current === lastSentWatchedRef.current &&
      positionRef.current === lastSentPositionRef.current
    ) {
      return;
    }
    lastSentWatchedRef.current = watchedRef.current;
    lastSentPositionRef.current = positionRef.current;
    lastSentAtRef.current = Date.now();

    const payload: WatchReport = {
      videoId: videoIdRef.current,
      positionSeconds: positionRef.current,
      watchedSeconds: watchedRef.current,
      durationSeconds: durationRef.current,
      reason,
    };

    const custom = sendRef.current;
    if (custom !== undefined) {
      custom(payload);
      return;
    }
    postWatch(payload);
  }, []);

  /**
   * A new video is a new accumulation — and the old one is flushed first.
   *
   * The watch page is a client navigation from every card in the application,
   * so the common way to finish a video here is not to unload the document but
   * to become a different `videoId` in the same tree. Without the flush, that
   * is the case where nothing at all is recorded.
   */
  useEffect(() => {
    return () => {
      report("unload");
      positionRef.current = 0;
      watchedRef.current = 0;
      lastSentWatchedRef.current = 0;
      lastSentPositionRef.current = 0;
      lastSentAtRef.current = 0;
    };
  }, [videoId, report]);

  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") report("unload");
    };
    const onPageHide = (): void => report("unload");

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [report]);

  const onTimeUpdate = useCallback(
    (seconds: number): void => {
      // Nothing accumulates unless the element says it is playing. The jump
      // itself is excluded by the seek handler moving the baseline, not here.
      if (playingRef.current) {
        watchedRef.current += accumulateWatched(positionRef.current, seconds);
      }
      positionRef.current = seconds;

      const now = Date.now();
      // The first event starts the clock rather than reporting against a zero
      // it would always beat. See `lastSentAtRef`.
      if (lastSentAtRef.current === 0) {
        lastSentAtRef.current = now;
        return;
      }
      if (now - lastSentAtRef.current >= PROGRESS_WRITE_INTERVAL_MS) {
        report("tick");
      }
    },
    [report],
  );

  const onPlaybackMoment = useCallback(
    (moment: {
      readonly reason: "play" | "pause" | "seek" | "ended";
      readonly positionSeconds: number;
      readonly playing: boolean;
    }): void => {
      playingRef.current = moment.playing;

      if (moment.reason === "seek") {
        /**
         * **The baseline moves to the destination, and that is the whole
         * mechanism.** The next `timeupdate` is then measured from where the
         * playhead landed rather than from where it left, so the jump — of any
         * size, above or below the ceiling — contributes nothing, and the
         * playback that follows it is measured normally.
         *
         * It also covers the paused scrub, which produces `seeked` and no
         * `timeupdate` at all: each drag moves the baseline, and `playingRef`
         * keeps any of it from counting.
         */
        positionRef.current = moment.positionSeconds;
        report("seek");
        return;
      }

      // `play` is a state change and nothing else — flushing on it would post a
      // report identical to the one the pause before it already sent.
      //
      if (moment.reason === "play") {
        positionRef.current = moment.positionSeconds;
        return;
      }

      positionRef.current = moment.positionSeconds;
      report(moment.reason);
    },
    [report],
  );

  return { onTimeUpdate, onPlaybackMoment };
}

/**
 * The default transport.
 *
 * `fetch` with `keepalive` rather than `navigator.sendBeacon`, for one reason:
 * `sendBeacon` cannot set `Content-Type: application/json` without turning the
 * request into a CORS preflight candidate, and this route parses JSON. The two
 * are otherwise equivalent for this purpose — `keepalive` is the same
 * out-of-document delivery guarantee, and it is the mechanism `sendBeacon` is
 * specified in terms of.
 *
 * Failures are swallowed. A dropped watch report is invisible to the viewer and
 * self-correcting on the next tick; surfacing it would be an error toast for
 * telemetry, which is worse than the missing row.
 */
function postWatch(report: WatchReport): void {
  void fetch("/api/watch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {
    /* See above. */
  });
}
