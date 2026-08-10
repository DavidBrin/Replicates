import Link from "next/link";
import { cn } from "@/lib/cn";

export type ExploreFilter = "" | "binary" | "multi" | "headToHead" | "closingSoon";

const CHIPS: { id: ExploreFilter; label: string }[] = [
  { id: "", label: "All" },
  { id: "binary", label: "Binary" },
  { id: "multi", label: "Multi-outcome" },
  { id: "headToHead", label: "Head-to-head" },
  { id: "closingSoon", label: "Closing soon" },
];

export interface ChipRowProps {
  category?: string;
  q?: string;
  activeFilter: ExploreFilter;
}

function buildHref(category: string | undefined, q: string | undefined, filter: ExploreFilter): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  if (filter) params.set("filter", filter);
  const qs = params.toString();
  return qs ? `/explore?${qs}` : "/explore";
}

/** Row 3 — Polymarket's chip filter row (SPEC §7.3): `All` plus topical
 * chips, horizontally scrollable, layered under Kalshi's category strip.
 * Our seed data has no per-market tag taxonomy to scrape (real Polymarket's
 * chips are event/tag-driven and rotate daily, research/polymarket.md
 * §1.3) — chips here instead filter by card *shape*, a real, derivable
 * dimension of the exact same data every card already renders from. Plain
 * links (server-renderable, no client JS) — `page.tsx` reads `?filter=`. */
export function ChipRow({ category, q, activeFilter }: ChipRowProps) {
  return (
    <nav aria-label="Filters" className="overflow-x-auto">
      <ul className="flex min-w-max items-center gap-2 py-3">
        {CHIPS.map((chip) => {
          const isActive = chip.id === activeFilter;
          return (
            <li key={chip.id || "all"}>
              <Link
                href={buildHref(category, q, chip.id)}
                className={cn(
                  "inline-flex h-8 items-center rounded-(--radius-pill) border px-3 text-xs font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "border-(--accent) bg-(--accent)/15 text-(--accent)"
                    : "border-(--border) text-(--text-2) hover:border-(--border-2) hover:text-(--text-1)",
                )}
              >
                {chip.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
