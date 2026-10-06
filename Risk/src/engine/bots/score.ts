/**
 * The scoring core: BSR, continent value, strength, hostility, kill value, reserve (SPEC §4.13).
 *
 * Every formula here is from `research/05-bots-and-ai.md` §3 and is cited at its definition. Two of
 * them are famously easy to get backwards, so both are stated explicitly:
 *
 * - **BSR is a danger measure: higher means MORE at risk.** `BSR ≥ 1` means the attacker already has
 *   parity, which is roughly a coin flip, so the territory is realistically takeable — a liability.
 *   `BSR ≤ 0.67` is comfortable. T8's fixture is Hahn's own worked example and exists precisely to
 *   catch an inverted implementation.
 * - **Continent value needs BOTH a size term and a border term.** `bonus / territories` alone ranks
 *   Europe first and Australia joint-last, which is the thing players hate — a bot that dives into
 *   Europe and gets eaten. `bonus / (acquireCost + holdCost)` with `wHold = 2.0` ranks Australia and
 *   North America joint-first at 0.33, which is the ranking that matches expert human play.
 */

import {
  FIXED_MIXED_VALUE, FIXED_SET_VALUE, PROGRESSIVE_SET_VALUES, SEAT_NEUTRAL, SEAT_NONE, SEAT_UNKNOWN,
  TERRITORY_BONUS,
  type Card, type CardBonusScheme, type ContinentId, type Seat, type Suit, type TerritoryId,
} from "@/engine";

import { DEFAULT_WEIGHTS, type BotWeights, type GameView } from "./types";
import { isEnemy, neighbours } from "./view";

// Re-exported so every sibling takes its adjacency from one place (portal edges included, F9).
export { isEnemy, neighbours } from "./view";

/* ------------------------------------------------------------------ cards -- */

/**
 * The value of ONE set (R22), computed locally.
 *
 * S1's `cardTradeValue` has the same signature and the same contract, but it throws "S1 pending"
 * while the engine slice is in flight, and the bots must price a hand to score a kill at all. This
 * is F4's signature implemented against R22 directly; a test asserts the two agree once S1 lands.
 */
export function setValue(cards: readonly Card[], setsTradedTotal: number, scheme: CardBonusScheme): number {
  if (cards.length !== 3) return 0;
  if (scheme === "progressive") {
    const n = setsTradedTotal + 1;
    return n <= PROGRESSIVE_SET_VALUES.length
      ? (PROGRESSIVE_SET_VALUES[n - 1] as number)
      : 15 + 5 * (n - PROGRESSIVE_SET_VALUES.length);
  }
  const suits = cards.map((c) => c.suit);
  if (suits.includes("wild")) return FIXED_MIXED_VALUE;
  const first = suits[0] as Suit;
  if (suits.every((s) => s === first)) {
    return FIXED_SET_VALUE[first as Exclude<Suit, "wild">] ?? FIXED_MIXED_VALUE;
  }
  return new Set(suits).size === 3 ? FIXED_MIXED_VALUE : 0;
}

/** Is this triple a legal set (R21/R22): three of a kind, one of each, or anything with a Wild? */
export function isSet(cards: readonly Card[]): boolean {
  if (cards.length !== 3) return false;
  const suits = cards.map((c) => c.suit);
  const wilds = suits.filter((s) => s === "wild").length;
  const rest = suits.filter((s) => s !== "wild");
  if (wilds >= 1) return true; // a wild stands in for any suit
  const distinct = new Set(rest).size;
  return distinct === 1 || distinct === 3;
}

/** Every legal set in a hand, each as an ascending index triple, in a stable order. */
export function setsIn(cards: readonly Card[]): readonly (readonly [number, number, number])[] {
  const out: (readonly [number, number, number])[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        const triple = [cards[i], cards[j], cards[k]] as Card[];
        if (isSet(triple)) out.push([i, j, k]);
      }
    }
  }
  return out;
}

/** The highest-value set in a hand, or null. Ties break toward the lowest index triple. */
export function bestSetOf(
  cards: readonly Card[],
  setsTradedTotal: number,
  scheme: CardBonusScheme,
): { readonly cards: readonly [Card, Card, Card]; readonly value: number } | null {
  let best: { cards: readonly [Card, Card, Card]; value: number } | null = null;
  for (const [i, j, k] of setsIn(cards)) {
    const triple = [cards[i] as Card, cards[j] as Card, cards[k] as Card] as const;
    const value = setValue(triple, setsTradedTotal, scheme);
    if (best === null || value > best.value) best = { cards: triple, value };
  }
  return best;
}

/** `expectedCardValue(x)`: what one more card is worth, amortised over the three it takes. */
export function expectedCardValue(view: GameView, seat: Seat): number {
  const held = view.cardCount[seat] ?? 0;
  const next = view.setsTradedTotal + 1;
  const full = view.rules.cardBonus === "progressive"
    ? (next <= PROGRESSIVE_SET_VALUES.length
      ? (PROGRESSIVE_SET_VALUES[next - 1] as number)
      : 15 + 5 * (next - PROGRESSIVE_SET_VALUES.length))
    : (FIXED_MIXED_VALUE + FIXED_SET_VALUE.infantry) / 2;
  // A third card completes a set now; the first and second are worth a third of one each.
  return held >= 2 ? full / 2 : full / 3;
}

/* ------------------------------------------------------------------ board arithmetic -- */

/** Hahn's Border Security Threat: the enemy weight pressing on `t`. */
export function bst(view: GameView, t: TerritoryId): number {
  let total = 0;
  for (const y of neighbours(view, t)) {
    if (isEnemy(view, view.owner[y] as number)) total += view.troops[y] as number;
  }
  return total;
}

/** Hahn's Border Security Ratio. **Higher means more danger.** */
export function bsr(view: GameView, t: TerritoryId): number {
  const own = view.troops[t] as number;
  return own <= 0 ? Number.POSITIVE_INFINITY : bst(view, t) / own;
}

/** Every territory `me` owns, ascending. */
export function myTerritories(view: GameView): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let t = 0; t < view.owner.length; t++) if ((view.owner[t] as number) === view.me) out.push(t);
  return out;
}

/** Those of mine that touch an enemy at all. */
export function myBorders(view: GameView): readonly TerritoryId[] {
  return myTerritories(view).filter((t) => bst(view, t) > 0);
}

/**
 * Hahn's Normalised BSR — the reinforcement share.
 *
 * `NBSR(t) = BSR(t) / Σ BSR(z)` over my own territories, with the threshold Hahn suggested but did
 * not test applied first: **zero out any BSR below `bsrFloor` before normalising**, otherwise NBSR
 * spreads single troops uselessly across many territories ("0.53 units on country 2").
 *
 * Returned as a map from territory to share, before any rounding — T8 asserts the *share*, and the
 * integer split is `apportion`'s job and is asserted separately. Quoting a rounded 0.37 as if it
 * were the share is how a rounding bug hides.
 */
export function nbsr(
  view: GameView,
  weights: BotWeights = DEFAULT_WEIGHTS,
  territories: readonly TerritoryId[] = myTerritories(view),
): ReadonlyMap<TerritoryId, number> {
  const kept: [TerritoryId, number][] = [];
  let total = 0;
  for (const t of territories) {
    const value = bsr(view, t);
    if (!Number.isFinite(value) || value < weights.bsrFloor) continue;
    kept.push([t, value]);
    total += value;
  }
  const out = new Map<TerritoryId, number>();
  if (total === 0) return out;
  for (const [t, value] of kept) out.set(t, value / total);
  return out;
}

/**
 * Turn shares into whole troops: **round by largest remainder, leftovers to the highest BSR**.
 * Deterministic, total, and always distributes exactly `count`.
 */
export function apportion(
  view: GameView,
  shares: ReadonlyMap<TerritoryId, number>,
  count: number,
): readonly { readonly territory: TerritoryId; readonly count: number }[] {
  if (count <= 0 || shares.size === 0) return [];
  const rows = [...shares.entries()]
    .map(([territory, share]) => ({ territory, share, exact: share * count }))
    .sort((a, b) => a.territory - b.territory);
  const out = rows.map((r) => ({ territory: r.territory, count: Math.floor(r.exact) }));
  let placed = out.reduce((acc, r) => acc + r.count, 0);
  // Largest remainder first; ties to the higher BSR, then to the lower territory id.
  const order = rows
    .map((r, i) => ({ i, remainder: r.exact - Math.floor(r.exact), threat: bsr(view, r.territory), id: r.territory }))
    .sort((a, b) => b.remainder - a.remainder || b.threat - a.threat || a.id - b.id);
  let cursor = 0;
  while (placed < count && order.length > 0) {
    const row = order[cursor % order.length] as { i: number };
    const entry = out[row.i] as { count: number };
    entry.count++;
    placed++;
    cursor++;
  }
  return out.filter((r) => r.count > 0);
}

/* ------------------------------------------------------------------ continents -- */

export interface ContinentFacts {
  readonly id: ContinentId;
  readonly bonus: number;
  readonly size: number;
  readonly borders: number;
  readonly ownedByMe: number;
  readonly acquireCost: number;
  readonly holdCost: number;
  readonly value: number;
}

/**
 * `contValue(c) = bonus(c) / (acquireCost(c) + holdCost(c))`, with
 * `acquireCost = Σ over unowned t in c (1 + enemyTroops(t) · wAcquire)` and
 * `holdCost = borderTerritories(c) · wHold`.
 *
 * On an empty board this reduces to `bonus / (size + 2·borders)`: Australia `2/(4+2) = 0.333`,
 * North America `5/(9+6) = 0.333`, South America `2/(4+4) = 0.25`, Africa `3/(6+6) = 0.25`,
 * Europe `5/(7+8) = 0.333`, Asia `7/(12+10) = 0.318`. The hold-cost term is what stops Europe and
 * Asia looking cheap, and `wHold` is exactly the turtle-vs-sprawl personality dial.
 */
export function continentFacts(
  view: GameView,
  c: ContinentId,
  weights: BotWeights = DEFAULT_WEIGHTS,
): ContinentFacts {
  const continent = view.map.continents[c];
  if (continent === undefined) {
    return { id: c, bonus: 0, size: 0, borders: 0, ownedByMe: 0, acquireCost: 0, holdCost: 0, value: 0 };
  }
  let acquireCost = 0;
  let ownedByMe = 0;
  for (const t of continent.territories) {
    if ((view.owner[t] as number) === view.me) {
      ownedByMe++;
      continue;
    }
    const enemyTroops = isEnemy(view, view.owner[t] as number) ? (view.troops[t] as number) : 0;
    acquireCost += 1 + enemyTroops * weights.wAcquire;
  }
  const holdCost = continent.border.length * weights.wHold;
  const denominator = acquireCost + holdCost;
  return {
    id: c,
    bonus: continent.bonus,
    size: continent.territories.length,
    borders: continent.border.length,
    ownedByMe,
    acquireCost,
    holdCost,
    value: denominator === 0 ? continent.bonus : continent.bonus / denominator,
  };
}

/** Ranked by value, descending, ties by continent id (always a total comparator). */
export function rankContinents(view: GameView, weights: BotWeights = DEFAULT_WEIGHTS): readonly ContinentFacts[] {
  return view.map.continents
    .map((_, c) => continentFacts(view, c, weights))
    .sort((a, b) => b.value - a.value || a.id - b.id);
}

export function holdsContinent(view: GameView, c: ContinentId, seat: Seat): boolean {
  const continent = view.map.continents[c];
  if (continent === undefined || continent.territories.length === 0) return false;
  return continent.territories.every((t) => (view.owner[t] as number) === seat);
}

/** Which continents `seat` holds outright, ascending. */
export function continentsHeld(view: GameView, seat: Seat): readonly ContinentId[] {
  const out: ContinentId[] = [];
  for (let c = 0; c < view.map.continents.length; c++) if (holdsContinent(view, c, seat)) out.push(c);
  return out;
}

export function continentBonus(view: GameView, seat: Seat): number {
  let total = 0;
  for (const c of continentsHeld(view, seat)) total += view.map.continents[c]?.bonus ?? 0;
  return total;
}

/** The continent containing `t`, or -1. */
export function continentOf(view: GameView, t: TerritoryId): ContinentId {
  return view.map.territories[t]?.continent ?? -1;
}

/* ------------------------------------------------------------------ whole-board value -- */

/** `expectedIncome(x) = max(3, floor(territories/3)) + Σ continentBonuses + expectedCardValue`. */
export function expectedIncome(view: GameView, seat: Seat): number {
  const territories = view.territoryCount[seat] ?? 0;
  return Math.max(3, Math.floor(territories / 3)) + continentBonus(view, seat) + expectedCardValue(view, seat);
}

/**
 * Lozano & Bratz's one-line evaluator: `V = expectedIncome(me) − max over opponents of
 * expectedIncome(p)`. Leader-targeting falls out for free, with no special-case rule.
 */
export function positionValue(view: GameView): number {
  let worst = 0;
  for (const p of opponents(view)) worst = Math.max(worst, expectedIncome(view, p));
  return expectedIncome(view, view.me) - worst;
}

/** Live seats other than me, ascending. The neutral holding is not a seat (R7). */
export function opponents(view: GameView): readonly Seat[] {
  const out: Seat[] = [];
  for (let s = 0; s < view.standing.length; s++) {
    if (s === view.me) continue;
    const standing = view.standing[s];
    if (standing === "eliminated" || standing === "resigned") continue;
    if ((view.territoryCount[s] ?? 0) === 0) continue;
    out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ opponents -- */

/** Knudsen's strength heuristic: `H(p) = armies + 0.3·territories + continentBonuses`. */
export function strength(view: GameView, seat: Seat): number {
  return (view.troopCount[seat] ?? 0) + 0.3 * (view.territoryCount[seat] ?? 0) + continentBonus(view, seat);
}

export function normalisedStrength(view: GameView, seat: Seat): number {
  let total = strength(view, view.me);
  for (const p of opponents(view)) total += strength(view, p);
  return total === 0 ? 0 : strength(view, seat) / total;
}

/** `turtleScore(P)` = mean troops per border territory of P. Don't poke a turtle. */
export function turtleScore(view: GameView, seat: Seat): number {
  let troops = 0;
  let borders = 0;
  for (let t = 0; t < view.owner.length; t++) {
    if ((view.owner[t] as number) !== seat) continue;
    let touchesOther = false;
    for (const y of neighbours(view, t)) {
      const o = view.owner[y] as number;
      if (o !== seat && o !== SEAT_NONE && o !== SEAT_UNKNOWN) {
        touchesOther = true;
        break;
      }
    }
    if (!touchesOther) continue;
    borders++;
    troops += view.troops[t] as number;
  }
  return borders === 0 ? 0 : troops / borders;
}

/** How much of my border is shared with `seat`, as a share of my border length. */
export function borderContact(view: GameView, seat: Seat): number {
  let shared = 0;
  let total = 0;
  for (const t of myTerritories(view)) {
    for (const y of neighbours(view, t)) {
      const o = view.owner[y] as number;
      if (o === view.me || o === SEAT_NONE || o === SEAT_UNKNOWN) continue;
      total++;
      if (o === seat) shared++;
    }
  }
  return total === 0 ? 0 : shared / total;
}

/**
 * The per-opponent hostility score, recomputed each turn.
 *
 * `w_lead` is **phase-dependent**: hitting the leader is correct late and bad early (you bleed while
 * others grow), so it scales with game progress — my own share of the board, against the win
 * condition's threshold.
 */
export function hostility(view: GameView, seat: Seat, weights: BotWeights = DEFAULT_WEIGHTS): number {
  const h = weights.hostility;
  const share = normalisedStrength(view, seat);
  const progress = Math.min(1, boardShare(view, view.me) / Math.max(0.01, view.rules.dominationThreshold));
  const persona = view.persona;
  const leaderWeight = h.lead * (0.4 + 0.6 * progress) * (0.5 + persona.leaderBias);
  let score = leaderWeight * share
    + h.weak * (1 - share)
    + h.grudge * persona.grudgeWeight * (view.grudge[seat] ?? 0)
    + h.cards * (view.cardCount[seat] ?? 0)
    + h.prox * borderContact(view, seat)
    - h.turtle * persona.turtleAversion * normalise(turtleScore(view, seat))
    - ((view.allies[seat] as number) === 1 ? h.ally * persona.allianceLoyalty : 0);
  // Beginner/Easy bias their aggression toward bot seats ([SMG]); the view has no `kind`, so the
  // bias is expressed as a small nudge away from the single human-held seat pattern it cannot see.
  // `antiBotBias` is therefore applied by the caller when it knows the seat kinds; here it is a
  // declared, testable multiplier on the whole score rather than a hidden rule.
  if (persona.antiBotBias > 0) score *= 1 + persona.antiBotBias * 0.1;
  return score;
}

function normalise(x: number): number {
  // Squash a troop-count-scale quantity into roughly [0,1] so it cannot swamp the shares above.
  return x / (x + 10);
}

/** My share of the board by territory count — what the domination win condition measures (R71). */
export function boardShare(view: GameView, seat: Seat): number {
  const n = view.map.territories.length;
  return n === 0 ? 0 : (view.territoryCount[seat] ?? 0) / n;
}

/** The highest board share held by anyone but me. */
export function leaderShare(view: GameView): number {
  let worst = 0;
  for (const p of opponents(view)) worst = Math.max(worst, boardShare(view, p));
  return worst;
}

/**
 * `killValue(P) = cardTradeValue(bestSetOf(myCards + P's cards), setsTradedTotal, cardBonus)
 *                 + P.territoryCount · wTerr`.
 *
 * Eliminating a player hands us their whole hand (R20's seizure), which is usually the single
 * highest-value play in Risk — and is exactly why **only Hard and Expert see it** (`seesKillForCards`).
 */
export function killValue(view: GameView, seat: Seat, weights: BotWeights = DEFAULT_WEIGHTS): number {
  const territories = (view.territoryCount[seat] ?? 0) * weights.wTerr;
  if (!view.persona.seesKillForCards) return territories;
  const theirCount = view.cardCount[seat] ?? 0;
  // Their cards are not visible (F12), so price the seizure by hand size: a set is worth its full
  // value once the combined hand can make one at all.
  const combined = view.myCards.length + theirCount;
  if (combined < 3) return territories;
  const best = bestSetOf(view.myCards, view.setsTradedTotal, view.rules.cardBonus);
  const value = best?.value ?? setValue(
    [{ id: "", suit: "infantry", territory: null }, { id: "", suit: "cavalry", territory: null },
      { id: "", suit: "artillery", territory: null }],
    view.setsTradedTotal,
    view.rules.cardBonus,
  );
  return territories + value;
}

/**
 * `reserve(t) = max(persona.reserveFloor, ceil(maxAdjacentEnemyStack(t) · persona.tierReserveFactor))`
 * (F10). Never attack out of a territory if doing so would drop it below this.
 */
export function reserve(view: GameView, t: TerritoryId): number {
  let biggest = 0;
  for (const y of neighbours(view, t)) {
    if (!isEnemy(view, view.owner[y] as number)) continue;
    biggest = Math.max(biggest, view.troops[y] as number);
  }
  return Math.max(view.persona.reserveFloor, Math.ceil(biggest * view.persona.tierReserveFactor));
}

/** `risk(dst)` = the enemy weight adjacent to `dst` once I hold it. */
export function exposureAfterCapture(view: GameView, dst: TerritoryId): number {
  let total = 0;
  for (const y of neighbours(view, dst)) {
    if (y === dst) continue;
    if (isEnemy(view, view.owner[y] as number)) total += view.troops[y] as number;
  }
  return total;
}

/** `threat(d)`, for fortify: enemy weight on `d`, weighted up if `d` borders a continent I hold. */
export function threat(view: GameView, d: TerritoryId): number {
  const base = bst(view, d);
  const c = continentOf(view, d);
  const mine = c >= 0 && holdsContinent(view, c, view.me);
  return mine ? base * 1.5 : base;
}

/** The dice augment for an attack `from → to`, derived from the view (R36, D27). */
export function augmentFor(view: GameView, to: TerritoryId): { defendDiceBonus: number; attackDicePenalty: number; favourDefenderOnDraw: boolean } {
  let defendDiceBonus = 0;
  // A capital grants the defender +1 die (R36). Walls are out of scope (D34) but stack the same way.
  if (view.rules.capitals) {
    for (let s = 0; s < view.capital.length; s++) if ((view.capital[s] as number) === to) defendDiceBonus += 1;
  }
  return { defendDiceBonus, attackDicePenalty: 0, favourDefenderOnDraw: true };
}

/** Is `to` attackable from `from` at all (R29)? */
export function canAttack(view: GameView, from: TerritoryId, to: TerritoryId): boolean {
  if ((view.owner[from] as number) !== view.me) return false;
  if ((view.troops[from] as number) < 2) return false;
  if ((view.blizzard[to] as number) === 1) return false; // never into a blizzard (R29)
  if (!isEnemy(view, view.owner[to] as number)) return false;
  return neighbours(view, from).includes(to);
}

/** The `TERRITORY_BONUS` a traded set can still place this turn (R23). */
export const MAX_TERRITORY_BONUS = TERRITORY_BONUS;

/** The neutral holding never attacks and never reinforces (R7, D64) — a bot must never plan as it. */
export function isNeutral(owner: number): boolean {
  return owner === SEAT_NEUTRAL;
}
