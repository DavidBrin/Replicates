/**
 * Deriving what a trader actually *paid* per share, from the trade ledger
 * rather than from the running `Position.costBasis`.
 *
 * ## Why this exists (final-review finding C)
 *
 * `Position.costBasis` is a **running residual**, not a historical average.
 * Every sell reduces it by `mul(costBasis, soldFraction, "nearest")`
 * (`src/domain/services/trading.ts`), which is the right thing for "how
 * much of my money is still in this position" — the number the unrealized
 * P/L is computed against — but each of those reductions carries up to
 * ±0.5¢ of rounding that is never re-derived from anything. Across repeated
 * partial sells the residual drifts away from `shares × true average`, and
 * `costBasis / shares` (the old displayed average) drifts with it. On a
 * small remaining position the drift is divided by a small `shares`, so it
 * can amplify past 100¢ per share — an impossible price for a contract that
 * settles at at most 1 credit, and one that makes the UI look broken.
 *
 * The buy ledger has no such problem: each `Trade.cost` is the exact,
 * already-committed number of cents that changed hands, and it is never
 * rewritten. `Σ buy cost / Σ buy shares` is therefore the true average
 * acquisition price, stable no matter how many partial sells follow.
 *
 * Sells are deliberately excluded from both sums. This is average
 * **acquisition** cost ("what did these shares cost me?"), not a realized-
 * P/L figure; netting sell proceeds into the numerator would produce a
 * number that is neither.
 */

import type { OutcomeId } from "./entities";
import { toDecimal, type Credits } from "./money";

/** The only fields of a `Trade` this math needs — a structural subset, so
 * callers can pass domain `Trade`s or wire-shaped rows without a mapping
 * step, and so the function stays trivially testable. */
export interface LedgerTrade {
  outcomeId: OutcomeId;
  side: "buy" | "sell";
  shares: number;
  cost: Credits;
}

/**
 * The highest price a share can ever have cost, expressed in the same
 * 0..1 "fraction of one credit" units this module returns. A share settles
 * at par (1 credit) at most, so any average above this is arithmetic
 * damage, not data — clamping keeps a corrupt or pathological ledger from
 * rendering an impossible price.
 */
const MAX_PRICE_PER_SHARE = 1;

/**
 * Average acquisition price per share for one outcome, as a 0..1 fraction
 * of a credit (the same unit `formatters.formatPriceCents` expects, so
 * `0.76` renders as `"76¢"`).
 *
 * Returns `0` when the trader has no buys for that outcome — there is no
 * meaningful average to show, and it keeps the caller free of a
 * divide-by-zero branch. The result is clamped to `[0, 1]`: see
 * `MAX_PRICE_PER_SHARE`.
 */
export function averageBuyPrice(trades: LedgerTrade[], outcomeId: OutcomeId): number {
  let costCents = 0;
  let shares = 0;

  for (const t of trades) {
    if (t.side !== "buy" || t.outcomeId !== outcomeId) continue;
    costCents += t.cost;
    shares += t.shares;
  }

  if (shares <= 0) return 0;

  const perShare = toDecimal(costCents as Credits) / shares;
  if (!Number.isFinite(perShare) || perShare < 0) return 0;
  return Math.min(perShare, MAX_PRICE_PER_SHARE);
}
