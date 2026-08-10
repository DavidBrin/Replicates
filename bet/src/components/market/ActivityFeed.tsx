import { EmptyState } from "@/components/ui/EmptyState";
import { formatRelativeTime } from "@/domain/formatters";
import { cn } from "@/lib/cn";

export interface ActivityEntry {
  id: string;
  body: string;
  at: Date;
}

export interface ActivityFeedProps {
  entries: ActivityEntry[];
  now: Date;
  className?: string;
}

/** "Activity" tab (SPEC §3.3): the market's chronological system-event log
 * (trades and resolution state changes) — the same events the Room renders
 * inline as chips, here as a flat timeline. Server-renderable. */
export function ActivityFeed({ entries, now, className }: ActivityFeedProps) {
  if (entries.length === 0) {
    return <EmptyState title="No activity yet" className={className} />;
  }

  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {entries.map((e) => (
        <li
          key={e.id}
          className="flex items-center justify-between gap-3 rounded-(--radius-input) bg-(--surface-3) px-3 py-2 text-sm"
        >
          <span className="text-(--text-1)">{e.body}</span>
          <span className="tnum shrink-0 text-xs text-(--text-3)">{formatRelativeTime(e.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}
