/**
 * The viewing session key — the cookie the recommender has been waiting for.
 *
 * `watch_events.session_key` is described by the schema as *"a cookie value,
 * not an identity"*, and `adapters/repositories/watch-events.ts` says plainly
 * where the rule that defines it belongs:
 *
 * > Sessionisation is upstream of this file … the boundary is whatever the
 * > caller's cookie says … If the idle-gap rule is ever wanted it belongs in
 * > whatever issues that cookie, not here.
 *
 * Nothing issued it. Four surfaces fell back to `token ?? "anonymous"`, which
 * put every signed-out viewer on the planet into one shared session — a bucket
 * that, on a corpus with any traffic at all, makes every video co-visited with
 * every other video and the recommender a popularity list wearing a hat. It
 * only looked harmless because the graph was seeded and never written to.
 *
 * This module is that issuer, and it implements the rule
 * `research/04-recommender-covisitation.md` §1.1 recommends:
 *
 * > gap-based sessionization — a session ends when a user has gone more than a
 * > fixed idle gap (e.g. 30 minutes) without a watch event, with a hard cap of
 * > 24 hours on total session length regardless of gaps.
 *
 * Both halves are enforced, and each by the mechanism that fits it:
 *
 *  - **The idle gap is the cookie's `Max-Age`, refreshed on every response.**
 *    A viewer who keeps browsing keeps the key; one who closes the tab for
 *    thirty-one minutes comes back to a cookie the browser has already
 *    discarded, and is issued a new one. The gap rule therefore costs no
 *    storage and no clock comparison — the browser is the timer.
 *  - **The 24-hour cap is the issue time, carried in the value.** A rolling
 *    `Max-Age` alone never expires for someone who never idles, which is
 *    exactly the "videos left playing in a background tab for a week" case §1.1
 *    names. So the key is `<random>.<issuedAtMs>` and anything older than a day
 *    is replaced.
 *
 * ## Why the issue time is in the value rather than in a second cookie
 *
 * Because the pair has to expire together. Two cookies can be dropped
 * independently — by a privacy tool, by a partial clear, by a request that
 * exceeds a header cap — and a key whose companion timestamp went missing has
 * no defined age. Carrying it inside the value makes "the key" one indivisible
 * thing: it is either present and self-describing, or absent.
 *
 * It is *not* signed. A forged value buys nothing that pressing "new incognito
 * window" does not: the key confers no authority, names no user, and its only
 * effect is which co-visitation bucket a watch joins. Signing it would imply a
 * trust it does not carry. What it must not be is *guessable-in-bulk*, since a
 * key collision merges two strangers' viewing into one session — hence 128 bits
 * from the platform CSPRNG rather than a counter or a timestamp hash.
 *
 * ## Not `HttpOnly`-optional, and not readable by scripts
 *
 * No client code reads it: the watch reporter posts to a route and the cookie
 * rides along. So `HttpOnly` costs nothing and keeps a viewing history out of
 * reach of any script that ends up on the page.
 *
 * This module is deliberately free of Node built-ins and of `server-only`: it
 * runs in the middleware's Edge runtime as well as in route handlers, and it is
 * imported directly by its unit tests.
 */

/** The cookie's name. Short, because it is sent on every request. */
export const VIEWER_KEY_COOKIE = "yt_vk";

/**
 * The idle gap, as seconds — `research/04` §1.1's *"e.g. 30 minutes"*.
 *
 * This is the cookie's `Max-Age` and it is rewritten on every response, so it
 * measures time since the last *request*, not since the session began.
 */
export const VIEWER_KEY_IDLE_SECONDS = 30 * 60;

/**
 * The hard cap, as milliseconds — §1.1's *"24 hours … regardless of gaps"*,
 * which is also the only number D10 itself states about session length
 * ("usually 24 hours").
 */
export const VIEWER_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 128 bits, hex — the same width as a UUID and with no version nibbles. */
const RANDOM_BYTES = 16;

/**
 * A key, and when it was issued.
 *
 * `issuedAt` is milliseconds since the epoch, which is what the value encodes;
 * a `Date` here would be a conversion at every boundary for no gain.
 */
export interface ViewerKey {
  readonly value: string;
  readonly issuedAtMs: number;
}

/**
 * Mint a key.
 *
 * `crypto.getRandomValues` rather than `randomUUID`, because a UUID spends six
 * of its bits on a version and a variant, and because `getRandomValues` is the
 * one CSPRNG entry point present in every runtime this module has to work in —
 * Node, the Edge runtime, and jsdom under the unit suite.
 */
export function mintViewerKey(nowMs: number): ViewerKey {
  const bytes = new Uint8Array(RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  let random = "";
  for (const byte of bytes) random += byte.toString(16).padStart(2, "0");
  return { value: `${random}.${nowMs}`, issuedAtMs: nowMs };
}

/**
 * Read a key back, rejecting anything that is not one we wrote.
 *
 * Strict on purpose. The value reaches this function from a request header, so
 * it is attacker-supplied, and it goes on to be a `session_key` — a grouping
 * key that a hostile value could otherwise use to make itself enormous (a
 * multi-megabyte cookie becoming a multi-megabyte index entry) or to collide
 * with a real session by copying its shape loosely. Everything about the
 * accepted form is therefore checked rather than assumed: 32 lowercase hex
 * digits, one dot, then digits that parse to a finite non-negative integer.
 *
 * A key stamped in the **future** is rejected too, not clamped. It cannot have
 * been issued by us, and treating it as "very fresh" would give a forger a
 * session that never hits the 24-hour cap.
 */
export function parseViewerKey(raw: string | null | undefined): ViewerKey | null {
  if (typeof raw !== "string") return null;
  const match = /^([0-9a-f]{32})\.(\d{1,15})$/.exec(raw);
  if (match === null) return null;
  const issuedAtMs = Number(match[2]);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) return null;
  return { value: raw, issuedAtMs };
}

/**
 * The key this request should carry, and whether it is new.
 *
 * `refreshed` is what tells the caller to write a `Set-Cookie`. It is true both
 * when a key was minted and when an existing one was merely re-presented,
 * because the second case is how the idle gap gets extended: a response that
 * omits the header lets the original `Max-Age` run down from whenever it was
 * last set, and a viewer thirty minutes into a session would lose their key
 * mid-watch.
 */
export interface ViewerKeyDecision {
  readonly key: ViewerKey;
  /** A key was minted, rather than an existing one being carried forward. */
  readonly minted: boolean;
}

/**
 * Decide the key for a request that arrived with `presented`.
 *
 * Three outcomes collapse into two: absent, malformed and past-the-cap all
 * mint, because from the recommender's point of view they are the same event —
 * this request is not part of any session we can still identify, so it starts
 * one.
 */
export function decideViewerKey(
  presented: string | null | undefined,
  nowMs: number,
): ViewerKeyDecision {
  const existing = parseViewerKey(presented);
  if (existing === null) return { key: mintViewerKey(nowMs), minted: true };

  const age = nowMs - existing.issuedAtMs;
  // `age < 0` is a key stamped ahead of our clock — see `parseViewerKey` for
  // why that is not trusted. Reached here only if the clock moved backwards
  // between two requests, which is a real thing on a laptop waking up.
  if (age < 0 || age >= VIEWER_KEY_MAX_AGE_MS) {
    return { key: mintViewerKey(nowMs), minted: true };
  }
  return { key: existing, minted: false };
}

/**
 * The `Set-Cookie` value.
 *
 * `SameSite=Lax` for the reason the session cookie gives: a shared video link
 * is a cross-site GET, and `Strict` would drop the key on exactly the arrival
 * that most wants to be part of the referrer's session. `Secure` follows the
 * request's scheme rather than `NODE_ENV` — the mistake this repository already
 * made once with the session cookie, where a production build on
 * `http://localhost` set `Secure` and the browser silently discarded it.
 */
export function viewerKeyCookie(
  key: ViewerKey,
  options: { readonly secure: boolean },
): string {
  const parts = [
    `${VIEWER_KEY_COOKIE}=${key.value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${VIEWER_KEY_IDLE_SECONDS}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
