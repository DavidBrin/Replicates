/**
 * Every price in the product, and the one place revenue is split.
 *
 * All of it integer cents (DECISIONS D3). The premium page price in particular
 * is `blocks * 50` and never `blocks * 0.5` — the second form is exactly how a
 * creator's earnings would start drifting by a cent at a time.
 */

import type { PageKind } from "./entities";
import { PAGE_SIZES, type PageSize, type BlockRect, blocksIn } from "./geometry";
import { assertCents, splitBps, type Cents } from "./money";

/** One block of nine pixels. The number the whole product is named after. */
export const BLOCK_PRICE_CENTS: Cents = 100;

/** A private page is a flat ten dollars, whatever size it is (DECISIONS D4). */
export const PRIVATE_PAGE_PRICE_CENTS: Cents = 1_000;

/** Half of BLOCK_PRICE_CENTS: a premium page is the grid at 50% off. */
export const PREMIUM_PAGE_CENTS_PER_BLOCK: Cents = BLOCK_PRICE_CENTS / 2;

/** Free blocks a private page's creator may claim. */
export const PRIVATE_PAGE_ALLOWANCE = 69;

export function selectionPrice(blocks: number): Cents {
  if (!Number.isInteger(blocks) || blocks < 0) {
    throw new RangeError(`blocks must be a non-negative integer, got ${String(blocks)}`);
  }
  return blocks * BLOCK_PRICE_CENTS;
}

export function rectPrice(rect: BlockRect): Cents {
  return selectionPrice(blocksIn(rect));
}

export function premiumPagePrice(size: PageSize): Cents {
  const n = PAGE_SIZES[size];
  return n * n * PREMIUM_PAGE_CENTS_PER_BLOCK;
}

export function pagePrice(kind: Exclude<PageKind, "flagship">, size: PageSize): Cents {
  return kind === "private" ? PRIVATE_PAGE_PRICE_CENTS : premiumPagePrice(size);
}

export function allowanceFor(kind: PageKind): number {
  return kind === "private" ? PRIVATE_PAGE_ALLOWANCE : 0;
}

/* ------------------------------------------------------------- the split -- */

export interface RevenueSplit {
  /** Goes to the page's creator. Zero unless the page is premium. */
  readonly creatorCents: Cents;
  /** Goes to the platform. */
  readonly platformCents: Cents;
}

/**
 * Where the money from a block sale goes.
 *
 * On a premium page the creator takes it all, less the platform fee in basis
 * points, which defaults to zero so that "anyone who buys a block pays the
 * creator" is literally true out of the box (DECISIONS D5). Everywhere else
 * the platform takes it.
 *
 * The two halves always sum back to `amount` exactly — `splitBps` puts any odd
 * cent on the remainder rather than rounding both sides independently.
 */
export function splitBlockRevenue(
  amount: Cents,
  pageKind: PageKind,
  hasCreator: boolean,
  platformFeeBps: number,
): RevenueSplit {
  assertCents(amount);
  if (pageKind !== "premium" || !hasCreator) {
    return { creatorCents: 0, platformCents: amount };
  }
  const [platformCents, creatorCents] = splitBps(amount, platformFeeBps);
  return { creatorCents, platformCents };
}
