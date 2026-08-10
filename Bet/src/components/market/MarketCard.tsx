import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import { Pill } from "@/components/ui/Pill";
import { Sparkline, type SparklinePoint } from "@/components/charts/Sparkline";
import type { MarketStatus } from "@/domain/entities";
import { formatCountdown, formatCredits, formatMultiplier, formatVolume } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface MarketCardOutcome {
  id: string;
  label: string;
  /** Probability, 0..1. */
  price: number;
}

export interface MarketCardSettledInfo {
  winningLabel: string;
  /** The viewer's realized P/L on this market (payout minus net amount
   * spent trading it). Only meaningful when `hasPosition` is true. */
  pnl: Credits;
  hasPosition: boolean;
}

export interface MarketCardProps {
  /** The market's detail route — `/app/g/[slug]/m/[id]` (Task 10). The
   * whole card is one link to it (SPEC §5.1). */
  href: string;
  question: string;
  status: MarketStatus;
  closesAt: Date;
  /** The server's current time, so the initial close-countdown text and
   * any status framing are computed deterministically (no hidden
   * `Date.now()` — G6/formatters.ts's own discipline). */
  now: Date;
  avatars: AvatarStackItem[];
  participantCount: number;
  /** Every outcome, already sorted highest-price-first. Only the first 3
   * render as rows; the rest collapse into "+N more" (SPEC §5.1). */
  outcomes: MarketCardOutcome[];
  volume: Credits;
  traderCount: number;
  messageCount: number;
  /** The leading outcome's price history, oldest first. Rendered only when
   * there are >=2 points (task-9-brief's ambiguity resolution) — a single
   * point has no line to draw. */
  sparklinePoints?: SparklinePoint[];
  /** When set, the card shows the winning outcome and the viewer's
   * realized P/L instead of live prices/countdown (task-9-brief: "Settled
   * cards show the winning outcome and your realized P/L instead of live
   * prices"). */
  settled?: MarketCardSettledInfo;
  className?: string;
}

const STATUS_LABEL: Record<Exclude<MarketStatus, "open">, string> = {
  closed: "Closed",
  resolving: "Resolving",
  disputed: "Disputed",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

const MAX_OUTCOME_ROWS = 3;

/**
 * The private-surface market card (SPEC §5.1's anatomy, followed exactly):
 * avatar stack + participant count and a close countdown on top; the
 * question, 2-line clamped; up to 3 outcome rows (label · payout
 * multiplier · probability pill); a `+N more` line; a footer with volume,
 * trader count and message count. Server-renderable — `Countdown` is the
 * only client leaf, and it only owns a once-a-minute re-render of text this
 * component already computed once for the first paint.
 */
export function MarketCard({
  href,
  question,
  status,
  closesAt,
  now,
  avatars,
  participantCount,
  outcomes,
  volume,
  traderCount,
  messageCount,
  sparklinePoints,
  settled,
  className,
}: MarketCardProps) {
  const shownOutcomes = outcomes.slice(0, MAX_OUTCOME_ROWS);
  const overflow = outcomes.length - shownOutcomes.length;
  const leadingPrice = outcomes.length > 0 ? Math.max(...outcomes.map((o) => o.price)) : 0;
  const showSparkline = !settled && (sparklinePoints?.length ?? 0) >= 2;

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-(--radius-card) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
        className,
      )}
    >
      <Card interactive className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <AvatarStack avatars={avatars} max={4} size="xs" />
            <span className="tnum shrink-0 text-xs text-(--text-2)">{participantCount} in</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {showSparkline ? <Sparkline points={sparklinePoints!} width={48} height={18} /> : null}
            {status === "open" ? (
              <span className="tnum flex items-center gap-1 text-xs text-(--text-2)">
                closes in <Countdown target={closesAt} initialText={formatCountdown(closesAt.getTime() - now.getTime())} />
              </span>
            ) : (
              <Badge tone={status === "resolved" ? "accent" : "warn"}>
                {STATUS_LABEL[status as Exclude<MarketStatus, "open">]}
              </Badge>
            )}
          </div>
        </div>

        <p className="line-clamp-2 text-base leading-snug font-semibold text-(--text-1)">
          {question}
        </p>

        {settled ? (
          <div className="flex flex-1 flex-col justify-center gap-1 rounded-(--radius-input) bg-(--surface-3) px-3 py-2.5">
            <p className="text-xs text-(--text-2)">
              Won: <span className="font-medium text-(--text-1)">{settled.winningLabel}</span>
            </p>
            {settled.hasPosition ? (
              <p
                className={cn(
                  "tnum text-sm font-semibold",
                  settled.pnl > 0 ? "text-(--yes)" : settled.pnl < 0 ? "text-(--no)" : "text-(--text-2)",
                )}
              >
                {settled.pnl > 0 ? "+" : ""}
                {formatCredits(settled.pnl)} P/L
              </p>
            ) : (
              <p className="text-sm text-(--text-3)">You didn&apos;t hold a position.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-1.5">
            {shownOutcomes.map((outcome) => (
              <div key={outcome.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-(--text-1)">{outcome.label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tnum text-(--text-3)">{formatMultiplier(outcome.price)}</span>
                  <Pill value={outcome.price} emphasis={outcome.price === leadingPrice} />
                </div>
              </div>
            ))}
            {overflow > 0 ? (
              <p className="text-xs text-(--text-3)">+{overflow} more</p>
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-(--border) pt-3 text-xs text-(--text-2)">
          <span className="tnum">
            {formatVolume(volume)} vol · {traderCount} trader{traderCount === 1 ? "" : "s"}
          </span>
          <span className="tnum flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden="true" />
            {messageCount}
          </span>
        </div>
      </Card>
    </Link>
  );
}
