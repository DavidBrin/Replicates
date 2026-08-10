import type { Outcome } from "@/domain/entities";
import { Pill } from "@/components/ui/Pill";
import { ShowcaseButton } from "./ShowcaseButton";

export interface MultiOutcomeRowsProps {
  outcomes: readonly Outcome[];
  prices: Record<string, number>;
  maxRows?: number;
}

/** Card variant (a) — SPEC §7.3: "rows of `label — NN% — [Yes][No]`, up to 3
 * rows then `+N more`" (research/polymarket.md §2.1's `groupItemTitle` rows,
 * Kalshi's outlined `Pill` for the percentage). Server-renderable. */
export function MultiOutcomeRows({ outcomes, prices, maxRows = 3 }: MultiOutcomeRowsProps) {
  const shown = outcomes.slice(0, maxRows);
  const overflow = outcomes.length - shown.length;

  return (
    <div className="flex flex-col gap-2">
      {shown.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-(--text-1)">{o.label}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Pill value={prices[o.id] ?? 0} />
            <ShowcaseButton tone="yes" label="Yes" />
            <ShowcaseButton tone="no" label="No" />
          </div>
        </div>
      ))}
      {overflow > 0 ? <p className="text-xs text-(--text-3)">+{overflow} more</p> : null}
    </div>
  );
}
