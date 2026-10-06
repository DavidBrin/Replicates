/**
 * Claim and draft placement (SPEC §4.13, R9, R12–R15; research §3.1).
 *
 * Four placement policies, assigned by tier, and all four are the *same* code path with a different
 * ordering — which is what keeps determinism simple:
 *
 * | `spread`    | one troop at a time onto the lowest-id owned territory in rotation | Beginner/Easy |
 * | `secure`    | fill the most-threatened borders to `bsrTarget`, remainder to the springboard | Medium+ |
 * | `frontLoad` | everything onto the single best attack springboard | the rusher, the assassin |
 * | `stack`     | everything onto one territory regardless of plan | the hoarder |
 *
 * `secure` is Hahn's best-measured configuration: distribute proportionally to **NBSR**, the
 * most-threatened borders getting the biggest share, with his untested-but-necessary floor applied
 * first so single troops are not sprinkled uselessly.
 *
 * The claim phase uses Gibson et al.'s learned draft weights — the only empirically validated draft
 * scorer in the literature, and directly copyable:
 *
 * ```
 * draftScore = continentCurve(ownedPerContinent)
 *            + 13.38·(turnPosition == 1) + 5.35·(turnPosition == 2)
 *            − 0.07·distinctEnemyBorderingTerritories
 *            + 0.96·pairsOfAdjacentOwnedTerritories
 * ```
 *
 * Clustering is worth ~14× as much per unit as a border costs (+0.96 vs −0.07), so the emergent
 * policy is: claim a contiguous block, and deny opponents the last free territory in a small
 * continent. **Completing a small continent is worth far more than progress toward a big one.**
 */

import { SEAT_NONE, type TerritoryId } from "@/engine";

import { springboardValue } from "./lookahead";
import {
  bsr, continentFacts, continentOf, myBorders, myTerritories, nbsr, neighbours, apportion, threat,
} from "./score";
import { byScoreThenId, DEFAULT_WEIGHTS, type BotWeights, type GameView } from "./types";
import { isEnemy } from "./view";

export const DRAFT_ADJACENT_PAIR = 0.96;
export const DRAFT_ENEMY_BORDER = -0.07;

/**
 * Gibson et al.'s continent curve: the marginal value of the n-th territory of a continent.
 *
 * Their Fig. 3 shape, read off the paper's stated features: Europe has the biggest 0→1 jump, North
 * America's weights rise steeply with count, and the small continents have large all-but-one → all
 * jumps. Expressed generically (we ship twelve maps, not one) as a convex curve in the *fraction*
 * owned, with the completion jump carried by the continent's own bonus.
 */
export function continentCurve(owned: number, size: number, bonus: number): number {
  if (size === 0) return 0;
  const fraction = owned / size;
  const progress = fraction ** 2.5;              // convex: progress toward a big continent is cheap
  const completion = owned === size ? 1 : 0;     // the all-but-one → all jump
  const firstFoot = owned >= 1 ? 0.15 : 0;       // the 0→1 jump
  return bonus * (progress * 0.6 + completion * 0.8 + firstFoot);
}

/** The claim-phase score of taking `t` (R9). */
export function claimScore(
  view: GameView,
  t: TerritoryId,
  weights: BotWeights = DEFAULT_WEIGHTS,
): number {
  const c = continentOf(view, t);
  const facts = c < 0 ? null : continentFacts(view, c, weights);
  const continent = c < 0 ? undefined : view.map.continents[c];

  let score = 0;
  if (facts !== null && continent !== undefined) {
    score += continentCurve(facts.ownedByMe + 1, facts.size, facts.bonus);
    // A small, cheap-to-hold continent is worth diving for; `contValue` already carries that.
    score += facts.value * 6 * (0.5 + view.persona.continentFocus);
  }

  let adjacentMine = 0;
  let enemyBorders = 0;
  for (const y of neighbours(view, t)) {
    const owner = view.owner[y] as number;
    if (owner === view.me) adjacentMine++;
    else if (isEnemy(view, owner)) enemyBorders++;
  }
  score += DRAFT_ADJACENT_PAIR * adjacentMine;
  score += DRAFT_ENEMY_BORDER * enemyBorders;

  // Denial: the last free territory of a continent somebody else nearly holds.
  if (facts !== null && continent !== undefined) {
    const free = continent.territories.filter((x) => (view.owner[x] as number) === SEAT_NONE).length;
    if (free === 1 && facts.ownedByMe === 0) score += facts.bonus * 0.8;
  }

  // The rusher wants forward positions; the turtle wants quiet corners.
  score += springboardValue(view, t) * 0.05 * view.persona.aggression;
  return score;
}

/** R9: the unclaimed territory to take, or null. */
export function decideClaim(
  view: GameView,
  weights: BotWeights = DEFAULT_WEIGHTS,
): TerritoryId | null {
  const scored: { score: number; id: number }[] = [];
  for (let t = 0; t < view.owner.length; t++) {
    if ((view.owner[t] as number) !== SEAT_NONE) continue;
    if ((view.blizzard[t] as number) === 1) continue;
    scored.push({ score: claimScore(view, t, weights), id: t });
  }
  if (scored.length === 0) return null;
  scored.sort(byScoreThenId);
  return (scored[0] as { id: number }).id;
}

/**
 * Where to put `count` troops this draft. Always distributes exactly `count`, or nothing when the
 * bot owns nothing.
 */
export function decidePlacements(
  view: GameView,
  count: number,
  weights: BotWeights = DEFAULT_WEIGHTS,
): readonly { readonly territory: TerritoryId; readonly count: number }[] {
  if (count <= 0) return [];
  const mine = myTerritories(view);
  if (mine.length === 0) return [];

  switch (view.persona.placement) {
    case "spread":
      return spread(view, mine, count);
    case "stack":
      return [{ territory: bestStack(view, mine), count }];
    case "frontLoad":
      return [{ territory: bestSpringboard(view, mine), count }];
    case "secure":
    default:
      return secure(view, count, weights);
  }
}

/** One troop at a time, in territory order — naive, and meant to look naive. */
function spread(
  view: GameView,
  mine: readonly TerritoryId[],
  count: number,
): readonly { readonly territory: TerritoryId; readonly count: number }[] {
  const out = new Map<TerritoryId, number>();
  for (let i = 0; i < count; i++) {
    const t = mine[i % mine.length] as TerritoryId;
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return [...out.entries()]
    .map(([territory, n]) => ({ territory, count: n }))
    .sort((a, b) => a.territory - b.territory);
}

function bestStack(view: GameView, mine: readonly TerritoryId[]): TerritoryId {
  // The biggest pile I already have, breaking ties toward the one with something to attack.
  return [...mine]
    .sort((a, b) =>
      (view.troops[b] as number) - (view.troops[a] as number)
      || springboardValue(view, b) - springboardValue(view, a)
      || a - b)[0] as TerritoryId;
}

function bestSpringboard(view: GameView, mine: readonly TerritoryId[]): TerritoryId {
  const borders = myBorders(view);
  const pool = borders.length > 0 ? borders : mine;
  return [...pool]
    .sort((a, b) => springboardValue(view, b) - springboardValue(view, a) || a - b)[0] as TerritoryId;
}

/**
 * Fill the most-threatened borders toward `bsrTarget`, then hand the remainder to the springboard.
 *
 * Supplying a **high**-BSR territory raises its defence; supplying a **low**-BSR one raises its
 * *offensive* potential. That is the one knob separating a turtle from an attacker, and it is the
 * same code path: `stackiness` decides how much of the remainder goes forward.
 */
function secure(
  view: GameView,
  count: number,
  weights: BotWeights,
): readonly { readonly territory: TerritoryId; readonly count: number }[] {
  const borders = myBorders(view);
  if (borders.length === 0) {
    // Nothing is threatened: this is a pure springboard turn.
    return [{ territory: bestSpringboard(view, myTerritories(view)), count }];
  }

  // How many troops it would take to bring each threatened border down to `bsrTarget`.
  const need = new Map<TerritoryId, number>();
  let totalNeed = 0;
  for (const t of borders) {
    const current = bsr(view, t);
    if (current <= weights.bsrTarget) continue;
    const want = Math.ceil(threat(view, t) / weights.bsrTarget) - (view.troops[t] as number);
    if (want <= 0) continue;
    need.set(t, want);
    totalNeed += want;
  }

  const forwardShare = Math.min(0.8, view.persona.stackiness * 0.8);
  const defensive = totalNeed === 0 ? 0 : Math.min(count, Math.round(count * (1 - forwardShare)));
  const out = new Map<TerritoryId, number>();

  if (defensive > 0) {
    // Hahn's NBSR share, restricted to the borders that actually need topping up.
    const shares = nbsr(view, weights, [...need.keys()]);
    const rows = shares.size > 0 ? apportion(view, shares, defensive) : [];
    for (const row of rows) out.set(row.territory, row.count);
  }

  let placed = [...out.values()].reduce((a, b) => a + b, 0);
  if (placed < count) {
    const springboard = bestSpringboard(view, borders);
    out.set(springboard, (out.get(springboard) ?? 0) + (count - placed));
    placed = count;
  }

  return [...out.entries()]
    .filter(([, n]) => n > 0)
    .map(([territory, n]) => ({ territory, count: n }))
    .sort((a, b) => a.territory - b.territory);
}
