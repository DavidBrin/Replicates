import { formatCreditsPrecise, formatRateBps } from "@/domain/formatters";
import { credits } from "@/domain/money";
import { cn } from "@/lib/cn";
import {
  ResolutionPanel,
  type ResolutionOutcomeOption,
  type ResolutionPanelClientView,
  type ResolutionParticipant,
} from "./ResolutionPanel";

const PRICING_BLURB: Record<string, string> = {
  lmsr: "Market-priced — prices move automatically as people trade, like a real prediction market.",
  fixedOdds: "Set odds — the creator fixed the opening prices; trades settle peer-to-peer at those odds.",
  parimutuel: "Pool — everyone stakes into a pot; winners split it pro-rata.",
};

export interface RulesPanelProps {
  marketId: string;
  resolutionCriteria: string;
  resolutionSource?: string;
  /** Decimal credits. */
  minStake: number;
  maxStake: number;
  stakesVisible: boolean;
  pricingKind: string;
  feeBps: number;
  outcomes: ResolutionOutcomeOption[];
  participants: ResolutionParticipant[];
  resolutionView: ResolutionPanelClientView;
  winningOutcomeId?: string;
  votes?: Record<string, string>;
  now: string;
  className?: string;
}

/** "Rules & resolution" tab (SPEC §3.3): resolution criteria/source, stake
 * limits, the pricing model in plain language, and the resolution UI itself
 * (`ResolutionPanel`). Server-renderable except the embedded resolution
 * actions. */
export function RulesPanel({
  marketId,
  resolutionCriteria,
  resolutionSource,
  minStake,
  maxStake,
  stakesVisible,
  pricingKind,
  feeBps,
  outcomes,
  participants,
  resolutionView,
  winningOutcomeId,
  votes,
  now,
  className,
}: RulesPanelProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold tracking-wide text-(--text-2) uppercase">Resolution criteria</h3>
        <p className="text-sm whitespace-pre-wrap text-(--text-1)">{resolutionCriteria}</p>
        {resolutionSource ? (
          <p className="text-xs text-(--text-3)">Source: {resolutionSource}</p>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Min stake" value={formatCreditsPrecise(credits(Math.round(minStake * 100)))} />
        <Stat label="Max stake" value={formatCreditsPrecise(credits(Math.round(maxStake * 100)))} />
        <Stat label="Stakes visible" value={stakesVisible ? "Yes" : "No"} />
        <Stat label="Fee" value={formatRateBps(feeBps)} />
      </section>

      {/* The fee is charged at THIS market's own rate (it used to display
          the market's `feeBps` while `trading.ts` billed a hard-coded 7%),
          on a Kalshi-shaped base that shrinks as the market approaches a
          lock — so the headline rate is the ceiling, never a surprise. */}
      {feeBps > 0 ? (
        <p className="-mt-2 text-xs text-(--text-3)">
          Charged per trade on {formatRateBps(feeBps)} of shares × price × (1 − price), so it costs
          most when the market is a coin flip and fades to nothing near a lock.
        </p>
      ) : null}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold tracking-wide text-(--text-2) uppercase">Pricing</h3>
        <p className="text-sm text-(--text-1)">{PRICING_BLURB[pricingKind] ?? pricingKind}</p>
      </section>

      <section className="flex flex-col gap-2 border-t border-(--border) pt-4">
        <h3 className="text-xs font-semibold tracking-wide text-(--text-2) uppercase">Resolution</h3>
        <ResolutionPanel
          marketId={marketId}
          outcomes={outcomes}
          participants={participants}
          view={resolutionView}
          winningOutcomeId={winningOutcomeId}
          votes={votes}
          now={now}
        />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius-input) bg-(--surface-3) px-3 py-2">
      <span className="text-xs text-(--text-3)">{label}</span>
      <span className="tnum font-medium text-(--text-1)">{value}</span>
    </div>
  );
}
