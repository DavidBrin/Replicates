import { describe, expect, it } from "vitest";
import { delta24h } from "../price-delta";

const NOW = new Date("2026-08-09T18:00:00.000Z");

describe("delta24h", () => {
  it("returns null for an empty history", () => {
    expect(delta24h([], "out-yes", NOW)).toBeNull();
  });

  it("returns null when the outcome is absent from the latest point", () => {
    const history = [{ at: "2026-08-09T17:00:00.000Z", prices: { "out-no": 0.4 } }];
    expect(delta24h(history, "out-yes", NOW)).toBeNull();
  });

  it("computes current minus the price at/before the 24h cutoff", () => {
    const history = [
      { at: "2026-08-08T10:00:00.000Z", prices: { "out-yes": 0.5 } }, // > 24h before NOW
      { at: "2026-08-09T10:00:00.000Z", prices: { "out-yes": 0.6 } }, // within 24h window (baseline candidate too old? it's < 24h before now (8h), not used as baseline)
      { at: "2026-08-09T17:30:00.000Z", prices: { "out-yes": 0.72 } }, // latest
    ];
    // cutoff = NOW - 24h = 2026-08-08T18:00:00.000Z. Latest point at/before
    // cutoff is the 2026-08-08T10:00 one (price 0.5).
    const result = delta24h(history, "out-yes", NOW);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.72 - 0.5, 10);
  });

  it("works regardless of input order (sorts internally)", () => {
    const history = [
      { at: "2026-08-09T17:30:00.000Z", prices: { "out-yes": 0.72 } },
      { at: "2026-08-08T10:00:00.000Z", prices: { "out-yes": 0.5 } },
    ];
    expect(delta24h(history, "out-yes", NOW)!).toBeCloseTo(0.22, 10);
  });

  it("falls back to the earliest point when the market is younger than 24h", () => {
    const history = [
      { at: "2026-08-09T17:00:00.000Z", prices: { "out-yes": 0.5 } },
      { at: "2026-08-09T17:30:00.000Z", prices: { "out-yes": 0.55 } },
    ];
    expect(delta24h(history, "out-yes", NOW)!).toBeCloseTo(0.05, 10);
  });

  it("returns 0 for a flat (unchanged) price", () => {
    const history = [
      { at: "2026-08-08T10:00:00.000Z", prices: { "out-yes": 0.5 } },
      { at: "2026-08-09T17:00:00.000Z", prices: { "out-yes": 0.5 } },
    ];
    expect(delta24h(history, "out-yes", NOW)).toBe(0);
  });
});
