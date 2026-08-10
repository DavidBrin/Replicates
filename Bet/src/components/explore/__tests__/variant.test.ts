import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import type { Outcome } from "@/domain/entities";
import { deriveCardVariant } from "../variant";

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
