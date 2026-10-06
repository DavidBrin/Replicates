/**
 * Attack candidate scoring and the three stop gates (SPEC §4.13, R29–R48; research §3.2).
 *
 * ```
 * score(src,dst) = p·gain(dst) − (1−p)·sunkCost(src) − risk(dst)
 *   p        = odds.winChance(src.troops − 1, dst.troops, augment(src,dst))
 *   gain     = wTerr + wContComplete·completesContinent + wContBreak·breaksEnemyContinent
 *            + wKill·killValue(owner) + wCard·(firstConquestThisTurn ? expectedCardValue : 0)
 *   sunkCost = odds.expectedAttackerLoss(...)        // off the distribution, never a constant
 *   risk     = Σ enemy troops adjacent to dst after capture
 * ```
 *
 * The three stacked stop gates:
 *
 * 1. **Win-probability floor** — `persona.minWinChance`, or `score ≤ 0` when
 *    `dynamicMinWinChance` (Expert). Stopping *because the maths says so* is the single biggest
 *    strength jump between Hard and Expert, and it costs one extra comparison.
 * 2. **Border reserve** — never attack out of a territory if it would drop below
 *    `reserve(t)`. This is the concrete form of "keep X troops on borders".
 * 3. **Marginal value** — the best candidate must still be positive.
 *
 * The hard dice gate from research §4.2: **3v2 is only a 1.172:1 edge, 2v2 is 0.638 and 1v2 is
 * 0.342** — both losing trades. So never initiate from fewer than 4 troops (3 dice + 1 behind)
 * unless the target has 1 troop, or the move completes or denies a continent.
 */

import type { OddsTables, Seat, TerritoryId } from "@/engine";

import {
  augmentFor, canAttack, continentOf, expectedCardValue, exposureAfterCapture, holdsContinent,
  killValue, myTerritories, neighbours, opponents, reserve, boardShare, hostility, leaderShare,
} from "./score";
import { byScoreThenId, DEFAULT_WEIGHTS, type BotWeights, type GameView } from "./types";
import { isEnemy } from "./view";

export interface AttackCandidate {
  readonly from: TerritoryId;
  readonly to: TerritoryId;
  readonly score: number;
  /** A total-order id for `byScoreThenId`: `from · territories + to`, so it never ties. */
  readonly id: number;
  readonly winChance: number;
  readonly gain: number;
  readonly sunkCost: number;
  readonly risk: number;
  readonly eliminates: Seat | null;
  readonly completesContinent: boolean;
  readonly breaksContinent: boolean;
}

/** Would taking `to` give me every territory of its continent? */
function completesContinent(view: GameView, to: TerritoryId): boolean {
  const c = continentOf(view, to);
  if (c < 0) return false;
  const continent = view.map.continents[c];
  if (continent === undefined) return false;
  return continent.territories.every((t) => t === to || (view.owner[t] as number) === view.me);
}

/** Does `to`'s owner currently hold `to`'s continent outright? */
function breaksContinent(view: GameView, to: TerritoryId): number {
  const c = continentOf(view, to);
  if (c < 0) return 0;
  const owner = view.owner[to] as number;
  if (owner < 0) return 0;
  if (!holdsContinent(view, c, owner)) return 0;
  return view.map.continents[c]?.bonus ?? 0;
}

/**
 * `w_contBreak = bonus(c) · expectedTurnsBroken`, `expectedTurnsBroken = 1/(1 + reconquestEase)`.
 *
 * And the rule that stops the one-territory poke into a 7-troop Asia: **only break if the captured
 * territory's post-capture BSR ≥ 1.0, or the bonus denied ≥ 5.** A break they retake next turn just
 * fed them a card.
 */
function breakValue(view: GameView, to: TerritoryId, troopsMovingIn: number): number {
  const bonus = breaksContinent(view, to);
  if (bonus === 0) return 0;
  const exposure = exposureAfterCapture(view, to);
  const postCaptureBsr = troopsMovingIn <= 0 ? Number.POSITIVE_INFINITY : exposure / troopsMovingIn;
  if (postCaptureBsr < 1.0 && bonus < 5) return 0;
  const reconquestEase = exposure / Math.max(1, troopsMovingIn);
  return bonus * (1 / (1 + reconquestEase));
}

/** Would taking `to` eliminate its owner — i.e. is it their last territory? */
function eliminatesOwner(view: GameView, to: TerritoryId): Seat | null {
  const owner = view.owner[to] as number;
  if (owner < 0) return null;
  return (view.territoryCount[owner] ?? 0) === 1 ? owner : null;
}

export function scoreAttack(
  view: GameView,
  odds: OddsTables,
  from: TerritoryId,
  to: TerritoryId,
  weights: BotWeights = DEFAULT_WEIGHTS,
): AttackCandidate {
  const a = (view.troops[from] as number) - 1; // R38: A excludes the garrison
  const d = view.troops[to] as number;
  const aug = augmentFor(view, to);
  const persona = view.persona;

  /**
   * `usesExactOdds: false` (Beginner, Easy) does **not** mean a second, deliberately-buggy
   * evaluation path (D29) — the scoring maths is identical at every tier. It means the win chance
   * comes from the crude troop-ratio guess those tiers are documented to use, so the one code path
   * is preserved and determinism stays simple.
   */
  const p = persona.usesExactOdds
    ? odds.winChance(a, d, aug)
    : crudeWinChance(a, d);

  const sunkCost = odds.expectedAttackerLoss(a, d, aug);
  const risk = exposureAfterCapture(view, to);

  const completes = completesContinent(view, to);
  const minimumMoveIn = Math.min(a, 3);
  const broken = breakValue(view, to, minimumMoveIn);
  const victim = eliminatesOwner(view, to);

  let gain = weights.wTerr * (0.5 + persona.expansionism);
  if (completes) gain += weights.wContComplete * (0.5 + persona.continentFocus);
  gain += broken * (0.5 + persona.continentFocus);
  if (victim !== null && persona.seesKillForCards) gain += weights.wKill * killValue(view, victim, weights);
  else if (victim !== null) gain += weights.wKill * (view.territoryCount[victim] ?? 0) * weights.wTerr;
  if (!view.conqueredThisTurn) gain += weights.wCard * expectedCardValue(view, view.me);

  // Target selection among players: fold the per-opponent hostility into the gain so "hit the
  // leader", "don't poke a turtle", grudges and alliances all steer attacks without a special case.
  const owner = view.owner[to] as number;
  if (owner >= 0) gain += 0.25 * hostility(view, owner, weights);

  // Domination awareness: near the threshold, switch from value-maximising to count-maximising;
  // when an opponent is near it, switch to denial even at negative local score.
  if (persona.seesDominationThreshold) {
    if (boardShare(view, view.me) > view.rules.dominationThreshold - 0.1) gain += weights.wTerr;
    if (owner >= 0 && boardShare(view, owner) >= leaderShare(view) && leaderShare(view) > view.rules.dominationThreshold - 0.1) {
      gain += weights.wTerr * 2;
    }
  }

  const score = p * gain - (1 - p) * sunkCost * (1.5 - persona.aggression) - risk * 0.05;

  return {
    from, to, score,
    id: from * view.map.territories.length + to,
    winChance: p, gain, sunkCost, risk,
    eliminates: victim,
    completesContinent: completes,
    breaksContinent: broken > 0,
  };
}

/** The crude troop-ratio guess the two lowest tiers use instead of the exact table. */
export function crudeWinChance(a: number, d: number): number {
  if (a <= 0) return d === 0 ? 1 : 0;
  if (d <= 0) return 1;
  const ratio = a / (a + d * 1.05);
  return Math.min(1, Math.max(0, ratio));
}

/** Every legal attack, scored, in `byScoreThenId` order. */
export function attackCandidates(
  view: GameView,
  odds: OddsTables,
  weights: BotWeights = DEFAULT_WEIGHTS,
): readonly AttackCandidate[] {
  const out: AttackCandidate[] = [];
  for (const from of myTerritories(view)) {
    if ((view.troops[from] as number) < 2) continue;
    for (const to of neighbours(view, from)) {
      if (!canAttack(view, from, to)) continue;
      out.push(scoreAttack(view, odds, from, to, weights));
    }
  }
  return out.sort(byScoreThenId);
}

/** Gate 2 and the research §4.2 dice gate. Pure, so a test can drive it directly. */
export function passesGates(view: GameView, candidate: AttackCandidate): boolean {
  const persona = view.persona;
  const from = candidate.from;
  const sourceTroops = view.troops[from] as number;
  const target = view.troops[candidate.to] as number;

  // Gate 2 — the border reserve. Attacking commits every troop above the garrison, so the floor is
  // the reserve plus the one that must stay behind.
  if (sourceTroops - 1 < reserve(view, from) && !candidate.completesContinent) return false;

  // The dice gate: 2v2 (0.638) and 1v2 (0.342) are losing trades.
  const worthIt = target <= 1 || candidate.completesContinent || candidate.breaksContinent
    || candidate.eliminates !== null;
  if (sourceTroops < 4 && !worthIt) return false;

  // Gate 1 — the win-probability floor. Expert's floor is `score <= 0` and `minWinChance` is ignored.
  if (persona.dynamicMinWinChance) return candidate.score > 0;
  if (candidate.winChance < persona.minWinChance) return false;
  return candidate.score > 0;
}

/** `hoarder` attacks only when dominant: strongest live seat by troop count. */
export function isDominant(view: GameView): boolean {
  const mine = view.troopCount[view.me] ?? 0;
  for (const p of opponents(view)) if ((view.troopCount[p] ?? 0) >= mine) return false;
  return true;
}

/**
 * The Attack Limiter floor for a planned attack, or undefined for fight-to-the-death.
 *
 * A bot sets a limiter exactly when it is attacking out of a territory it still needs to hold:
 * the floor is its reserve plus the garrison, and only when that leaves a real battle to fight.
 */
export function stopUntilFor(view: GameView, candidate: AttackCandidate): number | undefined {
  const sourceTroops = view.troops[candidate.from] as number;
  const floor = reserve(view, candidate.from) + 1;
  if (floor <= 1 || floor >= sourceTroops) return undefined;
  // Certain wins need no hedge (R57's lever).
  return floor;
}

/** Does any enemy still border me at all? */
export function hasAnyTarget(view: GameView): boolean {
  for (const from of myTerritories(view)) {
    for (const to of neighbours(view, from)) if (isEnemy(view, view.owner[to] as number)) return true;
  }
  return false;
}
