/**
 * Pure group-leaderboard math — deliberately free of any Next.js /
 * `server-only` import (unlike `page.tsx`, which pulls in
 * `requireCurrentUser` and therefore the `server-only` package via
 * `@/lib/server-actor`) so it can be unit-tested directly, and so the
 * dashboard's mark-to-market math lives in exactly one place instead of
 * being re-derived inline in the page component.
 *
 * ## Fix round 1: mark-to-market, not just cash flow
 *
 * The original implementation summed each trade's cash flow (buy: -cost,
 * sell: +cost) plus any resolved-market payout, and nothing else. That's
 * correct once a market resolves, but while a market is still open the
 * credits spent buying shares are sitting in a real, currently-priced
 * position — not gone. Valuing that position at zero made *every* member
 * holding an open position look like they were losing the full amount
 * they'd staked, even members who were actually up. Most seeded markets
 * are still open, so nearly the whole leaderboard read as negative (a
 * screen that looks broken even though the underlying data wasn't wrong,
 * just incompletely priced). The fix adds a third term: for every
 * not-yet-`"resolved"` market, each position's `shares × currentPrice`
 * (the same prices `MarketCard` already shows), via the one true
 * `toMarketState` + `getEngine(kind).currentPrices` reconciliation —
 * no second price mapping invented here.
 *
 * ## Scope: per-group, not global `User.balance`
 *
 * The brief's mark-to-market formula is phrased in terms of the user's
 * global `balance` (`balance + open positions + resolved payouts -
 * 1000`). This dashboard's leaderboard is explicitly *this group's*
 * standing (see the original task-9 report: "this group's markets only,
 * not the user's global balance delta") — a member can belong to several
 * groups, and folding another group's P/L into this one would leak
 * unrelated results into a leaderboard captioned by this group's name. So
 * the formula here has the same *shape* — cash flow + open-position mark
 * + resolved payout — scoped to the group's own markets, rather than
 * `user.balance - 1000`. For a member who only ever trades in one group
 * the two are the same number.
 */
import { add, fromDecimal, sub, zero, type Credits } from "@/domain/money";
import type { MarketStatus, OutcomeId, Position, Trade, UserId } from "@/domain/entities";
import type { Payout } from "@/domain/pricing/types";

export interface MarketLeaderboardInput {
  /** The market's *stored* status, not `nextStatusForClock`'s effective
   * status — only an actually-`"resolved"` market has realized payouts to
   * fold in; every other status (including a stored `"open"` whose clock
   * has silently elapsed into `"closed"`/`"resolving"`/`"disputed"`) still
   * has live positions, so those get marked at the current price instead. */
  status: MarketStatus;
  trades: Trade[];
  payouts: Payout[];
  positions: Position[];
  prices: Record<OutcomeId, number>;
}

/**
 * `net = Σ trade cash flow + Σ (resolved payout | open-position mark)`,
 * per member, across every market passed in. Members not present in
 * `memberIds` are ignored (defends against a stray trade/position from a
 * user who has since left the group).
 */
export function computeGroupNetCredits(
  memberIds: UserId[],
  markets: MarketLeaderboardInput[],
): Map<UserId, Credits> {
  const net = new Map<UserId, Credits>(memberIds.map((id) => [id, zero()]));

  for (const { status, trades, payouts, positions, prices } of markets) {
    for (const trade of trades) {
      const current = net.get(trade.userId);
      if (current === undefined) continue;
      net.set(
        trade.userId,
        trade.side === "buy" ? sub(current, trade.cost) : add(current, trade.cost),
      );
    }

    if (status === "resolved") {
      for (const payout of payouts) {
        const userId = payout.userId as UserId;
        const current = net.get(userId);
        if (current === undefined) continue;
        net.set(userId, add(current, payout.amount));
      }
    } else {
      for (const position of positions) {
        const current = net.get(position.userId);
        if (current === undefined) continue;
        const price = prices[position.outcomeId] ?? 0;
        net.set(position.userId, add(current, fromDecimal(position.shares * price)));
      }
    }
  }

  return net;
}
