import { z } from "zod";
import type { UserId } from "@/domain/entities";
import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk, throwApp } from "@/lib/http";
import { toPublicUser } from "@/app/api/_shared/social";

const MIN_QUERY_LENGTH = 2;
const RESULT_CAP = 10;

// ---------------------------------------------------------------------------
// Rate limiter — in-memory token bucket, 20 requests / 10s per caller
// (David's ambiguity resolution; research §2.4 treats this endpoint like an
// auth endpoint). Deliberately kept local to this one file rather than
// promoted to a shared `src/lib` module: nothing else in this task needs a
// rate limiter (YAGNI), and process-local memory is an accepted limitation
// for a single-instance demo app (see the eventual README "Known gaps").
// ---------------------------------------------------------------------------

const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_WINDOW_MS = 10_000;
const REFILL_PER_MS = RATE_LIMIT_CAPACITY / RATE_LIMIT_WINDOW_MS;

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<UserId, Bucket>();

/**
 * Continuous-refill token bucket: `tokens` regenerate at a constant rate
 * (`RATE_LIMIT_CAPACITY` per `RATE_LIMIT_WINDOW_MS`) rather than resetting
 * in a hard window, so a burst that straddles a window boundary can't
 * double the effective limit the way a fixed-window counter would. Returns
 * `true` and consumes one token iff the request is allowed.
 */
function takeSearchToken(userId: UserId, now: number): boolean {
  const existing = buckets.get(userId);
  const tokens = existing
    ? Math.min(RATE_LIMIT_CAPACITY, existing.tokens + (now - existing.lastRefill) * REFILL_PER_MS)
    : RATE_LIMIT_CAPACITY;
  if (tokens < 1) {
    buckets.set(userId, { tokens, lastRefill: now });
    return false;
  }
  buckets.set(userId, { tokens: tokens - 1, lastRefill: now });
  return true;
}

/** Test-only escape hatch, mirroring `container.ts`'s
 * `resetContainerForTests` — clears every bucket so one test file's burst
 * of requests can never bleed into another test's rate-limit assertions.
 * Never called from application code. */
export function resetSearchRateLimiterForTests(): void {
  buckets.clear();
}

const querySchema = z.object({ q: z.string() });

/**
 * `GET /api/users/search?q=` (SPEC §8; David's ambiguity resolutions).
 * Case-insensitive PREFIX match on `handle` OR `displayName`, capped at 10
 * results, excludes the caller, and returns only
 * `{id, handle, displayName, avatarColor, avatarInitials, isFriend,
 * hasPendingRequest}` — never an email, balance, or friend list.
 *
 * Rate limit is checked BEFORE the query-length check so a burst of
 * sub-minimum-length queries still trips it (this endpoint is a
 * user-enumeration oracle by construction — research §2.4 — so every hit
 * counts against the budget, not just the ones that reach the DB).
 */
export const GET = handler(async (req) => {
  const user = await requireUser(req);

  if (!takeSearchToken(user.id, Date.now())) {
    return throwApp({
      code: "rate_limited",
      message: "Too many searches — try again in a few seconds.",
    });
  }

  const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  const rawQuery = parsedQuery.success ? parsedQuery.data.q : "";
  const needle = rawQuery.trim().toLowerCase();

  if (needle.length < MIN_QUERY_LENGTH) {
    // Below the minimum length is an EMPTY result, not a validation error —
    // an error code here would itself be an enumeration signal (David's
    // ambiguity resolution).
    return jsonOk({ results: [] });
  }

  const { store } = await getContainer();
  const matches = (await store.users.list())
    .filter((candidate) => candidate.id !== user.id)
    .filter(
      (candidate) =>
        candidate.handle.toLowerCase().startsWith(needle) ||
        candidate.displayName.toLowerCase().startsWith(needle),
    )
    .sort((a, b) => a.handle.localeCompare(b.handle))
    .slice(0, RESULT_CAP);

  const results = await Promise.all(
    matches.map(async (match) => {
      const [isFriend, sentByMe, sentToMe] = await Promise.all([
        store.friends.areFriends(user.id, match.id),
        store.friends.findPendingRequest(user.id, match.id),
        store.friends.findPendingRequest(match.id, user.id),
      ]);
      return {
        ...toPublicUser(match),
        isFriend,
        hasPendingRequest: Boolean(sentByMe || sentToMe),
      };
    }),
  );

  return jsonOk({ results });
});
