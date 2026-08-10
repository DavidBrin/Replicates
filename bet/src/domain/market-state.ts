/**
 * The market status machine (SPEC §4): `open → closed → resolving →
 * (disputed →) resolved`, plus `cancelled` from any pre-resolved state.
 * Trading is permitted only in `open`. Settlement fires exactly once, on
 * entry to `resolved`.
 *
 * Table-driven so the test suite can enumerate every (from, to) pair —
 * `MarketStatus` has 6 members, so 36 pairs total — and assert legal/illegal
 * exhaustively against this one source of truth.
 */

import type { Market, MarketStatus } from "./entities";

/**
 * Explicit legal-transition table. `resolved` and `cancelled` are terminal
 * (empty arrays): settlement/cancellation never un-happens.
 */
export const LEGAL_TRANSITIONS: Record<MarketStatus, MarketStatus[]> = {
  open: ["closed", "cancelled"],
  closed: ["resolving", "cancelled"],
  resolving: ["disputed", "resolved", "cancelled"],
  disputed: ["resolved", "cancelled"],
  resolved: [],
  cancelled: [],
};

/** Every status the machine knows about, for exhaustive test enumeration. */
export const ALL_MARKET_STATUSES: MarketStatus[] = Object.keys(
  LEGAL_TRANSITIONS,
) as MarketStatus[];

export function canTransition(from: MarketStatus, to: MarketStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class MarketNotTradableError extends Error {
  readonly code = "market_closed" as const;
  constructor(message: string) {
    super(message);
    this.name = "MarketNotTradableError";
  }
}

/**
 * Throws `MarketNotTradableError` unless the market is both in `open` status
 * *and* its close time hasn't passed. The latter check matters independently
 * of the former: a market can be `now >= closesAt` while its stored `status`
 * still reads `open` if nothing has advanced the clock-driven transition yet
 * (see `nextStatusForClock`) — trading must still be rejected in that case.
 */
export function assertTradable(market: Market, now: Date): void {
  if (market.status !== "open") {
    throw new MarketNotTradableError(
      `Market ${market.id} is not open for trading (status: ${market.status})`,
    );
  }
  if (now.getTime() >= market.closesAt.getTime()) {
    throw new MarketNotTradableError(
      `Market ${market.id} has passed its close time`,
    );
  }
}

/**
 * Pure clock-driven transition: an `open` market whose `closesAt` has
 * elapsed should advance to `closed`. Every other status is returned
 * unchanged — this function never invents a transition the table above
 * doesn't already sanction, and it never mutates `market`.
 */
export function nextStatusForClock(market: Market, now: Date): MarketStatus {
  if (market.status === "open" && now.getTime() >= market.closesAt.getTime()) {
    return "closed";
  }
  return market.status;
}
