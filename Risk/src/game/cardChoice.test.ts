import { describe, expect, it } from "vitest";

import type { Card } from "@/engine/types";

import { bestCardSet, bonusTerritoryFor } from "./cardChoice";

const inf = (id: string, territory: number | null = null): Card => ({ id, suit: "infantry", territory });
const cav = (id: string, territory: number | null = null): Card => ({ id, suit: "cavalry", territory });
const art = (id: string, territory: number | null = null): Card => ({ id, suit: "artillery", territory });

/** Fixed-scheme prices (R22): 4 / 6 / 8 by suit, 10 mixed. */
function fixedValue(cards: readonly Card[]): number {
  const suits = new Set(cards.map((c) => c.suit));
  if (suits.size === 3) return 10;
  if (suits.size !== 1) return 0;
  return { infantry: 4, cavalry: 6, artillery: 8, wild: 10 }[cards[0]?.suit ?? "wild"];
}

describe("bestCardSet (D110)", () => {
  it("picks the set worth the most, by the set's own value", () => {
    const hand = [inf("a"), inf("b"), inf("c"), art("d"), art("e"), art("f")];
    const sets = [["a", "b", "c"], ["d", "e", "f"]] as const;
    const best = bestCardSet(sets, hand, fixedValue, () => false);
    expect(best?.set).toEqual(["d", "e", "f"]);
    expect(best?.value).toBe(8);
    expect(best?.bonusTerritory).toBeNull();
  });

  it("counts R23's +2 for a held territory when choosing, but reports the set value alone", () => {
    // Three cavalry are worth 6; three infantry are worth 4 but one names a held territory (+2 = 6).
    // A tie keeps the first set in engine order; raise the infantry side with a second held card.
    const hand = [inf("a", 1), inf("b", 2), inf("c"), cav("d"), cav("e"), cav("f")];
    const sets = [["a", "b", "c"], ["d", "e", "f"]] as const;
    const best = bestCardSet(sets, hand, fixedValue, (t) => t === 1);
    // 4 + 2 = 6 ties 6 → first in order wins.
    expect(best?.set).toEqual(["a", "b", "c"]);
    expect(best?.value).toBe(4);
    expect(best?.bonusTerritory).toBe(1);
  });

  it("returns null with no sets", () => {
    expect(bestCardSet([], [], fixedValue, () => true)).toBeNull();
  });

  it("bonusTerritoryFor names the first held territory in the trio", () => {
    const hand = [inf("a", 7), inf("b", 9), inf("c", 11)];
    expect(bonusTerritoryFor(hand, ["a", "b", "c"], (t) => t === 9 || t === 11)).toBe(9);
    expect(bonusTerritoryFor(hand, ["a", "b", "c"], () => false)).toBeNull();
  });
});
