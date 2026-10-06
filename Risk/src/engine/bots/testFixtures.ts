/**
 * Hand-built `GameView` / `MapDef` fixtures and a tiny deterministic `Rng`, for S2's bot tests.
 *
 * S1's `apply`, `createInitialState`, `rngFor` and `pcg32` all throw "S1 pending" while the engine
 * slice is in flight (§12's stub table: "S2 … tests its maths with hand-built `GameView` literals —
 * it needs **no** working `apply`"), so nothing in here calls into the engine's functions. It
 * consumes S1's *types* only.
 *
 * `countingRng` is the `Rng` the draw-discipline tests use: it satisfies the published interface,
 * is bit-identical across runs, and counts its own draws so T5 can assert that `decideTurn`
 * consumes 0 or 1 — and that the count is a function of the inputs, not a constant.
 */

import {
  SEAT_NONE,
  type BotPersona, type BotTier, type Card, type Continent, type MapDef, type OddsTables, type Rng,
  type Rules, type Seat, type Standing, type Suit, type Territory, type TerritoryId,
} from "@/engine";
import { sampleOutcome } from "@/engine/odds";

import { decideTurn } from "./index";
import { personaFor } from "./personas";
import { TIERS } from "./tiers";
import { continentBonus } from "./score";
import type { GameView } from "./types";

/* ------------------------------------------------------------------ rng -- */

/** A deterministic `Rng` that counts draws. Integer ops only, like the real PCG32 (D4). */
export function countingRng(seed = 1): Rng & { readonly draws: () => number } {
  let state = (seed >>> 0) || 1;
  let draws = 0;
  const next = (): number => {
    // xorshift32: tiny, integer-only, and good enough for a test double.
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state >>> 0;
  };
  return {
    nextU32() { draws++; return next(); },
    nextFloat() { draws++; return next() / 2 ** 32; },
    get state(): readonly [number, number] { return [state, 0]; },
    draws: () => draws,
  };
}

/** An `Rng` that always returns `value`, for pinning a blunder branch. */
export function fixedRng(value: number): Rng & { readonly draws: () => number } {
  let draws = 0;
  return {
    nextU32() { draws++; return Math.floor(value * 2 ** 32) >>> 0; },
    nextFloat() { draws++; return value; },
    get state(): readonly [number, number] { return [0, 0]; },
    draws: () => draws,
  };
}

/* ------------------------------------------------------------------ maps -- */

export interface MapSpec {
  readonly slug: string;
  /** Territory names, in index order. */
  readonly names: readonly string[];
  /** Undirected edges as index pairs. */
  readonly edges: readonly (readonly [number, number])[];
  /** Continents as `[name, bonus, memberIndices]`. */
  readonly continents: readonly (readonly [string, number, readonly number[]])[];
}

/** Build a `MapDef` from a spec, deriving the adjacency rows and the continent borders. */
export function buildMap(spec: MapSpec): MapDef {
  const n = spec.names.length;
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of spec.edges) {
    if (!(adjacency[a] as number[]).includes(b)) (adjacency[a] as number[]).push(b);
    if (!(adjacency[b] as number[]).includes(a)) (adjacency[b] as number[]).push(a);
  }
  for (const row of adjacency) row.sort((x, y) => x - y);

  const continentOf = new Int16Array(n).fill(-1);
  spec.continents.forEach(([, , members], c) => {
    for (const t of members) continentOf[t] = c;
  });

  const suits: readonly Exclude<Suit, "wild">[] = ["infantry", "cavalry", "artillery"];
  const territories: Territory[] = spec.names.map((name, i) => ({
    index: i,
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    continent: continentOf[i] as number,
    adjacent: adjacency[i] as number[],
    seaLinked: [],
    d: "M0 0 L1 0 L1 1 Z",
    token: [i * 10, 0] as const,
    label: [i * 10, 26] as const,
    suit: suits[i % 3] as Exclude<Suit, "wild">,
  })) as unknown as Territory[];

  const continents: Continent[] = spec.continents.map(([name, bonus, members], c) => {
    const set = new Set(members);
    const border = members
      .filter((t) => (adjacency[t] as number[]).some((y) => !set.has(y)))
      .sort((a, b) => a - b);
    return {
      index: c,
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      bonus,
      color: "--c-accent",
      territories: [...members].sort((a, b) => a - b),
      border,
    };
  });

  return {
    slug: spec.slug,
    name: spec.slug,
    viewBox: [0, 0, 1024, 643] as const,
    territories,
    continents,
    modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
    adjacency,
  };
}

/**
 * T8's `contValue` fixture: the Classic board's six continents, with their real sizes, bonuses and
 * border counts, as a pure adjacency graph. The geometry is irrelevant to the heuristic — only the
 * sizes, the bonuses and which territories have an external edge matter — so this is modelled as a
 * star per continent with the published number of border territories wired outward.
 *
 * | continent | terr | bonus | border terr |
 * | Australia | 4 | 2 | 1 |
 * | South America | 4 | 2 | 2 |
 * | Africa | 6 | 3 | 3 |
 * | Europe | 7 | 5 | 4 |
 * | North America | 9 | 5 | 3 |
 * | Asia | 12 | 7 | 5 |
 */
export function classicShapedMap(): MapDef {
  const shape: readonly (readonly [string, number, number, number])[] = [
    ["North America", 9, 5, 3],
    ["South America", 4, 2, 2],
    ["Africa", 6, 3, 3],
    ["Europe", 7, 5, 4],
    ["Asia", 12, 7, 5],
    ["Australia", 4, 2, 1],
  ];
  const names: string[] = [];
  const edges: [number, number][] = [];
  const continents: [string, number, number[]][] = [];
  const borderTerritories: number[][] = [];

  for (const [name, size, bonus, borders] of shape) {
    const base = names.length;
    const members: number[] = [];
    for (let i = 0; i < size; i++) {
      names.push(`${name} ${i + 1}`);
      members.push(base + i);
      if (i > 0) edges.push([base, base + i]); // a star, so the continent is connected
    }
    continents.push([name, bonus, members]);
    borderTerritories.push(members.slice(0, borders));
  }

  // Wire each continent's border territories outward in a ring, so every one of them has an
  // external edge and no other member does.
  for (let c = 0; c < borderTerritories.length; c++) {
    const here = borderTerritories[c] as number[];
    const there = borderTerritories[(c + 1) % borderTerritories.length] as number[];
    for (let i = 0; i < here.length; i++) {
      edges.push([here[i] as number, there[i % there.length] as number]);
    }
  }
  return buildMap({ slug: "classic-shaped", names, edges, continents });
}

/**
 * A 6-territory, 2-continent board with **three** cross-continent edges: 0-3, 1-4 and 2-5.
 *
 * `smallMap` has a single cross edge (2-3), so seat 0 only ever has one possible attack on it — fine
 * for a "does it stop" test and useless for anything about choosing *between* candidates. This is
 * the board the multi-candidate, blunder and draw-count tests use.
 */
export function crossMap(): MapDef {
  return buildMap({
    slug: "cross6",
    names: ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
    edges: [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [1, 4], [2, 5]],
    continents: [["West", 2, [0, 1, 2]], ["East", 3, [3, 4, 5]]],
  });
}

/** A 6-territory, 2-continent board: 0-1-2 in "West" (bonus 2), 3-4-5 in "East" (bonus 3). */
export function smallMap(): MapDef {
  return buildMap({
    slug: "small6",
    names: ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
    edges: [[0, 1], [1, 2], [0, 2], [2, 3], [3, 4], [4, 5], [3, 5]],
    continents: [["West", 2, [0, 1, 2]], ["East", 3, [3, 4, 5]]],
  });
}

/* ------------------------------------------------------------------ rules and personas -- */

export const TEST_RULES: Rules = {
  winCondition: "world",
  dominationThreshold: 0.7,
  cardBonus: "fixed",
  diceMode: "trueRandom",
  fogOfWar: false,
  capitals: false,
  capitalDraftBonus: false,
  blizzards: false,
  portals: "off",
  manualPlacement: false,
  maxRounds: null,
  roundDelayMs: 0,
  turnSeconds: null,
  alliances: false,
  aiDifficulty: "medium",
  neutralHolding: false,
};

/**
 * A folded persona for `tier`, with the jitter pinned to the midpoint of its band so every sourced
 * knob survives exactly and a fixture is stable.
 *
 * `name` defaults to **opportunist**, which is the one persona in every tier's pool and sits in the
 * middle of the behaviour range. That default matters: taking `pool[0]` instead would make
 * `personaAt("hard")` mean *the turtle at Hard* — `minWinChance` 0.8, `reserveFloor` 4, one attack a
 * turn — so a tier test would really be testing the most passive persona in the game and a gate
 * regression could hide behind it.
 */
export function personaAt(
  tier: BotTier,
  overrides: Partial<BotPersona> = {},
  name = "opportunist",
): BotPersona {
  const pool = TIERS[tier].pool;
  const index = Math.max(0, pool.indexOf(name));
  // The midpoint of this entry's slice, so `floor(u * pool.length)` lands on it exactly.
  const base = personaFor(tier, fixedRng((index + 0.5) / pool.length), fixedRng(0.5));
  return { ...base, ...overrides };
}

/* ------------------------------------------------------------------ views -- */

export interface ViewSpec {
  readonly map: MapDef;
  readonly me?: Seat;
  readonly persona: BotPersona;
  /** `[owner, troops]` per territory, in index order. `owner` may be a `SEAT_*` sentinel. */
  readonly board: readonly (readonly [number, number])[];
  readonly rules?: Partial<Rules>;
  readonly phase?: GameView["phase"];
  readonly troopsToPlace?: number;
  readonly myCards?: readonly Card[];
  readonly cardCount?: readonly number[];
  readonly capital?: readonly number[];
  readonly allies?: readonly Seat[];
  readonly standing?: readonly Standing[];
  readonly grudge?: readonly number[];
  readonly setsTradedTotal?: number;
  readonly conqueredThisTurn?: boolean;
  readonly round?: number;
  readonly turn?: number;
  readonly seats?: number;
  readonly known?: readonly boolean[];
  readonly portals?: GameView["portals"];
}

/** Build a `GameView` directly, with no `GameState` and no engine call (§12's S2 stub rule). */
export function makeTestView(spec: ViewSpec): GameView {
  const n = spec.map.territories.length;
  const seats = spec.seats ?? Math.max(2, ...spec.board.map(([o]) => o + 1).filter((x) => x > 0));

  const owner = new Int16Array(n);
  const troops = new Int16Array(n);
  const known = new Uint8Array(n).fill(1);
  const blizzard = new Uint8Array(n);
  spec.board.forEach(([o, t], i) => { owner[i] = o; troops[i] = t; });
  if (spec.known !== undefined) spec.known.forEach((k, i) => { known[i] = k ? 1 : 0; });

  const territoryCount = new Int16Array(seats);
  const troopCount = new Int32Array(seats);
  for (let t = 0; t < n; t++) {
    const o = owner[t] as number;
    if (o < 0) continue;
    territoryCount[o] = (territoryCount[o] as number) + 1;
    troopCount[o] = (troopCount[o] as number) + (troops[t] as number);
  }

  const cardCount = new Int16Array(seats);
  (spec.cardCount ?? []).forEach((c, s) => { cardCount[s] = c; });
  const me = spec.me ?? 0;
  if (spec.cardCount === undefined) cardCount[me] = (spec.myCards ?? []).length;

  const capital = new Int16Array(seats).fill(-1);
  (spec.capital ?? []).forEach((c, s) => { capital[s] = c; });

  const allies = new Uint8Array(seats);
  for (const a of spec.allies ?? []) allies[a] = 1;

  const grudge = new Float32Array(seats);
  (spec.grudge ?? []).forEach((g, s) => { grudge[s] = g; });

  const standing: Standing[] = spec.standing !== undefined
    ? [...spec.standing]
    : Array.from({ length: seats }, () => "active" as Standing);

  return {
    map: spec.map,
    rules: { ...TEST_RULES, ...spec.rules },
    me,
    persona: spec.persona,
    turn: spec.turn ?? 1,
    round: spec.round ?? 1,
    phase: spec.phase ?? "attack",
    owner, troops, known, blizzard,
    portals: spec.portals ?? [],
    capital, territoryCount, troopCount, cardCount,
    myCards: spec.myCards ?? [],
    allies, standing,
    troopsToPlace: spec.troopsToPlace ?? 0,
    setsTradedTotal: spec.setsTradedTotal ?? 0,
    conqueredThisTurn: spec.conqueredThisTurn ?? false,
    grudge,
  };
}

/** An all-unowned board of the right length, for a claim-phase fixture. */
export function emptyBoard(map: MapDef): readonly (readonly [number, number])[] {
  return map.territories.map(() => [SEAT_NONE, 0] as const);
}

/** A card with a stable id. */
export function card(id: string, suit: Suit, territory: TerritoryId | null = null): Card {
  return { id, suit, territory };
}

/* ------------------------------------------------------------------ a self-contained match -- */

/**
 * A minimal two-seat match driver, for the T8 claims that are about *outcomes over many games*
 * rather than about one decision: "a bot given the True Random table in a Balanced Blitz game
 * measurably underperforms one given the right table", and "a `blunderRate: 0.4` bot loses to a
 * `0.0` bot over 50 seeded matches".
 *
 * It is **not** a second engine and makes no claim to be one: S1's `apply` is the rules, and it
 * throws "S1 pending" while the engine slice is in flight (§12's stub table). This driver
 * implements only the handful of transitions `decideTurn`'s own output needs — place, blitz, move
 * in, fortify — so the bot's *decisions* can be measured against each other. Everything random
 * goes through `sampleOutcome` on a seeded stream, so a match is reproducible from its seed.
 */
export interface MatchSeat {
  readonly persona: BotPersona;
  /** The table this seat *believes*; the battles themselves always resolve on `truth`. */
  readonly odds: OddsTables;
}

export interface MatchResult {
  readonly winner: Seat | null;
  readonly rounds: number;
  readonly territories: readonly number[];
}

const MAX_ATTACKS_PER_TURN = 40;

export function playMatch(
  map: MapDef,
  seats: readonly MatchSeat[],
  truth: OddsTables,
  seed: number,
  maxRounds = 60,
  rules: Partial<Rules> = {},
): MatchResult {
  const n = map.territories.length;
  const owner = new Int16Array(n);
  const troops = new Int16Array(n);
  // Alternate ownership so the opening is symmetric and the seed decides nothing about it.
  for (let t = 0; t < n; t++) { owner[t] = t % seats.length; troops[t] = 3; }

  const rng = countingRng(seed);
  const merged: Rules = { ...TEST_RULES, ...rules };

  const snapshot = (seat: Seat, phase: GameView["phase"], toPlace: number, conquered: boolean, round: number): GameView =>
    makeTestView({
      map,
      me: seat,
      persona: (seats[seat] as MatchSeat).persona,
      board: Array.from({ length: n }, (_, t) => [owner[t] as number, troops[t] as number] as const),
      rules: merged,
      phase,
      troopsToPlace: toPlace,
      conqueredThisTurn: conquered,
      round,
      seats: seats.length,
    });

  const held = (seat: Seat): number => {
    let count = 0;
    for (let t = 0; t < n; t++) if ((owner[t] as number) === seat) count++;
    return count;
  };

  let round = 1;
  for (; round <= maxRounds; round++) {
    for (let seat = 0; seat < seats.length; seat++) {
      if (held(seat) === 0) continue;
      const me = seats[seat] as MatchSeat;

      // ---- draft ----
      const income = Math.max(3, Math.floor(held(seat) / 3))
        + continentBonus(snapshot(seat, "draft", 0, false, round), seat);
      const draft = decideTurn(snapshot(seat, "draft", income, false, round), me.odds, rng);
      let placed = 0;
      for (const p of draft.placements) {
        if ((owner[p.territory] as number) !== seat) continue;
        troops[p.territory] = (troops[p.territory] as number) + p.count;
        placed += p.count;
      }
      // Anything the planner failed to place lands on the seat's first territory, so the troop
      // count stays conserved and a planner bug shows up as a weaker bot, not as lost armies.
      if (placed < income) {
        for (let t = 0; t < n; t++) {
          if ((owner[t] as number) !== seat) continue;
          troops[t] = (troops[t] as number) + (income - placed);
          break;
        }
      }

      // ---- attack, with re-entry after each battle ----
      let conquered = false;
      for (let i = 0; i < MAX_ATTACKS_PER_TURN; i++) {
        const plan = decideTurn(snapshot(seat, "attack", 0, conquered, round), me.odds, rng);
        const attack = plan.attacks[0];
        if (plan.done || attack === undefined) break;
        const a = (troops[attack.from] as number) - 1;
        const d = troops[attack.to] as number;
        if (a < 1 || d < 1) break;
        const dist = truth.outcome(a, d, undefined, attack.stopUntil);
        const result = sampleOutcome(dist, rng.nextFloat());
        troops[attack.from] = (troops[attack.from] as number) - result.attackerLosses;
        if (result.conquered) {
          const spare = (troops[attack.from] as number) - 1;
          const minimum = Math.min(spare, 3);
          const moving = attack.moveIn === "max"
            ? spare
            : attack.moveIn === "min"
              ? minimum
              : Math.max(minimum, Math.min(spare, attack.moveIn));
          troops[attack.from] = (troops[attack.from] as number) - moving;
          owner[attack.to] = seat;
          troops[attack.to] = moving;
          conquered = true;
        } else {
          troops[attack.to] = (troops[attack.to] as number) - result.defenderLosses;
        }
      }

      // ---- fortify ----
      const end = decideTurn(snapshot(seat, "fortify", 0, conquered, round), me.odds, rng);
      const move = end.fortify;
      if (move !== null && (owner[move.from] as number) === seat && (owner[move.to] as number) === seat) {
        const moving = Math.min(move.count, (troops[move.from] as number) - 1);
        if (moving > 0) {
          troops[move.from] = (troops[move.from] as number) - moving;
          troops[move.to] = (troops[move.to] as number) + moving;
        }
      }

      if (held(seat) === n) {
        return { winner: seat, rounds: round, territories: seats.map((_, s) => held(s)) };
      }
    }
  }
  return { winner: null, rounds: round, territories: seats.map((_, s) => held(s)) };
}
