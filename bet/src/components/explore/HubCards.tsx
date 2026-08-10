import { formatVolume } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { Card } from "@/components/ui/Card";

export interface HubCardsProps {
  totalVolume: Credits;
  marketCount: number;
  categoryCount: number;
  className?: string;
}

/** Two right-rail "hub" cards (SPEC §7.3) mirroring both sources' own
 * volume-summary rails: a Kalshi-style promoted-hero total-volume card
 * (research/kalshi.md §1.4: "$496,816,868 Total vol") and a Polymarket-
 * style coverage stat. Server-renderable. */
export function HubCards({ totalVolume, marketCount, categoryCount, className }: HubCardsProps) {
  return (
    <div className={className}>
      <Card className="border-(--accent)/35 bg-(--surface-2)">
        <p className="text-xs font-medium tracking-wide text-(--text-3) uppercase">Explore</p>
        <p className="mt-1 text-2xl font-semibold text-(--text-1) tabular-nums">${formatVolume(totalVolume)}</p>
        <p className="text-xs text-(--text-3)">Total vol. across public markets</p>
      </Card>
      <Card className="mt-3">
        <p className="text-xs font-medium tracking-wide text-(--text-3) uppercase">Coverage</p>
        <p className="mt-1 text-2xl font-semibold text-(--text-1) tabular-nums">{marketCount}</p>
        <p className="text-xs text-(--text-3)">markets across {categoryCount} categories</p>
      </Card>
    </div>
  );
}
