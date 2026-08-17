/**
 * How numbers and times are written on screen.
 *
 * Measured, not remembered — `research/08-youtube-ui-measured.md` §8.1 (number
 * formatting) and §8.2 (relative time), against the raw strings in
 * `research/extracted/copy-and-formats.json` and
 * `research/extracted/watch-comments-formats.json`. Where the write-up does not
 * settle a case it is labelled **assumed** at the point it is chosen, and
 * nothing here is guessed silently.
 *
 * ## There is more than one formatter, and that is the whole point of this file
 *
 * The instinct is a single `abbreviate()` shared by everything. R8 §0 lists
 * that instinct as one of the beliefs the product contradicts, and §8.1 proves
 * it with side-by-side samples: **views round to two significant digits and
 * subscriber counts keep three**. `7,060,000` is `7M views` and `7.06M
 * subscribers`; `1,240,000` is `1.2M views` and `1.24M subscribers`. One
 * formatter cannot produce both, so it produces one of them everywhere and is
 * visibly wrong on the other surface.
 *
 * The related-video sidebar is a third variant again (§8.2): it drops the word
 * "views" entirely and abbreviates the unit — `858K` and `2y ago` where a card
 * says `858K views` and `2 years ago`. Same data, same page, different
 * formatter.
 *
 * So the exports below are named for the **surface that calls them**, not for
 * the shape they produce. A call site asks for `formatSubscriberCount`, not for
 * `abbreviate(n, 3)`; picking the significant-digit count at the call site is
 * how the wrong one gets picked.
 */

import type { FormattedCounts } from "./types";

/* ------------------------------------------------------------- counts ----- */

/**
 * The abbreviation ladder. `B` is the last rung: R8's largest sample is
 * `4.4B views` and no `T` has ever been observed.
 */
const COUNT_UNITS: readonly { readonly threshold: number; readonly suffix: string }[] = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
];

/**
 * Below this a count is written out in full.
 *
 * **Measured**, though R8 §8.1 says otherwise. The write-up notes that no
 * sub-1,000 view count appeared in the surfaces it sampled and asks for the
 * exact rendering to be treated as an assumption — but three of them are
 * sitting in `research/extracted/card-dump-1920.json`: `113 views`,
 * `489 views`, `812 views`. Exact, unabbreviated, no separator needed at that
 * magnitude. The caveat is over-cautious and this threshold is settled.
 */
export const COUNT_ABBREVIATION_FLOOR = 1_000;

/** Views, likes and the sidebar all round to two significant digits (§8.1). */
export const VIEW_SIGNIFICANT_DIGITS = 2;

/** Subscriber counts keep three (§8.1) — the difference this file exists for. */
export const SUBSCRIBER_SIGNIFICANT_DIGITS = 3;

/**
 * The engine both ladders run on: abbreviate `count` to `significantDigits`.
 *
 * Not exported. Every caller goes through one of the surface-named wrappers
 * below, so the digit count is chosen once per surface rather than once per
 * call site.
 *
 * Two properties matter and both are measured:
 *
 *   1. **Truncation, not rounding.** `999,999` is `999K` and not `1000K`, and
 *      `1,999,999` is `1.9M` and not `2M`. R8's ladder has no entry that
 *      rounds up across a threshold it has not reached.
 *   2. **No trailing zeros.** `1M views` and `1M subscribers` both appear, so
 *      an exact million is not `1.0M` or `1.00M`. Interior zeros survive —
 *      `7.06M subscribers` is in the sample — so this strips from the right
 *      rather than dropping the fraction whenever it starts with a zero.
 *
 * The arithmetic is integer-only throughout. `Math.floor(count / unit * 10)`
 * reads more naturally and is wrong: the division introduces a representation
 * error that pushes some exact tenths just below their integer, so 2,900,000
 * abbreviates to `2.8M`. Multiplying first keeps every intermediate an exact
 * integer for counts up to ~9×10^13, far past anything this schema can hold.
 */
function abbreviate(count: number, significantDigits: number): string {
  if (count < COUNT_ABBREVIATION_FLOOR) return String(count);

  const unit = COUNT_UNITS.find(({ threshold }) => count >= threshold);
  if (!unit) return String(count);

  const whole = Math.floor(count / unit.threshold);
  const decimals = Math.max(0, significantDigits - String(whole).length);
  if (decimals === 0) return `${whole}${unit.suffix}`;

  const scale = 10 ** decimals;
  const fraction = Math.floor((count * scale) / unit.threshold) % scale;
  if (fraction === 0) return `${whole}${unit.suffix}`;

  const digits = String(fraction).padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${digits}${unit.suffix}`;
}

/**
 * `961K views` — the card's metadata row and the watch page's info line.
 *
 * The watch page uses the *same* abbreviation as the card, which is easy to get
 * wrong in the other direction: R8 §8.1 records the info line as
 * `961K views  10 months ago`, not the comma-grouped figure. The exact figure
 * does exist, but on a different surface — see {@link formatViewCounts}.
 */
export function formatViewCount(value: number): string {
  const count = normaliseCount(value);
  if (count === 0) return NO_VIEWS;
  return `${abbreviate(count, VIEW_SIGNIFICANT_DIGITS)} ${count === 1 ? "view" : "views"}`;
}

/**
 * Both renderings of one count, from one rounding.
 *
 * `abbreviated` is the card and the watch info line. `exact` is *not* the watch
 * page — it is the expanded description panel, which R8 captured as
 * `961,368 views` beside `Oct 7, 2025`, and the aria-labels, captured as
 * `like this video along with 6,259 other people`. Comma grouping appears in
 * those two places and nowhere else.
 */
export function formatViewCounts(value: number): FormattedCounts {
  const count = normaliseCount(value);
  if (count === 0) return { abbreviated: NO_VIEWS, exact: NO_VIEWS };
  const noun = count === 1 ? "view" : "views";
  return {
    abbreviated: `${abbreviate(count, VIEW_SIGNIFICANT_DIGITS)} ${noun}`,
    exact: `${exactCount(count)} ${noun}`,
  };
}

/**
 * `858K` — the related-video sidebar, and the like button.
 *
 * The noun is dropped, not hidden: R8 §8.2 records the sidebar as a play glyph
 * followed by a bare `858K`, and §8.1 records the like button as `6.2K` with
 * the exact figure only in its aria-label. Both use the view ladder.
 *
 * Zero is empty rather than `0`, because a like button with no likes shows the
 * word `Like` and no number at all. **Assumed** — R8 sampled no zero-like
 * video.
 */
export function formatCompactCount(value: number): string {
  const count = normaliseCount(value);
  return count === 0 ? "" : abbreviate(count, VIEW_SIGNIFICANT_DIGITS);
}

/** The like button's `6.2K`. The same ladder as views, per §8.1. */
export const formatLikeCount = formatCompactCount;

/**
 * `7.06M subscribers` — three significant digits, and the reason this is not
 * {@link formatViewCount}.
 *
 * R8 §8.1's sample: `218K`, `393K`, `1M`, `1.24M`, `1.69M`, `3.35M`, `7.06M`,
 * `15.5M`, `21.1M`. Under the view rule `1.24M` would be `1.2M` and `7.06M`
 * would be `7.1M`, so a shared formatter is wrong on the channel header and on
 * every owner row on every watch page.
 *
 * This also matches YouTube's published policy — counts at or above 1,000 are
 * abbreviated publicly, exact below that — which the samples do not contradict
 * but also cannot confirm, since none of them is below 1,000.
 */
export function formatSubscriberCount(value: number): string {
  const count = normaliseCount(value);
  if (count === 0) return "No subscribers";
  const noun = count === 1 ? "subscriber" : "subscribers";
  return `${abbreviate(count, SUBSCRIBER_SIGNIFICANT_DIGITS)} ${noun}`;
}

/**
 * `233 Comments` — exact, comma-grouped, and capitalised.
 *
 * **Measured** in `extracted/watch-comments-formats.json`, whose comment header
 * reads `233 Comments` at 15px/700. Not abbreviated: the number beside a heading
 * is a count of things you can scroll to, and R8 §8.1 records it as exact. The
 * capital `C` is the product's, not a typo — the noun on the video count below
 * is lowercase.
 *
 * The singular is **assumed**; no one-comment video was sampled.
 */
export function formatCommentCount(value: number): string {
  const count = normaliseCount(value);
  return `${exactCount(count)} ${count === 1 ? "Comment" : "Comments"}`;
}

/** `526 videos` — exact, lowercase noun (§8.1, channel header). */
export function formatVideoCount(value: number): string {
  const count = normaliseCount(value);
  return `${exactCount(count)} ${count === 1 ? "video" : "videos"}`;
}

/** `728 watching` — concurrent viewers, exact and never abbreviated (§8.1). */
export function formatWatchingCount(value: number): string {
  return `${exactCount(normaliseCount(value))} watching`;
}

/** `961,368`. The expanded description panel and the aria-labels. */
export function exactCount(value: number): string {
  return GROUPED.format(normaliseCount(value));
}

// Pinned to `en-US` rather than the runtime default. A server rendering for a
// German viewer would otherwise emit `961.368`, which reads as a decimal to
// everyone else and is a difference nobody would notice until a screenshot.
const GROUPED = new Intl.NumberFormat("en-US");

/**
 * **Assumed.** No zero-view card appears in any capture — every video in a feed
 * has been watched by someone. YouTube writes `No views` rather than `0 views`
 * on a freshly published watch page, and that is what this reproduces.
 */
const NO_VIEWS = "No views";

/**
 * A count is a `bigint` column and arrives as a number from PGlite and as a
 * string from Neon, so the caller may hand us either. Also clamps: a negative
 * count is a bookkeeping bug, and rendering `-1 views` turns it into a support
 * ticket instead of a log line.
 */
function normaliseCount(value: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/* ----------------------------------------------------------- durations ---- */

/**
 * `0:49`, `12:17`, `1:34:50` — the thumbnail badge.
 *
 * **Measured**: all three shapes appear verbatim in the captured DOM, and R8 §4
 * records the badge itself as 12/18/500 white on `rgba(0,0,0,.6)` carrying e.g.
 * `30:21`. Minutes are unpadded when they lead (`9:34`) and zero-padded when
 * hours lead (`1:34:50`); seconds are always padded; a sub-minute video keeps
 * its leading `0:` (`0:49`).
 *
 * Seconds are truncated, not rounded, so a 61.5-second video reads `1:01`. The
 * badge must never claim a duration the player will not reach — a `2:00` badge
 * on a video that ends at 1:59.6 reads as a stall.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;

  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/**
 * `1 hour, 34 minutes, 50 seconds` — the accessible name for the badge above,
 * because a screen reader announcing `1:34:50` says "one thirty-four fifty".
 *
 * **Measured**: `30 minutes` and `4 hours` appear as aria text in the capture;
 * the comma-joined multi-part form is **assumed** from that pattern.
 */
export function describeDuration(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;

  const parts: string[] = [];
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;

  if (hours > 0) parts.push(plural(hours, "hour"));
  if (minutes > 0) parts.push(plural(minutes, "minute"));
  if (secs > 0 || parts.length === 0) parts.push(plural(secs, "second"));

  return parts.join(", ");
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/* ------------------------------------------------------- relative time ---- */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Where days stop and weeks start.
 *
 * **Partly measured.** The captures contain `7 days ago` and `10 days ago`
 * alongside `2 weeks ago` and `3 weeks ago`, and contain no `1 week ago` at
 * all — in both the spelled-out and the abbreviated form, where `2d ago` and
 * `7d ago` sit beside `2w ago` and `3w ago` and there is no `1w ago`. So the
 * switch is not at seven days, and weeks begin no earlier than two. Fourteen is
 * the only boundary consistent with every string observed; the exact day it
 * flips (13 vs 14) is **assumed**.
 */
export const DAYS_BEFORE_WEEKS = 14;

type RelativeUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year";

/**
 * How long ago, as a value and a unit — before either spelling is applied.
 *
 * Factored out so the two renderings below cannot disagree about *when*
 * something flips from weeks to months, only about how that is written. The
 * sidebar showing `4w ago` where the card says `1 month ago` for the same video
 * would be exactly the class of bug that having two formatters invites.
 *
 * The ladder is seconds → minutes → hours → days → weeks → months → years, and
 * the top two rungs are counted as **calendar** months rather than as a fixed
 * number of days. A 30-day month constant is the obvious alternative and it
 * drifts: with it, a video published on 31 January is still "4 weeks ago" on
 * 2 March, which is a sentence no calendar agrees with.
 *
 * Computed in UTC. A viewer twelve hours away sees a boundary shift by twelve
 * hours, which at the granularity of "2 weeks ago" is not observable; using the
 * viewer's zone would mean threading it through every card for no visible gain.
 * (The history page's day headings are the case where it *is* observable, and
 * they take a zone — see {@link formatDayHeading}.)
 */
function elapsedParts(
  when: Date,
  now: Date,
): { value: number; unit: RelativeUnit } {
  // A scheduled premiere is genuinely in the future. Clamping is honest here:
  // the alternative, "in 2 days", is a different feature (countdowns) that no
  // surface in this application renders.
  const elapsed = Math.max(0, now.getTime() - when.getTime());

  if (elapsed < MINUTE_MS) {
    return { value: Math.floor(elapsed / SECOND_MS), unit: "second" };
  }
  if (elapsed < HOUR_MS) {
    return { value: Math.floor(elapsed / MINUTE_MS), unit: "minute" };
  }
  if (elapsed < DAY_MS) {
    return { value: Math.floor(elapsed / HOUR_MS), unit: "hour" };
  }

  const days = Math.floor(elapsed / DAY_MS);
  if (days < DAYS_BEFORE_WEEKS) return { value: days, unit: "day" };

  const months = fullCalendarMonthsBetween(when, now);
  if (months < 1) return { value: Math.floor(days / 7), unit: "week" };
  if (months < 12) return { value: months, unit: "month" };
  return { value: Math.floor(months / 12), unit: "year" };
}

/**
 * `3 hours ago`, `2 weeks ago`, `1 year ago` — cards, the watch page and the
 * comment list.
 *
 * R8 §8.2: full words, always `N unit ago`, singular at 1.
 */
export function formatRelativeTime(when: Date, now: Date = new Date()): string {
  const { value, unit } = elapsedParts(when, now);
  return `${plural(value, unit)} ago`;
}

/**
 * The abbreviated unit suffixes for {@link formatCompactRelativeTime}.
 *
 * **Measured**: `2d`, `7d`, `2w`, `3w`, `1mo`, `4mo`, `9mo`, `1y`, `2y` all
 * appear in `research/extracted/*.json`. Note `mo` rather than `m`, which is
 * what makes months distinguishable from minutes.
 *
 * **Assumed**: `s`, `m` and `h`. A sidebar entry published minutes ago is
 * possible and simply was not in the sample. `m` for minutes is the choice that
 * follows from `mo` already being taken by months.
 */
const COMPACT_UNITS: Readonly<Record<RelativeUnit, string>> = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  week: "w",
  month: "mo",
  year: "y",
};

/**
 * `2y ago` — the related-video sidebar, and only the sidebar.
 *
 * R8 §8.2 calls this "the single most likely thing to get wrong from memory",
 * because it is the same data as the card's `2 years ago`, on the same page,
 * rendered differently. No space before the unit, and no plural: `2y`, never
 * `2ys` and never `2 y`.
 */
export function formatCompactRelativeTime(
  when: Date,
  now: Date = new Date(),
): string {
  const { value, unit } = elapsedParts(when, now);
  return `${value}${COMPACT_UNITS[unit]} ago`;
}

/**
 * `Oct 7, 2025` — the expanded description panel's publish date, captured
 * beside `961,368 views`.
 *
 * `en-US` for the same reason the grouping is: the month abbreviation and the
 * comma placement are the product's, not the viewer's locale's.
 */
export function formatAbsoluteDate(when: Date): string {
  return ABSOLUTE_DATE.format(when);
}

const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------- history ---- */

/**
 * `Today`, `Yesterday`, or `16 August 2026` — the history page's day headings.
 *
 * **`Today` and `Yesterday` are measured** — `research/09-youtube-signedin-surfaces.md`
 * §6 records both verbatim from the signed-in history page, followed by a date
 * for older groups. An earlier version of this comment called them assumed on
 * the grounds that R8 never captured that page, which was true of R8 and missed
 * that R9 had: the label outlived the gap it described.
 *
 * **The fallback date format is still assumed.** §6 records that a date appears,
 * not how it is written, so the shape below is a choice made here.
 *
 * Takes the viewer's IANA zone because *this* boundary is observable: a watch at
 * 23:30 local filed under tomorrow is wrong in a way a reader notices
 * immediately, unlike a month boundary drifting by half a day.
 */
export function formatDayHeading(
  day: Date,
  now: Date = new Date(),
  timeZone = "UTC",
): string {
  const dayKey = dayKeyInZone(day, timeZone);
  if (dayKey === dayKeyInZone(now, timeZone)) return "Today";
  if (dayKey === dayKeyInZone(new Date(now.getTime() - DAY_MS), timeZone)) {
    return "Yesterday";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(day);
}

/**
 * `2026-08-16` in the given zone — the key the history page groups on.
 *
 * `en-CA` produces ISO-ordered parts, which sort as strings. Building the key
 * from `toISOString()` instead would silently be a UTC key whatever zone was
 * asked for, and would group a viewer's late-evening watches under tomorrow.
 */
export function dayKeyInZone(date: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

/* --------------------------------------------------------- calendar bits -- */

/**
 * Whole calendar months from `from` to `to` — the count of month boundaries
 * crossed, minus one if the day-of-month has not yet come round.
 */
function fullCalendarMonthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());

  if (months <= 0) return 0;

  const dayNotReached =
    to.getUTCDate() < from.getUTCDate() ||
    (to.getUTCDate() === from.getUTCDate() &&
      millisIntoDay(to) < millisIntoDay(from));

  return dayNotReached ? months - 1 : months;
}

function millisIntoDay(date: Date): number {
  return (
    date.getUTCHours() * HOUR_MS +
    date.getUTCMinutes() * MINUTE_MS +
    date.getUTCSeconds() * SECOND_MS +
    date.getUTCMilliseconds()
  );
}
