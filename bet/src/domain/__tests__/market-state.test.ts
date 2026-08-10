import { describe, expect, it } from "vitest";
import { brand } from "../entities";
import type { Market, MarketStatus } from "../entities";
import { credits } from "../money";
import {
  ALL_MARKET_STATUSES,
  LEGAL_TRANSITIONS,
  MarketNotTradableError,
  assertTradable,
  canTransition,
  nextStatusForClock,
} from "../market-state";

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: brand("market_1"),
    groupId: null,
    creatorId: brand("user_1"),
    question: "Will it happen?",
    resolutionCriteria: "Resolves YES if it happens.",
    closesAt: new Date("2026-06-01T00:00:00Z"),
    status: "open",
    visibility: "private",
    pricing: { kind: "lmsr", b: 100, feeBps: 0, q: {} },
    minStake: credits(100),
    maxStake: credits(10_000),
    stakesVisible: true,
    outcomes: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// The exhaustive expected transition table, hand-derived from SPEC §4:
// `open → closed → resolving → (disputed →) resolved`, plus `cancelled`
// from any pre-resolved state (open, closed, resolving, disputed).
const EXPECTED: Record<MarketStatus, MarketStatus[]> = {
  open: ["closed", "cancelled"],
  closed: ["resolving", "cancelled"],
  resolving: ["disputed", "resolved", "cancelled"],
  disputed: ["resolved", "cancelled"],
  resolved: [],
  cancelled: [],
};

describe("market-state: LEGAL_TRANSITIONS table", () => {
  it("covers every MarketStatus as a key", () => {
    expect(ALL_MARKET_STATUSES.length).toBeGreaterThanOrEqual(6);
    for (const status of ALL_MARKET_STATUSES) {
      expect(LEGAL_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("matches the hand-derived expected table exactly", () => {
    expect(LEGAL_TRANSITIONS).toEqual(EXPECTED);
  });
});

describe("canTransition: exhaustive over every (from, to) pair", () => {
  for (const from of ALL_MARKET_STATUSES) {
    for (const to of ALL_MARKET_STATUSES) {
      const expected = EXPECTED[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "legal" : "illegal"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }

  it("resolved and cancelled are both terminal (no legal outgoing transition)", () => {
    for (const to of ALL_MARKET_STATUSES) {
      expect(canTransition("resolved", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });
});

describe("assertTradable", () => {
  it("does not throw for an open market before its close time", () => {
    const market = makeMarket({ status: "open", closesAt: new Date("2026-06-01T00:00:00Z") });
    expect(() => assertTradable(market, new Date("2026-05-01T00:00:00Z"))).not.toThrow();
  });

  it("throws MarketNotTradableError for a non-open status", () => {
    for (const status of ALL_MARKET_STATUSES) {
      if (status === "open") continue;
      const market = makeMarket({ status });
      expect(() => assertTradable(market, new Date("2026-01-15T00:00:00Z"))).toThrow(
        MarketNotTradableError,
      );
    }
  });

  it("throws even when status is still open if closesAt has already passed", () => {
    const market = makeMarket({ status: "open", closesAt: new Date("2026-01-01T00:00:00Z") });
    expect(() => assertTradable(market, new Date("2026-01-02T00:00:00Z"))).toThrow(
      MarketNotTradableError,
    );
  });

  it("throws exactly at closesAt (now >= closesAt is not tradable)", () => {
    const closesAt = new Date("2026-01-01T00:00:00Z");
    const market = makeMarket({ status: "open", closesAt });
    expect(() => assertTradable(market, closesAt)).toThrow(MarketNotTradableError);
  });
});

describe("nextStatusForClock", () => {
  it("advances open -> closed once now >= closesAt", () => {
    const market = makeMarket({ status: "open", closesAt: new Date("2026-01-01T00:00:00Z") });
    expect(nextStatusForClock(market, new Date("2026-01-01T00:00:00Z"))).toBe("closed");
    expect(nextStatusForClock(market, new Date("2026-02-01T00:00:00Z"))).toBe("closed");
  });

  it("leaves open unchanged before closesAt", () => {
    const market = makeMarket({ status: "open", closesAt: new Date("2026-06-01T00:00:00Z") });
    expect(nextStatusForClock(market, new Date("2026-01-01T00:00:00Z"))).toBe("open");
  });

  it("never invents a transition for non-open statuses, even past closesAt", () => {
    for (const status of ALL_MARKET_STATUSES) {
      if (status === "open") continue;
      const market = makeMarket({ status, closesAt: new Date("2020-01-01T00:00:00Z") });
      expect(nextStatusForClock(market, new Date("2030-01-01T00:00:00Z"))).toBe(status);
    }
  });

  it("does not mutate the market it's given", () => {
    const market = makeMarket({ status: "open", closesAt: new Date("2026-01-01T00:00:00Z") });
    const snapshot = { ...market };
    nextStatusForClock(market, new Date("2027-01-01T00:00:00Z"));
    expect(market).toEqual(snapshot);
  });
});
