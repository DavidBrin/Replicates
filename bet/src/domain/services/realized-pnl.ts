/**
 * Realized P/L on a **resolved** market — the one number that is true after
 * settlement, and the reason it needs a home of its own.
 *
 * Before this existed, the group dashboard computed it inline (for
 * `MarketCard`'s settled face) while the market detail page had no notion
 * of settlement at all: it kept marking every position to the *live* price
 * long after payouts had landed. A holder who was paid 50.00 for a winning
 * position could be shown "Unrealized P/L −0.61" in red on the same screen,
 * because `p(Yes)` had settled at 0.54983 rather than 1 and nothing gated
 * the mark on `status === "resolved"`. Two surfaces, one question, one
 * answer — so the answer lives here and both call it.
 *
 * Deliberately NOT solved by zeroing positions at `finalize`: the group
 * dashboard re-derives payouts from the position rows on every render
 * (`engine.settle(...)`), so emptying them would silently zero every
 * settled card's P/L too. Positions stay as the historical record of who
 * held what; the DISPLAY is what gates on status.
 */

import { add, sub, zero, type Credits } from "@/domain/money";
import type { Payout } from "@/domain/pricing/types";

/** The subset of a `Trade` this math needs — structural, so callers can
 * pass domain `Trade`s or wire rows without a mapping step. */
export interface PnlTrade {
  userId: string;
  side: "buy" | "sell";
  cost: Credits;
}

export interface RealizedPnl {
  /** Net credits the viewer put in: buys minus sell proceeds. Negative if
   * they took more out than they ever put in before resolution. */
  netSpent: Credits;
  /** What settlement actually paid them (0 if they held nothing winning). */
  payout: Credits;
  /** `payout − netSpent`. The only P/L figure a resolved market has. */
  pnl: Credits;
  /** Whether the viewer traded this market at all — the difference between
   * "P/L 0.00" and "you weren't in this one". */
  hasPosition: boolean;
}

export function realizedPnlFor(
  viewerId: string,
  trades: PnlTrade[],
  payouts: Payout[],
): RealizedPnl {
  const mine = trades.filter((t) => t.userId === viewerId);
  const netSpent = mine.reduce(
    (sum, t) => (t.side === "buy" ? add(sum, t.cost) : sub(sum, t.cost)),
    zero(),
  );
  const payout = payouts.find((p) => p.userId === viewerId)?.amount ?? zero();
  return { netSpent, payout, pnl: sub(payout, netSpent), hasPosition: mine.length > 0 };
}
