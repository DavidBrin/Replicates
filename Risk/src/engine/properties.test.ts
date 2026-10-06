/**
 * T5 — the property suite, plus the replay proof.
 *
 * The replay test is the one everything else leans on: a scripted three-seat
 * game on `mini`, folded twice, must produce an identical `hashState` after
 * every single action (D54, D16). If that holds, every other guarantee in the
 * engine is checkable by folding a log.
 *
 * The rest are the invariants that cannot be spot-checked: `apply` total and
 * non-mutating over arbitrary triples (R86, R87), troop conservation across a
 * battle (R89), adjacency symmetry under every modifier combination (R90), the
 * hash surviving a round trip (R92), and `viewFor` never leaking (F12, R73).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { classicWorld, mini, tiny4 } from "./__fixtures__/maps";
import { fakeOdds, makeDist } from "./__fixtures__/odds";
import { buildState, card, config, personasFor } from "./__fixtures__/states";
import { areAdjacent, neighbours } from "./graph";
import { viewFor } from "./fog";
import { canonicalize, hashState } from "./hash";
import { cardSets } from "./cards";
import {
  ACTION_ORDER,
  claimOwed,
  legalActions,
  legalAttackTargets,
  legalDraftTargets,
  legalFortifyMoves,
  legalNeutralClaimTargets,
  legalOwnClaimTargets,
} from "./legalActions";
import { pcg32, rngFor } from "./prng";
import { apply, createInitialState } from "./reducer";
import { dealTerritories, drawCard, movePortals, rollAttack } from "./resolver";
import { deserializeState, serializeState } from "./serialize";
import { territoryCountFor, troopCountFor } from "./rules";
import { validate } from "./validate";
import {
  SEAT_UNKNOWN,
  TROOPS_UNKNOWN,
  type Action,
  type ActionKind,
  type GameState,
  type MapDef,
  type OutcomeDist,
  type PortalState,
  type Seat,
  type TerritoryId,
} from "./types";

/** A battle distribution with mass on both halves, so a scripted game varies. */
function mixedOutcome(a: number, d: number): OutcomeDist {
  const conquerLosing: Record<number, number> = {};
  const holdLosing: Record<number, number> = {};
  if (a > 0) conquerLosing[0] = 0.4;
  if (a > 1) conquerLosing[1] = 0.2;
  if (d > 0) holdLosing[d - 1] = 0.4;
  return makeDist(a, d, { conquerLosing, holdLosing });
}

const ODDS = fakeOdds(mixedOutcome);

/** The total troops on the board. */
function boardTroops(state: GameState): number {
  return state.territories.reduce((n, t) => n + Math.max(0, t.troops), 0);
}

/**
 * Drive a whole game through the resolver and the reducer, the way the session
 * runner does (§5.2, §5.3), and return the action log. Nothing here is a bot:
 * it drafts onto its lowest-index territory and takes the first legal attack,
 * which is enough to exercise conquest, elimination, cards and the turn
 * pipeline.
 */
function scriptGame(map: MapDef, seats: number, seed: string, maxActions = 400): readonly Action[] {
  const cfg = config(map, seats, { capitals: false, blizzards: false, portals: "unstable" }, seed);
  const started = dealTerritories(map, cfg, personasFor(seats), {
    deal: rngFor(seed, "deal", 0),
    turnOrder: rngFor(seed, "turnOrder", 0),
    modifierPlace: rngFor(seed, "modifierPlace", 0),
  });
  const log: Action[] = [started];
  let state = createInitialState(map, started);

  const push = (action: Action): boolean => {
    const result = apply(state, map, action);
    if (result.error !== undefined) return false;
    log.push(action);
    state = result.state;
    return true;
  };

  let guard = 0;
  while (state.outcome === null && log.length < maxActions && guard++ < maxActions * 4) {
    const seat = state.turnOrder[state.currentIndex] as Seat;

    // §5.7 — round-start work, asked on every round start.
    if (state.phase === "draft" && state.troopsToPlace > 0) {
      // `log.length` is this driver's `nextSeq`: the sub-stream index is the seq of the action
      // being produced, never `state.turn` (D5, R88), and a test that keyed it on the turn would
      // model a contract the live runner and the live route do not have.
      const moved = movePortals(state, map, rngFor(seed, "portalMove", log.length));
      if (moved !== null) push(moved);
    }

    if (state.pendingMoveIn !== null) {
      push({ type: "MOVE_IN", seat, count: state.pendingMoveIn.min });
      continue;
    }

    if (state.phase === "draft") {
      if (state.troopsToPlace > 0) {
        const target = state.territories.findIndex((t) => t.owner === seat && !t.blizzard);
        if (target < 0) break;
        if (!push({ type: "DRAFT", seat, territory: target, count: state.troopsToPlace })) break;
        continue;
      }
      if (!push({ type: "END_PHASE", seat })) break;
      continue;
    }

    if (state.phase === "attack") {
      let attacked = false;
      for (let from = 0; from < map.territories.length && !attacked; from++) {
        if (state.territories[from]?.owner !== seat) continue;
        for (const to of legalAttackTargets(state, map, from)) {
          const action = rollAttack(
            state,
            map,
            { from, to, mode: "blitz" },
            rngFor(seed, "battle", state.turn * 97 + from * 7 + to),
            ODDS,
            "trueRandom",
          );
          if (push(action)) {
            attacked = true;
            break;
          }
        }
      }
      if (attacked) continue;
      if (!push({ type: "END_PHASE", seat })) break;
      continue;
    }

    if (state.phase === "fortify") {
      if (state.conqueredThisTurn) push(drawCard(state, map, seat, rngFor(seed, "cardDeck", log.length)));
      if (!push({ type: "END_TURN", seat })) break;
      continue;
    }
    break;
  }
  return log;
}

/** Fold a log from scratch, collecting a hash after every action. */
function fold(map: MapDef, log: readonly Action[]): { state: GameState; hashes: string[] } {
  let state = createInitialState(map, log[0] as Extract<Action, { type: "GAME_STARTED" }>);
  const hashes = [hashState(state)];
  for (const action of log.slice(1)) {
    const result = apply(state, map, action);
    expect(result.error).toBeUndefined();
    state = result.state;
    hashes.push(hashState(state));
  }
  return { state, hashes };
}

/* ------------------------------------------------------------------ replay -- */

describe("T5 — the replay proof (D16, D54)", () => {
  it("a scripted 3-seat game on mini folds twice to identical hashes after every action", () => {
    const log = scriptGame(mini, 3, "replay-seed");
    expect(log.length).toBeGreaterThan(20);
    const first = fold(mini, log);
    const second = fold(mini, log);
    expect(second.hashes).toEqual(first.hashes);
    expect(hashState(second.state)).toBe(hashState(first.state));
  });

  it("produces the same log from the same seed, and a different one from another", () => {
    expect(scriptGame(mini, 3, "same")).toEqual(scriptGame(mini, 3, "same"));
    const a = scriptGame(mini, 3, "aaa");
    const b = scriptGame(mini, 3, "bbb");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("every hash in the fold is a distinct 64-bit digest wherever the state moved", () => {
    const { hashes } = fold(mini, scriptGame(mini, 3, "digest-seed"));
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(hashes).size).toBeGreaterThan(hashes.length / 2);
  });

  it("a replayed game reaches a real conclusion, exercising conquest and elimination", () => {
    const log = scriptGame(mini, 3, "conclusion");
    const { state } = fold(mini, log);
    const kinds = new Set(log.map((a) => a.type));
    expect(kinds.has("ATTACK")).toBe(true);
    expect(kinds.has("MOVE_IN")).toBe(true);
    // `mini` is six territories: somebody is dominant very quickly, which is
    // exactly why it is the fixture a replay test can afford to run twice.
    expect(state.outcome).not.toBeNull();
    expect(state.phase).toBe('over');
  });

  it("a longer game exercises the card award and the whole action vocabulary", () => {
    const log = scriptGame(classicWorld, 4, "vocabulary", 300);
    const kinds = new Set(log.map((a) => a.type));
    for (const kind of ["GAME_STARTED", "DRAFT", "END_PHASE", "ATTACK", "MOVE_IN", "END_TURN", "CARD_DRAWN"]) {
      expect(kinds.has(kind as Action["type"])).toBe(true);
    }
  });

  it("folds on the bigger board too, with unstable portals relocating in the log", () => {
    const log = scriptGame(classicWorld, 4, "classic-seed", 300);
    const first = fold(classicWorld, log);
    const second = fold(classicWorld, log);
    expect(second.hashes).toEqual(first.hashes);
    expect(log.some((a) => a.type === "PORTALS_MOVED")).toBe(true);
  });

  it("R89 — troop conservation holds across every battle in a scripted game", () => {
    const log = scriptGame(mini, 3, "conserve");
    let state = createInitialState(mini, log[0] as Extract<Action, { type: "GAME_STARTED" }>);
    let battles = 0;
    for (const action of log.slice(1)) {
      const before = boardTroops(state);
      const result = apply(state, mini, action);
      expect(result.error).toBeUndefined();
      const after = boardTroops(result.state);
      if (action.type === "ATTACK") {
        battles += 1;
        const losses =
          action.mode === "blitz"
            ? action.attackerLosses + action.defenderLosses
            : before - after;
        expect(before - after).toBe(losses);
      }
      if (action.type === "MOVE_IN" || action.type === "FORTIFY") expect(after).toBe(before);
      state = result.state;
    }
    expect(battles).toBeGreaterThan(3);
  });

  it("R92 — a serialise/deserialise round trip at every step keeps the hash", () => {
    const log = scriptGame(mini, 3, "round-trip");
    let state = createInitialState(mini, log[0] as Extract<Action, { type: "GAME_STARTED" }>);
    for (const action of log.slice(1)) {
      state = apply(state, mini, action).state;
      expect(hashState(deserializeState(serializeState(state)))).toBe(hashState(state));
    }
  });
});

/* ------------------------------------------------------- arbitrary actions -- */

/** Arbitrary, mostly-illegal actions over a 4-territory board. */
const arbitraryAction: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant("DRAFT" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    territory: fc.integer({ min: -3, max: 7 }),
    count: fc.integer({ min: -5, max: 50 }),
  }),
  fc.record({
    type: fc.constant("ATTACK" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    from: fc.integer({ min: -3, max: 7 }),
    to: fc.integer({ min: -3, max: 7 }),
    mode: fc.constant("blitz" as const),
    attackerLosses: fc.integer({ min: -5, max: 50 }),
    defenderLosses: fc.integer({ min: -5, max: 50 }),
  }),
  fc.record({
    type: fc.constant("ATTACK" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    from: fc.integer({ min: -3, max: 7 }),
    to: fc.integer({ min: -3, max: 7 }),
    mode: fc.constant("manual" as const),
    attackerDice: fc.array(fc.integer({ min: -2, max: 9 }), { maxLength: 5 }),
    defenderDice: fc.array(fc.integer({ min: -2, max: 9 }), { maxLength: 5 }),
  }),
  fc.record({
    type: fc.constant("FORTIFY" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    from: fc.integer({ min: -3, max: 7 }),
    to: fc.integer({ min: -3, max: 7 }),
    count: fc.integer({ min: -5, max: 50 }),
  }),
  fc.record({
    type: fc.constant("MOVE_IN" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    count: fc.integer({ min: -5, max: 50 }),
  }),
  fc.record({ type: fc.constant("END_PHASE" as const), seat: fc.integer({ min: -3, max: 7 }) }),
  fc.record({ type: fc.constant("END_TURN" as const), seat: fc.integer({ min: -3, max: 7 }) }),
  fc.record({
    type: fc.constant("CLAIM" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    territory: fc.integer({ min: -3, max: 7 }),
    forNeutral: fc.boolean(),
  }),
  fc.record({
    type: fc.constant("TRADE_CARDS" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    cards: fc.tuple(
      fc.constantFrom("a", "b", "c", "x"),
      fc.constantFrom("a", "b", "c", "x"),
      fc.constantFrom("a", "b", "c", "x"),
    ),
    bonusTerritory: fc.option(fc.integer({ min: -3, max: 7 }), { nil: null }),
  }),
  fc.record({
    type: fc.constant("ALLIANCE_PROPOSE" as const),
    seat: fc.integer({ min: -3, max: 7 }),
    to: fc.integer({ min: -3, max: 7 }),
  }),
  // Not an action at all, which is the branch R86 exists for.
  fc.record({ type: fc.constantFrom("NOPE", "", "attack", "RESIGN"), seat: fc.integer() }),
) as unknown as fc.Arbitrary<Action>;

/** Arbitrary 4-territory boards over tiny4. */
const arbitraryState: fc.Arbitrary<GameState> = fc
  .record({
    owners: fc.array(fc.integer({ min: -2, max: 2 }), { minLength: 4, maxLength: 4 }),
    troops: fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 4, maxLength: 4 }),
    blizzards: fc.subarray([0, 1, 2, 3]),
    phase: fc.constantFrom("claim" as const, "draft" as const, "attack" as const, "fortify" as const),
    troopsToPlace: fc.integer({ min: 0, max: 9 }),
    currentIndex: fc.integer({ min: 0, max: 2 }),
    round: fc.integer({ min: 1, max: 6 }),
    fortifyUsed: fc.boolean(),
    conqueredThisTurn: fc.boolean(),
  })
  .map((spec) =>
    buildState(tiny4, {
      seats: 3,
      owners: spec.owners,
      troops: spec.troops,
      blizzards: spec.blizzards,
      phase: spec.phase,
      troopsToPlace: spec.troopsToPlace,
      currentIndex: spec.currentIndex,
      round: spec.round,
      fortifyUsed: spec.fortifyUsed,
      conqueredThisTurn: spec.conqueredThisTurn,
      rules: { manualPlacement: spec.phase === "claim" },
      armiesToClaim: { 0: 3, 1: 3, 2: 3 },
    }),
  );

describe("T5 — apply is total and pure (R86, R87)", () => {
  it("never throws on an arbitrary (state, map, action) triple", () => {
    fc.assert(
      fc.property(arbitraryState, arbitraryAction, (state, action) => {
        const result = apply(state, tiny4, action);
        expect(result.state).toBeDefined();
        expect(Array.isArray(result.events)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("never mutates its input", () => {
    fc.assert(
      fc.property(arbitraryState, arbitraryAction, (state, action) => {
        const before = canonicalize(state);
        apply(state, tiny4, action);
        expect(canonicalize(state)).toBe(before);
      }),
      { numRuns: 1500 },
    );
  });

  it("returns the input state by identity whenever it reports an error", () => {
    fc.assert(
      fc.property(arbitraryState, arbitraryAction, (state, action) => {
        const result = apply(state, tiny4, action);
        if (result.error !== undefined) {
          expect(result.state).toBe(state);
          expect(result.events).toEqual([]);
        }
      }),
      { numRuns: 1500 },
    );
  });

  it("agrees with validate: an error iff validate refused it", () => {
    fc.assert(
      fc.property(arbitraryState, arbitraryAction, (state, action) => {
        const refusal = validate(state, tiny4, action);
        const result = apply(state, tiny4, action);
        expect(result.error?.code ?? null).toBe(refusal?.code ?? null);
      }),
      { numRuns: 1500 },
    );
  });

  it("never throws on an arbitrary action over the big board either", () => {
    fc.assert(
      fc.property(arbitraryAction, (action) => {
        const state = buildState(classicWorld, {
          seats: 5,
          owners: classicWorld.territories.map((_t, i) => i % 5),
          troops: classicWorld.territories.map((_t, i) => 1 + (i % 4)),
        });
        expect(apply(state, classicWorld, action).state).toBeDefined();
      }),
      { numRuns: 400 },
    );
  });

  it("an accepted action always leaves a hashable state", () => {
    fc.assert(
      fc.property(arbitraryState, arbitraryAction, (state, action) => {
        const result = apply(state, tiny4, action);
        expect(result.state.fogged).toBe(false);
        expect(hashState(result.state)).toMatch(/^[0-9a-f]{16}$/);
      }),
      { numRuns: 1000 },
    );
  });
});

/* -------------------------------------------------------------- the graph -- */

describe("T5 — R90: adjacency symmetry under every modifier combination", () => {
  const portalPairs: fc.Arbitrary<PortalState[]> = fc.array(
    fc
      .tuple(fc.integer({ min: 0, max: 41 }), fc.integer({ min: 0, max: 41 }), fc.boolean(), fc.integer({ min: 0, max: 6 }))
      .map(([a, b, unstable, activeFrom]) => ({
        a,
        b,
        kind: unstable ? ("unstable" as const) : ("stable" as const),
        activeFrom,
      })),
    { maxLength: 7 },
  );

  it("holds on classic under arbitrary portals, blizzards and rounds", () => {
    fc.assert(
      fc.property(
        portalPairs,
        fc.subarray([0, 5, 11, 20, 33, 41], { maxLength: 6 }),
        fc.integer({ min: 1, max: 9 }),
        (portals, blizzards, round) => {
          const state = buildState(classicWorld, {
            seats: 3,
            owners: classicWorld.territories.map((_t, i) => i % 3),
            blizzards,
            portals,
            round,
          });
          for (let a = 0; a < classicWorld.territories.length; a++) {
            for (const b of neighbours(state, classicWorld, a)) {
              expect(neighbours(state, classicWorld, b)).toContain(a);
              expect(areAdjacent(state, classicWorld, b, a)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("never reports a territory adjacent to itself", () => {
    fc.assert(
      fc.property(portalPairs, fc.integer({ min: 1, max: 9 }), (portals, round) => {
        const state = buildState(classicWorld, { seats: 3, portals, round });
        for (let a = 0; a < classicWorld.territories.length; a++) {
          expect(neighbours(state, classicWorld, a)).not.toContain(a);
          expect(areAdjacent(state, classicWorld, a, a)).toBe(false);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("returns sorted, duplicate-free neighbour lists (R91)", () => {
    fc.assert(
      fc.property(portalPairs, fc.integer({ min: 1, max: 9 }), (portals, round) => {
        const state = buildState(classicWorld, { seats: 3, portals, round });
        for (let a = 0; a < classicWorld.territories.length; a++) {
          const row = neighbours(state, classicWorld, a);
          expect([...row]).toEqual([...row].sort((x, y) => x - y));
          expect(new Set(row).size).toBe(row.length);
        }
      }),
      { numRuns: 40 },
    );
  });
});

/* ----------------------------------------------------------------- the fog -- */

describe("T5 — F12/R73: viewFor never leaks", () => {
  const fogBoard = fc.record({
    owners: fc.array(fc.integer({ min: -1, max: 2 }), { minLength: 6, maxLength: 6 }),
    troops: fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 6, maxLength: 6 }),
    viewer: fc.integer({ min: 0, max: 2 }),
    handSizes: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 3, maxLength: 3 }),
  });

  it("masks exactly the territories the viewer cannot see, and nothing it can", () => {
    fc.assert(
      fc.property(fogBoard, (spec) => {
        const state = buildState(mini, {
          seats: 3,
          owners: spec.owners,
          troops: spec.troops,
          rules: { fogOfWar: true },
        });
        const view = viewFor(state, mini, spec.viewer);
        const mine = state.territories
          .map((t, i) => (t.owner === spec.viewer ? i : -1))
          .filter((i) => i >= 0);
        const visible = new Set<number>(mine);
        for (const t of mine) for (const n of neighbours(state, mini, t)) visible.add(n);
        view.territories.forEach((cell, i) => {
          if (visible.has(i)) {
            expect(cell.owner).toBe(state.territories[i]?.owner);
            expect(cell.troops).toBe(state.territories[i]?.troops);
          } else {
            expect(cell.owner).toBe(SEAT_UNKNOWN);
            expect(cell.troops).toBe(TROOPS_UNKNOWN);
          }
        });
      }),
      { numRuns: 300 },
    );
  });

  it("keeps the viewer's own territories and totals exact", () => {
    fc.assert(
      fc.property(fogBoard, (spec) => {
        const state = buildState(mini, {
          seats: 3,
          owners: spec.owners,
          troops: spec.troops,
          rules: { fogOfWar: true },
        });
        const view = viewFor(state, mini, spec.viewer);
        expect(territoryCountFor(view, spec.viewer)).toBe(territoryCountFor(state, spec.viewer));
        expect(troopCountFor(view, spec.viewer)).toBe(troopCountFor(state, spec.viewer));
      }),
      { numRuns: 300 },
    );
  });

  it("empties every other hand while reporting the right cardCount", () => {
    fc.assert(
      fc.property(fogBoard, (spec) => {
        const hands: Record<number, { id: string; suit: "infantry"; territory: null }[]> = {};
        spec.handSizes.forEach((n, seat) => {
          hands[seat] = Array.from({ length: n }, (_v, i) => ({
            id: `s${String(seat)}-${String(i)}`,
            suit: "infantry" as const,
            territory: null,
          }));
        });
        const state = buildState(mini, {
          seats: 3,
          owners: spec.owners,
          troops: spec.troops,
          rules: { fogOfWar: true },
          hands,
        });
        const view = viewFor(state, mini, spec.viewer);
        const json = JSON.stringify(view);
        view.seats.forEach((row, seat) => {
          expect(row.cardCount).toBe(spec.handSizes[seat]);
          if (seat === spec.viewer) {
            expect(row.cards).toHaveLength(spec.handSizes[seat] as number);
          } else {
            expect(row.cards).toEqual([]);
            for (let i = 0; i < (spec.handSizes[seat] as number); i++) {
              expect(json).not.toContain(`s${String(seat)}-${String(i)}`);
            }
          }
        });
      }),
      { numRuns: 200 },
    );
  });

  it("F36 — a view is never hashable, whatever the board", () => {
    fc.assert(
      fc.property(fogBoard, (spec) => {
        const state = buildState(mini, { seats: 3, owners: spec.owners, troops: spec.troops });
        expect(() => hashState(viewFor(state, mini, spec.viewer))).toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------- the digest -- */

describe("T5 — the hash round trip (R92)", () => {
  it("survives serialise/deserialise for an arbitrary state", () => {
    fc.assert(
      fc.property(arbitraryState, (state) => {
        expect(hashState(deserializeState(serializeState(state)))).toBe(hashState(state));
      }),
      { numRuns: 500 },
    );
  });

  it("survives a JSON round trip for an arbitrary state", () => {
    fc.assert(
      fc.property(arbitraryState, (state) => {
        const back = JSON.parse(JSON.stringify(state)) as GameState;
        expect(hashState(back)).toBe(hashState(state));
      }),
      { numRuns: 500 },
    );
  });

  it("distinguishes two states that differ anywhere the rules read", () => {
    fc.assert(
      fc.property(arbitraryState, fc.integer({ min: 0, max: 3 }), (state, at) => {
        const cell = state.territories[at];
        if (cell === undefined) return;
        const bumped: GameState = {
          ...state,
          territories: state.territories.map((t, i) => (i === at ? { ...t, troops: t.troops + 1 } : t)),
        };
        expect(hashState(bumped)).not.toBe(hashState(state));
      }),
      { numRuns: 300 },
    );
  });
});

/* --------------------------------------------------------- resolver purity -- */

describe("T5 — the resolver is a pure function of its rng", () => {
  it("rollAttack is reproducible at every seed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 << 20 }), (seed) => {
        const state = buildState(mini, {
          seats: 2,
          owners: [0, 0, 0, 1, 1, 1],
          troops: [1, 1, 7, 5, 1, 1],
          phase: "attack",
        });
        const a = rollAttack(state, mini, { from: 2, to: 3, mode: "blitz" }, pcg32(seed, 1), ODDS, "trueRandom");
        const b = rollAttack(state, mini, { from: 2, to: 3, mode: "blitz" }, pcg32(seed, 1), ODDS, "trueRandom");
        expect(a).toEqual(b);
        expect(validate(state, mini, a)).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it("drawCard always returns a card the reducer accepts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 << 20 }), (seed) => {
        const state = buildState(mini, {
          seats: 2,
          owners: [0, 0, 0, 1, 1, 1],
          phase: "fortify",
          conqueredThisTurn: true,
        });
        const action = drawCard(state, mini, 0, pcg32(seed, 2));
        expect(validate(state, mini, action)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("dealTerritories always returns a GAME_STARTED the reducer accepts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.boolean(),
        fc.boolean(),
        (seats, seed, blizzards, capitals) => {
          const cfg = config(classicWorld, seats, { blizzards, capitals }, seed);
          const started = dealTerritories(classicWorld, cfg, personasFor(seats), {
            deal: rngFor(seed, "deal", 0),
            turnOrder: rngFor(seed, "turnOrder", 0),
            modifierPlace: rngFor(seed, "modifierPlace", 0),
          });
          const empty = buildState(classicWorld, { seats });
          expect(validate(empty, classicWorld, started)).toBeNull();
          const state = createInitialState(classicWorld, started);
          expect(hashState(state)).toMatch(/^[0-9a-f]{16}$/);
        },
      ),
      { numRuns: 120 },
    );
  });

  it("movePortals always returns an action the reducer accepts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 << 20 }), (seed) => {
        const state = buildState(classicWorld, {
          seats: 3,
          owners: classicWorld.territories.map((_t, i) => i % 3),
          rules: { portals: "unstable" },
          portals: [
            { a: 0, b: 20, kind: "unstable", activeFrom: 0 },
            { a: 1, b: 25, kind: "unstable", activeFrom: 0 },
          ],
          round: 3,
        });
        const action = movePortals(state, classicWorld, pcg32(seed, 3));
        if (action !== null) expect(validate(state, classicWorld, action)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});

/* ------------------------------------------- legalActions <-> validate agreement -- */

/**
 * T5 — `legalActions` and `validate` must agree, over a few hundred **reachable** states
 * (SPEC §4.10, R91; the codex round-4 reviewer's harness).
 *
 * Every round of review so far has found the same shape of bug twice over: a kind the list
 * advertises that the validator refuses (an `ALLIANCE_BREAK` for a dead ally, an `ALLIANCE_ACCEPT`
 * with no offer on the table, a `MOVE_IN` past a six-card hand), or a kind the validator accepts
 * that the list never offers (`END_TURN` out of `draft`, the alliance kinds dropped by R24's early
 * return). Each was found by reading; none was caught by a test, because every test asserted one
 * side or the other. This asserts the **relation**, which is the only thing that catches the next
 * one.
 *
 * The property, at every state a driven game passes through, for **every** seat and not just the
 * one to play:
 *
 * - every kind `legalActions` advertises has at least one concrete action `validate` accepts;
 * - every concrete action `validate` accepts has its kind advertised.
 *
 * It is scoped to {@link ACTION_ORDER}, which is deliberately not the whole `ActionKind` union:
 * `GAME_STARTED`, `SEAT_TO_BOT`, `SEAT_TO_HUMAN` and `PORTALS_MOVED` are the *authority's* to
 * produce and never a seat's to submit, so `legalActions` not advertising them is the contract
 * rather than a disagreement. `CARD_DRAWN` and `AUTO_DEPLOY` are in the order and so are checked.
 */
describe("T5 — legalActions and validate agree on every reachable state (§4.10)", () => {
  /**
   * Every concrete action of each kind that is worth offering to `validate` from `seat`.
   *
   * Breadth matters more than realism: an advertised kind is only honoured if *some* payload of it
   * validates, so a candidate list that is too narrow reports a false disagreement. Payloads come
   * from the same selectors and resolvers the UI and the authority use, which is the point — a
   * representative nobody could ever construct would prove nothing.
   */
  function representatives(
    state: GameState,
    map: MapDef,
    seat: Seat,
    rngIndex: number,
  ): Map<ActionKind, Action[]> {
    const out = new Map<ActionKind, Action[]>();
    const add = (kind: ActionKind, actions: readonly Action[]) => {
      if (actions.length > 0) out.set(kind, [...actions]);
    };
    const row = state.seats[seat];
    if (row === undefined) return out;
    const others = state.seats.filter((s) => s.seat !== seat).map((s) => s.seat);

    add("CLAIM", [
      ...legalOwnClaimTargets(state, seat).map((territory): Action => ({ type: "CLAIM", seat, territory })),
      ...legalNeutralClaimTargets(state).map(
        (territory): Action => ({ type: "CLAIM", seat, territory, forNeutral: true }),
      ),
    ]);

    const trades: Action[] = [];
    for (const set of cardSets(row.cards)) {
      trades.push({ type: "TRADE_CARDS", seat, cards: set, bonusTerritory: null });
      for (const id of set) {
        const t = row.cards.find((c) => c.id === id)?.territory;
        if (t !== null && t !== undefined) {
          trades.push({ type: "TRADE_CARDS", seat, cards: set, bonusTerritory: t });
        }
      }
    }
    add("TRADE_CARDS", trades);

    const draftTargets = legalDraftTargets(state, seat);
    add("DRAFT", draftTargets.flatMap((territory): Action[] => [
      { type: "DRAFT", seat, territory, count: 1 },
      { type: "DRAFT", seat, territory, count: Math.max(1, state.troopsToPlace) },
    ]));
    if (draftTargets.length > 0 && state.troopsToPlace > 0) {
      // An even spread, the way the tick's `spreadPlacements` builds one.
      const counts = new Map<TerritoryId, number>();
      const sorted = [...draftTargets].sort((a, b) => a - b);
      for (let i = 0; i < state.troopsToPlace; i += 1) {
        const t = sorted[i % sorted.length] as TerritoryId;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      add("AUTO_DEPLOY", [{
        type: "AUTO_DEPLOY",
        seat,
        placements: [...counts].map(([territory, count]) => ({ territory, count })),
      }]);
    }

    const attacks: Action[] = [];
    for (let from = 0; from < map.territories.length; from += 1) {
      if (state.territories[from]?.owner !== seat) continue;
      for (const to of legalAttackTargets(state, map, from)) {
        attacks.push(rollAttack(
          state, map, { from, to, mode: "blitz" },
          rngFor("agreement", "battle", rngIndex + from * 131 + to), ODDS, "trueRandom",
        ));
      }
    }
    add("ATTACK", attacks);

    if (state.pendingMoveIn !== null) {
      const { min, max } = state.pendingMoveIn;
      add("MOVE_IN", [...new Set([min, max])].map((count): Action => ({ type: "MOVE_IN", seat, count })));
    }

    const fortifies: Action[] = [];
    for (let from = 0; from < map.territories.length; from += 1) {
      if (state.territories[from]?.owner !== seat) continue;
      for (const to of legalFortifyMoves(state, map, from)) {
        fortifies.push({ type: "FORTIFY", seat, from, to, count: 1 });
      }
    }
    add("FORTIFY", fortifies);

    add("END_PHASE", [{ type: "END_PHASE", seat }]);
    add("END_TURN", [{ type: "END_TURN", seat }]);
    // The resolver's own draw, which is the only `CARD_DRAWN` the authority ever appends.
    add("CARD_DRAWN", [drawCard(state, map, seat, rngFor("agreement", "cardDeck", rngIndex))]);

    add("ALLIANCE_PROPOSE", others.map((to): Action => ({ type: "ALLIANCE_PROPOSE", seat, to })));
    add("ALLIANCE_ACCEPT", others.map((from): Action => ({ type: "ALLIANCE_ACCEPT", seat, from })));
    add("ALLIANCE_BREAK", others.map((other): Action => ({ type: "ALLIANCE_BREAK", seat, with: other })));
    return out;
  }

  /** The two halves of the property, asserted for one seat at one state. */
  function assertAgreement(state: GameState, map: MapDef, seat: Seat, where: string, rngIndex: number): void {
    const advertised = new Set(legalActions(state, map, seat));
    const reps = representatives(state, map, seat, rngIndex);
    for (const kind of ACTION_ORDER) {
      const candidates = reps.get(kind) ?? [];
      const accepted = candidates.filter((action) => validate(state, map, action) === null);
      if (advertised.has(kind)) {
        expect(
          accepted.length,
          `${where}: seat ${String(seat)} is offered ${kind}, but validate refuses every payload of it`
            + ` (${candidates.map((c) => validate(state, map, c)?.code ?? "ok").join(", ")})`,
        ).toBeGreaterThan(0);
      } else {
        expect(
          accepted.length,
          `${where}: validate accepts ${kind} for seat ${String(seat)}, but legalActions does not offer it`,
        ).toBe(0);
      }
    }
  }

  /**
   * Drive a game the way the session runner and the lazy tick do, asserting the property at every
   * state and for every seat on the way through.
   *
   * Alliances are **on**, and the driver proposes, accepts and breaks as it goes: three of the four
   * disagreements this harness exists for were in the alliance branches, and a drive with
   * `alliances: false` would have walked straight past all of them. The trade-down branches are
   * reached the same way the real game reaches them — by capture and elimination.
   */
  function driveAndCheck(map: MapDef, seats: number, seed: string, maxSteps: number): number {
    const cfg = config(map, seats, { alliances: true, capitals: false, blizzards: false, portals: "off" }, seed);
    const started = dealTerritories(map, cfg, personasFor(seats), {
      deal: rngFor(seed, "deal", 0),
      turnOrder: rngFor(seed, "turnOrder", 0),
      modifierPlace: rngFor(seed, "modifierPlace", 0),
    });
    let state = createInitialState(map, started);
    let checked = 0;

    for (let step = 1; step <= maxSteps && state.outcome === null; step += 1) {
      for (const row of state.seats) assertAgreement(state, map, row.seat, `${map.slug} step ${String(step)}`, step);
      checked += 1;

      const seat = state.turnOrder[state.currentIndex] as Seat;
      const reps = representatives(state, map, seat, step);
      /*
       * The order a turn is actually played in, and it matters: `MOVE_IN` first because R63 blocks
       * everything else, then play, and `END_PHASE` before `END_TURN` the way `autoSkipAction` and
       * `decideTurn` both order them. Diplomacy is interleaved so `pendingAlliances` and `allies`
       * are non-empty for most of the drive rather than only at the end.
       *
       * `TRADE_CARDS` is **last**, deliberately: a driver that traded the moment it held a set
       * never let a hand reach five, so R24's forced-trade state — the one `legalActions` answers
       * with an early return, and the one finding 7 lived in — was never visited. Put last, it is
       * reached only when R24 and R26 have refused everything else, which is exactly that state.
       */
      const order: ActionKind[] = [
        "MOVE_IN", "CLAIM",
        ...(step % 7 === 0 ? (["ALLIANCE_PROPOSE", "ALLIANCE_ACCEPT"] as ActionKind[]) : []),
        ...(step % 23 === 0 ? (["ALLIANCE_BREAK"] as ActionKind[]) : []),
        "DRAFT", "ATTACK", "FORTIFY", "CARD_DRAWN", "END_PHASE", "END_TURN", "TRADE_CARDS",
      ];

      let moved = false;
      for (const kind of order) {
        for (const action of reps.get(kind) ?? []) {
          if (validate(state, map, action) !== null) continue;
          const result = apply(state, map, action);
          expect(result.error, `${kind} validated and then apply refused it`).toBeUndefined();
          state = result.state;
          moved = true;
          break;
        }
        if (moved) break;
      }
      /*
       * Nothing legal for the seat to play is itself a disagreement worth failing on: the assertion
       * above has already passed, so `legalActions` agreed there was nothing — and a seat with no
       * legal action at all is the dead end every one of these findings ended in.
       */
      if (!moved) {
        const off = state.seats.flatMap((row) =>
          (row.seat === seat ? [] : [...legalActions(state, map, row.seat)]));
        expect(
          [...legalActions(state, map, seat), ...off],
          `${map.slug} step ${String(step)}: no seat has a legal action and the game is not over`,
        ).toEqual([]);
        break;
      }
    }
    return checked;
  }

  /**
   * Several seeds per map, because `mini` is six territories and a game on it is over in a few
   * dozen actions: one drive is not "a few hundred reachable states", and the count is asserted so
   * a future change that makes the driver bail early cannot quietly shrink the coverage.
   */
  it("holds across eight driven 2-to-4-seat games on mini", () => {
    let checked = 0;
    for (let i = 0; i < 8; i += 1) {
      checked += driveAndCheck(mini, 2 + (i % 3), `agree-mini-${String(i)}`, 200);
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("holds across four driven 3-to-6-seat games on classic-world", () => {
    let checked = 0;
    for (let i = 0; i < 4; i += 1) {
      checked += driveAndCheck(classicWorld, 3 + i, `agree-world-${String(i)}`, 300);
    }
    expect(checked).toBeGreaterThan(300);
  });

  /**
   * The corners a drive reaches only by luck, pinned by hand.
   *
   * A driven game visits hundreds of states but it visits *ordinary* ones: five cards with a set at
   * turn start, a hand of eight mid-trade-down, a resigned seat, a pact with a seat that has just
   * been eliminated. Each of those is one of the round-4 findings, and each is a branch the drive
   * passes through at most once in a long game — so they are built directly and run through the
   * same two-sided check.
   */
  describe("the corner states each finding lived in", () => {
    const inf = (id: string, t: TerritoryId | null = null) => card(id, "infantry", t);
    const cav = (id: string, t: TerritoryId | null = null) => card(id, "cavalry", t);
    const art = (id: string, t: TerritoryId | null = null) => card(id, "artillery", t);
    const SET = [inf("c1"), inf("c2"), inf("c3")];

    const cases: readonly { readonly label: string; readonly state: GameState }[] = [
      {
        // Finding 7 — R24's early return dropped the alliance kinds `validate` was accepting.
        label: "R24 forced trade at turn start, alliances on",
        state: buildState(mini, {
          seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [2, 2, 2, 2, 2, 2],
          phase: "draft", troopsToPlace: 3, rules: { alliances: true },
          hands: { 0: [...SET, cav("x"), cav("y")] },
        }),
      },
      {
        // Finding 1 — R28's guard refuses every action carrying this seat but the trade.
        label: "R26 trade-down from eight, alliances on",
        state: buildState(mini, {
          seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [2, 2, 2, 2, 2, 2],
          phase: "draft", troopsToPlace: 0, rules: { alliances: true },
          resumePhase: "attack", setsTradedThisTurn: 1,
          hands: { 0: [...SET, cav("x"), cav("y"), cav("z"), art("p"), art("q")] },
        }),
      },
      {
        // Finding 6 — `END_TURN` out of a finished draft.
        label: "draft with every troop placed",
        state: buildState(mini, {
          seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [2, 2, 2, 2, 2, 2],
          phase: "draft", troopsToPlace: 0, rules: { alliances: true },
        }),
      },
      {
        // Finding 5 — a resigned seat keeps taking turns but is no longer a contender.
        label: "a resigned seat, alliances on",
        state: buildState(mini, {
          seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [2, 2, 2, 2, 2, 2],
          phase: "attack", rules: { alliances: true }, standings: { 1: "resigned" },
        }),
      },
      {
        // Finding 2 — an offer on the table, in one direction only.
        label: "one offer in the air",
        state: buildState(mini, {
          seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [2, 2, 2, 2, 2, 2],
          phase: "attack", rules: { alliances: true }, pendingAlliances: [[1, 0]],
        }),
      },
      {
        // R25 — the reward draw that lands a hand on six in fortify forces nothing.
        label: "six cards in fortify, unbounced",
        state: buildState(mini, {
          seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [2, 2, 2, 2, 2, 2],
          phase: "fortify", rules: { alliances: true },
          hands: { 0: [...SET, cav("x"), cav("y"), cav("z")] },
        }),
      },
      {
        // R63 — a conquest pending, which refuses everything but the move-in.
        label: "a move-in pending",
        state: {
          ...buildState(mini, {
            seats: 3, owners: [0, 0, 1, 1, 2, 2], troops: [3, 2, 2, 2, 2, 2],
            phase: "attack", rules: { alliances: true },
          }),
          pendingMoveIn: { from: 0, to: 2, min: 1, max: 2 },
        },
      },
    ];

    it.each(cases.map((c) => [c.label, c.state] as const))("%s", (label, state) => {
      for (const row of state.seats) assertAgreement(state, mini, row.seat, label, 1);
    });

    /**
     * Finding 4 — an elimination used to leave the survivor holding a pact with a dead seat, which
     * `legalActions` advertised an `ALLIANCE_BREAK` for and `validate` refused. Built by *playing*
     * the elimination, so the reducer is what produces the state rather than the fixture.
     */
    it("a pact that an elimination has just ended (R81)", () => {
      const start = buildState(mini, {
        seats: 3, owners: [0, 0, 0, 1, 2, 2], troops: [1, 1, 4, 1, 1, 1],
        phase: "attack", rules: { alliances: true },
      });
      const offered = apply(start, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 2 });
      expect(offered.error).toBeUndefined();
      const allied = apply(offered.state, mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 1 });
      expect(allied.error).toBeUndefined();
      const killed = apply(allied.state, mini, {
        type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1,
      });
      expect(killed.error).toBeUndefined();
      expect(killed.state.seats[1]?.standing).toBe("eliminated");
      for (const row of killed.state.seats) {
        assertAgreement(killed.state, mini, row.seat, "after an elimination", 1);
      }
    });
  });

  it("holds across a 2-seat manual-placement game, which is the claim phase's own shape (R6)", () => {
    const cfg = config(mini, 2, { alliances: true, manualPlacement: true }, "agree-manual");
    const started = dealTerritories(mini, cfg, personasFor(2), {
      deal: rngFor("agree-manual", "deal", 0),
      turnOrder: rngFor("agree-manual", "turnOrder", 0),
      modifierPlace: rngFor("agree-manual", "modifierPlace", 0),
    });
    let state = createInitialState(mini, started);
    expect(state.phase).toBe("claim");
    for (let step = 1; step <= 120 && state.phase === "claim"; step += 1) {
      for (const row of state.seats) assertAgreement(state, mini, row.seat, `claim step ${String(step)}`, step);
      const seat = state.turnOrder[state.currentIndex] as Seat;
      const owed = claimOwed(state, seat);
      const territory = owed === "neutral"
        ? legalNeutralClaimTargets(state)[0]
        : legalOwnClaimTargets(state, seat)[0];
      if (territory === undefined) break;
      const action: Action = owed === "neutral"
        ? { type: "CLAIM", seat, territory, forNeutral: true }
        : { type: "CLAIM", seat, territory };
      const result = apply(state, mini, action);
      expect(result.error).toBeUndefined();
      state = result.state;
    }
  });
});
