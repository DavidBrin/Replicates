"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import type { MarketStatus } from "@/domain/entities";
import {
  formatCredits,
  formatCreditsPrecise,
  formatPriceCents,
  formatProbability,
} from "@/domain/formatters";
import { credits, mul, toDecimal } from "@/domain/money";
import { ApiError, postTrade, type OrderInput } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useTradeRefresh } from "@/components/market/TradeRefreshProvider";
import { useDebouncedQuote } from "./useDebouncedQuote";

export interface OrderTicketOutcome {
  id: string;
  label: string;
  /** Current probability, 0..1. */
  price: number;
  color: string;
}

export interface OrderTicketPosition {
  outcomeId: string;
  shares: number;
}

export interface OrderTicketProps {
  marketId: string;
  /** The market's EFFECTIVE status (already passed through
   * `nextStatusForClock` by the caller). */
  status: MarketStatus;
  outcomes: OrderTicketOutcome[];
  /** Credits (integer cents). */
  balance: number;
  minStake: number;
  maxStake: number;
  myPositions: OrderTicketPosition[];
  className?: string;
}

type Side = "buy" | "sell";

const QUICK_CHIPS = [10, 25, 50] as const;

/**
 * Slippage tolerance applied to a displayed quote before submitting
 * (task-10-brief's ambiguity resolution: "a `maxCost` equal to the
 * displayed quote's cost plus a 2% tolerance"). Read literally as "+2%" on
 * both sides, that would actually make a SELL *less* forgiving: per
 * `domain/pricing/types.ts`'s `Order.maxCost` doc comment, `maxCost` on a
 * sell is a LOWER bound on realized proceeds ("reject if realized proceeds
 * fall short of it") — raising that floor by 2% would reject MORE trades on
 * ordinary price movement between quote and execute, the opposite of what a
 * slippage tolerance is for. So the tolerance is applied in the direction
 * that actually protects the trader: a buy's acceptable cost widens
 * upward (+2%, rounded up — never charge the trader for the house's
 * rounding), a sell's acceptable proceeds floor loosens downward (−2%,
 * rounded down).
 */
const SLIPPAGE_FACTOR: Record<Side, number> = { buy: 1.02, sell: 0.98 };

/**
 * The order ticket (SPEC §5.2): outcome tabs, Buy/Sell toggle, a credits
 * amount field with quick chips (10/25/50/Max), a live debounced quote, and
 * a submit button whose disabled state always carries an explicit reason
 * string. Every submitted trade includes a `maxCost` slippage bound — the
 * server (`POST /trades`) re-derives its own quote from committed state and
 * enforces it; this component's own quote is never authoritative (G3).
 */
export function OrderTicket({
  marketId,
  status,
  outcomes,
  balance,
  minStake,
  maxStake,
  myPositions,
  className,
}: OrderTicketProps) {
  const toast = useToast();
  const { notify } = useTradeRefresh();
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? "");
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("25");
  const [sellAllShares, setSellAllShares] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // "Sell all shares" mode is only meaningful for the exact (side, outcome)
  // pair it was chosen for — reset it directly in whichever handler changes
  // either, rather than an effect (an effect that only mirrors a prior
  // event back into state is the classic "adjusting state in response to a
  // prop/state change" anti-pattern React's own docs warn against).
  function selectOutcome(id: string): void {
    setOutcomeId(id);
    setSellAllShares(false);
  }
  function selectSide(next: Side): void {
    setSide(next);
    setSellAllShares(false);
  }

  const heldShares = myPositions.find((p) => p.outcomeId === outcomeId)?.shares ?? 0;
  const selectedOutcome = outcomes.find((o) => o.id === outcomeId);

  const order: OrderInput | null = useMemo(() => {
    if (!outcomeId || status !== "open") return null;
    if (side === "sell" && sellAllShares) {
      return heldShares > 0 ? { outcomeId, side, shares: heldShares } : null;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { outcomeId, side, budget: n };
  }, [outcomeId, status, side, sellAllShares, heldShares, amount]);

  const { quote, loading: quoteLoading, error: quoteError } = useDebouncedQuote(marketId, order);

  function selectChip(value: number | "max"): void {
    if (value === "max") {
      if (side === "sell") {
        setSellAllShares(true);
      } else {
        setSellAllShares(false);
        setAmount(String(toDecimal(credits(Math.min(balance, maxStake)))));
      }
      return;
    }
    setSellAllShares(false);
    setAmount(String(value));
  }

  const minStakeDecimal = toDecimal(credits(minStake));

  let disabledReason: string | null = null;
  if (status !== "open") {
    disabledReason = "Market closed";
  } else if (!selectedOutcome) {
    disabledReason = "Pick an outcome";
  } else if (side === "sell" && heldShares <= 0) {
    disabledReason = `You don't hold any ${selectedOutcome.label}`;
  } else if (!order) {
    disabledReason = "Enter an amount";
  } else if (quoteError) {
    disabledReason = quoteError;
  } else if (!quote) {
    disabledReason = quoteLoading ? "Getting a quote…" : "Enter an amount";
  } else if (side === "buy" && quote.cost < minStake) {
    disabledReason = `Below the ${minStakeDecimal} credit minimum`;
  } else if (side === "buy" && quote.cost > balance) {
    disabledReason = "Not enough credits";
  }

  async function submit(): Promise<void> {
    if (!order || !quote || disabledReason) return;
    setSubmitting(true);
    try {
      const roundedCost = credits(Math.round(quote.cost));
      const maxCost = toDecimal(mul(roundedCost, SLIPPAGE_FACTOR[side], side === "buy" ? "up" : "down"));
      const result = await postTrade(marketId, { ...order, maxCost });
      toast.show({
        title: "Trade placed",
        description: `${side === "buy" ? "Bought" : "Sold"} ${Math.round(result.quote.shares)} ${selectedOutcome?.label ?? ""} @ ${formatPriceCents(result.quote.avgPrice)}`,
        variant: "success",
      });
      setSellAllShares(false);
      notify();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong placing that trade.";
      toast.show({ title: "Trade failed", description: message, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-4",
        className,
      )}
    >
      <div role="tablist" aria-label="Outcome" className="flex flex-wrap gap-2">
        {outcomes.map((o) => {
          const active = o.id === outcomeId;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectOutcome(o.id)}
              className={cn(
                "flex items-center gap-2 rounded-(--radius-input) border px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-2)",
                active
                  ? "border-(--accent) bg-(--accent)/10 text-(--text-1)"
                  : "border-(--border) text-(--text-2) hover:border-(--border-2) hover:text-(--text-1)",
              )}
            >
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: o.color }} />
              {o.label}
              <span className="tnum text-(--text-3)">{formatProbability(o.price)}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={side === "buy" ? "yes" : "secondary"}
          aria-pressed={side === "buy"}
          onClick={() => selectSide("buy")}
        >
          Buy
        </Button>
        <Button
          type="button"
          variant={side === "sell" ? "no" : "secondary"}
          aria-pressed={side === "sell"}
          onClick={() => selectSide("sell")}
        >
          Sell
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="order-amount" className="text-xs font-medium text-(--text-2)">
          {side === "sell" && sellAllShares ? "Selling entire position" : "Amount (credits)"}
        </label>
        {side === "sell" && sellAllShares ? (
          <div className="tnum rounded-(--radius-input) border border-(--border) bg-(--surface-3) px-3 py-2 text-sm text-(--text-1)">
            {heldShares.toFixed(2)} shares
          </div>
        ) : (
          <Input
            id="order-amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setSellAllShares(false);
              setAmount(e.target.value);
            }}
          />
        )}
        <div className="flex gap-2">
          {QUICK_CHIPS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => selectChip(v)}
              className="tnum rounded-(--radius-pill) border border-(--border) px-2.5 py-1 text-xs text-(--text-2) transition-colors hover:border-(--border-2) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            onClick={() => selectChip("max")}
            className="rounded-(--radius-pill) border border-(--border) px-2.5 py-1 text-xs text-(--text-2) transition-colors hover:border-(--border-2) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
          >
            Max
          </button>
        </div>
      </div>

      <div className="tnum flex flex-col gap-1.5 rounded-(--radius-input) bg-(--surface-3) px-3 py-2.5 text-sm">
        <QuoteRow label="Shares" value={quote ? quote.shares.toFixed(2) : "—"} />
        <QuoteRow label="Avg price" value={quote ? formatPriceCents(quote.avgPrice) : "—"} />
        <QuoteRow
          label="To win"
          value={quote ? formatCreditsPrecise(credits(Math.round(quote.shares * 100))) : "—"}
        />
        <QuoteRow label="Price impact" value={quote ? formatProbability(quote.priceImpact) : "—"} />
        <QuoteRow label="Fee" value={quote ? formatCreditsPrecise(credits(Math.round(quote.fee))) : "—"} />
      </div>

      <Button
        type="button"
        data-testid="order-submit"
        variant={side === "buy" ? "yes" : "no"}
        disabled={!!disabledReason || submitting}
        loading={submitting}
        onClick={submit}
      >
        {disabledReason ?? `${side === "buy" ? "Buy" : "Sell"} ${selectedOutcome?.label ?? ""}`}
      </Button>

      <p className="tnum text-xs text-(--text-3)">Balance: {formatCredits(credits(balance))}</p>
    </div>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-(--text-2)">{label}</span>
      <span className="font-medium text-(--text-1)">{value}</span>
    </div>
  );
}
