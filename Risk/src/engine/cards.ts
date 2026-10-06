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

/**
 * `true` when a card CAN be awarded to `seat` right now: the hand is under six (R28) and there is
 * a card to draw — the pool, or the discard the pool reshuffles from (R19). On a small board where
 * two seats hold every card there is nothing to draw, and offering `CARD_DRAWN` then is a
 * legalActions↔validate disagreement (T5 found it once the 2-seat neutral became opt-in, D106).
 */
export function canDrawCard(state: GameState, map: MapDef, seat: Seat): boolean {
  if (handOf(state, seat).length >= 6) return false;
  return remainingDeck(state, map).length > 0 || state.discard.length > 0;
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

/** R26's floor: the forced trade-down stops as soon as the hand reaches 4, 3 or 2. */
export const TRADE_DOWN_FLOOR = 4;

/**
 * R26's trigger (D114): a seizure that lifts the hand to **five** or more forces the immediate,
 * same-turn trade-down. Five, not six, because five is already a hand that must trade at the
 * next draft (R24) — so a seat holding five at the end of its turn could only grow past five
 * through R20's reward draw, which is the one way a hand may legitimately reach six.
 */
export const SEIZURE_TRADE_THRESHOLD = 5;

/**
 * True when R27's bounce has fired this turn — i.e. an **inheritance** is what put this hand where
 * it is, and R26's "immediate, same-turn" is in force.
 *
 * `resumePhase` is set by the reducer on **every** route a seizure to ≥6 can arrive by — the
 * `MOVE_IN` branch after a conquest (F41) and `END_TURN`'s R81 re-check — and cleared by the
 * `END_PHASE` that leaves the trade-down. It is therefore exactly "a seizure sent this seat back
 * into draft owing a trade", and it needs no new `GameState` field — which would change
 * `hashState` for every game ever played.
 */
function tradeDownBounced(state: GameState): boolean {
  return state.resumePhase !== null;
}

/**
 * R26 — an **inheritance** forces an immediate trade-down. A *seizure* that lifts the hand to
 * `SEIZURE_TRADE_THRESHOLD` (five, D114) or more must be traded down to **four or fewer** in the
 * same turn, one set at a time, stopping as soon as the hand reaches 4, 3 or 2.
 *
 * Both branches are gated on R27's bounce marker, because the bounce is what tells an inheritance
 * apart from the **other** way a hand legitimately reaches six: R20's end-of-turn reward draw.
 * `validateCardDrawn` admits the award at a hand of five, so the reward lands the hand on six in
 * `fortify` — and R25 is explicit that a reward draw to five or six forces nothing until the seat's
 * next turn. An ungated `hand.length >= 6` turned that hand into a dead end with **no legal action
 * at all**: `END_TURN` refused with `mustTradeCards`, `END_PHASE` illegal out of fortify (R67),
 * `TRADE_CARDS` draft-only (R24, R27) — while `legalActions` went on advertising `END_TURN`
 * (codex round 3, finding 1). Gated, that hand simply ends the turn, and `mustTradeAtTurnStart`
 * forces the trade when the seat opens its next draft, which is what R25 asks for.
 *
 * The second branch is the trade-down a bounce *started*, which keeps forcing while the hand is
 * still above the floor: one trade removes exactly three cards, so from 6 you reach 3 and from 7
 * you reach 4, yet **from 8 you reach 5** — still above `TRADE_DOWN_FLOOR` and owing another trade
 * that `mustTradeAtTurnStart` will not ask for, a set having already been traded this turn.
 *
 * It must stay keyed on the bounce and **not** be derived from the hand size alone: a seat that
 * traded at turn start and then inherited back up to 5 satisfies `hand.length + 3 *
 * setsTradedThisTurn >= 6` without ever having held six, and R26 defers that hand to the seat's next
 * turn (codex round 2, finding 9).
 *
 * Because `bounceForTradeDown` always leaves play in `draft`, a `true` here implies
 * `state.phase === "draft"` — which is what keeps `legalActions` and `validate` in agreement.
 * `legalActions`' draft branch answers `["TRADE_CARDS"]` for exactly this state; the `attack` and
 * `fortify` branches that offer `END_TURN` are never reached while a trade-down is owed.
 */
export function mustTradeDown(state: GameState, seat: Seat): boolean {
  if (state.turnOrder[state.currentIndex] !== seat) return false;
  const hand = handOf(state, seat);
  if (!hasSet(hand)) return false;
  if (!tradeDownBounced(state)) return false;
  if (hand.length >= SEIZURE_TRADE_THRESHOLD) return true;
  return hand.length > TRADE_DOWN_FLOOR && state.setsTradedThisTurn > 0;
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
