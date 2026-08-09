import { describe, expect, it } from "vitest";
import { fixedOddsEngine } from "../fixed-odds";
import { lmsrEngine } from "../lmsr";
import { parimutuelEngine } from "../parimutuel";
import { getEngine, type PricingKind } from "../registry";

describe("registry.getEngine", () => {
  it("resolves lmsr", () => {
    expect(getEngine("lmsr")).toBe(lmsrEngine);
  });

  it("resolves fixedOdds", () => {
    expect(getEngine("fixedOdds")).toBe(fixedOddsEngine);
  });

  it("resolves parimutuel", () => {
    expect(getEngine("parimutuel")).toBe(parimutuelEngine);
  });

  it("throws on an unknown kind", () => {
    expect(() => getEngine("clob" as PricingKind)).toThrow();
  });
});
