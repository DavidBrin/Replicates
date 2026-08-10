import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCreditsPrecise, formatShares } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface HolderRow {
  userId: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
  outcomeLabel: string;
  shares: number;
  /** Present only when `market.stakesVisible` is true, or this row is the
   * viewer's own — mirrors `GET /api/markets/[id]`'s `HolderView.stake`
   * exactly (never invented client-side). */
  stake?: Credits;
}

export interface HoldersListProps {
  holders: HolderRow[];
  className?: string;
}

/** "Holders" tab (SPEC §3.3/§5.4): each participant's side and share count;
 * another user's exact stake shows only when the market's `stakesVisible`
 * flag is on (or it's the viewer's own row) — enforced server-side by the
 * route, this component just renders whatever it was given. */
export function HoldersList({ holders, className }: HoldersListProps) {
  if (holders.length === 0) {
    return <EmptyState title="No holders yet" description="Be the first to trade." className={className} />;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {holders.map((h, i) => (
        <div
          key={`${h.userId}-${h.outcomeLabel}-${i}`}
          className="flex items-center justify-between gap-3 rounded-(--radius-input) bg-(--surface-3) px-3 py-2 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Avatar initials={h.avatarInitials} color={h.avatarColor} size="sm" />
            <span className="truncate text-(--text-1)">{h.displayName}</span>
          </div>
          <div className="tnum flex shrink-0 items-center gap-3 text-(--text-2)">
            <span>{h.outcomeLabel}</span>
            <span>{formatShares(h.shares)} sh</span>
            {h.stake !== undefined ? (
              <span className="text-(--text-1)">{formatCreditsPrecise(h.stake)}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
