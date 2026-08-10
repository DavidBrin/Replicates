import { ProbabilityChartInteractive } from "@/components/charts/ProbabilityChartInteractive";
import type { ChartSeries } from "@/components/charts/ProbabilityChart";
import { formatMultiplier, formatPriceCents, formatProbability } from "@/domain/formatters";
import { cn } from "@/lib/cn";

export interface PricePanelOutcome {
  id: string;
  label: string;
  /** Probability, 0..1. */
  price: number;
  color: string;
}

export interface PricePanelProps {
  outcomes: PricePanelOutcome[];
  series: ChartSeries[];
  /** Probability-point change vs. 24h ago for the leading outcome, or
   * `null` when there isn't enough history to compute one yet. */
  delta: number | null;
  className?: string;
}

/**
 * The price panel (SPEC §3.3/§5.3, task-9-brief's ambiguity resolution):
 * the leading outcome's probability as a large numeral with a 24h delta
 * chip, `ProbabilityChartInteractive` with one series per outcome, and a
 * legend showing each outcome's current price and payout multiplier.
 * Server-renderable except for the chart's hover-crosshair layer.
 */
export function PricePanel({ outcomes, series, delta, className }: PricePanelProps) {
  const leading = [...outcomes].sort((a, b) => b.price - a.price)[0];

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-4",
        className,
      )}
    >
      {leading ? (
        <div className="flex items-baseline gap-3" data-testid="market-leading-probability">
          <span className="tnum text-4xl font-semibold text-(--text-1)">{formatProbability(leading.price)}</span>
          <span className="text-sm text-(--text-2)">{leading.label}</span>
          {delta !== null ? <DeltaChip delta={delta} /> : null}
        </div>
      ) : null}

      <div className="w-full overflow-x-auto">
        <ProbabilityChartInteractive series={series} width={640} height={220} className="min-w-[480px]" />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-(--border) pt-3">
        {outcomes.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-(--text-1)">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: o.color }} />
              {o.label}
            </span>
            <span className="tnum flex items-center gap-3 text-(--text-2)">
              {formatPriceCents(o.price)}
              <span className="text-(--text-3)">{formatMultiplier(o.price)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeltaChip({ delta }: { delta: number }) {
  const rounded = Math.round(delta * 100);
  if (rounded === 0) {
    return <span className="tnum rounded-(--radius-pill) bg-(--surface-3) px-2 py-0.5 text-xs text-(--text-3)">—</span>;
  }
  const positive = rounded > 0;
  return (
    <span
      className={cn(
        "tnum rounded-(--radius-pill) px-2 py-0.5 text-xs font-medium",
        positive ? "bg-(--yes-bg) text-(--yes)" : "bg-(--no-bg) text-(--no)",
      )}
    >
      {positive ? "▲" : "▼"}
      {Math.abs(rounded)}
    </span>
  );
}
