import { notFound } from "next/navigation";
import type { ChartSeries } from "@/components/charts/ProbabilityChart";
import { ActivityFeed, type ActivityEntry } from "@/components/market/ActivityFeed";
import { HoldersList, type HolderRow } from "@/components/market/HoldersList";
import { MarketDetailTabs } from "@/components/market/MarketDetailTabs";
import { MarketHeader } from "@/components/market/MarketHeader";
import { PositionSummary, type PositionSummaryItem } from "@/components/market/PositionSummary";
import { PricePanel } from "@/components/market/PricePanel";
import { delta24h } from "@/components/market/price-delta";
import { RulesPanel } from "@/components/market/RulesPanel";
import {
  type ResolutionPanelClientView,
  type ResolutionParticipant,
} from "@/components/market/ResolutionPanel";
import { deriveResolutionView } from "@/components/market/resolution-view";
import { TradeRefreshProvider } from "@/components/market/TradeRefreshProvider";
import { OrderTicket } from "@/components/order/OrderTicket";
import type { RoomAuthorInfo, RoomEntry } from "@/components/room/group-messages";
import type { AvatarStackItem } from "@/components/ui/Avatar";
import type { Actor } from "@/domain/authz";
import { can } from "@/domain/authz";
import { brand, type User, type UserId } from "@/domain/entities";
import { nextStatusForClock } from "@/domain/market-state";
import { toDecimal } from "@/domain/money";
import { averageBuyPrice } from "@/domain/position-ledger";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import { computeMarketFacts, computeRoomFacts } from "@/domain/services/market-access";
import { encodeMessageCursor } from "@/lib/api-client";
import { getContainer } from "@/lib/container";
import { requireCurrentUser } from "@/lib/server-actor";
import { RoomPanelHost } from "./RoomPanelHost";

const INITIAL_MESSAGE_LIMIT = 30;

/**
 * The market view (SPEC §3.3) — this task's centerpiece screen. A Server
 * Component: every read goes straight through `getContainer()` (same
 * pattern Task 9's dashboard used — faster than a self-fetch round trip
 * through `/api`). Client interactivity (the order ticket, the Room, the
 * resolution actions) is isolated into the handful of `"use client"` leaves
 * this renders, all sharing one `TradeRefreshProvider` so a trade/resolution
 * action refreshes the whole page (balance, prices, positions, holders, the
 * Room) in one shot.
 *
 * Non-members and unknown ids both 404 (D6 — a private market's existence
 * isn't leaked to non-members) via `notFound()`, which is exactly
 * `GET /api/markets/[id]`'s own behavior for the same case (Task 7).
 */
export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const marketId = brand<"MarketId">(id);
  const user = await requireCurrentUser();
  const { store, clock } = await getContainer();

  const market = await store.markets.findById(marketId);
  if (!market) notFound();

  const actor: Actor = { userId: user.id };
  const facts = await computeMarketFacts(store, market, actor);
  if (!can(actor, "read", { type: "market", id: marketId }, { market: facts })) notFound();

  // The URL's `slug` must actually be this market's own group — prevents a
  // market from being reachable through an arbitrary/wrong group's URL, and
  // catches the (out-of-scope-for-this-route) case of a public Explore
  // market with no group at all.
  const group = market.groupId ? await store.groups.findById(market.groupId) : undefined;
  if (!group || group.slug !== slug || !group.memberIds.includes(user.id)) notFound();

  const now = clock.now();
  const effectiveStatus = nextStatusForClock(market, now);
  const engine = getEngine(market.pricing.kind);
  const prices = engine.currentPrices(toMarketState(market.pricing, market.status));
  const roomFacts = await computeRoomFacts(store, market, actor);

  const [positions, history, messagesPageDesc, marketTrades] = await Promise.all([
    store.positions.listByMarket(marketId),
    store.priceHistory.listByMarket(marketId),
    store.messages.listMessages(marketId, { limit: INITIAL_MESSAGE_LIMIT }),
    // The trade ledger — the only trustworthy source for "what did I pay
    // per share" (finding C; `Position.costBasis` is a running residual
    // that drifts under repeated partial sells).
    store.trades.listByMarket(marketId),
  ]);

  const holderPositions = positions.filter((p) => p.shares > 0);
  const participantIds = new Set<UserId>([market.creatorId, ...positions.map((p) => p.userId)]);

  const userCache = new Map<UserId, User | null>();
  async function resolveUser(uid: UserId): Promise<User | null> {
    if (userCache.has(uid)) return userCache.get(uid)!;
    const u = (await store.users.findById(uid)) ?? null;
    userCache.set(uid, u);
    return u;
  }

  const participantUsers = (await Promise.all([...participantIds].map(resolveUser))).filter(
    (u): u is User => u !== null,
  );
  const creator = await resolveUser(market.creatorId);

  const avatars: AvatarStackItem[] = participantUsers.map((u) => ({
    id: u.id,
    initials: u.avatarInitials,
    color: u.avatarColor,
  }));

  const authors: Record<string, RoomAuthorInfo> = {};
  const resolutionParticipants: ResolutionParticipant[] = [];
  for (const u of participantUsers) {
    const info = { id: u.id, displayName: u.displayName, avatarInitials: u.avatarInitials, avatarColor: u.avatarColor };
    authors[u.id] = info;
    resolutionParticipants.push({
      userId: u.id,
      displayName: u.displayName,
      avatarInitials: u.avatarInitials,
      avatarColor: u.avatarColor,
    });
  }

  // Same two-gate rule as `GET /api/markets/[id]` (see that route's doc
  // comment): the roster is for fellow participants, and each row's exact
  // stake goes through the position policy rather than a hand-rolled `if`
  // (G5). This page already requires group membership above, so
  // `isFellowParticipant` is always true here — routing it through `can()`
  // anyway keeps the two surfaces from drifting apart again.
  const isFellowParticipant = facts.creatorId === user.id || facts.isParticipant;

  const holders: HolderRow[] = [];
  for (const p of holderPositions) {
    const u = await resolveUser(p.userId);
    const outcomeLabel = market.outcomes.find((o) => o.id === p.outcomeId)?.label ?? "—";
    const revealStake = can(
      actor,
      "read",
      { type: "position", id: p.id },
      {
        position: {
          holderId: p.userId,
          isFellowParticipant,
          stakesVisible: market.stakesVisible,
          marketStatus: market.status,
        },
      },
    );
    holders.push({
      userId: p.userId,
      displayName: u?.displayName ?? "Unknown trader",
      avatarInitials: u?.avatarInitials ?? "?",
      avatarColor: u?.avatarColor ?? "var(--text-3)",
      outcomeLabel,
      shares: p.shares,
      stake: revealStake ? p.costBasis : undefined,
    });
  }

  const outcomes = market.outcomes.map((o) => ({
    id: o.id,
    label: o.label,
    color: o.color,
    price: prices[o.id] ?? 0,
  }));
  const leading = [...outcomes].sort((a, b) => b.price - a.price)[0];
  const delta = leading
    ? delta24h(
        history.map((pt) => ({ at: pt.at.toISOString(), prices: pt.prices })),
        leading.id,
        now,
      )
    : null;

  const series: ChartSeries[] = market.outcomes.map((o) => ({
    outcomeId: o.id,
    label: o.label,
    color: o.color,
    points: history.map((pt) => ({ at: pt.at.getTime(), p: pt.prices[o.id] ?? 0 })),
  }));

  const myPositions = positions.filter((p) => p.userId === user.id);
  const myTrades = marketTrades.filter((t) => t.userId === user.id);
  const positionSummaryItems: PositionSummaryItem[] = myPositions
    .filter((p) => p.shares > 0)
    .map((p) => ({
      outcomeId: p.outcomeId,
      outcomeLabel: market.outcomes.find((o) => o.id === p.outcomeId)?.label ?? "—",
      shares: p.shares,
      costBasis: p.costBasis,
      avgCostPerShare: averageBuyPrice(myTrades, p.outcomeId),
      currentPrice: prices[p.outcomeId] ?? 0,
    }));

  const resolutionForView = market.resolution
    ? {
        winningOutcomeId: market.resolution.winningOutcomeId,
        proposedBy: market.resolution.proposedBy,
        proposedAt: market.resolution.proposedAt.toISOString(),
        finalizesAt: market.resolution.finalizesAt.toISOString(),
        disputedBy: market.resolution.disputedBy,
        disputedAt: market.resolution.disputedAt?.toISOString(),
        votes: market.resolution.votes,
        resolvedAt: market.resolution.resolvedAt?.toISOString(),
      }
    : undefined;

  const rawResolutionView = deriveResolutionView({
    status: effectiveStatus,
    resolution: resolutionForView,
    creatorId: market.creatorId,
    viewerId: user.id,
    isParticipant: facts.isParticipant,
    now,
  });
  const resolutionClientView: ResolutionPanelClientView = {
    phase: rawResolutionView.phase,
    canPropose: rawResolutionView.canPropose,
    canDispute: rawResolutionView.canDispute,
    canVote: rawResolutionView.canVote,
    canFinalize: rawResolutionView.canFinalize,
    disputeDeadlineIso: rawResolutionView.disputeDeadline?.toISOString(),
    myVote: rawResolutionView.myVote,
  };

  const messagesAscending = [...messagesPageDesc].reverse();
  const roomInitialMessages: RoomEntry[] = messagesAscending.map((m) => ({
    id: m.id,
    authorId: m.authorId,
    kind: m.kind,
    body: m.body,
    at: m.at.toISOString(),
    clientId: m.clientId,
  }));
  const oldestLoaded = messagesPageDesc[messagesPageDesc.length - 1];
  const initialNextCursor =
    messagesPageDesc.length === INITIAL_MESSAGE_LIMIT && oldestLoaded
      ? encodeMessageCursor(oldestLoaded.at, oldestLoaded.id)
      : null;

  const activityEntries: ActivityEntry[] = [...messagesAscending]
    .filter((m) => m.kind === "system")
    .reverse() // newest first for the Activity tab
    .map((m) => ({ id: m.id, body: m.body, at: m.at }));

  return (
    <TradeRefreshProvider>
      <div className="flex flex-col gap-6">
        <MarketHeader
          backHref={`/app/g/${slug}`}
          backLabel={group.name}
          question={market.question}
          status={effectiveStatus}
          closesAt={market.closesAt}
          now={now}
          creatorDisplayName={creator?.displayName ?? "Unknown"}
          avatars={avatars}
          participantCount={participantIds.size}
        />

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <PricePanel outcomes={outcomes} series={series} delta={delta} />

            <OrderTicket
              marketId={market.id}
              status={effectiveStatus}
              outcomes={outcomes}
              balance={user.balance}
              minStake={market.minStake}
              maxStake={market.maxStake}
              myPositions={myPositions.map((p) => ({ outcomeId: p.outcomeId, shares: p.shares }))}
            />

            <MarketDetailTabs
              position={<PositionSummary positions={positionSummaryItems} />}
              holders={<HoldersList holders={holders} />}
              rules={
                <RulesPanel
                  marketId={market.id}
                  resolutionCriteria={market.resolutionCriteria}
                  resolutionSource={market.resolutionSource}
                  minStake={toDecimal(market.minStake)}
                  maxStake={toDecimal(market.maxStake)}
                  stakesVisible={market.stakesVisible}
                  pricingKind={market.pricing.kind}
                  feeBps={market.pricing.feeBps}
                  outcomes={market.outcomes.map((o) => ({ id: o.id, label: o.label }))}
                  participants={resolutionParticipants}
                  resolutionView={resolutionClientView}
                  winningOutcomeId={market.resolution?.winningOutcomeId}
                  votes={market.resolution?.votes}
                  now={now.toISOString()}
                />
              }
              activity={<ActivityFeed entries={activityEntries} now={now} />}
            />
          </div>

          <RoomPanelHost
            className="h-[640px] xl:w-[360px] xl:shrink-0"
            marketId={market.id}
            currentUserId={user.id}
            authors={authors}
            initialMessages={roomInitialMessages}
            initialNextCursor={initialNextCursor}
            now={now.toISOString()}
            canPost={roomFacts.isMember}
          />
        </div>
      </div>
    </TradeRefreshProvider>
  );
}
