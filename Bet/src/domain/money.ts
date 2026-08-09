/**
 * All money in Bet is integer cents, branded so a bare `number` can never be
 * passed where a `Credits` is expected (G2). Never use `+`, `-`, `*` directly
 * on a `Credits` value — always go through this module's helpers, so that
 * rounding at every boundary is an explicit, auditable decision.
 */

export type Credits = number & { readonly __brand: "Credits" };

export type Rounding = "up" | "down" | "nearest";

function assertFiniteInteger(n: number, context: string): void {
  if (!Number.isFinite(n)) {
    throw new RangeError(`${context}: expected a finite number, got ${n}`);
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(
      `${context}: expected an integer number of cents, got ${n}`,
    );
  }
}

/** Constructs a `Credits` value from a whole number of cents. Throws on any
 * non-finite or non-integer input — money is never fractional cents. */
export function credits(n: number): Credits {
  assertFiniteInteger(n, "credits(n)");
  return n as Credits;
}

/** Rounds to the nearest integer, ties breaking away from zero (so -0.5
 * rounds to -1, not 0, unlike `Math.round`, which is half-up and would round
 * -0.5 to -0). Exported so other domain modules (e.g. `formatters.ts`) that
 * need to round a decimal credit amount for display share this house style
 * instead of reimplementing it with plain `Math.round`. */
export function roundHalfAwayFromZero(n: number): number {
  return n >= 0 ? Math.round(n) : -Math.round(-n);
}

/** Converts a decimal credit amount (e.g. `1240.5`, meaning 1240 credits and
 * 50 cents) into integer-cent `Credits`, rounding half away from zero. */
export function fromDecimal(d: number): Credits {
  if (!Number.isFinite(d)) {
    throw new RangeError(`fromDecimal(d): expected a finite number, got ${d}`);
  }
  return credits(roundHalfAwayFromZero(d * 100));
}

/** The zero `Credits` value. */
export function zero(): Credits {
  return credits(0);
}

export function add(a: Credits, b: Credits): Credits {
  return credits(a + b);
}

export function sub(a: Credits, b: Credits): Credits {
  return credits(a - b);
}

/**
 * Multiplies a `Credits` amount by an arbitrary real-valued factor (e.g. a
 * probability or a fee rate), producing a new `Credits` value. The product
 * is virtually never an integer number of cents, so a rounding mode is
 * mandatory — there is no implicit default. `"up"` rounds toward positive
 * infinity, `"down"` toward negative infinity, `"nearest"` rounds half away
 * from zero.
 */
export function mul(c: Credits, factor: number, rounding: Rounding): Credits {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`mul(c, factor): expected a finite factor, got ${factor}`);
  }
  const raw = c * factor;
  switch (rounding) {
    case "up":
      return credits(Math.ceil(raw));
    case "down":
      return credits(Math.floor(raw));
    case "nearest":
      return credits(roundHalfAwayFromZero(raw));
  }
}

/** -1 if `a < b`, 1 if `a > b`, 0 if equal. */
export function compare(a: Credits, b: Credits): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function clamp(c: Credits, min: Credits, max: Credits): Credits {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) must be <= max (${max})`);
  }
  return credits(Math.min(Math.max(c, min), max));
}

export function isNegative(c: Credits): boolean {
  return c < 0;
}

/** Converts `Credits` (integer cents) back to a decimal credit amount. The
 * inverse of `fromDecimal`. */
export function toDecimal(c: Credits): number {
  return c / 100;
}
