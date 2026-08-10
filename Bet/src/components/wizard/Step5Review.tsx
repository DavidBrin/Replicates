"use client";

import { Pencil } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCreditsPrecise } from "@/domain/formatters";
import { fromDecimal } from "@/domain/money";
import type { WizardGroupOption } from "./Step1Question";
import type { WizardFriend } from "./Step4Invite";
import { effectiveOutcomes, PRICING_LABELS, type WizardDraft } from "./types";

export interface Step5ReviewProps {
  draft: WizardDraft;
  groups: WizardGroupOption[];
  knownUsers: Map<string, WizardFriend>;
  onEditStep: (step: number) => void;
  submitting: boolean;
  submitError: string | null;
  onCreate: () => void;
}

function EditLink({ step, onEditStep }: { step: number; onEditStep: (step: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onEditStep(step)}
      className="inline-flex items-center gap-1 rounded-(--radius-input) px-2 py-1 text-xs font-medium text-(--accent) transition-colors hover:bg-(--accent)/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
    >
      <Pencil className="size-3" aria-hidden="true" />
      Edit
    </button>
  );
}

function SectionHeader({
  title,
  step,
  onEditStep,
}: {
  title: string;
  step: number;
  onEditStep: (step: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-(--text-1)">{title}</h3>
      <EditLink step={step} onEditStep={onEditStep} />
    </div>
  );
}

/**
 * Step 5 — read-only review with per-section `Edit` jumps (SPEC §3.4 step
 * 5). Renders directly off `draft` — never a separate data path — so an
 * `Edit` jump back to any prior step, followed by `Next`ing forward again,
 * can never desync from what review shows (David's ambiguity resolution:
 * "each section with an Edit link that jumps back without losing any
 * other step's data").
 */
export function Step5Review({
  draft,
  groups,
  knownUsers,
  onEditStep,
  submitting,
  submitError,
  onCreate,
}: Step5ReviewProps) {
  const group = groups.find((g) => g.id === draft.groupId);
  const outcomes = effectiveOutcomes(draft);
  const closesAtDate = draft.closesAt ? new Date(draft.closesAt) : null;
  const invitees = draft.selectedFriendIds
    .map((id) => knownUsers.get(id))
    .filter((u): u is WizardFriend => !!u);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <SectionHeader title="The question" step={1} onEditStep={onEditStep} />
        {group ? (
          <Badge tone="accent" className="w-fit">
            {group.emoji} {group.name}
          </Badge>
        ) : null}
        <p className="text-base font-medium text-(--text-1)">{draft.question || "—"}</p>
        <div className="flex flex-col gap-1 text-sm text-(--text-2)">
          <p>
            <span className="text-(--text-3)">Resolves:</span> {draft.resolutionCriteria || "—"}
          </p>
          {draft.resolutionSource ? (
            <p>
              <span className="text-(--text-3)">Source:</span> {draft.resolutionSource}
            </p>
          ) : null}
          <p>
            <span className="text-(--text-3)">Closes:</span>{" "}
            {closesAtDate
              ? new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(closesAtDate)
              : "—"}
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionHeader title="Outcomes" step={2} onEditStep={onEditStep} />
        <div className="flex flex-wrap gap-2">
          {outcomes.map((o) => (
            <Badge key={o.id} tone="neutral">
              {o.label || "—"}
            </Badge>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionHeader title="Pricing" step={3} onEditStep={onEditStep} />
        <p className="text-sm text-(--text-1)">{PRICING_LABELS[draft.pricingKind]}</p>
        {draft.pricingKind === "fixedOdds" ? (
          <div className="flex flex-wrap gap-2 text-sm text-(--text-2)">
            {outcomes.map((o) => (
              <span key={o.id}>
                {o.label}: {draft.oddsByOutcomeId[o.id] || "—"}%
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-4 text-sm text-(--text-2)">
          <span>
            Stake range:{" "}
            <span className="font-medium text-(--text-1)">
              {formatCreditsPrecise(fromDecimal(Number(draft.minStake) || 0))}–
              {formatCreditsPrecise(fromDecimal(Number(draft.maxStake) || 0))}
            </span>
          </span>
          <span>
            Stakes visible:{" "}
            <span className="font-medium text-(--text-1)">{draft.stakesVisible ? "Yes" : "No"}</span>
          </span>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionHeader title="Invite players" step={4} onEditStep={onEditStep} />
        {invitees.length === 0 ? (
          <p className="text-sm text-(--text-2)">Just you for now — you can invite people later.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {invitees.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-(--radius-pill) border border-(--border) bg-(--surface-2) py-1 pr-3 pl-1.5 text-sm text-(--text-1)"
              >
                <Avatar initials={u.avatarInitials} color={u.avatarColor} size="xs" />@{u.handle}
              </span>
            ))}
          </div>
        )}
      </Card>

      {submitError ? (
        <p role="alert" className="text-sm text-(--no)">
          {submitError}
        </p>
      ) : null}

      <Button type="button" size="lg" loading={submitting} onClick={onCreate} className="self-start">
        Create bet
      </Button>
    </div>
  );
}
