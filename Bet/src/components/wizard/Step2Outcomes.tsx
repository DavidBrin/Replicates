"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { errorId, FormField } from "./FormField";
import { Switch } from "./Switch";
import { MAX_OUTCOMES, MIN_OUTCOMES, makeOutcomeId, type WizardDraft } from "./types";
import { OUTCOME_LABEL_MAX_LENGTH, type FieldErrors } from "./validation";

export interface Step2OutcomesProps {
  draft: WizardDraft;
  errors: FieldErrors;
  onChange: (patch: Partial<WizardDraft>) => void;
}

/**
 * Step 2 — outcomes (SPEC §3.4 step 2). Binary Yes/No is the default and a
 * single click; "this isn't yes/no" reveals a 2–8 outcome list editor with
 * add/remove/reorder, matching research §4.2's progressive-disclosure
 * pattern.
 */
export function Step2Outcomes({ draft, errors, onChange }: Step2OutcomesProps) {
  const outcomes = draft.customOutcomes;

  function updateOutcomes(next: typeof outcomes) {
    onChange({ customOutcomes: next });
  }

  function setLabel(id: string, label: string) {
    updateOutcomes(outcomes.map((o) => (o.id === id ? { ...o, label } : o)));
  }

  function addOutcome() {
    if (outcomes.length >= MAX_OUTCOMES) return;
    updateOutcomes([...outcomes, { id: makeOutcomeId(), label: "" }]);
  }

  function removeOutcome(id: string) {
    if (outcomes.length <= MIN_OUTCOMES) return;
    updateOutcomes(outcomes.filter((o) => o.id !== id));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= outcomes.length) return;
    const next = [...outcomes];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    updateOutcomes(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <Switch
        id="wizard-custom-outcomes"
        checked={!draft.isBinary}
        onChange={(checked) => onChange({ isBinary: !checked })}
        label="This isn't yes/no"
        description="Turn on for a multiple-choice bet (2–8 options) — e.g. “who wins the fantasy league”."
      />

      {draft.isBinary ? (
        <div className="flex items-center gap-2 rounded-(--radius-card) border border-(--border) bg-(--surface-2) px-4 py-4">
          <Pill value={0.5} tone="yes" />
          <span className="text-sm font-medium text-(--text-1)">Yes</span>
          <span className="mx-2 text-(--text-3)">/</span>
          <Pill value={0.5} tone="no" />
          <span className="text-sm font-medium text-(--text-1)">No</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {errors.outcomes ? (
            <p role="alert" className="text-xs text-(--no)">
              {errors.outcomes}
            </p>
          ) : null}
          {outcomes.map((outcome, index) => {
            const fieldId = `wizard-outcome-${outcome.id}`;
            const error = errors[`outcome:${outcome.id}`];
            return (
              <div key={outcome.id} className="flex items-start gap-2">
                <div className="flex flex-col gap-1 pt-2">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${outcome.label || "outcome"} up`}
                    className="rounded-(--radius-input) p-0.5 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === outcomes.length - 1}
                    aria-label={`Move ${outcome.label || "outcome"} down`}
                    className="rounded-(--radius-input) p-0.5 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </button>
                </div>

                <FormField
                  htmlFor={fieldId}
                  label={`Outcome ${index + 1}`}
                  className="flex-1"
                  error={error}
                >
                  <Input
                    id={fieldId}
                    value={outcome.label}
                    onChange={(e) => setLabel(outcome.id, e.target.value)}
                    placeholder="e.g. Marcus"
                    maxLength={OUTCOME_LABEL_MAX_LENGTH}
                    invalid={!!error}
                    aria-describedby={error ? errorId(fieldId) : undefined}
                  />
                </FormField>

                <button
                  type="button"
                  onClick={() => removeOutcome(outcome.id)}
                  disabled={outcomes.length <= MIN_OUTCOMES}
                  aria-label={`Remove ${outcome.label || `outcome ${index + 1}`}`}
                  className={cn(
                    "mt-7 shrink-0 rounded-(--radius-input) p-1.5 text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--no)",
                    "disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                  )}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addOutcome}
            disabled={outcomes.length >= MAX_OUTCOMES}
            className="self-start"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add outcome
          </Button>
        </div>
      )}
    </div>
  );
}
