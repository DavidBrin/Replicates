import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, Users } from "lucide-react";
import { BinaryGaugeCard } from "@/components/explore/BinaryGaugeCard";
import { CardFooter } from "@/components/explore/CardFooter";
import { HeadToHeadCard } from "@/components/explore/HeadToHeadCard";
import { MultiOutcomeRows } from "@/components/explore/MultiOutcomeRows";
import { OrderBookDepth } from "@/components/explore/OrderBookDepth";
import { PriceChartPanel } from "@/components/explore/PriceChartPanel";
import { deriveCardVariant } from "@/components/explore/variant";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCredits, formatCountdown, formatVolume } from "@/domain/formatters";
import { getExploreMarketDetail } from "../data";

interface ExploreDetailPageProps {
  params: Promise<{ id: string }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  politics: "Politics",
  sports: "Sports",
  crypto: "Crypto",
  culture: "Culture",
  economics: "Economics",
  climate: "Climate",
  tech: "Tech",
};

export async function generateMetadata({ params }: ExploreDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = await getExploreMarketDetail(id);
  if (!detail) return { title: "Market not found — Explore — Bet" };
  return {
    title: `${detail.view.market.question} — Explore — Bet`,
    description: detail.view.market.resolutionCriteria,
  };
}

/**
 * `/explore/[id]` (SPEC §3.6): read-only market detail — question header,
 * `ProbabilityChart` over the 90-day history with working timeframe
 * toggles, the outcome list (reusing the same card-body components as the
 * grid, un-truncated), a display-only order-book depth table, holders,
 * and rules/resolution text. Never renders a private market — `./data.ts`'s
 * `getExploreMarketDetail` returns `null` for anything that isn't
 * `visibility: "public"`, which this maps straight to `notFound()`.
 */
export default async function ExploreDetailPage({ params }: ExploreDetailPageProps) {
  const { id } = await params;
  const detail = await getExploreMarketDetail(id);
  if (!detail) notFound();

  const { view, history } = detail;
  const { market, prices } = view;
  const now = new Date();
  const variant = deriveCardVariant(market.outcomes);
  const categoryLabel = market.category ? (CATEGORY_LABELS[market.category] ?? market.category) : null;
  const msRemaining = market.closesAt.getTime() - now.getTime();

  const series = market.outcomes.map((o) => ({
    outcomeId: o.id,
    label: o.label,
    color: o.color,
    points: history.map((p) => ({ at: p.at.getTime(), p: p.prices[o.id] ?? 0 })),
  }));

  // The order-book ladder must center on the same price the page's own
  // gauge/outcome list already shows prominently — for a binary market
  // that's specifically the Yes price (21% in the gauge), not whichever
  // side happens to be leading (which, for a longshot Yes, is No). Using
  // `Math.max` here would silently anchor the book to the wrong side and
  // read as inconsistent with the rest of the page (found by looking at
  // this in the browser: a "21% chance" gauge next to a book centered on
  // 79¢). Multi/head-to-head markets have no single "Yes" to prefer, so
  // they fall back to the leading outcome's price.
  const yesOutcome = market.outcomes.find((o) => o.label === "Yes");
  const orderBookPrice =
    variant === "binary" && yesOutcome ? (prices[yesOutcome.id] ?? 0) : Math.max(0, ...Object.values(prices));

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-6 sm:px-6 xl:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {categoryLabel ? (
            <Badge tone="neutral" className="tracking-wide uppercase">
              {categoryLabel}
            </Badge>
          ) : null}
          <Badge tone="accent">Public showcase</Badge>
        </div>
        <h1 className="mb-3 text-2xl font-semibold text-(--text-1) sm:text-3xl">{market.question}</h1>
        <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-(--text-2)">
          <span className="tabular-nums">${formatVolume(view.volume)} Vol.</span>
          <span className="flex items-center gap-1 tabular-nums">
            <Users className="size-3.5" aria-hidden="true" />
            {view.holderCount} traders
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="size-3.5" aria-hidden="true" />
            {msRemaining > 0 ? `Closes in ${formatCountdown(msRemaining)}` : "Closed"}
          </span>
        </div>

        <Card className="mb-6">
          <PriceChartPanel series={series} />
        </Card>

        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-(--text-1)">Outcomes</h2>
          {variant === "multi" ? (
            <MultiOutcomeRows outcomes={market.outcomes} prices={prices} maxRows={market.outcomes.length} />
          ) : null}
          {variant === "binary" ? (
            <BinaryGaugeCard yesProbability={yesOutcome ? (prices[yesOutcome.id] ?? 0) : 0} />
          ) : null}
          {variant === "headToHead" ? <HeadToHeadCard outcomes={market.outcomes} prices={prices} /> : null}
          <CardFooter question={market.question} volume={view.volume} closesAt={market.closesAt} now={now} />
        </Card>

        <Card className="mb-6">
          <OrderBookDepth marketId={market.id} midPrice={orderBookPrice} />
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-(--text-1)">Rules &amp; resolution</h2>
          <p className="mb-3 text-sm text-(--text-2)">{market.resolutionCriteria}</p>
          {market.resolutionSource ? (
            <p className="text-xs text-(--text-3)">
              Resolution source: <span className="text-(--text-2)">{market.resolutionSource}</span>
            </p>
          ) : null}
        </Card>
      </div>

      <div className="w-full xl:w-[300px] xl:shrink-0">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-(--text-1)">Market stats</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-(--text-3)">Volume</dt>
              <dd className="tabular-nums text-(--text-1)">${formatCredits(view.volume)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-(--text-3)">Trades</dt>
              <dd className="tabular-nums text-(--text-1)">{view.tradeCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-(--text-3)">Holders (distinct traders)</dt>
              <dd className="tabular-nums text-(--text-1)">{view.holderCount}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
