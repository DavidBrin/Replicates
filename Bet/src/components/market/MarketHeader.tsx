import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Countdown } from "@/components/ui/Countdown";
import type { MarketStatus } from "@/domain/entities";
import { formatCountdown } from "@/domain/formatters";
import { cn } from "@/lib/cn";

export interface MarketHeaderProps {
  backHref: string;
  backLabel: string;
  question: string;
  /** Effective status (already passed through `nextStatusForClock`). */
  status: MarketStatus;
  closesAt: Date;
  now: Date;
  creatorDisplayName: string;
  avatars: AvatarStackItem[];
  participantCount: number;
  className?: string;
}

const STATUS_LABEL: Record<Exclude<MarketStatus, "open">, string> = {
  closed: "Closed",
  resolving: "Awaiting resolution",
  disputed: "Disputed",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/**
 * The market view's header (SPEC §3.3's layout sketch): back link, the
 * question, a status badge with a close countdown, the creator, and
 * participant avatars. Server-renderable — `Countdown` is the only client
 * leaf, and only for its once-a-minute tick after the first paint.
 */
export function MarketHeader({
  backHref,
  backLabel,
  question,
  status,
  closesAt,
  now,
  creatorDisplayName,
  avatars,
  participantCount,
  className,
}: MarketHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-(--text-2) transition-colors hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0) rounded-(--radius-input)"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {backLabel}
      </Link>

      <h1 className="text-xl leading-snug font-semibold text-(--text-1) sm:text-2xl">{question}</h1>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-(--text-2)">
        {status === "open" ? (
          <span className="tnum flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-(--yes)" />
            Open · closes in{" "}
            <Countdown target={closesAt} initialText={formatCountdown(closesAt.getTime() - now.getTime())} />
          </span>
        ) : (
          <Badge tone={status === "resolved" ? "accent" : status === "disputed" ? "no" : "warn"}>
            {STATUS_LABEL[status as Exclude<MarketStatus, "open">]}
          </Badge>
        )}
        <span>
          Created by <span className="text-(--text-1)">{creatorDisplayName}</span>
        </span>
        <div className="flex items-center gap-2">
          <AvatarStack avatars={avatars} max={6} size="xs" />
          <span className="tnum">{participantCount} in</span>
        </div>
      </div>
    </div>
  );
}
