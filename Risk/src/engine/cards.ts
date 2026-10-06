/**
 * The card deck, sets, values and the three timing branches (R19–R28, D19,
 * D20, D56).
 *
 * **The deck's order is never stored** (R19). A deck is a derived quantity:
 * `allCards − everyHand − discard`, recomputed whenever `drawCard` needs it.
 * That is what lets `GameState` hold no shuffle and still replay exactly, and
 * it makes the reshuffle-the-discard rule fall out for free — when the pool
 * empties, the discard *is* the pool.
 *
 * The three timing branches of R24/R25/R26 are three separate predicates here,
 * not one "hand >= 5" check, because only R26 forces an interrupt mid-turn
 * (D20) and only R24 fires at turn start.
 */
import {
  FIXED_MIXED_VALUE,
  FIXED_SET_VALUE,
  PROGRESSIVE_SET_VALUES,
  type Card,
  type CardBonusScheme,
  type GameState,
  type MapDef,
  type Seat,
  type Suit,
  type TerritoryId,
} from "./types";

/** The id of the n-th wild card, `n` 1-based. The deck holds exactly two (R19). */
export function wildCardId(n: number): string {
  return `wild-${n}`;
}

/** The two wild cards every deck carries (R19). */
export const WILD_CARDS: readonly Card[] = [
  { id: wildCardId(1), suit: "wild", territory: null },
  { id: wildCardId(2), suit: "wild", territory: null },
];

/**
 * The whole deck of a map: one card per territory carrying that territory's
 * authored suit, plus the two wilds (R19). Sorted by id, so every derived pool
 * is order-stable without a caller remembering to sort (R91).
 */
export function deckFor(map: MapDef): readonly Card[] {
  const out: Card[] = map.territories.map((t) => ({ id: t.id, suit: t.suit, territory: t.index }));
  out.push(...WILD_CARDS);
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The cards nobody holds and nothing has discarded — the live draw pool (R19).
 * When it comes back empty the discard is reshuffled and becomes the pool,
 * which `drawCard` handles by drawing from the discard instead.
 */
export function remainingDeck(state: GameState, map: MapDef): readonly Card[] {
  const held = new Set<string>();
  for (const seat of state.seats) for (const card of seat.cards) held.add(card.id);
  for (const card of state.discard) held.add(card.id);
  return deckFor(map).filter((c) => !held.has(c.id));
}

/** Every card in play, by id — the set `CARD_DRAWN` must draw from (R19). */
export function cardById(map: MapDef, id: string): Card | null {
  return deckFor(map).find((c) => c.id === id) ?? null;
}

/** `true` when these three cards are a tradeable set (R21). */
export function isValidSet(cards: readonly Card[]): boolean {
  if (cards.length !== 3) return false;
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== 3) return false;
  // Any two plus a Wild (R21) — which also covers two wilds and one card.
  if (cards.some((c) => c.suit === "wild")) return true;
  const suits = cards.map((c) => c.suit);
  const distinct = new Set(suits);
  // Three of a kind, or one of each.
  return distinct.size === 1 || distinct.size === 3;
}

/**
 * Every tradeable triple in a hand, as id triples (R21). Each triple is sorted
 * by id and the list is sorted lexicographically, so the UI and the bots see
 * the same order (R91).
 */
export function cardSets(cards: readonly Card[]): readonly (readonly [string, string, string])[] {
  const hand = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: (readonly [string, string, string])[] = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const x = hand[i] as Card;
        const y = hand[j] as Card;
        const z = hand[k] as Card;
        if (isValidSet([x, y, z])) out.push([x.id, y.id, z.id] as const);
      }
    }
  }
  return out;
}

/** `true` when the hand holds at least one tradeable set. */
export function hasSet(cards: readonly Card[]): boolean {
  return cardSets(cards).length > 0;
}

/**
 * The value of ONE set (R22, D19). Takes the three cards and the two things the
 * scheme needs, never a whole `GameState`, because the bots price hypothetical
 * hands that exist in no state (F4).
 *
 * Fixed: three-of-a-kind by suit 4 / 6 / 8, and 10 for one-of-each **or any
 * set containing a Wild**. Progressive: the `setsTradedTotal + 1`-th set from
 * the ladder 4, 6, 8, 10, 12, 15, then `15 + 5 * (n - 6)` forever.
 *
 * An invalid triple is worth 0; the reducer refuses it before this is reached.
 */
export function cardTradeValue(
  cards: readonly Card[],
  setsTradedTotal: number,
  scheme: CardBonusScheme,
): number {
  if (!isValidSet(cards)) return 0;
  if (scheme === "progressive") {
    const n = Math.max(1, Math.floor(setsTradedTotal) + 1);
    if (n <= PROGRESSIVE_SET_VALUES.length) return PROGRESSIVE_SET_VALUES[n - 1] as number;
    return 15 + 5 * (n - PROGRESSIVE_SET_VALUES.length);
  }
  if (cards.some((c) => c.suit === "wild")) return FIXED_MIXED_VALUE;
  const suits = new Set<Suit>(cards.map((c) => c.suit));
  if (suits.size === 1) {
    const suit = (cards[0] as Card).suit as Exclude<Suit, "wild">;
    return FIXED_SET_VALUE[suit];
  }
  return FIXED_MIXED_VALUE;
}

/** The hand of `seat`, or `[]` for an index that is not a seat. */
export function handOf(state: GameState, seat: Seat): readonly Card[] {
  return state.seats[seat]?.cards ?? [];
}

/**
 * R24 — forced at turn start. Holding five or more cards when your turn opens,
 * you must trade before you may draft (D56). Only true while nothing has been
 * traded this turn; the optional second trade is never forced.
 */
export function mustTradeAtTurnStart(state: GameState, seat: Seat): boolean {
  if (state.turnOrder[state.currentIndex] !== seat) return false;
  if (state.phase !== "draft") return false;
  if (state.setsTradedThisTurn > 0) return false;
  const hand = handOf(state, seat);
  return hand.length >= 5 && hasSet(hand);
}

/**
 * R26 — inheritance forces an immediate trade-down. A seizure that lifts the
 * hand to six or more must be traded down to four or fewer in the same turn,
 * one set at a time. Six cards reach three in one trade, so this is "while the
 * hand is at six or more".
 */
export function mustTradeDown(state: GameState, seat: Seat): boolean {
  if (state.turnOrder[state.currentIndex] !== seat) return false;
  const hand = handOf(state, seat);
  return hand.length >= 6 && hasSet(hand);
}

/**
 * Either forcing branch (R24, R26). R25 is the branch that forces *nothing*:
 * your own end-of-turn reward draw to five or six is checked at the start of
 * your next turn, and nothing here fires for it, because `CARD_DRAWN` lands
 * after the phase it would have interrupted.
 */
export function mustTradeNow(state: GameState, seat: Seat): boolean {
  return mustTradeDown(state, seat) || mustTradeAtTurnStart(state, seat);
}

/** The territory a card names, or null for a wild (R23). */
export function cardTerritory(card: Card): TerritoryId | null {
  return card.territory;
}
