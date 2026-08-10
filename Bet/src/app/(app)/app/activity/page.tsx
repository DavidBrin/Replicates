import type { Metadata } from "next";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { formatRelativeTime } from "@/domain/formatters";
import { brand, type GroupId } from "@/domain/entities";
import { ActivityFeed, type ActivityItem } from "@/components/activity/ActivityFeed";
import { dayBucketLabel } from "@/components/activity/day-bucket";
import { buildActivityContent, type ResolvedMarketInfo } from "@/components/activity/notification-copy";

export const metadata: Metadata = {
  title: "Activity — Bet",
  description: "Friend requests, invites, trades and resolutions.",
};

/** Generous page size for a demo app's in-memory store — this is a full
 * history view (SPEC §2: "/app/activity: Notifications + trade history"),
 * not the capped `GET /api/notifications` API a client polls. */
const PAGE_SIZE = 200;

/**
 * `/app/activity` (SPEC §3.5 sibling; §2's IA). Server Component reading
 * straight from the container, same convention as every other page in this
 * app (`/app/friends`, the group dashboard, `/signin`) — `me.id`-scoped
 * throughout, so this can never surface another user's notifications
 * (mirrors `GET /api/notifications`'s own scoping, which this page doesn't
 * call directly for the same reason the group dashboard doesn't call
 * `GET /api/groups/[slug]`: a Server Component already has the container).
 */
export default async function ActivityPage() {
  const me = await requireCurrentUser();
  const { store, clock } = await getContainer();
  const now = clock.now();

  const notifications = (await store.notifications.listByUser(me.id)).slice(0, PAGE_SIZE);
  const unreadCount = notifications.filter((n) => n.readAt === undefined).length;

  const marketIds = new Set<string>();
  for (const n of notifications) {
    const raw = (n.payload as Record<string, unknown>).marketId;
    if (typeof raw === "string") marketIds.add(raw);
  }

  const marketsById = new Map<string, ResolvedMarketInfo>();
  await Promise.all(
    [...marketIds].map(async (id) => {
      const market = await store.markets.findById(brand<"MarketId">(id));
      if (!market) return;
      const group = market.groupId ? await store.groups.findById(market.groupId as GroupId) : null;
      marketsById.set(id, { question: market.question, groupSlug: group?.slug ?? null });
    }),
  );

  const items: ActivityItem[] = notifications.map((n) => {
    const content = buildActivityContent(
      { type: n.type, payload: n.payload as Record<string, unknown> },
      marketsById,
    );
    return {
      id: n.id,
      type: n.type,
      title: content.title,
      subtitle: content.subtitle,
      href: content.href,
      dayLabel: dayBucketLabel(n.createdAt, now),
      timeLabel: formatRelativeTime(n.createdAt, now),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    };
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-(--text-1)">Activity</h1>
        <p className="text-sm text-(--text-2)">
          Everything that&apos;s happened across your bets and friends.
        </p>
      </div>

      <ActivityFeed items={items} unreadCount={unreadCount} />
    </div>
  );
}
