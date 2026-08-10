import { formatCountdown, formatVolume } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { Badge } from "@/components/ui/Badge";
import { BookmarkButton } from "./BookmarkButton";

export interface CardFooterProps {
  question: string;
  volume: Credits;
  closesAt: Date;
  now: Date;
  className?: string;
}

const CLOSING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/** Shared footer for every card variant (SPEC §7.3): `$X Vol.` via
 * `formatVolume` (G6), an optional live/period badge, and a bookmark icon.
 * "Live" in this domain model has no real-time game-clock field to drive a
 * pulsing LIVE badge (SPEC's domain model has no `live`/`period` columns) —
 * the closest honest equivalent is a "Closing soon" badge once a market is
 * within a week of `closesAt`, which is exactly the kind of urgency signal
 * both sources' badges convey. Server-renderable. */
export function CardFooter({ question, volume, closesAt, now, className }: CardFooterProps) {
  const msRemaining = closesAt.getTime() - now.getTime();
  const closingSoon = msRemaining > 0 && msRemaining <= CLOSING_SOON_MS;

  return (
    <div className={className}>
      <div className="mt-2 flex items-center justify-between border-t border-(--border) pt-2">
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-xs text-(--text-3)">${formatVolume(volume)} Vol.</span>
          {closingSoon ? (
            <Badge tone="warn" className="tabular-nums">
              Closes {formatCountdown(msRemaining)}
            </Badge>
          ) : null}
        </div>
        <BookmarkButton question={question} />
      </div>
    </div>
  );
}
