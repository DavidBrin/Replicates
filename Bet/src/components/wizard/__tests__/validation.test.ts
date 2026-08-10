import { describe, expect, it } from "vitest";
import { buildDefaultDraft, type WizardDraft } from "../types";
import {
  findFirstInvalidStep,
  validateStep1,
  validateStep2,
  validateStep3,
  validateStep4,
} from "../validation";

const NOW = new Date("2026-08-09T12:00:00.000Z");

/** Formats `date` the way `<input type="datetime-local">` would (local wall-
 * clock components, no timezone) — matching what `validateStep1` actually
 * re-parses via `new Date(draft.closesAt)` (which interprets a bare
 * date-time string as LOCAL time). Using `toISOString().slice(0, 16)`
 * instead would silently break on any test runner whose system timezone
 * isn't UTC, since that produces the UTC wall-clock time, not the local
 * one `new Date(...)` would reconstruct. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function futureIso(msFromNow: number): string {
  return toLocalInputValue(new Date(NOW.getTime() + msFromNow));
}

function validDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    ...buildDefaultDraft("grp_1"),
    question: "Will Marcus actually run the 10k?",
    resolutionCriteria: "Resolves YES if Marcus posts a finisher photo.",
    closesAt: futureIso(3 * 86_400_000),
    ...overrides,
  };
}

describe("validateStep1", () => {
  it("passes for a fully valid step 1", () => {
    expect(validateStep1(validDraft(), NOW)).toEqual({});
  });

  it("requires a group", () => {
    const errors = validateStep1(validDraft({ groupId: "" }), NOW);
    expect(errors.groupId).toBeDefined();
  });

  it("requires a non-empty question", () => {
    const errors = validateStep1(validDraft({ question: "   " }), NOW);
    expect(errors.question).toBeDefined();
  });

  it("rejects a question over 140 characters", () => {
    const errors = validateStep1(validDraft({ question: "a".repeat(141) }), NOW);
    expect(errors.question).toBeDefined();
  });

  it("accepts a question at exactly 140 characters", () => {
    const errors = validateStep1(validDraft({ question: "a".repeat(140) }), NOW);
    expect(errors.question).toBeUndefined();
  });

  it("requires resolution criteria", () => {
    const errors = validateStep1(validDraft({ resolutionCriteria: "" }), NOW);
    expect(errors.resolutionCriteria).toBeDefined();
  });

  it("rejects resolution criteria under 20 characters", () => {
    const errors = validateStep1(validDraft({ resolutionCriteria: "too short" }), NOW);
    expect(errors.resolutionCriteria).toBeDefined();
  });

  it("accepts resolution criteria at exactly 20 characters", () => {
    const errors = validateStep1(
      validDraft({ resolutionCriteria: "a".repeat(20) }),
      NOW,
    );
    expect(errors.resolutionCriteria).toBeUndefined();
  });

  it("resolutionSource is optional", () => {
    const errors = validateStep1(validDraft({ resolutionSource: "" }), NOW);
    expect(errors.resolutionSource).toBeUndefined();
  });

  it("rejects a resolutionSource over 200 characters", () => {
    const errors = validateStep1(validDraft({ resolutionSource: "a".repeat(201) }), NOW);
    expect(errors.resolutionSource).toBeDefined();
  });

  it("requires closesAt", () => {
    const errors = validateStep1(validDraft({ closesAt: "" }), NOW);
    expect(errors.closesAt).toBeDefined();
  });

  it("rejects a closesAt in the past", () => {
    const errors = validateStep1(
      validDraft({ closesAt: toLocalInputValue(new Date(NOW.getTime() - 86_400_000)) }),
      NOW,
    );
    expect(errors.closesAt).toBeDefined();
  });

  it("rejects a closesAt exactly equal to now (must be strictly future)", () => {
    const errors = validateStep1(validDraft({ closesAt: toLocalInputValue(NOW) }), NOW);
    expect(errors.closesAt).toBeDefined();
  });

  it("rejects an unparseable closesAt", () => {
    const errors = validateStep1(validDraft({ closesAt: "not-a-date" }), NOW);
    expect(errors.closesAt).toBeDefined();
  });
});

describe("validateStep2", () => {
  it("binary Yes/No is always valid regardless of customOutcomes content", () => {
    const draft = validDraft({ isBinary: true, customOutcomes: [] });
    expect(validateStep2(draft)).toEqual({});
  });

  it("passes for two valid, distinct custom outcomes", () => {
    const draft = validDraft({
      isBinary: false,
      customOutcomes: [
        { id: "a", label: "Marcus" },
        { id: "b", label: "Priya" },
      ],
    });
    expect(validateStep2(draft)).toEqual({});
  });

  it("rejects fewer than 2 custom outcomes", () => {
    const draft = validDraft({
      isBinary: false,
      customOutcomes: [{ id: "a", label: "Only one" }],
    });
    expect(validateStep2(draft).outcomes).toBeDefined();
  });

  it("rejects more than 8 custom outcomes", () => {
    const draft = validDraft({
      isBinary: false,
      customOutcomes: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` })),
    });
    expect(validateStep2(draft).outcomes).toBeDefined();
  });

  it("rejects an empty outcome label", () => {
    const draft = validDraft({
      isBinary: false,
      customOutcomes: [
        { id: "a", label: "" },
        { id: "b", label: "Priya" },
      ],
    });
    expect(validateStep2(draft)["outcome:a"]).toBeDefined();
  });

  it("rejects an outcome label over 40 characters", () => {
    const draft = validDraft({
      isBinary: false,
      customOutcomes: [
        { id: "a", label: "a".repeat(41) },
        { id: "b", label: "Priya" },
      ],
    });
    expect(draft.customOutcomes[0]!.label.length).toBe(41);
    expect(validateStep2(draft)["outcome:a"]).toBeDefined();
  });

  it("rejects duplicate labels (case- and whitespace-insensitive)", () => {
    const draft = validDraft({
      isBinary: false,
      customOutcomes: [
        { id: "a", label: "Marcus" },
        { id: "b", label: " marcus " },
      ],
    });
    expect(validateStep2(draft)["outcome:b"]).toBe("Duplicate outcome.");
  });
});

describe("validateStep3", () => {
  it("passes for the untouched defaults (skippable step)", () => {
    expect(validateStep3(validDraft())).toEqual({});
  });

  it("rejects a non-positive minStake", () => {
    expect(validateStep3(validDraft({ minStake: "0" })).minStake).toBeDefined();
    expect(validateStep3(validDraft({ minStake: "-5" })).minStake).toBeDefined();
    expect(validateStep3(validDraft({ minStake: "" })).minStake).toBeDefined();
    expect(validateStep3(validDraft({ minStake: "abc" })).minStake).toBeDefined();
  });

  it("rejects a non-positive maxStake", () => {
    expect(validateStep3(validDraft({ maxStake: "0" })).maxStake).toBeDefined();
  });

  it("rejects maxStake below minStake", () => {
    const errors = validateStep3(validDraft({ minStake: "100", maxStake: "50" }));
    expect(errors.maxStake).toBeDefined();
  });

  it("accepts minStake === maxStake", () => {
    const errors = validateStep3(validDraft({ minStake: "50", maxStake: "50" }));
    expect(errors.maxStake).toBeUndefined();
  });

  it("fixedOdds: requires every outcome to have an opening probability", () => {
    const draft = validDraft({
      pricingKind: "fixedOdds",
      oddsByOutcomeId: { yes: "60" }, // "no" missing
    });
    const errors = validateStep3(draft);
    expect(errors["odds:no"]).toBeDefined();
  });

  it("fixedOdds: rejects probabilities that don't sum to 100", () => {
    const draft = validDraft({
      pricingKind: "fixedOdds",
      oddsByOutcomeId: { yes: "60", no: "30" },
    });
    const errors = validateStep3(draft);
    expect(errors.odds).toContain("90%");
  });

  it("fixedOdds: passes when probabilities sum to exactly 100", () => {
    const draft = validDraft({
      pricingKind: "fixedOdds",
      oddsByOutcomeId: { yes: "60", no: "40" },
    });
    expect(validateStep3(draft)).toEqual({});
  });

  it("fixedOdds: rejects a probability of 0 or >= 100", () => {
    const draft = validDraft({
      pricingKind: "fixedOdds",
      oddsByOutcomeId: { yes: "0", no: "100" },
    });
    const errors = validateStep3(draft);
    expect(errors["odds:yes"]).toBeDefined();
    expect(errors["odds:no"]).toBeDefined();
  });

  it("lmsr/parimutuel never validate odds, even if oddsByOutcomeId is garbage", () => {
    const draft = validDraft({ pricingKind: "lmsr", oddsByOutcomeId: { yes: "not-a-number" } });
    expect(validateStep3(draft)).toEqual({});
  });
});

describe("validateStep4", () => {
  it("is always valid — zero invitees is allowed", () => {
    expect(validateStep4()).toEqual({});
  });
});

describe("findFirstInvalidStep", () => {
  it("returns null when every step is valid", () => {
    expect(findFirstInvalidStep(validDraft(), NOW)).toBeNull();
  });

  it("returns step 1 when step 1 is invalid, even if later steps are also invalid", () => {
    const draft = validDraft({
      question: "",
      isBinary: false,
      customOutcomes: [{ id: "a", label: "Only one" }],
    });
    const result = findFirstInvalidStep(draft, NOW);
    expect(result?.step).toBe(1);
  });

  it("returns step 3 when only pricing is invalid", () => {
    const draft = validDraft({ minStake: "100", maxStake: "10" });
    const result = findFirstInvalidStep(draft, NOW);
    expect(result?.step).toBe(3);
    expect(result?.errors.maxStake).toBeDefined();
  });
});
