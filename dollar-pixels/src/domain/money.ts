/**
 * Money is integer cents, everywhere (DECISIONS D3).
 *
 * No float ever touches a price. `blocks * 0.5` is exactly the expression that
 * would introduce drift into a creator's earnings, so the premium page price
 * is expressed as `blocks * 50` cents and stays exact.
 */

/** A whole number of cents. Negative values are legal (refunds, corrections). */
export type Cents = number;

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Throws rather than silently coercing — a bad amount must not reach a ledger. */
export function assertCents(value: unknown, label = "amount"): Cents {
  if (!isCents(value)) {
    throw new TypeError(`${label} must be a whole number of cents, got ${String(value)}`);
  }
  return value;
}

/**
 * Split an amount by basis points, returning [share, remainder].
 *
 * The remainder is whatever is left, so the two always sum back to the input
 * exactly — no cent is created or lost by rounding. The share rounds down,
 * which puts any odd cent on the remainder side.
 */
export function splitBps(amount: Cents, bps: number): [share: Cents, remainder: Cents] {
  assertCents(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError(`bps must be an integer in 0..10000, got ${String(bps)}`);
  }
  const share = Math.floor((amount * bps) / 10_000);
  return [share, amount - share];
}

/** "$1.00", "$160,000.00". Display only — never parsed back. */
export function formatUsd(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = dollars.toLocaleString("en-US");
  return `${negative ? "-" : ""}$${grouped}.${String(rest).padStart(2, "0")}`;
}

/** "$1" where the amount is whole dollars, "$1.50" where it is not. */
export function formatUsdCompact(cents: Cents): string {
  assertCents(cents);
  return cents % 100 === 0
    ? `${cents < 0 ? "-" : ""}$${Math.abs(cents / 100).toLocaleString("en-US")}`
    : formatUsd(cents);
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
