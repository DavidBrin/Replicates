import { ChipRow, type ExploreFilter } from "@/components/explore/ChipRow";
import { ExploreMarketCard } from "@/components/explore/ExploreMarketCard";
import { HubCards } from "@/components/explore/HubCards";
import { TrendingRail } from "@/components/explore/TrendingRail";
import { deriveCardVariant } from "@/components/explore/variant";
import { EmptyState } from "@/components/ui/EmptyState";
import { add, zero } from "@/domain/money";
import { listExploreMarkets } from "./data";

interface ExplorePageProps {
  searchParams: Promise<{ category?: string; filter?: string; q?: string }>;
}

const CLOSING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `/explore` (SPEC §3.6): Polymarket's dense fluid grid
 * (`repeat(auto-fill, minmax(300px, 1fr))`, 16px gap) under Kalshi's
 * two-row nav (rendered by the layout) and Polymarket's chip filter row.
 * Server Component — reads straight from the container (see `./data.ts`'s
 * doc comment), filters in-memory over the ~24-market dataset by category
 * tab, chip filter and search query, all driven by the URL so every control
 * is a plain link/form (works with JS disabled, and is what a Playwright
 * `browser_click` on a category tab actually exercises).
 */
export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const { category, filter, q } = await searchParams;
  const now = new Date();
  const all = await listExploreMarkets();

  const byCategory = category ? all.filter((v) => v.market.category === category) : all;
  const byQuery = q
    ? byCategory.filter((v) => v.market.question.toLowerCase().includes(q.toLowerCase()))
    : byCategory;
  const activeFilter = (filter ?? "") as ExploreFilter;
  const filtered = byQuery.filter((v) => {
    if (!activeFilter) return true;
    if (activeFilter === "closingSoon") {
      const remaining = v.market.closesAt.getTime() - now.getTime();
      return remaining > 0 && remaining <= CLOSING_SOON_MS;
    }
    return deriveCardVariant(v.market.outcomes) === activeFilter;
  });

  const totalVolume = all.reduce((sum, v) => add(sum, v.volume), zero());
  const categoryCount = new Set(all.map((v) => v.market.category).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 2xl:max-w-[1760px] 2xl:px-4">
      <ChipRow category={category} q={q} activeFilter={activeFilter} />

      {/*
       * Rail only at 2xl (>=1536px) — SPEC's "4 columns at 1440 and a 300px
       * rail" is numerically impossible in the same width (4*300px cards +
       * 3*16px gaps = 1248px, + 300px rail + gutter blows past any
       * 1440-1480px content width). The real references resolve this by not
       * both being true at once: Polymarket runs 4 full-width columns with
       * no persistent rail; Kalshi is the one with the rail. Below 2xl the
       * grid gets the whole content width (Polymarket's shape); at 2xl+
       * there's enough real estate for both the rail and a full 4 columns,
       * so the container's cap and the gutter/padding both loosen slightly
       * right at that breakpoint to make room for it (Task 13 fix round 1).
       */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_300px] 2xl:items-start 2xl:gap-4">
        <div>
          {filtered.length === 0 ? (
            <EmptyState
              title="No markets here yet"
              description="Try a different category, filter, or search term."
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4">
              {filtered.map((view) => (
                <ExploreMarketCard key={view.market.id} view={view} now={now} />
              ))}
            </div>
          )}
        </div>

        <div className="hidden 2xl:sticky 2xl:top-[120px] 2xl:block">
          <TrendingRail views={all.slice(0, 6)} className="mb-3" />
          <HubCards totalVolume={totalVolume} marketCount={all.length} categoryCount={categoryCount} />
        </div>
      </div>
    </div>
  );
}
