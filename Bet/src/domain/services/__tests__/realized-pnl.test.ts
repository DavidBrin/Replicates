import { describe, expect, it } from "vitest";
import { credits } from "@/domain/money";
import type { Payout } from "@/domain/pricing/types";
import { realizedPnlFor, type PnlTrade } from "../realized-pnl";

/**
 * The worked case from the money review: alice buys 50 Yes for 2810c, bob
 * buys 30 No for 1241c, `b = 100`. Yes wins, so alice is paid 5000c and is
 * up **21.90**. The market page used to contradict that on the same screen
 * with a live mark-to-market "Unrealized P/L −0.61".
 */
const TRADES: PnlTrade[] = [
  { userId: "alice", side: "buy", cost: credits(2810) },
  { userId: "bob", side: "buy", cost: credits(1241) },
];
const PAYOUTS: Payout[] = [{ userId: "alice", amount: credits(5000) }];

describe("realizedPnlFor", () => {
  it("computes the winner's realized P/L as payout minus net spent", () => {
    expect(realizedPnlFor("alice", TRADES, PAYOUTS)).toEqual({
      netSpent: credits(2810),
      payout: credits(5000),
      pnl: credits(2190),
      hasPosition: true,
    });
  });

  it("computes the loser's realized P/L as a total loss of their stake", () => {
    expect(realizedPnlFor("bob", TRADES, PAYOUTS)).toEqual({
      netSpent: credits(1241),
      payout: credits(0),
      pnl: credits(-1241),
      hasPosition: true,
    });
  });

  it("nets sell proceeds out of the amount spent", () => {
    const withSell: PnlTrade[] = [
      ...TRADES,
      { userId: "alice", side: "sell", cost: credits(1000) },
    ];
    const result = realizedPnlFor("alice", withSell, PAYOUTS);
    expect(result.netSpent).toBe(credits(1810));
    expect(result.pnl).toBe(credits(3190));
  });

  it("reports hasPosition false — not a 0.00 P/L — for someone who never traded", () => {
    const result = realizedPnlFor("carol", TRADES, PAYOUTS);
    expect(result.hasPosition).toBe(false);
    expect(result.pnl).toBe(credits(0));
  });
});
