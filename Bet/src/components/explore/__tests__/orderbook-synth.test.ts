import { describe, expect, it } from "vitest";
import { synthesizeOrderBook } from "../orderbook-synth";

describe("synthesizeOrderBook", () => {
  it("is deterministic for a given market id and price", () => {
    const a = synthesizeOrderBook("mkt-crypto_abc", 0.62);
    const b = synthesizeOrderBook("mkt-crypto_abc", 0.62);
    expect(a).toEqual(b);
  });

  it("produces different ladders for different market ids", () => {
    const a = synthesizeOrderBook("mkt-crypto_abc", 0.62);
    const b = synthesizeOrderBook("mkt-politics_xyz", 0.62);
    expect(a).not.toEqual(b);
  });

  it("keeps bids below and asks above the mid price", () => {
    const book = synthesizeOrderBook("mkt-sports_seed", 0.5);
    for (const level of book.bids) expect(level.price).toBeLessThanOrEqual(0.5);
    for (const level of book.asks) expect(level.price).toBeGreaterThanOrEqual(0.5);
  });

  it("clamps prices to the 1¢–99¢ contract range near the extremes", () => {
    const book = synthesizeOrderBook("mkt-edge", 0.02, 8);
    for (const level of [...book.bids, ...book.asks]) {
      expect(level.price).toBeGreaterThanOrEqual(0.01);
      expect(level.price).toBeLessThanOrEqual(0.99);
    }
  });

  it("returns the requested number of levels per side", () => {
    const book = synthesizeOrderBook("mkt-levels", 0.4, 5);
    expect(book.bids).toHaveLength(5);
    expect(book.asks).toHaveLength(5);
  });
});
