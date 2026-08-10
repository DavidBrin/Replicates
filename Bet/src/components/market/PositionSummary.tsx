import { EmptyState } from "@/components/ui/EmptyState";
import { formatCreditsPrecise, formatPriceCents, formatShares } from "@/domain/formatters";
import { credits, sub, type Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface PositionSummaryItem {
  outcomeId: string;
  outcomeLabel: string;
  shares: number;
  /**
   * Credits still tied up in this position — a **running residual**,
   * reduced on every partial sell, NOT a historical total and NOT something
   * to divide by `shares` for an average (finding C; see
   * `src/domain/position-ledger.ts` for why that drifts). It is exactly the
   * right basis for unrealized P/L against the current mark, which is the
   * only thing it's used for here.
   */
  costBasis: Credits;
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

/**
 * Everything a RESOLVED market's position tab needs. Present only when
 * `market.status === "resolved"`; its presence is what switches this
 * component from a live mark-to-market view to a settled one.
 */
export interface PositionSummarySettlement {
  /** The outcome that actually won — rows for anything else settled at 0. */
  winningOutcomeId: string;
  winningLabel: string;
  /** What settlement actually paid this viewer (`engine.settle`). */
  payout: Credits;
  /** `payout − net spent`, from `domain/services/realized-pnl.ts` — the
   * same figure `MarketCard`'s settled face shows, not a second derivation. */
  realizedPnl: Credits;
  /** False when the viewer never traded this market. */
  hasPosition: boolean;
}

export interface PositionSummaryProps {
  positions: PositionSummaryItem[];
  /**
   * Set once the market has resolved. A resolved market has no live mark:
   * marking a settled position against `p(winner) = 0.54983` produced an
   * "Unrealized P/L −0.61" in red for a holder who had in fact just been
   * paid 50.00 and was up 21.90. When this is set, the unrealized column is
   * replaced by what settlement actually did.
   */
  settlement?: PositionSummarySettlement;
  className?: string;
}

/** "Your position" tab (SPEC §3.3). While the market is live: shares,
 * average cost and unrealized P/L per outcome held. Once it has resolved:
 * the settled value of each row plus the payout and realized P/L that were
 * actually banked. Server-renderable. */
export function PositionSummary({ positions, settlement, className }: PositionSummaryProps) {
  const held = positions.filter((p) => p.shares > 0);

  if (held.length === 0 && !settlement?.hasPosition) {
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
        const won = settlement !== undefined && p.outcomeId === settlement.winningOutcomeId;
        // Settled rows pay par (1 credit per share) on the winner and
        // nothing on every loser — the same rounding `LmsrEngine.settle`
        // applies (floor: never overpay). A live row is marked at the
        // current price instead.
        const currentValue = settlement
          ? credits(won ? Math.floor(p.shares) * 100 : 0)
          : credits(Math.round(p.shares * p.currentPrice * 100));
        // `avgCostPerShare` arrives as a 0–1 fraction of a credit, already
        // derived from the trade ledger by the caller — `formatPriceCents`
        // turns that into the "76¢" display, matching how the rest of the
        // app renders per-share prices (G6: no hand-rolled `toFixed` + `¢`
        // in the component). Unrealized P/L, by contrast, is correctly
        // measured against the *residual* `costBasis`: it asks what the
        // shares still held are worth versus what is still sunk in them.
        const unrealizedPnl = sub(currentValue, p.costBasis);
        return (
          <div
            key={p.outcomeId}
            data-testid="position-row"
            data-outcome-label={p.outcomeLabel}
            data-shares={p.shares}
            className="grid grid-cols-2 gap-2 rounded-(--radius-input) bg-(--surface-3) px-3 py-2.5 text-sm sm:grid-cols-4"
          >
            <Field label="Outcome" value={p.outcomeLabel} />
            <Field label="Shares" value={formatShares(p.shares)} tnum />
            <Field label="Avg cost" value={formatPriceCents(p.avgCostPerShare)} tnum />
            {settlement ? (
              <Field
                label="Settled at"
                value={`${formatCreditsPrecise(currentValue)} · ${won ? "Won" : "Lost"}`}
                tnum
                tone={won ? "yes" : "no"}
              />
            ) : (
              <Field
                label="Unrealized P/L"
                value={`${unrealizedPnl > 0 ? "+" : ""}${formatCreditsPrecise(unrealizedPnl)}`}
                tnum
                tone={unrealizedPnl > 0 ? "yes" : unrealizedPnl < 0 ? "no" : undefined}
              />
            )}
          </div>
        );
      })}

      {settlement ? (
        <div
          data-testid="position-settlement"
          className="grid grid-cols-2 gap-2 rounded-(--radius-input) border border-(--border) px-3 py-2.5 text-sm sm:grid-cols-4"
        >
          <Field label="Resolved" value={settlement.winningLabel} />
          <Field label="Payout" value={formatCreditsPrecise(settlement.payout)} tnum />
          <Field
            label="Realized P/L"
            value={
              settlement.hasPosition
                ? `${settlement.realizedPnl > 0 ? "+" : ""}${formatCreditsPrecise(settlement.realizedPnl)}`
                : "—"
            }
            tnum
            tone={
              !settlement.hasPosition
                ? undefined
                : settlement.realizedPnl > 0
                  ? "yes"
                  : settlement.realizedPnl < 0
                    ? "no"
                    : undefined
            }
          />
        </div>
      ) : null}
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
