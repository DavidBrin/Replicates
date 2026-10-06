/**
 * A greedy stand-in for S2's `@/engine/bots` (SPEC §4.13), so a solo game is
 * playable and the bot runner's pacing, re-entry and hand-off can be tested
 * before the real personas land.
 *
 * It makes no claim to be a tier: one persona literal, a reserve-aware draft,
 * a favourable-odds attack chain and a back-to-front fortify. Pure, and the
 * draw count is a pure function of its inputs (0 draws unless a tie breaks).
 */
import type {
  BotPersona, BotTier, GameState, MapDef, OddsTables, Rng, Seat, TerritoryId,
} from "@/engine/types";
import { SEAT_UNKNOWN, TROOPS_UNKNOWN } from "@/engine/types";
import type { GameView, TurnPlan } from "@/engine/bots/types";

import { legalAttackTargets, legalFortifyMoves, territoriesOf, cardSets } from "./scriptedEngine";
import { nextInt } from "./scriptedRng";

const PERSONA_NAMES = ["rusher", "turtle", "assassin", "diplomat", "opportunist", "hoarder", "scholar", "gambler"];

/** One plain-data persona, already folded with its tier (F10). */
export function fakePersona(name: string, tier: BotTier): BotPersona {
  const heat = PERSONA_NAMES.indexOf(name) / Math.max(1, PERSONA_NAMES.length - 1);
  const skill = ["beginner", "easy", "medium", "hard", "expert"].indexOf(tier) / 4;
  return {
    name,
    tier,
    aggression: 0.3 + heat * 0.6,
    minWinChance: 0.6 - skill * 0.15,
    dynamicMinWinChance: tier === "expert",
    reserveFactor: 0.6 + (1 - heat) * 0.6,
    tierReserveFactor: 0.8 + skill * 0.4,
    antiBotBias: 0,
    reserveFloor: 1,
    continentFocus: 0.3 + skill * 0.4,
    expansionism: 0.4 + heat * 0.4,
    stackiness: 0.3 + (1 - heat) * 0.4,
    turtleAversion: heat,
    leaderBias: 0.2 + skill * 0.5,
    grudgeWeight: 0.4,
    grudgeDecay: 0.8,
    allianceLoyalty: 0.5,
    lookahead: (tier === "expert" ? 1 : 0) as 0 | 1,
    seesKillForCards: skill > 0.4,
    seesCardTradeTiming: skill > 0.2,
    seesDominationThreshold: skill > 0.6,
    usesExactOdds: skill > 0.4,
    fogHonest: tier !== "expert",
    fogPessimism: 1.2,
    blunderRate: Math.max(0, 0.35 - skill * 0.35),
    placement: (["spread", "secure", "frontLoad", "stack"] as const)[Math.floor(heat * 3)] ?? "spread",
  };
}

/** One entry per seat, null for a human. Deterministic from the two streams. */
export function drawPersonas(
  tiers: readonly (BotTier | null)[], assignRng: Rng, jitterRng: Rng,
): readonly (BotPersona | null)[] {
  void jitterRng;
  const pool = [...PERSONA_NAMES];
  return tiers.map((tier) => {
    if (!tier) return null;
    const i = nextInt(assignRng, pool.length);
    const name = pool.splice(i, 1)[0] ?? "rusher";
    return fakePersona(name, tier);
  });
}

/** Build the flat read-model the planner reasons over. */
export function makeView(
  state: GameState, map: MapDef, seat: Seat, persona: BotPersona, grudge?: Float32Array,
): GameView {
  const n = state.territories.length;
  const owner = new Int16Array(n);
  const troops = new Int16Array(n);
  const known = new Uint8Array(n);
  const blizzard = new Uint8Array(n);
  state.territories.forEach((t, i) => {
    owner[i] = t.owner;
    const hidden = t.owner === SEAT_UNKNOWN || t.troops === TROOPS_UNKNOWN;
    known[i] = hidden ? 0 : 1;
    troops[i] = hidden ? Math.ceil(2 * persona.fogPessimism) : t.troops;
    blizzard[i] = t.blizzard ? 1 : 0;
  });
  const seats = state.seats.length;
  const territoryCount = new Int16Array(seats);
  const troopCount = new Int32Array(seats);
  const cardCount = new Int16Array(seats);
  const capital = new Int16Array(seats).fill(-1);
  state.seats.forEach((s, i) => {
    cardCount[i] = s.cardCount;
    capital[i] = s.capital ?? -1;
  });
  state.territories.forEach((t) => {
    if (t.owner >= 0 && t.owner < seats) {
      territoryCount[t.owner] = (territoryCount[t.owner] ?? 0) + 1;
      troopCount[t.owner] = (troopCount[t.owner] ?? 0) + Math.max(0, t.troops);
    }
  });
  const allies = new Uint8Array(seats);
  for (const a of state.seats[seat]?.allies ?? []) allies[a] = 1;
  return {
    map, rules: state.rules, me: seat, persona, turn: state.turn, round: state.round, phase: state.phase,
    owner, troops, known, blizzard, portals: state.portals, capital, territoryCount, troopCount, cardCount,
    myCards: state.seats[seat]?.cards ?? [], allies, standing: state.seats.map((s) => s.standing),
    troopsToPlace: state.troopsToPlace, setsTradedTotal: state.setsTradedTotal,
    conqueredThisTurn: state.conqueredThisTurn, grudge: grudge ?? new Float32Array(seats),
  };
}

interface PlannerState {
  readonly state: GameState;
  readonly map: MapDef;
  readonly seat: Seat;
}

/** Enemy pressure on one of my territories: the largest adjacent enemy stack. */
function threat(p: PlannerState, at: TerritoryId): number {
  const mine = p.state.territories[at]?.owner;
  let worst = 0;
  for (const n of p.map.adjacency[at] ?? []) {
    const t = p.state.territories[n];
    if (!t || t.blizzard || t.owner === mine) continue;
    worst = Math.max(worst, Math.max(1, t.troops));
  }
  return worst;
}

/** Greedy whole-turn plan. `done: false` asks the runner to re-enter after a battle. */
export function decideTurn(view: GameView, odds: OddsTables, rng: Rng): TurnPlan {
  const state = viewToState(view);
  const p: PlannerState = { state, map: view.map, seat: view.me };
  const mine = territoriesOf(state, view.me);

  // ---- cards: trade whenever a set exists, the real engine's timing aside.
  const sets = cardSets(view.myCards);
  const cardTrade = sets.length > 0 ? (sets[0] ?? null) : null;

  // ---- draft: weight by border pressure, then by how close a continent is.
  const placements: { territory: TerritoryId; count: number }[] = [];
  const borders = mine
    .map((t) => ({ t, pressure: threat(p, t) }))
    .filter((row) => row.pressure > 0)
    .sort((a, b) => b.pressure - a.pressure || a.t - b.t);
  let left = view.troopsToPlace + (cardTrade ? 4 : 0);
  const targets = borders.length ? borders : mine.map((t) => ({ t, pressure: 1 }));
  if (left > 0 && targets.length) {
    const head = Math.ceil(left * (0.4 + view.persona.aggression * 0.4));
    const first = targets[0] as { t: TerritoryId };
    placements.push({ territory: first.t, count: Math.min(left, head) });
    left -= Math.min(left, head);
    let i = 1;
    while (left > 0) {
      const row = targets[i % targets.length] as { t: TerritoryId };
      const count = Math.max(1, Math.floor(left / Math.max(1, targets.length - 1)));
      placements.push({ territory: row.t, count: Math.min(left, count) });
      left -= Math.min(left, count);
      i += 1;
      if (i > targets.length * 3) break;
    }
  }

  // ---- attack: the single best favourable battle, then re-enter.
  const floor = view.persona.dynamicMinWinChance ? 0.5 : view.persona.minWinChance;
  let best: { from: TerritoryId; to: TerritoryId; score: number } | null = null;
  for (const from of mine) {
    const a = (state.territories[from]?.troops ?? 0) - 1;
    if (a < 1) continue;
    for (const to of legalAttackTargets(state, view.map, from)) {
      const d = state.territories[to]?.troops ?? 0;
      const win = odds.winChance(a, d, undefined);
      if (win < floor) continue;
      const score = win * (1 + d * 0.1);
      if (!best || score > best.score || (score === best.score && to < best.to)) best = { from, to, score };
    }
  }
  // A blunder costs exactly one draw, and only when the persona has a rate.
  if (best && view.persona.blunderRate > 0 && rng.nextFloat() < view.persona.blunderRate) best = null;

  // ---- fortify: back-to-front, from the safest stack to the hottest border.
  let fortify: TurnPlan["fortify"] = null;
  if (!best) {
    const safe = mine
      .filter((t) => threat(p, t) === 0 && (state.territories[t]?.troops ?? 0) > 1)
      .sort((a, b) => (state.territories[b]?.troops ?? 0) - (state.territories[a]?.troops ?? 0) || a - b);
    const hot = borders[0];
    const source = safe[0];
    if (source !== undefined && hot && legalFortifyMoves(state, view.map, source).includes(hot.t)) {
      fortify = { from: source, to: hot.t, count: (state.territories[source]?.troops ?? 1) - 1 };
    }
  }

  return {
    cardTrade,
    placements,
    attacks: best ? [{ from: best.from, to: best.to, mode: "blitz" as const, moveIn: "max" as const }] : [],
    fortify,
    done: best === null,
  };
}

/** The planner above reasons over a `GameState`; rebuild the slice it needs. */
function viewToState(view: GameView): GameState {
  return {
    version: 1,
    mapSlug: view.map.slug,
    rules: view.rules,
    seats: view.standing.map((standing, seat) => ({
      seat, kind: "bot" as const, name: `seat ${seat}`, colour: "red" as const, standing,
      cards: seat === view.me ? view.myCards : [], cardCount: view.cardCount[seat] ?? 0,
      capital: (view.capital[seat] ?? -1) < 0 ? null : (view.capital[seat] as number),
      tier: null, persona: null, allies: [], missedTurns: 0, armiesToClaim: 0,
    })),
    turnOrder: view.standing.map((_, i) => i),
    territories: Array.from(view.owner, (owner, i) => ({
      owner, troops: view.troops[i] ?? 0, blizzard: view.blizzard[i] === 1,
    })),
    currentIndex: view.me,
    phase: view.phase,
    round: view.round,
    turn: view.turn,
    troopsToPlace: view.troopsToPlace,
    territoryBonusLeft: 2,
    setsTradedThisTurn: 0,
    setsTradedTotal: view.setsTradedTotal,
    conqueredThisTurn: view.conqueredThisTurn,
    fortifyUsed: false,
    pendingMoveIn: null,
    resumePhase: null,
    portals: view.portals,
    discard: [],
    outcome: null,
    fogged: false,
  };
}
