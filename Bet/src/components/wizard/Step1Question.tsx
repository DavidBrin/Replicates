"use client";

import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { errorId, FormField } from "./FormField";
import { inAWeekPreset, thisWeekendPreset, toDatetimeLocalValue, tonightPreset } from "./date-presets";
import { QUESTION_MAX_LENGTH, RESOLUTION_CRITERIA_MIN_LENGTH, type FieldErrors } from "./validation";
import type { WizardDraft } from "./types";

export interface WizardGroupOption {
  id: string;
  slug: string;
  name: string;
  emoji: string;
}

export interface Step1QuestionProps {
  draft: WizardDraft;
  errors: FieldErrors;
  groups: WizardGroupOption[];
  onChange: (patch: Partial<WizardDraft>) => void;
}

const RESOLUTION_PLACEHOLDER =
  'Resolves YES if Marcus posts a finisher photo or an official race-timing result ' +
  "showing he completed the 10k. Resolves NO if he doesn't start, drops out, or Saturday " +
  "passes with no proof either way.";

/**
 * Step 1 — question, resolution criteria, close date (SPEC §3.4 step 1).
 * Also owns the "which group does this post to" selector — not one of
 * SPEC's enumerated step-1 fields, but every market requires a `groupId`
 * (`POST /api/markets`) and no other step has a natural home for it; see
 * the Task 11 report's "Deviations" section.
 */
export function Step1Question({ draft, errors, groups, onChange }: Step1QuestionProps) {
  const now = new Date();
  const questionLength = draft.question.length;
  const overQuestionLimit = questionLength > QUESTION_MAX_LENGTH;
  const criteriaLength = draft.resolutionCriteria.trim().length;

  function applyPreset(date: Date) {
    onChange({ closesAt: toDatetimeLocalValue(date) });
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.length > 1 ? (
        <FormField htmlFor="wizard-group" label="Posting to" error={errors.groupId}>
          <Select
            id="wizard-group"
            invalid={!!errors.groupId}
            aria-describedby={errors.groupId ? errorId("wizard-group") : undefined}
            value={draft.groupId}
            onChange={(e) => onChange({ groupId: e.target.value })}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.emoji} {g.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : groups.length === 1 ? (
        <p className="text-sm text-(--text-2)">
          Posting to{" "}
          <span className="font-medium text-(--text-1)">
            {groups[0]!.emoji} {groups[0]!.name}
          </span>
        </p>
      ) : null}

      <FormField
        htmlFor="wizard-question"
        label="Question"
        labelSuffix={
          <span className={cn(overQuestionLimit && "text-(--no)")}>
            {questionLength}/{QUESTION_MAX_LENGTH}
          </span>
        }
        error={errors.question}
      >
        <Input
          id="wizard-question"
          value={draft.question}
          onChange={(e) => onChange({ question: e.target.value })}
          placeholder="Will Marcus actually run the 10k on Saturday?"
          invalid={!!errors.question}
          aria-describedby={errors.question ? errorId("wizard-question") : undefined}
          autoFocus
        />
      </FormField>

      <FormField
        htmlFor="wizard-criteria"
        label="Resolution criteria"
        labelSuffix={`${criteriaLength} chars (min ${RESOLUTION_CRITERIA_MIN_LENGTH})`}
        hint="Be specific enough that nobody could argue about it later."
        error={errors.resolutionCriteria}
      >
        <Textarea
          id="wizard-criteria"
          rows={4}
          value={draft.resolutionCriteria}
          onChange={(e) => onChange({ resolutionCriteria: e.target.value })}
          placeholder={RESOLUTION_PLACEHOLDER}
          invalid={!!errors.resolutionCriteria}
          aria-describedby={errors.resolutionCriteria ? errorId("wizard-criteria") : undefined}
        />
      </FormField>

      <FormField
        htmlFor="wizard-source"
        label="Resolution source"
        labelSuffix="optional"
        error={errors.resolutionSource}
      >
        <Input
          id="wizard-source"
          value={draft.resolutionSource}
          onChange={(e) => onChange({ resolutionSource: e.target.value })}
          placeholder="e.g. ESPN box score, official race results page"
          invalid={!!errors.resolutionSource}
          aria-describedby={errors.resolutionSource ? errorId("wizard-source") : undefined}
        />
      </FormField>

      <FormField htmlFor="wizard-closes-at" label="Closes" error={errors.closesAt}>
        <div className="flex flex-col gap-2">
          <Input
            id="wizard-closes-at"
            type="datetime-local"
            value={draft.closesAt}
            onChange={(e) => onChange({ closesAt: e.target.value })}
            invalid={!!errors.closesAt}
            aria-describedby={errors.closesAt ? errorId("wizard-closes-at") : undefined}
            className="w-fit"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset(tonightPreset(now))}>
              Tonight
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset(thisWeekendPreset(now))}
            >
              This weekend
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset(inAWeekPreset(now))}>
              In a week
            </Button>
          </div>
        </div>
      </FormField>
    </div>
  );
}
