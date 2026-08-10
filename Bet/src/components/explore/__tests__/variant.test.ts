import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import type { Outcome } from "@/domain/entities";
import { deriveCardVariant, isCompactBinary } from "../variant";

function outcome(label: string): Outcome {
  return {
    id: brand("out"),
    marketId: brand("mkt"),
    label,
    color: "#000000",
  };
}

describe("deriveCardVariant", () => {
  it("recognizes a plain Yes/No pair as binary", () => {
    expect(deriveCardVariant([outcome("Yes"), outcome("No")])).toBe("binary");
  });

  it("recognizes Yes/No in either order as binary", () => {
    expect(deriveCardVariant([outcome("No"), outcome("Yes")])).toBe("binary");
  });

  it("treats a non-Yes/No pair as head-to-head", () => {
    expect(deriveCardVariant([outcome("Comets"), outcome("Harbor FC")])).toBe("headToHead");
  });

  it("treats 3+ outcomes as multi", () => {
    expect(deriveCardVariant([outcome("A"), outcome("B"), outcome("C")])).toBe("multi");
  });

  it("treats a single outcome as head-to-head (degenerate, never seeded)", () => {
    expect(deriveCardVariant([outcome("Only")])).toBe("headToHead");
  });
});

describe("isCompactBinary", () => {
  it("is deterministic — same id, same result, every call", () => {
    const id = "market-42";
    const first = isCompactBinary(id);
    for (let i = 0; i < 10; i++) {
      expect(isCompactBinary(id)).toBe(first);
    }
  });

  it("splits a batch of ids roughly evenly, not all-true or all-false", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `seeded-market-${i}`);
    const compactCount = ids.filter((id) => isCompactBinary(id)).length;
    expect(compactCount).toBeGreaterThan(10);
    expect(compactCount).toBeLessThan(30);
  });

  it("gives different ids independent results (not a constant function)", () => {
    const results = new Set(
      Array.from({ length: 20 }, (_, i) => isCompactBinary(`market-${i}`)),
    );
    expect(results.size).toBe(2);
  });
});
