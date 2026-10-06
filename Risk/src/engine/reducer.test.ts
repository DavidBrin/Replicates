/**
 * T2 — the reducer, one test per rule, named by its rule number.
 *
 * Every test here drives `apply` and nothing else, because `apply` is the one
 * door into the rules (§4.10). The three card-timing branches and the two R27
 * bounce paths are separate tests by design (R24–R27, F41).
 */
import { describe, expect, it } from "vitest";

import { buildState, card, startedAction, territoryCard, persona } from "./__fixtures__/states";
import { classicWorld, mini, tiny4 } from "./__fixtures__/maps";
import { apply, createInitialState } from "./reducer";
import { legalActions } from "./legalActions";
import { validate } from "./validate";
import { hashState } from "./hash";
import {
  SEAT_NEUTRAL,
  SEAT_NONE,
  type Action,
  type Card,
  type Event,
  type GameState,
  type MapDef,
  type RuleErrorCode,
} from "./types";

const inf = (id: string, t: number | null = null): Card => card(id, "infantry", t);
const cav = (id: string, t: number | null = null): Card => card(id, "cavalry", t);
const art = (id: string, t: number | null = null): Card => card(id, "artillery", t);

/** Apply and insist it was accepted. */
function ok(state: GameState, map: MapDef, action: Action): { state: GameState; events: readonly Event[] } {
  const result = apply(state, map, action);
  expect(result.error).toBeUndefined();
  return { state: result.state, events: result.events };
}

/** Apply and insist it was refused with this code, leaving the state untouched. */
function refused(state: GameState, map: MapDef, action: Action, code: RuleErrorCode): void {
  const result = apply(state, map, action);
  expect(result.error?.code).toBe(code);
  expect(result.state).toBe(state);
  expect(result.events).toEqual([]);
}

function eventTypes(events: readonly Event[]): string[] {
  return events.map((e) => e.type);
}

/**
 * Play the current seat's whole turn the dullest way possible: draft everything
 * onto its lowest-index territory, skip attack, skip fortify, end the turn. Used
 * by the round and Max Rounds tests, where the point is the turn pipeline rather
 * than any one action.
 */
function playTurn(state: GameState, map: MapDef): GameState {
  const seat = state.turnOrder[state.currentIndex] as number;
  let s = state;
  if (s.phase === "draft" && s.troopsToPlace > 0) {
    const target = s.territories.findIndex((t) => t.owner === seat && !t.blizzard);
    s = ok(s, map, { type: "DRAFT", seat, territory: target, count: s.troopsToPlace }).state;
  }
  if (s.phase === "draft") s = ok(s, map, { type: "END_PHASE", seat }).state;
  if (s.phase === "attack") s = ok(s, map, { type: "END_PHASE", seat }).state;
  return ok(s, map, { type: "END_TURN", seat }).state;
}

/* ------------------------------------------------------------------- setup -- */

describe("R1–R11 — setup", () => {
  it("R2 — starting armies are 35 / 30 / 25 / 20 by seat count, and 40 at two seats", () => {
    const started = startedAction(classicWorld, { seats: 4, startingArmies: 30 });
    const state = createInitialState(classicWorld, started);
    expect(state.seats).toHaveLength(4);
    expect(started.startingArmies).toBe(30);
  });

  it("R3 — the deal lands owners and troops on every non-blizzard territory", () => {
    const started = startedAction(mini, { seats: 3, troops: [4, 3, 2, 5, 1, 1] });
    const state = createInitialState(mini, started);
    expect(state.territories.map((t) => t.owner)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(state.territories.map((t) => t.troops)).toEqual([4, 3, 2, 5, 1, 1]);
  });

  it("R10 — a blizzard tile is ownerless, troopless and never dealt", () => {
    const started = startedAction(mini, { seats: 3, blizzards: [4] });
    const state = createInitialState(mini, started);
    expect(state.territories[4]).toEqual({ owner: SEAT_NONE, troops: 0, blizzard: true });
    expect(started.deal.some((d) => d.territory === 4)).toBe(false);
  });

  it("R10 — a GAME_STARTED that deals a blizzard tile is refused", () => {
    const started = startedAction(mini, { seats: 3 });
    const broken = { ...started, blizzards: [0] };
    const state = createInitialState(mini, started);
    refused(state, mini, broken, "blizzard");
  });

  it("R8 — each seat's capital is carried in GAME_STARTED and lands on the seat row", () => {
    const started = startedAction(mini, { seats: 3, rules: { capitals: true }, capitals: [0, 1, 2] });
    const state = createInitialState(mini, started);
    expect(state.seats.map((s) => s.capital)).toEqual([0, 1, 2]);
  });

  it("R8/R10 — a capital on a blizzard is refused", () => {
    const started = startedAction(mini, { seats: 3, blizzards: [5] });
    const state = createInitialState(mini, started);
    refused(state, mini, { ...started, capitals: [5, 1, 2] }, "blizzard");
  });

  it("R11 — a portal that links two adjacent territories is refused", () => {
    const started = startedAction(mini, { seats: 3 });
    const state = createInitialState(mini, started);
    const moved: Action = {
      type: "PORTALS_MOVED",
      seat: 0,
      portals: [{ a: 0, b: 1, kind: "unstable", activeFrom: 0 }],
    };
    const unstable = buildState(mini, { rules: { portals: "unstable" } });
    refused(unstable, mini, moved, "notAdjacent");
    void state;
  });

  it("R1/R4 — turnOrder must be a permutation of the seats", () => {
    const started = startedAction(mini, { seats: 3 });
    const state = createInitialState(mini, started);
    refused(state, mini, { ...started, turnOrder: [0, 0, 1] }, "illegalAction");
    refused(state, mini, { ...started, turnOrder: [0, 1] }, "illegalAction");
  });

  it("R4 — the opening seat is turnOrder[0]", () => {
    const started = startedAction(mini, { seats: 3, turnOrder: [2, 0, 1] });
    const state = createInitialState(mini, started);
    expect(state.turnOrder).toEqual([2, 0, 1]);
    expect(state.currentIndex).toBe(0);
    expect(state.turnOrder[state.currentIndex]).toBe(2);
  });

  it("the opening state is a draft with the first seat already paid (R12)", () => {
    const started = startedAction(mini, { seats: 3 });
    const state = createInitialState(mini, started);
    expect(state.phase).toBe("draft");
    expect(state.round).toBe(1);
    expect(state.turn).toBe(1);
    expect(state.troopsToPlace).toBe(3);
    expect(state.fogged).toBe(false);
  });

  it("apply(GAME_STARTED) folds the opening so a log replays from seq 1", () => {
    const started = startedAction(mini, { seats: 3 });
    const empty = buildState(mini, { seats: 3 });
    const { state, events } = ok(empty, mini, started);
    expect(hashState(state)).toBe(hashState(createInitialState(mini, started)));
    expect(eventTypes(events)).toContain("turnStarted");
    expect(eventTypes(events)).toContain("troopsAwarded");
  });

  it("a GAME_STARTED for another map is refused", () => {
    const started = startedAction(mini, { seats: 3 });
    const state = buildState(classicWorld, { seats: 3 });
    refused(state, classicWorld, started, "illegalAction");
  });
});

describe("R5–R7 — the two-seat 40/40/40 variant", () => {
  it("R5/R7 — the neutral is a sentinel owner with no seat row", () => {
    const owners = classicWorld.territories.map((_t, i) => (i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : SEAT_NEUTRAL));
    const started = startedAction(classicWorld, { seats: 2, owners, startingArmies: 40 });
    const state = createInitialState(classicWorld, started);
    expect(state.seats).toHaveLength(2);
    expect(state.seats.map((s) => s.kind)).toEqual(["human", "bot"]);
    expect(state.seats.some((s) => (s.kind as string) === "neutral")).toBe(false);
    expect(state.territories.filter((t) => t.owner === SEAT_NEUTRAL)).toHaveLength(14);
  });

  it("R5 — three 14-card piles on a 42-territory map", () => {
    const owners = classicWorld.territories.map((_t, i) => (i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : SEAT_NEUTRAL));
    const started = startedAction(classicWorld, { seats: 2, owners, startingArmies: 40 });
    const state = createInitialState(classicWorld, started);
    for (const owner of [0, 1, SEAT_NEUTRAL]) {
      expect(state.territories.filter((t) => t.owner === owner)).toHaveLength(14);
    }
  });

  it("R7 — the neutral never takes a turn", () => {
    const owners = mini.territories.map((_t, i) => (i < 2 ? 0 : i < 4 ? 1 : SEAT_NEUTRAL));
    const state = buildState(mini, { seats: 2, owners, troops: [3, 1, 3, 1, 1, 1] });
    expect(state.turnOrder).toEqual([0, 1]);
    expect(state.turnOrder).not.toContain(SEAT_NEUTRAL);
  });

  it("R7 — the neutral is excluded from the last-seat-standing check", () => {
    const owners = mini.territories.map((_t, i) => (i < 3 ? 0 : SEAT_NEUTRAL));
    const state = buildState(mini, {
      seats: 2,
      owners,
      troops: [1, 1, 1, 1, 1, 1],
      standings: { 1: "eliminated" },
      phase: "fortify",
    });
    const { state: after } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(after.outcome).toMatchObject({ winner: 0, reason: "lastStanding" });
  });

  it("R7 — the neutral defends with no special case, and can be conquered", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, SEAT_NEUTRAL, SEAT_NEUTRAL, SEAT_NEUTRAL],
      troops: [1, 1, 5, 1, 1, 1],
    });
    const { state: after, events } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 0,
      defenderLosses: 1,
    });
    expect(after.territories[3]?.owner).toBe(0);
    expect(eventTypes(events)).toContain("territoryCaptured");
    // The neutral is never "eliminated".
    expect(eventTypes(events)).not.toContain("playerEliminated");
  });
});

/* ------------------------------------------------------------------- claim -- */

describe("R9 — the claim phase (Manual Placement)", () => {
  function claimState(seats = 2, armies = 3) {
    const started = startedAction(tiny4, {
      seats,
      // D106 — the neutral is asked for; these are the R6 alternation's own tests.
      rules: { manualPlacement: true, neutralHolding: true },
      startingArmies: armies,
    });
    // R3 assigns no owners under Manual Placement.
    const stripped: Action = { ...started, deal: [] };
    return { started: stripped, state: createInitialState(tiny4, stripped) };
  }

  function claimMini(seats: number, armies: number) {
    const started = startedAction(mini, {
      seats,
      rules: { manualPlacement: true, neutralHolding: true },
      startingArmies: armies,
    });
    const stripped: Action = { ...started, deal: [] };
    return { started: stripped, state: createInitialState(mini, stripped) };
  }

  it("R9 — opens in the claim phase with every army still to place", () => {
    const { state } = claimState(2, 3);
    expect(state.phase).toBe("claim");
    expect(state.seats.map((s) => s.armiesToClaim)).toEqual([3, 3]);
    expect(state.territories.every((t) => t.owner === SEAT_NONE)).toBe(true);
    expect(state.troopsToPlace).toBe(0);
  });

  it("R9 — each CLAIM places exactly one army and passes the turn", () => {
    const { state } = claimState(3, 3);
    const { state: after } = ok(state, tiny4, { type: "CLAIM", seat: 0, territory: 0 });
    expect(after.territories[0]).toEqual({ owner: 0, troops: 1, blizzard: false });
    expect(after.seats[0]?.armiesToClaim).toBe(2);
    expect(after.turnOrder[after.currentIndex]).toBe(1);
  });

  it("R9 — claims go onto unowned territories while any remain", () => {
    const { state } = claimState(3, 3);
    const a = ok(state, tiny4, { type: "CLAIM", seat: 0, territory: 0 }).state;
    refused(a, tiny4, { type: "CLAIM", seat: 1, territory: 0 }, "notOwned");
  });

  it("R9 — once the board is claimed, a seat reinforces its own", () => {
    const { state } = claimState(3, 2);
    let s = state;
    const order = [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 3],
    ] as const;
    for (const [seat, territory] of order) s = ok(s, tiny4, { type: "CLAIM", seat, territory }).state;
    expect(s.territories.every((t) => t.owner !== SEAT_NONE)).toBe(true);
    refused(s, tiny4, { type: "CLAIM", seat: 1, territory: 0 }, "notOwned");
    const { state: after } = ok(s, tiny4, { type: "CLAIM", seat: 1, territory: 1 });
    expect(after.territories[1]?.troops).toBe(2);
  });

  it("R9 — the phase ends when every army is placed, and play opens at turnOrder[0]", () => {
    // Three seats, so no neutral holding is owed anything (R6 is 2-seat only).
    const { state } = claimState(3, 1);
    let s = state;
    for (const [seat, territory] of [
      [0, 0],
      [1, 1],
      [2, 2],
    ] as const) {
      s = ok(s, tiny4, { type: "CLAIM", seat, territory }).state;
    }
    expect(s.phase).toBe("draft");
    expect(s.currentIndex).toBe(0);
    expect(s.troopsToPlace).toBe(3);
  });

  it("R6 — the 2-seat variant alternates two own armies, then one neutral", () => {
    const { state } = claimMini(2, 4);
    let s = state;
    // Two own claims keep the turn; the pair then owes a neutral army.
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 0 }).state;
    expect(s.turnOrder[s.currentIndex]).toBe(0);
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 1 }).state;
    expect(s.turnOrder[s.currentIndex]).toBe(0);
    // Mandatory: an own claim is refused while the neutral army is owed.
    refused(s, mini, { type: "CLAIM", seat: 0, territory: 2 }, "mustPlaceAllTroops");
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 4, forNeutral: true }).state;
    expect(s.turnOrder[s.currentIndex]).toBe(1);
    expect(s.territories[4]).toEqual({ owner: SEAT_NEUTRAL, troops: 1, blizzard: false });
  });

  it("R6/F50 — the phase waits for the neutral holding, then opens the game", () => {
    const { state } = claimMini(2, 2);
    let s = state;
    for (const [seat, territory] of [
      [0, 0],
      [0, 1],
    ] as const) {
      s = ok(s, mini, { type: "CLAIM", seat, territory }).state;
    }
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 4, forNeutral: true }).state;
    s = ok(s, mini, { type: "CLAIM", seat: 1, territory: 2 }).state;
    s = ok(s, mini, { type: "CLAIM", seat: 1, territory: 3 }).state;
    expect(s.seats.map((x) => x.armiesToClaim)).toEqual([0, 0]);
    expect(s.phase).toBe("claim");
    s = ok(s, mini, { type: "CLAIM", seat: 1, territory: 5, forNeutral: true }).state;
    expect(s.phase).toBe("draft");
    expect(s.territories.filter((t) => t.owner === SEAT_NEUTRAL)).toHaveLength(2);
  });

  it("R6/F50 — an odd remainder's final step places 1, and still owes one neutral army", () => {
    const { state } = claimMini(2, 1);
    let s = state;
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 0 }).state;
    // Exhausted on an odd count: floor(1/2) + 1 = one neutral army owed.
    expect(s.turnOrder[s.currentIndex]).toBe(0);
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 4, forNeutral: true }).state;
    expect(s.turnOrder[s.currentIndex]).toBe(1);
    s = ok(s, mini, { type: "CLAIM", seat: 1, territory: 1 }).state;
    s = ok(s, mini, { type: "CLAIM", seat: 1, territory: 5, forNeutral: true }).state;
    expect(s.phase).toBe("draft");
    expect(s.territories.filter((t) => t.owner === SEAT_NEUTRAL)).toHaveLength(2);
  });

  it("R9/R74 — a blizzard is never claimed", () => {
    const started = startedAction(tiny4, { seats: 2, rules: { manualPlacement: true }, blizzards: [1] });
    const state = createInitialState(tiny4, { ...started, deal: [] });
    refused(state, tiny4, { type: "CLAIM", seat: 0, territory: 1 }, "blizzard");
  });

  it("R6/F50 — CLAIM { forNeutral: true } spends none of the seat's own armies", () => {
    const { state } = claimMini(2, 4);
    let s = ok(state, mini, { type: "CLAIM", seat: 0, territory: 0 }).state;
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 1 }).state;
    expect(s.seats[0]?.armiesToClaim).toBe(2);
    const neutral = ok(s, mini, { type: "CLAIM", seat: 0, territory: 4, forNeutral: true }).state;
    expect(neutral.territories[4]).toEqual({ owner: SEAT_NEUTRAL, troops: 1, blizzard: false });
    expect(neutral.seats[0]?.armiesToClaim).toBe(2);
  });

  it("R6 — a neutral claim with nothing owed is refused", () => {
    const { state } = claimMini(2, 4);
    refused(state, mini, { type: "CLAIM", seat: 0, territory: 0, forNeutral: true }, "tooManyTroops");
  });

  it("R6/R7 — forNeutral is refused outside the two-seat variant", () => {
    const { state } = claimState(3, 3);
    refused(state, tiny4, { type: "CLAIM", seat: 0, territory: 0, forNeutral: true }, "illegalAction");
  });

  it("R6 — a neutral army lands only on a neutral or unowned territory", () => {
    const { state } = claimMini(2, 4);
    let s = ok(state, mini, { type: "CLAIM", seat: 0, territory: 0 }).state;
    s = ok(s, mini, { type: "CLAIM", seat: 0, territory: 1 }).state;
    refused(s, mini, { type: "CLAIM", seat: 0, territory: 0, forNeutral: true }, "notOwned");
  });

  it("R8/R9 — under Manual Placement a capital is drawn once the claims resolve", () => {
    const started = startedAction(tiny4, {
      seats: 3,
      rules: { manualPlacement: true, capitals: true },
      startingArmies: 1,
    });
    let s = createInitialState(tiny4, { ...started, deal: [], capitals: [null, null, null] });
    expect(s.seats.map((x) => x.capital)).toEqual([null, null, null]);
    for (const [seat, territory] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ] as const) {
      s = ok(s, tiny4, { type: "CLAIM", seat, territory }).state;
    }
    expect(s.phase).toBe("draft");
    // Deterministic, no RNG inside `apply` (R88): the most-garrisoned own
    // territory — one each here, so the tie falls to the lowest index.
    expect(s.seats.map((x) => x.capital)).toEqual([1, 2, 3]);
  });

  it("R8/R9 — the manual-placement capital is the seat's BIGGEST stack, not its lowest index", () => {
    const started = startedAction(mini, {
      seats: 3,
      rules: { manualPlacement: true, capitals: true },
      startingArmies: 3,
    });
    let s = createInitialState(mini, { ...started, deal: [], capitals: [null, null, null] });
    // One army per step, round robin: the board fills, then each seat spends its
    // last army reinforcing its SECOND territory, which becomes its biggest stack.
    for (const [seat, territory] of [
      [0, 0], [1, 1], [2, 2], [0, 3], [1, 4], [2, 5], [0, 3], [1, 4], [2, 5],
    ] as const) {
      s = ok(s, mini, { type: "CLAIM", seat, territory }).state;
    }
    expect(s.phase).toBe("draft");
    expect(s.territories.map((t) => t.troops)).toEqual([1, 1, 1, 2, 2, 2]);
    // The lowest-index rule would have answered [0, 1, 2].
    expect(s.seats.map((x) => x.capital)).toEqual([3, 4, 5]);
  });

  it("R8/R9 — a tie on troops falls to the lowest index, so `apply` stays deterministic (R88)", () => {
    const started = startedAction(mini, {
      seats: 3,
      rules: { manualPlacement: true, capitals: true },
      startingArmies: 2,
    });
    let s = createInitialState(mini, { ...started, deal: [], capitals: [null, null, null] });
    for (const [seat, territory] of [
      [0, 0], [1, 1], [2, 2], [0, 3], [1, 4], [2, 5],
    ] as const) {
      s = ok(s, mini, { type: "CLAIM", seat, territory }).state;
    }
    expect(s.territories.map((t) => t.troops)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(s.seats.map((x) => x.capital)).toEqual([0, 1, 2]);
  });

  it("a CLAIM out of the claim phase is refused", () => {
    const state = buildState(tiny4, { phase: "draft", seats: 2, owners: [0, 0, 1, 1] });
    refused(state, tiny4, { type: "CLAIM", seat: 0, territory: 0 }, "wrongPhase");
  });

  it("a seat with no armies left cannot claim", () => {
    const { state } = claimState(3, 1);
    const after = ok(state, tiny4, { type: "CLAIM", seat: 0, territory: 0 }).state;
    expect(after.turnOrder[after.currentIndex]).toBe(1);
    refused(after, tiny4, { type: "CLAIM", seat: 0, territory: 1 }, "notYourTurn");
  });
});

/* ------------------------------------------------------------------- draft -- */

describe("R16–R18 — drafting", () => {
  function draftState(troops = 5) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "draft",
      troopsToPlace: troops,
    });
  }

  it("R16 — DRAFT places troops on an owned territory", () => {
    const { state, events } = ok(draftState(), mini, { type: "DRAFT", seat: 0, territory: 1, count: 3 });
    expect(state.territories[1]?.troops).toBe(4);
    expect(state.troopsToPlace).toBe(2);
    expect(events).toEqual([{ type: "troopsPlaced", territory: 1, count: 3 }]);
  });

  it("R16 — troops may go on any owned territory, in any number of actions", () => {
    let s = draftState(5);
    s = ok(s, mini, { type: "DRAFT", seat: 0, territory: 0, count: 1 }).state;
    s = ok(s, mini, { type: "DRAFT", seat: 0, territory: 2, count: 1 }).state;
    s = ok(s, mini, { type: "DRAFT", seat: 0, territory: 0, count: 3 }).state;
    expect(s.troopsToPlace).toBe(0);
    expect(s.territories[0]?.troops).toBe(5);
  });

  it("R16 — a count of zero or less is refused", () => {
    refused(draftState(), mini, { type: "DRAFT", seat: 0, territory: 0, count: 0 }, "tooFewTroops");
    refused(draftState(), mini, { type: "DRAFT", seat: 0, territory: 0, count: -2 }, "tooFewTroops");
  });

  it("R16 — more troops than you hold is refused", () => {
    refused(draftState(2), mini, { type: "DRAFT", seat: 0, territory: 0, count: 3 }, "tooManyTroops");
  });

  it("R16 — drafting onto another seat's territory is refused", () => {
    refused(draftState(), mini, { type: "DRAFT", seat: 0, territory: 3, count: 1 }, "notOwned");
  });

  it("R74 — drafting onto a blizzard is refused", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1],
      blizzards: [5],
      phase: "draft",
      troopsToPlace: 3,
    });
    refused(state, mini, { type: "DRAFT", seat: 0, territory: 5, count: 1 }, "blizzard");
  });

  it("R17 — END_PHASE out of draft is refused while troops remain", () => {
    refused(draftState(2), mini, { type: "END_PHASE", seat: 0 }, "mustPlaceAllTroops");
  });

  it("R17 — END_PHASE out of draft is accepted once the counter is empty", () => {
    const { state, events } = ok(draftState(0), mini, { type: "END_PHASE", seat: 0 });
    expect(state.phase).toBe("attack");
    expect(events).toEqual([{ type: "phaseChanged", from: "draft", to: "attack" }]);
  });

  it("AUTO_DEPLOY places every remaining troop at once", () => {
    const { state, events } = ok(draftState(4), mini, {
      type: "AUTO_DEPLOY",
      seat: 0,
      placements: [
        { territory: 0, count: 1 },
        { territory: 2, count: 3 },
      ],
    });
    expect(state.troopsToPlace).toBe(0);
    expect(state.territories[0]?.troops).toBe(2);
    expect(state.territories[2]?.troops).toBe(4);
    expect(eventTypes(events)).toEqual(["troopsPlaced", "troopsPlaced"]);
  });

  it("AUTO_DEPLOY that does not place every troop is refused", () => {
    refused(
      draftState(4),
      mini,
      { type: "AUTO_DEPLOY", seat: 0, placements: [{ territory: 0, count: 2 }] },
      "mustPlaceAllTroops",
    );
  });
});

/* ------------------------------------------------------------------- cards -- */

describe("R22–R27 — trading", () => {
  const fixedSet = [inf("l1", 0), inf("r1", 3), inf("x", null)];

  function tradeState(hand: readonly Card[], overrides: Parameters<typeof buildState>[1] = {}) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "draft",
      troopsToPlace: 3,
      hands: { 0: hand },
      ...overrides,
    });
  }

  it("R18/R22 — a Fixed infantry set adds 4 to the same counter the draft spends", () => {
    const { state, events } = ok(tradeState(fixedSet), mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["l1", "r1", "x"],
      bonusTerritory: null,
    });
    expect(state.troopsToPlace).toBe(7);
    expect(state.seats[0]?.cards).toEqual([]);
    expect(state.seats[0]?.cardCount).toBe(0);
    expect(state.discard).toHaveLength(3);
    expect(state.setsTradedThisTurn).toBe(1);
    expect(state.setsTradedTotal).toBe(1);
    expect(events[0]).toMatchObject({ type: "cardsTraded", value: 4 });
  });

  it("R22 — Fixed pays 6 for cavalry, 8 for artillery and 10 for a mixed set", () => {
    const cases: readonly [readonly Card[], number][] = [
      [[cav("a"), cav("b"), cav("c")], 6],
      [[art("a"), art("b"), art("c")], 8],
      [[inf("a"), cav("b"), art("c")], 10],
      [[inf("a"), inf("b"), card("wild-1", "wild", null)], 10],
    ];
    for (const [hand, value] of cases) {
      const { state } = ok(tradeState(hand), mini, {
        type: "TRADE_CARDS",
        seat: 0,
        cards: [hand[0]?.id as string, hand[1]?.id as string, hand[2]?.id as string],
        bonusTerritory: null,
      });
      expect(state.troopsToPlace).toBe(3 + value);
    }
  });

  it("R22 — Progressive climbs with the global count, not the suits", () => {
    const hand = [art("a"), art("b"), art("c")];
    const state = tradeState(hand, { rules: { cardBonus: "progressive" }, setsTradedTotal: 5 });
    const { state: after } = ok(state, mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["a", "b", "c"],
      bonusTerritory: null,
    });
    expect(after.troopsToPlace).toBe(3 + 15);
    expect(after.setsTradedTotal).toBe(6);
  });

  it("R23 — a traded card naming an occupied territory adds +2 on that territory", () => {
    const { state, events } = ok(tradeState(fixedSet), mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["l1", "r1", "x"],
      bonusTerritory: 0,
    });
    expect(state.territories[0]?.troops).toBe(3);
    expect(state.troopsToPlace).toBe(7); // the +2 is NOT in the counter (R18)
    expect(state.territoryBonusLeft).toBe(0);
    expect(eventTypes(events)).toEqual(["cardsTraded", "troopsPlaced"]);
  });

  it("R23 — the bonus is capped at +2 per turn however many cards match", () => {
    const first = [inf("l1", 0), inf("l2", 1), inf("z")];
    const second = [cav("l3", 2), cav("q"), cav("w")];
    let s = tradeState([...first, ...second]);
    s = ok(s, mini, { type: "TRADE_CARDS", seat: 0, cards: ["l1", "l2", "z"], bonusTerritory: 0 }).state;
    expect(s.territoryBonusLeft).toBe(0);
    refused(
      s,
      mini,
      { type: "TRADE_CARDS", seat: 0, cards: ["l3", "q", "w"], bonusTerritory: 2 },
      "tooManyTroops",
    );
  });

  it("R23 — a Fixed trade is worth at most 12 in one turn", () => {
    const state = tradeState(fixedSet, { troopsToPlace: 0 });
    const { state: after } = ok(state, mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["l1", "r1", "x"],
      bonusTerritory: 0,
    });
    const gained = after.troopsToPlace + (after.territories[0]?.troops ?? 0) - (state.territories[0]?.troops ?? 0);
    expect(gained).toBe(6); // 4 in the counter + 2 on the board for an infantry set
    const mixed = tradeState([inf("l1", 0), cav("b"), art("c")], { troopsToPlace: 0 });
    const { state: best } = ok(mixed, mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["l1", "b", "c"],
      bonusTerritory: 0,
    });
    expect(best.troopsToPlace + 2).toBe(12);
  });

  it("R23 — the bonus territory must be named by a traded card and occupied", () => {
    refused(
      tradeState(fixedSet),
      mini,
      { type: "TRADE_CARDS", seat: 0, cards: ["l1", "r1", "x"], bonusTerritory: 1 },
      "notHeld",
    );
    refused(
      tradeState(fixedSet),
      mini,
      { type: "TRADE_CARDS", seat: 0, cards: ["l1", "r1", "x"], bonusTerritory: 3 },
      "notOwned",
    );
  });

  it("R21 — an invalid set is refused", () => {
    refused(
      tradeState([inf("a"), inf("b"), cav("c")]),
      mini,
      { type: "TRADE_CARDS", seat: 0, cards: ["a", "b", "c"], bonusTerritory: null },
      "invalidSet",
    );
  });

  it("R21 — trading a card you do not hold is refused", () => {
    refused(
      tradeState(fixedSet),
      mini,
      { type: "TRADE_CARDS", seat: 0, cards: ["l1", "r1", "nope"], bonusTerritory: null },
      "notHeld",
    );
  });

  it("R24 — holding five cards at turn start, only TRADE_CARDS is legal", () => {
    const five = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e")];
    const state = tradeState(five);
    expect(legalActions(state, mini, 0)).toEqual(["TRADE_CARDS"]);
    refused(state, mini, { type: "DRAFT", seat: 0, territory: 0, count: 1 }, "mustTradeCards");
    refused(state, mini, { type: "END_PHASE", seat: 0 }, "mustTradeCards");
  });

  it("R24 — the forced trade clears the block, and the second trade is optional", () => {
    const six = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e"), cav("f")];
    const state = tradeState(six);
    const after = ok(state, mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["a", "b", "c"],
      bonusTerritory: null,
    }).state;
    expect(after.seats[0]?.cards).toHaveLength(3);
    expect(legalActions(after, mini, 0)).toContain("DRAFT");
    expect(legalActions(after, mini, 0)).toContain("TRADE_CARDS");
  });

  it("R25 — the end-of-turn reward draw to five forces nothing in the turn it lands in", () => {
    const four = [inf("a"), inf("b"), inf("c"), cav("d")];
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, 5, 1, 1, 1],
      phase: "fortify",
      hands: { 0: four },
      conqueredThisTurn: true,
    });
    const { state: after } = ok(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 4) });
    expect(after.seats[0]?.cards).toHaveLength(5);
    expect(after.phase).toBe("fortify");
    expect(after.resumePhase).toBeNull();
    // Nothing is forced until the next turn's draft.
    expect(legalActions(after, mini, 0)).toContain("END_TURN");
  });

  it("R25 — the check fires at the start of the NEXT turn", () => {
    const five = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e")];
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "fortify",
      hands: { 0: five },
    });
    let s = ok(state, mini, { type: "END_TURN", seat: 0 }).state;
    s = ok(s, mini, { type: "DRAFT", seat: 1, territory: 3, count: s.troopsToPlace }).state;
    s = ok(s, mini, { type: "END_PHASE", seat: 1 }).state;
    s = ok(s, mini, { type: "END_PHASE", seat: 1 }).state;
    s = ok(s, mini, { type: "END_TURN", seat: 1 }).state;
    expect(s.turnOrder[s.currentIndex]).toBe(0);
    expect(s.phase).toBe("draft");
    expect(legalActions(s, mini, 0)).toEqual(["TRADE_CARDS"]);
  });

  it("R27 — a mid-Attack forced trade-down bounces the phase to draft", () => {
    // Seat 0 eliminates seat 1 and inherits six cards.
    const victimHand = [inf("v1"), inf("v2"), inf("v3"), cav("v4"), cav("v5"), cav("v6")];
    const state = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 1, 2, 2],
      troops: [1, 1, 6, 1, 1, 1],
      phase: "attack",
      hands: { 1: victimHand },
    });
    const attacked = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 0,
      defenderLosses: 1,
    });
    // F41 — the ATTACK branch leaves the phase at attack with a move-in pending.
    expect(attacked.state.phase).toBe("attack");
    expect(attacked.state.pendingMoveIn).not.toBeNull();
    expect(eventTypes(attacked.events)).toContain("cardsSeized");
    expect(attacked.state.seats[0]?.cards).toHaveLength(6);

    // F41 — the bounce is applied in the MOVE_IN branch, after the move.
    const moved = ok(attacked.state, mini, { type: "MOVE_IN", seat: 0, count: 3 });
    expect(moved.state.phase).toBe("draft");
    expect(moved.state.resumePhase).toBe("attack");
    expect(eventTypes(moved.events)).toEqual(["troopsMoved", "phaseChanged"]);
  });

  it("R27 — the bonus troops go into troopsToPlace and END_PHASE returns to attack with the flags intact", () => {
    const victimHand = [inf("v1"), inf("v2"), inf("v3"), cav("v4"), cav("v5"), cav("v6")];
    const state = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 1, 2, 2],
      troops: [1, 1, 6, 1, 1, 1],
      phase: "attack",
      hands: { 1: victimHand },
    });
    let s = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 0,
      defenderLosses: 1,
    }).state;
    s = ok(s, mini, { type: "MOVE_IN", seat: 0, count: 3 }).state;
    expect(s.phase).toBe("draft");
    s = ok(s, mini, { type: "TRADE_CARDS", seat: 0, cards: ["v1", "v2", "v3"], bonusTerritory: null }).state;
    expect(s.troopsToPlace).toBe(4);
    expect(s.seats[0]?.cards).toHaveLength(3);
    refused(s, mini, { type: "END_PHASE", seat: 0 }, "mustPlaceAllTroops");
    s = ok(s, mini, { type: "DRAFT", seat: 0, territory: 0, count: 4 }).state;
    const back = ok(s, mini, { type: "END_PHASE", seat: 0 });
    expect(back.state.phase).toBe("attack");
    expect(back.state.resumePhase).toBeNull();
    expect(back.state.conqueredThisTurn).toBe(true);
    expect(back.events).toEqual([{ type: "phaseChanged", from: "draft", to: "attack" }]);
  });

  it("F41 — a seizure with no conquest bounces from the branch that saw it, and holds the turn", () => {
    // Seat 1 already owns nothing, so END_TURN's elimination re-check hands its
    // cards over with no capture and no pending move-in.
    const victimHand = [inf("v1"), inf("v2"), inf("v3"), cav("v4"), cav("v5"), cav("v6")];
    const state = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 0, 2, 2],
      troops: [1, 1, 6, 1, 1, 1],
      phase: "attack",
      hands: { 1: victimHand },
    });
    const { state: after, events } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(eventTypes(events)).toContain("cardsSeized");
    expect(after.seats[0]?.cards).toHaveLength(6);
    // R26 — the trade-down is owed in THIS turn, so the bounce fires and END_TURN
    // does not advance: seat 0 is still the one to move, in draft, with the attack
    // phase waiting on the other side of the forced trade.
    expect(after.phase).toBe("draft");
    expect(after.resumePhase).toBe("attack");
    expect(after.currentIndex).toBe(0);
    expect(after.turn).toBe(state.turn);
    expect(after.round).toBe(state.round);
    expect(legalActions(after, mini, 0)).toEqual(["TRADE_CARDS"]);
    // And the way out works: trade, place the bonus, resume attack, end the turn.
    let s = ok(after, mini, { type: "TRADE_CARDS", seat: 0, cards: ["v1", "v2", "v3"], bonusTerritory: null }).state;
    expect(s.seats[0]?.cards).toHaveLength(3);
    s = ok(s, mini, { type: "DRAFT", seat: 0, territory: 0, count: s.troopsToPlace }).state;
    s = ok(s, mini, { type: "END_PHASE", seat: 0 }).state;
    expect(s.phase).toBe("attack");
    s = ok(s, mini, { type: "END_TURN", seat: 0 }).state;
    expect(s.currentIndex).toBe(2); // seat 1 is out, so the wrap skips it (R81)
  });

  /*
   * Codex round 2, finding 2 — the whole F41 sequence from a hand that only an
   * elimination can produce. The bounce lives behind MOVE_IN, so MOVE_IN has to be
   * exempt from R28's seven-or-more guard or the seat has no legal action at all.
   */
  describe("F41 — a seizure past six with a conquest pending is never a dead end", () => {
    /** Seat 0 attacks seat 1's last territory from territory 2 and wipes it out. */
    function seize(mine: readonly Card[], theirs: readonly Card[]): GameState {
      const state = buildState(mini, {
        seats: 3,
        owners: [0, 0, 0, 1, 2, 2],
        troops: [1, 1, 6, 1, 1, 1],
        phase: "attack",
        hands: { 0: mine, 1: theirs },
      });
      const { state: after, events } = ok(state, mini, {
        type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1,
      });
      expect(eventTypes(events)).toContain("cardsSeized");
      expect(after.phase).toBe("attack");
      expect(after.pendingMoveIn).not.toBeNull();
      return after;
    }

    it("4 + 4 = 8 — MOVE_IN is offered AND accepted, and the floor of four forces 8 -> 5 -> 2", () => {
      const seized = seize(
        [inf("a1"), inf("a2"), inf("a3"), cav("a4")],
        [cav("v1"), cav("v2"), art("v3"), art("v4")],
      );
      expect(seized.seats[0]?.cards).toHaveLength(8);
      // `legalActions` and `validate` have to agree: this used to offer MOVE_IN and refuse it.
      expect(legalActions(seized, mini, 0)).toEqual(["MOVE_IN"]);
      const moved = ok(seized, mini, { type: "MOVE_IN", seat: 0, count: 3 }).state;
      expect(moved.phase).toBe("draft");
      expect(moved.resumePhase).toBe("attack");

      expect(legalActions(moved, mini, 0)).toEqual(["TRADE_CARDS"]);
      const once = ok(moved, mini, {
        type: "TRADE_CARDS", seat: 0, cards: ["a1", "a2", "a3"], bonusTerritory: null,
      }).state;
      expect(once.seats[0]?.cards).toHaveLength(5);
      // R26's floor is four, so five is still above it and the trade-down keeps forcing.
      expect(legalActions(once, mini, 0)).toEqual(["TRADE_CARDS"]);
      const twice = ok(once, mini, {
        type: "TRADE_CARDS", seat: 0, cards: ["a4", "v1", "v2"], bonusTerritory: null,
      }).state;
      expect(twice.seats[0]?.cards).toHaveLength(2);
      expect(twice.setsTradedThisTurn).toBe(2);

      // R27 — both bonuses are in troopsToPlace, and END_PHASE returns play to attack.
      let s = ok(twice, mini, { type: "DRAFT", seat: 0, territory: 0, count: twice.troopsToPlace }).state;
      s = ok(s, mini, { type: "END_PHASE", seat: 0 }).state;
      expect(s.phase).toBe("attack");
      expect(s.resumePhase).toBeNull();
      expect(s.conqueredThisTurn).toBe(true);
    });

    it("3 + 4 = 7 — one trade reaches the floor of four and nothing more is forced", () => {
      const seized = seize(
        [inf("a1"), inf("a2"), cav("a3")],
        [inf("v1"), cav("v2"), cav("v3"), art("v4")],
      );
      expect(seized.seats[0]?.cards).toHaveLength(7);
      expect(legalActions(seized, mini, 0)).toEqual(["MOVE_IN"]);
      const moved = ok(seized, mini, { type: "MOVE_IN", seat: 0, count: 4 }).state;
      expect(moved.phase).toBe("draft");
      expect(legalActions(moved, mini, 0)).toEqual(["TRADE_CARDS"]);
      const once = ok(moved, mini, {
        type: "TRADE_CARDS", seat: 0, cards: ["a1", "a2", "v1"], bonusTerritory: null,
      }).state;
      expect(once.seats[0]?.cards).toHaveLength(4);
      // Four is the floor: the optional second trade is offered, never forced.
      expect(legalActions(once, mini, 0)).toContain("DRAFT");
      expect(legalActions(once, mini, 0)).toContain("TRADE_CARDS");
    });
  });

  it("R26 — an inheritance that leaves the hand UNDER six waits for the next turn, even after a trade", () => {
    /*
     * Codex round 2, finding 9: the mid-trade-down predicate must stay keyed on R27's bounce and
     * not be re-derived from the hand size. Seat 0 opens with five and a set (R24 forces the
     * trade), comes down to two, then eliminates a seat holding three and is back at five —
     * `hand.length + 3 * setsTradedThisTurn = 8`, yet it has never held six and R26 explicitly
     * defers this hand to its next turn.
     */
    const state = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 1, 2, 2],
      troops: [1, 1, 6, 1, 1, 1],
      phase: "draft",
      troopsToPlace: 3,
      hands: {
        0: [inf("a1"), inf("a2"), inf("a3"), cav("a4"), art("a5")],
        1: [cav("v1"), cav("v2"), art("v3")],
      },
    });
    expect(legalActions(state, mini, 0)).toEqual(["TRADE_CARDS"]);
    let s = ok(state, mini, { type: "TRADE_CARDS", seat: 0, cards: ["a1", "a2", "a3"], bonusTerritory: null }).state;
    expect(s.seats[0]?.cards).toHaveLength(2);
    s = ok(s, mini, { type: "DRAFT", seat: 0, territory: 0, count: s.troopsToPlace }).state;
    s = ok(s, mini, { type: "END_PHASE", seat: 0 }).state;
    s = ok(s, mini, {
      type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1,
    }).state;
    s = ok(s, mini, { type: "MOVE_IN", seat: 0, count: 3 }).state;

    expect(s.seats[0]?.cards).toHaveLength(5);
    expect(s.setsTradedThisTurn).toBe(1);
    // No bounce, so no trade-down is owed: play simply carries on in attack.
    expect(s.phase).toBe("attack");
    expect(s.resumePhase).toBeNull();
    expect(legalActions(s, mini, 0)).toContain("END_TURN");
    expect(ok(s, mini, { type: "END_TURN", seat: 0 }).state.currentIndex).toBe(2);
  });

  it("R28/F51 — a seven-card hand returns illegalAction rather than throwing", () => {
    const seven = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e"), cav("f"), art("g")];
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "draft",
      troopsToPlace: 3,
      hands: { 0: seven },
    });
    refused(state, mini, { type: "DRAFT", seat: 0, territory: 0, count: 1 }, "illegalAction");
    refused(state, mini, { type: "END_PHASE", seat: 0 }, "illegalAction");
    refused(state, mini, { type: "END_TURN", seat: 0 }, "illegalAction");
    // The one way out is the forced trade-down.
    const traded = ok(state, mini, {
      type: "TRADE_CARDS",
      seat: 0,
      cards: ["a", "b", "c"],
      bonusTerritory: null,
    });
    expect(traded.state.seats[0]?.cards).toHaveLength(4);
  });

  it("R28 — eliminating a seat transfers its whole hand", () => {
    const victimHand = [inf("v1"), cav("v2")];
    const state = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 1, 2, 2],
      troops: [1, 1, 4, 1, 1, 1],
      phase: "attack",
      hands: { 0: [art("m1")], 1: victimHand },
    });
    const { state: after, events } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 0,
      defenderLosses: 1,
    });
    expect(after.seats[0]?.cards.map((c) => c.id)).toEqual(["m1", "v1", "v2"]);
    expect(after.seats[0]?.cardCount).toBe(3);
    expect(after.seats[1]?.cards).toEqual([]);
    expect(after.seats[1]?.cardCount).toBe(0);
    expect(after.seats[1]?.standing).toBe("eliminated");
    expect(events).toContainEqual({ type: "cardsSeized", seat: 0, from: 1, count: 2 });
    expect(events).toContainEqual({ type: "playerEliminated", seat: 1, by: 0 });
  });
});

describe("R19/R20 — the end-of-turn card", () => {
  function conqueredState(hand: readonly Card[] = []) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "fortify",
      hands: { 0: hand },
      conqueredThisTurn: true,
    });
  }

  it("R20 — exactly one card for a turn in which something was captured", () => {
    const { state, events } = ok(conqueredState(), mini, {
      type: "CARD_DRAWN",
      seat: 0,
      card: territoryCard(mini, 0),
    });
    expect(state.seats[0]?.cards).toHaveLength(1);
    expect(state.conqueredThisTurn).toBe(false);
    expect(events).toEqual([{ type: "cardAwarded", seat: 0, card: territoryCard(mini, 0) }]);
    refused(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 1) }, "illegalAction");
  });

  it("R20 — no capture, no card", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], phase: "fortify" });
    refused(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 0) }, "illegalAction");
  });

  it("R20/R67 — the award belongs to the end of the turn, not to the attack phase", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "attack",
      conqueredThisTurn: true,
    });
    refused(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 0) }, "wrongPhase");
  });

  it("R20 — exactly one card per capturing turn, even if another capture follows", () => {
    const state = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 1, 2, 2],
      phase: "fortify",
      conqueredThisTurn: true,
    });
    const after = ok(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 0) }).state;
    expect(after.conqueredThisTurn).toBe(false);
    // And there is no way back to attack from fortify (R67), so no second
    // capture can re-arm the flag inside this turn.
    refused(after, mini, { type: "END_PHASE", seat: 0 }, "wrongPhase");
  });

  it("R19 — a card already held or discarded is not in the deck", () => {
    const state = conqueredState([territoryCard(mini, 0)]);
    refused(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 0) }, "illegalAction");
  });

  it("R19 — when the pool is empty the discard is the pool, and the draw leaves it", () => {
    const deck = [0, 1, 2, 3, 4, 5].map((i) => territoryCard(mini, i));
    const wilds = [card("wild-1", "wild", null), card("wild-2", "wild", null)];
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "fortify",
      conqueredThisTurn: true,
      discard: [...deck, ...wilds],
    });
    const { state: after } = ok(state, mini, { type: "CARD_DRAWN", seat: 0, card: deck[2] as Card });
    expect(after.discard).toHaveLength(7);
    expect(after.discard.map((c) => c.id)).not.toContain("l3");
    expect(after.seats[0]?.cards.map((c) => c.id)).toEqual(["l3"]);
  });

  it("R28 — a draw that would make seven cards is refused", () => {
    const six = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e"), cav("f")];
    const state = conqueredState(six);
    refused(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 0) }, "illegalAction");
  });

  /*
   * Codex round 3, finding 1 — the award to SIX, which `validateCardDrawn` admits (the guard is at
   * five going in) and R25 says forces nothing until the seat's next turn.
   *
   * Read as an R26 inheritance, that hand was a dead end with no legal action at all: `END_TURN`
   * refused with `mustTradeCards`, `END_PHASE` is illegal out of fortify (R67), `TRADE_CARDS` is
   * draft-only (R24, R27) — and `legalActions` went on advertising `END_TURN`, so the two
   * disagreed as well.
   */
  describe("R25 — the reward draw's sixth card is not an inheritance", () => {
    /** Five cards holding a set (three infantry), so the hand of six is tradeable. */
    const five = [inf("a1"), inf("a2"), inf("a3"), cav("a4"), art("a5")];

    function awarded(): GameState {
      const state = buildState(mini, {
        seats: 3,
        owners: [0, 0, 0, 1, 2, 2],
        phase: "fortify",
        hands: { 0: five },
        conqueredThisTurn: true,
      });
      const after = ok(state, mini, { type: "CARD_DRAWN", seat: 0, card: territoryCard(mini, 4) }).state;
      expect(after.seats[0]?.cards).toHaveLength(6);
      expect(after.resumePhase).toBeNull();
      return after;
    }

    it("END_TURN is legal, and `legalActions` agrees with `validate`", () => {
      const state = awarded();
      const offered = legalActions(state, mini, 0);
      expect(offered).toContain("END_TURN");
      // Every kind on offer is an action the rules actually accept — the agreement that broke.
      for (const kind of offered) {
        if (kind === "END_TURN") expect(validate(state, mini, { type: "END_TURN", seat: 0 })).toBeNull();
        if (kind === "CARD_DRAWN") throw new Error("the award was already taken");
      }
      const after = ok(state, mini, { type: "END_TURN", seat: 0 }).state;
      // The turn really advances: no bounce, no held turn, the next seat is up.
      expect(after.currentIndex).toBe(1);
      expect(after.turn).toBe(state.turn + 1);
      expect(after.resumePhase).toBeNull();
      expect(after.seats[0]?.cards).toHaveLength(6);
    });

    it("and R24 forces the trade when that seat's next turn opens", () => {
      let s = awarded();
      s = ok(s, mini, { type: "END_TURN", seat: 0 }).state;
      // Round the table back to seat 0.
      while (s.turnOrder[s.currentIndex] !== 0) s = playTurn(s, mini);
      expect(s.phase).toBe("draft");
      expect(s.seats[0]?.cards).toHaveLength(6);
      expect(legalActions(s, mini, 0)).toEqual(["TRADE_CARDS"]);
      refused(s, mini, { type: "DRAFT", seat: 0, territory: 0, count: 1 }, "mustTradeCards");
      refused(s, mini, { type: "END_PHASE", seat: 0 }, "mustTradeCards");
      const traded = ok(s, mini, {
        type: "TRADE_CARDS", seat: 0, cards: ["a1", "a2", "a3"], bonusTerritory: null,
      }).state;
      expect(traded.seats[0]?.cards).toHaveLength(3);
    });

    it("but a seizure in the SAME END_TURN still bounces (R26, R81)", () => {
      /*
       * The scoping is "the sweep grew the hand", not "the hand is six": seat 1 owns nothing, so
       * R81's re-check hands its cards over inside this very `END_TURN` and the trade-down is owed
       * immediately — which is the round-2 finding-10 behaviour, kept.
       */
      const state = buildState(mini, {
        seats: 3,
        owners: [0, 0, 0, 0, 2, 2],
        troops: [1, 1, 6, 1, 1, 1],
        phase: "fortify",
        hands: { 0: [inf("m1"), cav("m2"), art("m3")], 1: [inf("v1"), cav("v2"), art("v3")] },
      });
      const after = ok(state, mini, { type: "END_TURN", seat: 0 }).state;
      expect(after.seats[0]?.cards).toHaveLength(6);
      expect(after.phase).toBe("draft");
      expect(after.resumePhase).toBe("fortify");
      expect(after.currentIndex).toBe(0);
      expect(legalActions(after, mini, 0)).toEqual(["TRADE_CARDS"]);
    });
  });
});

/* ------------------------------------------------------------------ attack -- */

describe("R29–R33 — attacking", () => {
  function attackState(overrides: Parameters<typeof buildState>[1] = {}) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, 5, 3, 1, 1],
      phase: "attack",
      ...overrides,
    });
  }

  it("R29 — an attack runs from an owned territory into a directly adjacent enemy", () => {
    const { state, events } = ok(attackState(), mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "manual",
      attackerDice: [6, 5, 4],
      defenderDice: [3, 2],
    });
    expect(state.territories[3]?.troops).toBe(1);
    expect(state.territories[2]?.troops).toBe(5);
    expect(eventTypes(events)).toEqual(["diceRolled", "battleResolved"]);
  });

  it("R29/R69 — a non-adjacent target is refused", () => {
    refused(
      attackState({ troops: [1, 1, 5, 3, 1, 1] }),
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 4, mode: "blitz", attackerLosses: 0, defenderLosses: 1 },
      "notAdjacent",
    );
  });

  it("R29 — attacking your own territory is refused", () => {
    refused(
      attackState(),
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 1, mode: "blitz", attackerLosses: 0, defenderLosses: 1 },
      "notOwned",
    );
  });

  it("R29 — attacking out of someone else's territory is refused", () => {
    refused(
      attackState(),
      mini,
      { type: "ATTACK", seat: 0, from: 3, to: 2, mode: "blitz", attackerLosses: 0, defenderLosses: 1 },
      "notOwned",
    );
  });

  it("R33 — one troop cannot attack", () => {
    refused(
      attackState({ troops: [1, 1, 1, 3, 1, 1] }),
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1 },
      "tooFewTroops",
    );
  });

  it("R33 — two troops roll at most one die", () => {
    const state = attackState({ troops: [1, 1, 2, 3, 1, 1] });
    refused(
      state,
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "manual", attackerDice: [6, 5], defenderDice: [1, 1] },
      "diceCount",
    );
    const { state: after } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "manual",
      attackerDice: [6],
      defenderDice: [1, 1],
    });
    expect(after.territories[3]?.troops).toBe(2);
  });

  it("R33 — a defender with one troop rolls one die", () => {
    const state = attackState({ troops: [1, 1, 5, 1, 1, 1] });
    refused(
      state,
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "manual", attackerDice: [6], defenderDice: [1, 1] },
      "diceCount",
    );
    ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "manual",
      attackerDice: [6],
      defenderDice: [1],
    });
  });

  it("R31 — ties go to the defender", () => {
    const { state } = ok(attackState(), mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "manual",
      attackerDice: [4, 4],
      defenderDice: [4, 4],
    });
    expect(state.territories[2]?.troops).toBe(3);
    expect(state.territories[3]?.troops).toBe(3);
  });

  it("R32 — the attacker loses at most two armies in a standard roll", () => {
    const { state } = ok(attackState(), mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "manual",
      attackerDice: [1, 1, 1],
      defenderDice: [6, 6],
    });
    expect(state.territories[2]?.troops).toBe(3);
  });

  it("a die outside 1..6 is refused", () => {
    refused(
      attackState(),
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "manual", attackerDice: [7], defenderDice: [1, 1] },
      "diceCount",
    );
    refused(
      attackState(),
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "manual", attackerDice: [0], defenderDice: [1, 1] },
      "diceCount",
    );
  });

  it("R74 — a blizzard is never an attack target", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, SEAT_NONE, 1, 1],
      troops: [1, 1, 5, 0, 1, 1],
      blizzards: [3],
      phase: "attack",
    });
    refused(
      state,
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1 },
      "blizzard",
    );
  });

  it("R68 — an active portal is an attack edge", () => {
    const state = attackState({
      troops: [1, 1, 5, 3, 4, 1],
      portals: [{ a: 2, b: 5, kind: "stable", activeFrom: 0 }],
    });
    const { state: after } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 5,
      mode: "blitz",
      attackerLosses: 1,
      defenderLosses: 1,
    });
    expect(after.territories[5]?.owner).toBe(0);
  });

  it("R46/R58 — a Blitz carries losses, not dice, and emits no diceRolled", () => {
    const { events } = ok(attackState(), mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 2,
      defenderLosses: 2,
    });
    expect(eventTypes(events)).toEqual(["battleResolved"]);
  });

  it("R48 — a stopUntil Blitz reports an unresolved battle", () => {
    const { events } = ok(attackState({ troops: [1, 1, 9, 9, 1, 1] }), mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 5,
      defenderLosses: 4,
      stopUntil: 4,
    });
    expect(events[0]).toMatchObject({ type: "battleResolved", unresolved: true, conquered: false });
  });

  it("R48 — a stopUntil that commits nothing is refused", () => {
    refused(
      attackState({ troops: [1, 1, 5, 3, 1, 1] }),
      mini,
      {
        type: "ATTACK",
        seat: 0,
        from: 2,
        to: 3,
        mode: "blitz",
        attackerLosses: 0,
        defenderLosses: 1,
        stopUntil: 5,
      },
      "tooFewTroops",
    );
  });

  it("a Blitz that loses more than the garrison allows is refused", () => {
    refused(
      attackState({ troops: [1, 1, 5, 3, 1, 1] }),
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 5, defenderLosses: 0 },
      "tooManyTroops",
    );
  });

  it("R89 — troop conservation across a battle", () => {
    const state = attackState({ troops: [1, 1, 8, 6, 1, 1] });
    const before = state.territories.reduce((n, t) => n + t.troops, 0);
    const { state: after } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 3,
      defenderLosses: 4,
    });
    const afterTotal = after.territories.reduce((n, t) => n + t.troops, 0);
    expect(before - afterTotal).toBe(7);
  });
});

/* -------------------------------------------------------- conquest + move -- */

describe("R62–R65 — the post-conquest move", () => {
  function conquest(fromTroops: number, dice: readonly number[]) {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, fromTroops, 1, 1, 1],
      phase: "attack",
    });
    return ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "manual",
      attackerDice: [...dice],
      defenderDice: [1],
    });
  }

  it("R62 — the territory changes hands with zero troops, pending occupation", () => {
    const { state, events } = conquest(5, [6]);
    expect(state.territories[3]).toEqual({ owner: 0, troops: 0, blizzard: false });
    expect(state.pendingMoveIn).toEqual({ from: 2, to: 3, min: 1, max: 4 });
    // Seat 1 held the right-hand continent outright; the capture breaks it.
    expect(eventTypes(events)).toEqual([
      "diceRolled",
      "battleResolved",
      "territoryCaptured",
      "continentBroken",
    ]);
  });

  it("R63 — the minimum is the dice used in the conquering roll", () => {
    expect(conquest(5, [6]).state.pendingMoveIn?.min).toBe(1);
    expect(conquest(5, [6, 5]).state.pendingMoveIn?.min).toBe(2);
    expect(conquest(5, [6, 5, 4]).state.pendingMoveIn?.min).toBe(3);
  });

  it("R63 — the maximum is sourceTroops - 1, so an army always stays behind", () => {
    expect(conquest(9, [6, 5, 4]).state.pendingMoveIn?.max).toBe(8);
    expect(conquest(2, [6]).state.pendingMoveIn).toEqual({ from: 2, to: 3, min: 1, max: 1 });
  });

  it("R46/R63 — a Blitz at three or more troops means a minimum of three", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, 9, 2, 1, 1],
      phase: "attack",
    });
    const { state: after } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 1,
      defenderLosses: 2,
    });
    expect(after.pendingMoveIn).toEqual({ from: 2, to: 3, min: 3, max: 7 });
  });

  it("R63 — a count outside the range is refused", () => {
    const { state } = conquest(5, [6, 5]);
    refused(state, mini, { type: "MOVE_IN", seat: 0, count: 1 }, "moveInRange");
    refused(state, mini, { type: "MOVE_IN", seat: 0, count: 5 }, "moveInRange");
  });

  it("R63 — further attacks, END_PHASE and END_TURN are blocked while a move is pending", () => {
    const { state } = conquest(5, [6]);
    refused(
      state,
      mini,
      { type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1 },
      "moveInPending",
    );
    refused(state, mini, { type: "END_PHASE", seat: 0 }, "moveInPending");
    refused(state, mini, { type: "END_TURN", seat: 0 }, "moveInPending");
    expect(legalActions(state, mini, 0)).toEqual(["MOVE_IN"]);
  });

  it("R65 — MOVE_IN only redistributes troops", () => {
    const { state } = conquest(5, [6]);
    const { state: after, events } = ok(state, mini, { type: "MOVE_IN", seat: 0, count: 3 });
    expect(after.territories[2]?.troops).toBe(2);
    expect(after.territories[3]?.troops).toBe(3);
    expect(after.pendingMoveIn).toBeNull();
    expect(events).toEqual([{ type: "troopsMoved", from: 2, to: 3, count: 3 }]);
  });

  it("R64 — Move All is the maximum of the same range, not a separate action", () => {
    const { state } = conquest(9, [6]);
    const max = state.pendingMoveIn?.max ?? 0;
    const { state: after } = ok(state, mini, { type: "MOVE_IN", seat: 0, count: max });
    expect(after.territories[2]?.troops).toBe(1);
    expect(after.territories[3]?.troops).toBe(8);
  });

  it("R65 — the win check runs on the capture, not on the move", () => {
    const state = buildState(tiny4, {
      seats: 2,
      owners: [0, 0, 0, 1],
      troops: [1, 1, 5, 1],
      phase: "attack",
    });
    const { state: after, events } = ok(state, tiny4, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 0,
      defenderLosses: 1,
    });
    expect(after.outcome).toMatchObject({ winner: 0, reason: "world" });
    expect(eventTypes(events)).toContain("gameOver");
    expect(after.phase).toBe("over");
  });

  it("MOVE_IN with nothing pending is refused", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], phase: "attack" });
    refused(state, mini, { type: "MOVE_IN", seat: 0, count: 1 }, "illegalAction");
  });

  it("emits continentHeld when a capture completes a continent", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 1, 1, 1, 1],
      troops: [1, 4, 1, 1, 1, 1],
      phase: "attack",
    });
    const { events } = ok(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 1,
      to: 2,
      mode: "blitz",
      attackerLosses: 0,
      defenderLosses: 1,
    });
    expect(events).toContainEqual({ type: "continentHeld", seat: 0, continent: 0, bonus: 3 });
    // Seat 1 held only one of continent 0's three territories, so nothing broke
    // for it; the diff is per seat, not per continent.
    expect(events).not.toContainEqual({ type: "continentBroken", seat: 1, continent: 0 });
  });
});

/* ----------------------------------------------------------------- fortify -- */

describe("R66–R69 — fortifying", () => {
  function fortifyState(overrides: Parameters<typeof buildState>[1] = {}) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [5, 1, 1, 1, 1, 1],
      phase: "fortify",
      ...overrides,
    });
  }

  it("R66 — one source, one destination, any count up to sourceTroops - 1", () => {
    const { state, events } = ok(fortifyState(), mini, { type: "FORTIFY", seat: 0, from: 0, to: 1, count: 4 });
    expect(state.territories[0]?.troops).toBe(1);
    expect(state.territories[1]?.troops).toBe(5);
    expect(state.fortifyUsed).toBe(true);
    expect(events).toEqual([{ type: "troopsMoved", from: 0, to: 1, count: 4 }]);
  });

  it("R66 — multi-hop through your own territories is legal", () => {
    const state = fortifyState({ owners: [0, 0, 0, 0, 0, 1], troops: [5, 1, 1, 1, 1, 1] });
    const { state: after } = ok(state, mini, { type: "FORTIFY", seat: 0, from: 0, to: 4, count: 3 });
    expect(after.territories[4]?.troops).toBe(4);
  });

  it("R66 — an unreachable destination is refused", () => {
    const state = fortifyState({ owners: [0, 0, 1, 1, 1, 0], troops: [5, 1, 1, 1, 1, 1] });
    refused(state, mini, { type: "FORTIFY", seat: 0, from: 0, to: 5, count: 1 }, "noPath");
  });

  it("R66 — an army must stay behind", () => {
    refused(fortifyState(), mini, { type: "FORTIFY", seat: 0, from: 0, to: 1, count: 5 }, "tooManyTroops");
    refused(
      fortifyState({ troops: [1, 1, 1, 1, 1, 1] }),
      mini,
      { type: "FORTIFY", seat: 0, from: 0, to: 1, count: 1 },
      "tooFewTroops",
    );
  });

  it("R66 — one move per turn", () => {
    const after = ok(fortifyState(), mini, { type: "FORTIFY", seat: 0, from: 0, to: 1, count: 2 }).state;
    refused(after, mini, { type: "FORTIFY", seat: 0, from: 0, to: 1, count: 1 }, "fortifyUsed");
  });

  it("R66 — both endpoints must be yours", () => {
    refused(fortifyState(), mini, { type: "FORTIFY", seat: 0, from: 0, to: 3, count: 1 }, "notOwned");
    refused(fortifyState(), mini, { type: "FORTIFY", seat: 0, from: 3, to: 0, count: 1 }, "notOwned");
  });

  it("R74 — a blizzard is never a fortify endpoint or a path node", () => {
    const state = fortifyState({
      owners: [0, 0, SEAT_NONE, 0, 0, 1],
      troops: [5, 1, 0, 1, 1, 1],
      blizzards: [2],
    });
    refused(state, mini, { type: "FORTIFY", seat: 0, from: 0, to: 2, count: 1 }, "blizzard");
    refused(state, mini, { type: "FORTIFY", seat: 0, from: 0, to: 3, count: 1 }, "noPath");
  });

  it("R68 — an active portal is a fortify edge", () => {
    const state = fortifyState({
      owners: [0, 0, SEAT_NONE, 0, 0, 1],
      troops: [5, 1, 0, 1, 1, 1],
      blizzards: [2],
      portals: [{ a: 0, b: 3, kind: "stable", activeFrom: 0 }],
    });
    const { state: after } = ok(state, mini, { type: "FORTIFY", seat: 0, from: 0, to: 3, count: 2 });
    expect(after.territories[3]?.troops).toBe(3);
  });

  it("R67 — END_PHASE is not legal out of fortify", () => {
    refused(fortifyState(), mini, { type: "END_PHASE", seat: 0 }, "wrongPhase");
  });

  it("R67 — the phase exits only via END_TURN", () => {
    const { state } = ok(fortifyState(), mini, { type: "END_TURN", seat: 0 });
    expect(state.phase).toBe("draft");
    expect(state.turnOrder[state.currentIndex]).toBe(1);
  });

  it("R67 — fortify is optional", () => {
    const state = fortifyState();
    expect(state.fortifyUsed).toBe(false);
    const { state: after } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(after.fortifyUsed).toBe(false);
  });
});

/* ------------------------------------------------------------------- turns -- */

describe("END_TURN and the turn pipeline", () => {
  function turnState(overrides: Parameters<typeof buildState>[1] = {}) {
    return buildState(mini, {
      seats: 3,
      owners: [0, 0, 1, 1, 2, 2],
      troops: [2, 2, 2, 2, 2, 2],
      phase: "fortify",
      ...overrides,
    });
  }

  it("advances to the next seat, bumps the turn counter and pays the new seat", () => {
    const { state, events } = ok(turnState(), mini, { type: "END_TURN", seat: 0 });
    expect(state.turnOrder[state.currentIndex]).toBe(1);
    expect(state.turn).toBe(2);
    expect(state.round).toBe(1);
    expect(state.phase).toBe("draft");
    expect(state.troopsToPlace).toBe(3);
    expect(eventTypes(events)).toEqual(["phaseChanged", "turnStarted", "troopsAwarded"]);
  });

  it("resets every per-turn flag", () => {
    const state = turnState({
      conqueredThisTurn: true,
      fortifyUsed: true,
      setsTradedThisTurn: 2,
      territoryBonusLeft: 0,
    });
    const { state: after } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(after.conqueredThisTurn).toBe(false);
    expect(after.fortifyUsed).toBe(false);
    expect(after.setsTradedThisTurn).toBe(0);
    expect(after.territoryBonusLeft).toBe(2);
    expect(after.resumePhase).toBeNull();
  });

  it("keeps setsTradedTotal, which drives the Progressive ladder (R22)", () => {
    const { state } = ok(turnState({ setsTradedTotal: 4 }), mini, { type: "END_TURN", seat: 0 });
    expect(state.setsTradedTotal).toBe(4);
  });

  it("increments the round only when the turn order wraps", () => {
    let s = turnState();
    s = ok(s, mini, { type: "END_TURN", seat: 0 }).state;
    expect(s.round).toBe(1);
    s = playTurn(s, mini);
    expect(s.round).toBe(1);
    expect(s.turnOrder[s.currentIndex]).toBe(2);
    s = playTurn(s, mini);
    expect(s.round).toBe(2);
    expect(s.turnOrder[s.currentIndex]).toBe(0);
    expect(s.turn).toBe(4);
  });

  it("R81 — skips an eliminated seat", () => {
    const state = turnState({ standings: { 1: "eliminated" }, owners: [0, 0, 2, 2, 2, 2] });
    const { state: after } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(after.turnOrder[after.currentIndex]).toBe(2);
  });

  it("D76 — still visits a resigned seat, which a bot now plays", () => {
    const state = turnState({ standings: { 1: "resigned" } });
    const { state: after } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(after.turnOrder[after.currentIndex]).toBe(1);
  });

  it("R81 — re-checks elimination at END_TURN", () => {
    const state = turnState({ owners: [0, 0, 0, 0, 2, 2] });
    const { state: after, events } = ok(state, mini, { type: "END_TURN", seat: 0 });
    expect(after.seats[1]?.standing).toBe("eliminated");
    expect(events).toContainEqual({ type: "playerEliminated", seat: 1, by: 0 });
  });

  it("R13/D18 — continent ownership is evaluated once, at the owner's turn start", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [2, 2, 2, 2, 2, 2],
      phase: "fortify",
    });
    const { state: after, events } = ok(state, mini, { type: "END_TURN", seat: 0 });
    const awarded = events.find((e) => e.type === "troopsAwarded");
    expect(awarded).toMatchObject({ seat: 1, base: 3, bonus: 2, capitals: 0, total: 5 });
    expect(after.troopsToPlace).toBe(5);
  });

  it("R77 — Max Rounds ends the game the instant END_TURN completes round N", () => {
    let s = turnState({ rules: { maxRounds: 2 } });
    s = ok(s, mini, { type: "END_TURN", seat: 0 }).state;
    s = playTurn(s, mini);
    expect(s.outcome).toBeNull();
    s = playTurn(s, mini); // round 1 complete
    expect(s.round).toBe(2);
    expect(s.outcome).toBeNull();
    s = playTurn(s, mini);
    s = playTurn(s, mini);
    expect(s.outcome).toBeNull();
    s = playTurn(s, mini); // round 2 complete -> the game ends
    expect(s.outcome).toMatchObject({ reason: "maxRounds", round: 2 });
    expect(s.phase).toBe("over");
  });

  it("R77/R78 — the round-N wrap settles the game with a tiebreak outcome", () => {
    const state = turnState({ rules: { maxRounds: 2 }, round: 2, currentIndex: 2, troops: [9, 9, 1, 1, 1, 1] });
    const { state: after, events } = ok(state, mini, { type: "END_TURN", seat: 2 });
    expect(after.outcome).toMatchObject({ reason: "maxRounds", tiebreak: true, winner: 0, round: 2 });
    expect(eventTypes(events)).toContain("gameOver");
  });

  it("R83 — no action is accepted once the game is over", () => {
    const state = turnState({ rules: { maxRounds: 1 }, round: 1, currentIndex: 2 });
    const { state: over } = ok(state, mini, { type: "END_TURN", seat: 2 });
    expect(over.outcome).not.toBeNull();
    refused(over, mini, { type: "END_TURN", seat: 0 }, "gameOver");
    refused(over, mini, { type: "DRAFT", seat: 0, territory: 0, count: 1 }, "gameOver");
    expect(legalActions(over, mini, 0)).toEqual([]);
  });

  /**
   * R27/R67 — `END_TURN` ends a turn from `attack` or `fortify`, never from `draft`
   * (codex round 4, finding 6).
   *
   * The phase list used to deny only `claim` and `over`, so a draft with every troop placed slipped
   * through and the turn ended there — skipping the Attack phase R27 promises every turn — and a
   * hand owing R24's turn-start trade skipped *that* too, `validateEndTurn` reading R26's
   * `mustTradeDown` rather than `mustTradeNow`. `legalActions` never advertised either, so only a
   * crafted client could reach them; the validator is the authority, so it says no.
   */
  it("END_TURN out of draft is refused whatever is still owed (R27, R67)", () => {
    refused(turnState({ phase: "draft", troopsToPlace: 3 }), mini, { type: "END_TURN", seat: 0 }, "wrongPhase");
    refused(turnState({ phase: "draft", troopsToPlace: 0 }), mini, { type: "END_TURN", seat: 0 }, "wrongPhase");
    // A hand owing R24's forced trade at turn start is refused for the same reason.
    const forced = turnState({
      phase: "draft",
      troopsToPlace: 0,
      hands: { 0: [card("f1", "infantry", 0), card("f2", "infantry", 1), card("f3", "infantry", 2),
        card("f4", "cavalry", 0), card("f5", "cavalry", 1)] },
    });
    refused(forced, mini, { type: "END_TURN", seat: 0 }, "wrongPhase");
    // `END_PHASE` is the action that moves a finished draft on, and it is the one offered.
    expect(legalActions(turnState({ phase: "draft", troopsToPlace: 0 }), mini, 0)).toEqual(["END_PHASE"]);
  });

  it("END_TURN in the claim phase is refused", () => {
    const state = turnState({ phase: "claim" });
    refused(state, mini, { type: "END_TURN", seat: 0 }, "wrongPhase");
  });

  it("refuses an action from the wrong seat", () => {
    refused(turnState(), mini, { type: "END_TURN", seat: 1 }, "notYourTurn");
    refused(turnState(), mini, { type: "FORTIFY", seat: 2, from: 4, to: 5, count: 1 }, "notYourTurn");
  });

  it("refuses an action from an eliminated seat", () => {
    const state = turnState({ standings: { 0: "eliminated" } });
    refused(state, mini, { type: "END_TURN", seat: 0 }, "notYourTurn");
  });

  it("refuses an action naming no seat at all", () => {
    refused(turnState(), mini, { type: "END_TURN", seat: 99 }, "illegalAction");
  });
});

/* -------------------------------------------------------------- modifiers -- */

describe("R75–R82 — the modifier actions", () => {
  it("R76 — PORTALS_MOVED replaces the portal set", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { portals: "unstable" },
      portals: [{ a: 0, b: 4, kind: "unstable", activeFrom: 0 }],
      round: 3,
    });
    const portals = [{ a: 1, b: 5, kind: "unstable" as const, activeFrom: 4 }];
    const { state: after, events } = ok(state, mini, { type: "PORTALS_MOVED", seat: 0, portals });
    expect(after.portals).toEqual(portals);
    expect(events).toEqual([{ type: "portalsMoved", portals }]);
  });

  it("R75 — a stable-portal game refuses PORTALS_MOVED", () => {
    const state = buildState(mini, { seats: 2, rules: { portals: "stable" } });
    refused(state, mini, { type: "PORTALS_MOVED", seat: 0, portals: [] }, "illegalAction");
  });

  it("R11 — no territory sits in two portals", () => {
    const state = buildState(mini, { seats: 2, rules: { portals: "unstable" } });
    refused(
      state,
      mini,
      {
        type: "PORTALS_MOVED",
        seat: 0,
        portals: [
          { a: 0, b: 4, kind: "unstable", activeFrom: 1 },
          { a: 0, b: 5, kind: "unstable", activeFrom: 1 },
        ],
      },
      "illegalAction",
    );
  });

  it("R82/D76 — SEAT_TO_BOT with reason resigned records the standing and keeps the holdings", () => {
    const state = buildState(mini, { seats: 3, owners: [0, 0, 1, 1, 2, 2] });
    const { state: after, events } = ok(state, mini, {
      type: "SEAT_TO_BOT",
      seat: 1,
      reason: "resigned",
      tier: "hard",
      persona: persona("assassin"),
    });
    expect(after.seats[1]?.kind).toBe("bot");
    expect(after.seats[1]?.standing).toBe("resigned");
    expect(after.seats[1]?.persona?.name).toBe("assassin");
    expect(after.territories[2]?.owner).toBe(1);
    expect(events).toContainEqual({ type: "seatToBot", seat: 1, reason: "resigned" });
  });

  it("D62 — an away takeover leaves the seat active", () => {
    const state = buildState(mini, { seats: 3, standings: { 1: "away" } });
    const { state: after } = ok(state, mini, {
      type: "SEAT_TO_BOT",
      seat: 1,
      reason: "away",
      tier: "easy",
      persona: persona(),
    });
    expect(after.seats[1]?.standing).toBe("active");
    expect(after.seats[1]?.missedTurns).toBe(0);
  });

  it("R82 — a resigned seat cannot be reclaimed", () => {
    const state = buildState(mini, { seats: 3, standings: { 1: "resigned" } });
    refused(state, mini, { type: "SEAT_TO_HUMAN", seat: 1 }, "illegalAction");
    refused(
      state,
      mini,
      { type: "SEAT_TO_BOT", seat: 1, reason: "away", tier: "easy", persona: persona() },
      "illegalAction",
    );
  });

  it("D62 — SEAT_TO_HUMAN flips an away bot back and resets the missed count", () => {
    const state = buildState(mini, { seats: 3, kinds: { 1: "bot" }, standings: { 1: "away" } });
    const { state: after, events } = ok(state, mini, { type: "SEAT_TO_HUMAN", seat: 1 });
    expect(after.seats[1]?.kind).toBe("human");
    expect(after.seats[1]?.standing).toBe("active");
    expect(events).toEqual([{ type: "seatToHuman", seat: 1 }]);
  });

  it("R81 — an eliminated seat is neither taken over nor reclaimed", () => {
    const state = buildState(mini, { seats: 3, standings: { 1: "eliminated" } });
    refused(state, mini, { type: "SEAT_TO_HUMAN", seat: 1 }, "illegalAction");
  });

  it("D76 — a 2-seat resignation hands the game to the other seat", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1] });
    const { state: after } = ok(state, mini, {
      type: "SEAT_TO_BOT",
      seat: 1,
      reason: "resigned",
      tier: "medium",
      persona: persona(),
    });
    expect(after.outcome).toMatchObject({ winner: 0, reason: "lastStanding" });
  });
});

describe("R80 — alliances", () => {
  function allianceState(on = true) {
    return buildState(mini, { seats: 3, owners: [0, 0, 1, 1, 2, 2], rules: { alliances: on } });
  }

  it("is refused outright when the toggle is off", () => {
    refused(allianceState(false), mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 }, "notAlliable");
  });

  it("a proposal forms no pact, but is recorded so a repeat can be refused", () => {
    const state = allianceState();
    const { state: after, events } = ok(state, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 });
    expect(after.seats[0]?.allies).toEqual([]);
    expect(after.pendingAlliances).toEqual([[0, 1]]);
    expect(events).toEqual([{ type: "allianceChanged", a: 0, b: 1, state: "proposed" }]);
  });

  /*
   * Codex round 3, finding 4 — the three alliance actions are the only ones exempt from the online
   * turn fence, so an accepted repeat was a log row a seated player could mint on demand: every one
   * bumped `games.seq` and killed the poll's `204` fast path.
   */
  describe("one offer at a time per pair", () => {
    const propose = (seat: number, to: number) => ({ type: "ALLIANCE_PROPOSE", seat, to }) as const;

    it("refuses the same proposal while it is still on the table", () => {
      const once = ok(allianceState(), mini, propose(0, 1)).state;
      refused(once, mini, propose(0, 1), "notAlliable");
      // A different target is untouched, and lands beside the first.
      const two = ok(once, mini, propose(0, 2)).state;
      expect(two.pendingAlliances).toEqual([[0, 1], [0, 2]]);
    });

    it("refuses a counter-offer too — the answer to an offer is ALLIANCE_ACCEPT", () => {
      const once = ok(allianceState(), mini, propose(0, 1)).state;
      refused(once, mini, propose(1, 0), "notAlliable");
      const accepted = ok(once, mini, { type: "ALLIANCE_ACCEPT", seat: 1, from: 0 }).state;
      expect(accepted.pendingAlliances).toEqual([]);
      expect(accepted.seats[1]?.allies).toEqual([0]);
    });

    it("is never a permanent lock-out: a break clears the pair and a new offer is allowed", () => {
      let s = ok(allianceState(), mini, propose(0, 1)).state;
      s = ok(s, mini, { type: "ALLIANCE_ACCEPT", seat: 1, from: 0 }).state;
      s = ok(s, mini, { type: "ALLIANCE_BREAK", seat: 0, with: 1 }).state;
      expect(s.pendingAlliances).toEqual([]);
      expect(ok(s, mini, propose(0, 1)).state.pendingAlliances).toEqual([[0, 1]]);
    });

    it("a break answers an unaccepted offer too, in either direction", () => {
      const once = ok(allianceState(), mini, propose(0, 1)).state;
      // Refused as a *break* (no pact exists), so the offer stands — only ACCEPT or an exit clears it.
      refused(once, mini, { type: "ALLIANCE_BREAK", seat: 1, with: 0 }, "notAlliable");
      expect(once.pendingAlliances).toEqual([[0, 1]]);
    });

    it("an elimination takes the eliminated seat's offers with it (R81)", () => {
      const state = buildState(mini, {
        seats: 3,
        owners: [0, 0, 0, 1, 2, 2],
        troops: [1, 1, 4, 1, 1, 1],
        phase: "attack",
        rules: { alliances: true },
      });
      let s = ok(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 2 }).state;
      s = ok(s, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 2 }).state;
      expect(s.pendingAlliances).toEqual([[1, 2], [0, 2]]);
      s = ok(s, mini, {
        type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1,
      }).state;
      expect(s.seats[1]?.standing).toBe("eliminated");
      expect(s.pendingAlliances).toEqual([[0, 2]]);
    });

    it("a resignation does the same (R82)", () => {
      let s = ok(allianceState(), mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 }).state;
      s = ok(s, mini, {
        type: "SEAT_TO_BOT", seat: 1, reason: "resigned", tier: "medium", persona: persona(),
      }).state;
      expect(s.pendingAlliances).toEqual([]);
    });

    it("hashState covers it (R91, D16)", () => {
      const bare = allianceState();
      const offered = ok(bare, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 }).state;
      expect(hashState(offered)).not.toBe(hashState(bare));
      expect(hashState(offered)).toBe(hashState({ ...offered, pendingAlliances: [[0, 1]] }));
      expect(hashState(offered)).not.toBe(hashState({ ...offered, pendingAlliances: [[1, 0]] }));
    });
  });

  /**
   * R80/R81/R82 — leaving the game ends the **pacts** too, not just the offers
   * (codex round 4, finding 4).
   *
   * The reducer used to drop only `pendingAlliances`, so every survivor kept an `allies` entry
   * naming a seat that was out: `legalActions` advertised `ALLIANCE_BREAK` for it and
   * `validateAlliance` refused that same action with `notAlliable` ("both seats must still be
   * playing"), which is a dead entry in the list and a dead button in the UI. R80 says an
   * elimination and a resignation clear the pair, so the pair is cleared at the source, with the
   * `allianceChanged … "broken"` the renderer and the dialog have no other way to learn of.
   */
  describe("leaving the game ends its diplomacy", () => {
    it("an elimination drops the dead seat from every ally list, with an event (R81)", () => {
      const state = buildState(mini, {
        seats: 3,
        owners: [0, 0, 0, 1, 2, 2],
        troops: [1, 1, 4, 1, 1, 1],
        phase: "attack",
        rules: { alliances: true },
      });
      let s = ok(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 2 }).state;
      s = ok(s, mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 1 }).state;
      expect(s.seats[1]?.allies).toEqual([2]);
      expect(s.seats[2]?.allies).toEqual([1]);

      // Seat 0 takes seat 1's last territory.
      const killed = ok(s, mini, {
        type: "ATTACK", seat: 0, from: 2, to: 3, mode: "blitz", attackerLosses: 0, defenderLosses: 1,
      });
      const after = killed.state;
      expect(after.seats[1]?.standing).toBe("eliminated");
      expect(after.seats[1]?.allies).toEqual([]);
      expect(after.seats[2]?.allies).toEqual([]);
      expect(killed.events).toEqual(
        expect.arrayContaining([{ type: "allianceChanged", a: 1, b: 2, state: "broken" }]),
      );
      // And the survivor is no longer offered — nor refused — a break it cannot make.
      expect(legalActions(after, mini, 2)).not.toContain("ALLIANCE_BREAK");
      expect(validate(after, mini, { type: "ALLIANCE_BREAK", seat: 2, with: 1 })?.code).toBe("notAlliable");
    });

    it("a resignation drops its pacts too, with an event (R82)", () => {
      let s = ok(allianceState(), mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 }).state;
      s = ok(s, mini, { type: "ALLIANCE_ACCEPT", seat: 1, from: 0 }).state;
      expect(s.seats[0]?.allies).toEqual([1]);

      const resigned = ok(s, mini, {
        type: "SEAT_TO_BOT", seat: 1, reason: "resigned", tier: "medium", persona: persona(),
      });
      expect(resigned.state.seats[1]?.allies).toEqual([]);
      expect(resigned.state.seats[0]?.allies).toEqual([]);
      expect(resigned.events).toEqual(
        expect.arrayContaining([{ type: "allianceChanged", a: 1, b: 0, state: "broken" }]),
      );
      expect(legalActions(resigned.state, mini, 0)).not.toContain("ALLIANCE_BREAK");
    });

    /** An away or timeout takeover is NOT leaving the game (D76), so it keeps its diplomacy. */
    it("an away takeover keeps the pact (D76)", () => {
      let s = ok(allianceState(), mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 }).state;
      s = ok(s, mini, { type: "ALLIANCE_ACCEPT", seat: 1, from: 0 }).state;
      const away = ok(s, mini, {
        type: "SEAT_TO_BOT", seat: 1, reason: "away", tier: "medium", persona: persona(),
      }).state;
      expect(away.seats[1]?.allies).toEqual([0]);
      expect(away.seats[0]?.allies).toEqual([1]);
      expect(validate(away, mini, { type: "ALLIANCE_BREAK", seat: 0, with: 1 })).toBeNull();
    });
  });

  /** An offer, then its answer — the only sequence R80 admits (codex round 4, finding 2). */
  function offered(from: number, to: number) {
    return ok(allianceState(), mini, { type: "ALLIANCE_PROPOSE", seat: from, to }).state;
  }

  it("an accept records the pact symmetrically, ascending (R91)", () => {
    const state = offered(0, 2);
    const { state: after, events } = ok(state, mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 0 });
    expect(after.seats[2]?.allies).toEqual([0]);
    expect(after.seats[0]?.allies).toEqual([2]);
    expect(events).toEqual([{ type: "allianceChanged", a: 2, b: 0, state: "accepted" }]);
  });

  /**
   * R80 — an `ACCEPT` answers an offer, so one has to be on the table (codex round 4, finding 2).
   *
   * Without this gate a seat could forge a pact nobody offered it, and — the three alliance actions
   * being the only ones exempt from the online turn fence — churn `ACCEPT`/`BREAK` off-turn as fast
   * as it could POST, each one a log row and a `games.seq` bump that cost every other client the
   * poll's `204` fast path.
   */
  it("an accept with no offer on the table is refused", () => {
    refused(allianceState(), mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 0 }, "notAlliable");
  });

  /** The pair is directed: accepting my own proposal is not an answer to it. */
  it("the proposer cannot accept its own offer", () => {
    refused(offered(0, 2), mini, { type: "ALLIANCE_ACCEPT", seat: 0, from: 2 }, "notAlliable");
  });

  it("accepting twice is refused", () => {
    const after = ok(offered(0, 2), mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 0 }).state;
    refused(after, mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 0 }, "notAlliable");
  });

  it("a break removes it from both sides", () => {
    const allied = ok(offered(0, 2), mini, { type: "ALLIANCE_ACCEPT", seat: 2, from: 0 }).state;
    const { state: after, events } = ok(allied, mini, { type: "ALLIANCE_BREAK", seat: 0, with: 2 });
    expect(after.seats[0]?.allies).toEqual([]);
    expect(after.seats[2]?.allies).toEqual([]);
    expect(events).toEqual([{ type: "allianceChanged", a: 0, b: 2, state: "broken" }]);
  });

  it("breaking a pact that does not exist is refused", () => {
    refused(allianceState(), mini, { type: "ALLIANCE_BREAK", seat: 0, with: 1 }, "notAlliable");
  });

  it("R80 — alliances are non-binding: attacking an ally is legal", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, 5, 3, 1, 1],
      phase: "attack",
      rules: { alliances: true },
    });
    const proposed = ok(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 0 }).state;
    const allied = ok(proposed, mini, { type: "ALLIANCE_ACCEPT", seat: 0, from: 1 }).state;
    const { state: after } = ok(allied, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 1,
      defenderLosses: 1,
    });
    expect(after.territories[3]?.troops).toBe(2);
    expect(after.seats[0]?.allies).toEqual([1]);
  });

  it("a seat cannot ally with itself", () => {
    refused(allianceState(), mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 0 }, "notAlliable");
  });

  it("an eliminated seat is not alliable", () => {
    const state = buildState(mini, { seats: 3, rules: { alliances: true }, standings: { 1: "eliminated" } });
    refused(state, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 }, "notAlliable");
  });
});

/* ------------------------------------------------------- reducer invariants -- */

describe("R86–R88 — the reducer invariants", () => {
  const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], troops: [1, 1, 5, 3, 1, 1] });

  it("R86 — an unknown action type returns illegalAction rather than throwing", () => {
    const bogus = { type: "NOT_AN_ACTION", seat: 0 } as unknown as Action;
    const result = apply(state, mini, bogus);
    expect(result.error?.code).toBe("illegalAction");
    expect(result.state).toBe(state);
  });

  it("R86 — nonsense in place of an action returns illegalAction", () => {
    for (const bogus of [null, undefined, 42, "END_TURN", {}, []] as unknown[]) {
      const result = apply(state, mini, bogus as Action);
      expect(result.error?.code).toBe("illegalAction");
    }
  });

  it("R86 — an unknown territory index returns unknownTerritory", () => {
    refused(
      { ...state, phase: "draft", troopsToPlace: 3 },
      mini,
      { type: "DRAFT", seat: 0, territory: 99, count: 1 },
      "unknownTerritory",
    );
  });

  it("R87 — apply never mutates its input", () => {
    const before = JSON.stringify(state);
    apply(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 1,
      defenderLosses: 1,
    });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("R87 — a successful apply returns a fresh state object", () => {
    const result = apply(state, mini, {
      type: "ATTACK",
      seat: 0,
      from: 2,
      to: 3,
      mode: "blitz",
      attackerLosses: 1,
      defenderLosses: 1,
    });
    expect(result.state).not.toBe(state);
    expect(result.state.territories).not.toBe(state.territories);
  });

  it("R86 — a refusal returns the input state by identity with no events", () => {
    const result = apply(state, mini, { type: "DRAFT", seat: 0, territory: 0, count: 1 });
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("R89 — no action creates troops except DRAFT, CLAIM, AUTO_DEPLOY and the trade bonus", () => {
    const total = (s: GameState) => s.territories.reduce((n, t) => n + t.troops, 0);
    const start = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [4, 2, 5, 3, 2, 2],
      phase: "fortify",
    });
    const fortified = ok(start, mini, { type: "FORTIFY", seat: 0, from: 0, to: 1, count: 2 }).state;
    expect(total(fortified)).toBe(total(start));
    const ended = ok(fortified, mini, { type: "END_TURN", seat: 0 }).state;
    expect(total(ended)).toBe(total(start));
  });

  it("R92 — a fresh state carries the ruleset version", () => {
    expect(createInitialState(mini, startedAction(mini, { seats: 3 })).version).toBe(1);
  });
});
