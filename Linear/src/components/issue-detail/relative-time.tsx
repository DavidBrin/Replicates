"use client";

/**
 * A timestamp, relative in the text and absolute in the tooltip.
 *
 * Both renderings are required rather than nice to have: `research/02-features.md`
 * §1.6 records that Linear switches every activity timestamp from relative to
 * absolute when an issue is printed, so the absolute form has to exist
 * somewhere in the markup. `title` is where it goes — it is also what a reader
 * reaches for when "29d ago" is not precise enough.
 *
 * ## Why `suppressHydrationWarning`
 *
 * "5m ago" is a function of the clock, and the server's clock is not the
 * client's. Without this, a timestamp that crosses a boundary between the render
 * and the hydration produces a mismatch warning on a page that is otherwise
 * correct. The alternatives are worse: rendering the absolute form until mount
 * flickers every timestamp on the page, and freezing "now" on the server means
 * a tab left open shows an age that stopped counting.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Linear's abbreviations: `5m`, `3h`, `29d`, `4mo`, `2y`.
 *
 * Rounding is *down* at every step. "29d ago" for something 29 days and 20
 * hours old is the honest reading of an elapsed duration; rounding up produces
 * "30d ago" for an event that has not been thirty days old at any point.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";

  const elapsed = now - at;
  if (elapsed < 0) return "just now";
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  if (elapsed < 365 * DAY) return `${Math.floor(elapsed / (30 * DAY))}mo ago`;
  return `${Math.floor(elapsed / (365 * DAY))}y ago`;
}

/**
 * The absolute form.
 *
 * `en-GB` is pinned rather than left to the runtime's default locale. A
 * timestamp is compared against other timestamps on the same screen far more
 * often than it is read on its own, and a server rendering `3/16/2026` under a
 * client rendering `16/03/2026` is a hydration mismatch that only reproduces on
 * some machines.
 */
export function formatAbsoluteTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface RelativeTimeProps {
  value: string;
  className?: string;
}

export function RelativeTime({ value, className }: RelativeTimeProps) {
  return (
    <time
      dateTime={value}
      title={formatAbsoluteTime(value)}
      className={className}
      suppressHydrationWarning
    >
      {formatRelativeTime(value)}
    </time>
  );
}
