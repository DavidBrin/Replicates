/**
 * Fortify (SPEC §4.13, R66, D32; research §3.3).
 *
 * ```
 * interiorness(t) = (no adjacent enemy) ? 1 : 0
 * moveable(t)     = t.troops − 1              // interior territories only
 * destination     = argmax over reachable owned d of threat(d) / max(1, d.troops)
 *   threat(d)     = Σ enemy troops adjacent to d, weighted up if d borders a continent I hold
 * ```
 *
 * **Drain the interior, feed the most-threatened border**, preferring borders of continents whose
 * bonus I am collecting. Expert adds a springboard tiebreak, breaking ties toward offence.
 *
 * Reachability is **connected-path through territories I own** (D32), not single-hop adjacency — a
 * BFS, which is a meaningfully different and more expensive legality check than attacking's. Portal
 * edges count, exactly as they do for the engine (R75).
 *
 * Fortify is always optional, and Beginner never bothers.
 */

import type { TerritoryId } from "@/engine";

import { springboardValue } from "./lookahead";
import { bst, myTerritories, neighbours, threat } from "./score";
import { DEFAULT_WEIGHTS, type BotWeights, type GameView } from "./types";

/** Every territory I own that is reachable from `from` through territories I own. */
export function reachableOwned(view: GameView, from: TerritoryId): readonly TerritoryId[] {
  const seen = new Set<TerritoryId>([from]);
  const queue: TerritoryId[] = [from];
  while (queue.length > 0) {
    const here = queue.shift() as TerritoryId;
    for (const y of neighbours(view, here)) {
      if (seen.has(y)) continue;
      if ((view.owner[y] as number) !== view.me) continue;
      seen.add(y);
      queue.push(y);
    }
  }
  seen.delete(from);
  // Ascending: never iterate a Set's insertion order into a decision (§7.2 rule 2).
  return [...seen].sort((a, b) => a - b);
}

export interface FortifyMove {
  readonly from: TerritoryId;
  readonly to: TerritoryId;
  readonly count: number;
}

/**
 * The one fortify move to make, or null to skip.
 *
 * Tiered, per §4.13: Beginner none · Easy a random legal move or none (here: the lowest-id legal
 * move, since ties break by id and a bot consumes no draw for one) · Medium drain interior → nearest
 * border · Hard threat-weighted · Expert + the springboard tiebreak.
 */
export function decideFortify(
  view: GameView,
  weights: BotWeights = DEFAULT_WEIGHTS,
): FortifyMove | null {
  const persona = view.persona;
  if (persona.tier === "beginner") return null;

  const mine = myTerritories(view);
  if (mine.length < 2) return null;

  // Sources: interior territories with something to move. A border never drains itself.
  const sources = mine.filter((t) => (view.troops[t] as number) > 1 && bst(view, t) === 0);
  if (sources.length === 0) return null;

  let best: { move: FortifyMove; score: number } | null = null;

  for (const from of sources) {
    const moveable = (view.troops[from] as number) - 1;
    for (const to of reachableOwned(view, from)) {
      const pressure = threat(view, to);
      if (pressure === 0) continue; // feeding a quiet interior achieves nothing
      let score = pressure / Math.max(1, view.troops[to] as number);
      if (persona.lookahead >= 2) score += springboardValue(view, to) * 0.01;
      // Prefer the shorter drain: moving across the whole map is correct but reads as thrashing.
      score -= 0.001 * Math.abs(to - from);
      const candidate = { from, to, count: moveable };
      if (
        best === null
        || score > best.score
        || (score === best.score && (from < best.move.from || (from === best.move.from && to < best.move.to)))
      ) {
        best = { move: candidate, score };
      }
    }
  }

  if (best === null) return null;

  // Easy: a legal move, with no threat-weighting applied — the lowest-id one.
  if (persona.tier === "easy") {
    const from = sources[0] as TerritoryId;
    const reachable = reachableOwned(view, from);
    if (reachable.length === 0) return null;
    return { from, to: reachable[0] as TerritoryId, count: (view.troops[from] as number) - 1 };
  }

  // Medium drains to the nearest threatened border rather than the globally best one.
  if (persona.tier === "medium") {
    const from = best.move.from;
    const nearby = reachableOwned(view, from).filter((t) => threat(view, t) > 0);
    if (nearby.length === 0) return null;
    const nearest = [...nearby].sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b)[0] as TerritoryId;
    return { from, to: nearest, count: (view.troops[from] as number) - 1 };
  }

  void weights;
  return best.move;
}
