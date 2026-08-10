/**
 * Per-step validation for the create-bet wizard. Every function here is
 * pure and takes any time-dependent input (`now`) explicitly — same house
 * style as `src/domain/formatters.ts` — so these are unit-testable without
 * mocking `Date.now()` and so the wizard component itself stays the only
 * thing that decides *when* to run/display them (on "Next", live per
 * keystroke thereafter, and defensively again right before submit).
 *
 * Each `validateStepN` returns a `FieldErrors` map keyed by a field name
 * the corresponding step component knows how to render inline, next to the
 * offending control — per David's ambiguity resolution, this app never
 * shows a bulk end-of-form error dump.
 */

import {
  effectiveOutcomes,
  MAX_OUTCOMES,
  MIN_OUTCOMES,
  type WizardDraft,
} from "./types";

export type FieldErrors = Record<string, string>;

export const QUESTION_MAX_LENGTH = 140;
export const RESOLUTION_CRITERIA_MIN_LENGTH = 20;
export const RESOLUTION_SOURCE_MAX_LENGTH = 200;
export const OUTCOME_LABEL_MAX_LENGTH = 40;

function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Step 1 — question, resolution criteria, close date (+ the wizard's own
 * required group selection, see `types.ts`'s doc comment on `groupId`). */
export function validateStep1(draft: WizardDraft, now: Date): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.groupId) {
    errors.groupId = "Choose a group to post this bet in.";
  }

  const question = draft.question.trim();
  if (question.length === 0) {
    errors.question = "Question is required.";
  } else if (draft.question.length > QUESTION_MAX_LENGTH) {
    errors.question = `Keep it under ${QUESTION_MAX_LENGTH} characters.`;
  }

  const criteria = draft.resolutionCriteria.trim();
  if (criteria.length === 0) {
    errors.resolutionCriteria = "Explain how this bet will be judged.";
  } else if (criteria.length < RESOLUTION_CRITERIA_MIN_LENGTH) {
    errors.resolutionCriteria = `Give a bit more detail (at least ${RESOLUTION_CRITERIA_MIN_LENGTH} characters).`;
  }

  if (draft.resolutionSource.length > RESOLUTION_SOURCE_MAX_LENGTH) {
    errors.resolutionSource = `Keep it under ${RESOLUTION_SOURCE_MAX_LENGTH} characters.`;
  }

  if (draft.closesAt.trim().length === 0) {
    errors.closesAt = "Pick when this bet closes.";
  } else {
    const parsed = new Date(draft.closesAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.closesAt = "That doesn't look like a valid date.";
    } else if (parsed.getTime() <= now.getTime()) {
      errors.closesAt = "Must be in the future.";
    }
  }

  return errors;
}

/** Step 2 — outcomes. Binary Yes/No is always valid (it's the one-click
 * default); custom outcomes need 2–8 non-empty, non-duplicate, ≤40-char
 * labels. */
export function validateStep2(draft: WizardDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.isBinary) return errors;

  const outcomes = draft.customOutcomes;
  if (outcomes.length < MIN_OUTCOMES) {
    errors.outcomes = `Add at least ${MIN_OUTCOMES} outcomes.`;
  } else if (outcomes.length > MAX_OUTCOMES) {
    errors.outcomes = `Up to ${MAX_OUTCOMES} outcomes.`;
  }

  const seenLabels = new Set<string>();
  for (const outcome of outcomes) {
    const label = outcome.label.trim();
    const fieldKey = `outcome:${outcome.id}`;
    if (label.length === 0) {
      errors[fieldKey] = "Required.";
      continue;
    }
    if (label.length > OUTCOME_LABEL_MAX_LENGTH) {
      errors[fieldKey] = `Keep it under ${OUTCOME_LABEL_MAX_LENGTH} characters.`;
      continue;
    }
    const key = label.toLowerCase();
    if (seenLabels.has(key)) {
      errors[fieldKey] = "Duplicate outcome.";
      continue;
    }
    seenLabels.add(key);
  }

  return errors;
}

/** Step 3 — pricing kind, per-outcome opening odds (fixed-odds only), and
 * stake limits. Every field has a sensible default, so an untouched step 3
 * always validates clean (SPEC: "the step is skippable by pressing
 * Next"). */
export function validateStep3(draft: WizardDraft): FieldErrors {
  const errors: FieldErrors = {};

  const min = Number(draft.minStake);
  const max = Number(draft.maxStake);
  const minValid = draft.minStake.trim().length > 0 && Number.isFinite(min) && min > 0;
  const maxValid = draft.maxStake.trim().length > 0 && Number.isFinite(max) && max > 0;

  if (!minValid) errors.minStake = "Enter a positive amount.";
  if (!maxValid) errors.maxStake = "Enter a positive amount.";
  if (minValid && maxValid && min > max) {
    errors.maxStake = "Must be at least the minimum stake.";
  }

  if (draft.pricingKind === "fixedOdds") {
    const outcomes = effectiveOutcomes(draft);
    let sum = 0;
    let anyOutcomeInvalid = false;

    for (const outcome of outcomes) {
      const raw = draft.oddsByOutcomeId[outcome.id] ?? "";
      const value = Number(raw);
      const fieldKey = `odds:${outcome.id}`;
      if (raw.trim().length === 0 || !Number.isFinite(value) || value <= 0 || value >= 100) {
        errors[fieldKey] = "Enter a percent between 1 and 99.";
        anyOutcomeInvalid = true;
        continue;
      }
      sum += value;
    }

    if (!anyOutcomeInvalid && Math.round(sum) !== 100) {
      errors.odds = `Probabilities must add up to 100% (currently ${Math.round(sum)}%).`;
    }
  }

  return errors;
}

/** Step 4 — invite players. SPEC explicitly allows zero invitees ("just me
 * for now") — nothing here is ever required. */
export function validateStep4(): FieldErrors {
  return {};
}

export type StepNumber = 1 | 2 | 3 | 4;

/** Runs every step's validator in order and returns the first step (1–4)
 * that fails, along with its errors — used right before the final submit
 * (step 5's "Create bet") as a defensive re-check, and to decide which
 * step to jump the user back to if something regressed since they last
 * passed it. Returns `null` if all four steps are clean. */
export function findFirstInvalidStep(
  draft: WizardDraft,
  now: Date,
): { step: StepNumber; errors: FieldErrors } | null {
  const byStep: Array<{ step: StepNumber; errors: FieldErrors }> = [
    { step: 1, errors: validateStep1(draft, now) },
    { step: 2, errors: validateStep2(draft) },
    { step: 3, errors: validateStep3(draft) },
    { step: 4, errors: validateStep4() },
  ];
  return byStep.find((entry) => hasErrors(entry.errors)) ?? null;
}
