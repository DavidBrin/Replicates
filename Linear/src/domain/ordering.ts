/**
 * Fractional indexing — the manual-order key.
 *
 * A base-62 string whose byte-wise order *is* the list order. Dropping an
 * issue between two others means asking for a key strictly between their keys,
 * which writes exactly one row; nothing else in the list moves.
 *
 * ## Why a string, not a float
 *
 * The obvious implementation is a float midpoint: `(prev + next) / 2`. Linear
 * itself uses one (`Issue.sortOrder: Float!`). It has a hard failure mode — a
 * double carries ~52 bits of mantissa, so repeatedly inserting into the *same*
 * gap halves the interval until `(a + b) / 2 === a`, at roughly 50 moves.
 * After that the two rows compare equal and the list silently stops holding
 * its order. Linear ships a rebalancing pass to cope with it.
 *
 * A variable-length key has no such point: the midpoint of two adjacent keys
 * is one character longer, and can always be produced. The trade is a byte per
 * reorder against deleting the rebalancer from the critical path
 * (`research/03-data-model.md` §3.2).
 *
 * ## Why this file is a wrapper
 *
 * The encoding is `<head><integer digits><fraction digits>`, where a single
 * head character encodes both the length and the sign of the integer part —
 * the trick that keeps `"Zz" < "a0" < "a1" < … < "az" < "b00"` true under
 * plain `<`. That arithmetic is fiddly precisely at the magnitude boundaries,
 * and a first pass at writing it here failed eight of this module's own tests
 * on exactly those cases: decrementing past the smallest head, and appending
 * past the largest.
 *
 * The bugs were all in the boundary arithmetic, not the design — so rather
 * than iterate on a reconstruction, this module delegates to
 * `fractional-indexing`, the reference port of the scheme Figma described for
 * realtime ordered sequences (CC0, no dependencies, ~2 kB). The tests in
 * `__tests__/ordering.test.ts` were written against the API below and are
 * unchanged; they now pass against an implementation that has been exercised
 * far harder than this codebase could.
 *
 * What stays here is the part that is ours: the domain's vocabulary
 * (`keyForIndex` for drag handlers), the bulk-insert guard, and the
 * byte-wise comparator.
 *
 * ## The one thing that breaks it
 *
 * Comparison must be byte-wise. Postgres' default ICU collation folds case, so
 * `Zz` — the key produced by dragging an item to the *top* of a list — sorts
 * **last**, which the data-model lane reproduced against a real Postgres 16.
 * The column is therefore declared `collate "C"`; see `schema.sql`.
 */

import {
  generateKeyBetween,
  generateNKeysBetween,
} from "fractional-indexing";

/** The key handed to the first item in an empty list. */
export const FIRST_KEY = "a0";

export class OrderKeyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OrderKeyError";
  }
}

/**
 * Re-throw the library's errors as our own.
 *
 * Callers should be able to catch one error type from this module, and a bad
 * key is a domain-level fault (someone's idea of the list order disagrees with
 * what is stored) rather than a library detail.
 */
function wrap<T>(fn: () => T, context: string): T {
  try {
    return fn();
  } catch (error) {
    throw new OrderKeyError(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Assert a key is well-formed.
 *
 * Cheap, and worth doing at boundaries where keys arrive from outside — a
 * malformed key does not throw on comparison, it just sorts somewhere
 * surprising, and the resulting bug looks like a UI problem rather than a data
 * one. Implemented by asking for a key after this one, which forces the
 * library to parse it.
 */
export function validateOrderKey(key: string): void {
  wrap(() => generateKeyBetween(key, null), `Invalid order key "${key}"`);
}

/**
 * A key that sorts strictly between `before` and `after`.
 *
 * Pass null for either side to mean the start or the end of the list; both
 * null yields {@link FIRST_KEY}.
 *
 * @throws OrderKeyError if `before >= after`. That means the caller's idea of
 * the order disagrees with the stored keys, which is worth failing loudly
 * rather than inventing a key that lands somewhere arbitrary.
 */
export function keyBetween(before: string | null, after: string | null): string {
  // The library does not reject swapped neighbours at this level — asking it
  // for a key between "a1" and "a0" returns "a0V", a key that is *not* between
  // the arguments as given but between them reversed. A drag handler that got
  // its neighbours the wrong way round would therefore write a plausible key
  // in the wrong place and produce a list that reorders itself for no visible
  // reason. Rejecting it here turns that into a loud failure.
  if (before !== null && after !== null && before >= after) {
    throw new OrderKeyError(
      `Order keys out of sequence: "${before}" >= "${after}"`,
    );
  }
  return wrap(
    () => generateKeyBetween(before, after),
    `Cannot order between "${before}" and "${after}"`,
  );
}

/**
 * `count` keys evenly distributed between `before` and `after`.
 *
 * Bulk operations must use this rather than calling {@link keyBetween} in a
 * loop. Sequential calls always subdivide the same leading gap, producing a
 * right-leaning chain whose keys grow a character per item — 200 pasted issues
 * would end with 200-character keys. Distributing in one pass keeps them short.
 */
export function keysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new OrderKeyError(`Invalid key count: ${count}`);
  }
  if (count === 0) return [];
  return wrap(
    () => generateNKeysBetween(before, after, count),
    `Cannot order ${count} items between "${before}" and "${after}"`,
  );
}

/**
 * The key for an item moved to `index` within `orderedKeys`.
 *
 * `orderedKeys` must already exclude the moved item, so a drag handler never
 * has to reason about whether the target index is before or after the item's
 * old position — a persistent source of off-by-one errors.
 */
export function keyForIndex(orderedKeys: readonly string[], index: number): string {
  const clamped = Math.max(0, Math.min(index, orderedKeys.length));
  const before = clamped === 0 ? null : (orderedKeys[clamped - 1] ?? null);
  const after =
    clamped >= orderedKeys.length ? null : (orderedKeys[clamped] ?? null);
  return keyBetween(before, after);
}

/**
 * Byte-wise comparison, for sorting in JavaScript.
 *
 * `Array.prototype.sort()`'s default comparator already compares strings
 * byte-wise, but `localeCompare` does not — and reaching for it here would
 * reproduce the Postgres collation bug in the client. This function exists so
 * nobody has to remember that.
 */
export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether a scope's keys have grown long enough to be worth rebalancing.
 *
 * Nothing breaks when this returns true — unlike the float scheme, there is no
 * cliff. It is a housekeeping signal: a list dragged into the same gap
 * thousands of times accumulates long keys and marginally larger rows.
 */
export function shouldRebalance(keys: readonly string[], threshold = 40): boolean {
  return keys.some((key) => key.length > threshold);
}
