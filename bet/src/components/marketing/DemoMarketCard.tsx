import { MessageCircle, Users } from "lucide-react";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Sparkline, type SparklinePoint } from "@/components/charts/Sparkline";
import {
  formatCountdown,
  formatMultiplier,
  formatVolume,
} from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface DemoMarketOutcome {
  id: string;
  label: string;
  /** Probability, 0..1. */
  price: number;
}

export interface DemoMarketCardProps {
  groupEmoji: string;
  groupName: string;
  question: string;
  closesAt: Date;
  now: Date;
  avatars: AvatarStackItem[];
  participantCount: number;
  /** Sorted highest-price-first; only the top 3 render (matches MarketCard,
   * SPEC §5.1). */
  outcomes: DemoMarketOutcome[];
  volume: Credits;
  traderCount: number;
  messageCount: number;
  /** The leading outcome's price history, oldest first. */
  sparklinePoints: SparklinePoint[];
  className?: string;
}

const MAX_OUTCOME_ROWS = 3;

/**
 * The marketing home's "show, don't tell" moment (SPEC §3.1): a real seeded
 * private market rendered with its actual question, outcomes, probability
 * pills and price history — not a mockup. Deliberately its own component
 * (not a reuse of `components/market/MarketCard`, which is Task 9's file
 * and is being built concurrently) so this page never depends on another
 * in-flight task's shape. Server-renderable; the only motion is a
 * `motion-safe` pulse on the leading pill, per SPEC §3.1's "probability
 * pill animating."
 */
export function DemoMarketCard({
  groupEmoji,
  groupName,
  question,
  closesAt,
  now,
  avatars,
  participantCount,
  outcomes,
  volume,
  traderCount,
  messageCount,
  sparklinePoints,
  className,
}: DemoMarketCardProps) {
  const shown = outcomes.slice(0, MAX_OUTCOME_ROWS);
  const overflow = outcomes.length - shown.length;
  const leadingPrice = outcomes.length > 0 ? Math.max(...outcomes.map((o) => o.price)) : 0;
  const showSparkline = sparklinePoints.length >= 2;

  return (
    <Card
      className={cn(
        "flex w-full flex-col gap-4 border-(--border-2) bg-(--surface-2) p-5 shadow-[0_24px_60px_-24px_rgba(124,108,255,0.35)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-(--text-2)">
          <span className="relative flex size-1.5">
            <span
              aria-hidden="true"
              className="motion-safe:animate-ping absolute inline-flex size-full rounded-full bg-(--accent) opacity-75"
            />
            <span className="relative inline-flex size-1.5 rounded-full bg-(--accent)" />
          </span>
          Live from {groupEmoji} {groupName}
        </span>
        <span className="tnum text-xs text-(--text-3)">
          closes in {formatCountdown(closesAt.getTime() - now.getTime())}
        </span>
      </div>

      <p className="text-lg leading-snug font-semibold text-(--text-1) sm:text-xl">{question}</p>

      <div className="flex flex-col gap-2">
        {shown.map((outcome) => {
          const isLeading = outcome.price === leadingPrice;
          return (
            <div
              key={outcome.id}
              className="flex items-center justify-between gap-3 rounded-(--radius-input) bg-(--surface-1) px-3 py-2.5"
            >
              <span className="truncate text-sm text-(--text-1)">{outcome.label}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tnum text-xs text-(--text-3)">{formatMultiplier(outcome.price)}</span>
                {isLeading ? (
                  <span className="motion-safe:animate-pulse">
                    <Pill value={outcome.price} emphasis />
                  </span>
                ) : (
                  <Pill value={outcome.price} />
                )}
              </div>
            </div>
          );
        })}
        {overflow > 0 ? <p className="text-xs text-(--text-3)">+{overflow} more</p> : null}
      </div>

      {showSparkline ? (
        <div className="flex items-center justify-between gap-3 rounded-(--radius-input) border border-(--border) px-3 py-2.5">
          <span className="text-xs text-(--text-2)">Price history</span>
          <Sparkline points={sparklinePoints} width={120} height={32} />
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-(--border) pt-3 text-xs text-(--text-2)">
        <div className="flex items-center gap-2">
          <AvatarStack avatars={avatars} max={4} size="xs" />
          <span className="tnum flex items-center gap-1">
            <Users className="size-3.5" aria-hidden="true" />
            {participantCount} in
          </span>
        </div>
        <span className="tnum">{formatVolume(volume)} vol · {traderCount} traders</span>
        <span className="tnum flex items-center gap-1">
          <MessageCircle className="size-3.5" aria-hidden="true" />
          {messageCount}
        </span>
      </div>
    </Card>
  );
}
