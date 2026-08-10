import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/cn";

export interface NotificationBellProps {
  unreadCount: number;
  className?: string;
}

/**
 * The top-bar notification bell (task-9-brief: "notification bell with
 * unread count"). Links to `/app/activity` (Task 12's notifications page —
 * not built yet as of this task, same as `+ New bet` linking ahead to
 * Task 11's `/app/new`). Server-renderable: the count is a prop, no client
 * state of its own.
 */
export function NotificationBell({ unreadCount, className }: NotificationBellProps) {
  return (
    <Link
      href="/app/activity"
      aria-label={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
      }
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-input) text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
        className,
      )}
    >
      <Bell className="size-4" aria-hidden="true" />
      {unreadCount > 0 ? (
        <span
          className="tnum absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-(--radius-pill) bg-(--accent) px-1 text-[10px] font-semibold text-(--surface-0)"
          aria-hidden="true"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
