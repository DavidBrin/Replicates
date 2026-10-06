/**
 * `drawCard` — the end-of-turn reward card (R19, R20, R25; D3, D4).
 *
 * **Exactly one draw**, asserted by a test (D4). The deck's order is never
 * stored (R19): the pool is recomputed as `allCards − everyHand − discard`
 * every time, and when that pool comes back empty the discard *is* the pool —
 * which is the reshuffle, with no shuffle to store and no special case in the
 * reducer beyond removing the drawn card from `discard`.
 *
 * The pool is sorted by card id before the draw (R91), so two authorities
 * computing it from the same state index the same way.
 */
import { deckFor, remainingDeck } from "../cards";
import { drawIndex } from "../prng";
import type { Action, Card, GameState, MapDef, Rng, Seat } from "../types";

export function drawCard(
  state: GameState,
  map: MapDef,
  seat: Seat,
  rng: Rng,
): Extract<Action, { type: "CARD_DRAWN" }> {
  const live = remainingDeck(state, map);
  // R19 — an empty pool means every card is held or discarded; reshuffle the
  // discard by simply drawing from it.
  const pool = live.length > 0 ? live : [...state.discard].sort((a, b) => (a.id < b.id ? -1 : 1));
  const fallback = deckFor(map);
  const from = pool.length > 0 ? pool : fallback;
  const at = drawIndex(rng, from.length);
  const card = (at < 0 ? (fallback[0] as Card) : (from[at] as Card));
  return { type: "CARD_DRAWN", seat, card };
}
