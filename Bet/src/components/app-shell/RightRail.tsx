import { Inbox, Trophy } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatCredits, formatRelativeTime } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
  /** Mark-to-market net credits for this group's markets: every trade's
   * cash flow (buy: spend, sell: recover), plus either a resolved
   * market's settlement payout or, for every market short of resolved,
   * that member's open positions valued at the market's current price
   * (see `src/app/(app)/app/g/[slug]/net-credits.ts` for the exact
   * derivation and why an un-marked open position used to make every
   * holder look like they were down the full amount they'd staked). */
  netCredits: Credits;
}

export interface PendingInviteEntry {
  id: string;
  inviteeLabel: string;
  expiresAt: Date;
}

export interface ActivityEntry {
  id: string;
  body: string;
  at: Date;
}

export interface RightRailProps {
  leaderboard: LeaderboardEntry[];
  pendingInvites: PendingInviteEntry[];
  activity: ActivityEntry[];
  now: Date;
  className?: string;
}

/**
 * The group dashboard's right rail, xl+ only (SPEC §3.2): group
 * leaderboard by net credits, pending invites, recent activity. A distinct
 * component per task-9-brief's ambiguity resolution ("Build it as a
 * distinct component so Task 10 can reuse the styling") — pure props in,
 * no data fetching of its own (G1). Server-renderable.
 */
export function RightRail({ leaderboard, pendingInvites, activity, now, className }: RightRailProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-(--text-1)">
            <Trophy className="size-4 text-(--text-3)" aria-hidden="true" />
            Leaderboard
          </h2>
          {leaderboard.length > 0 ? (
            <Tooltip
              content="Balance plus open positions at current prices, versus your starting 1,000"
              side="left"
            >
              <span className="cursor-help text-xs font-medium text-(--text-3) underline decoration-dotted underline-offset-2">
                Net
              </span>
            </Tooltip>
          ) : null}
        </div>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-(--text-3)">No trades yet.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {leaderboard.map((entry, index) => (
              <li key={entry.userId} className="flex items-center gap-2.5">
                <span className="tnum w-4 shrink-0 text-xs text-(--text-3)">{index + 1}</span>
                <Avatar initials={entry.avatarInitials} color={entry.avatarColor} size="xs" />
                <span className="min-w-0 flex-1 truncate text-sm text-(--text-1)">
                  {entry.displayName}
                </span>
                <span
                  className={cn(
                    "tnum shrink-0 text-sm font-medium",
                    entry.netCredits > 0
                      ? "text-(--yes)"
                      : entry.netCredits < 0
                        ? "text-(--no)"
                        : "text-(--text-2)",
                  )}
                >
                  {entry.netCredits > 0 ? "+" : ""}
                  {formatCredits(entry.netCredits)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-(--text-1)">Pending invites</h2>
        {pendingInvites.length === 0 ? (
          <p className="text-sm text-(--text-3)">Nobody&apos;s been invited yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingInvites.map((invite) => (
              <li key={invite.id} className="text-sm text-(--text-2)">
                <span className="text-(--text-1)">{invite.inviteeLabel}</span> — pending
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-(--text-1)">
          <Inbox className="size-4 text-(--text-3)" aria-hidden="true" />
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-(--text-3)">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {activity.map((entry) => (
              <li key={entry.id} className="text-sm text-(--text-2)">
                <p className="text-(--text-1)">{entry.body}</p>
                <p className="tnum text-xs text-(--text-3)">{formatRelativeTime(entry.at, now)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
