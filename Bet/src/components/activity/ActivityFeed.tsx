"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  Check,
  Clock,
  Mail,
  MailCheck,
  Trophy,
  TrendingUp,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@/domain/entities";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

const ICON_BY_TYPE: Record<NotificationType, LucideIcon> = {
  friend_request_received: UserPlus,
  friend_request_accepted: UserCheck,
  bet_invite_received: Mail,
  bet_invite_accepted: MailCheck,
  market_resolved: Trophy,
  market_closing_soon: Clock,
  chat_message: TrendingUp,
  chat_mention: AtSign,
};

export interface ActivityItem {
  id: string;
  type: NotificationType;
  title: string;
  subtitle?: string;
  href: string;
  dayLabel: string;
  timeLabel: string;
  /** `null` = unread. A string (any non-null value) = read. */
  readAt: string | null;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  unreadCount: number;
}

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

async function postJson<T>(body: unknown): Promise<Envelope<T>> {
  try {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Envelope<T>;
  } catch {
    return { error: { code: "internal", message: "Network error — try again." } };
  }
}

/**
 * The Activity page's interactive core (task-12-brief: "notifications
 * grouped by day ..., typed icons per notification kind, unread items
 * visually distinct with an accent dot, a Mark all read action, and each
 * item deep-linking"). Day-grouping and per-item copy/hrefs are computed
 * server-side (`page.tsx`, `day-bucket.ts`, `notification-copy.ts`) since
 * both need the server's clock/store; this component only owns read/unread
 * state and the two mutating actions (single mark-read on click-through,
 * mark-all-read).
 */
export function ActivityFeed({ items: initialItems, unreadCount: initialUnread }: ActivityFeedProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function markOneReadOptimistic(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (!target || target.readAt !== null) return prev;
      setUnreadCount((c) => Math.max(0, c - 1));
      return prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i));
    });
    // Fire-and-forget: this is a read receipt, not something the user is
    // blocked on — navigation via the surrounding <Link> proceeds
    // immediately regardless of how long this takes. A failure here just
    // means the dot reappears next visit; not worth a rollback/toast for
    // something this low-stakes.
    void postJson({ action: "markRead", id });
  }

  async function markAllRead() {
    if (unreadCount === 0 || markAllPending) return;
    setMarkAllPending(true);
    setError(null);
    const prevItems = items;
    const prevUnread = unreadCount;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.readAt === null ? { ...i, readAt: now } : i)));
    setUnreadCount(0);

    const res = await postJson<{ markedAll: true }>({ action: "markAllRead" });
    setMarkAllPending(false);
    if ("error" in res) {
      setItems(prevItems);
      setUnreadCount(prevUnread);
      setError(res.error.message);
      return;
    }
    // Re-syncs the app shell's bell badge, which reads unread count
    // straight from the store in `(app)/layout.tsx` on every navigation.
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="size-8" aria-hidden="true" />}
        title="No activity yet"
        description="Friend requests, invites, trades and resolutions on your bets will show up here."
      />
    );
  }

  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.dayLabel) {
      last.items.push(item);
    } else {
      groups.push({ label: item.dayLabel, items: [item] });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="tnum text-sm text-(--text-2)">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={unreadCount === 0}
          loading={markAllPending}
          onClick={markAllRead}
        >
          <Check className="size-3.5" aria-hidden="true" />
          Mark all read
        </Button>
      </div>

      {error ? <p className="text-sm text-(--no)">{error}</p> : null}

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-(--text-3) uppercase">
              {group.label}
            </h2>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const Icon = ICON_BY_TYPE[item.type];
                const unread = item.readAt === null;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => markOneReadOptimistic(item.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-(--radius-card) border border-transparent px-3 py-2.5 transition-colors hover:border-(--border) hover:bg-(--surface-2)",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
                      unread && "bg-(--surface-1)",
                    )}
                  >
                    <span
                      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-(--surface-3) text-(--text-2)"
                      aria-hidden="true"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm text-(--text-1)">{item.title}</span>
                        <span className="tnum shrink-0 text-xs text-(--text-3)">{item.timeLabel}</span>
                      </span>
                      {item.subtitle ? (
                        <span className="mt-0.5 block truncate text-xs text-(--text-3)">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                    {unread ? (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-(--accent)"
                        aria-label="Unread"
                      />
                    ) : (
                      <span className="mt-1.5 size-2 shrink-0" aria-hidden="true" />
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
