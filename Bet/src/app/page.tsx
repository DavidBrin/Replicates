import type { AvatarStackItem } from "@/components/ui/Avatar";
import type { SparklinePoint } from "@/components/charts/Sparkline";
import { DemoMarketCard, type DemoMarketOutcome } from "@/components/marketing/DemoMarketCard";
import { FeaturePanels } from "@/components/marketing/FeaturePanels";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import type { Group, Market, OutcomeId, User, UserId } from "@/domain/entities";
import { zero, add } from "@/domain/money";
import { toMarketState } from "@/domain/pricing-config";
import { getEngine } from "@/domain/pricing/registry";
import { getContainer } from "@/lib/container";
import type { DataStore } from "@/ports/data-store";

// The three private groups seeded by Task 5 (SPEC §5 / docs/plan.md Task 5).
// Iterated by slug rather than a `listAll` (the port has none, by design —
// `GroupRepo` only exposes member-scoped lookups) to find the liveliest
// open market to feature on the marketing home.
const SEEDED_GROUP_SLUGS = ["sunday-league", "the-roommates", "fantasy-2026"];

interface FeaturedMarketData {
  group: Group;
  market: Market;
  outcomes: DemoMarketOutcome[];
  avatars: AvatarStackItem[];
  participantCount: number;
  volume: ReturnType<typeof zero>;
  traderCount: number;
  messageCount: number;
  sparklinePoints: SparklinePoint[];
}

/**
 * Picks the seeded market to feature in the hero's live demo card. Rather
 * than hardcoding a market's generated id (ids are `IdGen`-assigned at seed
 * time, not stable literals) or matching brittle question text, this ranks
 * every currently-`open` market across the three seeded groups by trade
 * count — a direct proxy for "has a good-looking price history" (task-14a
 * brief) — and takes the busiest one. Against the current seed data this
 * deterministically lands on `sl-10k` ("Will Marcus actually run the 10k on
 * Saturday?"): ten trades with real back-and-forth swings, a question that
 * reads well cold, and Sunday League is explicitly called out in the brief
 * as one of the two strongest groups for this. Falls back gracefully
 * (`null`) if the seed ever ships with zero open markets, so the page still
 * renders a coherent hero rather than throwing.
 */
async function loadFeaturedMarket(store: DataStore): Promise<FeaturedMarketData | null> {
  const groups = (
    await Promise.all(SEEDED_GROUP_SLUGS.map((slug) => store.groups.findBySlug(slug)))
  ).filter((g): g is Group => g !== undefined);

  const candidates: { group: Group; market: Market; tradeCount: number }[] = [];
  for (const group of groups) {
    const markets = await store.markets.listByGroup(group.id);
    for (const market of markets) {
      if (market.status !== "open") continue;
      const trades = await store.trades.listByMarket(market.id);
      candidates.push({ group, market, tradeCount: trades.length });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.tradeCount - a.tradeCount || a.market.question.localeCompare(b.market.question));
  const { group, market } = candidates[0]!;

  const engine = getEngine(market.pricing.kind);
  const prices = engine.currentPrices(toMarketState(market.pricing, market.status));

  const [trades, positions, messages, history] = await Promise.all([
    store.trades.listByMarket(market.id),
    store.positions.listByMarket(market.id),
    store.messages.listMessages(market.id, { limit: 500 }),
    store.priceHistory.listByMarket(market.id),
  ]);

  const outcomes: DemoMarketOutcome[] = market.outcomes
    .map((o) => ({ id: o.id, label: o.label, price: prices[o.id] ?? 0 }))
    .sort((a, b) => b.price - a.price);

  const volume = trades.reduce((sum, t) => add(sum, t.cost), zero());
  const traderCount = new Set(trades.map((t) => t.userId)).size;

  const participantIds = new Set<UserId>([market.creatorId, ...positions.map((p) => p.userId)]);
  const users = (await Promise.all([...participantIds].map((id) => store.users.findById(id)))).filter(
    (u): u is User => u !== undefined,
  );
  const avatars: AvatarStackItem[] = users.map((u) => ({
    id: u.id,
    initials: u.avatarInitials,
    color: u.avatarColor,
  }));

  const leadingOutcomeId = outcomes[0]?.id as OutcomeId | undefined;
  const sparklinePoints: SparklinePoint[] =
    leadingOutcomeId !== undefined
      ? history
          .filter((point) => point.prices[leadingOutcomeId] !== undefined)
          .map((point) => ({ at: point.at.getTime(), p: point.prices[leadingOutcomeId]! }))
      : [];

  return {
    group,
    market,
    outcomes,
    avatars,
    participantCount: participantIds.size,
    volume,
    traderCount,
    messageCount: messages.length,
    sparklinePoints,
  };
}

/**
 * The marketing home (SPEC §3.1). Server Component — reads straight through
 * `getContainer()`, same pattern as the group dashboard (Task 9). No auth
 * required; this is the one page every visitor, signed in or not, lands on
 * first, so it renders identically either way.
 */
export default async function MarketingHome() {
  const { store, clock } = await getContainer();
  const now = clock.now();
  const featured = await loadFeaturedMarket(store);

  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingNav />

      <Hero
        demo={
          featured ? (
            <DemoMarketCard
              groupEmoji={featured.group.emoji}
              groupName={featured.group.name}
              question={featured.market.question}
              closesAt={featured.market.closesAt}
              now={now}
              avatars={featured.avatars}
              participantCount={featured.participantCount}
              outcomes={featured.outcomes}
              volume={featured.volume}
              traderCount={featured.traderCount}
              messageCount={featured.messageCount}
              sparklinePoints={featured.sparklinePoints}
            />
          ) : null
        }
      />

      <div className="flex flex-col gap-20 pb-24 sm:gap-28">
        <FeaturePanels />
        <HowItWorks />
      </div>

      <MarketingFooter />
    </div>
  );
}
