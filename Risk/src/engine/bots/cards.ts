/**
 * Card-trade timing (SPEC §4.13, R22, R24–R28; research §3.1).
 *
 * Correct play differs sharply by mode, and no first-party statement about what RGD's bots do with
 * cards was found, so these rules are **derived, not replicated**:
 *
 * - **Fixed** (4/6/8/10): the set value is independent of who cashes, so **trade as soon as you
 *   legally can** — there is no option value in holding, only the risk of being eliminated and
 *   handing the hand to your killer.
 * - **Progressive** (one escalating global counter): the value rises with every set cashed by
 *   *anybody*, so holding has real option value. Hold while the ladder is still climbing and the
 *   hand is ≤ 4 cards; trade immediately when forced, when cashing converts into a kill or a
 *   continent break worth more than the future set, or when survival this round looks worse than
 *   `panicThreshold` — a hoarded hand is a bounty on your head.
 *
 * `seesCardTradeTiming` is the tier gate: Beginner and Easy trade **only when forced**.
 */

import type { Card } from "@/engine";

import { bestSetOf, boardShare, expectedCardValue, leaderShare, normalisedStrength, setsIn } from "./score";
import { DEFAULT_WEIGHTS, type BotWeights, type GameView } from "./types";

/** R28/R56: five or more cards at turn start forces a trade. */
export const FORCED_TRADE_AT = 5;

export function mustTrade(view: GameView): boolean {
  return view.myCards.length >= FORCED_TRADE_AT && setsIn(view.myCards).length > 0;
}

/**
 * The set to trade this draft, or null to hold.
 *
 * Returns the `Card.id` triple the `TRADE_CARDS` action wants, in hand order, so the runner never
 * has to re-derive which three.
 */
export function decideCardTrade(
  view: GameView,
  weights: BotWeights = DEFAULT_WEIGHTS,
): readonly [string, string, string] | null {
  const best = bestSetOf(view.myCards, view.setsTradedTotal, view.rules.cardBonus);
  if (best === null) return null;
  const triple: readonly [string, string, string] = [
    best.cards[0].id, best.cards[1].id, best.cards[2].id,
  ];

  // Forced, at any tier (R28). A 7-card hand is the engine's problem, not the bot's (F51).
  if (mustTrade(view)) return triple;

  // Beginner / Easy: only when forced.
  if (!view.persona.seesCardTradeTiming) return null;

  if (view.rules.cardBonus === "fixed") return triple;

  // ---- Progressive: holding has option value -------------------------------------------------
  // Hold while the ladder is still climbing AND the hand is small enough to be safe.
  const nextValue = best.value;
  const afterNext = expectedCardValue(view, view.me) * 2;
  const climbing = afterNext > nextValue;
  const safe = view.myCards.length <= 4;

  // (c) survival this round below panicThreshold — a hoarded hand is a bounty.
  const share = normalisedStrength(view, view.me);
  const panicking = share < weights.panicThreshold;
  if (panicking) return triple;

  // (b) cashing now converts into denial of a runaway leader.
  const mustDeny = view.persona.seesDominationThreshold
    && leaderShare(view) > view.rules.dominationThreshold - 0.1;
  if (mustDeny) return triple;

  // Expert: track every seat's count and pre-empt a big cash-in by being first.
  if (view.persona.lookahead >= 2) {
    const rivalAboutToCash = view.cardCount.some((count, seat) => seat !== view.me && count >= 4);
    if (rivalAboutToCash) return triple;
  }

  // Close to winning: convert everything into troops now.
  if (boardShare(view, view.me) > view.rules.dominationThreshold - 0.1) return triple;

  return climbing && safe ? null : triple;
}

/** R23: which matching territory takes the +2, or null. Prefer the most threatened border I own. */
export function bonusTerritoryFor(
  view: GameView,
  traded: readonly [string, string, string],
  threatOf: (t: number) => number,
): number | null {
  const ids = new Set(traded);
  const candidates: number[] = [];
  for (const card of view.myCards) {
    if (!ids.has(card.id)) continue;
    if (card.territory === null) continue;
    if ((view.owner[card.territory] as number) !== view.me) continue; // must be held (R23)
    candidates.push(card.territory);
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => threatOf(b) - threatOf(a) || a - b)[0] as number;
}

/** The cards a trade would remove, for the caller that needs the objects rather than the ids. */
export function cardsById(view: GameView, ids: readonly string[]): readonly Card[] {
  return view.myCards.filter((c) => ids.includes(c.id));
}
