import Link from "next/link";
import type { ExploreMarketView } from "@/app/explore/data";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";

export interface TrendingRailProps {
  views: readonly ExploreMarketView[];
  className?: string;
}

function leadingProbability(prices: Record<string, number>): number {
  const values = Object.values(prices);
  return values.length === 0 ? 0 : Math.max(...values);
}

/** Right-rail Trending list (SPEC §7.3, research/kalshi.md §1.4's "a
 * 'Trending' mini-list"): rank, question, leading-outcome percentage.
 * `views` is expected pre-sorted by volume (the same trending order `GET
 * /api/explore` uses). Server-renderable. */
export function TrendingRail({ views, className }: TrendingRailProps) {
  return (
    <Card className={className}>
      <h2 className="mb-3 text-sm font-semibold text-(--text-1)">Trending</h2>
      <ol className="flex flex-col gap-3">
        {views.map((v, i) => (
          <li key={v.market.id}>
            <Link href={`/explore/${v.market.id}`} className="group flex items-center gap-3">
              <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-(--text-3)">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-(--text-1) group-hover:text-(--accent)">
                {v.market.question}
              </span>
              <Pill value={leadingProbability(v.prices)} className="shrink-0" />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
