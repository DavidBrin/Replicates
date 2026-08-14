import "server-only";

/**
 * Throttling for the two endpoints that spend real money on a stranger's input.
 *
 * `/api/auth/signin` and `/api/auth/signup` both run scrypt at
 * `N = 2^17, r = 8, p = 1` — 128 MB and ~200 ms per request, deliberately, and
 * *before* anything about the caller has been established. Without a gate in
 * front of them that is two separate problems wearing one costume:
 *
 *  - **Resource exhaustion.** The work is memory-hard by design, which is the
 *    property that protects the hashes and the property that makes the endpoint
 *    a lever. A few hundred concurrent POSTs is gigabytes of allocation from an
 *    attacker who needs no account, no session and no valid address.
 *  - **Online guessing.** Everything the password hash is for assumes the
 *    attacker is offline with a stolen database. An endpoint that will answer
 *    "is this the password?" as fast as it can be asked hands them the oracle
 *    without the theft, and 200 ms per guess is not a defence when the guesses
 *    are free and parallel.
 *
 * ## Two keys, because one of them is always the wrong one
 *
 * Every attempt spends a token from **both** an IP bucket and a bucket for the
 * normalised email. Keyed on IP alone, spraying one password across a thousand
 * addresses from a botnet is unthrottled. Keyed on email alone, an attacker who
 * varies the address walks straight past it. The email bucket is the smaller of
 * the two, because a single account being hammered is the shape of a targeted
 * attack, while a shared office NAT legitimately produces many sign-ins.
 *
 * ## Spend first, refund on success
 *
 * The token is taken **before** the derivation, not after the failure. A
 * counter that increments on failure is useless against the exhaustion case:
 * five hundred requests arrive together, none has failed yet, and all five
 * hundred allocate. Spending up front bounds what is in flight; refunding a
 * successful authentication means an honest user — who is, by definition,
 * succeeding — never notices the limiter exists, and the e2e suite's seventeen
 * consecutive sign-ins from one address stay green.
 *
 * Sign-*up* does not refund. A successful sign-up is not evidence of an honest
 * caller the way a correct password is; it is an account, and an endpoint that
 * mints them for free at 200 ms each is the exhaustion vector with extra steps.
 *
 * ## What a limited response may not reveal
 *
 * The limiter is consulted **before the user lookup**, and the refusal it
 * produces is the route's ordinary generic one. That ordering is the whole
 * point: a limiter that only engaged for real accounts, or that said something
 * different when the address existed, would answer the question the constant
 * -cost path in `password.ts` exists to refuse — *is this person a member here?*
 * — and would answer it more cheaply than the timing attack it replaced.
 *
 * ## In-memory, and honest about it
 *
 * One process, one map. On a single instance — which is what a PGlite
 * deployment and every local run are — that is exactly right. Across several
 * serverless instances each gets its own budget, so the effective limit is the
 * configured one times the instance count; the floor still holds per instance,
 * and the alternative is a Redis this project deliberately does not have
 * (`SPEC.md` §2's zero-config promise). Stated rather than hidden, because a
 * limiter whose scope is misunderstood is worse than none.
 */

/* ================================================================ buckets = */

interface Budget {
  /** Tokens available at full. Also the largest burst that is allowed. */
  readonly capacity: number;
  /** Seconds to regenerate one token. */
  readonly refillSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * The state lives on `globalThis`, for the reason the database handle does.
 *
 * Next evaluates several module graphs per app — route handlers, server
 * components, server actions — so a module-scoped `Map` would be one map *per
 * graph*, and a limiter with three independent budgets is a limiter with three
 * times the limit. `Symbol.for` puts the key in the cross-realm registry so
 * every graph agrees on it.
 */
const REGISTRY = Symbol.for("linear-clone.auth-rate-limit");

interface Registry {
  [REGISTRY]?: Map<string, Bucket>;
}

function buckets(): Map<string, Bucket> {
  const store = globalThis as unknown as Registry;
  return (store[REGISTRY] ??= new Map());
}

/**
 * Drop entries that have refilled to full and been idle since.
 *
 * Without it the map is an unbounded, attacker-controlled allocation: one entry
 * per distinct address plus one per distinct IP, forever. Sweeping on write
 * rather than on a timer keeps it to the request path and needs no scheduler —
 * and a bucket at full capacity carries no information, so discarding it is not
 * forgetting anything.
 */
function prune(now: number): void {
  const map = buckets();
  if (map.size < 2_048) return;
  for (const [key, bucket] of map) {
    if (now - bucket.updatedAt > IDLE_EVICTION_MS) map.delete(key);
  }
}

const IDLE_EVICTION_MS = 60 * 60 * 1000;

function take(key: string, budget: Budget, now: number): boolean {
  const map = buckets();
  const bucket = map.get(key);

  if (!bucket) {
    prune(now);
    map.set(key, { tokens: budget.capacity - 1, updatedAt: now });
    return true;
  }

  const refilled = Math.min(
    budget.capacity,
    bucket.tokens + (now - bucket.updatedAt) / (budget.refillSeconds * 1000),
  );
  bucket.updatedAt = now;

  if (refilled < 1) {
    // Still record the refill: the clock has moved and the caller is entitled
    // to the fraction of a token it bought, or a request every 100 ms would
    // hold the bucket empty forever by resetting the timestamp.
    bucket.tokens = refilled;
    return false;
  }

  bucket.tokens = refilled - 1;
  return true;
}

function refund(key: string, budget: Budget, now: number): void {
  const bucket = buckets().get(key);
  if (!bucket) return;
  const refilled = Math.min(
    budget.capacity,
    bucket.tokens + (now - bucket.updatedAt) / (budget.refillSeconds * 1000),
  );
  bucket.tokens = Math.min(budget.capacity, refilled + 1);
  bucket.updatedAt = now;
}

/** How long until this key has a token again, rounded up to whole seconds. */
function retryAfter(key: string, budget: Budget, now: number): number {
  const bucket = buckets().get(key);
  if (!bucket) return 0;
  const refilled = Math.min(
    budget.capacity,
    bucket.tokens + (now - bucket.updatedAt) / (budget.refillSeconds * 1000),
  );
  if (refilled >= 1) return 0;
  return Math.max(1, Math.ceil((1 - refilled) * budget.refillSeconds));
}

/* ================================================================ budgets = */

/**
 * The numbers, and why each one is where it is.
 *
 * Sign-in is the generous pair, because a correct password refunds its token
 * and the only caller who can deplete these is one who keeps being wrong. Ten
 * wrong passwords for one address before the throttle bites is more patience
 * than a person needs and far less than a dictionary needs.
 *
 * Sign-up is the strict pair, because nothing refunds it: ten new accounts per
 * quarter-hour per address is beyond any honest use of a workspace invite, and
 * the per-email bucket makes retrying one address after a typo cheap while
 * making a thousand addresses expensive.
 */
const SIGNIN_IP: Budget = { capacity: 20, refillSeconds: 15 };
const SIGNIN_EMAIL: Budget = { capacity: 10, refillSeconds: 90 };
const SIGNUP_IP: Budget = { capacity: 10, refillSeconds: 90 };
const SIGNUP_EMAIL: Budget = { capacity: 5, refillSeconds: 180 };

export type AuthEndpoint = "signin" | "signup";

function budgetsFor(endpoint: AuthEndpoint): {
  readonly ip: Budget;
  readonly email: Budget;
} {
  return endpoint === "signin"
    ? { ip: SIGNIN_IP, email: SIGNIN_EMAIL }
    : { ip: SIGNUP_IP, email: SIGNUP_EMAIL };
}

/* ================================================================== keys == */

/**
 * The caller's address, as far as it can be known.
 *
 * `x-forwarded-for`'s *first* entry is the client as the outermost proxy saw
 * it; later entries are the proxies. It is trusted here because the only
 * deployments this app has — Vercel, or a reverse proxy in front of `next
 * start` — set it themselves and overwrite whatever the client sent. A direct
 * connection has no header at all and lands on `"unknown"`, which is one shared
 * bucket rather than none: that is the conservative direction, and it is why
 * the email bucket exists as well, since `"unknown"` is exactly the key an
 * attacker would want to be able to forge their way out of.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

/**
 * The email as a bucket key.
 *
 * Lowercased, matching the `lower(email)` expression the unique index is built
 * on: `Dana@x.com` and `dana@x.com` are one account, so they must be one
 * budget, or the limit is trivially multiplied by changing the capitalisation.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/* ================================================================ the api = */

export interface RateLimitVerdict {
  readonly limited: boolean;
  /** Seconds until a token is available. Only meaningful when limited. */
  readonly retryAfterSeconds: number;
  /**
   * Give the tokens back. Call it after a *successful* authentication — never
   * after a failure, which is the case the budget exists to charge for.
   */
  readonly succeeded: () => void;
}

const ALLOWED: RateLimitVerdict = Object.freeze({
  limited: false,
  retryAfterSeconds: 0,
  succeeded: () => {},
});

/**
 * Spend one token from the IP budget and one from the email budget.
 *
 * Both are charged even when the first is already empty, so a caller cannot
 * keep an email budget full by exhausting an IP budget first, and the reported
 * `retryAfterSeconds` is the longer of the two waits.
 */
export function consumeAuthAttempt(
  endpoint: AuthEndpoint,
  request: Request,
  email: string,
): RateLimitVerdict {
  const now = Date.now();
  const budget = budgetsFor(endpoint);
  const ipKey = `${endpoint}:ip:${clientAddress(request)}`;
  const emailKey = `${endpoint}:email:${normalizeEmail(email)}`;

  const ipOk = take(ipKey, budget.ip, now);
  const emailOk = take(emailKey, budget.email, now);

  if (ipOk && emailOk) {
    // Sign-up buys nothing back: see the note at the top of the file.
    if (endpoint === "signup") return ALLOWED;
    return {
      limited: false,
      retryAfterSeconds: 0,
      succeeded: () => {
        const at = Date.now();
        refund(ipKey, budget.ip, at);
        refund(emailKey, budget.email, at);
      },
    };
  }

  return {
    limited: true,
    retryAfterSeconds: Math.max(
      retryAfter(ipKey, budget.ip, now),
      retryAfter(emailKey, budget.email, now),
      1,
    ),
    succeeded: () => {},
  };
}

/**
 * Forget every budget.
 *
 * For tests, which run dozens of sign-ups through one handler in one second and
 * would otherwise be asserting on the limiter rather than on the route. Not
 * exported from anywhere the application can reach it.
 */
export function resetAuthRateLimitForTests(): void {
  buckets().clear();
}
