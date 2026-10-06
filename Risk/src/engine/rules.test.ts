/**
 * Reinforcements, continent bonuses, the roster totals and the win order
 * (R12–R15, R70–R72, R77–R84; D18, D57, D59, D60).
 */
import { describe, expect, it } from "vitest";

import { buildState, splitOwners } from "./__fixtures__/states";
import { classicWorld, mini, tiny4 } from "./__fixtures__/maps";
import { continentBonusFor, continentsHeldBy, ownsContinent } from "./continents";
import {
  dominationTarget,
  evaluateOutcome,
  isContender,
  isGameOver,
  livingSeats,
  maxRoundsWinner,
  reinforcementsFor,
  takesTurns,
  territoryCountFor,
  territoryCounts,
  troopCountFor,
  troopCounts,
  turnTakingSeats,
} from "./rules";
import { viewFor } from "./fog";
import type { Seat } from "./types";

/** Give seat 0 exactly `n` of classic's territories and the rest to seat 1. */
function withOwned(n: number): readonly Seat[] {
  return classicWorld.territories.map((_t, i) => (i < n ? 0 : 1));
}

describe("R13 — Classic continent bonuses", () => {
  it("are 5 / 2 / 5 / 3 / 7 / 2, totalling 24", () => {
    const bonuses = classicWorld.continents.map((c) => c.bonus);
    expect(bonuses).toEqual([5, 2, 5, 3, 7, 2]);
    expect(bonuses.reduce((a, b) => a + b, 0)).toBe(24);
  });

  it("names the six continents", () => {
    expect(classicWorld.continents.map((c) => c.name)).toEqual([
      "North America",
      "South America",
      "Europe",
      "Africa",
      "Asia",
      "Australia",
    ]);
  });

  it("pays a continent only when the seat owns every territory in it", () => {
    const australia = classicWorld.continents.find((c) => c.id === "australia");
    const members = australia?.territories ?? [];
    const owners = classicWorld.territories.map((_t, i) => (members.includes(i) ? 0 : 1));
    const state = buildState(classicWorld, { seats: 2, owners });
    expect(ownsContinent(state, classicWorld, 0, australia?.index ?? 0)).toBe(true);
    expect(continentsHeldBy(state, classicWorld, 0)).toEqual([australia?.index]);
    expect(continentBonusFor(state, classicWorld, 0)).toBe(2);
  });

  it("stops paying the moment one territory is lost", () => {
    const australia = classicWorld.continents.find((c) => c.id === "australia");
    const members = [...(australia?.territories ?? [])];
    const owners = classicWorld.territories.map((_t, i) => (members.includes(i) ? 0 : 1));
    const broken = [...owners];
    broken[members[0] as number] = 1;
    const state = buildState(classicWorld, { seats: 2, owners: broken });
    expect(continentsHeldBy(state, classicWorld, 0)).toEqual([]);
  });

  it("R14 — a blizzard does not break a bonus", () => {
    const australia = classicWorld.continents.find((c) => c.index !== undefined && c.id === "australia");
    const members = [...(australia?.territories ?? [])];
    const frozen = members[1] as number;
    const owners = classicWorld.territories.map((_t, i) => (members.includes(i) ? 0 : 1));
    const state = buildState(classicWorld, { seats: 2, owners, blizzards: [frozen] });
    expect(state.territories[frozen]?.owner).toBe(-1);
    expect(continentsHeldBy(state, classicWorld, 0)).toEqual([australia?.index]);
    expect(continentBonusFor(state, classicWorld, 0)).toBe(2);
  });

  it("R14 — a continent that is entirely frozen is owned by nobody", () => {
    const state = buildState(tiny4, { seats: 2, owners: [0, 0, 0, 0], blizzards: [0, 1, 2, 3] });
    expect(continentsHeldBy(state, tiny4, 0)).toEqual([]);
    expect(continentsHeldBy(state, tiny4, 1)).toEqual([]);
  });

  it("returns continents ascending by id (R91)", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 0, 0, 0] });
    expect(continentsHeldBy(state, mini, 0)).toEqual([0, 1]);
  });
});

describe("R12 — the reinforcement formula", () => {
  const cases: readonly [number, number][] = [
    [1, 3],
    [3, 3],
    [8, 3],
    [11, 3],
    [12, 4],
    [14, 4],
    [16, 5],
    [17, 5],
    [18, 6],
    [42, 14],
  ];

  for (const [owned, base] of cases) {
    it(`pays ${String(base)} for ${String(owned)} territories`, () => {
      const state = buildState(classicWorld, { seats: 2, owners: withOwned(owned) });
      expect(territoryCountFor(state, 0)).toBe(owned);
      expect(reinforcementsFor(state, classicWorld, 0).base).toBe(base);
    });
  }

  it("never pays fewer than three", () => {
    const state = buildState(classicWorld, { seats: 2, owners: withOwned(0) });
    expect(reinforcementsFor(state, classicWorld, 0).total).toBe(3);
  });

  it("adds every held continent's bonus on top of the base", () => {
    const state = buildState(classicWorld, { seats: 2, owners: splitOwners(classicWorld, 1) });
    const award = reinforcementsFor(state, classicWorld, 0);
    expect(award.base).toBe(14);
    expect(award.bonus).toBe(24);
    expect(award.total).toBe(38);
  });
});

describe("R15 — the capital draft bonus ships off (D57)", () => {
  it("pays nothing by default, even holding a capital", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { capitals: true },
      capitals: [0, 3],
    });
    expect(reinforcementsFor(state, mini, 0).capitals).toBe(0);
  });

  it("pays +2 per held capital when the flag is on", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 0, 1, 1],
      rules: { capitals: true, capitalDraftBonus: true },
      capitals: [0, 3],
    });
    // Seat 0 holds both capitals: its own (0) and seat 1's captured one (3).
    expect(reinforcementsFor(state, mini, 0).capitals).toBe(4);
    expect(reinforcementsFor(state, mini, 1).capitals).toBe(0);
  });

  it("pays nothing when Capitals itself is off, flag or no flag", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { capitals: false, capitalDraftBonus: true },
      capitals: [0, 3],
    });
    expect(reinforcementsFor(state, mini, 0).capitals).toBe(0);
  });
});

describe("the roster totals", () => {
  it("counts territories and troops per seat on authoritative state", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 1, 1, 1, 0],
      troops: [3, 4, 1, 1, 9, 2],
    });
    expect(territoryCounts(state)).toEqual([3, 3]);
    expect(troopCounts(state)).toEqual([9, 11]);
    expect(troopCountFor(state, 1)).toBe(11);
  });

  it("R73/F52 — reports null for every seat once fog hides a tile", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], rules: { fogOfWar: true } });
    const view = viewFor(state, mini, 0);
    expect(territoryCounts(view)).toEqual([null, null]);
    expect(troopCounts(view)).toEqual([null, null]);
  });

  it("the viewer's own count stays exact in a view, via the per-seat helper", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [2, 2, 2, 5, 5, 5],
      rules: { fogOfWar: true },
    });
    const view = viewFor(state, mini, 0);
    expect(territoryCountFor(view, 0)).toBe(3);
    expect(troopCountFor(view, 0)).toBe(6);
  });
});

describe("standings", () => {
  it("R81 — only elimination takes a seat out of the rotation", () => {
    const state = buildState(mini, {
      standings: { 0: "active", 1: "resigned", 2: "eliminated" },
    });
    expect(turnTakingSeats(state)).toEqual([0, 1]);
    expect(takesTurns(state.seats[1] as never)).toBe(true);
    expect(takesTurns(state.seats[2] as never)).toBe(false);
  });

  it("R84/D76 — a resigned seat still plays but is not counted as a rival", () => {
    const state = buildState(mini, { standings: { 1: "resigned" } });
    expect(isContender(state.seats[1] as never)).toBe(false);
    expect(livingSeats(state)).toEqual([0, 2]);
  });

  it("an away seat is both a turn-taker and a rival", () => {
    const state = buildState(mini, { standings: { 1: "away" } });
    expect(livingSeats(state)).toEqual([0, 1, 2]);
    expect(turnTakingSeats(state)).toEqual([0, 1, 2]);
  });
});

describe("R83 — the win evaluation order", () => {
  it("R70 — World Domination fires on owning every non-blizzard territory", () => {
    const state = buildState(tiny4, { seats: 2, owners: [0, 0, 0, 0] });
    expect(evaluateOutcome(state, tiny4)).toMatchObject({ winner: 0, reason: "world", tiebreak: false });
  });

  it("R74 — a blizzard does not block a World Domination win", () => {
    const state = buildState(tiny4, { seats: 2, owners: [0, 0, 0, 1], blizzards: [3] });
    expect(evaluateOutcome(state, tiny4)?.reason).toBe("world");
  });

  it("does not fire while an enemy holds a territory", () => {
    const state = buildState(tiny4, { seats: 2, owners: [0, 0, 0, 1] });
    expect(evaluateOutcome(state, tiny4)).toBeNull();
  });

  it("R71/D60 — Percentage Domination defaults to 70% of the non-blizzard count", () => {
    const state = buildState(classicWorld, {
      seats: 2,
      owners: withOwned(29),
      rules: { winCondition: "percentage" },
    });
    expect(dominationTarget(state)).toBe(Math.ceil(0.7 * 42));
    expect(dominationTarget(state)).toBe(30);
    expect(evaluateOutcome(state, classicWorld)).toBeNull();
    const won = buildState(classicWorld, {
      seats: 2,
      owners: withOwned(30),
      rules: { winCondition: "percentage" },
    });
    expect(evaluateOutcome(won, classicWorld)).toMatchObject({ reason: "percentage", winner: 0 });
  });

  it("R71 — the threshold is adjustable across 0.50 to 0.90", () => {
    for (const [threshold, target] of [
      [0.5, 21],
      [0.6, 26],
      [0.9, 38],
    ] as const) {
      const state = buildState(classicWorld, {
        seats: 2,
        owners: withOwned(1),
        rules: { winCondition: "percentage", dominationThreshold: threshold },
      });
      expect(dominationTarget(state)).toBe(target);
    }
  });

  it("R71 — the target counts non-blizzard territories only", () => {
    const state = buildState(tiny4, {
      seats: 2,
      owners: [0, 1, 1, 1],
      blizzards: [0, 1],
      rules: { winCondition: "percentage" },
    });
    expect(dominationTarget(state)).toBe(2);
  });

  it("R72 — Capitals wins on holding every capital", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 0, 1, 1],
      rules: { winCondition: "capitals", capitals: true },
      capitals: [0, 3],
    });
    expect(evaluateOutcome(state, mini)).toMatchObject({ reason: "capitals", winner: 0 });
  });

  it("R72 — holding every capital wins nothing in a World game", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 0, 1, 1],
      rules: { winCondition: "world", capitals: true },
      capitals: [0, 3],
    });
    expect(evaluateOutcome(state, mini)).toBeNull();
  });

  it("R81/R84 — last seat standing wins, and the neutral is never counted", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, -2, -2, -2],
      standings: { 1: "eliminated" },
    });
    expect(evaluateOutcome(state, mini)).toMatchObject({ reason: "lastStanding", winner: 0 });
  });

  it("World Domination is reported before last-seat-standing, which both hold", () => {
    const state = buildState(tiny4, { seats: 2, owners: [0, 0, 0, 0], standings: { 1: "eliminated" } });
    expect(evaluateOutcome(state, tiny4)?.reason).toBe("world");
  });

  it("R77 — Max Rounds does not fire until a round completes", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { maxRounds: 5 },
      round: 5,
    });
    expect(evaluateOutcome(state, mini, null)).toBeNull();
    expect(evaluateOutcome(state, mini, 4)).toBeNull();
    expect(evaluateOutcome(state, mini, 5)).toMatchObject({ reason: "maxRounds" });
  });

  it("R78 — the Max Rounds tiebreak is territories, then troops, then lowest seat", () => {
    const territoriesWin = buildState(mini, {
      seats: 3,
      owners: [0, 0, 0, 1, 1, 2],
      troops: [1, 1, 1, 50, 50, 1],
      rules: { maxRounds: 1 },
    });
    expect(maxRoundsWinner(territoriesWin)).toBe(0);

    const troopsWin = buildState(mini, {
      seats: 3,
      owners: [0, 0, 1, 1, 2, 2],
      troops: [1, 1, 9, 9, 3, 3],
      rules: { maxRounds: 1 },
    });
    expect(maxRoundsWinner(troopsWin)).toBe(1);

    const seatWin = buildState(mini, {
      seats: 3,
      owners: [0, 0, 1, 1, 2, 2],
      troops: [4, 4, 4, 4, 4, 4],
      rules: { maxRounds: 1 },
    });
    expect(maxRoundsWinner(seatWin)).toBe(0);
  });

  it("R78 — a Max Rounds outcome carries tiebreak: true and the completed round", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], rules: { maxRounds: 3 }, round: 4 });
    const outcome = evaluateOutcome(state, mini, 3);
    expect(outcome).toMatchObject({ reason: "maxRounds", tiebreak: true, round: 3 });
  });

  it("every other outcome carries tiebreak: false", () => {
    const state = buildState(tiny4, { seats: 2, owners: [0, 0, 0, 0] });
    expect(evaluateOutcome(state, tiny4)?.tiebreak).toBe(false);
  });

  it("isGameOver reads the outcome slot", () => {
    const state = buildState(tiny4, { seats: 2 });
    expect(isGameOver(state)).toBe(false);
    expect(isGameOver({ ...state, outcome: { winner: 0, reason: "world", tiebreak: false, round: 1 } })).toBe(true);
  });
});
