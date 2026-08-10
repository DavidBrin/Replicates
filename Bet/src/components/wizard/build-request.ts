/**
 * Maps a `WizardDraft` to `POST /api/markets`'s request body (task-7-
 * report.md's documented shape). Kept as one pure, independently-testable
 * function rather than inlined into the submit handler, since the mapping
 * has real edge cases worth pinning down (percent-to-fraction conversion
 * for fixed odds, decimal-string-to-number stake parsing, an empty
 * `resolutionSource` becoming `undefined` rather than `""` so the route's
 * Zod schema's `.optional()` — not `.max(200)` on an empty string, which
 * would also pass, but the two aren't equivalent once trimming is
 * involved — sees the field the way the wizard means it).
 */

import { effectiveOutcomes, type WizardDraft } from "./types";

export interface CreateMarketRequestPricing {
  kind: "lmsr" | "fixedOdds" | "parimutuel";
  openingPrices?: number[];
}

export interface CreateMarketRequestBody {
  groupId: string;
  question: string;
  resolutionCriteria: string;
  resolutionSource?: string;
  /** ISO 8601. */
  closesAt: string;
  outcomes: Array<{ label: string }>;
  pricing: CreateMarketRequestPricing;
  minStake: number;
  maxStake: number;
  stakesVisible: boolean;
  inviteeIds: string[];
}

export function buildCreateMarketRequestBody(draft: WizardDraft): CreateMarketRequestBody {
  const outcomes = effectiveOutcomes(draft);

  const pricing: CreateMarketRequestPricing =
    draft.pricingKind === "fixedOdds"
      ? {
          kind: "fixedOdds",
          // The route matches `openingPrices[]` to `outcomes[]` POSITIONALLY
          // (task-7-report.md: "the client can't key by outcome id yet,
          // since outcomes are created in this same request") — `outcomes`
          // here is already the same array, in the same order, that
          // populates `outcomes:` below, so the positions line up.
          openingPrices: outcomes.map((o) => (Number(draft.oddsByOutcomeId[o.id]) || 0) / 100),
        }
      : { kind: draft.pricingKind };

  const resolutionSource = draft.resolutionSource.trim();

  return {
    groupId: draft.groupId,
    question: draft.question.trim(),
    resolutionCriteria: draft.resolutionCriteria.trim(),
    resolutionSource: resolutionSource.length > 0 ? resolutionSource : undefined,
    closesAt: new Date(draft.closesAt).toISOString(),
    outcomes: outcomes.map((o) => ({ label: o.label.trim() })),
    pricing,
    minStake: Number(draft.minStake),
    maxStake: Number(draft.maxStake),
    stakesVisible: draft.stakesVisible,
    inviteeIds: draft.selectedFriendIds,
  };
}
