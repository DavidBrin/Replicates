/** T3 — the single-roll distributions (R34, R35, R36). */

import { describe, expect, it } from "vitest";

import { allRoundDistributions, roundCounts, roundDistribution, roundExpectedLosses, roundShape } from "./rounds";
import { STANDARD_AUGMENT, ZOMBIE_DEFENDER_AUGMENT } from "./types";

const pct = (x: number): number => Number((x * 100).toFixed(4));

describe("T3 — the six standard single-roll distributions, as exact fractions", () => {
  it.each([
    ["3 v 2", 3, 2, [2890, 2611, 2275], 7776],
    ["3 v 1", 3, 1, [855, 441], 1296],
    ["2 v 2", 2, 2, [295, 420, 581], 1296],
    ["2 v 1", 2, 1, [125, 91], 216],
    ["1 v 2", 1, 2, [55, 161], 216],
    ["1 v 1", 1, 1, [15, 21], 36],
  ])("%s", (_label, a, d, numerators, denominator) => {
    expect(roundCounts(a, d, true)).toEqual(numerators);
    expect(numerators.reduce((x, y) => x + y, 0)).toBe(denominator);
    const dist = roundDistribution(a, d, true);
    expect([...dist]).toEqual(numerators.map((n) => n / denominator));
  });

  it("matches SMG's own printed float for 3v2 (first-party ties-to-defender confirmation)", () => {
    // risk-dice prints `roundInfo.AttackLossChances[2] // 0.292566872427984`.
    expect(roundDistribution(3, 2, true)[2]).toBeCloseTo(0.292566872427984, 15);
    expect(roundDistribution(3, 2, true)[2]).toBe(2275 / 7776);
  });

  it("matches the published percentages to four decimals", () => {
    expect([...roundDistribution(3, 2, true)].map(pct)).toEqual([37.1656, 33.5777, 29.2567]);
    expect([...roundDistribution(3, 1, true)].map(pct)).toEqual([65.9722, 34.0278]);
    expect([...roundDistribution(2, 2, true)].map(pct)).toEqual([22.7623, 32.4074, 44.8302]);
    expect([...roundDistribution(2, 1, true)].map(pct)).toEqual([57.8704, 42.1296]);
    expect([...roundDistribution(1, 2, true)].map(pct)).toEqual([25.463, 74.537]);
    expect([...roundDistribution(1, 1, true)].map(pct)).toEqual([41.6667, 58.3333]);
  });
});

describe("T3 — the augmented rows (R36, D27)", () => {
  it("the capital row: 3 v 3", () => {
    expect([...roundDistribution(3, 3, true)].map(pct)).toEqual([13.7603, 21.4699, 26.466, 38.3038]);
  });

  it("the stacked capital+wall row: 3 v 4", () => {
    expect([...roundDistribution(3, 4, true)].map(pct)).toEqual([7.3285, 14.8359, 23.4107, 54.4249]);
  });

  it("the zombie-defender row: 3 v 2 with ties to the ATTACKER", () => {
    expect([...roundDistribution(3, 2, false)].map(pct)).toEqual([61.9342, 25.4758, 12.59]);
  });

  it("the remaining capital and stacked rows", () => {
    expect([...roundDistribution(2, 3, true)].map(pct)).toEqual([12.59, 25.4758, 61.9342]);
    expect([...roundDistribution(1, 3, true)].map(pct)).toEqual([17.3611, 82.6389]);
    expect([...roundDistribution(2, 4, true)].map(pct)).toEqual([7.5939, 20.1346, 72.2715]);
    expect([...roundDistribution(1, 4, true)].map(pct)).toEqual([12.59, 87.41]);
  });

  it("the remaining zombie-defender rows", () => {
    expect([...roundDistribution(2, 2, false)].map(pct)).toEqual([44.8302, 32.4074, 22.7623]);
    expect([...roundDistribution(1, 2, false)].map(pct)).toEqual([42.1296, 57.8704]);
    expect([...roundDistribution(3, 1, false)].map(pct)).toEqual([82.6389, 17.3611]);
    expect([...roundDistribution(1, 1, false)].map(pct)).toEqual([58.3333, 41.6667]);
  });

  it("3v2 with ties to the attacker is 2v3's standard row reversed", () => {
    expect([...roundDistribution(3, 2, false)]).toEqual([...roundDistribution(2, 3, true)].reverse());
  });
});

describe("the complete set is 24 rows, each a proper distribution (R36)", () => {
  const all = allRoundDistributions();

  it("has exactly 24 entries: 3 attack dice x 4 defend dice x 2 tie rules", () => {
    expect(all.size).toBe(24);
  });

  it("every row sums to 1 and has min(a,d)+1 entries", () => {
    for (const [key, dist] of all) {
      const [a, d] = key.split(":").map(Number) as [number, number];
      expect(dist.length).toBe(Math.min(a, d) + 1);
      expect([...dist].reduce((x, y) => x + y, 0)).toBeCloseTo(1, 15);
      for (const p of dist) expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses dice counts outside 1..3 / 1..4", () => {
    expect(() => roundDistribution(4, 2, true)).toThrow(RangeError);
    expect(() => roundDistribution(0, 2, true)).toThrow(RangeError);
    expect(() => roundDistribution(3, 5, true)).toThrow(RangeError);
  });
});

describe("R35 — expected casualties per roll", () => {
  it.each([
    [3, 2, 0.9209, 1.0791],
    [3, 1, 0.3403, 0.6597],
    [2, 2, 1.2207, 0.7793],
    [2, 1, 0.4213, 0.5787],
    [1, 2, 0.7454, 0.2546],
    [1, 1, 0.5833, 0.4167],
  ])("%i v %i", (a, d, attacker, defender) => {
    const [att, def] = roundExpectedLosses(a, d, true);
    expect(att).toBeCloseTo(attacker, 4);
    expect(def).toBeCloseTo(defender, 4);
  });

  it("flags 2v2 and 1v2 as losing trades", () => {
    for (const [a, d] of [[2, 2], [1, 2]] as const) {
      const [att, def] = roundExpectedLosses(a, d, true);
      expect(def / att).toBeLessThan(1);
    }
    const [att32, def32] = roundExpectedLosses(3, 2, true);
    expect(def32 / att32).toBeCloseTo(1.172, 3);
  });
});

describe("R30/R33 — the dice a battle state rolls", () => {
  it("caps attacker dice at min(A, 3) and defender dice at min(D, 2 + bonus)", () => {
    expect(roundShape(1, 5, STANDARD_AUGMENT)).toEqual({ attackDice: 1, defendDice: 2, pairs: 1 });
    expect(roundShape(2, 5, STANDARD_AUGMENT)).toEqual({ attackDice: 2, defendDice: 2, pairs: 2 });
    expect(roundShape(9, 1, STANDARD_AUGMENT)).toEqual({ attackDice: 3, defendDice: 1, pairs: 1 });
  });

  it("R33: the capital augment is a no-op at D <= 2 and only bites at D >= 3", () => {
    const capital = { defendDiceBonus: 1, attackDicePenalty: 0, favourDefenderOnDraw: true };
    for (const d of [1, 2]) {
      expect(roundShape(9, d, capital)).toEqual(roundShape(9, d, STANDARD_AUGMENT));
    }
    expect(roundShape(9, 3, capital).defendDice).toBe(3);
    expect(roundShape(9, 3, STANDARD_AUGMENT).defendDice).toBe(2);
  });

  it("R36: augments stack to four defender dice", () => {
    const wall = { defendDiceBonus: 2, attackDicePenalty: 0, favourDefenderOnDraw: true };
    expect(roundShape(9, 9, wall)).toEqual({ attackDice: 3, defendDice: 4, pairs: 3 });
  });

  it("an attackDicePenalty takes a die off the attacker, leaving the tie rule alone", () => {
    const zombieAttacker = { defendDiceBonus: 0, attackDicePenalty: 1, favourDefenderOnDraw: true };
    expect(roundShape(9, 9, zombieAttacker)).toEqual({ attackDice: 2, defendDice: 2, pairs: 2 });
    expect(ZOMBIE_DEFENDER_AUGMENT.favourDefenderOnDraw).toBe(false);
  });
});
