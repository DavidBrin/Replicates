"use client";

import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { errorId, FormField } from "./FormField";
import { Switch } from "./Switch";
import { effectiveOutcomes, PRICING_LABELS, type PricingKind, type WizardDraft } from "./types";
import type { FieldErrors } from "./validation";

export interface Step3PricingProps {
  draft: WizardDraft;
  errors: FieldErrors;
  onChange: (patch: Partial<WizardDraft>) => void;
}

const PRICING_CARDS: Array<{ kind: PricingKind; description: string }> = [
  {
    kind: "lmsr",
    description:
      "Prices move automatically as people trade — just like a real prediction market. The default, and a good fit for most bets.",
  },
  {
    kind: "fixedOdds",
    description:
      "You set the starting probability for each outcome; your friends trade against those odds.",
  },
  {
    kind: "parimutuel",
    description: "Everyone stakes credits on their pick — when it resolves, winners split the pot.",
  },
];

function oddsSum(draft: WizardDraft): number {
  return effectiveOutcomes(draft).reduce((sum, o) => {
    const v = Number(draft.oddsByOutcomeId[o.id]);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * Step 3 — pricing kind + stake limits (SPEC §3.4 step 3, §6.2). Three
 * plain-language cards; the mechanism behind "Market-priced" is explained
 * honestly in the "How pricing works" disclosure below without ever
 * naming it in the UI (David's ambiguity resolution: no "LMSR" anywhere a
 * user sees). Every field has a default, so this step is skippable.
 */
export function Step3Pricing({ draft, errors, onChange }: Step3PricingProps) {
  const outcomes = effectiveOutcomes(draft);
  const sum = oddsSum(draft);

  function setOdds(outcomeId: string, value: string) {
    onChange({ oddsByOutcomeId: { ...draft.oddsByOutcomeId, [outcomeId]: value } });
  }

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Pricing" className="grid gap-3 sm:grid-cols-3">
        {PRICING_CARDS.map(({ kind, description }) => {
          const selected = draft.pricingKind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ pricingKind: kind })}
              className={cn(
                "flex flex-col gap-1.5 rounded-(--radius-card) border p-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
                selected
                  ? "border-(--accent) bg-(--accent)/10"
                  : "border-(--border) bg-(--surface-2) hover:border-(--border-2)",
              )}
            >
              <span className="text-sm font-semibold text-(--text-1)">{PRICING_LABELS[kind]}</span>
              <span className="text-xs text-(--text-2)">{description}</span>
            </button>
          );
        })}
      </div>

      <details className="rounded-(--radius-card) border border-(--border) bg-(--surface-2) px-4 py-3 text-sm text-(--text-2)">
        <summary className="cursor-pointer font-medium text-(--text-1)">How pricing works</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p>
            <strong className="text-(--text-1)">Market-priced</strong> bets use an automated market
            maker: the price of each outcome is a live readout of how much has been bought on each
            side, and it shifts a little with every trade — the same way Kalshi or Polymarket&apos;s
            markets move. The bet starts with a set amount of built-in liquidity (sized to your
            group), which caps how much the operator (your group&apos;s pot) can ever lose on it.
          </p>
          <p>
            <strong className="text-(--text-1)">Set your own odds</strong> skips the automated
            pricing entirely — your opening probabilities become the fixed price everyone trades at.
          </p>
          <p>
            <strong className="text-(--text-1)">Pool</strong> bets don&apos;t have a &ldquo;price&rdquo;
            at all — everyone&apos;s stake goes into one pot per outcome, and it&apos;s split
            pro-rata among whoever picked the winning side.
          </p>
        </div>
      </details>

      {draft.pricingKind === "fixedOdds" ? (
        <div className="flex flex-col gap-3 rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-(--text-1)">Opening odds</span>
            <span className={cn("text-xs tabular-nums", Math.round(sum) === 100 ? "text-(--text-3)" : "text-(--no)")}>
              {Math.round(sum)}% total
            </span>
          </div>
          {errors.odds ? (
            <p role="alert" className="text-xs text-(--no)">
              {errors.odds}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {outcomes.map((outcome) => {
              const fieldId = `wizard-odds-${outcome.id}`;
              const error = errors[`odds:${outcome.id}`];
              return (
                <FormField key={outcome.id} htmlFor={fieldId} label={outcome.label || "Outcome"} error={error}>
                  <div className="relative w-32">
                    <Input
                      id={fieldId}
                      type="number"
                      min={1}
                      max={99}
                      inputMode="numeric"
                      value={draft.oddsByOutcomeId[outcome.id] ?? ""}
                      onChange={(e) => setOdds(outcome.id, e.target.value)}
                      invalid={!!error}
                      aria-describedby={error ? errorId(fieldId) : undefined}
                      className="pr-7"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-(--text-3)">
                      %
                    </span>
                  </div>
                </FormField>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="wizard-min-stake" label="Minimum stake" error={errors.minStake}>
          <Input
            id="wizard-min-stake"
            type="number"
            min={0}
            step="0.01"
            value={draft.minStake}
            onChange={(e) => onChange({ minStake: e.target.value })}
            invalid={!!errors.minStake}
            aria-describedby={errors.minStake ? errorId("wizard-min-stake") : undefined}
          />
        </FormField>
        <FormField htmlFor="wizard-max-stake" label="Maximum stake" error={errors.maxStake}>
          <Input
            id="wizard-max-stake"
            type="number"
            min={0}
            step="0.01"
            value={draft.maxStake}
            onChange={(e) => onChange({ maxStake: e.target.value })}
            invalid={!!errors.maxStake}
            aria-describedby={errors.maxStake ? errorId("wizard-max-stake") : undefined}
          />
        </FormField>
      </div>

      <Switch
        id="wizard-stakes-visible"
        checked={draft.stakesVisible}
        onChange={(checked) => onChange({ stakesVisible: checked })}
        label="Show everyone's stake size"
        description="Off shows who holds which side, but not how much they staked."
      />
    </div>
  );
}
