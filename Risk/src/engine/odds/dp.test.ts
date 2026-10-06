/** T3 — the battle DP (R38–R45). T5's monotonicity properties live here too. */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildTable, buildTableExact, expectedAttackerLossOf, outcomeDist, winChanceExact } from "./dp";
import { logisticWinChance } from "./logistic";
import { STANDARD_AUGMENT, TABLE_MAX, ZOMBIE_DEFENDER_AUGMENT, type DiceAugment } from "./types";

const CAPITAL: DiceAugment = { defendDiceBonus: 1, attackDicePenalty: 0, favourDefenderOnDraw: true };
const CAPITAL_WALL: DiceAugment = { defendDiceBonus: 2, attackDicePenalty: 0, favourDefenderOnDraw: true };

const STD = buildTableExact(STANDARD_AUGMENT, TABLE_MAX);
const W = (a: number, d: number): number => STD[a * (TABLE_MAX + 1) + d] as number;
const pct2 = (x: number): number => Number((x * 100).toFixed(2));

describe("T3 — the DP's named oracles, each with its augment stated (R39, F38)", () => {
  it("W[5][2] = 0.8897887238900141 under the STANDARD augment (ties to the defender)", () => {
    expect(winChanceExact(5, 2, STANDARD_AUGMENT)).toBe(0.8897887238900141);
    expect(W(5, 2)).toBe(0.8897887238900141);
  });

  it("W[300][300] = 0.9517567082839995 under the STANDARD augment", () => {
    expect(winChanceExact(300, 300, STANDARD_AUGMENT)).toBe(0.9517567082839995);
  });

  it("300 v 800 is 0.8897332621740284 under the ZOMBIE-DEFENDER augment, and ~2.4e-29 standard", () => {
    // SMG publish 0.8897331 — a 32-bit float print of this same double.
    expect(winChanceExact(300, 800, ZOMBIE_DEFENDER_AUGMENT)).toBeCloseTo(0.8897332621740284, 7);
    expect(winChanceExact(300, 800, ZOMBIE_DEFENDER_AUGMENT)).toBe(0.8897332621740284);
    // The near-coincidence with W[5][2] is a coincidence of the first four digits and nothing more:
    // a test quoting 0.8897332621740284 without `favourDefenderOnDraw: false` asserts the wrong table.
    const standard = winChanceExact(300, 800, STANDARD_AUGMENT);
    expect(standard).toBeLessThan(1e-28);
    expect(standard).toBeGreaterThan(1e-30);
    expect(standard / 1e-29).toBeCloseTo(2.4, 1);
  });
});

describe("T3 — spot cells from the R41 reference table (True Random, standard 3v2)", () => {
  it.each([
    [1, 1, 41.67], [1, 2, 10.61], [2, 1, 75.42], [2, 2, 36.27],
    [3, 2, 65.6], [3, 3, 47.03], [5, 5, 50.62], [5, 10, 11.83],
    [8, 8, 54.74], [10, 10, 56.76], [10, 12, 41.75], [15, 12, 78.28],
    [20, 12, 94.29], [20, 10, 97.47],
  ])("%i v %i = %f%%", (a, d, expected) => {
    expect(pct2(W(a, d))).toBe(expected);
  });

  it("the whole published A=1..20 x D=1..12 block agrees to two decimals", () => {
    const rows: Record<number, number[]> = {
      1: [41.67, 10.61, 2.7, 0.69, 0.18, 0.04, 0.01, 0, 0, 0, 0, 0],
      2: [75.42, 36.27, 20.61, 9.13, 4.91, 2.14, 1.13, 0.49, 0.26, 0.11, 0.06, 0.03],
      3: [91.64, 65.6, 47.03, 31.5, 20.59, 13.37, 8.37, 5.35, 3.28, 2.08, 1.26, 0.79],
      5: [99.03, 88.98, 76.94, 63.83, 50.62, 39.68, 29.74, 22.4, 16.16, 11.83, 8.29, 5.94],
      8: [99.96, 98.03, 94.68, 88.78, 81.84, 72.96, 64.29, 54.74, 46.4, 37.99, 31.17, 24.7],
      10: [100, 99.42, 98.11, 95.39, 91.63, 86.11, 79.98, 72.4, 65.01, 56.76, 49.4, 41.75],
      15: [100, 99.98, 99.87, 99.6, 99.02, 98.06, 96.44, 94.32, 91.23, 87.7, 83.09, 78.28],
      20: [100, 100, 99.99, 99.97, 99.91, 99.78, 99.55, 99.11, 98.48, 97.47, 96.17, 94.29],
    };
    for (const [a, row] of Object.entries(rows)) {
      expect(row.map((_, i) => pct2(W(Number(a), i + 1)))).toEqual(row);
    }
  });
});

describe("T3 — R42 break-evens, and the A = D+1 series", () => {
  const firstAtLeast = (d: number, threshold: number): number => {
    for (let a = 1; a <= TABLE_MAX; a++) if (W(a, d) >= threshold) return a;
    throw new Error("no such A");
  };

  it("the minimum A to be a favourite", () => {
    const expected: Record<number, number> = { 1: 2, 2: 3, 3: 4, 5: 5, 10: 10, 20: 18, 30: 27, 50: 44 };
    for (const [d, a] of Object.entries(expected)) expect(firstAtLeast(Number(d), 0.5)).toBe(a);
  });

  it("the minimum A to reach 80%", () => {
    const expected: Record<number, number> = { 1: 3, 2: 5, 3: 6, 5: 8, 10: 14, 20: 24, 30: 34, 50: 53 };
    for (const [d, a] of Object.entries(expected)) expect(firstAtLeast(Number(d), 0.8)).toBe(a);
  });

  it("R42/F56: the nine-value A = D+1 series for D = 1..9, bottoming out at D = 5", () => {
    const series = Array.from({ length: 9 }, (_, i) => Number(W(i + 2, i + 1).toFixed(3)));
    expect(series).toEqual([0.754, 0.656, 0.642, 0.638, 0.638, 0.64, 0.643, 0.646, 0.65]);
    for (const v of series) expect(v).toBeGreaterThan(0.5);
  });

  it("R37: the real break-even is A >= D+1, never 'twice as many armies'", () => {
    for (let d = 1; d <= 40; d++) expect(W(d + 1, d)).toBeGreaterThan(0.5);
    // A = D is already favourable from D = 5 up.
    for (let d = 5; d <= 40; d++) expect(W(d, d)).toBeGreaterThan(0.5);
  });
});

describe("T3 — the capital comparison (R36, D27)", () => {
  it("10 v 10 is 56.76 / 19.02 / 5.31 % for defendDiceBonus 0 / 1 / 2", () => {
    expect(pct2(winChanceExact(10, 10, STANDARD_AUGMENT))).toBe(56.76);
    expect(pct2(winChanceExact(10, 10, CAPITAL))).toBe(19.02);
    expect(pct2(winChanceExact(10, 10, CAPITAL_WALL))).toBe(5.31);
  });

  it("capital and capital+wall coincide at D = 3, because defendDice = min(D, 2 + bonus)", () => {
    for (const a of [5, 10, 15, 20, 30]) {
      expect(winChanceExact(a, 3, CAPITAL)).toBe(winChanceExact(a, 3, CAPITAL_WALL));
      expect(winChanceExact(a, 2, CAPITAL)).toBe(winChanceExact(a, 2, STANDARD_AUGMENT));
    }
  });

  it("the published standard / capital / capital+wall grid", () => {
    const grid: [number, number, number, number, number][] = [
      [5, 3, 76.94, 56.65, 56.65], [5, 5, 50.62, 27.78, 16.47], [5, 10, 11.83, 2.62, 0.57],
      [10, 3, 98.11, 90.08, 90.08], [10, 5, 91.63, 68.14, 48.96], [10, 10, 56.76, 19.02, 5.31],
      [15, 5, 99.02, 88.53, 72.89], [15, 10, 87.7, 44.76, 16.55],
      [20, 5, 99.91, 96.4, 86.93], [20, 10, 97.47, 68.39, 32.8],
      [30, 5, 100, 99.71, 97.39], [30, 10, 99.95, 92.87, 65.2],
    ];
    for (const [a, d, std, cap, wall] of grid) {
      expect(pct2(winChanceExact(a, d, STANDARD_AUGMENT))).toBe(std);
      expect(pct2(winChanceExact(a, d, CAPITAL))).toBe(cap);
      expect(pct2(winChanceExact(a, d, CAPITAL_WALL))).toBe(wall);
    }
  });
});

describe("T3 — the logistic tail, and the clamp that must not be used (R43, F47, F48)", () => {
  it("max abs error <= 0.0321 over A,D in [129,400], attained 0.03205 at (333,400), RMS 0.0088", () => {
    // 272x272 exact cells: the DP is built once for the whole band.
    const max = 400;
    const exact = buildTableExact(STANDARD_AUGMENT, max);
    const stride = max + 1;
    let worst = 0;
    let worstAt: [number, number] = [0, 0];
    let squares = 0;
    let n = 0;
    for (let a = 129; a <= max; a++) {
      for (let d = 129; d <= max; d++) {
        const err = Math.abs(logisticWinChance(a, d) - (exact[a * stride + d] as number));
        if (err > worst) { worst = err; worstAt = [a, d]; }
        squares += err * err;
        n++;
      }
    }
    expect(worst).toBeLessThanOrEqual(0.0321);
    expect(worst).toBeCloseTo(0.03205, 5);
    expect(worstAt).toEqual([333, 400]);
    expect(Math.sqrt(squares / n)).toBeCloseTo(0.0088, 4);
  });

  it("R43: independent clamping is not used — 129 v 381 must not read 85.65%", () => {
    // What clamping WOULD read, and why it is catastrophic: it destroys the troop ratio.
    expect(pct2(W(TABLE_MAX, TABLE_MAX))).toBe(85.65);
    expect(winChanceExact(129, 381, STANDARD_AUGMENT)).toBeLessThan(1e-10);
    expect(logisticWinChance(129, 381)).toBeLessThan(0.01);
  });

  it("the logistic is NOT consulted for a non-standard augment: the DP is extended instead (F48)", () => {
    // At (200, 200) the capital DP and the standard logistic are nowhere near each other.
    const capital = winChanceExact(200, 200, CAPITAL);
    expect(capital).toBeLessThan(0.05);
    expect(logisticWinChance(200, 200)).toBeGreaterThan(0.9);
    expect(Math.abs(capital - logisticWinChance(200, 200))).toBeGreaterThan(0.8);
  });
});

describe("the shipped Float32Array table", () => {
  it("is (TABLE_MAX+1)^2, row-major, and agrees with the exact DP to Float32 precision", () => {
    const table = buildTable(STANDARD_AUGMENT);
    expect(table.length).toBe((TABLE_MAX + 1) ** 2);
    expect(table).toBeInstanceOf(Float32Array);
    for (let a = 0; a <= TABLE_MAX; a += 7) {
      for (let d = 0; d <= TABLE_MAX; d += 11) {
        expect(table[a * (TABLE_MAX + 1) + d] as number).toBeCloseTo(W(a, d), 6);
      }
    }
  });

  it("pins the boundaries: W[A][0] = 1 for every A, W[0][D] = 0 for every D >= 1", () => {
    for (let a = 0; a <= TABLE_MAX; a++) expect(W(a, 0)).toBe(1);
    for (let d = 1; d <= TABLE_MAX; d++) expect(W(0, d)).toBe(0);
  });
});

describe("T5 — W[A][D] is monotone in A and antitone in D (fast-check)", () => {
  it("monotone non-decreasing in A", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: TABLE_MAX - 1 }), fc.integer({ min: 1, max: TABLE_MAX }), (a, d) => {
        expect(W(a + 1, d)).toBeGreaterThanOrEqual(W(a, d));
      }),
      { numRuns: 500 },
    );
  });

  it("antitone non-increasing in D", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: TABLE_MAX }), fc.integer({ min: 0, max: TABLE_MAX - 1 }), (a, d) => {
        expect(W(a, d + 1)).toBeLessThanOrEqual(W(a, d));
      }),
      { numRuns: 500 },
    );
  });

  it("is strictly monotone in A wherever there is room to move", () => {
    for (let d = 1; d <= 20; d++) {
      for (let a = 1; a < 20; a++) {
        if (W(a, d) > 1e-12 && W(a, d) < 1 - 1e-12) expect(W(a + 1, d)).toBeGreaterThan(W(a, d));
      }
    }
  });
});

describe("the forward outcome distribution (R40)", () => {
  it("attackLoss[A] is P(lose) and defendLoss[D] is P(win), and both arrays sum to 1", () => {
    for (const [a, d] of [[1, 1], [3, 2], [5, 5], [10, 10], [30, 15]] as const) {
      const dist = outcomeDist(a, d, STANDARD_AUGMENT);
      expect(dist.winChance).toBeCloseTo(winChanceExact(a, d, STANDARD_AUGMENT), 12);
      expect(dist.defendLoss[d] as number).toBe(dist.winChance);
      expect(dist.attackLoss[a] as number).toBeCloseTo(1 - dist.winChance, 12);
      expect([...dist.attackLoss].reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
      expect([...dist.defendLoss].reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
      expect(dist.unresolved).toBe(0);
      expect(dist.stopped).toEqual([]);
    }
  });

  it("R41: the attacker can never win having lost all A, nor lose having killed all D", () => {
    const dist = outcomeDist(6, 4, STANDARD_AUGMENT);
    // attackLoss[0..A-1] are wins; the aggregate at A is the loss total, so wins never reach index A.
    let wins = 0;
    for (let i = 0; i < dist.a; i++) wins += dist.attackLoss[i] as number;
    expect(wins).toBeCloseTo(dist.winChance, 15);
  });

  it("R48: stopUntil truncates the battle and produces `unresolved`, a strict lower bound", () => {
    const full = outcomeDist(10, 10, STANDARD_AUGMENT);
    const capped = outcomeDist(10, 10, STANDARD_AUGMENT, 6);
    expect(capped.unresolved).toBeGreaterThan(0);
    expect(capped.winChance).toBeLessThan(full.winChance);
    // With the attacker floored at 5 (source reduced to 6 troops) it can never be exhausted.
    expect(capped.attackLoss[10] as number).toBe(0);
    const mass = [...capped.attackLoss].reduce((x, y) => x + y, 0) + capped.unresolved;
    expect(mass).toBeCloseTo(1, 12);
    for (const s of capped.stopped) expect(s.attackerLosses).toBeGreaterThanOrEqual(5);
    expect(capped.stopped.reduce((acc, s) => acc + s.p, 0)).toBeCloseTo(capped.unresolved, 12);
  });

  it("stopUntil <= 1 is fight-to-the-death, identical to no limiter", () => {
    const a = outcomeDist(7, 5, STANDARD_AUGMENT);
    const b = outcomeDist(7, 5, STANDARD_AUGMENT, 1);
    expect(b.unresolved).toBe(0);
    expect(b.winChance).toBe(a.winChance);
  });

  it("degenerate battles: D = 0 conquers for free, A = 0 loses outright", () => {
    expect(outcomeDist(5, 0, STANDARD_AUGMENT).winChance).toBe(1);
    expect(outcomeDist(0, 5, STANDARD_AUGMENT).winChance).toBe(0);
  });

  it("memoises: the same arguments return the identical object", () => {
    expect(outcomeDist(9, 4, STANDARD_AUGMENT)).toBe(outcomeDist(9, 4, STANDARD_AUGMENT));
    expect(outcomeDist(9, 4, STANDARD_AUGMENT, 3)).not.toBe(outcomeDist(9, 4, STANDARD_AUGMENT));
  });
});

describe("expectedAttackerLoss is read off the distribution, never a constant (§4.13 sunkCost)", () => {
  it("rises with D and never exceeds A", () => {
    let previous = 0;
    for (const d of [1, 2, 4, 8, 16]) {
      const loss = expectedAttackerLossOf(outcomeDist(10, d, STANDARD_AUGMENT));
      expect(loss).toBeGreaterThan(previous);
      expect(loss).toBeLessThanOrEqual(10);
      previous = loss;
    }
  });

  it("is ~1.51 armies for 5 v 2 and ~7.31 for 10 v 10", () => {
    expect(expectedAttackerLossOf(outcomeDist(5, 2, STANDARD_AUGMENT))).toBeCloseTo(1.5115, 4);
    expect(expectedAttackerLossOf(outcomeDist(10, 10, STANDARD_AUGMENT))).toBeCloseTo(7.3078, 4);
  });

  it("costs nothing when there is nothing to fight", () => {
    expect(expectedAttackerLossOf(outcomeDist(5, 0, STANDARD_AUGMENT))).toBe(0);
  });
});
