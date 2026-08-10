import { EmptyState } from "@/components/ui/EmptyState";
import { formatCreditsPrecise, formatPriceCents } from "@/domain/formatters";
import { credits, sub } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface PositionSummaryItem {
  outcomeId: string;
  outcomeLabel: string;
  shares: number;
  /** Credits (integer cents). */
  costBasis: number;
  /** Current probability, 0..1 — used to mark the position to market. */
  currentPrice: number;
}

export interface PositionSummaryProps {
  positions: PositionSummaryItem[];
  className?: string;
}

/** "Your position" tab (SPEC §3.3): shares, average cost, current value and
 * unrealized P/L per outcome you hold. Server-renderable. */
export function PositionSummary({ positions, className }: PositionSummaryProps) {
  const held = positions.filter((p) => p.shares > 0);

  if (held.length === 0) {
    return (
      <EmptyState
        title="No position yet"
        description="Place a trade to show up here."
        className={className}
      />
    );
  }

  return (
    <div data-testid="position-summary" className={cn("flex flex-col gap-3", className)}>
      {held.map((p) => {
        const avgCostPerShare = p.shares > 0 ? p.costBasis / p.shares / 100 : 0;
        const currentValue = credits(Math.round(p.shares * p.currentPrice * 100));
        // `avgCostPerShare` is a 0–1 fraction of a credit (cents/share ÷
        // 100) — `formatPriceCents` is what turns that back into the "76¢"
        // display, matching how the rest of the app renders per-share
        // prices (G6: no hand-rolled `toFixed` + `¢` in the component).
        const unrealizedPnl = sub(currentValue, credits(p.costBasis));
        return (
          <div
            key={p.outcomeId}
            data-testid="position-row"
            data-outcome-label={p.outcomeLabel}
            data-shares={p.shares}
            className="grid grid-cols-2 gap-2 rounded-(--radius-input) bg-(--surface-3) px-3 py-2.5 text-sm sm:grid-cols-4"
          >
            <Field label="Outcome" value={p.outcomeLabel} />
            <Field label="Shares" value={p.shares.toFixed(2)} tnum />
            <Field label="Avg cost" value={formatPriceCents(avgCostPerShare)} tnum />
            <Field
              label="Unrealized P/L"
              value={`${unrealizedPnl > 0 ? "+" : ""}${formatCreditsPrecise(unrealizedPnl)}`}
              tnum
              tone={unrealizedPnl > 0 ? "yes" : unrealizedPnl < 0 ? "no" : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  tnum,
  tone,
}: {
  label: string;
  value: string;
  tnum?: boolean;
  tone?: "yes" | "no";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-(--text-3)">{label}</span>
      <span
        className={cn(
          "font-medium",
          tnum && "tnum",
          tone === "yes" && "text-(--yes)",
          tone === "no" && "text-(--no)",
          !tone && "text-(--text-1)",
        )}
      >
        {value}
      </span>
    </div>
  );
}
