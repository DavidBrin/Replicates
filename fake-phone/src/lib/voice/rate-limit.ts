/**
 * A demo-grade, in-memory token bucket for the voice routes.
 *
 * `research/ai-voice-architecture.md` §6 lists an IP-keyed limiter on the
 * token-mint and stream-start routes as a day-one guardrail, and this is it —
 * with the honest caveat stated plainly rather than buried:
 *
 *   **This counter lives in one serverless instance's memory.** It resets on
 *   cold start and is not shared across concurrent instances, so a caller
 *   spread across N instances gets N times the quota. It stops one browser tab
 *   hammering one instance; it is not a defence against a determined attacker.
 *   The real fix is a shared store (Vercel KV / Redis), which is a swap of this
 *   module's implementation and nothing else.
 *
 * The window is a fixed one rather than a sliding one on purpose: a fixed window
 * needs one integer per key, so an abandoned key costs almost nothing until the
 * sweep reclaims it.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the caller's window resets. Fed to `Retry-After`. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  /** Injected in tests so the window can be advanced without real time. */
  readonly now?: () => number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  /** Drops all state. Exists for tests; harmless in production. */
  reset(): void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Bounds memory if a route is hit with many distinct keys before a sweep. */
const MAX_TRACKED_KEYS = 5000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string): RateLimitDecision {
      const at = now();
      const existing = buckets.get(key);

      if (!existing || existing.resetAt <= at) {
        if (buckets.size >= MAX_TRACKED_KEYS) sweep(buckets, at);
        buckets.set(key, { count: 1, resetAt: at + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (existing.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - at) / 1000)),
        };
      }

      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },

    reset(): void {
      buckets.clear();
    },
  };
}

function sweep(buckets: Map<string, Bucket>, at: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= at) buckets.delete(key);
  }
  // Still full of live windows: drop the oldest insertions rather than grow
  // without bound. Losing a live counter fails open, which is the right way for
  // a demo-grade limiter to fail.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const excess = buckets.size - Math.floor(MAX_TRACKED_KEYS / 2);
    let dropped = 0;
    for (const key of buckets.keys()) {
      if (dropped++ >= excess) break;
      buckets.delete(key);
    }
  }
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is client-settable in general; on Vercel the leftmost entry
 * is the real client and the header cannot be spoofed past the edge. Anywhere
 * else this degrades to a shared `"unknown"` bucket — which limits everyone
 * together rather than nobody, the safer of the two failure modes for a route
 * that spends money.
 */
export function clientKeyFor(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Sessions are the expensive door: five call starts per minute per client. */
export const sessionRateLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

/**
 * Turns are cheap individually but run in a loop for the length of a call, so
 * the ceiling is generous enough for a natural conversation and still finite.
 */
export const turnRateLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
