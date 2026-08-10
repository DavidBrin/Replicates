import { notFound } from "next/navigation";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { GroupHeader } from "@/components/app-shell/GroupHeader";
import { RightRail, type ActivityEntry, type LeaderboardEntry, type PendingInviteEntry } from "@/components/app-shell/RightRail";
import { MarketSection } from "@/components/market/MarketSection";
import { MarketCard, type MarketCardOutcome, type MarketCardSettledInfo } from "@/components/market/MarketCard";
import type { AvatarStackItem } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { CalendarClock } from "lucide-react";
import type { ComponentProps } from "react";
import type { Market, MarketStatus, OutcomeId, Trade, User, UserId } from "@/domain/entities";
import { nextStatusForClock } from "@/domain/market-state";
import { add, compare, sub, zero, type Credits } from "@/domain/money";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import type { Payout } from "@/domain/pricing/types";
import type { DataStore } from "@/ports/data-store";

const CLOSING_SOON_MS = 48 * 60 * 60 * 1000;
const ACTIVE_INVITE_STATUSES = new Set(["created", "sent", "viewed"]);

interface MarketCardData {
  market: Market;
  effectiveStatus: MarketStatus;
  cardProps: Omit<ComponentProps<typeof MarketCard>, "className">;
}

type UserCache = Map<UserId, User | null>;

async function resolveUser(store: DataStore, cache: UserCache, id: UserId): Promise<User | null> {
  if (cache.has(id)) return cache.get(id)!;
  const user = (await store.users.findById(id)) ?? null;
  cache.set(id, user);
  return user;
}

function toAvatarItem(user: User): AvatarStackItem {
  return { id: user.id, initials: user.avatarInitials, color: user.avatarColor };
}

/**
 * Builds everything one `MarketCard` needs: current prices, participant
 * avatars, volume/trader/message counts, a leading-outcome sparkline, and
 * (for resolved markets) the viewer's realized P/L. Also returns the raw
 * `trades`/`payouts` it computed along the way so the caller can fold them
 * into the group-wide leaderboard without re-deriving them.
 */
async function buildMarketCardData(
  store: DataStore,
  slug: string,
  market: Market,
  now: Date,
  viewerId: UserId,
  userCache: UserCache,
): Promise<{ data: MarketCardData; trades: Trade[]; payouts: Payout[] }> {
  const effectiveStatus = nextStatusForClock(market, now);
  const engine = getEngine(market.pricing.kind);
  // `currentPrices` never consults status (only `quote`/`execute` do, via
  // `BasePricingEngine.guardOrder`) — the stored `market.status` is fine to
  // pass here even when `effectiveStatus` has silently advanced past it
  // (see this task's report re: Task 7's "nothing proactively flips
  // status:'closed'" leftover).
  const prices = engine.currentPrices(toMarketState(market.pricing, market.status));

  const [trades, positions, messages, history] = await Promise.all([
    store.trades.listByMarket(market.id),
    store.positions.listByMarket(market.id),
    store.messages.listMessages(market.id, { limit: 500 }),
    store.priceHistory.listByMarket(market.id),
  ]);

  const outcomes: MarketCardOutcome[] = market.outcomes
    .map((o) => ({ id: o.id, label: o.label, price: prices[o.id] ?? 0 }))
    .sort((a, b) => b.price - a.price);

  const volume = trades.reduce((sum, t) => add(sum, t.cost), zero());
  const traderIds = new Set(trades.map((t) => t.userId));

  const participantIds = new Set<UserId>([market.creatorId, ...positions.map((p) => p.userId)]);
  const participantUsers = (
    await Promise.all([...participantIds].map((id) => resolveUser(store, userCache, id)))
  ).filter((u): u is User => u !== null);
  const avatars: AvatarStackItem[] = participantUsers.map(toAvatarItem);

  const leadingOutcomeId = outcomes[0]?.id as OutcomeId | undefined;
  const sparklinePoints =
    leadingOutcomeId !== undefined
      ? history
          .filter((point) => point.prices[leadingOutcomeId] !== undefined)
          .map((point) => ({ at: point.at.getTime(), p: point.prices[leadingOutcomeId]! }))
      : [];

  let payouts: Payout[] = [];
  let settled: MarketCardSettledInfo | undefined;
  if (market.status === "resolved" && market.resolution) {
    const resolvedState = toMarketState(market.pricing, "resolved");
    payouts = engine.settle(resolvedState, market.resolution.winningOutcomeId, positions);
    const winningLabel =
      market.outcomes.find((o) => o.id === market.resolution!.winningOutcomeId)?.label ?? "—";

    const viewerTrades = trades.filter((t) => t.userId === viewerId);
    if (viewerTrades.length > 0) {
      const netSpent = viewerTrades.reduce(
        (sum, t) => (t.side === "buy" ? add(sum, t.cost) : sub(sum, t.cost)),
        zero(),
      );
      const payoutAmount = payouts.find((p) => p.userId === viewerId)?.amount ?? zero();
      settled = { winningLabel, pnl: sub(payoutAmount, netSpent), hasPosition: true };
    } else {
      settled = { winningLabel, pnl: zero(), hasPosition: false };
    }
  }

  return {
    data: {
      market,
      effectiveStatus,
      cardProps: {
        href: `/app/g/${slug}/m/${market.id}`,
        question: market.question,
        status: effectiveStatus,
        closesAt: market.closesAt,
        now,
        avatars,
        participantCount: participantIds.size,
        outcomes,
        volume,
        traderCount: traderIds.size,
        messageCount: messages.length,
        sparklinePoints,
        settled,
      },
    },
    trades,
    payouts,
  };
}

function bucket(entries: MarketCardData[], now: Date) {
  const closingSoon: MarketCardData[] = [];
  const open: MarketCardData[] = [];
  const awaitingResolution: MarketCardData[] = [];
  const settled: MarketCardData[] = [];

  for (const entry of entries) {
    switch (entry.effectiveStatus) {
      case "open":
        if (entry.market.closesAt.getTime() - now.getTime() <= CLOSING_SOON_MS) {
          closingSoon.push(entry);
        } else {
          open.push(entry);
        }
        break;
      case "closed":
      case "resolving":
      case "disputed":
        awaitingResolution.push(entry);
        break;
      case "resolved":
        settled.push(entry);
        break;
      case "cancelled":
        // No section owns cancelled markets (task-9-brief lists exactly
        // four sections; cancellation is rare and out of the seed data) —
        // excluded rather than invented a fifth section for it.
        break;
    }
  }

  closingSoon.sort((a, b) => a.market.closesAt.getTime() - b.market.closesAt.getTime());
  open.sort((a, b) => a.market.closesAt.getTime() - b.market.closesAt.getTime());
  awaitingResolution.sort((a, b) => {
    const aAt = a.market.resolution?.finalizesAt.getTime() ?? a.market.closesAt.getTime();
    const bAt = b.market.resolution?.finalizesAt.getTime() ?? b.market.closesAt.getTime();
    return aAt - bAt;
  });
  settled.sort((a, b) => {
    const aAt = a.market.resolution?.resolvedAt?.getTime() ?? a.market.closesAt.getTime();
    const bAt = b.market.resolution?.resolvedAt?.getTime() ?? b.market.closesAt.getTime();
    return bAt - aAt;
  });

  return { closingSoon, open, awaitingResolution, settled };
}

/**
 * The group dashboard (SPEC §3.2, task-9-brief). Server Component — every
 * read goes straight through `getContainer()` (faster than round-tripping
 * through this app's own `/api` routes, per the task brief's "Context the
 * brief cannot know"). Non-members and unknown slugs both 404 (D6 — a
 * private group's existence isn't leaked to non-members).
 */
export default async function GroupDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireCurrentUser();
  const { store, clock } = await getContainer();

  const group = await store.groups.findBySlug(slug);
  if (!group || !group.memberIds.includes(user.id)) notFound();

  const now = clock.now();
  const userCache: UserCache = new Map([[user.id, user]]);

  const memberUsers = (
    await Promise.all(group.memberIds.map((id) => resolveUser(store, userCache, id)))
  ).filter((u): u is User => u !== null);

  const markets = await store.markets.listByGroup(group.id);
  const built = await Promise.all(
    markets.map((market) => buildMarketCardData(store, slug, market, now, user.id, userCache)),
  );

  // Group-scoped net credits: every group member's cash flow from THIS
  // group's markets — trade costs (buy: spend, sell: recover) plus any
  // settlement payout. Reuses the trades/payouts already computed per card
  // rather than re-deriving them.
  const netByMember = new Map<UserId, Credits>(group.memberIds.map((id) => [id, zero()]));
  for (const { trades, payouts } of built) {
    for (const trade of trades) {
      if (!netByMember.has(trade.userId)) continue;
      const current = netByMember.get(trade.userId)!;
      netByMember.set(
        trade.userId,
        trade.side === "buy" ? sub(current, trade.cost) : add(current, trade.cost),
      );
    }
    for (const payout of payouts) {
      const userId = payout.userId as UserId;
      if (!netByMember.has(userId)) continue;
      netByMember.set(userId, add(netByMember.get(userId)!, payout.amount));
    }
  }

  const leaderboard: LeaderboardEntry[] = memberUsers
    .map((u) => ({
      userId: u.id,
      handle: u.handle,
      displayName: u.displayName,
      avatarInitials: u.avatarInitials,
      avatarColor: u.avatarColor,
      netCredits: netByMember.get(u.id) ?? zero(),
    }))
    .sort((a, b) => compare(b.netCredits, a.netCredits))
    .slice(0, 8);

  const pendingInviteLists = await Promise.all(
    group.memberIds.map((id) => store.invites.listByInviter(id)),
  );
  const pendingInvites: PendingInviteEntry[] = [];
  for (const list of pendingInviteLists) {
    for (const invite of list) {
      if (invite.targetType !== "group" || invite.targetId !== group.id) continue;
      if (!ACTIVE_INVITE_STATUSES.has(invite.status)) continue;
      const invitee = invite.inviteeId ? await resolveUser(store, userCache, invite.inviteeId) : null;
      pendingInvites.push({
        id: invite.id,
        inviteeLabel: invitee ? `@${invitee.handle}` : "Invite link",
        expiresAt: invite.expiresAt,
      });
    }
  }

  const systemMessageLists = await Promise.all(
    markets.map((m) => store.messages.listMessages(m.id, { limit: 5 })),
  );
  const activity: ActivityEntry[] = systemMessageLists
    .flat()
    .filter((m) => m.kind === "system")
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 6)
    .map((m) => ({ id: m.id, body: m.body, at: m.at }));

  const { closingSoon, open, awaitingResolution, settled } = bucket(
    built.map((b) => b.data),
    now,
  );

  const hasAnyMarkets = markets.length > 0;

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <GroupHeader
          name={group.name}
          emoji={group.emoji}
          members={memberUsers.map(toAvatarItem)}
          memberCount={group.memberIds.length}
          newBetHref={`/app/new?group=${group.slug}`}
        />

        {!hasAnyMarkets ? (
          <EmptyState
            icon={<CalendarClock className="size-8" />}
            title="No bets yet"
            description={`Be the first to put something on the line in ${group.name}.`}
            action={
              <a
                href={`/app/new?group=${group.slug}`}
                className="inline-flex h-10 items-center justify-center rounded-(--radius-input) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
              >
                Create the first bet
              </a>
            }
          />
        ) : (
          <div className="flex flex-col gap-8">
            {closingSoon.length > 0 ? (
              <MarketSection title="Closing soon" count={closingSoon.length}>
                {closingSoon.map(({ market, cardProps }) => (
                  <MarketCard key={market.id} {...cardProps} />
                ))}
              </MarketSection>
            ) : null}
            {open.length > 0 ? (
              <MarketSection title="Open" count={open.length}>
                {open.map(({ market, cardProps }) => (
                  <MarketCard key={market.id} {...cardProps} />
                ))}
              </MarketSection>
            ) : null}
            {awaitingResolution.length > 0 ? (
              <MarketSection title="Awaiting resolution" count={awaitingResolution.length}>
                {awaitingResolution.map(({ market, cardProps }) => (
                  <MarketCard key={market.id} {...cardProps} />
                ))}
              </MarketSection>
            ) : null}
            {settled.length > 0 ? (
              <MarketSection title="Settled" count={settled.length}>
                {settled.map(({ market, cardProps }) => (
                  <MarketCard key={market.id} {...cardProps} />
                ))}
              </MarketSection>
            ) : null}
          </div>
        )}
      </div>

      <RightRail
        className="hidden w-72 shrink-0 xl:flex"
        leaderboard={leaderboard}
        pendingInvites={pendingInvites}
        activity={activity}
        now={now}
      />
    </div>
  );
}
