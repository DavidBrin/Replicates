/**
 * Pure derivation of "what should the resolution UI show/allow" (SPEC §6.4,
 * §3.3's "Resolution" paragraph, Task 10's brief) from a market's status +
 * resolution record + the viewer's relationship to it. Factored out of
 * `ResolutionPanel.tsx` so the phase/permission logic — which every status
 * combination touches — is unit-testable without mounting React or hitting
 * the network. The actual state changes always go through
 * `POST /api/markets/[id]/resolve` (`@/lib/api-client`'s `postResolve`),
 * which re-derives and enforces the real rules server-side (G3's spirit:
 * this view is for what the UI OFFERS, never authoritative on its own).
 */

export type ResolutionPhase =
  | "not_closed"
  | "awaiting_proposal"
  | "dispute_window"
  | "disputed"
  | "resolved";

export interface ResolutionViewResolution {
  winningOutcomeId: string;
  proposedBy: string;
  proposedAt: string;
  finalizesAt: string;
  disputedBy?: string;
  disputedAt?: string;
  votes?: Record<string, string>;
  resolvedAt?: string;
}

export interface ResolutionViewInput {
  /** The market's EFFECTIVE status (i.e. already passed through
   * `nextStatusForClock` by the caller) — `"open"` here means "still
   * genuinely tradable," not just "the stored field says open." */
  status: "open" | "closed" | "resolving" | "disputed" | "resolved" | "cancelled";
  resolution?: ResolutionViewResolution;
  creatorId: string;
  /** `null` for a signed-out viewer (never reachable in practice — the
   * route redirects to `/signin` — but kept total rather than partial). */
  viewerId: string | null;
  isParticipant: boolean;
  now: Date;
}

export interface ResolutionView {
  phase: ResolutionPhase;
  isCreator: boolean;
  /** Creator, or a participant — SPEC §6.4: "Any participant may dispute,"
   * "quorum vote of position holders." The creator is treated as eligible
   * to dispute/vote/finalize too, matching `resolution.ts`'s
   * `requireParticipantOrCreator`. */
  isEligible: boolean;
  canPropose: boolean;
  canDispute: boolean;
  canVote: boolean;
  canFinalize: boolean;
  /** The 12h dispute-window deadline, present only during `dispute_window`. */
  disputeDeadline?: Date;
  /** The viewer's own cast ballot, present only during `disputed`. */
  myVote?: string;
}

export function deriveResolutionView(input: ResolutionViewInput): ResolutionView {
  const { status, resolution, creatorId, viewerId, isParticipant, now } = input;
  const isCreator = viewerId !== null && viewerId === creatorId;
  const isEligible = isCreator || isParticipant;

  const base: ResolutionView = {
    phase: "not_closed",
    isCreator,
    isEligible,
    canPropose: false,
    canDispute: false,
    canVote: false,
    canFinalize: false,
  };

  switch (status) {
    case "open":
    case "cancelled":
      return base;

    case "closed":
      return { ...base, phase: "awaiting_proposal", canPropose: isCreator };

    case "resolving": {
      if (!resolution) return { ...base, phase: "awaiting_proposal", canPropose: isCreator };
      const deadline = new Date(resolution.finalizesAt);
      const windowElapsed = now.getTime() >= deadline.getTime();
      return {
        ...base,
        phase: "dispute_window",
        disputeDeadline: deadline,
        canDispute: isEligible && !windowElapsed,
        canFinalize: isEligible && windowElapsed,
      };
    }

    case "disputed": {
      if (!resolution) return base;
      const votes = resolution.votes ?? {};
      const myVote = viewerId !== null ? votes[viewerId] : undefined;
      return {
        ...base,
        phase: "disputed",
        myVote,
        canVote: isEligible,
        // The exact majority/tie rule is server-authoritative
        // (`resolution.ts`'s `tallyVotes`) — the UI offers Finalize once
        // eligible and at least one vote has been cast, and lets a
        // premature/tied attempt come back as a `conflict` toast rather
        // than duplicating that tally logic here.
        canFinalize: isEligible && Object.keys(votes).length > 0,
      };
    }

    case "resolved":
      return { ...base, phase: "resolved" };
  }
}
