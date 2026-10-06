/**
 * The adaptive poll schedule (SPEC §5.5's cadence table, D11).
 *
 * | Situation                     | Interval                              |
 * |-------------------------------|---------------------------------------|
 * | It is your turn               | 2,000 ms                              |
 * | Someone else's turn, visible  | 4,000 ms                              |
 * | Lobby or browse, visible      | 5,000 ms                              |
 * | Tab hidden                    | 15,000 ms, **stopping** after 5 min   |
 * | Game finished, or eliminated  | stop                                  |
 *
 * Plus **±15 % jitter**, an immediate re-poll on `visibilitychange → visible`,
 * and an immediate re-poll right after your own POST returns.
 *
 * **Stopping when hidden is not an optimisation.** Neon's free tier charges
 * for awake wall-clock time regardless of query volume, and one abandoned tab
 * polling forever at 2 s costs 182.5 CU-hours against a 100 CU-hour monthly
 * allowance — 1.8× the whole budget, exhausted around day 17
 * (`research/06-online-play-free-tier.md` §2.1, §4.1).
 *
 * The loop is a separate module from `pollingSync.ts` because the lobby
 * screens need exactly the same schedule around a different request, and two
 * copies of a jitter-and-visibility state machine is two places for an
 * abandoned tab to keep polling from.
 */

export const MY_TURN_MS = 2_000;
export const OTHER_TURN_MS = 4_000;
export const LOBBY_MS = 5_000;
export const HIDDEN_MS = 15_000;
/** How long a hidden tab keeps polling before it stops entirely. */
export const HIDDEN_STOP_MS = 5 * 60_000;
/** ±15 %, so four clients in one game do not form a thundering herd. */
export const JITTER = 0.15;

/** Cancel a scheduled callback. The shape `setTimeout` is wrapped into. */
export type Cancel = () => void;

export interface VisibilitySource {
  /** Is the document visible right now? */
  isVisible(): boolean;
  /** Subscribe to changes; returns an unsubscriber. */
  subscribe(listener: () => void): Cancel;
}

export interface PollingLoopOptions {
  /** One poll. Rejections are swallowed by the loop, which keeps polling. */
  poll(): Promise<void>;
  /** The base interval for the next tick, before jitter. */
  intervalMs(): number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => Cancel;
  /** Injected so a test can assert the jitter bounds at both extremes. */
  random?: () => number;
  visibility?: VisibilitySource;
  /** Called when the loop stops itself after too long hidden. */
  onStop?: () => void;
}

export interface PollingLoop {
  /** Start polling. Idempotent. */
  start(): void;
  /** Poll now and reschedule from now. Resolves when the poll has settled. */
  pollNow(): Promise<void>;
  /** Stop permanently and release the visibility subscription (an unmount). */
  stop(): void;
  /**
   * Stop scheduling but stay subscribed to `visibilitychange`.
   *
   * This is the stop a **finished game or an eliminated seat** wants (§5.5's
   * cadence table): both are re-armable — an eliminated viewer may ask to
   * watch — and a loop that had torn down its visibility subscription would
   * come back without the hidden-tab cadence or the five-minute hidden stop,
   * which is the one thing that must never be lost (D11, the 182.5 CU-hour
   * argument above). `stop()` stays the permanent teardown for an unmount.
   */
  pause(): void;
  /** Re-arm a stopped or paused loop — what `visibilitychange → visible` does. */
  resume(): void;
  readonly stopped: boolean;
  /** The last delay actually scheduled, in ms. For tests and the debug hook. */
  readonly lastDelayMs: number;
}

/** The browser's own visibility, or "always visible" outside one. */
export function documentVisibility(): VisibilitySource {
  return {
    isVisible: () =>
      typeof document === "undefined" ? true : document.visibilityState !== "hidden",
    subscribe: (listener) => {
      if (typeof document === "undefined") return () => undefined;
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

/** Apply ±{@link JITTER} to `ms`, never returning less than a quarter of it. */
export function jitter(ms: number, random: () => number): number {
  const factor = 1 + (random() * 2 - 1) * JITTER;
  return Math.max(1, Math.round(ms * factor));
}

export function createPollingLoop(options: PollingLoopOptions): PollingLoop {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const visibility = options.visibility ?? documentVisibility();
  const schedule =
    options.schedule ??
    ((fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    });

  let cancel: Cancel | null = null;
  let running = false;
  let stopped = false;
  let hiddenSince: number | null = visibility.isVisible() ? null : now();
  let inflight: Promise<void> | null = null;
  let lastDelayMs = 0;

  function clear(): void {
    cancel?.();
    cancel = null;
  }

  function effectiveInterval(): number {
    return visibility.isVisible() ? options.intervalMs() : HIDDEN_MS;
  }

  function rearm(): void {
    clear();
    if (stopped || !running) return;

    // The hidden-tab stop is checked when the next tick would be armed rather
    // than inside the tick, so a tab hidden for five minutes stops at the
    // boundary instead of making one more request after it.
    if (hiddenSince !== null && now() - hiddenSince >= HIDDEN_STOP_MS) {
      stopped = true;
      options.onStop?.();
      return;
    }

    lastDelayMs = jitter(effectiveInterval(), random);
    cancel = schedule(() => {
      void run();
    }, lastDelayMs);
  }

  async function run(): Promise<void> {
    // Coalesce: a `pollNow()` arriving while a scheduled poll is in flight
    // waits for that one rather than issuing a second request. Two polls in
    // flight at once would both fold the same actions.
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        await options.poll();
      } catch {
        // A failed poll is not a reason to stop: the next one may succeed,
        // and a dropped response is handled by `seq` on the way back in.
      } finally {
        inflight = null;
        rearm();
      }
    })();
    return inflight;
  }

  const unsubscribe = visibility.subscribe(() => {
    if (visibility.isVisible()) {
      hiddenSince = null;
      // An immediate re-poll on regaining visibility: the board may be
      // several turns out of date and waiting 4 s to find out is the one
      // place the cadence is visibly wrong.
      if (stopped) {
        stopped = false;
        if (running) void run();
      } else {
        void run();
      }
      return;
    }
    hiddenSince ??= now();
    rearm();
  });

  return {
    start(): void {
      if (running) return;
      running = true;
      void run();
    },
    pollNow(): Promise<void> {
      if (stopped) {
        stopped = false;
        running = true;
      }
      return run();
    },
    stop(): void {
      stopped = true;
      running = false;
      clear();
      unsubscribe();
    },
    pause(): void {
      stopped = true;
      running = false;
      clear();
    },
    resume(): void {
      stopped = false;
      hiddenSince = visibility.isVisible() ? null : now();
      if (!running) {
        running = true;
        void run();
      } else {
        rearm();
      }
    },
    get stopped(): boolean {
      return stopped;
    },
    get lastDelayMs(): number {
      return lastDelayMs;
    },
  };
}
