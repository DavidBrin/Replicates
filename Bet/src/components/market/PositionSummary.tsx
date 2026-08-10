import { EmptyState } from "@/components/ui/EmptyState";
import { formatCreditsPrecise, formatPriceCents } from "@/domain/formatters";
import { credits, sub } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface PositionSummaryItem {
  outcomeId: string;
  outcomeLabel: string;
  shares: number;
  /**
   * Credits (integer cents) still tied up in this position — a **running
   * residual**, reduced on every partial sell, NOT a historical total and
   * NOT something to divide by `shares` for an average (finding C; see
   * `src/domain/position-ledger.ts` for why that drifts). It is exactly the
   * right basis for unrealized P/L against the current mark, which is the
   * only thing it's used for here.
   */
  costBasis: number;
  /**
   * Average acquisition price per share as a 0..1 fraction of a credit,
   * derived by the caller from the trade ledger
   * (`domain/position-ledger.ts`'s `averageBuyPrice`: Σ buy cost ÷ Σ buy
   * shares). Required, not optional, so no caller can quietly fall back to
   * the residual-derived average this replaced.
   */
  avgCostPerShare: number;
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
        const currentValue = credits(Math.round(p.shares * p.currentPrice * 100));
        // `avgCostPerShare` arrives as a 0–1 fraction of a credit, already
        // derived from the trade ledger by the caller — `formatPriceCents`
        // turns that into the "76¢" display, matching how the rest of the
        // app renders per-share prices (G6: no hand-rolled `toFixed` + `¢`
        // in the component). Unrealized P/L, by contrast, is correctly
        // measured against the *residual* `costBasis`: it asks what the
        // shares still held are worth versus what is still sunk in them.
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
            <Field label="Avg cost" value={formatPriceCents(p.avgCostPerShare)} tnum />
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
