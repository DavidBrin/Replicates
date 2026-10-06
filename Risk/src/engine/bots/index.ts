/**
 * `@/engine/bots` — `decideTurn` (SPEC §4.13, D8, D29, F20, F57).
 *
 * Pure. Same inputs → same outputs, always. **Three parameters, not five**: the acting seat is
 * `view.me` and its persona is `view.persona`, so there is exactly one source for each and no way to
 * pass a mismatched pair.
 *
 * `TurnPlan` is **data, not side effects** — the engine applies it action by action, which means the
 * UI can animate it at any speed without affecting the outcome, the plan serialises straight into
 * the replay log, and each declared attack still consumes exactly one PRNG draw when it is *applied*
 * (D6), so a replay can be verified without re-running the bot at all.
 *
 * ## Re-entry
 *
 * An attack chain is adaptive — whether the second attack is worth making depends on how the first
 * went — so `decideTurn` plans the **current phase only** and the runner re-enters it after each
 * battle. `done` is the signal: `false` means "come back to me", `true` means "this phase is
 * finished, advance". Per phase:
 *
 * | `claim`   | one `placements` entry, the territory to claim, count 1 | `done: false` |
 * | `draft`   | the card trade, if any, plus every troop placed        | `done: false` |
 * | `attack`  | at most ONE attack, or none                            | `false` / `true` |
 * | `fortify` | one move, or null                                      | `done: true` |
 *
 * ## Draw discipline (F57)
 *
 * A call consumes **zero** draws in the common path and **at most one** for a blunder — so the count
 * is **0 or 1, and which one is a pure function of the inputs**, not a constant. A
 * `blunderRate: 0` persona therefore draws nothing, ever. Ties are broken by id via
 * `byScoreThenId`, never by the PRNG, so a tie costs no draw either. There is no
 * `while (rng.nextFloat() < x)` anywhere in this directory.
 *
 * `blunderRate` is the honest way to build Easy (D29): a low-tier bot computes its scoring exactly
 * as a high-tier bot would and then picks the k-th best candidate. Nothing about the maths is ever
 * made deliberately wrong, which keeps one code path and avoids the classic bug where a "dumb" bot
 * is accidentally strong.
 */

import type { OddsTables, Rng } from "@/engine";

import { attackCandidates, hasAnyTarget, isDominant, passesGates, stopUntilFor, type AttackCandidate } from "./attack";
import { bonusTerritoryFor, decideCardTrade } from "./cards";
import { decideClaim, decidePlacements } from "./draft";
import { decideFortify } from "./fortify";
import { withLookahead } from "./lookahead";
import { DOMINANT_ONLY_PERSONAS, ONE_ATTACK_PERSONAS } from "./personas";
import { augmentFor, reserve, threat } from "./score";
import { DEFAULT_WEIGHTS, type BotWeights, type GameView, type TurnPlan } from "./types";

export type { GameView, TurnPlan, PlannedAttack, BotWeights, TierRow, Scored } from "./types";
export { DEFAULT_WEIGHTS, ANTI_BOT_BIAS, BOT_TIERS, byScoreThenId } from "./types";
export { TIERS, TIER_ORDER } from "./tiers";
export { PERSONAS, personaFor, drawPersonas, ONE_ATTACK_PERSONAS, DOMINANT_ONLY_PERSONAS } from "./personas";
export { makeView, isEnemy, neighbours } from "./view";
export * from "./score";
export { attackCandidates, scoreAttack, passesGates, crudeWinChance, isDominant, stopUntilFor, hasAnyTarget } from "./attack";
export type { AttackCandidate } from "./attack";
export { decideCardTrade, bonusTerritoryFor, mustTrade, FORCED_TRADE_AT } from "./cards";
export { decideClaim, decidePlacements, claimScore, continentCurve } from "./draft";
export { decideFortify, reachableOwned } from "./fortify";
export type { FortifyMove } from "./fortify";
export { withLookahead, bestReplyAgainst, springboardValue, LOOKAHEAD_WIDTH } from "./lookahead";

const EMPTY: TurnPlan = {
  cardTrade: null, placements: [], attacks: [], fortify: null, done: true,
};

/**
 * At most one draw per `decideTurn`, taken lazily and then reused.
 *
 * The first `u()` consumes the draw; every later call in the same turn returns the same value. A
 * decision point that does not need randomness never calls it, which is what makes the count a pure
 * function of the inputs rather than a constant.
 */
class DrawOnce {
  private value: number | null = null;
  private used = false;

  constructor(private readonly rng: Rng) {}

  u(): number {
    if (this.value === null) {
      this.value = this.rng.nextFloat();
      this.used = true;
    }
    return this.value;
  }

  get consumed(): boolean {
    return this.used;
  }
}

/**
 * Pick from a ranked list, blundering with probability `blunderRate` (D29).
 *
 * The blunder is a *choice of rank*, never a miscalculation: with probability `blunderRate` the
 * k-th best is taken instead of the best, where `k` is itself drawn from the same single `u`.
 * A list of one has nothing to blunder between, so it costs no draw.
 */
function pick<T>(ranked: readonly T[], blunderRate: number, draw: DrawOnce): T | undefined {
  if (ranked.length === 0) return undefined;
  if (ranked.length === 1 || blunderRate <= 0) return ranked[0];
  const u = draw.u();
  if (u >= blunderRate) return ranked[0];
  // Spread the remaining probability over ranks 1..min(3, len-1), deterministically from the same u.
  const span = Math.min(3, ranked.length - 1);
  const k = 1 + Math.min(span - 1, Math.floor((u / blunderRate) * span));
  return ranked[k];
}

export function decideTurn(view: GameView, odds: OddsTables, rng: Rng, weights: BotWeights = DEFAULT_WEIGHTS): TurnPlan {
  const draw = new DrawOnce(rng);

  switch (view.phase) {
    case "claim": {
      const territory = decideClaim(view, weights);
      if (territory === null) return EMPTY;
      return { cardTrade: null, placements: [{ territory, count: 1 }], attacks: [], fortify: null, done: false };
    }

    case "draft": {
      const cardTrade = decideCardTrade(view, weights);
      // R23: the +2 goes on the most threatened match I still hold.
      const cardTradeBonus = cardTrade === null
        ? null
        : bonusTerritoryFor(view, cardTrade, (t) => threat(view, t));
      // The placements are scored against the troops the view already knows about; the runner
      // re-enters after a trade so the extra armies are placed with full information.
      const placements = decidePlacements(view, view.troopsToPlace, weights);
      return { cardTrade, cardTradeBonus, placements, attacks: [], fortify: null, done: false };
    }

    case "attack": {
      const attack = chooseAttack(view, odds, draw, weights);
      if (attack === null) {
        return { cardTrade: null, placements: [], attacks: [], fortify: null, done: true };
      }
      return { cardTrade: null, placements: [], attacks: [attack], fortify: null, done: false };
    }

    case "fortify": {
      const fortify = decideFortify(view, weights);
      return { cardTrade: null, placements: [], attacks: [], fortify, done: true };
    }

    case "over":
    default:
      return EMPTY;
  }
}

function chooseAttack(
  view: GameView,
  odds: OddsTables,
  draw: DrawOnce,
  weights: BotWeights,
): TurnPlan["attacks"][number] | null {
  const persona = view.persona;

  // `turtle` caps itself at one attack per turn; once it has conquered, it is done (§4.13).
  if (ONE_ATTACK_PERSONAS.includes(persona.name) && view.conqueredThisTurn) return null;
  // `hoarder` attacks only when dominant.
  if (DOMINANT_ONLY_PERSONAS.includes(persona.name) && !isDominant(view)) return null;
  if (!hasAnyTarget(view)) return null;

  const scored = withLookahead(view, odds, attackCandidates(view, odds, weights), weights);
  const legal = scored.filter((c) => passesGates(view, c));
  if (legal.length === 0) return null;

  const chosen = pick(legal, persona.blunderRate, draw) as AttackCandidate | undefined;
  if (chosen === undefined) return null;

  const sourceTroops = view.troops[chosen.from] as number;
  // R36 — the same augment `scoreAttack` priced this candidate with. A hard-coded
  // standard augment calls a capital assault certain at odds the capital's extra
  // defence die makes it anything but, and then drops the limiter (R57) on the
  // strength of it.
  const certain = odds.certainWin(sourceTroops - 1, view.troops[chosen.to] as number, augmentFor(view, chosen.to));
  // R57's lever: a certain win needs no hedge, so no limiter, and everything spare can move in.
  const stopUntil = certain ? undefined : stopUntilFor(view, chosen);

  // How much to occupy with (R63). A continent I have just completed, or a break I must hold, wants
  // everything spare; otherwise leave the source its reserve.
  const keep = Math.max(1, reserve(view, chosen.from));
  const wantsEverything = chosen.completesContinent || chosen.breaksContinent
    || chosen.eliminates !== null || threat(view, chosen.to) > sourceTroops;
  const moveIn: "min" | "max" | number = wantsEverything
    ? "max"
    : sourceTroops - keep > 3
      ? Math.max(3, sourceTroops - keep)
      : "min";

  return {
    from: chosen.from,
    to: chosen.to,
    // R61: Manual Roll is always True Random, so a bot that wants the active dice mode's odds to
    // apply must Blitz. Blitz is also the default each turn (R46).
    mode: "blitz",
    ...(stopUntil === undefined ? {} : { stopUntil }),
    moveIn,
  };
}

/**
 * How many PRNG draws a `decideTurn` with these inputs will consume: 0 or 1, a pure function of the
 * inputs (F57). Exported so T5 can assert the *function* rather than a fixed constant.
 */
export function drawCountFor(view: GameView, odds: OddsTables, weights: BotWeights = DEFAULT_WEIGHTS): 0 | 1 {
  if (view.persona.blunderRate <= 0) return 0;
  if (view.phase !== "attack") return 0;
  const persona = view.persona;
  if (ONE_ATTACK_PERSONAS.includes(persona.name) && view.conqueredThisTurn) return 0;
  if (DOMINANT_ONLY_PERSONAS.includes(persona.name) && !isDominant(view)) return 0;
  if (!hasAnyTarget(view)) return 0;
  const scored = withLookahead(view, odds, attackCandidates(view, odds, weights), weights);
  const legal = scored.filter((c) => passesGates(view, c));
  return legal.length > 1 ? 1 : 0;
}
