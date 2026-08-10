/**
 * All probability, price, multiplier, credit and time display goes through
 * this module (G6) — no ad-hoc `toFixed()` in a component. Every function
 * here is pure; anything that depends on the current time takes it as an
 * explicit `now` parameter rather than calling `Date.now()` itself, so
 * callers stay deterministic and testable.
 */

import type { Credits } from "./money";
import { roundHalfAwayFromZero, toDecimal } from "./money";

/** Renders whole credits with thousands separators, e.g. `124000` cents
 * (1,240 credits) → `"1,240"`. Rounds to the nearest whole credit, half away
 * from zero (money.ts's house rounding style — plain `Math.round` is
 * half-up and would round a negative halfway value, e.g. -1240.50, toward
 * -1240 instead of -1241). Use `formatCreditsPrecise` where cent-level
 * display is needed. */
export function formatCredits(c: Credits): string {
  const whole = roundHalfAwayFromZero(toDecimal(c));
  return new Intl.NumberFormat("en-US").format(whole);
}

/** Renders credits with cents, e.g. `124050` cents → `"1,240.50"`. */
export function formatCreditsPrecise(c: Credits): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toDecimal(c));
}

/** Renders a share/contract count, e.g. `12.3456` → `"12.35"`, `1234` →
 * `"1,234.00"`. Shares are not money (never a `Credits`), but they are a
 * displayed number and so belong here rather than as an ad-hoc `toFixed()`
 * at a call site (G6). A non-finite count renders `"—"` — it is never
 * silently shown as `0`. */
export function formatShares(shares: number): string {
  if (!Number.isFinite(shares)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(shares);
}

/** Renders a probability (0–1) as a whole percent, e.g. `0.7239` → `"72%"`. */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Renders a probability (0–1) as a Kalshi-style cent price, e.g. `0.72` →
 * `"72¢"`. */
export function formatPriceCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

/** Renders the payout multiplier implied by a probability (`1/p`), 2 decimal
 * places, e.g. `0.72` → `"1.39x"`. Non-positive probabilities have no
 * meaningful multiplier and render as `"—"`. */
export function formatMultiplier(p: number): string {
  if (p <= 0) return "—";
  return `${(1 / p).toFixed(2)}x`;
}

/** Renders the time remaining until close as its single largest unit —
 * `"2d"`, `"4h"`, `"12m"` — never a compound like `"2d 4h"`. Anything under
 * a minute but still open renders `"<1m"`; zero or negative renders
 * `"closed"`. */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "closed";

  const days = Math.floor(msRemaining / 86_400_000);
  if (days >= 1) return `${days}d`;

  const hours = Math.floor(msRemaining / 3_600_000);
  if (hours >= 1) return `${hours}h`;

  const minutes = Math.floor(msRemaining / 60_000);
  if (minutes >= 1) return `${minutes}m`;

  return "<1m";
}

/** Renders a credit volume in condensed form: no decimal below 1,000, one
 * decimal place for thousands/millions, e.g. `500` → `"500"`,
 * `120000` cents (1,200 credits) → `"1.2K"`, `490000000` cents (4.9M
 * credits) → `"4.9M"`. */
export function formatVolume(c: Credits): string {
  const value = toDecimal(c);
  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(value)}`;
}

/** Renders `date` relative to `now` as its single largest unit, e.g.
 * `"just now"` (under a minute), `"12m ago"`, `"4h ago"`, `"2d ago"`, or
 * `"in 5m"` for a future date. Both arguments are explicit so this stays
 * pure and testable — never calls `Date.now()` itself. */
export function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const isFuture = diffMs < 0;
  const abs = Math.abs(diffMs);

  if (abs < 60_000) return "just now";

  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor(abs / 60_000);

  const unit = days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${minutes}m`;

  return isFuture ? `in ${unit}` : `${unit} ago`;
}
