import Link from "next/link";
import type { ExploreMarketView } from "@/app/explore/data";
import { Badge } from "@/components/ui/Badge";
import { BinaryGaugeCard } from "./BinaryGaugeCard";
import { CardFooter } from "./CardFooter";
import { HeadToHeadCard } from "./HeadToHeadCard";
import { MultiOutcomeRows } from "./MultiOutcomeRows";
import { deriveCardVariant, isCompactBinary } from "./variant";

export interface ExploreMarketCardProps {
  view: ExploreMarketView;
  now: Date;
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

/**
 * Card shell shared by all three variants (SPEC §7.3): Polymarket's grid
 * card (12px radius, hover lift) with a "stretched link" to `/explore/[id]`
 * — the whole card is clickable, EXCEPT the Yes/No/team buttons and the
 * bookmark icon, which sit above it and never navigate. The link is the
 * bottom-most element (`z-0`); the content column above it is
 * `pointer-events-none` so clicks pass through to the link everywhere
 * except the two interactive leaf components, which each opt back in with
 * `pointer-events-auto` (see `ShowcaseButton`/`BookmarkButton`) — a real
 * `<a>` never ends up wrapping a `<button>` (invalid HTML, breaks a11y),
 * and there's exactly one focusable link per card for keyboard users.
 * Server-renderable.
 */
export function ExploreMarketCard({ view, now }: ExploreMarketCardProps) {
  const { market, prices } = view;
  const variant = deriveCardVariant(market.outcomes);
  const yesOutcome = market.outcomes.find((o) => o.label === "Yes");
  // Task 13 fix round 1: about half of binary markets render as the compact
  // list row instead of the circular gauge (see `isCompactBinary`'s doc
  // comment) — reuses `MultiOutcomeRows`, filtered to the single "Yes" row,
  // which already renders exactly the `label — % — [Yes][No]` shape.
  const compactBinary = variant === "binary" && !!yesOutcome && isCompactBinary(market.id);
  const categoryLabel = market.category ? (CATEGORY_LABELS[market.category] ?? market.category) : null;

  return (
    <div className="relative flex flex-col rounded-(--radius-card) border border-(--border) bg-(--surface-1) p-3 transition-colors hover:border-(--border-2) hover:bg-(--surface-2)">
      <Link
        href={`/explore/${market.id}`}
        aria-label={market.question}
        className="absolute inset-0 z-0 rounded-(--radius-card) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-1)"
      />
      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
        {categoryLabel ? (
          <Badge tone="neutral" className="mb-1 w-fit tracking-wide uppercase">
            {categoryLabel}
          </Badge>
        ) : null}
        <p className="mb-2 line-clamp-2 text-[15px] font-semibold text-(--text-1)">{market.question}</p>
        <div className="flex-1">
          {variant === "multi" ? <MultiOutcomeRows outcomes={market.outcomes} prices={prices} /> : null}
          {variant === "binary" && compactBinary && yesOutcome ? (
            <MultiOutcomeRows outcomes={[yesOutcome]} prices={prices} maxRows={1} />
          ) : null}
          {variant === "binary" && !compactBinary ? (
            <BinaryGaugeCard yesProbability={yesOutcome ? (prices[yesOutcome.id] ?? 0) : 0} />
          ) : null}
          {variant === "headToHead" ? <HeadToHeadCard outcomes={market.outcomes} prices={prices} /> : null}
        </div>
        <CardFooter question={market.question} volume={view.volume} closesAt={market.closesAt} now={now} />
      </div>
    </div>
  );
}
