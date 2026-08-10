/**
 * Derives which of the three required card shapes (SPEC §3.6, §7.3) a
 * market renders as. `Market` (src/domain/entities.ts) has no `variant`
 * field of its own — `ExploreMarketSeed.variant` (seed-data/explore-markets
 * .ts) only exists at seed time and isn't persisted onto the entity — so
 * this reconstructs it structurally from `outcomes`, which every seeded
 * Explore market shape distinguishes cleanly:
 *   - `binaryMarket()` always emits exactly `["Yes", "No"]`.
 *   - a `headToHead` def always has exactly 2 outcomes with real team names.
 *   - a `multi` def always has 3+ outcomes.
 * Pure and total — every `Market`, seeded or hypothetically not, maps to
 * exactly one variant.
 */

import type { Outcome } from "@/domain/entities";

export type ExploreCardVariant = "binary" | "headToHead" | "multi";

function isYesNo(outcomes: readonly Outcome[]): boolean {
  if (outcomes.length !== 2) return false;
  const labels = outcomes.map((o) => o.label).sort();
  return labels[0] === "No" && labels[1] === "Yes";
}

export function deriveCardVariant(outcomes: readonly Outcome[]): ExploreCardVariant {
  if (outcomes.length <= 2) {
    return isYesNo(outcomes) ? "binary" : "headToHead";
  }
  return "multi";
}
