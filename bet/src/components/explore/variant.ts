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

/**
 * Fixed-point FNV-1a-style string hash (same shape as `orderbook-synth.ts`'s
 * `hashSeed`, reimplemented locally rather than imported — this module has
 * no other dependency on that file and duplicating six lines keeps the two
 * pure-derivation modules independent). Deterministic and total: same
 * input, same output, every time, in every environment.
 */
function stableHash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Task 13 fix round 1: most seeded markets are binary, so rendering every
 * one of them as `BinaryGaugeCard` made ~3/4 of the grid the same circular-
 * gauge shape — visually monotonous in a way the real references aren't
 * (Polymarket genuinely renders binary markets both as a gauge card *and*
 * as a compact list row, e.g. inside multi-outcome event groups). This adds
 * variety in the derivation, not the outcome count: roughly half of binary
 * markets render as the compact `label — % — [Yes][No]` row instead of the
 * gauge, chosen by a stable hash of the market id — never `Math.random()`,
 * which would churn between server/client renders and break hydration, or
 * reshuffle the grid on every request. Pure and total.
 */
export function isCompactBinary(marketId: string): boolean {
  return stableHash(marketId) % 2 === 0;
}
