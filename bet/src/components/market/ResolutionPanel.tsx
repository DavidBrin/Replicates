"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { useToast } from "@/components/ui/Toast";
import { formatCountdown } from "@/domain/formatters";
import { ApiError, postResolve, type ResolveInput } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ResolutionPhase } from "./resolution-view";
import { useTradeRefresh } from "./TradeRefreshProvider";

export interface ResolutionOutcomeOption {
  id: string;
  label: string;
}

export interface ResolutionParticipant {
  userId: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
}

export interface ResolutionPanelClientView {
  phase: ResolutionPhase;
  canPropose: boolean;
  canDispute: boolean;
  canVote: boolean;
  canFinalize: boolean;
  disputeDeadlineIso?: string;
  myVote?: string;
}

export interface ResolutionPanelProps {
  marketId: string;
  outcomes: ResolutionOutcomeOption[];
  participants: ResolutionParticipant[];
  view: ResolutionPanelClientView;
  /** The proposed (pre-finalize) or final winning outcome, once one exists. */
  winningOutcomeId?: string;
  votes?: Record<string, string>;
  now: string;
  className?: string;
}

/**
 * Resolution UI (SPEC §6.4, Task 10's brief): the creator sees "Propose
 * outcome" once the market has closed; during the 12h dispute window
 * everyone sees the proposal, a countdown, and a Dispute button; a disputed
 * market shows the vote and every participant's ballot state. Every state
 * change goes through `POST /resolve` — this component never computes a
 * settlement outcome itself (G3's spirit: display only, server-authoritative).
 */
export function ResolutionPanel({
  marketId,
  outcomes,
  participants,
  view,
  winningOutcomeId,
  votes,
  now,
  className,
}: ResolutionPanelProps) {
  const toast = useToast();
  const { notify } = useTradeRefresh();
  const [selectedOutcomeId, setSelectedOutcomeId] = useState(winningOutcomeId ?? outcomes[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  const outcomeLabel = (id: string | undefined) => outcomes.find((o) => o.id === id)?.label ?? "—";

  async function run(action: "propose" | "dispute" | "vote" | "finalize", outcomeId?: string): Promise<void> {
    setSubmitting(true);
    try {
      const input: ResolveInput =
        action === "propose" || action === "vote" ? { action, outcomeId: outcomeId! } : { action };
      await postResolve(marketId, input);
      toast.show({ title: resolveSuccessTitle(action), variant: "success" });
      notify();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That action couldn't be completed.";
      toast.show({ title: "Couldn't do that", description: message, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (view.phase === "not_closed") {
    return (
      <p className={cn("text-sm text-(--text-2)", className)}>
        Resolution opens once trading closes.
      </p>
    );
  }

  if (view.phase === "resolved") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge tone="accent">Resolved</Badge>
        <p className="text-sm text-(--text-1)">
          Winning outcome: <span className="font-medium">{outcomeLabel(winningOutcomeId)}</span>
        </p>
      </div>
    );
  }

  if (view.phase === "awaiting_proposal") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {view.canPropose ? (
          <>
            <p className="text-sm text-(--text-2)">Trading has closed. Propose the winning outcome.</p>
            <OutcomePicker
              outcomes={outcomes}
              selectedId={selectedOutcomeId}
              onSelect={setSelectedOutcomeId}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={submitting || !selectedOutcomeId}
              loading={submitting}
              onClick={() => void run("propose", selectedOutcomeId)}
              className="self-start"
            >
              Propose outcome
            </Button>
          </>
        ) : (
          <p className="text-sm text-(--text-2)">Waiting for the creator to propose a resolution.</p>
        )}
      </div>
    );
  }

  if (view.phase === "dispute_window") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="flex items-center gap-2">
          <Badge tone="warn">Awaiting finalization</Badge>
          <p className="text-sm text-(--text-1)">
            Proposed: <span className="font-medium">{outcomeLabel(winningOutcomeId)}</span>
          </p>
        </div>
        {view.disputeDeadlineIso ? (
          <p className="tnum text-sm text-(--text-2)">
            Finalizes in{" "}
            <Countdown
              target={new Date(view.disputeDeadlineIso)}
              initialText={formatCountdown(new Date(view.disputeDeadlineIso).getTime() - new Date(now).getTime())}
            />{" "}
            unless disputed.
          </p>
        ) : null}
        <div className="flex gap-2">
          {view.canDispute ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={submitting}
              loading={submitting}
              onClick={() => void run("dispute")}
            >
              Dispute
            </Button>
          ) : null}
          {view.canFinalize ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={submitting}
              loading={submitting}
              onClick={() => void run("finalize")}
            >
              Finalize
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // disputed
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Badge tone="no">Disputed</Badge>
      {view.canVote ? (
        <>
          <p className="text-sm text-(--text-2)">Cast your vote for the winning outcome.</p>
          <OutcomePicker outcomes={outcomes} selectedId={view.myVote ?? selectedOutcomeId} onSelect={setSelectedOutcomeId} />
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={submitting || !selectedOutcomeId}
            loading={submitting}
            onClick={() => void run("vote", selectedOutcomeId)}
            className="self-start"
          >
            {view.myVote ? "Change vote" : "Vote"}
          </Button>
        </>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-(--text-2)">Ballots</p>
        {participants.map((p) => {
          const vote = votes?.[p.userId];
          return (
            <div key={p.userId} className="flex items-center gap-2 text-sm">
              <Avatar initials={p.avatarInitials} color={p.avatarColor} size="xs" />
              <span className="text-(--text-1)">{p.displayName}</span>
              <span className="text-(--text-3)">
                {vote ? `voted ${outcomeLabel(vote)}` : "hasn't voted"}
              </span>
            </div>
          );
        })}
      </div>

      {view.canFinalize ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={submitting}
          loading={submitting}
          onClick={() => void run("finalize")}
          className="self-start"
        >
          Finalize
        </Button>
      ) : null}
    </div>
  );
}

function OutcomePicker({
  outcomes,
  selectedId,
  onSelect,
}: {
  outcomes: ResolutionOutcomeOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Outcome" className="flex flex-wrap gap-2">
      {outcomes.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === selectedId}
          onClick={() => onSelect(o.id)}
          className={cn(
            "rounded-(--radius-input) border px-3 py-1.5 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-2)",
            o.id === selectedId
              ? "border-(--accent) bg-(--accent)/10 text-(--text-1)"
              : "border-(--border) text-(--text-2) hover:border-(--border-2) hover:text-(--text-1)",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function resolveSuccessTitle(action: "propose" | "dispute" | "vote" | "finalize"): string {
  switch (action) {
    case "propose":
      return "Resolution proposed";
    case "dispute":
      return "Dispute opened";
    case "vote":
      return "Vote cast";
    case "finalize":
      return "Market resolved";
  }
}
