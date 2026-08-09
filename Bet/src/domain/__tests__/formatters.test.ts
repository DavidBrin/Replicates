import { describe, expect, it } from "vitest";
import { credits } from "../money";
import {
  formatCountdown,
  formatCredits,
  formatCreditsPrecise,
  formatMultiplier,
  formatPriceCents,
  formatProbability,
  formatRelativeTime,
  formatVolume,
} from "../formatters";

describe("formatCredits()", () => {
  it("renders whole credits with thousands separators", () => {
    expect(formatCredits(credits(124_000))).toBe("1,240");
  });

  it("renders zero", () => {
    expect(formatCredits(credits(0))).toBe("0");
  });

  it("renders negative amounts", () => {
    expect(formatCredits(credits(-124_000))).toBe("-1,240");
  });

  it("renders large amounts", () => {
    expect(formatCredits(credits(123_456_789_000))).toBe("1,234,567,890");
  });

  it("rounds sub-credit remainders to the nearest whole credit", () => {
    expect(formatCredits(credits(124_050))).toBe("1,241"); // 1240.5 -> 1241
    expect(formatCredits(credits(124_049))).toBe("1,240");
  });

  it("rounds a negative halfway remainder half away from zero, not half-up", () => {
    // Math.round(-1240.5) is -1240 (half-up); the house style is half away
    // from zero, matching money.ts's mul()/fromDecimal() rounding, so this
    // must be -1241.
    expect(formatCredits(credits(-124_050))).toBe("-1,241"); // -1240.5 -> -1241
  });
});

describe("formatCreditsPrecise()", () => {
  it("renders cents", () => {
    expect(formatCreditsPrecise(credits(124_050))).toBe("1,240.50");
  });

  it("renders zero", () => {
    expect(formatCreditsPrecise(credits(0))).toBe("0.00");
  });

  it("renders negative amounts", () => {
    expect(formatCreditsPrecise(credits(-150))).toBe("-1.50");
  });
});

describe("formatProbability()", () => {
  it("renders a whole percent", () => {
    expect(formatProbability(0.72)).toBe("72%");
  });

  it("rounds", () => {
    expect(formatProbability(0.7239)).toBe("72%");
    expect(formatProbability(0.7251)).toBe("73%");
  });

  it("renders the extremes", () => {
    expect(formatProbability(0)).toBe("0%");
    expect(formatProbability(1)).toBe("100%");
  });
});

describe("formatPriceCents()", () => {
  it("renders a probability as a cent price", () => {
    expect(formatPriceCents(0.72)).toBe("72¢");
  });

  it("renders the extremes", () => {
    expect(formatPriceCents(0)).toBe("0¢");
    expect(formatPriceCents(1)).toBe("100¢");
  });
});

describe("formatMultiplier()", () => {
  it("renders 1/p to two decimal places", () => {
    expect(formatMultiplier(0.72)).toBe("1.39x");
  });

  it("renders 1x at p=1", () => {
    expect(formatMultiplier(1)).toBe("1.00x");
  });

  it("renders an em-dash for non-positive probabilities", () => {
    expect(formatMultiplier(0)).toBe("—");
    expect(formatMultiplier(-0.1)).toBe("—");
  });
});

describe("formatCountdown()", () => {
  it("renders 'closed' at and below zero", () => {
    expect(formatCountdown(0)).toBe("closed");
    expect(formatCountdown(-1)).toBe("closed");
  });

  it("renders the single largest unit only", () => {
    const day = 86_400_000;
    const hour = 3_600_000;
    const minute = 60_000;

    expect(formatCountdown(2 * day + 4 * hour)).toBe("2d");
    expect(formatCountdown(4 * hour + 30 * minute)).toBe("4h");
    expect(formatCountdown(12 * minute)).toBe("12m");
  });

  it("renders '<1m' under a minute but still open", () => {
    expect(formatCountdown(30_000)).toBe("<1m");
    expect(formatCountdown(1)).toBe("<1m");
  });

  it("renders boundary values", () => {
    expect(formatCountdown(60_000)).toBe("1m");
    expect(formatCountdown(3_600_000)).toBe("1h");
    expect(formatCountdown(86_400_000)).toBe("1d");
  });
});

describe("formatVolume()", () => {
  it("renders below 1,000 with no decimal", () => {
    expect(formatVolume(credits(0))).toBe("0");
    expect(formatVolume(credits(50_000))).toBe("500"); // 500 credits
  });

  it("renders thousands with one decimal", () => {
    expect(formatVolume(credits(120_000))).toBe("1.2K"); // 1,200 credits
  });

  it("renders millions with one decimal", () => {
    expect(formatVolume(credits(490_000_000))).toBe("4.9M"); // 4,900,000 credits
  });

  it("renders the boundary between thousands and millions", () => {
    expect(formatVolume(credits(999_000_00))).toBe("999.0K"); // 999,000 credits
    expect(formatVolume(credits(1_000_000_00))).toBe("1.0M"); // 1,000,000 credits
  });
});

describe("formatRelativeTime()", () => {
  const now = new Date("2026-08-09T12:00:00.000Z");

  it("renders 'just now' under a minute", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 30_000), now)).toBe(
      "just now",
    );
  });

  it("renders minutes, hours, and days ago", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 12 * 60_000), now)).toBe(
      "12m ago",
    );
    expect(
      formatRelativeTime(new Date(now.getTime() - 4 * 3_600_000), now),
    ).toBe("4h ago");
    expect(
      formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000), now),
    ).toBe("2d ago");
  });

  it("renders future dates with 'in'", () => {
    expect(formatRelativeTime(new Date(now.getTime() + 5 * 60_000), now)).toBe(
      "in 5m",
    );
  });
});
