/**
 * `decideTurn` — T5's draw discipline, T8's behaviour claims, the golden plan (D55) and T13's budget.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SEAT_NONE, type GameState, type SeatState, type TerritoryState } from "@/engine";
import { createOdds } from "@/engine/odds";

import { attackCandidates, passesGates, scoreAttack } from "./attack";
import { decideTurn, drawCountFor } from "./index";
import { makeView } from "./view";
import {
  buildMap, card, classicShapedMap, countingRng, crossMap, emptyBoard, fixedRng, makeTestView,
  personaAt, playMatch, smallMap, TEST_RULES,
} from "./testFixtures";

const trueRandom = createOdds("trueRandom");
const balancedBlitz = createOdds("balancedBlitz");

/** A board where seat 0 has a clearly correct attack: a 10-stack onto a 1-troop neighbour. */
function obviousAttack(tier: Parameters<typeof personaAt>[0] = "hard") {
  return makeTestView({
    map: crossMap(),
    persona: personaAt(tier),
    board: [[0, 10], [0, 3], [0, 3], [1, 1], [1, 4], [1, 4]],
  });
}

describe("decideTurn is pure, total, and plans one phase at a time", () => {
  it("plans a claim as a single one-troop placement, and asks to be re-entered", () => {
    const map = smallMap();
    const view = makeTestView({
      map, persona: personaAt("medium"), phase: "claim", board: emptyBoard(map),
    });
    const plan = decideTurn(view, trueRandom, countingRng(1));
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0]?.count).toBe(1);
    expect(plan.done).toBe(false);
    expect(plan.attacks).toEqual([]);
  });

  it("places every drafted troop, and exactly once", () => {
    for (const tier of ["beginner", "easy", "medium", "hard", "expert"] as const) {
      for (const count of [1, 3, 5, 12, 37]) {
        const view = makeTestView({
          map: smallMap(), persona: personaAt(tier), phase: "draft", troopsToPlace: count,
          board: [[0, 5], [0, 2], [0, 4], [1, 6], [1, 3], [1, 3]],
        });
        const plan = decideTurn(view, trueRandom, countingRng(1));
        const total = plan.placements.reduce((a, p) => a + p.count, 0);
        expect(total, `${tier}/${count}`).toBe(count);
        for (const p of plan.placements) {
          expect(view.owner[p.territory]).toBe(0);
          expect(p.count).toBeGreaterThan(0);
        }
        // Each territory appears at most once.
        const ids = plan.placements.map((p) => p.territory);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it("plans at most ONE attack and asks for re-entry, or declares the phase done", () => {
    const plan = decideTurn(obviousAttack(), trueRandom, countingRng(1));
    expect(plan.attacks.length).toBeLessThanOrEqual(1);
    expect(plan.attacks).toHaveLength(1);
    expect(plan.done).toBe(false);
    expect(plan.attacks[0]?.mode).toBe("blitz"); // R46/R61: a bot always Blitzes
  });

  it("declares the attack phase done when there is nothing worth attacking", () => {
    const view = makeTestView({
      map: crossMap(), persona: personaAt("hard"),
      board: [[0, 2], [0, 1], [0, 1], [1, 40], [1, 40], [1, 40]],
    });
    const plan = decideTurn(view, trueRandom, countingRng(1));
    expect(plan.attacks).toEqual([]);
    expect(plan.done).toBe(true);
  });

  it("declares the attack phase done when no enemy borders me at all", () => {
    const view = makeTestView({
      map: smallMap(), persona: personaAt("expert"),
      board: [[0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9]],
    });
    expect(decideTurn(view, trueRandom, countingRng(1)).done).toBe(true);
  });

  it("finishes after the fortify phase", () => {
    const view = makeTestView({
      map: smallMap(), persona: personaAt("hard"), phase: "fortify",
      board: [[0, 9], [0, 1], [0, 1], [1, 4], [1, 4], [1, 4]],
    });
    const plan = decideTurn(view, trueRandom, countingRng(1));
    expect(plan.done).toBe(true);
    expect(plan.attacks).toEqual([]);
  });

  it("returns an empty plan once the game is over", () => {
    const view = makeTestView({
      map: smallMap(), persona: personaAt("hard"), phase: "over",
      board: [[0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9]],
    });
    expect(decideTurn(view, trueRandom, countingRng(1))).toEqual({
      cardTrade: null, placements: [], attacks: [], fortify: null, done: true,
    });
  });

  it("is pure: the same inputs give the identical plan, and the view is never mutated", () => {
    const view = obviousAttack();
    const before = [[...view.troops], [...view.owner]];
    const a = decideTurn(view, trueRandom, countingRng(5));
    const b = decideTurn(view, trueRandom, countingRng(5));
    expect(a).toEqual(b);
    expect([[...view.troops], [...view.owner]]).toEqual(before);
  });

  it("never throws, on any phase or any board (fast-check)", () => {
    const map = smallMap();
    fc.assert(
      fc.property(
        fc.constantFrom("claim", "draft", "attack", "fortify", "over" as const),
        fc.array(fc.tuple(fc.integer({ min: -2, max: 1 }), fc.integer({ min: 0, max: 40 })),
          { minLength: 6, maxLength: 6 }),
        fc.constantFrom("beginner", "easy", "medium", "hard", "expert" as const),
        fc.integer({ min: 0, max: 30 }),
        (phase, board, tier, toPlace) => {
          const view = makeTestView({
            map, persona: personaAt(tier), phase: phase as never,
            board: board as never, troopsToPlace: toPlace, seats: 2,
          });
          const plan = decideTurn(view, trueRandom, countingRng(1));
          expect(plan.attacks.length).toBeLessThanOrEqual(1);
          for (const p of plan.placements) expect(p.count).toBeGreaterThan(0);
        }),
      { numRuns: 400 },
    );
  });
});

describe("T5 — the draw count is 0 or 1, and a pure function of the inputs (F57)", () => {
  it("a blunderRate: 0 persona draws NOTHING, ever", () => {
    for (const phase of ["claim", "draft", "attack", "fortify"] as const) {
      const map = crossMap();
      const view = makeTestView({
        map, persona: personaAt("expert"), phase, troopsToPlace: 9,
        board: phase === "claim" ? emptyBoard(map) : [[0, 10], [0, 3], [0, 3], [1, 1], [1, 4], [1, 4]],
      });
      expect(view.persona.blunderRate).toBe(0);
      const rng = countingRng(1);
      decideTurn(view, trueRandom, rng);
      expect(rng.draws(), phase).toBe(0);
    }
  });

  it("a blundering persona draws at most one, and only in the attack phase", () => {
    for (const phase of ["claim", "draft", "fortify"] as const) {
      const map = crossMap();
      const view = makeTestView({
        map, persona: personaAt("beginner"), phase, troopsToPlace: 9,
        board: phase === "claim" ? emptyBoard(map) : [[0, 10], [0, 3], [0, 3], [1, 1], [1, 4], [1, 4]],
      });
      const rng = countingRng(1);
      decideTurn(view, trueRandom, rng);
      expect(rng.draws(), phase).toBe(0);
    }
    const attacking = obviousAttack("beginner");
    const rng = countingRng(1);
    decideTurn(attacking, trueRandom, rng);
    expect(rng.draws()).toBeLessThanOrEqual(1);
  });

  it("the count matches `drawCountFor` exactly — the FUNCTION, not a fixed constant", () => {
    const map = crossMap();
    const boards: (readonly (readonly [number, number])[])[] = [
      // Three legal attacks: every one of 0, 1, 2 clears its reserve and the 4-troop dice gate.
      [[0, 10], [0, 10], [0, 10], [1, 1], [1, 2], [1, 2]],
      // One stack, two thin sources that cannot clear their reserve -> exactly one legal attack.
      [[0, 10], [0, 3], [0, 3], [1, 1], [1, 4], [1, 4]],
      [[0, 2], [0, 1], [0, 1], [1, 40], [1, 40], [1, 40]], // none survive the gates
      [[0, 20], [0, 1], [0, 1], [1, 1], [1, 40], [1, 40]], // exactly one
      [[0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9]],    // no enemy at all
    ];
    let sawZero = false;
    let sawOne = false;
    for (const tier of ["beginner", "easy", "medium", "hard", "expert"] as const) {
      for (const board of boards) {
        const view = makeTestView({ map, persona: personaAt(tier), board, seats: 2 });
        const expected = drawCountFor(view, trueRandom);
        const rng = countingRng(3);
        decideTurn(view, trueRandom, rng);
        expect(rng.draws(), `${tier}`).toBe(expected);
        expect(expected === 0 || expected === 1).toBe(true);
        if (expected === 0) sawZero = true; else sawOne = true;
      }
    }
    // The point of F57: the count is NOT the same for every input.
    expect(sawZero).toBe(true);
    expect(sawOne).toBe(true);
  });

  it("exactly 0 when only one candidate survives the gates, even at a high blunder rate", () => {
    const view = makeTestView({
      map: crossMap(), persona: personaAt("beginner"),
      board: [[0, 20], [0, 1], [0, 1], [1, 1], [1, 40], [1, 40]],
    });
    expect(view.persona.blunderRate).toBeGreaterThan(0);
    const legal = attackCandidates(view, trueRandom).filter((c) => passesGates(view, c));
    expect(legal).toHaveLength(1);
    const rng = countingRng(1);
    decideTurn(view, trueRandom, rng);
    expect(rng.draws()).toBe(0);
  });

  it("a repeated call on the same rng state gives the same count and the same plan", () => {
    const view = makeTestView({
      map: crossMap(), persona: personaAt("easy"),
      board: [[0, 10], [0, 8], [0, 8], [1, 1], [1, 2], [1, 2]],
    });
    for (const seed of [1, 2, 3, 99]) {
      const a = countingRng(seed);
      const b = countingRng(seed);
      expect(decideTurn(view, trueRandom, a)).toEqual(decideTurn(view, trueRandom, b));
      expect(a.draws()).toBe(b.draws());
    }
  });

  it("D29: the blunder picks a WORSE-ranked candidate, never a miscalculated one", () => {
    const view = makeTestView({
      map: crossMap(), persona: personaAt("beginner"),
      board: [[0, 10], [0, 8], [0, 8], [1, 1], [1, 2], [1, 2]],
    });
    const ranked = attackCandidates(view, trueRandom).filter((c) => passesGates(view, c));
    expect(ranked.length).toBeGreaterThan(1);

    // u >= blunderRate: take the best, which is rank 0.
    const best = decideTurn(view, trueRandom, fixedRng(0.99)).attacks[0];
    expect(best?.from).toBe((ranked[0] as { from: number }).from);
    expect(best?.to).toBe((ranked[0] as { to: number }).to);

    // u < blunderRate: take a lower rank — a different candidate, but still a LEGAL one, scored
    // by exactly the same maths. Nothing about the evaluation was made wrong (D29).
    const blunder = decideTurn(view, trueRandom, fixedRng(0)).attacks[0];
    expect(blunder).toBeDefined();
    const rank = ranked.findIndex((c) => c.from === blunder?.from && c.to === blunder?.to);
    expect(rank).toBeGreaterThan(0);
  });
});

describe("T8 — Expert never attacks at `score <= 0` (R54's dynamic floor)", () => {
  it("stops because the maths says so, with no fixed threshold", () => {
    const expert = personaAt("expert");
    expect(expert.dynamicMinWinChance).toBe(true);
    expect(expert.minWinChance).toBe(0);

    const view = makeTestView({
      map: crossMap(), persona: expert,
      board: [[0, 6], [0, 3], [0, 3], [1, 8], [1, 8], [1, 8]],
    });
    for (const candidate of attackCandidates(view, trueRandom)) {
      if (passesGates(view, candidate)) expect(candidate.score).toBeGreaterThan(0);
    }
    const plan = decideTurn(view, trueRandom, countingRng(1));
    if (plan.attacks.length > 0) {
      const chosen = attackCandidates(view, trueRandom)
        .find((c) => c.from === plan.attacks[0]?.from && c.to === plan.attacks[0]?.to);
      expect(chosen?.score).toBeGreaterThan(0);
    }
  });

  it("every tier below Expert uses its numeric floor instead", () => {
    const floors = { beginner: 0.25, easy: 0.25, medium: 0.45, hard: 0.55 } as const;
    for (const [tier, floor] of Object.entries(floors)) {
      const persona = personaAt(tier as keyof typeof floors);
      expect(persona.dynamicMinWinChance, tier).toBe(false);
      expect(persona.minWinChance, tier).toBe(floor);
      const view = makeTestView({
        map: crossMap(), persona,
        board: [[0, 6], [0, 3], [0, 3], [1, 8], [1, 8], [1, 8]],
      });
      for (const candidate of attackCandidates(view, trueRandom)) {
        if (passesGates(view, candidate)) expect(candidate.winChance, tier).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it("the research dice gate holds: never initiate from under 4 troops on a routine target", () => {
    const view = makeTestView({
      map: crossMap(), persona: personaAt("hard"),
      board: [[0, 9], [0, 9], [0, 3], [1, 5], [1, 5], [1, 5]],
    });
    for (const candidate of attackCandidates(view, trueRandom)) {
      if (!passesGates(view, candidate)) continue;
      const source = view.troops[candidate.from] as number;
      const target = view.troops[candidate.to] as number;
      const exempt = target <= 1 || candidate.completesContinent || candidate.breaksContinent
        || candidate.eliminates !== null;
      if (!exempt) expect(source).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("T8 — persona behaviours that are supposed to be visible", () => {
  const map = crossMap();
  const board = [[0, 20], [0, 8], [0, 8], [1, 2], [1, 2], [1, 2]] as const;

  it("the turtle caps itself at one attack per turn", () => {
    const turtle = personaAt("medium", { minWinChance: 0.3 }, "turtle");
    const fresh = makeTestView({ map, persona: turtle, board, conqueredThisTurn: false });
    const after = makeTestView({ map, persona: turtle, board, conqueredThisTurn: true });
    expect(decideTurn(fresh, trueRandom, countingRng(1)).attacks.length).toBe(1);
    expect(decideTurn(after, trueRandom, countingRng(1)).attacks).toEqual([]);
    expect(decideTurn(after, trueRandom, countingRng(1)).done).toBe(true);
  });

  it("the hoarder attacks only when dominant", () => {
    const hoarder = personaAt("medium", { minWinChance: 0.3 }, "hoarder");
    const dominant = makeTestView({ map, persona: hoarder, board });
    expect(decideTurn(dominant, trueRandom, countingRng(1)).attacks.length).toBe(1);
    const outgunned = makeTestView({
      map, persona: hoarder,
      board: [[0, 4], [0, 2], [0, 2], [1, 30], [1, 2], [1, 2]],
    });
    expect(decideTurn(outgunned, trueRandom, countingRng(1)).attacks).toEqual([]);
  });

  it("`stack` puts everything on one territory and `spread` puts one troop at a time", () => {
    const stacker = makeTestView({
      map, persona: personaAt("medium", { placement: "stack" }), phase: "draft", troopsToPlace: 9,
      board: [[0, 7], [0, 2], [0, 2], [1, 4], [1, 4], [1, 4]],
    });
    const stacked = decideTurn(stacker, trueRandom, countingRng(1)).placements;
    expect(stacked).toHaveLength(1);
    expect(stacked[0]?.count).toBe(9);

    const spreader = makeTestView({
      map, persona: personaAt("easy", { placement: "spread" }), phase: "draft", troopsToPlace: 3,
      board: [[0, 7], [0, 2], [0, 2], [1, 4], [1, 4], [1, 4]],
    });
    const spread = decideTurn(spreader, trueRandom, countingRng(1)).placements;
    expect(spread).toHaveLength(3);
    for (const p of spread) expect(p.count).toBe(1);
  });

  it("`frontLoad` puts everything on one border, never on a quiet interior", () => {
    // On `smallMap` the only cross edge is 2-3, so territory 2 is the single border I hold and
    // 0 and 1 are quiet interiors — which is what makes "never on a quiet interior" assertable.
    const view = makeTestView({
      map: smallMap(), persona: personaAt("hard", { placement: "frontLoad" }),
      phase: "draft", troopsToPlace: 7,
      board: [[0, 9], [0, 2], [0, 2], [1, 4], [1, 4], [1, 4]],
    });
    const placements = decideTurn(view, trueRandom, countingRng(1)).placements;
    expect(placements).toHaveLength(1);
    expect(placements[0]?.count).toBe(7);
    expect(placements[0]?.territory).toBe(2);
  });

  it("`secure` tops up threatened borders rather than piling onto an interior", () => {
    const view = makeTestView({
      map, persona: personaAt("medium"), phase: "draft", troopsToPlace: 8,
      board: [[0, 9], [0, 2], [0, 2], [1, 12], [1, 4], [1, 4]],
    });
    expect(view.persona.placement).toBe("secure");
    const placements = decideTurn(view, trueRandom, countingRng(1)).placements;
    expect(placements.reduce((a, p) => a + p.count, 0)).toBe(8);
    // Territory 0 is a quiet interior and must not be the only destination.
    expect(placements.some((p) => p.territory === 2)).toBe(true);
  });

  it("Beginner never fortifies; Hard drains an interior into a threatened border", () => {
    const base = {
      map: smallMap(), phase: "fortify" as const,
      board: [[0, 12], [0, 1], [0, 2], [1, 9], [1, 4], [1, 4]] as const,
    };
    expect(decideTurn(makeTestView({ ...base, persona: personaAt("beginner") }), trueRandom, countingRng(1)).fortify)
      .toBeNull();
    const hard = decideTurn(makeTestView({ ...base, persona: personaAt("hard") }), trueRandom, countingRng(1)).fortify;
    expect(hard).not.toBeNull();
    expect(hard?.from).toBe(0);     // the quiet 12-stack
    expect(hard?.to).toBe(2);       // the border facing the 9
    expect(hard?.count).toBe(11);   // one army always stays behind
  });
});

describe("T8 — the right odds table matters (R57, D25)", () => {
  it("a bot given the True Random table in a Balanced Blitz game is measurably worse", () => {
    const map = classicShapedMap();
    const rightTable = personaAt("hard");
    let correctWins = 0;
    let wrongWins = 0;
    let correctTerritories = 0;
    let wrongTerritories = 0;
    for (let seed = 1; seed <= 24; seed++) {
      // Seat 0 holds the correct (Balanced Blitz) table, seat 1 the wrong one. Swap sides each
      // seed so neither benefits from going first.
      const swap = seed % 2 === 0;
      const seats = swap
        ? [{ persona: rightTable, odds: trueRandom }, { persona: rightTable, odds: balancedBlitz }]
        : [{ persona: rightTable, odds: balancedBlitz }, { persona: rightTable, odds: trueRandom }];
      const correctSeat = swap ? 1 : 0;
      const result = playMatch(map, seats, balancedBlitz, seed, 30, { diceMode: "balancedBlitz" });
      if (result.winner === correctSeat) correctWins++;
      else if (result.winner !== null) wrongWins++;
      correctTerritories += result.territories[correctSeat] as number;
      wrongTerritories += result.territories[1 - correctSeat] as number;
    }
    // The right-table bot is ahead on the board, which is what "measurably underperforming" means.
    expect(correctTerritories).toBeGreaterThan(wrongTerritories);
    expect(correctWins).toBeGreaterThanOrEqual(wrongWins);
  });

  it("the two tables really do disagree by up to 14 points on the same battle", () => {
    expect(balancedBlitz.winChance(20, 15) - trueRandom.winChance(20, 15)).toBeGreaterThan(0.13);
  });
});

describe("T8 — a blunderRate 0.4 bot loses to a 0.0 bot over 50 seeded matches", () => {
  it("the sharp bot finishes ahead", () => {
    const map = classicShapedMap();
    const sharp = personaAt("medium", { blunderRate: 0 });
    const sloppy = personaAt("medium", { blunderRate: 0.4 });
    let sharpTerritories = 0;
    let sloppyTerritories = 0;
    let sharpWins = 0;
    let sloppyWins = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const swap = seed % 2 === 0;
      const seats = swap
        ? [{ persona: sloppy, odds: trueRandom }, { persona: sharp, odds: trueRandom }]
        : [{ persona: sharp, odds: trueRandom }, { persona: sloppy, odds: trueRandom }];
      const sharpSeat = swap ? 1 : 0;
      const result = playMatch(map, seats, trueRandom, seed, 25);
      sharpTerritories += result.territories[sharpSeat] as number;
      sloppyTerritories += result.territories[1 - sharpSeat] as number;
      if (result.winner === sharpSeat) sharpWins++;
      else if (result.winner !== null) sloppyWins++;
    }
    expect(sharpTerritories).toBeGreaterThan(sloppyTerritories);
    expect(sharpWins).toBeGreaterThanOrEqual(sloppyWins);
  });

  it("the match driver is reproducible from its seed", () => {
    const map = smallMap();
    const seats = [
      { persona: personaAt("hard"), odds: trueRandom },
      { persona: personaAt("easy"), odds: trueRandom },
    ];
    expect(playMatch(map, seats, trueRandom, 7, 20)).toEqual(playMatch(map, seats, trueRandom, 7, 20));
  });
});

describe("D55 — the golden TurnPlan, so any heuristic change is explicit", () => {
  /**
   * A fixed `GameView` + persona + seeded rng → one `TurnPlan`, snapshotted inline.
   *
   * If a weight, a gate or an ordering changes, this snapshot moves — and per D55 that is a
   * decision to record and a `RULESET_VERSION` bump, never an incidental side effect.
   */
  const map = buildMap({
    slug: "golden",
    names: ["Home", "Ridge", "Pass", "Vale", "Keep", "Marsh", "Spire", "Delta"],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [0, 2], [2, 4], [4, 6], [1, 7]],
    continents: [["Highlands", 3, [0, 1, 2, 3]], ["Lowlands", 2, [4, 5, 6, 7]]],
  });

  const persona = personaAt("hard");

  it("the golden draft plan", () => {
    const view = makeTestView({
      map, persona, phase: "draft", troopsToPlace: 9, setsTradedTotal: 2,
      board: [[0, 4], [0, 2], [0, 6], [0, 3], [1, 7], [1, 5], [1, 4], [1, 3]],
      myCards: [card("home", "infantry", 0), card("ridge", "cavalry", 1), card("pass", "artillery", 2)],
      cardCount: [3, 2],
    });
    expect(decideTurn(view, trueRandom, countingRng(20260105))).toMatchInlineSnapshot(`
      {
        "attacks": [],
        "cardTrade": [
          "home",
          "ridge",
          "pass",
        ],
        "cardTradeBonus": 2,
        "done": false,
        "fortify": null,
        "placements": [
          {
            "count": 5,
            "territory": 1,
          },
          {
            "count": 1,
            "territory": 2,
          },
          {
            "count": 3,
            "territory": 3,
          },
        ],
      }
    `);
  });

  it("the golden attack plan", () => {
    // A 14-stack at Pass against a 2-troop Keep, which also breaks the Lowlands bonus. The
    // previous board here had a 12-stack against a 7 — which ply-1 rightly *declines*, since the
    // survivors would hold the prize with one army against a 5-stack — and a golden that snapshots
    // an empty plan anchors nothing at all.
    const view = makeTestView({
      map, persona, phase: "attack",
      board: [[0, 4], [0, 2], [0, 14], [0, 3], [1, 2], [1, 5], [1, 4], [1, 3]],
    });
    expect(decideTurn(view, trueRandom, countingRng(20260105))).toMatchInlineSnapshot(`
      {
        "attacks": [
          {
            "from": 2,
            "mode": "blitz",
            "moveIn": "max",
            "stopUntil": 4,
            "to": 4,
          },
        ],
        "cardTrade": null,
        "done": false,
        "fortify": null,
        "placements": [],
      }
    `);
  });

  it("the golden fortify plan", () => {
    const view = makeTestView({
      map, persona, phase: "fortify",
      board: [[0, 9], [0, 2], [0, 3], [0, 1], [1, 7], [1, 5], [1, 4], [1, 3]],
    });
    expect(decideTurn(view, trueRandom, countingRng(20260105))).toMatchInlineSnapshot(`
      {
        "attacks": [],
        "cardTrade": null,
        "done": true,
        "fortify": {
          "count": 8,
          "from": 0,
          "to": 3,
        },
        "placements": [],
      }
    `);
  });

  it("the golden claim plan", () => {
    const view = makeTestView({
      map, persona, phase: "claim", board: emptyBoard(map),
    });
    expect(decideTurn(view, trueRandom, countingRng(20260105))).toMatchInlineSnapshot(`
      {
        "attacks": [],
        "cardTrade": null,
        "done": false,
        "fortify": null,
        "placements": [
          {
            "count": 1,
            "territory": 0,
          },
        ],
      }
    `);
  });

  it("the golden attack plan under Balanced Blitz", () => {
    const view = makeTestView({
      map, persona, phase: "attack", rules: { diceMode: "balancedBlitz" },
      board: [[0, 4], [0, 2], [0, 14], [0, 3], [1, 2], [1, 5], [1, 4], [1, 3]],
    });
    expect(decideTurn(view, balancedBlitz, countingRng(20260105))).toMatchInlineSnapshot(`
      {
        "attacks": [
          {
            "from": 2,
            "mode": "blitz",
            "moveIn": "max",
            "to": 4,
          },
        ],
        "cardTrade": null,
        "done": false,
        "fortify": null,
        "placements": [],
      }
    `);
  });

  /**
   * R57/D25, at the one battle size where the two tables straddle Hard's floor.
   *
   * 8 v 8 is 54.74% True Random and 57.68% Balanced Blitz, and Hard's `minWinChance` is 0.55 — so
   * the *same* attack is correctly refused with the True Random table and correctly taken with the
   * Balanced Blitz one. A bot handed the wrong table does not merely misprice this attack, it makes
   * the opposite decision about it, which is why D25 calls it a correctness bug and not tuning.
   */
  it("the 8 v 8 attack that only the right table accepts (R57, D25)", () => {
    const board = [[0, 4], [0, 2], [0, 9], [0, 3], [1, 8], [1, 5], [1, 4], [1, 3]] as const;
    const trView = makeTestView({ map, persona, phase: "attack", board });
    const bbView = makeTestView({
      map, persona, phase: "attack", board, rules: { diceMode: "balancedBlitz" },
    });
    expect(persona.minWinChance).toBe(0.55);

    const tr = scoreAttack(trView, trueRandom, 2, 4);
    const bb = scoreAttack(bbView, balancedBlitz, 2, 4);
    expect(tr.winChance).toBeCloseTo(0.5474, 4);
    expect(bb.winChance).toBeCloseTo(0.5768, 4);

    expect(tr.winChance).toBeLessThan(persona.minWinChance);
    expect(bb.winChance).toBeGreaterThan(persona.minWinChance);
    expect(passesGates(trView, tr)).toBe(false);
  });
});

describe("makeView — the fog policy (D31)", () => {
  const map = smallMap();

  function stateFor(territories: readonly (readonly [number, number])[], fog: boolean): GameState {
    return {
      version: 1,
      mapSlug: map.slug,
      rules: { ...TEST_RULES, fogOfWar: fog },
      seats: [seat(0), seat(1)],
      turnOrder: [0, 1],
      territories: territories.map(([owner, troops]) => ({ owner, troops, blizzard: false } as TerritoryState)),
      currentIndex: 0,
      phase: "attack",
      round: 2,
      turn: 3,
      troopsToPlace: 0,
      territoryBonusLeft: 2,
      setsTradedThisTurn: 0,
      setsTradedTotal: 1,
      conqueredThisTurn: false,
      fortifyUsed: false,
      pendingMoveIn: null,
      resumePhase: null,
      portals: [],
      discard: [],
      outcome: null,
      fogged: fog,
    };
  }

  function seat(index: number): SeatState {
    return {
      seat: index, kind: index === 0 ? "bot" : "human", name: `S${index}`,
      colour: index === 0 ? "red" : "blue", standing: "active",
      cards: index === 0 ? [card("home", "infantry", 0)] : [],
      cardCount: index === 0 ? 1 : 3,
      capital: null, tier: index === 0 ? "hard" : null, persona: null,
      allies: [], missedTurns: 0, armiesToClaim: 0,
    };
  }

  it("copies an authoritative state through with everything known", () => {
    const state = stateFor([[0, 5], [0, 2], [0, 3], [1, 4], [1, 4], [1, 4]], false);
    const view = makeView(state, map, 0, personaAt("expert"));
    expect([...view.known]).toEqual([1, 1, 1, 1, 1, 1]);
    expect([...view.troops]).toEqual([5, 2, 3, 4, 4, 4]);
    expect([...view.territoryCount]).toEqual([3, 3]);
    expect([...view.troopCount]).toEqual([10, 12]);
    expect(view.me).toBe(0);
    expect(view.round).toBe(2);
    expect(view.setsTradedTotal).toBe(1);
    expect(view.myCards).toHaveLength(1);
    expect([...view.cardCount]).toEqual([1, 3]);
  });

  it("an honest bot inflates a hidden stack by its fogPessimism, and flags it as a belief", () => {
    const masked = stateFor([[0, 5], [0, 2], [0, 3], [-3, -1], [-3, -1], [1, 4]], true);
    const hard = makeView(masked, map, 0, personaAt("hard"));
    expect([...hard.known]).toEqual([1, 1, 1, 0, 0, 1]);
    // Visible stacks are 5, 2, 3 and 4 -> mean 3.5; Hard's pessimism is 1.1 -> round(3.85) = 4.
    expect(hard.persona.fogPessimism).toBe(1.1);
    expect(hard.troops[3]).toBe(4);
    expect(hard.troops[4]).toBe(4);
    // A more pessimistic tier believes more.
    const beginner = makeView(masked, map, 0, personaAt("beginner"));
    expect(beginner.persona.fogPessimism).toBe(1.5);
    expect(beginner.troops[3] as number).toBeGreaterThan(hard.troops[3] as number);
  });

  it("a view never carries a SEAT_UNKNOWN troop count through into a score", () => {
    const masked = stateFor([[0, 5], [0, 2], [0, 3], [-3, -1], [-3, -1], [1, 4]], true);
    for (const tier of ["beginner", "easy", "medium", "hard", "expert"] as const) {
      const view = makeView(masked, map, 0, personaAt(tier));
      for (const t of view.troops) expect(t, tier).toBeGreaterThanOrEqual(0);
      expect(() => decideTurn(view, trueRandom, countingRng(1))).not.toThrow();
    }
  });

  it("an unowned territory is believed empty, never inflated", () => {
    const masked = stateFor([[0, 5], [SEAT_NONE, 0], [0, 3], [-3, -1], [1, 4], [1, 4]], true);
    const view = makeView(masked, map, 0, personaAt("beginner"));
    expect(view.troops[1]).toBe(0);
  });

  it("carries the grudge array through, defaulting to zeros", () => {
    const state = stateFor([[0, 5], [0, 2], [0, 3], [1, 4], [1, 4], [1, 4]], false);
    expect([...makeView(state, map, 0, personaAt("hard")).grudge]).toEqual([0, 0]);
    const carried = new Float32Array([0, 9]);
    expect([...makeView(state, map, 0, personaAt("hard"), carried).grudge]).toEqual([0, 9]);
  });

  it("sees a portal as attack adjacency only once it conducts (R76, F9)", () => {
    const state = {
      ...stateFor([[0, 9], [0, 2], [0, 3], [1, 1], [1, 4], [1, 4]], false),
      portals: [{ a: 0, b: 4, kind: "unstable" as const, activeFrom: 3 }],
      round: 2,
    };
    const inactive = makeView(state, map, 0, personaAt("hard"));
    const candidates = attackCandidates(inactive, trueRandom);
    expect(candidates.some((c) => c.from === 0 && c.to === 4)).toBe(false);
    const active = makeView({ ...state, round: 3 }, map, 0, personaAt("hard"));
    expect(attackCandidates(active, trueRandom).some((c) => c.from === 0 && c.to === 4)).toBe(true);
  });
});

describe("T13 — the decideTurn budget", () => {
  it("a ply-0 decideTurn on a 42-territory view is well under 5 ms", () => {
    const map = classicShapedMap();
    expect(map.territories.length).toBe(42);
    const view = makeTestView({
      map, persona: personaAt("medium"),
      board: map.territories.map((_, t) => [t % 2, 3 + (t % 5)] as const),
      seats: 2,
    });
    decideTurn(view, trueRandom, countingRng(1)); // warm the odds memo
    const start = performance.now();
    for (let i = 0; i < 20; i++) decideTurn(view, trueRandom, countingRng(i));
    const perCall = (performance.now() - start) / 20;
    expect(perCall).toBeLessThan(5);
  });

  it("a ply-1 Expert decideTurn stays under 10 ms", () => {
    const map = classicShapedMap();
    const view = makeTestView({
      map, persona: personaAt("expert"),
      board: map.territories.map((_, t) => [t % 2, 3 + (t % 7)] as const),
      seats: 2,
    });
    expect(view.persona.lookahead).toBe(2);
    decideTurn(view, trueRandom, countingRng(1));
    const start = performance.now();
    for (let i = 0; i < 10; i++) decideTurn(view, trueRandom, countingRng(i));
    expect((performance.now() - start) / 10).toBeLessThan(10);
  });
});
