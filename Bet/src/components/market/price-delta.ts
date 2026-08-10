/**
 * Pure "24h delta" derivation for the price panel's delta chip (SPEC §3.3's
 * layout sketch: `72%  ▲6`). Factored out for the same reason as
 * `resolution-view.ts` — a small, easy-to-get-wrong piece of date math that
 * deserves its own unit tests rather than being buried in `PricePanel.tsx`.
 */

export interface PriceDeltaPoint {
  at: string;
  prices: Record<string, number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns `currentProbability - probability24hAgo` for `outcomeId`, in
 * probability points (e.g. `0.06` for the sketch's `▲6`). `history` need
 * not be sorted — this sorts its own working copy. Returns `null` when
 * there's no current price to compare from (empty history, or the outcome
 * is missing from the latest point). When no point exists at/before the
 * 24h cutoff (the market is younger than a day), falls back to the
 * earliest available point as the baseline, so a brand-new market still
 * shows a (labeled "since open" by the caller) delta rather than nothing.
 */
export function delta24h(history: PriceDeltaPoint[], outcomeId: string, now: Date): number | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const latest = sorted[sorted.length - 1]!;
  const current = latest.prices[outcomeId];
  if (current === undefined) return null;

  const cutoff = now.getTime() - DAY_MS;
  let baseline: number | undefined;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (new Date(sorted[i]!.at).getTime() <= cutoff) {
      baseline = sorted[i]!.prices[outcomeId];
      break;
    }
  }
  if (baseline === undefined) baseline = sorted[0]!.prices[outcomeId];
  if (baseline === undefined) return null;

  return current - baseline;
}
