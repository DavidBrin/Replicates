import Link from "next/link";
import { Plus } from "lucide-react";
import { AvatarStack, type AvatarStackItem } from "@/components/ui/Avatar";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

export interface GroupHeaderProps {
  name: string;
  emoji: string;
  members: AvatarStackItem[];
  memberCount: number;
  /** Where "+ New bet" routes to — Task 11's wizard, pre-selecting this
   * group. */
  newBetHref: string;
  className?: string;
}

/**
 * The group dashboard's header (SPEC §3.2: "group name, member avatar
 * stack, member count, + New bet") plus the SubNav strip (task-9-brief:
 * "Markets · Members · Leaderboard + New bet CTA"). Combined into one
 * component since both describe the same dashboard-top region and neither
 * brief contradicts the other. "Members" and "Leaderboard" have no route of
 * their own yet (no task in docs/plan.md builds one) — rather than link to
 * a page that would 404, they render as inert tabs with a "coming soon"
 * tooltip; only "Markets" (this page itself) is a live destination. Server-
 * renderable — `Tooltip` is the only client leaf involved, and it owns its
 * own hover/focus state.
 */
export function GroupHeader({
  name,
  emoji,
  members,
  memberCount,
  newBetHref,
  className,
}: GroupHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            {emoji}
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-(--text-1)">{name}</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <AvatarStack avatars={members} max={6} size="sm" />
          <span className="tnum text-sm text-(--text-2)">
            {memberCount} member{memberCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-(--border)">
        <div role="tablist" aria-label="Group sections" className="flex items-center gap-5">
          <span
            role="tab"
            aria-selected="true"
            className="relative -mb-px py-2.5 text-sm font-medium text-(--text-1)"
          >
            Markets
            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-(--accent)" />
          </span>
          {["Members", "Leaderboard"].map((label) => (
            <Tooltip key={label} content="Coming soon" side="bottom">
              <span
                role="tab"
                aria-selected="false"
                aria-disabled="true"
                tabIndex={0}
                className="py-2.5 text-sm font-medium text-(--text-3)"
              >
                {label}
              </span>
            </Tooltip>
          ))}
        </div>
        <Link
          href={newBetHref}
          className={cn(
            "mb-1 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-(--radius-input) bg-(--accent) px-3 text-[13px] font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2)",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
          )}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New bet
        </Link>
      </div>
    </div>
  );
}
