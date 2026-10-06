/**
 * The set the trade panel offers first (D110).
 *
 * The original makes the player pick three cards; here the panel opens with
 * the **highest-value legal set already selected**, so a trade is one tap.
 * "Highest" counts the set's own value plus R23's +2 when one of its cards
 * names a territory the trader holds; ties keep the engine's own set order,
 * which is sorted by card id and therefore stable across renders.
 */
import type { Card, TerritoryId } from "@/engine/types";

export interface BestSet {
  readonly set: readonly [string, string, string];
  /** The set's value alone — the `+N` on the pill. */
  readonly value: number;
  /** The held territory that takes the +2 (R23), or null. */
  readonly bonusTerritory: TerritoryId | null;
}

/** R23 — the first card of the trio naming a territory the trader occupies. */
export function bonusTerritoryFor(
  hand: readonly Card[], trio: readonly string[], owned: (t: TerritoryId) => boolean,
): TerritoryId | null {
  for (const id of trio) {
    const card = hand.find((c) => c.id === id);
    if (card?.territory != null && owned(card.territory)) return card.territory;
  }
  return null;
}

export function bestCardSet(
  sets: readonly (readonly [string, string, string])[],
  hand: readonly Card[],
  valueOf: (cards: readonly Card[]) => number,
  owned: (t: TerritoryId) => boolean,
): BestSet | null {
  let best: BestSet | null = null;
  let bestTotal = -1;
  for (const set of sets) {
    const cards = set.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => !!c);
    if (cards.length !== 3) continue;
    const value = valueOf(cards);
    const bonusTerritory = bonusTerritoryFor(hand, set, owned);
    const total = value + (bonusTerritory === null ? 0 : 2);
    if (total > bestTotal) {
      bestTotal = total;
      best = { set, value, bonusTerritory };
    }
  }
  return best;
}
