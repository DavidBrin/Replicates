"use client";

import clsx from "clsx";
import { useState } from "react";

import { formatDuration } from "@/domain/format";
import { Button } from "@/components/primitives";
import { CheckIcon, FlagIcon } from "@/components/icons";

import type { ClaimView } from "./upload-machine";

/**
 * Content ID claims on a video.
 *
 * D12 calls this "the one YouTube subsystem nobody clones", and a subsystem
 * nobody can see is a subsystem nobody built. So this component is deliberately
 * not a badge: it states the four facts that make a claim a claim, in the order
 * an uploader needs them.
 *
 *  1. **What was matched** — the reference work and who holds it.
 *  2. **Where** — the span in *this video's* timeline, and where that span
 *     begins in the reference. Both come off the claim row, and they are
 *     genuinely different numbers: `match_start_ms` is in the upload's
 *     timeline, `reference_offset_ms` in the work's.
 *  3. **What happens now** — the policy. `block`, `monetise` and `track` are
 *     three materially different outcomes for the uploader and are written out
 *     rather than colour-coded, because a colour is not a sentence.
 *  4. **What they can do** — dispute.
 *
 * ## The policy is the claim's, not the work's
 *
 * `content-id.ts` copies the policy onto the claim at claim time rather than
 * joining it at read time, and its header explains why: a rights-holder may
 * change a work's default afterwards, and a claim has to keep saying what was
 * applied *to it*. This component renders `claim.policy` for that reason and
 * must never be "simplified" into a join.
 *
 * ## `scanned` is not the same as "no claims"
 *
 * A video with no claims and a video whose audio could not be decoded look
 * identical if you only count rows. They are reported differently here, because
 * only one of them is reassuring.
 */

export type ClaimPolicy = ClaimView["policy"];

/** What each policy actually does, in the uploader's terms. */
const POLICY_COPY: Readonly<
  Record<ClaimPolicy, { label: string; consequence: string; tone: string }>
> = {
  block: {
    label: "Blocked",
    consequence: "The rights holder has asked for videos using this to be blocked.",
    tone: "text-[var(--yt-error-indicator)]",
  },
  monetise: {
    label: "Monetised by the rights holder",
    consequence: "Ads may run on this video and the revenue goes to the rights holder.",
    tone: "text-[var(--yt-icon-warning)]",
  },
  track: {
    label: "Tracked",
    consequence: "The rights holder is collecting viewing statistics. Nothing changes for you.",
    tone: "text-secondary",
  },
};

const STATUS_COPY: Readonly<Record<ClaimView["status"], string>> = {
  active: "Active",
  disputed: "Dispute under review",
  released: "Released",
};

export interface ClaimsProps {
  readonly claims: readonly ClaimView[];
  /**
   * Whether the copyright check ran at all. `null` while it is still running,
   * `false` when this browser could not decode the audio to fingerprint it.
   */
  readonly scanned: boolean | null;
  /** Absent for a read-only surface; the uploader's own Studio passes it. */
  readonly onDispute?: (claimId: string) => void | Promise<void>;
  readonly className?: string;
}

export function Claims({ claims, scanned, onDispute, className }: ClaimsProps) {
  if (scanned === null) {
    return (
      <ChecksNote className={className} state="running">
        Checking this video against registered reference works.
      </ChecksNote>
    );
  }

  if (!scanned) {
    return (
      <ChecksNote className={className} state="unavailable">
        The copyright check did not run. This browser could not decode the
        video&rsquo;s audio, and matching is done from the audio — so this is
        &ldquo;not checked&rdquo;, not &ldquo;nothing found&rdquo;.
      </ChecksNote>
    );
  }

  if (claims.length === 0) {
    return (
      <ChecksNote className={className} state="clear">
        No copyright matches found.
      </ChecksNote>
    );
  }

  return (
    <ul
      className={clsx("m-0 flex list-none flex-col gap-3 p-0", className)}
      data-testid="claims-list"
    >
      {claims.map((claim) => (
        <li key={claim.id}>
          <ClaimCard claim={claim} {...(onDispute ? { onDispute } : {})} />
        </li>
      ))}
    </ul>
  );
}

interface ClaimCardProps {
  readonly claim: ClaimView;
  readonly onDispute?: (claimId: string) => void | Promise<void>;
}

function ClaimCard({ claim, onDispute }: ClaimCardProps) {
  const [disputing, setDisputing] = useState(false);
  const policy = POLICY_COPY[claim.policy];

  const submit = async (): Promise<void> => {
    if (!onDispute) return;
    setDisputing(true);
    try {
      await onDispute(claim.id);
    } finally {
      setDisputing(false);
    }
  };

  return (
    <article
      data-claim-policy={claim.policy}
      data-claim-status={claim.status}
      className="rounded-compact border border-outline p-4"
    >
      <header className="flex items-start gap-3">
        <FlagIcon size={20} className={clsx("mt-0.5 shrink-0", policy.tone)} />
        <div className="min-w-0 flex-1">
          <p className="ytcp-subheading2 m-0 truncate">{claim.referenceTitle}</p>
          <p className="ytcp-caption1 m-0 text-secondary">{claim.rightsHolder}</p>
        </div>
        <span className={clsx("ytcp-caption2 shrink-0", policy.tone)}>
          {policy.label}
        </span>
      </header>

      <p className="ytcp-body1 mt-3 mb-0">{policy.consequence}</p>

      <dl className="ytcp-caption1 mt-3 mb-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-secondary">
        <dt>In this video</dt>
        <dd className="m-0 text-primary">
          {formatDuration(claim.matchStartMs / 1000)} –{" "}
          {formatDuration(claim.matchEndMs / 1000)}
        </dd>
        <dt>In {claim.referenceTitle}</dt>
        <dd className="m-0 text-primary">
          from {formatDuration(claim.referenceOffsetMs / 1000)}
        </dd>
        <dt>Matching segments</dt>
        {/* The score *is* a count — `research/06` §2.3 defines it as the number
            of matching, time-aligned hash tokens — so it is labelled as one
            rather than dressed up as a percentage it is not. */}
        <dd className="m-0 text-primary">{claim.score}</dd>
        <dt>Status</dt>
        <dd className="m-0 text-primary">{STATUS_COPY[claim.status]}</dd>
      </dl>

      {onDispute && claim.status === "active" ? (
        <div className="mt-4">
          <Button variant="outline" size="s" onClick={submit} disabled={disputing}>
            {disputing ? "Submitting…" : "Dispute this claim"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

interface ChecksNoteProps {
  readonly state: "running" | "clear" | "unavailable";
  readonly children: React.ReactNode;
  readonly className?: string;
}

function ChecksNote({ state, children, className }: ChecksNoteProps) {
  return (
    <p
      data-checks-state={state}
      className={clsx(
        "ytcp-body1 m-0 flex items-start gap-2 text-secondary",
        className,
      )}
    >
      {state === "clear" ? (
        <CheckIcon size={20} className="mt-0.5 shrink-0 text-[var(--yt-themed-green)]" />
      ) : (
        <FlagIcon
          size={20}
          className={clsx(
            "mt-0.5 shrink-0",
            state === "unavailable" ? "text-[var(--yt-icon-warning)]" : "text-secondary",
          )}
        />
      )}
      <span>{children}</span>
    </p>
  );
}
