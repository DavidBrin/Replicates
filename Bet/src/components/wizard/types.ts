/**
 * The create-bet wizard's draft shape (SPEC §3.4, docs/plan.md Task 11).
 * Plain, JSON-serializable data — this is exactly what
 * `src/lib/draft-storage.ts` persists to `localStorage` on every change,
 * so every field here must survive a `JSON.stringify`/`JSON.parse` round
 * trip untouched (no `Date`, no branded ids, no class instances).
 *
 * Deliberately one flat object rather than one slice per step (mirrors
 * research/social-and-invites.md §4.2's `market_drafts.step_data` JSONB
 * blob decision: draft data is disposable and schema-fluid, and review
 * (step 5) is just rendering this same object, never a separate data
 * path — "Edit" links jump `currentStep` back without touching anything
 * else in here).
 */

export type PricingKind = "lmsr" | "fixedOdds" | "parimutuel";

export interface WizardOutcomeDraft {
  /** Client-local id, stable across reorders/renames within one editing
   * session — NOT a server `OutcomeId` (outcomes don't exist server-side
   * until submit mints them). Used only for list keys, reorder, and as the
   * key into `oddsByOutcomeId`. */
  id: string;
  label: string;
}

/** The wizard's own draft-schema version. Bumped if a future change to
 * this shape needs a migration; `loadWizardDraft` below drops (rather than
 * crashes on) a draft from an older version, since draft data is disposable
 * by design. */
export const WIZARD_DRAFT_VERSION = 1;

export interface WizardDraft {
  version: typeof WIZARD_DRAFT_VERSION;

  // Step 1 — question, resolution criteria, close date. `groupId` isn't
  // one of SPEC §3.4's enumerated step-1 fields, but every market belongs
  // to a group (`POST /api/markets` requires it) and the wizard has no
  // other step that could own picking one — see the Task 11 report's
  // "Deviations" for the full reasoning.
  groupId: string;
  question: string;
  resolutionCriteria: string;
  resolutionSource: string;
  /** `<input type="datetime-local">`'s native value format
   * (`"YYYY-MM-DDTHH:mm"`), kept as the raw string rather than an ISO
   * `Date` — JSON round-trips a `Date` as a string anyway, and keeping the
   * exact local-input format avoids a lossy re-parse/re-format cycle on
   * every restore. */
  closesAt: string;

  // Step 2 — outcomes. Binary Yes/No is represented implicitly (see
  // `BINARY_OUTCOMES`) rather than duplicated into `customOutcomes`, so
  // toggling "this isn't yes/no" on and off never loses whatever the user
  // had already typed into the custom list.
  isBinary: boolean;
  customOutcomes: WizardOutcomeDraft[];

  // Step 3 — pricing + stake limits.
  pricingKind: PricingKind;
  /** Only meaningful when `pricingKind === "fixedOdds"`. Keyed by
   * `WizardOutcomeDraft.id`. Values are raw percent strings (e.g. `"50"`)
   * so a field can be legitimately empty mid-edit without coercing to
   * `0` and silently passing validation. */
  oddsByOutcomeId: Record<string, string>;
  /** Decimal-credits strings (e.g. `"1"`, `"500"`), matching what
   * `POST /api/markets` expects before the route's own
   * `money.fromDecimal` conversion. */
  minStake: string;
  maxStake: string;
  stakesVisible: boolean;

  // Step 4 — invite players.
  selectedFriendIds: string[];
}

/** The always-available binary shape (SPEC §3.4 step 2: "Binary Yes/No by
 * default — one click"). Fixed ids so `oddsByOutcomeId` stays stable across
 * renders without regenerating ids for the common case every time. */
export const BINARY_OUTCOMES: readonly WizardOutcomeDraft[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

export const MIN_OUTCOMES = 2;
export const MAX_OUTCOMES = 8;

/** The outcome list actually in effect for pricing/invite/review — binary
 * markets always resolve to `BINARY_OUTCOMES` regardless of whatever is
 * sitting in `customOutcomes` from a previous toggle. */
export function effectiveOutcomes(draft: WizardDraft): readonly WizardOutcomeDraft[] {
  return draft.isBinary ? BINARY_OUTCOMES : draft.customOutcomes;
}

let outcomeIdCounter = 0;

/** A short, collision-safe-enough (per tab, per page load) id for a new
 * custom-outcome row. Doesn't need cryptographic uniqueness — it only ever
 * has to be unique within one in-progress draft. */
export function makeOutcomeId(): string {
  outcomeIdCounter += 1;
  return `out-${Date.now().toString(36)}-${outcomeIdCounter.toString(36)}`;
}

export function buildDefaultDraft(groupId: string): WizardDraft {
  return {
    version: WIZARD_DRAFT_VERSION,
    groupId,
    question: "",
    resolutionCriteria: "",
    resolutionSource: "",
    closesAt: "",
    isBinary: true,
    customOutcomes: [
      { id: makeOutcomeId(), label: "" },
      { id: makeOutcomeId(), label: "" },
    ],
    pricingKind: "lmsr",
    oddsByOutcomeId: {},
    minStake: "1",
    maxStake: "500",
    stakesVisible: true,
    selectedFriendIds: [],
  };
}

/** Type guard for a value loaded back out of `localStorage`: accepts it
 * only if it's the current version and has the shape this module expects.
 * Deliberately loose (doesn't re-validate field CONTENT, e.g. string
 * lengths — that's `validation.ts`'s job, re-run every time the wizard
 * renders a step) — this only guards against a draft from an incompatible
 * future/past version, or plain garbage, being spread into wizard state. */
export function isWizardDraft(value: unknown): value is WizardDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === WIZARD_DRAFT_VERSION &&
    typeof v.groupId === "string" &&
    typeof v.question === "string" &&
    typeof v.resolutionCriteria === "string" &&
    typeof v.resolutionSource === "string" &&
    typeof v.closesAt === "string" &&
    typeof v.isBinary === "boolean" &&
    Array.isArray(v.customOutcomes) &&
    typeof v.pricingKind === "string" &&
    typeof v.oddsByOutcomeId === "object" &&
    v.oddsByOutcomeId !== null &&
    typeof v.minStake === "string" &&
    typeof v.maxStake === "string" &&
    typeof v.stakesVisible === "boolean" &&
    Array.isArray(v.selectedFriendIds)
  );
}

export const STEP_COUNT = 5;

export const STEP_LABELS: readonly string[] = [
  "Question",
  "Outcomes",
  "Pricing",
  "Invite",
  "Review",
];

export const PRICING_LABELS: Record<PricingKind, string> = {
  lmsr: "Market-priced",
  fixedOdds: "Set your own odds",
  parimutuel: "Pool",
};
