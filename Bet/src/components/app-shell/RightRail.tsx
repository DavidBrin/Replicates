import { Inbox, Trophy } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { formatCredits, formatRelativeTime } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
  /** Net credits gained/lost from this group's markets — the sum of every
   * trade's cash flow plus any settlement payouts (see the group
   * dashboard's doc comment for the exact derivation). */
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
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-(--text-1)">
          <Trophy className="size-4 text-(--text-3)" aria-hidden="true" />
          Leaderboard
        </h2>
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
