import { describe, expect, it } from "vitest";
import { buildCreateMarketRequestBody } from "../build-request";
import { buildDefaultDraft, type WizardDraft } from "../types";

/** `buildDefaultDraft` leaves `closesAt` empty (the untouched-draft state)
 * — `buildCreateMarketRequestBody` always re-parses it via `new Date(...)`,
 * so every test below needs a real value or `.toISOString()` throws
 * `RangeError: Invalid time value`, which isn't what any of these tests are
 * about. */
function freshDraft(groupId: string): WizardDraft {
  const draft = buildDefaultDraft(groupId);
  draft.closesAt = "2026-08-20T21:00";
  return draft;
}

describe("buildCreateMarketRequestBody", () => {
  it("maps a binary, market-priced draft with no invitees", () => {
    const draft = freshDraft("grp_1");
    draft.question = "  Will it rain?  ";
    draft.resolutionCriteria = "  Resolves YES if the airport reports any rain.  ";
    draft.resolutionSource = "";
    draft.closesAt = "2026-08-20T21:00";

    const body = buildCreateMarketRequestBody(draft);

    expect(body.groupId).toBe("grp_1");
    expect(body.question).toBe("Will it rain?");
    expect(body.resolutionCriteria).toBe("Resolves YES if the airport reports any rain.");
    expect(body.resolutionSource).toBeUndefined();
    expect(body.outcomes).toEqual([{ label: "Yes" }, { label: "No" }]);
    expect(body.pricing).toEqual({ kind: "lmsr" });
    expect(body.minStake).toBe(1);
    expect(body.maxStake).toBe(500);
    expect(body.stakesVisible).toBe(true);
    expect(body.inviteeIds).toEqual([]);
    expect(new Date(body.closesAt).toISOString()).toBe(body.closesAt);
  });

  it("trims resolutionSource and omits it entirely when blank", () => {
    const draft = freshDraft("grp_1");
    draft.resolutionSource = "   ";
    expect(buildCreateMarketRequestBody(draft).resolutionSource).toBeUndefined();

    draft.resolutionSource = "  ESPN box score  ";
    expect(buildCreateMarketRequestBody(draft).resolutionSource).toBe("ESPN box score");
  });

  it("maps custom outcomes in order when not binary", () => {
    const draft = freshDraft("grp_1");
    draft.isBinary = false;
    draft.customOutcomes = [
      { id: "a", label: "Marcus" },
      { id: "b", label: "Priya" },
      { id: "c", label: "Sam" },
    ];
    const body = buildCreateMarketRequestBody(draft);
    expect(body.outcomes).toEqual([{ label: "Marcus" }, { label: "Priya" }, { label: "Sam" }]);
  });

  it("converts fixedOdds percentages to fractions, positionally matching outcomes", () => {
    const draft = freshDraft("grp_1");
    draft.isBinary = false;
    draft.customOutcomes = [
      { id: "a", label: "Marcus" },
      { id: "b", label: "Priya" },
    ];
    draft.pricingKind = "fixedOdds";
    draft.oddsByOutcomeId = { a: "70", b: "30" };

    const body = buildCreateMarketRequestBody(draft);
    expect(body.pricing).toEqual({ kind: "fixedOdds", openingPrices: [0.7, 0.3] });
  });

  it("treats a missing/garbage odds entry as 0 rather than throwing", () => {
    const draft = freshDraft("grp_1");
    draft.pricingKind = "fixedOdds";
    draft.oddsByOutcomeId = { yes: "not-a-number" }; // "no" missing entirely
    const body = buildCreateMarketRequestBody(draft);
    expect(body.pricing).toEqual({ kind: "fixedOdds", openingPrices: [0, 0] });
  });

  it("parses minStake/maxStake decimal strings to numbers", () => {
    const draft = freshDraft("grp_1");
    draft.minStake = "2.50";
    draft.maxStake = "1000";
    const body = buildCreateMarketRequestBody(draft);
    expect(body.minStake).toBe(2.5);
    expect(body.maxStake).toBe(1000);
  });

  it("passes selectedFriendIds through as inviteeIds verbatim", () => {
    const draft = freshDraft("grp_1");
    draft.selectedFriendIds = ["usr_a", "usr_b"];
    expect(buildCreateMarketRequestBody(draft).inviteeIds).toEqual(["usr_a", "usr_b"]);
  });

  it("parimutuel carries no openingPrices field", () => {
    const draft = freshDraft("grp_1");
    draft.pricingKind = "parimutuel";
    const body = buildCreateMarketRequestBody(draft);
    expect(body.pricing).toEqual({ kind: "parimutuel" });
  });
});
