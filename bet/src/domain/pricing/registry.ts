/**
 * Resolves a `MarketState.kind` to its `PricingEngine` implementation.
 * Exhaustive over the union — an unknown/unsupported kind throws rather
 * than silently falling back to a default engine (a wrong engine picked
 * for a market would misprice every trade on it).
 */

import { fixedOddsEngine } from "./fixed-odds";
import { lmsrEngine } from "./lmsr";
import { parimutuelEngine } from "./parimutuel";
import type { PricingEngine } from "./engine";
import type { MarketState } from "./types";

export type PricingKind = MarketState["kind"];

export function getEngine(kind: PricingKind): PricingEngine {
  switch (kind) {
    case "lmsr":
      return lmsrEngine;
    case "fixedOdds":
      return fixedOddsEngine;
    case "parimutuel":
      return parimutuelEngine;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown pricing engine kind: ${String(exhaustive)}`);
    }
  }
}
