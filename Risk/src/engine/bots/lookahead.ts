/**
 * Expert's ply-1 reply check (SPEC §4.13, D30).
 *
 * Expert's extra compute goes into **the draft and a single-ply "best opponent reply" check**, not
 * into deeper attack search. Three independent published results converge on that, counter-intuitive
 * as it is: Gibson et al. found randomising only the draft collapsed an otherwise-strong agent;
 * Gnecco & Cazenave found their "init-only" variant (learned draft, then *random* play) beat their
 * fully-trained agent; Hahn found the winner of a self-play game is statistically identifiable 60%
 * of the way through. A ply-2 attack search measures 20–200 ms even at the top 3 candidates each
 * side, where ply-1 over the top ~8 fits comfortably inside 10 ms.
 *
 * This is deterministic and consumes **no PRNG draws**: it is a pure function of the view.
 */

import type { OddsTables, TerritoryId } from "@/engine";

import type { AttackCandidate } from "./attack";
import { augmentFor, exposureAfterCapture, neighbours, reserve } from "./score";
import { byScoreThenId, DEFAULT_WEIGHTS, type BotWeights, type GameView } from "./types";
import { isEnemy } from "./view";

/** How many candidates Expert checks replies for. §4.13: "the top ~8 candidates". */
export const LOOKAHEAD_WIDTH = 8;

/**
 * The best single reply an opponent has against `t` if I hold it with `troops`, as the probability
 * they take it back weighted by what it costs me.
 *
 * One ply, one battle, no chains — the cheapest thing that catches the mistake ply-0 makes: capturing
 * a territory that the biggest adjacent stack simply walks back into.
 */
export function bestReplyAgainst(
  view: GameView,
  odds: OddsTables,
  t: TerritoryId,
  troops: number,
): number {
  let worst = 0;
  for (const y of neighbours(view, t)) {
    if (!isEnemy(view, view.owner[y] as number)) continue;
    const theirA = (view.troops[y] as number) - 1;
    if (theirA < 1) continue;
    // They attack ME now, so the augment is mine to benefit from: my capital, if `t` is one.
    const aug = augmentFor(view, t);
    const p = odds.winChance(theirA, troops, aug);
    worst = Math.max(worst, p);
  }
  return worst;
}

/**
 * Re-score candidates with the reply penalty folded in. Ply-0 personas get the list unchanged.
 *
 * The penalty is `P(they take it straight back) × (what the territory was worth + what I moved in)`:
 * a capture that is immediately reversed cost me the troops and gained me nothing but a card.
 */
export function withLookahead(
  view: GameView,
  odds: OddsTables,
  candidates: readonly AttackCandidate[],
  weights: BotWeights = DEFAULT_WEIGHTS,
): readonly AttackCandidate[] {
  if (view.persona.lookahead < 1 || candidates.length === 0) return candidates;

  const width = Math.min(LOOKAHEAD_WIDTH, candidates.length);
  const head = candidates.slice(0, width);
  const tail = candidates.slice(width);

  const rescored = head.map((candidate) => {
    const sourceTroops = view.troops[candidate.from] as number;
    // What I would realistically move in: everything above the source's reserve, at least the dice.
    const keep = Math.max(1, reserve(view, candidate.from));
    const movingIn = Math.max(Math.min(sourceTroops - 1, 3), sourceTroops - keep);
    const survivors = Math.max(1, movingIn - Math.round(candidate.sunkCost));
    const retake = bestReplyAgainst(view, odds, candidate.to, survivors);
    const atStake = candidate.gain + survivors * weights.wTerr * 0.5;
    const penalty = candidate.winChance * retake * atStake;
    return { ...candidate, score: candidate.score - penalty };
  });

  return [...rescored, ...tail].sort(byScoreThenId);
}

/**
 * Expert's springboard term: which of my territories is the best launch pad for next turn.
 *
 * Deliberately cheap — the sum of adjacent enemy weight I could profitably reach, divided by the
 * exposure I would be accepting. Used by `placement: "secure"` at Hard/Expert and as the fortify
 * tiebreak.
 */
export function springboardValue(view: GameView, t: TerritoryId): number {
  let reachable = 0;
  for (const y of neighbours(view, t)) {
    if (!isEnemy(view, view.owner[y] as number)) continue;
    reachable += 1 / Math.max(1, view.troops[y] as number);
  }
  const exposure = exposureAfterCapture(view, t);
  return reachable * 10 - exposure * 0.01;
}
